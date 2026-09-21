/*
 * Aevo — service worker MÍNIMO.
 *
 * Serve pra duas coisas: (1) o navegador considerar o app instalável e (2) trocar a tela de erro do
 * navegador por uma página "Sem conexão" quando a rede cai numa navegação.
 *
 * NÃO faz cache de páginas, dados nem API, de propósito: o ERP é dinâmico e autenticado, e servir
 * uma cópia velha (preço, estoque, financeiro) seria pior do que avisar que está sem internet.
 * Só intercepta navegações GET da mesma origem; todo o resto (API, Firebase, imagens, /_next)
 * segue direto pra rede, sem passar por aqui.
 */

const CACHE = 'aevo-offline-v1';
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('aevo-') && key !== CACHE).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.mode !== 'navigate' || request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()),
  );
});
