import './estilo.css';
import Sortable from 'sortablejs';
import { abrirFoto, ehImagem, type Foto, type Giro } from './imagem';
import { nomeArquivo, tamanhoTexto, type PorPagina, type Qualidade } from './layout';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  secao: document.querySelector('.fotos') as HTMLElement,
  escolher: $<HTMLInputElement>('escolher'),
  soltar: $('soltar'),
  barra: $('barra'),
  contagem: $('contagem'),
  dica: $('dica'),
  grade: $<HTMLOListElement>('grade'),
  mais: $<HTMLButtonElement>('mais'),
  porData: $<HTMLButtonElement>('por-data'),
  porNome: $<HTMLButtonElement>('por-nome'),
  limpar: $<HTMLButtonElement>('limpar'),
  nome: $<HTMLInputElement>('nome'),
  notaQualidade: $('nota-qualidade'),
  gerar: $<HTMLButtonElement>('gerar'),
  progresso: $('progresso'),
  cheio: $('cheio'),
  progressoTexto: $('progresso-texto'),
  resultado: $('resultado'),
  resNome: $('res-nome'),
  resNum: $('res-num'),
  baixar: $<HTMLAnchorElement>('baixar-de-novo'),
  erro: $('erro'),
};

const NOTAS: Record<Qualidade, string> = {
  menor: 'O mais leve. Bom para mandar no WhatsApp e ver na tela.',
  equilibrado: 'Leve e nítido, também na impressão. A diferença não aparece a olho nu.',
  maxima: 'Fotos no tamanho original, sem reduzir. Arquivo bem maior; com muitas fotos no celular, prefira Equilibrado.',
};

// ---------- estado ----------
let fotos: Foto[] = [];
let abrindo = 0;
let gerando = false;
let ultimoPdf: string | null = null;
let ativa: string | null = null; // foto que recebe o Tab (só uma parada de Tab na grade)

const guardado = lerPreferencias();
marcar('pagina', String(guardado.pagina));
marcar('qualidade', guardado.qualidade);
atualizarNota();

function lerPreferencias(): { pagina: PorPagina; qualidade: Qualidade } {
  try {
    const p = JSON.parse(localStorage.getItem('fotos-pdf:pref') || '{}');
    const pagina = [1, 2, 4].includes(p.pagina) ? p.pagina : 1;
    const qualidade = ['menor', 'equilibrado', 'maxima'].includes(p.qualidade) ? p.qualidade : 'equilibrado';
    return { pagina, qualidade };
  } catch {
    return { pagina: 1, qualidade: 'equilibrado' };
  }
}
function guardarPreferencias() {
  try {
    localStorage.setItem('fotos-pdf:pref', JSON.stringify({ pagina: porPagina(), qualidade: qualidade() }));
  } catch {
    /* sem armazenamento: tudo bem */
  }
}
function marcar(nome: string, valor: string) {
  const r = document.querySelector<HTMLInputElement>(`input[name="${nome}"][value="${valor}"]`);
  if (r) r.checked = true;
}
function porPagina(): PorPagina {
  return Number(document.querySelector<HTMLInputElement>('input[name="pagina"]:checked')?.value ?? 1) as PorPagina;
}
function qualidade(): Qualidade {
  return (document.querySelector<HTMLInputElement>('input[name="qualidade"]:checked')?.value ?? 'equilibrado') as Qualidade;
}
function atualizarNota() {
  el.notaQualidade.textContent = NOTAS[qualidade()];
}

