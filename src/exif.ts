// Lê só o que importa do EXIF de um JPEG: a orientação (1 a 8) e a data em que a foto foi tirada.
// Leitura direta dos bytes, sem biblioteca. Se algo não bater, devolve o padrão (orientação 1, sem data).

export interface InfoExif {
  orientacao: number;
  data: number | null; // milissegundos, lendo o horário da câmera como horário local
}

const PADRAO: InfoExif = { orientacao: 1, data: null };

export function lerExif(buf: ArrayBuffer): InfoExif {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return { ...PADRAO };
  let p = 2;
  while (p + 4 <= v.byteLength) {
    const marca = v.getUint16(p);
    if ((marca & 0xff00) !== 0xff00) break;
    const tam = v.getUint16(p + 2);
    if (marca === 0xffe1 && p + 10 <= v.byteLength && v.getUint32(p + 4) === 0x45786966) {
      return lerTiff(v, p + 10, Math.min(v.byteLength, p + 2 + tam));
    }
    if (marca === 0xffda) break; // começou a imagem, não há mais cabeçalhos
    p += 2 + tam;
  }
  return { ...PADRAO };
}

function lerTiff(v: DataView, ini: number, fim: number): InfoExif {
  const out: InfoExif = { ...PADRAO };
  try {
    const ordem = v.getUint16(ini);
    const le = ordem === 0x4949;
    if (!le && ordem !== 0x4d4d) return out;
    const u16 = (o: number) => v.getUint16(o, le);
    const u32 = (o: number) => v.getUint32(o, le);
    const ifd0 = ini + u32(ini + 4);
    let exifIfd = 0;
    let dataIfd0: number | null = null;

    const percorrer = (base: number, fn: (tag: number, ent: number) => void) => {
      if (base + 2 > fim) return;
      const n = u16(base);
      for (let i = 0; i < n; i++) {
        const ent = base + 2 + i * 12;
        if (ent + 12 > fim) return;
        fn(u16(ent), ent);
      }
    };
    const texto = (ent: number): string => {
      const cont = u32(ent + 4);
      const off = cont > 4 ? ini + u32(ent + 8) : ent + 8;
      let s = '';
      for (let i = 0; i < cont && off + i < fim; i++) {
        const c = v.getUint8(off + i);
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s;
    };

    percorrer(ifd0, (tag, ent) => {
      if (tag === 0x0112) {
        const o = u16(ent + 8);
        if (o >= 1 && o <= 8) out.orientacao = o;
      } else if (tag === 0x8769) {
        exifIfd = ini + u32(ent + 8);
      } else if (tag === 0x0132) {
        dataIfd0 = dataExif(texto(ent));
      }
    });
    if (exifIfd) {
      percorrer(exifIfd, (tag, ent) => {
        if (tag === 0x9003) out.data = dataExif(texto(ent)) ?? out.data;
      });
    }
    if (out.data === null) out.data = dataIfd0;
  } catch {
    /* EXIF quebrado: fica o que já foi lido */
  }
  return out;
}

/** "2026:11:18 14:05:09" → milissegundos. */
export function dataExif(s: string): number | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const [, a, me, d, h, mi, se] = m.map(Number);
  if (a < 1990 || me < 1 || me > 12) return null;
  // horário local, para comparar com a data do arquivo (lastModified) quando uma foto não tem EXIF
  return new Date(a, me - 1, d, h, mi, se).getTime();
}
