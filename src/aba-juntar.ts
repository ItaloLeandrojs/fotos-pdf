// Aba Juntar PDFs: lista de arquivos, ordem e botão de juntar.
import Sortable from 'sortablejs';
import { ehPdf, nomeArquivo, porNome, tamanhoTexto } from './layout';

interface Doc {
  id: string;
  nome: string;
  arquivo: File;
  bytes: number;
  paginas: number;
  assinado: boolean;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  secao: $('j-secao'),
  escolher: $<HTMLInputElement>('j-escolher'),
  soltarTitulo: $('j-soltar-titulo'),
  barra: $('j-barra'),
  contagem: $('j-contagem'),
  mais: $<HTMLButtonElement>('j-mais'),
  porNome: $<HTMLButtonElement>('j-por-nome'),
  limpar: $<HTMLButtonElement>('j-limpar'),
  erro: $('j-erro'),
  lista: $<HTMLOListElement>('j-lista'),
  nome: $<HTMLInputElement>('j-nome'),
  aviso: $('j-aviso'),
  gerar: $<HTMLButtonElement>('j-gerar'),
  progresso: $('j-progresso'),
  cheio: $('j-cheio'),
  progressoTexto: $('j-progresso-texto'),
  resultado: $('j-resultado'),
  resNome: $('j-res-nome'),
  resNum: $('j-res-num'),
  baixar: $<HTMLAnchorElement>('j-baixar'),
  mover: $('j-mover'),
};

const PADRAO = 'PDFs juntos';
const folhas = (n: number) => `${n} ${n === 1 ? 'folha' : 'folhas'}`;
const lerBytes = async (f: File) => new Uint8Array(await f.arrayBuffer());

let docs: Doc[] = [];
let abrindo = 0;
let gerando = false;
let ultimoPdf: string | null = null;
let seq = 0;

// ---------- adicionar ----------
export async function adicionarPdfs(recebidos: File[]) {
  if (gerando) {
    mostrarErro('Espere o PDF terminar para adicionar mais arquivos.');
    return;
  }
  esconderErro();
  const arquivos = recebidos.filter(ehPdf).sort(porNome);
  const recusados = recebidos.length - arquivos.length;
  const avisos: string[] = [];
  if (recusados) avisos.push(`${recusados === 1 ? '1 arquivo não é PDF e ficou' : `${recusados} arquivos não são PDF e ficaram`} de fora. Fotos vão na aba Fotos em PDF.`);
  if (arquivos.length) {
    limparResultado();
    abrindo += arquivos.length;
    atualizar();
    const problemas: Record<string, string[]> = {};
    for (const arquivo of arquivos) {
      try {
        const { lerInfo } = await import('./juntar');
        const info = await lerInfo(await lerBytes(arquivo));
        docs.push({ id: `d${++seq}`, nome: arquivo.name, arquivo, bytes: arquivo.size, ...info });
      } catch (e) {
        const motivo = (e as { motivo?: string }).motivo ?? 'danificado';
        (problemas[motivo] ??= []).push(arquivo.name);
      } finally {
        abrindo--;
        desenhar();
      }
    }
    if (problemas.protegido) avisos.push(`Protegido com senha ou contra alteração: ${problemas.protegido.join(', ')}. Abra no leitor de PDF, mande imprimir em "Salvar como PDF" e adicione a cópia.`);
    if (problemas.danificado) avisos.push(`Não deu para abrir (arquivo danificado ou que não é PDF): ${problemas.danificado.join(', ')}.`);
    if (problemas.vazio) avisos.push(`Sem nenhuma folha: ${problemas.vazio.join(', ')}.`);
  }
  if (avisos.length) mostrarErro(avisos.join(' '));
}

// ---------- lista ----------
const ICONE = {
  subir: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m0 0-6 6m6-6 6 6" /></svg>',
  descer: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14m0 0 6-6m-6 6-6-6" /></svg>',
  tirar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>',
};

function desenhar() {
  el.lista.replaceChildren(...docs.map(linha));
  atualizar();
}

