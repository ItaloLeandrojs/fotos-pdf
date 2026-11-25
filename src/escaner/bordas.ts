// Acha as bordas da folha numa foto. Recebe a foto já reduzida (lado maior perto de LADO_BUSCA), em RGBA.
// Passos: três canais (brilho, e duas cores), gradiente, retas por votação (Hough), monta os quadriláteros
// possíveis e fica com aquele cujos quatro lados estão mais "desenhados" na foto.
import { area, dist, ordenar, valido, type Ponto, type Quad } from './geometria';

export const LADO_BUSCA = 480;

export interface Achado {
  quad: Quad;
  confianca: number; // 0 a 1
}

interface Reta { t: number; r: number; votos: number } // x cos t + y sen t = r

/** Passa uma conta de janela por todas as linhas e depois por todas as colunas. */
function porLinhasEColunas(v: Float32Array, w: number, h: number, conta: (e: Float32Array, s: Float32Array, n: number) => void): Float32Array {
  const saida = new Float32Array(w * h);
  let e = new Float32Array(w);
  let s = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    e.set(v.subarray(y * w, y * w + w));
    conta(e, s, w);
    saida.set(s, y * w);
  }
  e = new Float32Array(h);
  s = new Float32Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) e[y] = saida[y * w + x];
    conta(e, s, h);
    for (let y = 0; y < h; y++) saida[y * w + x] = s[y];
  }
  return saida;
}

/** Desfoque de caixa, 2 passadas (parecido com gaussiano), com soma corrente. */
function desfocar(v: Float32Array, w: number, h: number, raio: number): Float32Array {
  const media = (e: Float32Array, s: Float32Array, n: number) => {
    let soma = 0;
    let q = 0;
    for (let k = 0; k < Math.min(raio, n); k++) { soma += e[k]; q++; }
    for (let i = 0; i < n; i++) {
      if (i + raio < n) { soma += e[i + raio]; q++; }
      if (i - raio - 1 >= 0) { soma -= e[i - raio - 1]; q--; }
      s[i] = soma / q;
    }
  };
  return porLinhasEColunas(porLinhasEColunas(v, w, h, media), w, h, media);
}

/** Fechamento: máximo e depois mínimo numa janela quadrada. Apaga o texto escuro do papel. */
function fechar(v: Float32Array, w: number, h: number, raio: number): Float32Array {
  const maximo = (e: Float32Array, s: Float32Array, n: number) => {
    for (let i = 0; i < n; i++) {
      let m = e[i];
      for (let k = i - raio < 0 ? 0 : i - raio, f = i + raio < n ? i + raio : n - 1; k <= f; k++) if (e[k] > m) m = e[k];
      s[i] = m;
    }
  };
  const minimo = (e: Float32Array, s: Float32Array, n: number) => {
    for (let i = 0; i < n; i++) {
      let m = e[i];
      for (let k = i - raio < 0 ? 0 : i - raio, f = i + raio < n ? i + raio : n - 1; k <= f; k++) if (e[k] < m) m = e[k];
      s[i] = m;
    }
  };
  return porLinhasEColunas(porLinhasEColunas(v, w, h, maximo), w, h, minimo);
}

interface Campo { mag: Float32Array; gx: Float32Array; gy: Float32Array }

function gradiente(v: Float32Array, w: number, h: number): Campo {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = v[i - w - 1], b = v[i - w], c = v[i - w + 1], d = v[i - 1], e = v[i + 1], f = v[i + w - 1], g = v[i + w], k = v[i + w + 1];
      const sx = (c + 2 * e + k - a - 2 * d - f) / 8;
      const sy = (f + 2 * g + k - a - 2 * b - c) / 8;
      gx[i] = sx;
      gy[i] = sy;
      mag[i] = Math.sqrt(sx * sx + sy * sy);
    }
  }
  return { mag, gx, gy };
}

const ANGULOS = 180;
const COS = Float64Array.from({ length: ANGULOS }, (_, i) => Math.cos((i * Math.PI) / ANGULOS));
const SEN = Float64Array.from({ length: ANGULOS }, (_, i) => Math.sin((i * Math.PI) / ANGULOS));

