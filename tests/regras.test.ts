import { describe, expect, it } from 'vitest';
import { dataExif, lerExif } from '../src/exif';
import { A4, agrupar, encaixar, folha, LADO_MINIMO, limitarPixels, MARGEM, MAX_PIXELS, nomeArquivo, pixelsAlvo, tamanhoTexto } from '../src/layout';

/** JPEG mínimo com EXIF: orientação e DateTimeOriginal. */
function jpegComExif(orientacao: number, data: string, le = true): ArrayBuffer {
  const bytes: number[] = [];
  const u16 = (n: number) => (le ? [n & 255, n >> 8] : [n >> 8, n & 255]);
  const u32 = (n: number) => (le ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
  // TIFF: cabeçalho (8) + IFD0 com 2 entradas (2+24+4=30) → ExifIFD em 38 com 1 entrada (2+12+4=18) → texto em 56
  const tiff: number[] = [];
  tiff.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  tiff.push(...u16(2));
  tiff.push(...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientacao), 0, 0);
  tiff.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(38));
  tiff.push(...u32(0));
  tiff.push(...u16(1));
  tiff.push(...u16(0x9003), ...u16(2), ...u32(20), ...u32(56));
  tiff.push(...u32(0));
  for (const c of data) tiff.push(c.charCodeAt(0));
  tiff.push(0);
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  bytes.push(0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1, 0xff, 0xda, 0, 2);
  return new Uint8Array(bytes).buffer;
}

describe('EXIF', () => {
  it('lê orientação e data (Intel)', () => {
    const r = lerExif(jpegComExif(6, '2026:11:18 14:05:09'));
    expect(r.orientacao).toBe(6);
    expect(r.data).toBe(new Date(2026, 10, 18, 14, 5, 9).getTime());
  });
  it('lê orientação e data (Motorola)', () => {
    const r = lerExif(jpegComExif(3, '2025:01:02 08:00:00', false));
    expect(r.orientacao).toBe(3);
    expect(r.data).toBe(new Date(2025, 0, 2, 8, 0, 0).getTime());
  });
  it('sem EXIF ou não JPEG: padrão', () => {
    expect(lerExif(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer)).toEqual({ orientacao: 1, data: null });
    expect(lerExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toEqual({ orientacao: 1, data: null });
    expect(lerExif(new ArrayBuffer(0))).toEqual({ orientacao: 1, data: null });
  });
  it('EXIF cortado não quebra', () => {
    const b = jpegComExif(6, '2026:11:18 14:05:09').slice(0, 30);
    expect(() => lerExif(b)).not.toThrow();
  });
  it('data inválida vira nula', () => {
    expect(dataExif('0000:00:00 00:00:00')).toBeNull();
    expect(dataExif('lixo')).toBeNull();
  });
});

describe('folhas', () => {
  it('1 por folha: deita a folha para foto deitada', () => {
    expect(folha(1, false)).toMatchObject({ larg: A4.larg, alt: A4.alt });
    expect(folha(1, true)).toMatchObject({ larg: A4.alt, alt: A4.larg });
  });
  it('2 e 4 por folha cabem dentro da margem e não se sobrepõem', () => {
    for (const n of [2, 4] as const) {
      const f = folha(n);
      expect(f.caixas).toHaveLength(n);
      for (const c of f.caixas) {
        expect(c.x).toBeGreaterThanOrEqual(MARGEM - 0.01);
        expect(c.y).toBeGreaterThanOrEqual(MARGEM - 0.01);
        expect(c.x + c.larg).toBeLessThanOrEqual(f.larg - MARGEM + 0.01);
        expect(c.y + c.alt).toBeLessThanOrEqual(f.alt - MARGEM + 0.01);
      }
      // a primeira fica em cima (y maior no PDF)
      expect(f.caixas[0].y).toBeGreaterThan(f.caixas[f.caixas.length - 1].y);
    }
  });
  it('encaixa sem cortar e centraliza', () => {
    const c = { x: 0, y: 0, larg: 400, alt: 400 };
    const r = encaixar(c, 4000, 3000);
    expect(r.larg).toBeCloseTo(400);
    expect(r.alt).toBeCloseTo(300);
    expect(r.y).toBeCloseTo(50);
  });
  it('pixels: 200 dpi numa folha A4 inteira não passa de ~2200 px', () => {
    const f = folha(1, true);
    const p = pixelsAlvo(f.caixas[0], 4000, 3000, 200);
    expect(p.larg).toBeGreaterThan(1900); // 7,5 pol de altura útil × 200 dpi × 4/3
    expect(p.larg).toBeLessThan(2300);
    expect(p.larg / p.alt).toBeCloseTo(4 / 3, 2);
  });
  it('pixels: nunca aumenta a foto e máxima mantém o original', () => {
    const f = folha(1);
    expect(pixelsAlvo(f.caixas[0], 800, 600, 200)).toEqual({ larg: 800, alt: 600 });
    expect(pixelsAlvo(f.caixas[0], 4000, 3000, null)).toEqual({ larg: 4000, alt: 3000 });
  });
  it('4 por folha pede menos pixels que 1 por folha', () => {
    const um = pixelsAlvo(folha(1, true).caixas[0], 4000, 3000, 200);
    const quatro = pixelsAlvo(folha(4).caixas[0], 4000, 3000, 200);
    expect(quatro.larg * quatro.alt).toBeLessThan(um.larg * um.alt / 3);
  });
  it('piso de 1000 px no lado maior (carimbo legível), sem passar do original', () => {
    const p = pixelsAlvo(folha(4).caixas[0], 4000, 3000, 150);
    expect(Math.max(p.larg, p.alt)).toBe(LADO_MINIMO);
    expect(p.larg / p.alt).toBeCloseTo(4 / 3, 2);
    expect(pixelsAlvo(folha(4).caixas[0], 900, 600, 150)).toEqual({ larg: 900, alt: 600 });
  });
  it('limita a 16 MP (canvas do iPhone)', () => {
    const r = limitarPixels({ larg: 6000, alt: 4000 });
    expect(r.larg * r.alt).toBeLessThanOrEqual(MAX_PIXELS);
    expect(r.larg / r.alt).toBeCloseTo(1.5, 2);
    expect(limitarPixels({ larg: 4000, alt: 3000 })).toEqual({ larg: 4000, alt: 3000 });
  });
  it('agrupa', () => {
    expect(agrupar([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('textos', () => {
  it('tamanho', () => {
    expect(tamanhoTexto(500)).toBe('500 B');
    expect(tamanhoTexto(2048)).toBe('2 KB');
    expect(tamanhoTexto(1.5 * 1024 * 1024)).toBe('1,5 MB');
    expect(tamanhoTexto(86 * 1024 * 1024)).toBe('86 MB');
  });
  it('nome do arquivo', () => {
    expect(nomeArquivo('Obra Rua 7')).toBe('Obra Rua 7.pdf');
    expect(nomeArquivo('relatorio.PDF')).toBe('relatorio.pdf');
    expect(nomeArquivo('a/b:c?')).toBe('a-b-c-.pdf');
    expect(nomeArquivo('  ', new Date(2026, 10, 19))).toBe('fotos 19-11-2026.pdf');
  });
});
