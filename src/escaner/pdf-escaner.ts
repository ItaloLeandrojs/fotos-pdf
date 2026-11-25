// Monta o PDF das folhas escaneadas: uma folha A4 por página.
import { concatTransformationMatrix, drawObject, PDFDocument, popGraphicsState, pushGraphicsState } from 'pdf-lib';

export interface FolhaPronta {
  tipo: 'jpg' | 'bits'; // bits: preto e branco, 1 bit por ponto, 1 = branco
  bytes: Uint8Array;
  larg: number; // pixels
  alt: number;
  razao: number; // altura / largura do papel
}

const A4 = { larg: 595.28, alt: 841.89 };
const MARGEM = 28;

/** Onde a folha fica na página: A4 ocupa a página inteira; outro tamanho (nota, RG, recibo) fica centralizado. */
export function lugarNaPagina(razao: number): { pagina: [number, number]; x: number; y: number; larg: number; alt: number } {
  const emPe = razao >= 1;
  const [pl, pa] = emPe ? [A4.larg, A4.alt] : [A4.alt, A4.larg];
  const a4 = Math.abs((emPe ? razao : 1 / razao) - Math.SQRT2) < 1e-6;
  if (a4) return { pagina: [pl, pa], x: 0, y: 0, larg: pl, alt: pa };
  const cl = pl - 2 * MARGEM;
  const ca = pa - 2 * MARGEM;
  const larg = Math.min(cl, ca / razao);
  const alt = larg * razao;
  return { pagina: [pl, pa], x: (pl - larg) / 2, y: (pa - alt) / 2, larg, alt };
}

export async function montarPdf(folhas: FolhaPronta[], titulo: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(titulo);
  doc.setCreator('Fotos em PDF');
  doc.setProducer('Fotos em PDF (pdf-lib)');
  for (const f of folhas) {
    const l = lugarNaPagina(f.razao);
    const pagina = doc.addPage(l.pagina);
    if (f.tipo === 'jpg') {
      const img = await doc.embedJpg(f.bytes);
      pagina.drawImage(img, { x: l.x, y: l.y, width: l.larg, height: l.alt });
      continue;
    }
    const imagem = doc.context.flateStream(f.bytes, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: f.larg,
      Height: f.alt,
      ColorSpace: 'DeviceGray',
      BitsPerComponent: 1,
    });
    const nome = pagina.node.newXObject('Folha', doc.context.register(imagem));
    pagina.pushOperators(pushGraphicsState(), concatTransformationMatrix(l.larg, 0, 0, l.alt, l.x, l.y), drawObject(nome), popGraphicsState());
  }
  return doc.save();
}
