// Aba Escanear: foto do papel vira folha reta e limpa, e as folhas viram um PDF.
import Sortable from 'sortablejs';
import { decodificar, deHeic, ehHeic, ehImagem, medidas, novoCanvas, paraBlob } from './imagem';
import { limitarPixels, nomeArquivo, tamanhoTexto } from './layout';
import { acharBordas, fazerFolha } from './escaner/cliente';
import { escalar, valido, type Ponto, type Quad } from './escaner/geometria';
import { LADO_BUSCA } from './escaner/bordas';
import { LADO_FOLHA, tamanhoFolha, type Modo } from './escaner/motor';

interface Pagina {
  id: string;
  nome: string;
  arquivo: File;
  heic: boolean;
  fw: number; // tamanho da foto inteira, já de pé
  fh: number;
  quad: Quad; // cantos do papel na foto inteira
  auto: Quad; // o que o site achou sozinho
  achou: boolean;
  confianca: number;
  giro: number; // quartos de volta no sentido do relógio
  previa: Blob; // foto reduzida (lado maior PREVIA), para a tela e o ajuste
  pw: number;
  ph: number;
  miniatura: string | null;
}

const PREVIA = 1200;
const LADO_MINIATURA = 440;
const CONFIRA = 0.55; // abaixo disso, pede para conferir os cantos

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  secao: $('e-secao'),
  camera: $<HTMLInputElement>('e-camera'),
  escolher: $<HTMLInputElement>('e-escolher'),
  soltarTitulo: $('e-soltar-titulo'),
  barra: $('e-barra'),
  contagem: $('e-contagem'),
  mais: $<HTMLButtonElement>('e-mais'),
  limpar: $<HTMLButtonElement>('e-limpar'),
  erro: $('e-erro'),
  dica: $('e-dica'),
  grade: $<HTMLOListElement>('e-grade'),
  mover: $('e-mover'),
  nota: $('e-nota-modo'),
  nome: $<HTMLInputElement>('e-nome'),
  gerar: $<HTMLButtonElement>('e-gerar'),
  progresso: $('e-progresso'),
  cheio: $('e-cheio'),
  progressoTexto: $('e-progresso-texto'),
  resultado: $('e-resultado'),
  resNome: $('e-res-nome'),
  resNum: $('e-res-num'),
  baixar: $<HTMLAnchorElement>('e-baixar'),
  editor: $<HTMLDialogElement>('e-editor'),
  edFoto: $('e-ed-foto'),
  edImg: $<HTMLImageElement>('e-ed-img'),
  edForma: document.getElementById('e-ed-forma') as unknown as SVGPolygonElement,
  edSvg: document.getElementById('e-ed-svg') as unknown as SVGSVGElement,
  edLupa: $<HTMLCanvasElement>('e-lupa'),
  edInteira: $<HTMLButtonElement>('e-ed-inteira'),
  edAuto: $<HTMLButtonElement>('e-ed-auto'),
  edCancelar: $<HTMLButtonElement>('e-ed-cancelar'),
  edPronto: $<HTMLButtonElement>('e-ed-pronto'),
  edAviso: $('e-ed-aviso'),
};
const cantos = Array.from(document.querySelectorAll<HTMLButtonElement>('#e-editor .canto'));

const NOTAS: Record<Modo, string> = {
  original: 'Só endireita e corta o fundo, sem mexer nas cores. Melhor para RG, CNH, foto e papel colorido.',
  cor: 'Papel branco e letra escura, mantendo as cores de carimbo, logo e assinatura.',
  cinza: 'Sem cor. Bom para imprimir.',
  pb: 'Só preto e branco, como um scanner de escritório. O arquivo mais leve.',
};
const PADRAO = 'documento';

let paginas: Pagina[] = [];
let abrindo = 0;
let gerando = false;
let ultimoPdf: string | null = null;
let seq = 0;
let modo: Modo = lerModo();

function lerModo(): Modo {
  try {
    const m = localStorage.getItem('fotos-pdf:escaner');
    return m === 'original' || m === 'cinza' || m === 'pb' ? m : 'cor';
  } catch {
    return 'cor';
  }
}
(document.querySelector(`input[name="e-modo"][value="${modo}"]`) as HTMLInputElement).checked = true;
el.nota.textContent = NOTAS[modo];

