// Worker: as contas pesadas do escâner rodam aqui, sem travar a tela.
import { acharBordas, fazerFolha, type PedidoFolha } from './motor';

self.onmessage = (e: MessageEvent) => {
  const { id, tipo, dados } = e.data;
  try {
    if (tipo === 'achar') {
      const { rgba, w, h } = dados;
      (self as unknown as Worker).postMessage({ id, ok: acharBordas(rgba, w, h) });
    } else {
      const r = fazerFolha(dados as PedidoFolha);
      (self as unknown as Worker).postMessage({ id, ok: r }, [r.buffer]);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, erro: String(err) });
  }
};
