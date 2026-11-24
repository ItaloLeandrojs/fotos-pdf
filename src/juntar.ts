// Junta vários PDFs num só. As páginas entram como são: nada é redesenhado nem comprimido de novo.
// Sem DOM: dá para testar no Node.
import {
  ParseSpeeds,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFObjectCopier,
  PDFPage,
  PDFRef,
  PDFStream,
} from 'pdf-lib';

export type Motivo = 'protegido' | 'danificado' | 'vazio';

/** PDF que não dá para juntar, com o motivo para a mensagem na tela. */
export class ErroPdf extends Error {
  motivo: Motivo;
  constructor(motivo: Motivo) {
    super(motivo);
    this.motivo = motivo;
  }
}

export interface InfoPdf {
  paginas: number;
  assinado: boolean; // tem assinatura digital, que perde a validade ao juntar
}

const n = (s: string) => PDFName.of(s);

async function abrir(bytes: Uint8Array): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, parseSpeed: ParseSpeeds.Fast });
    if (!doc.isEncrypted && doc.getPageCount() === 0) throw new ErroPdf('vazio');
  } catch (e) {
    if (e instanceof ErroPdf) throw e;
    throw new ErroPdf(temTexto(bytes, '/Encrypt') ? 'protegido' : 'danificado');
  }
  if (doc.isEncrypted) throw new ErroPdf('protegido');
  return doc;
}

function temTexto(bytes: Uint8Array, texto: string): boolean {
  const alvo = Array.from(texto, (c) => c.charCodeAt(0));
  for (let i = bytes.indexOf(alvo[0]); i >= 0; i = bytes.indexOf(alvo[0], i + 1)) {
    if (alvo.every((b, k) => bytes[i + k] === b)) return true;
  }
  return false;
}

/** Confere o PDF na hora de adicionar: quantas páginas tem e se dá para juntar. */
export async function lerInfo(bytes: Uint8Array): Promise<InfoPdf> {
  const doc = await abrir(bytes);
  return { paginas: doc.getPageCount(), assinado: temAssinatura(doc) };
}

function formulario(doc: PDFDocument): PDFDict | undefined {
  const f = doc.catalog.lookup(n('AcroForm'));
  return f instanceof PDFDict ? f : undefined;
}

function temAssinatura(doc: PDFDocument): boolean {
  const vistos = new Set<unknown>();
  const olhar = (lista: unknown, tipoPai?: unknown): boolean => {
    if (!(lista instanceof PDFArray)) return false;
    for (let i = 0; i < lista.size(); i++) {
      const campo = lista.lookup(i);
      if (!(campo instanceof PDFDict) || vistos.has(campo)) continue;
      vistos.add(campo);
      const tipo = campo.lookup(n('FT')) ?? tipoPai;
      if (tipo === n('Sig') && campo.lookup(n('V')) instanceof PDFDict) return true;
      if (olhar(campo.lookup(n('Kids')), tipo)) return true;
    }
    return false;
  };
  return olhar(formulario(doc)?.lookup(n('Fields')));
}

/**
 * Campos de formulário e selos de assinatura só aparecem se o formulário vier junto, e ele não vem.
 * Aqui viram carimbo: continuam visíveis e impressos como estavam, só não são mais editáveis.
 */
function camposViramCarimbo(doc: PDFDocument) {
  if (!formulario(doc)) return;
  try {
    doc.getForm().updateFieldAppearances(); // desenha os campos preenchidos que não tinham desenho
  } catch {
    /* formulário fora do padrão: fica o desenho que já existe */
  }
  for (const pagina of doc.getPages()) {
    const anots = pagina.node.Annots();
    if (!anots) continue;
    for (let i = anots.size() - 1; i >= 0; i--) {
      const a = anots.lookup(i);
      if (!(a instanceof PDFDict) || a.lookup(n('Subtype')) !== n('Widget')) continue;
      const desenho = a.lookup(n('AP'));
      const normal = desenho instanceof PDFDict ? desenho.lookup(n('N')) : undefined;
      if (!(normal instanceof PDFStream) && !(normal instanceof PDFDict)) {
        anots.remove(i); // campo vazio, sem nada para mostrar
        continue;
      }
      a.set(n('Subtype'), n('Stamp'));
      for (const chave of ['FT', 'V', 'DV', 'Parent', 'Kids', 'T', 'TU', 'TM', 'Ff', 'A', 'AA', 'MK', 'DA', 'Opt', 'MaxLen', 'Lock', 'SV']) a.delete(n(chave));
    }
  }
}

