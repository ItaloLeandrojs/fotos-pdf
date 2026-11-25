// Fala com o Worker. Se o navegador não deixar criar o Worker, faz a conta aqui mesmo (mais lento, mas funciona).
import type { Achado, PedidoFolha } from './motor';

let trabalhador: Worker | null | undefined;
let seq = 0;
const esperando = new Map<number, { ok: (v: unknown) => void; erro: (e: Error) => void }>();

function worker(): Worker | null {
  if (trabalhador !== undefined) return trabalhador;
  try {
    trabalhador = new Worker(new URL('./trabalho.ts', import.meta.url), { type: 'module' });
    trabalhador.onmessage = (e) => {
      const p = esperando.get(e.data.id);
      if (!p) return;
      esperando.delete(e.data.id);
      if (e.data.erro) p.erro(new Error(e.data.erro));
      else p.ok(e.data.ok);
    };
    trabalhador.onerror = () => {
      // Worker quebrou: tudo que estava esperando falha, e daqui para frente faz aqui mesmo
      esperando.forEach((p) => p.erro(new Error('worker')));
      esperando.clear();
      trabalhador = null;
    };
  } catch {
    trabalhador = null;
  }
  return trabalhador;
}

function pedir<T>(tipo: string, dados: unknown, levar: Transferable[]): Promise<T> {
  const w = worker();
  if (w) {
    return new Promise<T>((ok, erro) => {
      const id = ++seq;
      esperando.set(id, { ok: ok as (v: unknown) => void, erro });
      w.postMessage({ id, tipo, dados }, levar);
    });
  }
  return import('./motor').then((m) => (tipo === 'achar' ? m.acharBordas((dados as { rgba: Uint8ClampedArray }).rgba, (dados as { w: number }).w, (dados as { h: number }).h) : m.fazerFolha(dados as PedidoFolha)) as T);
}

export const acharBordas = (rgba: Uint8ClampedArray, w: number, h: number) => pedir<Achado | null>('achar', { rgba, w, h }, [rgba.buffer]);
export const fazerFolha = (p: PedidoFolha) => pedir<Uint8ClampedArray | Uint8Array>('folha', p, [p.foto.buffer]);