// ---------- adicionar fotos ----------
async function adicionar(lista: FileList | File[]) {
  if (gerando) {
    mostrarErro('Espere o PDF terminar para adicionar mais fotos.');
    return;
  }
  const arquivos = Array.from(lista).filter(ehImagem);
  const recusados = Array.from(lista).length - arquivos.length;
  esconderErro();
  const avisos: string[] = [];
  if (recusados) avisos.push(recusados === 1 ? '1 arquivo não é imagem e ficou de fora.' : `${recusados} arquivos não são imagem e ficaram de fora.`);
  if (!arquivos.length) {
    if (avisos.length) mostrarErro(avisos.join(' '));
    return;
  }
  limparResultado();

  // lugar reservado na grade, na ordem de nome, enquanto abre
  arquivos.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
  const reservas = arquivos.map((a) => {
    const li = document.createElement('li');
    li.className = 'foto carregando';
    li.innerHTML = `<div class="quadro"></div><div class="pe"><span class="nome"></span></div>`;
    (li.querySelector('.nome') as HTMLElement).textContent = a.name;
    el.grade.append(li);
    return li;
  });
  abrindo += arquivos.length;
  atualizar();

  const novas: Foto[] = [];
  const falhas: string[] = [];
  let i = 0;
  const trabalhar = async () => {
    while (i < arquivos.length) {
      const k = i++;
      try {
        novas[k] = await abrirFoto(arquivos[k]);
      } catch {
        falhas.push(arquivos[k].name);
      } finally {
        reservas[k].remove();
        abrindo--;
        atualizarContagem();
      }
    }
  };
  // 3 por vez: rápido sem estourar a memória do celular
  await Promise.all([trabalhar(), trabalhar(), trabalhar()]);

  // as novas entram depois das que já estavam, por data da foto
  const ok = novas.filter(Boolean).sort(porDataNome);
  fotos = fotos.concat(ok);
  desenhar();
  if (falhas.length) avisos.push(`Não deu para abrir: ${falhas.join(', ')}.`);
  if (avisos.length) mostrarErro(avisos.join(' '));
}

function porDataNome(a: Foto, b: Foto) {
  return a.data - b.data || a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true });
}

// ---------- grade ----------
const ICONE_GIRAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>';
const ICONE_TIRAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>';

function desenhar() {
  const focada = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.foto')?.dataset.id;
  el.grade.querySelectorAll('.foto:not(.carregando)').forEach((n) => n.remove());
  const frag = document.createDocumentFragment();
  if (!fotos.some((f) => f.id === ativa)) ativa = fotos[0]?.id ?? null;
  fotos.forEach((f, i) => frag.append(cartao(f, i)));
  el.grade.prepend(frag);
  if (focada) el.grade.querySelector<HTMLElement>(`[data-id="${focada}"]`)?.focus();
  atualizar();
}

function cartao(f: Foto, i: number): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'foto';
  li.dataset.id = f.id;
  li.tabIndex = f.id === ativa ? 0 : -1;
  li.setAttribute('aria-label', `Foto ${i + 1}: ${f.nome}`);
  li.innerHTML = `
    <div class="quadro"><img alt="" decoding="async" loading="lazy" /></div>
    <span class="n">${i + 1}</span>
    <div class="pe">
      <span class="nome"></span>
      <button type="button" class="icone-btn girar" tabindex="-1" aria-label="Girar foto ${i + 1}" title="Girar">${ICONE_GIRAR}</button>
      <button type="button" class="icone-btn tirar" tabindex="-1" aria-label="Tirar foto ${i + 1}" title="Tirar">${ICONE_TIRAR}</button>
    </div>`;
  const img = li.querySelector('img') as HTMLImageElement;
  img.src = f.miniatura;
  // quadro quadrado: girar a imagem inteira continua cabendo nele
  img.style.transform = f.giro ? `rotate(${f.giro}deg)` : '';
  const nome = li.querySelector('.nome') as HTMLElement;
  nome.textContent = f.nome;
  nome.title = f.nome;
  return li;
}

el.grade.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  const li = btn?.closest<HTMLElement>('.foto');
  if (!btn || !li?.dataset.id) return;
  const k = fotos.findIndex((f) => f.id === li.dataset.id);
  if (k < 0) return;
  limparResultado();
  if (btn.classList.contains('girar')) {
    fotos[k].giro = ((fotos[k].giro + 90) % 360) as Giro;
    desenhar();
    focar(li.dataset.id);
  } else if (btn.classList.contains('tirar')) {
    const [saiu] = fotos.splice(k, 1);
    URL.revokeObjectURL(saiu.miniatura);
    desenhar();
    const prox = fotos[Math.min(k, fotos.length - 1)];
    if (prox) focar(prox.id);
    else el.escolher.focus();
  }
});