// ---------- abrir fotos ----------
async function abrirPagina(arquivo: File): Promise<Pagina> {
  const heic = ehHeic(arquivo);
  const fonte: Blob = heic ? await deHeic(arquivo) : arquivo;
  const { larg: fw, alt: fh } = await medidas(fonte);
  const e = Math.min(1, PREVIA / Math.max(fw, fh));
  const pw = Math.max(1, Math.round(fw * e));
  const ph = Math.max(1, Math.round(fh * e));
  const bmp = await decodificar(fonte, pw, ph);
  const { c, ctx } = novoCanvas(pw, ph);
  ctx.drawImage(bmp, 0, 0, pw, ph);
  bmp.close();
  const previa = await paraBlob(c, 0.9);
  // busca das bordas numa cópia pequena
  const s = Math.min(1, LADO_BUSCA / Math.max(pw, ph));
  const bw = Math.max(1, Math.round(pw * s));
  const bh = Math.max(1, Math.round(ph * s));
  const busca = novoCanvas(bw, bh);
  busca.ctx.drawImage(c, 0, 0, bw, bh);
  const dados = busca.ctx.getImageData(0, 0, bw, bh).data;
  c.width = c.height = busca.c.width = busca.c.height = 0;
  const achado = await acharBordas(dados, bw, bh).catch(() => null);
  const inteira: Quad = [{ x: 0, y: 0 }, { x: fw, y: 0 }, { x: fw, y: fh }, { x: 0, y: fh }];
  const quad = achado ? escalar(achado.quad, fw / bw) : inteira;
  return {
    id: `e${++seq}`, nome: arquivo.name, arquivo, heic, fw, fh, quad, auto: quad, achou: !!achado,
    confianca: achado?.confianca ?? 0, giro: 0, previa, pw, ph, miniatura: null,
  };
}

/** Pixels de uma foto (inteira ou a prévia), para o Worker. */
async function pixels(fonte: Blob, w: number, h: number): Promise<Uint8ClampedArray> {
  const bmp = await decodificar(fonte, w, h);
  const { c, ctx } = novoCanvas(w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const d = ctx.getImageData(0, 0, w, h).data;
  c.width = c.height = 0;
  return d;
}

function medidasFolha(p: Pagina, foto: { w: number; h: number }, lado: number) {
  const quad = escalar(p.quad, foto.w / p.fw);
  const t = tamanhoFolha(quad, foto.w, foto.h, lado);
  const deitar = p.giro % 2 === 1;
  return { quad, larg: deitar ? t.alt : t.larg, alt: deitar ? t.larg : t.alt, razao: deitar ? 1 / t.razao : t.razao };
}

async function fazerMiniatura(p: Pagina) {
  const m = medidasFolha(p, { w: p.pw, h: p.ph }, LADO_MINIATURA);
  const foto = await pixels(p.previa, p.pw, p.ph);
  const px = (await fazerFolha({ foto, fw: p.pw, fh: p.ph, quad: m.quad, giro: p.giro, larg: m.larg, alt: m.alt, modo, bits: false })) as Uint8ClampedArray;
  const { c, ctx } = novoCanvas(m.larg, m.alt);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer), m.larg, m.alt), 0, 0);
  const blob = await paraBlob(c, 0.85);
  c.width = c.height = 0;
  if (p.miniatura) URL.revokeObjectURL(p.miniatura);
  p.miniatura = URL.createObjectURL(blob);
}

// miniaturas refeitas em fila, uma por vez (giro, cantos, modo)
const fila = new Set<string>();
let andando = false;
function refazer(ids: string[]) {
  ids.forEach((id) => fila.add(id));
  if (andando) return;
  andando = true;
  (async () => {
    while (fila.size) {
      const id = fila.values().next().value as string;
      fila.delete(id);
      const p = paginas.find((x) => x.id === id);
      if (!p) continue;
      try {
        await fazerMiniatura(p);
      } catch (e) {
        console.error(e);
      }
      trocarMiniatura(p);
    }
    andando = false;
  })();
}

