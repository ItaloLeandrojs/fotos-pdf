import { describe, expect, it } from 'vitest';
import { degrees, PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFString } from 'pdf-lib';
import { ErroArquivo, ErroPdf, juntarPdfs, lerInfo } from '../src/juntar';
import { ehPdf, nomeArquivo, porNome } from '../src/layout';

const n = (s: string) => PDFName.of(s);
const arq = (nome: string, bytes: Uint8Array) => ({ nome, ler: async () => bytes });

async function pdf(tamanhos: [number, number][], mexer?: (d: PDFDocument) => void | Promise<void>) {
  const d = await PDFDocument.create();
  for (const t of tamanhos) d.addPage(t).drawText('x', { x: 10, y: 10 });
  await mexer?.(d);
  return d.save();
}
const motivo = (b: Uint8Array) => lerInfo(b).then(() => 'ok', (e) => (e instanceof ErroPdf ? e.motivo : String(e)));

describe('juntar PDFs', () => {
  it('mantém a ordem dos arquivos, o tamanho e o giro de cada página', async () => {
    const a = await pdf([[595, 842], [842, 595]]);
    const b = await pdf([[1190, 1684]], (d) => d.getPage(0).setRotation(degrees(90)));
    const passos: number[] = [];
    const r = await juntarPdfs([arq('b', b), arq('a', a)], 'titulo', (f) => passos.push(f));
    const d = await PDFDocument.load(r.bytes, { updateMetadata: false });
    expect(r.paginas).toBe(3);
    expect(d.getPages().map((p) => [p.getWidth(), p.getHeight(), p.getRotation().angle])).toEqual([
      [1190, 1684, 90], [595, 842, 0], [842, 595, 0],
    ]);
    expect(d.getTitle()).toBe('titulo');
    expect(passos).toEqual([0, 1, 2]);
  });

  it('o mesmo arquivo pode entrar duas vezes', async () => {
    const a = await pdf([[100, 200]]);
    expect((await juntarPdfs([arq('a', a), arq('a', a)], 't')).paginas).toBe(2);
  });

  it('herda tamanho e giro que vêm do nó pai das páginas', async () => {
    const a = await pdf([[300, 400]], (d) => {
      const p = d.getPage(0).node;
      const pai = p.lookup(n('Parent'), PDFDict);
      pai.set(n('MediaBox'), p.get(n('MediaBox'))!);
      pai.set(n('Rotate'), d.context.obj(180));
      p.delete(n('MediaBox'));
    });
    const d = await PDFDocument.load((await juntarPdfs([arq('a', a)], 't')).bytes);
    expect([d.getPage(0).getWidth(), d.getPage(0).getRotation().angle]).toEqual([300, 180]);
  });

  it('link entre páginas continua na página certa, sem página fantasma', async () => {
    const a = await pdf([[100, 100]]);
    const b = await pdf([[200, 200], [300, 300]], (d) => {
      const link = d.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 9, 9], Dest: [d.getPage(1).ref, 'Fit'] });
      d.getPage(0).node.set(n('Annots'), d.context.obj([d.context.register(link)]));
    });
    const d = await PDFDocument.load((await juntarPdfs([arq('a', a), arq('b', b)], 't')).bytes);
    const link = d.getPage(1).node.Annots()!.lookup(0, PDFDict);
    expect(link.lookup(n('Dest'), PDFArray).get(0)).toBe(d.getPage(2).ref);
    const paginas = d.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFDict && o.get(n('Type')) === n('Page'));
    expect(paginas.length).toBe(3);
  });

  it('PDF de 2.000 folhas com link de uma para a outra', async () => {
    const b = await pdf(Array.from({ length: 2000 }, () => [100, 100] as [number, number]), (d) => {
      const p = d.getPages();
      p.forEach((x, i) => {
        const alvo = p[Math.min(i + 1, p.length - 1)].ref;
        x.node.set(n('Annots'), d.context.obj([d.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 9, 9], Dest: [alvo, 'Fit'] })]));
      });
    });
    expect((await juntarPdfs([arq('b', b)], 't')).paginas).toBe(2000);
  }, 60000);

  it('campo preenchido vira carimbo visível; campo sem desenho sai', async () => {
    const a = await pdf([[400, 400]], (d) => {
      const c = d.getForm().createTextField('obra');
      c.setText('Rua São José');
      c.addToPage(d.getPage(0), { x: 10, y: 10, width: 100, height: 20 });
      const vazio = d.context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: [0, 0, 0, 0], T: PDFString.of('s') });
      d.getPage(0).node.Annots()!.push(d.context.register(vazio));
    });
    const d = await PDFDocument.load((await juntarPdfs([arq('a', a)], 't')).bytes);
    const anots = d.getPage(0).node.Annots()!;
    expect(anots.size()).toBe(1);
    const carimbo = anots.lookup(0, PDFDict);
    expect(carimbo.get(n('Subtype'))).toBe(n('Stamp'));
    expect(carimbo.lookup(n('AP'), PDFDict).has(n('N'))).toBe(true);
    expect(carimbo.has(n('Parent'))).toBe(false);
  });

  it('camada desligada continua desligada, junto com as dos outros arquivos', async () => {
    const comCamadas = (nome: string, desligar: boolean) =>
      pdf([[100, 100]], (d) => {
        const g = d.context.register(d.context.obj({ Type: 'OCG', Name: PDFString.of(nome) }));
        d.getPage(0).node.set(n('Resources'), d.context.obj({ Properties: { MC0: g } }));
        d.catalog.set(n('OCProperties'), d.context.obj({ OCGs: [g], D: { OFF: desligar ? [g] : [], Order: [g] } }));
      });
    const r = await juntarPdfs([arq('a', await comCamadas('A', true)), arq('b', await comCamadas('B', false))], 't');
    const d = await PDFDocument.load(r.bytes);
    const oc = d.catalog.lookup(n('OCProperties'), PDFDict);
    const off = oc.lookup(n('D'), PDFDict).lookup(n('OFF'), PDFArray);
    expect(oc.lookup(n('OCGs'), PDFArray).size()).toBe(2);
    expect(off.size()).toBe(1);
    // é a mesma camada que a página usa, não uma cópia solta
    const daPagina = d.getPage(0).node.Resources()!.lookup(n('Properties'), PDFDict).get(n('MC0'));
    expect(off.get(0) as PDFRef).toBe(daPagina);
  });

  it('diz qual arquivo deu problema e não gera um PDF faltando documento', async () => {
    const a = await pdf([[100, 100]]);
    const erro = await juntarPdfs([arq('bom.pdf', a), arq('ruim.pdf', new Uint8Array([1, 2, 3]))], 't').catch((e) => e);
    expect(erro).toBeInstanceOf(ErroArquivo);
    expect(erro.nome).toBe('ruim.pdf');
  });
});