function focar(id: string) {
  ativa = id;
  el.grade.querySelectorAll<HTMLElement>('.foto[data-id]').forEach((n) => (n.tabIndex = n.dataset.id === id ? 0 : -1));
  el.grade.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus();
}
el.grade.addEventListener('focusin', (e) => {
  const li = (e.target as HTMLElement).closest<HTMLElement>('.foto[data-id]');
  if (li?.dataset.id && li.dataset.id !== ativa) focar(li.dataset.id);
});

// teclado: setas andam entre as fotos, Alt + setas move a foto, R gira, Delete ou Backspace tira
el.grade.addEventListener('keydown', (e) => {
  const li = e.target as HTMLElement;
  if (!li.classList?.contains('foto') || !li.dataset.id || gerando) return;
  const k = fotos.findIndex((f) => f.id === li.dataset.id);
  if (k < 0) return;
  const tras = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
  const frente = e.key === 'ArrowRight' || e.key === 'ArrowDown';
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    (li.querySelector('.tirar') as HTMLButtonElement).click();
    return;
  }
  if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    (li.querySelector('.girar') as HTMLButtonElement).click();
    return;
  }
  if (!e.altKey && (tras || frente || e.key === 'Home' || e.key === 'End')) {
    e.preventDefault();
    const alvo = e.key === 'Home' ? 0 : e.key === 'End' ? fotos.length - 1 : k + (tras ? -1 : 1);
    if (fotos[alvo]) focar(fotos[alvo].id);
    return;
  }
  if (!e.altKey || !(tras || frente)) return;
  e.preventDefault();
  const para = k + (tras ? -1 : 1);
  if (para < 0 || para >= fotos.length) return;
  const [f] = fotos.splice(k, 1);
  fotos.splice(para, 0, f);
  limparResultado();
  desenhar();
  focar(f.id);
  el.contagem.textContent = `${textoContagem()} Foto movida para a posição ${para + 1}.`;
});

const ordenador = Sortable.create(el.grade, {
  animation: 180,
  easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
  filter: '.carregando, button',
  preventOnFilter: false,
  delay: 180,
  delayOnTouchOnly: true, // no celular, segurar um instante para arrastar; assim a página ainda rola
  ghostClass: 'fantasma',
  chosenClass: 'escolhida',
  onEnd: () => {
    const ordem = Array.from(el.grade.querySelectorAll<HTMLElement>('.foto:not(.carregando)')).map((n) => n.dataset.id);
    const mapa = new Map(fotos.map((f) => [f.id, f]));
    fotos = ordem.map((id) => mapa.get(id as string)).filter(Boolean) as Foto[];
    limparResultado();
    desenhar();
  },
});

// ---------- barra ----------
function textoContagem() {
  const total = fotos.reduce((s, f) => s + f.bytes, 0);
  const n = fotos.length;
  return `${n} ${n === 1 ? 'foto' : 'fotos'}, ${tamanhoTexto(total)} somadas.`;
}
function atualizarContagem() {
  const n = fotos.length;
  const total = fotos.reduce((s, f) => s + f.bytes, 0);
  el.contagem.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = `${n} ${n === 1 ? 'foto' : 'fotos'}`;
  el.contagem.append(b, ` · ${tamanhoTexto(total)}`);
  if (abrindo) el.contagem.append(` · abrindo ${abrindo}…`);
}
function atualizar() {
  const tem = fotos.length > 0 || abrindo > 0;
  el.secao.classList.toggle('tem', tem);
  $('soltar-titulo').textContent = tem ? 'Arraste mais fotos para cá' : 'Arraste as fotos para cá';
  el.barra.hidden = !tem;
  el.dica.hidden = fotos.length < 2;
  el.gerar.disabled = gerando || abrindo > 0 || fotos.length === 0;
  el.gerar.textContent = abrindo ? 'Abrindo fotos…' : fotos.length ? `Gerar PDF com ${fotos.length} ${fotos.length === 1 ? 'foto' : 'fotos'}` : 'Gerar PDF';
  el.porData.disabled = el.porNome.disabled = el.limpar.disabled = gerando || abrindo > 0;
  atualizarContagem();
}

