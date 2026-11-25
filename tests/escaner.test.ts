import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { ajustarA4, homografia, ordenar, proporcao, valido, type Quad } from '../src/escaner/geometria';
import { acharBordas } from '../src/escaner/bordas';
import { endireitar, limpar, pretoEBranco } from '../src/escaner/limpar';
import { girar, tamanhoFolha } from '../src/escaner/motor';
import { lugarNaPagina, montarPdf } from '../src/escaner/pdf-escaner';

const q = (...p: number[]): Quad => [0, 1, 2, 3].map((i) => ({ x: p[2 * i], y: p[2 * i + 1] })) as Quad;

/** Foto sintética: fundo escuro com ruído, papel claro girado, linhas de "texto" e sombra. */
function fotoDePapel(w: number, h: number, papel: Quad, sombra = 0) {
  const px = new Uint8ClampedArray(w * h * 4);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const dentro = (x: number, y: number) => {
    for (let i = 0; i < 4; i++) {
      const a = papel[i], b = papel[(i + 1) % 4];
      if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false;
    }
    return true;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      let v = 70 + rnd() * 25;
      if (dentro(x + 0.5, y + 0.5)) v = (y % 14 < 2 && x % 40 > 6 ? 60 : 238) * (1 - (sombra * x) / w);
      px[k] = v; px[k + 1] = v * 0.97; px[k + 2] = v * 0.93; px[k + 3] = 255;
    }
  }
  return px;
}

describe('geometria', () => {
  it('ordena os cantos começando em cima à esquerda, no sentido do relógio', () => {
    const o = ordenar([{ x: 90, y: 80 }, { x: 10, y: 5 }, { x: 5, y: 70 }, { x: 95, y: 10 }]);
    expect(o.map((p) => p.x)).toEqual([10, 95, 90, 5]);
  });
  it('a perspectiva leva os cantos do retângulo para os do quadrilátero', () => {
    const quad = q(12, 8, 300, 30, 280, 400, 20, 380);
    const m = homografia(200, 300, quad);
    const leva = (x: number, y: number) => { const z = m[6] * x + m[7] * y + m[8]; return [(m[0] * x + m[1] * y + m[2]) / z, (m[3] * x + m[4] * y + m[5]) / z]; };
    [[0, 0], [200, 0], [200, 300], [0, 300]].forEach(([x, y], i) => {
      const [a, b] = leva(x, y);
      expect(a).toBeCloseTo(quad[i].x, 6);
      expect(b).toBeCloseTo(quad[i].y, 6);
    });
  });
  it('proporção de folha vista de frente e A4 arredondado', () => {
    expect(proporcao(q(100, 100, 300, 100, 300, 383, 100, 383), 400, 500)).toBeCloseTo(1.415, 2);
    expect(ajustarA4(1.38)).toBe(Math.SQRT2);
    expect(ajustarA4(1 / 1.45)).toBeCloseTo(1 / Math.SQRT2, 6);
    expect(ajustarA4(2.6)).toBe(2.6); // nota fiscal comprida continua comprida
  });
  it('recusa cantos cruzados', () => {
    expect(valido(q(0, 0, 100, 0, 100, 100, 0, 100))).toBe(true);
    expect(valido(q(0, 0, 100, 100, 100, 0, 0, 100))).toBe(false);
  });
  it('girar troca o canto de cima e o tamanho', () => {
    const a = q(0, 0, 10, 0, 10, 20, 0, 20);
    expect(girar(a, 1)[0]).toEqual({ x: 0, y: 20 });
    expect(girar(a, 4)).toEqual(a);
    const t = tamanhoFolha(q(0, 0, 1000, 0, 1000, 1414, 0, 1414), 1000, 1414, 2339);
    expect([t.larg, t.alt]).toEqual([1050, 1485]); // não inventa pixel: só 5% a mais que a foto
  });
});

describe('bordas', () => {
  it('acha a folha girada numa mesa escura', () => {
    const papel = q(90, 40, 380, 70, 350, 340, 60, 310);
    const a = acharBordas(fotoDePapel(480, 360, papel), 480, 360);
    expect(a).not.toBeNull();
    const erro = Math.max(...a!.quad.map((p, i) => Math.hypot(p.x - papel[i].x, p.y - papel[i].y)));
    expect(erro).toBeLessThan(4);
    expect(a!.confianca).toBeGreaterThan(0.55);
  });
  it('foto sem papel nenhum não inventa folha com confiança', () => {
    const px = new Uint8ClampedArray(320 * 240 * 4).fill(128);
    const a = acharBordas(px, 320, 240);
    expect(a === null || a.confianca < 0.55).toBe(true);
  });
});

describe('limpar', () => {
  const W = 300, H = 400;
  const papel = q(0, 0, W, 0, W, H, 0, H);
  it('tira a sombra: papel vira branco e a letra continua escura', () => {
    const px = endireitar(fotoDePapel(W, H, papel, 0.5), W, H, papel, W, H);
    limpar(px, W, H, 'cor');
    const v = (x: number, y: number) => px[(y * W + x) * 4];
    expect(v(20, 7)).toBeGreaterThan(245); // papel claro
    expect(v(280, 7)).toBeGreaterThan(245); // papel na sombra
    expect(v(275, 0)).toBeLessThan(60); // letra na sombra
  });
  it('preto e branco em 1 bit, linha alinhada em byte', () => {
    const px = endireitar(fotoDePapel(W, H, papel), W, H, papel, W, H);
    const b = pretoEBranco(px, W, H);
    expect(b.length).toBe(Math.ceil(W / 8) * H);
    const bit = (x: number, y: number) => (b[y * Math.ceil(W / 8) + (x >> 3)] >> (7 - (x & 7))) & 1;
    expect(bit(20, 7)).toBe(1); // papel = branco
    expect(bit(20, 0)).toBe(0); // letra = preto
  });
});

describe('PDF do escâner', () => {
  it('A4 ocupa a página inteira; nota estreita fica no meio', () => {
    expect(lugarNaPagina(Math.SQRT2)).toMatchObject({ x: 0, y: 0, larg: 595.28 });
    const n = lugarNaPagina(2.6);
    expect(n.alt).toBeCloseTo(841.89 - 56, 1);
    expect(n.x).toBeGreaterThan(100);
    expect(lugarNaPagina(1 / Math.SQRT2).pagina).toEqual([841.89, 595.28]);
  });
  it('monta páginas em preto e branco de 1 bit', async () => {
    const bits = new Uint8Array(2 * 16).fill(0xaa);
    const bytes = await montarPdf([{ tipo: 'bits', bytes: bits, larg: 16, alt: 16, razao: Math.SQRT2 }, { tipo: 'bits', bytes: bits, larg: 16, alt: 16, razao: 1 }], 't');
    const d = await PDFDocument.load(bytes);
    expect(d.getPageCount()).toBe(2);
    expect(new TextDecoder('latin1').decode(bytes)).toContain('/BitsPerComponent 1');
  });
});
