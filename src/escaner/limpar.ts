// Endireita a folha (tira a perspectiva) e limpa: papel branco, sem sombra, letra escura.
// Tudo em RGBA, sem DOM: roda no Worker e no Node.
import { homografia, type Quad } from './geometria';

export type Modo = 'cor' | 'cinza' | 'pb';

/** Recorta o quadrilátero da foto num retângulo de larg x alt. */
export function endireitar(foto: Uint8ClampedArray, fw: number, fh: number, q: Quad, larg: number, alt: number): Uint8ClampedArray<ArrayBuffer> {
  const m = homografia(larg, alt, q);
  const s = new Uint8ClampedArray(larg * alt * 4);
  for (let y = 0; y < alt; y++) {
    let k = y * larg * 4;
    for (let x = 0; x < larg; x++, k += 4) {
      const X = x + 0.5;
      const Y = y + 0.5;
      const z = m[6] * X + m[7] * Y + 1;
      let u = (m[0] * X + m[1] * Y + m[2]) / z - 0.5;
      let v = (m[3] * X + m[4] * Y + m[5]) / z - 0.5;
      if (u < 0) u = 0;
      else if (u > fw - 1.001) u = fw - 1.001;
      if (v < 0) v = 0;
      else if (v > fh - 1.001) v = fh - 1.001;
      const ui = u | 0;
      const vi = v | 0;
      const fx = u - ui;
      const fy = v - vi;
      const a = (vi * fw + ui) * 4;
      const b = a + fw * 4;
      const p = (1 - fx) * (1 - fy);
      const r = fx * (1 - fy);
      const t = (1 - fx) * fy;
      const w = fx * fy;
      s[k] = foto[a] * p + foto[a + 4] * r + foto[b] * t + foto[b + 4] * w;
      s[k + 1] = foto[a + 1] * p + foto[a + 5] * r + foto[b + 1] * t + foto[b + 5] * w;
      s[k + 2] = foto[a + 2] * p + foto[a + 6] * r + foto[b + 2] * t + foto[b + 6] * w;
      s[k + 3] = 255;
    }
  }
  return s;
}

/** Mapa da luz sobre o papel, em blocos: a cor que o papel branco teria em cada ponto. */
interface Luz { cols: number; lins: number; bloco: number; r: Float32Array; g: Float32Array; b: Float32Array }

function mapaDeLuz(px: Uint8ClampedArray, w: number, h: number): Luz {
  const bloco = Math.max(4, Math.round(Math.max(w, h) / 150));
  const cols = Math.ceil(w / bloco);
  const lins = Math.ceil(h / bloco);
  const n = cols * lins;
  const canais = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const hist = new Uint16Array(64);
  // em cada bloco, o tom claro (percentil 80): o papel entre as letras
  for (let c = 0; c < 3; c++) {
    for (let j = 0; j < lins; j++) {
      for (let i = 0; i < cols; i++) {
        hist.fill(0);
        let tot = 0;
        const y1 = Math.min(h, (j + 1) * bloco);
        const x1 = Math.min(w, (i + 1) * bloco);
        for (let y = j * bloco; y < y1; y++) for (let x = i * bloco; x < x1; x++) { hist[px[(y * w + x) * 4 + c] >> 2]++; tot++; }
        let falta = tot * 0.2;
        let t = 63;
        while (t > 0 && falta > hist[t]) falta -= hist[t--];
        canais[c][j * cols + i] = t * 4 + 2;
      }
    }
  }
  const [r, g, b] = canais;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = 0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i];

  // cor do papel: média dos blocos mais claros da folha
  const ord = Array.from(lum.keys()).sort((x, y) => lum[y] - lum[x]);
  const claros = ord.slice(Math.floor(n * 0.05), Math.max(1, Math.floor(n * 0.35)));
  let pr = 0, pg = 0, pb = 0;
  for (const i of claros) { const l = lum[i] || 1; pr += r[i] / l; pg += g[i] / l; pb += b[i] / l; }
  pr /= claros.length; pg /= claros.length; pb /= claros.length;

  // papel ou não: perto do mais claro da vizinhança e com a cor do papel. Foto, faixa colorida e
  // letra grossa não são papel: ali a luz vem dos vizinhos, e a cor delas fica como é.
  const viz = Math.max(3, Math.round(Math.max(cols, lins) * 0.07));
  const maxH = new Float32Array(n);
  const max = new Float32Array(n);
  for (let j = 0; j < lins; j++) for (let i = 0; i < cols; i++) {
    let m = 0;
    for (let k = Math.max(0, i - viz); k <= Math.min(cols - 1, i + viz); k++) m = Math.max(m, lum[j * cols + k]);
    maxH[j * cols + i] = m;
  }
  for (let j = 0; j < lins; j++) for (let i = 0; i < cols; i++) {
    let m = 0;
    for (let k = Math.max(0, j - viz); k <= Math.min(lins - 1, j + viz); k++) m = Math.max(m, maxH[k * cols + i]);
    max[j * cols + i] = m;
  }
  const geral = lum[ord[Math.floor(n * 0.1)]];
  const papel = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const l = lum[i] || 1;
    const cor = Math.abs(r[i] / l - pr) + Math.abs(g[i] / l - pg) + Math.abs(b[i] / l - pb);
    papel[i] = lum[i] > max[i] * 0.55 && lum[i] > geral * 0.22 && cor < 0.22 ? 1 : 0;
  }
  // preenche os buracos com a luz dos vizinhos, do raio pequeno ao grande, e alisa
  const saida = [r, g, b].map((v) => preencher(v, papel, cols, lins));
  return { cols, lins, bloco, r: saida[0], g: saida[1], b: saida[2] };
}