function linha(d: Doc, i: number): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'doc';
  li.dataset.id = d.id;
  li.innerHTML = `
    <span class="n" aria-hidden="true">${i + 1}</span>
    <div class="doc-texto"><p class="doc-nome"></p><p class="doc-meta"></p></div>
    <div class="doc-acoes">
      <button type="button" class="icone-btn" data-acao="subir" title="Subir"${i === 0 ? ' disabled' : ''}>${ICONE.subir}</button>
      <button type="button" class="icone-btn" data-acao="descer" title="Descer"${i === docs.length - 1 ? ' disabled' : ''}>${ICONE.descer}</button>
      <button type="button" class="icone-btn tirar" data-acao="tirar" title="Tirar">${ICONE.tirar}</button>
    </div>`;
  (li.querySelector('.doc-nome') as HTMLElement).textContent = d.nome;
  (li.querySelector('.doc-meta') as HTMLElement).textContent = [folhas(d.paginas), tamanhoTexto(d.bytes), d.assinado ? 'assinado' : ''].filter(Boolean).join(' · ');
  li.querySelectorAll('button').forEach((b) => b.setAttribute('aria-label', `${b.title} ${d.nome}`));
  return li;
}

el.lista.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-acao]');
  const id = btn?.closest<HTMLElement>('.doc')?.dataset.id;
  const k = docs.findIndex((d) => d.id === id);
  if (!btn || k < 0 || gerando) return;
  const acao = btn.dataset.acao as 'subir' | 'descer' | 'tirar';
  limparResultado();
  const [d] = docs.splice(k, 1);
  if (acao === 'tirar') {
    desenhar();
    el.mover.textContent = `${d.nome} saiu da lista.`;
    const prox = docs[Math.min(k, docs.length - 1)];
    if (prox) focarBotao(prox.id, 'tirar');
    else el.escolher.focus();
    return;
  }
  const para = Math.max(0, Math.min(docs.length, k + (acao === 'subir' ? -1 : 1)));
  docs.splice(para, 0, d);
  desenhar();
  el.mover.textContent = `${d.nome} foi para a posição ${para + 1} de ${docs.length}.`;
  focarBotao(d.id, acao);
});

function focarBotao(id: string, acao: 'subir' | 'descer' | 'tirar') {
  const botao = (a: string) => el.lista.querySelector<HTMLButtonElement>(`[data-id="${id}"] [data-acao="${a}"]`);
  const b = botao(acao);
  // na ponta da lista o botão fica desligado: o foco vai para o outro
  (b?.disabled ? botao(acao === 'subir' ? 'descer' : 'subir') : b)?.focus();
}

const ordenador = Sortable.create(el.lista, {
  animation: 180,
  easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
  filter: 'button',
  preventOnFilter: false,
  delay: 180,
  delayOnTouchOnly: true, // no celular, segurar um instante para arrastar; assim a página ainda rola
  ghostClass: 'fantasma',
  chosenClass: 'escolhida',
  onEnd: () => {
    const mapa = new Map(docs.map((d) => [d.id, d]));
    docs = Array.from(el.lista.querySelectorAll<HTMLElement>('.doc')).map((li) => mapa.get(li.dataset.id as string)).filter(Boolean) as Doc[];
    limparResultado();
    desenhar();
  },
});

// ---------- barra ----------
function atualizar() {
  const tem = docs.length > 0 || abrindo > 0;
  const paginas = docs.reduce((s, d) => s + d.paginas, 0);
  const total = docs.reduce((s, d) => s + d.bytes, 0);
  el.secao.classList.toggle('tem', tem);
  el.soltarTitulo.textContent = tem ? 'Arraste mais PDFs para cá' : 'Arraste os PDFs para cá';
  el.barra.hidden = !tem;
  const b = document.createElement('b');
  b.textContent = `${docs.length} ${docs.length === 1 ? 'PDF' : 'PDFs'}`;
  el.contagem.replaceChildren(b, ` · ${folhas(paginas)} · ${tamanhoTexto(total)}${abrindo ? ` · abrindo ${abrindo}…` : ''}`);
  el.aviso.hidden = !docs.some((d) => d.assinado);
  el.gerar.disabled = gerando || abrindo > 0 || docs.length < 2;
  el.gerar.textContent = abrindo ? 'Abrindo PDFs…' : docs.length > 1 ? `Juntar ${docs.length} PDFs` : 'Juntar PDFs';
  el.mais.disabled = el.porNome.disabled = el.limpar.disabled = gerando || abrindo > 0;
}

