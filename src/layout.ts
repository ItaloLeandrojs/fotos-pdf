// Como as fotos ocupam as folhas A4 e de que tamanho, em pixels, cada uma precisa ser.
// Tudo em pontos de PDF (1 pt = 1/72 polegada). Sem DOM: dá para testar no Node.

export type PorPagina = 1 | 2 | 4;
export type Qualidade = 'menor' | 'equilibrado' | 'maxima';

export const A4 = { larg: 595.28, alt: 841.89 };
export const MARGEM = 28; // cerca de 1 cm
export const VAO = 14; // espaço entre fotos na mesma folha

/** Pontos por polegada que a foto precisa ter na folha, e qualidade do JPEG. */
export const NIVEIS: Record<Qualidade, { dpi: number | null; q: number }> = {
  menor: { dpi: 150, q: 0.72 },
  equilibrado: { dpi: 200, q: 0.8 },
  maxima: { dpi: null, q: 0.92 }, // sem reduzir o tamanho
};

export interface Caixa { x: number; y: number; larg: number; alt: number }
export interface Folha { larg: number; alt: number; caixas: Caixa[] }

/** Folha para um grupo de fotos. Com 1 por folha, a folha deita quando a foto é deitada. */
export function folha(porPagina: PorPagina, fotoDeitada = false): Folha {
  if (porPagina === 1) {
    const [larg, alt] = fotoDeitada ? [A4.alt, A4.larg] : [A4.larg, A4.alt];
    return { larg, alt, caixas: [{ x: MARGEM, y: MARGEM, larg: larg - 2 * MARGEM, alt: alt - 2 * MARGEM }] };
  }
  const { larg, alt } = A4;
  const util = { larg: larg - 2 * MARGEM, alt: alt - 2 * MARGEM };
  if (porPagina === 2) {
    const h = (util.alt - VAO) / 2;
    // y do PDF cresce para cima: a primeira foto fica na caixa de cima
    return {
      larg, alt,
      caixas: [
        { x: MARGEM, y: MARGEM + h + VAO, larg: util.larg, alt: h },
        { x: MARGEM, y: MARGEM, larg: util.larg, alt: h },
      ],
    };
  }
  const w = (util.larg - VAO) / 2;
  const h = (util.alt - VAO) / 2;
  const cima = MARGEM + h + VAO;
  const dir = MARGEM + w + VAO;
  return {
    larg, alt,
    caixas: [
      { x: MARGEM, y: cima, larg: w, alt: h },
      { x: dir, y: cima, larg: w, alt: h },
      { x: MARGEM, y: MARGEM, larg: w, alt: h },
      { x: dir, y: MARGEM, larg: w, alt: h },
    ],
  };
}

/** Encaixa a foto (larg × alt em pixels) dentro da caixa, centralizada, sem cortar. */
export function encaixar(caixa: Caixa, larg: number, alt: number): Caixa {
  const esc = Math.min(caixa.larg / larg, caixa.alt / alt);
  const w = larg * esc;
  const h = alt * esc;
  return { x: caixa.x + (caixa.larg - w) / 2, y: caixa.y + (caixa.alt - h) / 2, larg: w, alt: h };
}

/**
 * Tamanho em pixels para a foto ficar nítida na caixa, sem passar do original.
 * Com dpi nulo (qualidade máxima) fica o tamanho original.
 */
export function pixelsAlvo(caixa: Caixa, larg: number, alt: number, dpi: number | null): { larg: number; alt: number } {
  if (dpi === null) return { larg, alt };
  const naFolha = encaixar(caixa, larg, alt);
  let esc = Math.min(1, (naFolha.larg / 72) * dpi / larg);
  // piso: o lado maior nunca fica abaixo de LADO_MINIMO, para o carimbo de data e coordenada continuar legível
  esc = Math.min(1, Math.max(esc, LADO_MINIMO / Math.max(larg, alt)));
  return { larg: Math.max(1, Math.round(larg * esc)), alt: Math.max(1, Math.round(alt * esc)) };
}

export const LADO_MINIMO = 1000;
export const MAX_PIXELS = 16_000_000; // abaixo do limite de canvas do iPhone (~16,7 MP)

/** Reduz para caber em MAX_PIXELS, mantendo a proporção. */
export function limitarPixels(m: { larg: number; alt: number }): { larg: number; alt: number } {
  const total = m.larg * m.alt;
  if (total <= MAX_PIXELS) return m;
  const esc = Math.sqrt(MAX_PIXELS / total);
  return { larg: Math.floor(m.larg * esc), alt: Math.floor(m.alt * esc) };
}

/** Separa a lista em grupos de N (uma folha por grupo). */
export function agrupar<T>(itens: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < itens.length; i += n) out.push(itens.slice(i, i + n));
  return out;
}

/** 1536000 → "1,5 MB" */
export function tamanhoTexto(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toLocaleString('pt-BR', { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB`;
}

/** Nome de arquivo seguro, sempre terminando em .pdf */
export function nomeArquivo(nome: string, hoje = new Date()): string {
  const limpo = nome.trim().replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  if (limpo) return `${limpo}.pdf`;
  const d = hoje;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `fotos ${dd}-${mm}-${d.getFullYear()}.pdf`;
}