function caixa(v: Float32Array, cols: number, lins: number, raio: number): Float32Array {
  const t = new Float32Array(v.length);
  const s = new Float32Array(v.length);
  for (let j = 0; j < lins; j++) for (let i = 0; i < cols; i++) {
    let m = 0;
    for (let k = Math.max(0, i - raio); k <= Math.min(cols - 1, i + raio); k++) m += v[j * cols + k];
    t[j * cols + i] = m;
  }
  for (let j = 0; j < lins; j++) for (let i = 0; i < cols; i++) {
    let m = 0;
    for (let k = Math.max(0, j - raio); k <= Math.min(lins - 1, j + raio); k++) m += t[k * cols + i];
    s[j * cols + i] = m;
  }
  return s;
}

function preencher(v: Float32Array, papel: Float32Array, cols: number, lins: number): Float32Array {
  const cheio = new Float32Array(v.length);
  const feito = new Uint8Array(v.length);
  const vp = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) vp[i] = v[i] * papel[i];
  for (const raio of [1, 3, 7, 15, 40, 200]) {
    const soma = caixa(vp, cols, lins, raio);
    const peso = caixa(papel, cols, lins, raio);
    const precisa = raio === 1 ? 4 : 2;
    let falta = 0;
    for (let i = 0; i < v.length; i++) {
      if (feito[i]) continue;
      if (peso[i] >= precisa) { cheio[i] = soma[i] / peso[i]; feito[i] = 1; } else falta++;
    }
    if (!falta) break;
  }
  for (let i = 0; i < v.length; i++) if (!feito[i]) cheio[i] = 235;
  const um = caixa(new Float32Array(v.length).fill(1), cols, lins, 1);
  const liso = caixa(cheio, cols, lins, 1);
  for (let i = 0; i < liso.length; i++) liso[i] = Math.max(24, liso[i] / um[i]);
  return liso;
}

/** Curva: até PRETO vira preto, de BRANCO para cima vira branco (some a textura do papel). */
const PRETO = 0.2;
const BRANCO = 0.88;
const CURVA = (() => {
  const t = new Uint8ClampedArray(1025);
  for (let i = 0; i <= 1024; i++) {
    const x = (i / 1024) * 1.25;
    t[i] = 255 * Math.pow(Math.max(0, Math.min(1, (x - PRETO) / (BRANCO - PRETO))), 1.35);
  }
  return t;
})();

/** Divide cada ponto pela luz do papel naquele ponto. Devolve por linha, para não guardar tudo de novo. */
function porLinha(luz: Luz, w: number, h: number, cadaLinha: (y: number, r: Float32Array, g: Float32Array, b: Float32Array) => void) {
  const lr = new Float32Array(w);
  const lg = new Float32Array(w);
  const lb = new Float32Array(w);
  const { cols, lins, bloco } = luz;
  for (let y = 0; y < h; y++) {
    const v = Math.max(0, Math.min(lins - 1, (y + 0.5) / bloco - 0.5));
    const j = Math.min(lins - 2 < 0 ? 0 : lins - 2, v | 0);
    const fy = v - j;
    const j2 = Math.min(lins - 1, j + 1);
    for (let x = 0; x < w; x++) {
      const u = Math.max(0, Math.min(cols - 1, (x + 0.5) / bloco - 0.5));
      const i = Math.min(cols - 2 < 0 ? 0 : cols - 2, u | 0);
      const fx = u - i;
      const i2 = Math.min(cols - 1, i + 1);
      const a = j * cols + i, b = j * cols + i2, c = j2 * cols + i, d = j2 * cols + i2;
      const p = (1 - fx) * (1 - fy), q = fx * (1 - fy), s = (1 - fx) * fy, t = fx * fy;
      lr[x] = luz.r[a] * p + luz.r[b] * q + luz.r[c] * s + luz.r[d] * t;
      lg[x] = luz.g[a] * p + luz.g[b] * q + luz.g[c] * s + luz.g[d] * t;
      lb[x] = luz.b[a] * p + luz.b[b] * q + luz.b[c] * s + luz.b[d] * t;
    }
    cadaLinha(y, lr, lg, lb);
  }
}