export async function adicionarFotosDocumento(recebidos: File[], daCamera = false) {
  if (gerando) {
    mostrarErro('Espere o PDF terminar para adicionar mais folhas.');
    return;
  }
  esconderErro();
  const arquivos = recebidos.filter(ehImagem);
  const recusados = recebidos.length - arquivos.length;
  const avisos: string[] = [];
  if (recusados) avisos.push(`${recusados === 1 ? '1 arquivo não é foto e ficou' : `${recusados} arquivos não são foto e ficaram`} de fora.${recebidos.some((f) => /\.pdf$/i.test(f.name)) ? ' PDF vai na aba Juntar PDFs.' : ''}`);
  if (arquivos.length) {
    limparResultado();
    if (!daCamera) arquivos.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
    abrindo += arquivos.length;
    atualizar();
    const falhas: string[] = [];
    let ultima: Pagina | null = null;
    for (const a of arquivos) {
      try {
        const p = await abrirPagina(a);
        await fazerMiniatura(p).catch((e) => console.error(e));
        paginas.push(p);
        ultima = p;
      } catch (e) {
        console.error(e);
        falhas.push(a.name);
      } finally {
        abrindo--;
        desenhar();
      }
    }
    if (falhas.length) avisos.push(`Não deu para abrir: ${falhas.join(', ')}.`);
    const conferir = paginas.filter((p) => p.confianca < CONFIRA).length;
    if (!daCamera && conferir) avisos.push(conferir === 1 ? '1 folha está marcada para conferir os cantos.' : `${conferir} folhas estão marcadas para conferir os cantos.`);
    // foto tirada agora: abre o ajuste para conferir os cantos na hora
    if (daCamera && ultima && arquivos.length === 1) abrirEditor(ultima.id);
  }
  if (avisos.length) mostrarErro(avisos.join(' '));
}

// ---------- grade ----------
const ICONE = {
  antes: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>',
  depois: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>',
  ajustar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg>',
  girar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>',
  tirar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>',
};

function desenhar() {
  el.grade.replaceChildren(...paginas.map(cartao));
  for (let i = 0; i < abrindo; i++) {
    const li = document.createElement('li');
    li.className = 'foto carregando';
    li.innerHTML = '<div class="quadro"></div><div class="pe"><span class="nome">Endireitando…</span></div>';
    el.grade.append(li);
  }
  atualizar();
}

function cartao(p: Pagina, i: number): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'foto pag';
  li.dataset.id = p.id;
  const n = i + 1;
  li.innerHTML = `
    <button type="button" class="quadro" data-acao="ajustar" aria-label="Ajustar os cantos da folha ${n}"><img alt="" decoding="async" /></button>
    <span class="n" aria-hidden="true">${n}</span>
    ${p.confianca < CONFIRA ? '<span class="selo">Confira os cantos</span>' : ''}
    <div class="pe pe-pag">
      <button type="button" class="icone-btn" data-acao="antes" title="Para antes"${i === 0 ? ' disabled' : ''}>${ICONE.antes}</button>
      <button type="button" class="icone-btn" data-acao="depois" title="Para depois"${i === paginas.length - 1 ? ' disabled' : ''}>${ICONE.depois}</button>
      <button type="button" class="icone-btn" data-acao="ajustar" title="Ajustar cantos">${ICONE.ajustar}</button>
      <button type="button" class="icone-btn" data-acao="girar" title="Girar">${ICONE.girar}</button>
      <button type="button" class="icone-btn tirar" data-acao="tirar" title="Tirar">${ICONE.tirar}</button>
    </div>`;
  li.querySelectorAll<HTMLButtonElement>('.pe button').forEach((b) => b.setAttribute('aria-label', `${b.title}: folha ${n}`));
  const img = li.querySelector('img') as HTMLImageElement;
  if (p.miniatura) img.src = p.miniatura;
  return li;
}

function trocarMiniatura(p: Pagina) {
  const img = el.grade.querySelector<HTMLImageElement>(`[data-id="${p.id}"] img`);
  if (img && p.miniatura) img.src = p.miniatura;
}

el.grade.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-acao]');
  const id = btn?.closest<HTMLElement>('.pag')?.dataset.id;
  const k = paginas.findIndex((p) => p.id === id);
  if (!btn || k < 0 || gerando) return;
  const acao = btn.dataset.acao;
  const p = paginas[k];
  if (acao === 'ajustar') {
    abrirEditor(p.id);
    return;
  }
  limparResultado();
  if (acao === 'girar') {
    p.giro = (p.giro + 1) % 4;
    refazer([p.id]);
    btn.focus();
    return;
  }
  if (acao === 'tirar') {
    paginas.splice(k, 1);
    if (p.miniatura) URL.revokeObjectURL(p.miniatura);
    desenhar();
    el.mover.textContent = `Folha ${k + 1} saiu.`;
    const prox = paginas[Math.min(k, paginas.length - 1)];
    if (prox) focarBotao(prox.id, 'tirar');
    else el.camera.focus();
    return;
  }
  const para = k + (acao === 'antes' ? -1 : 1);
  paginas.splice(k, 1);
  paginas.splice(para, 0, p);
  desenhar();
  el.mover.textContent = `Folha movida para a posição ${para + 1} de ${paginas.length}.`;
  focarBotao(p.id, acao as string);
});

