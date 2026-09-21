import type { MetadataRoute } from 'next';

/**
 * Manifest do PWA (servido em /manifest.webmanifest e linkado pelo Next no <head>).
 *
 * `start_url: '/'` — a raiz já decide pra onde ir (/app logado, /login deslogado). `scope: '/'` porque
 * o login (/login) precisa ficar DENTRO do escopo: fora dele o iOS abre uma barra de navegador em
 * cima do app instalado.
 * Ícones em public/icons (gerados por scripts/generate-pwa-icons.mjs).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Aevo — Gestão Inteligente',
    short_name: 'Aevo',
    description: 'Gestão, CRM omnichannel, financeiro e catálogo no mesmo lugar.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#ffffff',
    theme_color: '#dc2626',
    lang: 'pt-BR',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
