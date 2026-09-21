'use client';

import { useEffect } from 'react';
import { startInstallPromptCapture } from '@/lib/pwa/installPrompt';

/**
 * Registra o service worker (public/sw.js) e captura o convite de instalação. Só em produção: em
 * `next dev` o SW atrapalharia o hot reload. Service worker exige HTTPS (ou localhost) — em
 * `http://IP-da-rede` o registro é recusado e o app segue funcionando normalmente, só sem instalação.
 */
export default function PwaRegister() {
  useEffect(() => {
    startInstallPromptCapture();

    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker
        // `none`: o navegador nunca usa o cache HTTP pra checar atualização do sw.js.
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .catch((error) => console.warn('[PWA] service worker não registrado:', error));
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