describe('conferir ao adicionar', () => {
  it('conta páginas', async () => {
    expect(await lerInfo(await pdf([[10, 10], [10, 10]]))).toEqual({ paginas: 2, assinado: false });
  });
  it('avisa assinatura digital', async () => {
    const b = await pdf([[100, 100]], (d) => {
      const sig = d.context.register(d.context.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite' }));
      const campo = d.context.register(d.context.obj({ FT: 'Sig', T: PDFString.of('a'), V: sig }));
      d.catalog.set(n('AcroForm'), d.context.obj({ Fields: [campo], SigFlags: 3 }));
    });
    expect((await lerInfo(b)).assinado).toBe(true);
  });
  it('campo de assinatura em branco não é assinatura', async () => {
    const b = await pdf([[100, 100]], (d) => {
      const campo = d.context.register(d.context.obj({ FT: 'Sig', T: PDFString.of('a') }));
      d.catalog.set(n('AcroForm'), d.context.obj({ Fields: [campo], SigFlags: 1 }));
    });
    expect((await lerInfo(b)).assinado).toBe(false);
  });
  it('recusa protegido e danificado', async () => {
    const protegido = await pdf([[10, 10]], (d) => {
      d.context.trailerInfo.Encrypt = d.context.register(d.context.obj({ Filter: 'Standard', V: 4, R: 4 }));
    });
    expect(await motivo(protegido)).toBe('protegido');
    expect(await motivo(new TextEncoder().encode('isto não é um pdf'))).toBe('danificado');
    expect(await motivo(new Uint8Array())).toBe('danificado');
  });
});

describe('nomes', () => {
  it('ordem humana', () => {
    expect([{ name: '10 memorial.pdf' }, { name: '2 planta.pdf' }].sort(porNome)[0].name).toBe('2 planta.pdf');
  });
  it('reconhece PDF pelo tipo ou pelo nome', () => {
    expect(ehPdf({ name: 'A.PDF', type: '' })).toBe(true);
    expect(ehPdf({ name: 'a', type: 'application/pdf' })).toBe(true);
    expect(ehPdf({ name: 'a.jpg', type: 'image/jpeg' })).toBe(false);
  });
  it('nome padrão do PDF juntado', () => {
    expect(nomeArquivo('', new Date(2026, 10, 24), 'PDFs juntos')).toBe('PDFs juntos 24-11-2026.pdf');
  });
});
