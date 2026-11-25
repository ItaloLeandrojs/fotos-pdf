// Contas de geometria do escâner. Sem DOM: dá para testar no Node.
export interface Ponto { x: number; y: number }
/** Cantos na ordem: cima-esquerda, cima-direita, baixo-direita, baixo-esquerda. */
export type Quad = [Ponto, Ponto, Ponto, Ponto];

export const dist = (a: Ponto, b: Ponto) => Math.hypot(a.x - b.x, a.y - b.y);

/** Põe quatro pontos soltos na ordem do Quad. */
export function ordenar(p: Ponto[]): Quad {
  const cx = p.reduce((s, q) => s + q.x, 0) / 4;
  const cy = p.reduce((s, q) => s + q.y, 0) / 4;
  const volta = [...p].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  // no sentido do relógio; começa no canto mais perto de cima-esquerda
  let k = 0;
  for (let i = 1; i < 4; i++) if (volta[i].x + volta[i].y < volta[k].x + volta[k].y) k = i;
  return [0, 1, 2, 3].map((i) => volta[(k + i) % 4]) as Quad;
}

export function area(q: Ponto[]): number {
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** Quadrilátero que dá para endireitar: convexo e sem canto fechado demais. */
export function valido(q: Quad): boolean {
  let sinal = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cruz = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const base = dist(a, b) * dist(b, c);
    if (base === 0 || Math.abs(cruz) / base < 0.17) return false; // canto com menos de uns 10 graus
    if (sinal && Math.sign(cruz) !== sinal) return false;
    sinal = Math.sign(cruz);
  }
  return true;
}

/** Transformação de perspectiva que leva o retângulo (0,0)-(larg,alt) para o quadrilátero. 9 números, por linha. */
export function homografia(larg: number, alt: number, q: Quad): Float64Array {
  // fórmula fechada para o quadrado unitário, depois escala
  const [p0, p1, p2, p3] = q;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / det;
  const h = (dx1 * sy - sx * dy1) / det;
  return Float64Array.from([
    (p1.x - p0.x + g * p1.x) / larg, (p3.x - p0.x + h * p3.x) / alt, p0.x,
    (p1.y - p0.y + g * p1.y) / larg, (p3.y - p0.y + h * p3.y) / alt, p0.y,
    g / larg, h / alt, 1,
  ]);
}

/**
 * Altura dividida pela largura do papel de verdade, descontando a perspectiva
 * (método de Zhang e He, com o centro da foto como centro da câmera).
 */
export function proporcao(q: Quad, fotoLarg: number, fotoAlt: number): number {
  const [a, b, c, d] = q;
  const simples = (dist(a, d) + dist(b, c)) / (dist(a, b) + dist(d, c));
  const u0 = fotoLarg / 2;
  const v0 = fotoAlt / 2;
  const m = (p: Ponto): [number, number, number] => [p.x - u0, p.y - v0, 1];
  const m1 = m(a);
  const m2 = m(b);
  const m3 = m(d);
  const m4 = m(c);
  const cruz = (s: number[], t: number[]) => [s[1] * t[2] - s[2] * t[1], s[2] * t[0] - s[0] * t[2], s[0] * t[1] - s[1] * t[0]];
  const esc = (s: number[], t: number[]) => s[0] * t[0] + s[1] * t[1] + s[2] * t[2];
  const k2 = esc(cruz(m1, m4), m3) / esc(cruz(m2, m4), m3);
  const k3 = esc(cruz(m1, m4), m2) / esc(cruz(m3, m4), m2);
  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 - 1];
  const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 - 1];
  if (Math.abs(n2[2]) < 1e-3 || Math.abs(n3[2]) < 1e-3) return simples;
  const f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
  const maior = Math.max(fotoLarg, fotoAlt);
  // foco fora do que existe em celular: a conta não é confiável nesta foto
  if (!(f2 > (0.5 * maior) ** 2 && f2 < (2.5 * maior) ** 2)) return simples;
  const larg2 = (n2[0] ** 2 + n2[1] ** 2) / f2 + n2[2] ** 2;
  const alt2 = (n3[0] ** 2 + n3[1] ** 2) / f2 + n3[2] ** 2;
  const r = Math.sqrt(alt2 / larg2);
  return r > simples * 0.7 && r < simples * 1.4 ? r : simples;
}

const RAIZ2 = Math.SQRT2;
/** Papel A4 fotografado nunca dá 1,414 exato: perto disso, é A4. */
export function ajustarA4(r: number): number {
  const deitado = r < 1;
  const v = deitado ? 1 / r : r;
  const final = v > 1.33 && v < 1.5 ? RAIZ2 : v;
  return deitado ? 1 / final : final;
}

export function escalar(q: Quad, s: number): Quad {
  return q.map((p) => ({ x: p.x * s, y: p.y * s })) as Quad;
}