el.escolher.addEventListener('change', () => {
  if (el.escolher.files?.length) adicionar(el.escolher.files);
  el.escolher.value = '';
});
el.mais.addEventListener('click', () => el.escolher.click());
el.porData.addEventListener('click', () => {
  fotos.sort(porDataNome);
  limparResultado();
  desenhar();
});
el.porNome.addEventListener('click', () => {
  fotos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }));
  limparResultado();
  desenhar();
});
el.limpar.addEventListener('click', () => {
  if (fotos.length > 3 && !confirm(`Tirar as ${fotos.length} fotos da lista?`)) return;
  fotos.forEach((f) => URL.revokeObjectURL(f.miniatura));
  fotos = [];
  limparResultado();
  esconderErro();
  desenhar();
  el.escolher.focus();
});

// arrastar arquivos para qualquer lugar da página
let profundidade = 0;
const temArquivos = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!temArquivos(e)) return;
  e.preventDefault();
  profundidade++;
  document.body.classList.add('arrastando');
});
window.addEventListener('dragover', (e) => {
  if (temArquivos(e)) e.preventDefault();
});
window.addEventListener('dragleave', (e) => {
  if (!temArquivos(e)) return;
  if (--profundidade <= 0) {
    profundidade = 0;
    document.body.classList.remove('arrastando');
  }
});
window.addEventListener('drop', (e) => {
  if (!temArquivos(e)) return;
  e.preventDefault();
  profundidade = 0;
  document.body.classList.remove('arrastando');
  if (e.dataTransfer?.files.length) adicionar(e.dataTransfer.files);
});

// colar imagem (Ctrl+V)
window.addEventListener('paste', (e) => {
  const arquivos = Array.from(e.clipboardData?.files ?? []);
  if (arquivos.length) adicionar(arquivos);
});

// ---------- opções ----------
document.querySelectorAll('input[name="pagina"], input[name="qualidade"]').forEach((r) =>
  r.addEventListener('change', () => {
    atualizarNota();
    guardarPreferencias();
    limparResultado();
  }),
);
el.nome.placeholder = nomeArquivo('').replace(/\.pdf$/, '');
el.nome.addEventListener('input', limparResultado);

// ---------- gerar ----------
el.gerar.addEventListener('click', async () => {
  if (!fotos.length || gerando) return;
  gerando = true;
  // cópia da lista (com o giro de cada uma): mexer na grade agora não muda este PDF
  const lista = fotos.map((f) => ({ ...f }));
  const porFolha = porPagina();
  el.grade.inert = true;
  ordenador.option('disabled', true);
  esconderErro();
  limparResultado();
  atualizar();
  el.progresso.hidden = false;
  el.gerar.textContent = 'Gerando…';
  const nome = nomeArquivo(el.nome.value);
  try {
    const { gerarPdf } = await import('./pdf');
    const { bytes, puladas, folhas } = await gerarPdf(lista, porFolha, qualidade(), nome.replace(/\.pdf$/, ''), (feitas, total) => {
      el.cheio.style.width = `${Math.round((feitas / total) * 100)}%`;
      el.progressoTexto.textContent = feitas < total ? `Preparando foto ${feitas + 1} de ${total}` : 'Juntando o PDF…';
    });
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    ultimoPdf = URL.createObjectURL(blob);
    el.baixar.href = ultimoPdf;
    el.baixar.download = nome;
    el.baixar.click(); // baixa na hora
    const antes = lista.reduce((s, f) => s + f.bytes, 0);
    el.resNome.textContent = `${nome} baixado`;
    el.resNum.textContent = `${tamanhoTexto(blob.size)}, ${folhas} ${folhas === 1 ? 'folha' : 'folhas'}. As fotos somavam ${tamanhoTexto(antes)}${blob.size < antes ? ` (${Math.round((1 - blob.size / antes) * 100)}% menor)` : ''}.`;
    el.resultado.hidden = false;
    if (puladas.length) mostrarErro(`Ficaram fora do PDF por erro: ${puladas.join(', ')}.`);
    el.baixar.focus({ preventScroll: true });
    el.resultado.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  } catch (err) {
    console.error(err);
    mostrarErro('Não deu para gerar o PDF. Se forem muitas fotos, tente em partes ou use o tamanho Menor.');
  } finally {
    gerando = false;
    el.grade.inert = false;
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