/** Retas mais fortes do campo, por votação. */
function retas(c: Campo, w: number, h: number, quantas: number): Reta[] {
  const diag = Math.ceil(Math.hypot(w, h));
  const largura = 2 * diag + 1;
  const votos = new Float32Array(ANGULOS * largura);
  // limiar pelo próprio campo: pega os 12% mais fortes, com um piso contra ruído
  const amostra: number[] = [];
  for (let i = 0; i < c.mag.length; i += 7) amostra.push(c.mag[i]);
  amostra.sort((a, b) => a - b);
  const limiar = Math.max(1.2, amostra[Math.floor(amostra.length * 0.88)]);
  const teto = Math.max(limiar * 2, amostra[Math.floor(amostra.length * 0.97)]);
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      const m = c.mag[i];
      if (m < limiar) continue;
      // só a crista da borda vota (pico na direção do gradiente)
      const nx = c.gx[i] / m;
      const ny = c.gy[i] / m;
      const ax = Math.round(nx);
      const ay = Math.round(ny);
      if (c.mag[i + ax + ay * w] > m || c.mag[i - ax - ay * w] > m) continue;
      let ang = (Math.atan2(ny, nx) * ANGULOS) / Math.PI;
      ang = ((Math.round(ang) % ANGULOS) + ANGULOS) % ANGULOS;
      const peso = Math.min(m, teto) / teto;
      for (let k = -4; k <= 4; k++) {
        const t = (ang + k + ANGULOS) % ANGULOS;
        const r = Math.round(x * COS[t] + y * SEN[t]) + diag;
        votos[t * largura + r] += peso * (1 - Math.abs(k) / 6);
      }
    }
  }
  // soma com os vizinhos de distância (a borda nunca cai numa reta só)
  const suave = new Float32Array(votos.length);
  for (let i = 1; i < votos.length - 1; i++) suave[i] = votos[i] + 0.6 * (votos[i - 1] + votos[i + 1]);
  const achadas: Reta[] = [];
  const minimo = Math.min(w, h) * 0.08;
  const picos: number[] = [];
  for (let i = 1; i < suave.length - 1; i++) if (suave[i] > minimo && suave[i] >= suave[i - 1] && suave[i] >= suave[i + 1]) picos.push(i);
  picos.sort((a, b) => suave[b] - suave[a]);
  for (const i of picos) {
    const t = Math.floor(i / largura);
    const r = (i % largura) - diag;
    const perto = achadas.some((o) => {
      let dt = Math.abs(o.t - t);
      let dr = Math.abs(o.r - r);
      if (dt > ANGULOS / 2) { dt = ANGULOS - dt; dr = Math.abs(o.r + r); }
      return dt <= 6 && dr <= 7;
    });
    if (perto) continue;
    achadas.push({ t, r, votos: suave[i] });
    if (achadas.length >= quantas) break;
  }
  return achadas;
}

function cruzar(a: { c: number; s: number; r: number }, b: { c: number; s: number; r: number }): Ponto | null {
  const det = a.c * b.s - b.c * a.s;
  if (Math.abs(det) < 0.25) return null;
  return { x: (a.r * b.s - b.r * a.s) / det, y: (a.c * b.r - b.c * a.r) / det };
}

/** Junta os canais num campo só: em cada ponto vale o canal com a borda mais forte, já na escala dele. */
function juntarCampos(campos: Campo[], escalas: number[], n: number): Campo {
  const u: Campo = { mag: new Float32Array(n), gx: new Float32Array(n), gy: new Float32Array(n) };
  for (let f = 0; f < campos.length; f++) {
    const c = campos[f];
    for (let i = 0; i < n; i++) {
      const m = c.mag[i] / escalas[f];
      if (m > u.mag[i]) {
        u.mag[i] = m;
        u.gx[i] = c.gx[i] / escalas[f];
        u.gy[i] = c.gy[i] / escalas[f];
      }
    }
  }
  return u;
}

/** Quanto um lado está desenhado: fração do lado com borda na direção certa. */
const BORDA_DA_FOTO = 0.5;