/** Camadas (comuns em PDF do AutoCAD): as que estavam desligadas continuam desligadas. */
class Camadas {
  private todas: PDFRef[] = [];
  private desligadas: PDFRef[] = [];
  private ordem: (PDFRef | PDFArray)[] = [];

  juntar(doc: PDFDocument, copiador: PDFObjectCopier) {
    const oc = doc.catalog.lookup(n('OCProperties'));
    if (!(oc instanceof PDFDict)) return;
    const refs = (lista: unknown) => (lista instanceof PDFArray ? lista.asArray().filter((r): r is PDFRef => r instanceof PDFRef) : []);
    const todas = refs(oc.lookup(n('OCGs')));
    const d = oc.lookup(n('D'));
    let desligadas: PDFRef[] = [];
    if (d instanceof PDFDict) {
      const ligadas = new Set(refs(d.lookup(n('ON'))));
      desligadas = d.lookup(n('BaseState')) === n('OFF') ? todas.filter((r) => !ligadas.has(r)) : refs(d.lookup(n('OFF')));
      const ordem = d.lookup(n('Order'));
      if (ordem instanceof PDFArray) this.ordem.push(...(copiador.copy(ordem).asArray() as (PDFRef | PDFArray)[]));
    }
    this.todas.push(...todas.map((r) => copiador.copy(r)));
    this.desligadas.push(...desligadas.map((r) => copiador.copy(r)));
  }

  gravar(doc: PDFDocument) {
    if (!this.todas.length) return;
    const { context } = doc;
    doc.catalog.set(
      n('OCProperties'),
      context.obj({ OCGs: this.todas, D: { BaseState: 'ON', OFF: this.desligadas, Order: this.ordem } }),
    );
  }
}

export interface ArquivoPdf {
  nome: string;
  ler: () => Promise<Uint8Array>; // lê só na hora de juntar, um de cada vez
}

/** Erro ao juntar, com o nome do arquivo. Faltar um documento seria pior do que não gerar. */
export class ErroArquivo extends Error {
  nome: string;
  constructor(nome: string, causa: unknown) {
    super(nome, { cause: causa });
    this.nome = nome;
  }
}

export async function juntarPdfs(
  arquivos: ArquivoPdf[],
  titulo: string,
  aoAvancar: (feitos: number, total: number) => void = () => {},
): Promise<{ bytes: Uint8Array; paginas: number }> {
  const saida = await PDFDocument.create();
  saida.setTitle(titulo);
  saida.setCreator('Fotos em PDF');
  saida.setProducer('Fotos em PDF (pdf-lib)');
  const camadas = new Camadas();
  let feitos = 0;
  aoAvancar(0, arquivos.length);
  for (const arquivo of arquivos) {
    try {
      const doc = await abrir(await arquivo.ler());
      camposViramCarimbo(doc);
      await doc.flush();
      const copiador = PDFObjectCopier.for(doc.context, saida.context);
      // reserva o lugar de cada folha antes de copiar: os links entre folhas já apontam para a certa,
      // e um PDF de milhares de folhas com links não estoura a pilha copiando uma dentro da outra
      const paginas = doc.getPages().map((p) => ({ p, ref: saida.context.nextRef() }));
      const copiados = (copiador as unknown as { traversedObjects: Map<unknown, unknown> }).traversedObjects;
      for (const { p, ref } of paginas) copiados.set(p.ref, ref);
      for (const { p, ref } of paginas) {
        const folha = copiador.copy(p.node);
        saida.context.assign(ref, folha);
        saida.addPage(PDFPage.of(folha, ref, saida));
      }
      camadas.juntar(doc, copiador);
    } catch (e) {
      throw new ErroArquivo(arquivo.nome, e);
    }
    aoAvancar(++feitos, arquivos.length);
  }
  camadas.gravar(saida);
  return { bytes: await saida.save({ addDefaultPage: false }), paginas: saida.getPageCount() };
}