el.escolher.addEventListener('change', () => {
  const arquivos = Array.from(el.escolher.files ?? []);
  el.escolher.value = '';
  if (arquivos.length) adicionarPdfs(arquivos);
});
el.mais.addEventListener('click', () => el.escolher.click());
el.porNome.addEventListener('click', () => {
  docs.sort((a, b) => porNome(a.arquivo, b.arquivo));
  limparResultado();
  desenhar();
});
el.limpar.addEventListener('click', () => {
  if (docs.length > 3 && !confirm(`Tirar os ${docs.length} PDFs da lista?`)) return;
  docs = [];
  limparResultado();
  esconderErro();
  desenhar();
  el.escolher.focus();
});
el.nome.placeholder = nomeArquivo('', new Date(), PADRAO).replace(/\.pdf$/, '');
el.nome.addEventListener('input', limparResultado);

// ---------- juntar ----------
el.gerar.addEventListener('click', async () => {
  if (docs.length < 2 || gerando || abrindo) return;
  gerando = true;
  const lista = docs.slice();
  el.lista.inert = true;
  ordenador.option('disabled', true);
  esconderErro();
  limparResultado();
  atualizar();
  el.progresso.hidden = false;
  el.gerar.textContent = 'Juntando…';
  const nome = nomeArquivo(el.nome.value, new Date(), PADRAO);
  try {
    const { juntarPdfs } = await import('./juntar');
    const { bytes, paginas } = await juntarPdfs(
      lista.map((d) => ({ nome: d.nome, ler: () => lerBytes(d.arquivo) })),
      nome.replace(/\.pdf$/, ''),
      (feitos, total) => {
        el.cheio.style.width = `${Math.round((feitos / total) * 100)}%`;
        el.progressoTexto.textContent = feitos < total ? `Juntando PDF ${feitos + 1} de ${total}` : 'Salvando o arquivo…';
      },
    );
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    ultimoPdf = URL.createObjectURL(blob);
    el.baixar.href = ultimoPdf;
    el.baixar.download = nome;
    el.baixar.click(); // baixa na hora
    el.resNome.textContent = `${nome} baixado`;
    el.resNum.textContent = `${folhas(paginas)}, ${tamanhoTexto(blob.size)}. Os ${lista.length} arquivos somavam ${tamanhoTexto(lista.reduce((s, d) => s + d.bytes, 0))}.`;
    el.resultado.hidden = false;
    el.baixar.focus({ preventScroll: true });
    el.resultado.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  } catch (err) {
    console.error(err);
    const culpado = (err as { nome?: string }).nome;
    mostrarErro(
      culpado
        ? `Não deu para juntar por causa de ${culpado}. Ele pode ter mudado de lugar ou ter um defeito. Tire da lista ou adicione de novo.`
        : 'Não deu para juntar. Se os arquivos forem muito grandes, tente em partes.',
    );
  } finally {
    gerando = false;
    el.lista.inert = false;
    ordenador.option('disabled', false);
    el.progresso.hidden = true;
    el.cheio.style.width = '0';
    atualizar();
  }
});

function limparResultado() {
  el.resultado.hidden = true;
  if (ultimoPdf) URL.revokeObjectURL(ultimoPdf);
  ultimoPdf = null;
}
function mostrarErro(t: string) {
  el.erro.textContent = t;
  el.erro.hidden = false;
  el.erro.scrollIntoView({ block: 'nearest' });
}
function esconderErro() {
  el.erro.hidden = true;
}

atualizar();