function focarBotao(id: string, acao: string) {
  const b = (a: string) => el.grade.querySelector<HTMLButtonElement>(`[data-id="${id}"] .pe [data-acao="${a}"]`);
  const alvo = b(acao);
  (alvo?.disabled ? b(acao === 'antes' ? 'depois' : 'antes') : alvo)?.focus();
}

const ordenador = Sortable.create(el.grade, {
  animation: 180,
  easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
  filter: '.carregando, .pe button',
  preventOnFilter: false,
  delay: 180,
  delayOnTouchOnly: true,
  ghostClass: 'fantasma',
  chosenClass: 'escolhida',
  onEnd: () => {
    const mapa = new Map(paginas.map((p) => [p.id, p]));
    paginas = Array.from(el.grade.querySelectorAll<HTMLElement>('.pag')).map((li) => mapa.get(li.dataset.id as string)).filter(Boolean) as Pagina[];
    limparResultado();
    desenhar();
  },
});

// ---------- barra ----------
function atualizar() {
  const tem = paginas.length > 0 || abrindo > 0;
  el.secao.classList.toggle('tem', tem);
  el.soltarTitulo.textContent = tem ? 'Arraste mais fotos para cá' : 'Arraste as fotos do documento para cá';
  el.barra.hidden = !tem;
  el.dica.hidden = paginas.length === 0;
  const n = paginas.length;
  const b = document.createElement('b');
  b.textContent = `${n} ${n === 1 ? 'folha' : 'folhas'}`;
  el.contagem.replaceChildren(b, abrindo ? ` · endireitando ${abrindo}…` : '');
  el.gerar.disabled = gerando || abrindo > 0 || n === 0;
  el.gerar.textContent = abrindo ? 'Endireitando…' : n ? `Gerar PDF com ${n} ${n === 1 ? 'folha' : 'folhas'}` : 'Gerar PDF';
  el.mais.disabled = el.limpar.disabled = gerando || abrindo > 0;
}

el.camera.addEventListener('change', () => {
  const a = Array.from(el.camera.files ?? []);
  el.camera.value = '';
  if (a.length) adicionarFotosDocumento(a, true);
});
el.escolher.addEventListener('change', () => {
  const a = Array.from(el.escolher.files ?? []);
  el.escolher.value = '';
  if (a.length) adicionarFotosDocumento(a);
});
el.mais.addEventListener('click', () => el.escolher.click());
el.limpar.addEventListener('click', () => {
  if (paginas.length > 3 && !confirm(`Tirar as ${paginas.length} folhas?`)) return;
  paginas.forEach((p) => p.miniatura && URL.revokeObjectURL(p.miniatura));
  paginas = [];
  limparResultado();
  esconderErro();
  desenhar();
  el.camera.focus();
});
document.querySelectorAll<HTMLInputElement>('input[name="e-modo"]').forEach((r) =>
  r.addEventListener('change', () => {
    modo = r.value as Modo;
    el.nota.textContent = NOTAS[modo];
    try {
      localStorage.setItem('fotos-pdf:escaner', modo);
    } catch {
      /* sem armazenamento: tudo bem */
    }
    limparResultado();
    refazer(paginas.map((p) => p.id));
  }),
);
el.nome.placeholder = nomeArquivo('', new Date(), PADRAO).replace(/\.pdf$/, '');
el.nome.addEventListener('input', limparResultado);

// ---------- ajuste dos cantos ----------
let editando: Pagina | null = null;
let rascunho: Quad | null = null;
let arrastando = -1;
let urlEditor: string | null = null;
let lupaImg: ImageBitmap | null = null;

function abrirEditor(id: string) {
  const p = paginas.find((x) => x.id === id);
  if (!p) return;
  editando = p;
  rascunho = p.quad.map((c) => ({ ...c })) as Quad;
  if (urlEditor) URL.revokeObjectURL(urlEditor);
  urlEditor = URL.createObjectURL(p.previa);
  el.edImg.src = urlEditor;
  el.edSvg.setAttribute('viewBox', `0 0 ${p.fw} ${p.fh}`);
  el.edAviso.hidden = p.confianca >= CONFIRA;
  el.edAviso.textContent = p.achou ? 'Não tenho certeza das bordas desta foto: confira os cantos.' : 'Não achei as bordas: arraste os cantos até o papel.';
  createImageBitmap(p.previa).then((b) => (lupaImg = b), () => (lupaImg = null));
  desenharEditor();
  el.editor.showModal();
  cantos[0].focus();
}