function apoio(p: Ponto, q: Ponto, u: Campo, w: number, h: number): number {
  // lado em cima da borda da foto: a folha passou da foto (celular perto do papel). Vale meio apoio.
  const b = 2.5;
  if ((p.x <= b && q.x <= b) || (p.y <= b && q.y <= b) || (p.x >= w - 1 - b && q.x >= w - 1 - b) || (p.y >= h - 1 - b && q.y >= h - 1 - b)) return BORDA_DA_FOTO;
  const comp = dist(p, q);
  const n = Math.max(12, Math.round(comp / 4));
  const nx = -(q.y - p.y) / comp;
  const ny = (q.x - p.x) / comp;
  let soma = 0;
  for (let k = 1; k < n; k++) {
    const x = p.x + ((q.x - p.x) * k) / n;
    const y = p.y + ((q.y - p.y) * k) / n;
    if (x < 3 || y < 3 || x > w - 4 || y > h - 4) continue; // fora da foto não conta como borda
    let melhor = 0;
    for (let d = -2; d <= 2; d++) {
      const i = Math.round(y + ny * d) * w + Math.round(x + nx * d);
      const alinhado = Math.abs(u.gx[i] * nx + u.gy[i] * ny);
      if (alinhado <= melhor || Math.abs(u.gx[i] * ny - u.gy[i] * nx) > alinhado * 0.6) continue;
      melhor = alinhado;
    }
    soma += melhor < 1 ? melhor : 1;
  }
  return soma / (n - 1);
}

/** Ajusta cada lado aos pontos de borda mais fortes por perto e refaz os cantos. */
function refinar(q: Quad, campos: Campo[], escalas: number[], w: number, h: number, raio: number): Quad {
  const linhas = q.map((p, i) => {
    const r = q[(i + 1) % 4];
    const comp = dist(p, r);
    const nx = -(r.y - p.y) / comp;
    const ny = (r.x - p.x) / comp;
    const pts: { x: number; y: number; m: number }[] = [];
    const n = Math.max(20, Math.round(comp / 3));
    for (let k = Math.ceil(n * 0.04); k <= n * 0.96; k++) {
      const x = p.x + ((r.x - p.x) * k) / n;
      const y = p.y + ((r.y - p.y) * k) / n;
      let melhor = 0.18;
      let onde: { x: number; y: number; m: number } | null = null;
      for (let d = -raio; d <= raio; d += 0.5) {
        const px = x + nx * d;
        const py = y + ny * d;
        const xi = Math.floor(px);
        const yi = Math.floor(py);
        if (xi < 1 || yi < 1 || xi > w - 3 || yi > h - 3) continue;
        const fx = px - xi;
        const fy = py - yi;
        for (let f = 0; f < campos.length; f++) {
          const { gx, gy } = campos[f];
          const i0 = yi * w + xi;
          const le = (v: Float32Array) => (v[i0] * (1 - fx) + v[i0 + 1] * fx) * (1 - fy) + (v[i0 + w] * (1 - fx) + v[i0 + w + 1] * fx) * fy;
          const g = Math.min(1.5, Math.abs(le(gx) * nx + le(gy) * ny) / escalas[f]) * (1 - (0.35 * Math.abs(d)) / raio);
          if (g > melhor) { melhor = g; onde = { x: px, y: py, m: g }; }
        }
      }
      if (onde) pts.push(onde);
    }
    if (pts.length < n * 0.3) return null;
    // reta por mínimos quadrados, tirando os pontos que fogem (texto, dedo)
    let usados = pts;
    let reta = { c: nx, s: ny, r: nx * p.x + ny * p.y };
    for (let passo = 0; passo < 4; passo++) {
      let sm = 0, mx = 0, my = 0;
      for (const o of usados) { sm += o.m; mx += o.x * o.m; my += o.y * o.m; }
      mx /= sm;
      my /= sm;
      let xx = 0, xy = 0, yy = 0;
      for (const o of usados) { const dx = o.x - mx, dy = o.y - my; xx += o.m * dx * dx; xy += o.m * dx * dy; yy += o.m * dy * dy; }
      const ang = 0.5 * Math.atan2(2 * xy, xx - yy) + Math.PI / 2;
      let c = Math.cos(ang), s = Math.sin(ang);
      if (c * nx + s * ny < 0) { c = -c; s = -s; }
      if (c * nx + s * ny < 0.985) return null; // girou demais: não é o mesmo lado
      reta = { c, s, r: c * mx + s * my };
      const erros = usados.map((o) => Math.abs(o.x * c + o.y * s - reta.r)).sort((a, b) => a - b);
      const corte = Math.max(0.8, 2.2 * erros[Math.floor(erros.length / 2)]);
      const novos = pts.filter((o) => Math.abs(o.x * c + o.y * s - reta.r) <= corte);
      if (novos.length < n * 0.25) break;
      usados = novos;
    }
    return reta;
  });
  const base = q.map((p, i) => {
    const r = q[(i + 1) % 4];
    const comp = dist(p, r);
    const c = -(r.y - p.y) / comp;
    const s = (r.x - p.x) / comp;
    return linhas[i] ?? { c, s, r: c * p.x + s * p.y };
  });
  const cantos = [0, 1, 2, 3].map((i) => cruzar(base[(i + 3) % 4], base[i]));
  if (cantos.some((c, i) => !c || dist(c, q[i]) > raio * 3)) return q;
  return cantos as Quad;
}

