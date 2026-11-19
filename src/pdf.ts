// Monta o PDF: uma folha A4 por grupo de fotos, cada foto já no tamanho certo.
import { PDFDocument } from 'pdf-lib';
import { agrupar, encaixar, folha, NIVEIS, pixelsAlvo, type PorPagina, type Qualidade } from './layout';
import { jpegParaPdf, medidaFinal, type Foto } from './imagem';

export async function gerarPdf(
  fotos: Foto[],
  porPagina: PorPagina,
  qualidade: Qualidade,
  titulo: string,
  aoAvancar: (feitas: number, total: number) => void,
): Promise<{ bytes: Uint8Array; puladas: string[]; folhas: number }> {
  const doc = await PDFDocument.create();
  doc.setTitle(titulo);
  doc.setCreator('Fotos em PDF');
  doc.setProducer('Fotos em PDF (pdf-lib)');
  const nivel = NIVEIS[qualidade];
  const puladas: string[] = [];
  let feitas = 0;
  aoAvancar(0, fotos.length);

  // primeiro prepara cada foto; uma foto com problema fica de fora sem derrubar o PDF
  const prontas: { foto: Foto; bytes: Uint8Array }[] = [];
  for (const grupo of agrupar(fotos, porPagina)) {
    const m0 = medidaFinal(grupo[0]);
    const f = folha(porPagina, m0.larg > m0.alt);
    for (let i = 0; i < grupo.length; i++) {
      const foto = grupo[i];
      try {
        const m = medidaFinal(foto);
        const alvo = pixelsAlvo(f.caixas[i], m.larg, m.alt, nivel.dpi);
        prontas.push({ foto, bytes: await jpegParaPdf(foto, alvo, nivel.q, nivel.dpi === null) });
      } catch (e) {
        console.error(foto.nome, e);
        puladas.push(foto.nome);
      }
      aoAvancar(++feitas, fotos.length);
    }
  }
  if (!prontas.length) throw new Error('nenhuma foto pôde ser preparada');

  // depois monta as folhas só com as que deram certo
  let folhas = 0;
  for (const grupo of agrupar(prontas, porPagina)) {
    const m0 = medidaFinal(grupo[0].foto);
    const f = folha(porPagina, m0.larg > m0.alt);
    const pagina = doc.addPage([f.larg, f.alt]);
    folhas++;
    for (let i = 0; i < grupo.length; i++) {
      const { foto, bytes } = grupo[i];
      const img = await doc.embedJpg(bytes);
      const m = medidaFinal(foto);
      const lugar = encaixar(f.caixas[i], m.larg, m.alt);
      pagina.drawImage(img, { x: lugar.x, y: lugar.y, width: lugar.larg, height: lugar.alt });
    }
  }
  return { bytes: await doc.save(), puladas, folhas };
}