function desenharEditor() {
  if (!editando || !rascunho) return;
  el.edForma.setAttribute('points', rascunho.map((c) => `${c.x},${c.y}`).join(' '));
  rascunho.forEach((c, i) => {
    cantos[i].style.left = `${(c.x / editando!.fw) * 100}%`;
    cantos[i].style.top = `${(c.y / editando!.fh) * 100}%`;
  });
}

function pontoDaTela(cx: number, cy: number): Ponto {
  const r = el.edImg.getBoundingClientRect();
  const p = editando as Pagina;
  return {
    x: Math.max(0, Math.min(p.fw, ((cx - r.left) / r.width) * p.fw)),
    y: Math.max(0, Math.min(p.fh, ((cy - r.top) / r.height) * p.fh)),
  };
}

function mostrarLupa(i: number) {
  const p = editando;
  if (!p || !rascunho || !lupaImg) return;
  const c = el.edLupa;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const r = el.edImg.getBoundingClientRect();
  const zoom = 3 * (r.width / p.fw) * (p.fw / p.pw); // pixels da prévia por pixel da lupa
  const lado = c.width / zoom;
  const px = (rascunho[i].x / p.fw) * p.pw;
  const py = (rascunho[i].y / p.fh) * p.ph;
  ctx.fillStyle = '#18181B';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(lupaImg, px - lado / 2, py - lado / 2, lado, lado, 0, 0, c.width, c.height);
  ctx.strokeStyle = '#B8462A';
  ctx.lineWidth = 3;
  const m = c.width / 2;
  ctx.beginPath();
  ctx.moveTo(m, m - 22); ctx.lineTo(m, m + 22); ctx.moveTo(m - 22, m); ctx.lineTo(m + 22, m);
  ctx.stroke();
  // lupa do lado oposto ao dedo
  c.classList.toggle('direita', rascunho[i].x < p.fw / 2);
  c.hidden = false;
}

el.edFoto.addEventListener('pointerdown', (e) => {
  if (!editando || !rascunho) return;
  const alvo = (e.target as HTMLElement).closest<HTMLButtonElement>('.canto');
  let i = alvo ? cantos.indexOf(alvo) : -1;
  if (i < 0) {
    // toque perto de um canto também pega o canto (o dedo é grande)
    const pt = pontoDaTela(e.clientX, e.clientY);
    const r = el.edImg.getBoundingClientRect();
    const escala = r.width / editando.fw;
    let melhor = 56;
    rascunho.forEach((c, k) => {
      const d = Math.hypot(c.x - pt.x, c.y - pt.y) * escala;
      if (d < melhor) { melhor = d; i = k; }
    });
  }
  if (i < 0) return;
  e.preventDefault();
  arrastando = i;
  el.edFoto.setPointerCapture(e.pointerId);
  cantos[i].focus({ preventScroll: true });
  mostrarLupa(i);
});
el.edFoto.addEventListener('pointermove', (e) => {
  if (arrastando < 0 || !rascunho) return;
  rascunho[arrastando] = pontoDaTela(e.clientX, e.clientY);
  desenharEditor();
  mostrarLupa(arrastando);
});
const soltar = () => {
  arrastando = -1;
  el.edLupa.hidden = true;
};
el.edFoto.addEventListener('pointerup', soltar);
el.edFoto.addEventListener('pointercancel', soltar);

cantos.forEach((c, i) =>
  c.addEventListener('keydown', (e) => {
    if (!editando || !rascunho) return;
    const passo = ((e.shiftKey ? 10 : 1) * editando.fw) / el.edImg.getBoundingClientRect().width;
    const d: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    const p = rascunho[i];
    rascunho[i] = { x: Math.max(0, Math.min(editando.fw, p.x + m[0] * passo)), y: Math.max(0, Math.min(editando.fh, p.y + m[1] * passo)) };
    desenharEditor();
  }),
);