/** Retas do contorno da maior mancha clara: ajuda quando o papel quase some na mesa. */
function manchaClara(v: Float32Array, w: number, h: number): Quad | null {
  const hist = new Float64Array(256);
  for (let i = 0; i < v.length; i++) hist[Math.max(0, Math.min(255, v[i] | 0))]++;
  let total = 0;
  for (let i = 0; i < 256; i++) total += i * hist[i];
  let nb = 0, sb = 0, melhor = -1, corte = 128;
  for (let i = 0; i < 255; i++) {
    nb += hist[i];
    sb += i * hist[i];
    const nf = v.length - nb;
    if (!nb || !nf) continue;
    const d = sb / nb - (total - sb) / nf;
    const e = nb * nf * d * d;
    if (e > melhor) { melhor = e; corte = i; }
  }
  const visto = new Uint8Array(w * h);
  let maior: number[] = [];
  for (let i = 0; i < v.length; i++) {
    if (visto[i] || v[i] <= corte) continue;
    const pilha = [i];
    visto[i] = 1;
    const parte: number[] = [];
    while (pilha.length) {
      const k = pilha.pop() as number;
      parte.push(k);
      const x = k % w;
      if (x > 0 && !visto[k - 1] && v[k - 1] > corte) { visto[k - 1] = 1; pilha.push(k - 1); }
      if (x < w - 1 && !visto[k + 1] && v[k + 1] > corte) { visto[k + 1] = 1; pilha.push(k + 1); }
      if (k >= w && !visto[k - w] && v[k - w] > corte) { visto[k - w] = 1; pilha.push(k - w); }
      if (k < w * (h - 1) && !visto[k + w] && v[k + w] > corte) { visto[k + w] = 1; pilha.push(k + w); }
    }
    if (parte.length > maior.length) maior = parte;
  }
  if (maior.length < w * h * 0.1) return null;
  // os quatro pontos extremos nas diagonais (e, se a folha estiver bem girada, nos eixos)
  const ext = (f: (x: number, y: number) => number) => {
    let m = -Infinity;
    let o = { x: 0, y: 0 };
    for (const k of maior) {
      const x = k % w;
      const y = (k / w) | 0;
      const val = f(x, y);
      if (val > m) { m = val; o = { x, y }; }
    }
    return o;
  };
  const diag = ordenar([ext((x, y) => -x - y), ext((x, y) => x - y), ext((x, y) => x + y), ext((x, y) => y - x)]);
  return valido(diag) ? diag : null;
}

