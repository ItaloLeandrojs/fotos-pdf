// Junta as partes do escâner: o que o Worker sabe fazer. Sem DOM.
import { acharBordas, type Achado } from './bordas';
import { ajustarA4, dist, proporcao, type Quad } from './geometria';
import { endireitar, limpar, pretoEBranco, type Modo } from './limpar';

export type { Achado, Modo, Quad };

/** Lado maior da folha pronta, em pixels: A4 a 200 dpi (colorido e cinza) ou 300 dpi (preto e branco, que é leve). */
export const LADO_FOLHA: Record<Modo, number> = { original: 2339, cor: 2339, cinza: 2339, pb: 3508 };

/** Giro de 90 graus no sentido do relógio, k vezes: é só trocar qual canto é o de cima. */
export function girar(q: Quad, k: number): Quad {
  const g = ((k % 4) + 4) % 4;
  return [0, 1, 2, 3].map((i) => q[(i - g + 4) % 4]) as Quad;
}

/** Tamanho da folha pronta em pixels, sem inventar mais pixel do que a foto tem. */
export function tamanhoFolha(q: Quad, fw: number, fh: number, ladoMaximo: number): { larg: number; alt: number; razao: number } {
  const razao = ajustarA4(proporcao(q, fw, fh)); // altura / largura
  const largFoto = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  const altFoto = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const alt = Math.min(ladoMaximo, Math.max(altFoto, largFoto * razao) * 1.05, razao >= 1 ? Infinity : ladoMaximo * razao);
  return { alt: Math.max(16, Math.round(alt)), larg: Math.max(16, Math.round(alt / razao)), razao };
}

export interface PedidoFolha {
  foto: Uint8ClampedArray;
  fw: number;
  fh: number;
  quad: Quad;
  giro: number;
  larg: number; // já girada
  alt: number;
  modo: Modo;
  bits: boolean; // preto e branco em 1 bit (para o PDF) em vez de RGBA (para a tela)
}

export function fazerFolha(p: PedidoFolha): Uint8ClampedArray<ArrayBuffer> | Uint8Array<ArrayBuffer> {
  const px = endireitar(p.foto, p.fw, p.fh, girar(p.quad, p.giro), p.larg, p.alt);
  if (p.modo === 'original') return px; // só endireita: foto, RG, papel colorido
  if (p.modo !== 'pb') {
    limpar(px, p.larg, p.alt, p.modo);
    return px;
  }
  const bits = pretoEBranco(px, p.larg, p.alt);
  if (p.bits) return bits;
  const linha = Math.ceil(p.larg / 8);
  for (let y = 0; y < p.alt; y++) {
    for (let x = 0; x < p.larg; x++) {
      const k = (y * p.larg + x) * 4;
      px[k] = px[k + 1] = px[k + 2] = bits[y * linha + (x >> 3)] & (0x80 >> (x & 7)) ? 255 : 0;
    }
  }
  return px;
}

export { acharBordas };