el.edInteira.addEventListener('click', () => {
  if (!editando) return;
  const { fw, fh } = editando;
  rascunho = [{ x: 0, y: 0 }, { x: fw, y: 0 }, { x: fw, y: fh }, { x: 0, y: fh }];
  desenharEditor();
});
el.edAuto.addEventListener('click', () => {
  if (!editando) return;
  rascunho = editando.auto.map((c) => ({ ...c })) as Quad;
  desenharEditor();
});
el.edCancelar.addEventListener('click', () => el.editor.close());
el.edPronto.addEventListener('click', () => {
  if (editando && rascunho) {
    if (!valido(rascunho)) {
      el.edAviso.hidden = false;
      el.edAviso.textContent = 'Os cantos se cruzaram. Deixe um em cada canto do papel.';
      return;
    }
    editando.quad = rascunho;
    editando.confianca = 1; // a pessoa conferiu
    limparResultado();
    desenhar();
    refazer([editando.id]);
  }
  el.editor.close();
});
el.editor.addEventListener('close', () => {
  const id = editando?.id;
  editando = null;
  rascunho = null;
  lupaImg?.close();
  lupaImg = null;
  el.edLupa.hidden = true;
  if (id) el.grade.querySelector<HTMLButtonElement>(`[data-id="${id}"] .pe [data-acao="ajustar"]`)?.focus();
});

// ---------- gerar ----------
el.gerar.addEventListener('click', async () => {
  if (!paginas.length || gerando || abrindo) return;
  gerando = true;
  const lista = paginas.map((p) => ({ ...p }));
  const modoPdf = modo;
  el.grade.inert = true;
  ordenador.option('disabled', true);
  esconderErro();
  limparResultado();
  atualizar();
  el.progresso.hidden = false;
  el.gerar.textContent = 'Gerando…';
  const nome = nomeArquivo(el.nome.value, new Date(), PADRAO);
  try {
    const { montarPdf } = await import('./escaner/pdf-escaner');
    const folhas = [];
    for (let i = 0; i < lista.length; i++) {
      el.cheio.style.width = `${Math.round((i / lista.length) * 100)}%`;
      el.progressoTexto.textContent = `Preparando folha ${i + 1} de ${lista.length}`;
      const p = lista[i];
      const fonte: Blob = p.heic ? await deHeic(p.arquivo) : p.arquivo;
      const t = limitarPixels({ larg: p.fw, alt: p.fh }); // o iPhone não desenha canvas acima de ~16 MP
      const foto = await pixels(fonte, t.larg, t.alt);
      const m = medidasFolha(p, { w: t.larg, h: t.alt }, LADO_FOLHA[modoPdf]);
      const r = await fazerFolha({ foto, fw: t.larg, fh: t.alt, quad: m.quad, giro: p.giro, larg: m.larg, alt: m.alt, modo: modoPdf, bits: modoPdf === 'pb' });
      if (modoPdf === 'pb') {
        folhas.push({ tipo: 'bits' as const, bytes: r as Uint8Array, larg: m.larg, alt: m.alt, razao: m.razao });
      } else {
        const { c, ctx } = novoCanvas(m.larg, m.alt);
        ctx.putImageData(new ImageData(new Uint8ClampedArray(r.buffer as ArrayBuffer), m.larg, m.alt), 0, 0);
        const blob = await paraBlob(c, modoPdf === 'original' ? 0.85 : modoPdf === 'cinza' ? 0.78 : 0.8);
        c.width = c.height = 0;
        folhas.push({ tipo: 'jpg' as const, bytes: new Uint8Array(await blob.arrayBuffer()), larg: m.larg, alt: m.alt, razao: m.razao });
      }
    }
    el.cheio.style.width = '100%';
    el.progressoTexto.textContent = 'Juntando o PDF…';
    const bytes = await montarPdf(folhas, nome.replace(/\.pdf$/, ''));
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    ultimoPdf = URL.createObjectURL(blob);
    el.baixar.href = ultimoPdf;
    el.baixar.download = nome;
    el.baixar.click();
    el.resNome.textContent = `${nome} baixado`;
    el.resNum.textContent = `${lista.length} ${lista.length === 1 ? 'folha' : 'folhas'}, ${tamanhoTexto(blob.size)}.`;
    el.resultado.hidden = false;
    el.baixar.focus({ preventScroll: true });
    el.resultado.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  } catch (err) {
    console.error(err);
    mostrarErro('Não deu para gerar o PDF. Se forem muitas folhas, tente em partes ou use Preto e branco.');
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
