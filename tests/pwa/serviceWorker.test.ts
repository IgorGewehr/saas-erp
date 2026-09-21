import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Executa public/sw.js de verdade (sem build) num "self" falso e confere as regras que importam:
 * o service worker NUNCA pode servir cópia velha de página/dados — só trocar a falha de rede por
 * "Sem conexão" em navegações da mesma origem.
 */

const SOURCE = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');
const ORIGIN = 'https://app.exemplo.com';

type Handler = (event: Record<string, unknown>) => void;

function loadServiceWorker(options: {
  cacheKeys?: string[];
  cached?: Record<string, Response>;
  fetchImpl?: (request: unknown) => Promise<Response>;
} = {}) {
  const handlers: Record<string, Handler> = {};
  const precached: string[] = [];
  const deleted: string[] = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => { handlers[type] = handler; },
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  };
  const caches = {
    open: async () => ({ addAll: async (urls: string[]) => { precached.push(...urls); } }),
    keys: async () => options.cacheKeys ?? [],
    delete: async (key: string) => { deleted.push(key); return true; },
    match: async (url: string) => options.cached?.[url],
  };
  const fetchImpl = vi.fn(options.fetchImpl ?? (async () => new Response('rede')));

  new Function('self', 'caches', 'fetch', 'Response', 'URL', SOURCE)(self, caches, fetchImpl, Response, URL);
  return { handlers, self, precached, deleted, fetchImpl };
}

async function lifecycle(handler: Handler): Promise<void> {
  const pending: Promise<unknown>[] = [];
  handler({ waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
  await Promise.all(pending);
}

function fetchEvent(request: { mode?: string; method?: string; url: string }) {
  const respondWith = vi.fn();
  return { event: { request: { mode: 'navigate', method: 'GET', ...request }, respondWith }, respondWith };
}

describe('service worker — instalação e limpeza', () => {
  it('pré-carrega SÓ a página offline e o ícone, e assume o controle na hora', async () => {
    const sw = loadServiceWorker();
    await lifecycle(sw.handlers.install);
    expect(sw.precached).toEqual(['/offline.html', '/icons/icon-192.png']);
    expect(sw.self.skipWaiting).toHaveBeenCalled();
  });

  it('ao ativar, apaga caches ANTIGOS do Aevo e não mexe em caches de terceiros', async () => {
    const sw = loadServiceWorker({ cacheKeys: ['aevo-offline-v1', 'aevo-offline-v0', 'aevo-static-old', 'firebase-messaging-cache'] });
    await lifecycle(sw.handlers.activate);
    expect(sw.deleted).toEqual(['aevo-offline-v0', 'aevo-static-old']);
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });
});

describe('service worker — navegação', () => {
  it('rede ok: entrega a resposta da REDE (nunca cópia guardada)', async () => {
    const live = new Response('pagina-ao-vivo');
    const sw = loadServiceWorker({ fetchImpl: async () => live, cached: { '/offline.html': new Response('offline') } });
    const { event, respondWith } = fetchEvent({ url: `${ORIGIN}/app` });

    sw.handlers.fetch(event);

    const response = await respondWith.mock.calls[0][0];
    expect(response).toBe(live);
  });

  it('rede caiu: mostra a página "Sem conexão" guardada', async () => {
    const offline = new Response('sem-conexao');
    const sw = loadServiceWorker({
      fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
      cached: { '/offline.html': offline },
    });
    const { event, respondWith } = fetchEvent({ url: `${ORIGIN}/app` });

    sw.handlers.fetch(event);

    expect(await respondWith.mock.calls[0][0]).toBe(offline);
  });

  it('rede caiu e a página offline não está no cache: erro de rede padrão (não trava)', async () => {
    const sw = loadServiceWorker({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
    const { event, respondWith } = fetchEvent({ url: `${ORIGIN}/app` });

    sw.handlers.fetch(event);

    const response = await respondWith.mock.calls[0][0] as Response;
    expect(response.type).toBe('error');
  });
});

describe('service worker — o que NÃO intercepta (segue direto pra rede)', () => {
  const cases: Array<[string, { mode?: string; method?: string; url: string }]> = [
    ['chamada de API (fetch, não navegação)', { mode: 'cors', url: `${ORIGIN}/api/v1/orders` }],
    ['arquivo estático do Next', { mode: 'no-cors', url: `${ORIGIN}/_next/static/chunks/app.js` }],
    ['imagem', { mode: 'no-cors', url: `${ORIGIN}/icons/icon-192.png` }],
    ['envio de formulário (POST) mesmo sendo navegação', { method: 'POST', url: `${ORIGIN}/login` }],
    ['navegação para outra origem', { url: 'https://accounts.google.com/o/oauth2/auth' }],
    ['Firestore/Firebase (outra origem)', { mode: 'cors', url: 'https://firestore.googleapis.com/v1/projects/x' }],
  ];

  it.each(cases)('%s', async (_name, request) => {
    const sw = loadServiceWorker();
    const { event, respondWith } = fetchEvent(request);

    sw.handlers.fetch(event);

    expect(respondWith).not.toHaveBeenCalled();
    expect(sw.fetchImpl).not.toHaveBeenCalled();
  });
});
