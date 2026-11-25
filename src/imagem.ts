// Abrir as fotos (inclusive HEIC do iPhone), fazer a miniatura e preparar o JPEG que vai para o PDF.
import { lerExif } from './exif';
import { limitarPixels } from './layout';

export type Giro = 0 | 90 | 180 | 270;

export interface Foto {
  id: string;
  nome: string;
  bytes: number; // tamanho do arquivo original
  arquivo: File; // o original; HEIC é convertido de novo na hora do PDF (não fica 1 GB na memória)
  heic: boolean;
  jpeg: boolean; // o original é JPEG?
  orientacaoExif: number;
  larg: number; // já de pé, como a foto aparece
  alt: number;
  data: number; // data da foto (EXIF) ou do arquivo
  giro: Giro; // giro pedido na tela
  miniatura: string; // object URL
}

const EXT_HEIC = /\.(heic|heif)$/i;
const EXT_OK = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i;
const LADO_MINIATURA = 420;

export function ehImagem(f: File): boolean {
  return f.type.startsWith('image/') || EXT_OK.test(f.name);
}

export function ehHeic(f: File): boolean {
  return /image\/hei[cf]/i.test(f.type) || EXT_HEIC.test(f.name);
}

export async function deHeic(arquivo: File): Promise<Blob> {
  // só baixa o conversor (3 MB) quando aparece uma foto HEIC
  const { heicTo } = await import('heic-to');
  return heicTo({ blob: arquivo, type: 'image/jpeg', quality: 0.92 });
}

let seq = 0;

export async function abrirFoto(arquivo: File): Promise<Foto> {
  const heic = ehHeic(arquivo);
  const jpeg = !heic && (arquivo.type === 'image/jpeg' || /\.jpe?g$/i.test(arquivo.name));
  let orientacaoExif = 1;
  let data: number | null = null;
  if (jpeg) {
    const info = lerExif(await arquivo.slice(0, 256 * 1024).arrayBuffer());
    orientacaoExif = info.orientacao;
    data = info.data;
  }
  const fonte: Blob = heic ? await deHeic(arquivo) : arquivo;

  // medidas pela <img> (só lê o cabeçalho), miniatura já reduzida: não abre 12 MP só para a miniatura
  const { larg, alt } = await medidas(fonte);
  const esc = Math.min(1, LADO_MINIATURA / Math.max(larg, alt));
  const bmp = await decodificar(fonte, Math.max(1, Math.round(larg * esc)), Math.max(1, Math.round(alt * esc)));
  try {
    const miniatura = await miniaturaDe(bmp);
    return {
      id: `f${++seq}`,
      nome: arquivo.name,
      bytes: arquivo.size,
      arquivo,
      heic,
      jpeg,
      orientacaoExif,
      larg,
      alt,
      data: data ?? arquivo.lastModified,
      giro: 0,
      miniatura,
    };
  } finally {
    bmp.close();
  }
}

/** Largura e altura já de pé (os navegadores atuais aplicam o EXIF na <img>). */
export function medidas(b: Blob): Promise<{ larg: number; alt: number }> {
  return new Promise((ok, erro) => {
    const url = URL.createObjectURL(b);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.naturalWidth && img.naturalHeight) ok({ larg: img.naturalWidth, alt: img.naturalHeight });
      else erro(new Error('imagem vazia'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      erro(new Error('não deu para abrir esta imagem'));
    };
    img.src = url;
  });
}

/**
 * Abre a imagem de pé. Com larg e alt, já abre reduzida (bem mais leve).
 * Se o navegador não aceitar as opções (Safari antigo), tenta sem elas; quem desenha
 * depois sempre estica para o tamanho pedido, então o resultado é o mesmo.
 */
export async function decodificar(b: Blob, larg?: number, alt?: number): Promise<ImageBitmap> {
  const base: ImageBitmapOptions = { imageOrientation: 'from-image' };
  if (larg && alt) {
    try {
      const bmp = await createImageBitmap(b, { ...base, resizeWidth: larg, resizeHeight: alt, resizeQuality: 'high' });
      // proteção: navegador que reduz antes de aplicar o EXIF devolve a foto deitada/achatada
      if (bmp.width === larg && bmp.height === alt) return bmp;
      bmp.close();
    } catch {
      /* sem redimensionar no decode: reduz no canvas */
    }
  }
  try {
    return await createImageBitmap(b, base);
  } catch {
    /* Safari 16 ou anterior não aceita imageOrientation */
  }
  try {
    return await createImageBitmap(b);
  } catch {
    throw new Error('não deu para abrir esta imagem');
  }
}

export function novoCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('sem canvas');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { c, ctx };
}

export function paraBlob(c: HTMLCanvasElement, q: number): Promise<Blob> {
  return new Promise((ok, erro) =>
    c.toBlob((b) => (b ? ok(b) : erro(new Error('falhou ao gerar o JPEG'))), 'image/jpeg', q),
  );
}

async function miniaturaDe(bmp: ImageBitmap): Promise<string> {
  const esc = Math.min(1, LADO_MINIATURA / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * esc));
  const h = Math.max(1, Math.round(bmp.height * esc));
  const { c, ctx } = novoCanvas(w, h);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await paraBlob(c, 0.8);
  c.width = c.height = 0;
  return URL.createObjectURL(blob);
}

/** Largura e altura da foto depois do giro pedido na tela. */
export function medidaFinal(f: Pick<Foto, 'larg' | 'alt' | 'giro'>): { larg: number; alt: number } {
  return f.giro % 180 ? { larg: f.alt, alt: f.larg } : { larg: f.larg, alt: f.alt };
}

/**
 * JPEG da foto no tamanho final (alvo já considera o giro).
 * Quando a foto já é um JPEG de pé, sem giro e sem redução, o arquivo original entra como está
 * se for menor (ou sempre, na qualidade máxima): zero perda.
 */
export async function jpegParaPdf(f: Foto, alvoPedido: { larg: number; alt: number }, q: number, maxima: boolean): Promise<Uint8Array> {
  const fin = medidaFinal(f);
  const semMudar = f.jpeg && f.orientacaoExif === 1 && f.giro === 0 && alvoPedido.larg >= fin.larg && alvoPedido.alt >= fin.alt;
  if (semMudar && maxima) return new Uint8Array(await f.arquivo.arrayBuffer());

  // o iPhone não desenha canvas acima de ~16,7 milhões de pixels (fotos de 24 MP)
  const alvo = limitarPixels(alvoPedido);
  const fonte = f.heic ? await deHeic(f.arquivo) : f.arquivo;
  const deitar = f.giro % 180 !== 0;
  const w0 = deitar ? alvo.alt : alvo.larg;
  const h0 = deitar ? alvo.larg : alvo.alt;
  const bmp = await decodificar(fonte, w0, h0);
  const { c, ctx } = novoCanvas(alvo.larg, alvo.alt);
  try {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, alvo.larg, alvo.alt);
    ctx.translate(alvo.larg / 2, alvo.alt / 2);
    ctx.rotate((f.giro * Math.PI) / 180);
    ctx.drawImage(bmp, -w0 / 2, -h0 / 2, w0, h0);
  } finally {
    bmp.close();
  }
  const blob = await paraBlob(c, q);
  c.width = c.height = 0;
  if (semMudar && blob.size >= f.arquivo.size) return new Uint8Array(await f.arquivo.arrayBuffer());
  return new Uint8Array(await blob.arrayBuffer());
}
