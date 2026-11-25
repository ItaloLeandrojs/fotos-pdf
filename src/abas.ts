// As abas do site. O endereço guarda a aba: .../fotos-pdf/#juntar e #escanear abrem direto nelas.
export type Aba = 'fotos' | 'juntar' | 'escanear';

const ABAS: Aba[] = ['fotos', 'juntar', 'escanear'];
const TITULOS: Record<Aba, string> = { fotos: 'Fotos em PDF', juntar: 'Juntar PDFs', escanear: 'Escanear documento' };
const TEXTO_SOLTAR: Record<Aba, string> = { fotos: 'Solte as fotos', juntar: 'Solte os PDFs', escanear: 'Solte as fotos do documento' };
const botao = (a: Aba) => document.getElementById(`aba-${a}`) as HTMLButtonElement;
const painel = (a: Aba) => document.getElementById(`painel-${a}`) as HTMLElement;

let atual: Aba = 'fotos';
export const abaAtual = () => atual;

function mostrar(a: Aba) {
  atual = a;
  for (const x of ABAS) {
    botao(x).setAttribute('aria-selected', String(x === a));
    botao(x).tabIndex = x === a ? 0 : -1;
    painel(x).hidden = x !== a;
  }
  document.title = TITULOS[a];
  (document.querySelector('#cobrir span') as HTMLElement).textContent = TEXTO_SOLTAR[a];
}

const doEndereco = (): Aba => (location.hash === '#juntar' ? 'juntar' : location.hash === '#escanear' ? 'escanear' : 'fotos');

for (const a of ABAS) {
  botao(a).addEventListener('click', () => {
    history.replaceState(null, '', a === 'fotos' ? location.pathname + location.search : `#${a}`);
    mostrar(a);
  });
  botao(a).addEventListener('keydown', (e) => {
    const i = ABAS.indexOf(a);
    const n = ABAS.length;
    const k = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i + n - 1) % n : -1;
    if (k < 0) return;
    const alvo = ABAS[k];
    e.preventDefault();
    botao(alvo).click();
    botao(alvo).focus();
  });
}
window.addEventListener('hashchange', () => mostrar(doEndereco()));
mostrar(doEndereco());

// arrastar arquivos para qualquer lugar da página e colar (Ctrl+V): vão para a aba aberta
export function aoReceberArquivos(receber: (arquivos: File[]) => void) {
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
    if (e.dataTransfer?.files.length) receber(Array.from(e.dataTransfer.files));
  });
  window.addEventListener('paste', (e) => {
    const arquivos = Array.from(e.clipboardData?.files ?? []);
    if (arquivos.length) receber(arquivos);
  });
}