export function acharBordas(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Achado | null {
  const n = w * h;
  const luz = new Float32Array(n);
  const ca = new Float32Array(n);
  const cb = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    luz[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    ca[i] = r - g;
    cb[i] = 0.5 * (r + g) - b;
  }
  const raio = Math.max(2, Math.round(Math.max(w, h) / 80));
  const lisa = desfocar(luz, w, h, 1);
  const semTexto = desfocar(fechar(luz, w, h, raio), w, h, 1);
  const campos = [
    gradiente(lisa, w, h),
    gradiente(semTexto, w, h),
    gradiente(desfocar(ca, w, h, 2), w, h),
    gradiente(desfocar(cb, w, h, 2), w, h),
  ];
  // quanto de gradiente vale "borda inteira" em cada canal: relativo ao que existe nesta foto
  const escalas = campos.map((c, i) => {
    const a: number[] = [];
    for (let k = 0; k < c.mag.length; k += 5) a.push(c.mag[k]);
    a.sort((x, y) => x - y);
    const ruido = a[Math.floor(a.length * 0.5)];
    const forte = a[Math.floor(a.length * 0.97)];
    const piso = i < 2 ? 3 : 2.2;
    return Math.max(piso, ruido * 2.5, Math.min(forte * 0.5, i < 2 ? 9 : 6));
  });

  const unico = juntarCampos(campos, escalas, n);

  const todas: { c: number; s: number; r: number; t: number; votos: number }[] = [];
  const juntar = (lista: Reta[]) => {
    for (const x of lista) {
      const repetida = todas.some((o) => {
        let dt = Math.abs(o.t - x.t);
        let dr = Math.abs(o.r - x.r);
        if (dt > 90) { dt = 180 - dt; dr = Math.abs(o.r + x.r); }
        return dt <= 2 && dr <= 3;
      });
      if (!repetida) todas.push({ c: COS[x.t], s: SEN[x.t], r: x.r, t: x.t, votos: x.votos });
    }
  };
  juntar(retas(campos[1], w, h, 18));
  juntar(retas(campos[0], w, h, 16));
  juntar(retas(campos[2], w, h, 8));
  juntar(retas(campos[3], w, h, 8));

  // as bordas da própria foto também valem como lado
  const forca = (x: { votos: number }, y: { votos: number }) => y.votos - x.votos;
  const deitadas = todas.filter((l) => Math.abs(l.s) >= 0.6).sort(forca).slice(0, 18); // normal quase vertical = reta quase deitada
  const empe = todas.filter((l) => Math.abs(l.c) >= 0.6).sort(forca).slice(0, 18);
  deitadas.push({ c: 0, s: 1, r: 0, t: 90, votos: 0 }, { c: 0, s: 1, r: h - 1, t: 90, votos: 0 });
  empe.push({ c: 1, s: 0, r: 0, t: 0, votos: 0 }, { c: 1, s: 0, r: w - 1, t: 0, votos: 0 });
  const folga = 0.06 * Math.max(w, h);
  const dentro = (p: Ponto | null) => !!p && p.x > -folga && p.y > -folga && p.x < w + folga && p.y < h + folga;
  const meio = (l: { c: number; s: number; r: number }, vertical: boolean) =>
    vertical ? (l.r - (h / 2) * l.s) / l.c : (l.r - (w / 2) * l.c) / l.s;

  /** Papel por dentro costuma ser mais claro e parecido; mede o salto entre dentro e fora de cada lado. */
  const salto = (q: Quad) => {
    const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
    const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
    let soma = 0;
    let lados = 0;
    for (let i = 0; i < 4; i++) {
      const p = q[i];
      const r = q[(i + 1) % 4];
      const comp = dist(p, r);
      let nx = -(r.y - p.y) / comp;
      let ny = (r.x - p.x) / comp;
      if ((cx - p.x) * nx + (cy - p.y) * ny < 0) { nx = -nx; ny = -ny; }
      let dif = 0;
      let k = 0;
      for (let t = 0.08; t < 0.93; t += 0.04) {
        const x = p.x + (r.x - p.x) * t;
        const y = p.y + (r.y - p.y) * t;
        const d = 5;
        const xi = Math.round(x + nx * d), yi = Math.round(y + ny * d), xo = Math.round(x - nx * d), yo = Math.round(y - ny * d);
        if (xi < 0 || yi < 0 || xo < 0 || yo < 0 || xi >= w || yi >= h || xo >= w || yo >= h) continue;
        const a = yi * w + xi, b = yo * w + xo;
        dif += Math.max(-1, Math.min(1, (semTexto[a] - semTexto[b]) / 18));
        k++;
      }
      if (k) { soma += dif / k; lados++; }
    }
    return lados ? soma / lados : 0;
  };

  const darNota = (lados: number[], q: Quad) => {
    const l = [...lados].sort((x, y) => x - y);
    const media = (l[0] + l[1] + l[2] + l[3]) / 4;
    return 0.5 * media + 0.25 * l[0] + 0.1 * l[1] + 0.03 * salto(q) + 0.4 * Math.min(1, area(q) / n / 0.8);
  };
  let melhores: { q: Quad; nota: number }[] = [];
  const guardar = (q: Quad, lados: number[]) => {
    if (valido(q)) melhores.push({ q, nota: darNota(lados, q) });
  };

  // cruzamentos e apoio de cada trecho de reta entre dois cruzamentos, calculados uma vez só
  const D = deitadas.length;
  const E = empe.length;
  const nos: (Ponto | null)[] = [];
  for (const d of deitadas) for (const e of empe) { const p = cruzar(d, e); nos.push(dentro(p) ? p : null); }
  const trechoD = new Float32Array(D * E * E).fill(-1);
  const trechoE = new Float32Array(E * D * D).fill(-1);
  const medir = (memo: Float32Array, k: number, p: Ponto, q: Ponto) => (memo[k] < 0 ? (memo[k] = apoio(p, q, unico, w, h)) : memo[k]);
  const posD = deitadas.map((l) => meio(l, false));
  const posE = empe.map((l) => meio(l, true));
  let corte = 0;
  for (let i = 0; i < D; i++) {
    for (let j = 0; j < D; j++) {
      if (posD[j] - posD[i] < h * 0.18) continue; // i em cima, j embaixo
      for (let k = 0; k < E; k++) {
        const p0 = nos[i * E + k];
        const p3 = nos[j * E + k];
        if (!p0 || !p3) continue;
        const esq = medir(trechoE, k * D * D + i * D + j, p0, p3);
        if (esq < 0.2) continue;
        for (let m = 0; m < E; m++) {
          if (posE[m] - posE[k] < w * 0.12) continue; // k na esquerda, m na direita
          const p1 = nos[i * E + m];
          const p2 = nos[j * E + m];
          if (!p1 || !p2) continue;
          const q: Quad = [p0, p1, p2, p3];
          const ar = area(q) / n;
          if (ar < 0.1) continue;
          // teto da nota com o que falta medir valendo 1: se nem assim alcança, pula
          const areaNota = 0.4 * Math.min(1, ar / 0.8) + 0.03;
          const dir = medir(trechoE, m * D * D + i * D + j, p1, p2);
          if (dir < 0.2 || 0.5 * ((esq + dir + 2) / 4) + 0.25 * Math.min(esq, dir) + 0.1 * Math.max(esq, dir) + areaNota < corte) continue;
          const cima = medir(trechoD, i * E * E + k * E + m, p0, p1);
          if (cima < 0.2) continue;
          const baixo = medir(trechoD, j * E * E + k * E + m, p3, p2);
          const l = [esq, dir, cima, baixo].sort((x, y) => x - y);
          const teto = (0.5 * (l[0] + l[1] + l[2] + l[3])) / 4 + 0.25 * l[0] + 0.1 * l[1] + areaNota;
          if (l[0] < 0.12 || teto < corte) continue;
          guardar(q, l);
          if (melhores.length > 60) {
            melhores.sort((x, y) => y.nota - x.nota);
            melhores.length = 12;
            corte = melhores[11].nota;
          }
        }
      }
    }
  }
  const mancha = manchaClara(semTexto, w, h);
  if (mancha && area(mancha) / n >= 0.1) guardar(mancha, [0, 1, 2, 3].map((i) => apoio(mancha[i], mancha[(i + 1) % 4], unico, w, h)));
  if (!melhores.length) return null;
  melhores.sort((a, b) => b.nota - a.nota);
  melhores = melhores.slice(0, 6);

  // refina os melhores e escolhe de novo, agora com o lado no lugar exato
  const prontos = melhores.map((m) => {
    const r = refinar(m.q, campos, escalas, w, h, 4);
    const q = valido(r) ? r : m.q;
    const lados = [0, 1, 2, 3].map((i) => apoio(q[i], q[(i + 1) % 4], unico, w, h));
    return { q, nota: darNota(lados, q), min: Math.min(...lados) };
  });
  prontos.sort((a, b) => b.nota - a.nota);
  const final = prontos[0];
  const longe = (a: Quad, b: Quad) => Math.max(...a.map((p, i) => dist(p, b[i]))) / Math.max(w, h);
  // outro quadrilátero bem diferente quase empatado: melhor pedir para a pessoa conferir
  const rival = prontos.find((o) => longe(o.q, final.q) > 0.025);
  const folgaRival = rival ? final.nota - rival.nota : 1;
  const preso = final.q.map((p) => ({ x: Math.max(0, Math.min(w, p.x)), y: Math.max(0, Math.min(h, p.y)) })) as Quad;
  let confianca = Math.min(1, final.min / 0.75) * Math.min(1, 0.3 + folgaRival / 0.06);
  // três ou quatro lados na borda da foto: não achou a folha de verdade, só a foto
  const naBorda = final.q.filter((p, i) => {
    const r = final.q[(i + 1) % 4];
    return (p.x <= 3 && r.x <= 3) || (p.y <= 3 && r.y <= 3) || (p.x >= w - 4 && r.x >= w - 4) || (p.y >= h - 4 && r.y >= h - 4);
  }).length;
  if (naBorda >= 3) confianca = Math.min(confianca, 0.3);
  return { quad: ordenar(preso), confianca };
}