/** Colorido limpo ou cinza: muda a própria imagem. */
export function limpar(px: Uint8ClampedArray, w: number, h: number, modo: 'cor' | 'cinza') {
  const luz = mapaDeLuz(px, w, h);
  const E = 1024 / 1.25;
  porLinha(luz, w, h, (y, r, g, b) => {
    let k = y * w * 4;
    for (let x = 0; x < w; x++, k += 4) {
      const a = px[k] / r[x];
      const c = px[k + 1] / g[x];
      const d = px[k + 2] / b[x];
      if (modo === 'cor') {
        px[k] = CURVA[Math.min(1024, (a * E) | 0)];
        px[k + 1] = CURVA[Math.min(1024, (c * E) | 0)];
        px[k + 2] = CURVA[Math.min(1024, (d * E) | 0)];
      } else {
        px[k] = px[k + 1] = px[k + 2] = CURVA[Math.min(1024, ((0.299 * a + 0.587 * c + 0.114 * d) * E) | 0)];
      }
    }
  });
}

/** Preto e branco puro, 1 bit por ponto (1 = branco), linhas alinhadas em byte: do jeito que o PDF guarda. */
export function pretoEBranco(px: Uint8ClampedArray, w: number, h: number): Uint8Array<ArrayBuffer> {
  const luz = mapaDeLuz(px, w, h);
  const v = new Uint8Array(w * h); // 200 = papel
  porLinha(luz, w, h, (y, r, g, b) => {
    let k = y * w * 4;
    for (let x = 0; x < w; x++, k += 4) {
      v[y * w + x] = Math.min(255, 200 * (0.299 * (px[k] / r[x]) + 0.587 * (px[k + 1] / g[x]) + 0.114 * (px[k + 2] / b[x])));
    }
  });
  // média em volta de cada ponto, com soma acumulada por coluna
  const raio = Math.max(6, Math.round(Math.max(w, h) / 110));
  const bytes = Math.ceil(w / 8);
  const preto = new Uint8Array(w * h);
  const col = new Int32Array(w);
  for (let y = 0; y < Math.min(raio, h); y++) for (let x = 0; x < w; x++) col[x] += v[y * w + x];
  for (let y = 0; y < h; y++) {
    if (y + raio < h) for (let x = 0; x < w; x++) col[x] += v[(y + raio) * w + x];
    if (y - raio - 1 >= 0) for (let x = 0; x < w; x++) col[x] -= v[(y - raio - 1) * w + x];
    const linhas = Math.min(h - 1, y + raio) - Math.max(0, y - raio) + 1;
    let soma = 0;
    for (let x = 0; x < Math.min(raio, w); x++) soma += col[x];
    for (let x = 0; x < w; x++) {
      if (x + raio < w) soma += col[x + raio];
      if (x - raio - 1 >= 0) soma -= col[x - raio - 1];
      const n = linhas * (Math.min(w - 1, x + raio) - Math.max(0, x - raio) + 1);
      const p = v[y * w + x];
      if (p < 84 || (p < 164 && p < (soma / n) * 0.87)) preto[y * w + x] = 1;
    }
  }
  const saida = new Uint8Array(bytes * h).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!preto[i]) continue;
      // ponto preto sozinho é sujeira da foto
      const e = x > 0, d = x < w - 1, c = y > 0, b = y < h - 1;
      const vizinhos =
        (e ? preto[i - 1] : 0) + (d ? preto[i + 1] : 0) + (c ? preto[i - w] : 0) + (b ? preto[i + w] : 0) +
        (e && c ? preto[i - w - 1] : 0) + (d && c ? preto[i - w + 1] : 0) + (e && b ? preto[i + w - 1] : 0) + (d && b ? preto[i + w + 1] : 0);
      if (vizinhos < 2) continue;
      saida[y * bytes + (x >> 3)] &= ~(0x80 >> (x & 7));
    }
  }
  return saida;
}
