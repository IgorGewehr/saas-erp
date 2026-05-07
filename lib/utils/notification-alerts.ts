'use client';

/**
 * Funções pra disparar alertas de notificação:
 *   - playNotificationBlip: gera um beep curto via Web Audio API.
 *   - showDesktopNotification: usa Notification API nativa do browser.
 *   - requestDesktopPermission: pede permissão (precisa user gesture).
 *
 * AudioContext é singleton de módulo + unlock automático no primeiro gesto
 * do usuário — browsers modernos suspendem audio até user interagir, e
 * criar/destruir context por chamada (a abordagem ingênua) não funciona
 * porque a primeira chamada vinda de notificação Firestore não tem gesto
 * de user atrelado.
 */

// ─── AudioContext singleton + unlock ────────────────────────────────────────

type AudioCtxCtor = typeof AudioContext;

let sharedCtx: AudioContext | null = null;
let unlockSetup = false;

function getOrCreateAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (sharedCtx) return sharedCtx;
  const Ctor: AudioCtxCtor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtxCtor }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    sharedCtx = new Ctor();
    return sharedCtx;
  } catch {
    return null;
  }
}

/** Registra listeners pra resumir o AudioContext no primeiro user gesture.
 *  Chamado automaticamente no module load (client-side). */
function setupAudioUnlock(): void {
  if (typeof window === 'undefined' || unlockSetup) return;
  unlockSetup = true;
  const unlock = () => {
    const ctx = getOrCreateAudioCtx();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
  };
  // `once: true` por evento — o primeiro click/keydown/touchstart aciona,
  // mas como tipos de evento são separados, pode rodar 1× pra cada tipo.
  // resume() é idempotente, então repetir é seguro.
  window.addEventListener('click', unlock, { once: true, passive: true });
  window.addEventListener('keydown', unlock, { once: true, passive: true });
  window.addEventListener('touchstart', unlock, { once: true, passive: true });
}

setupAudioUnlock();

// ─── Beep ────────────────────────────────────────────────────────────────────

/** Beep curto (~180ms a 880Hz) com fade out. Reusa AudioContext singleton.
 *  Antes do primeiro user gesture o som pode não tocar (autoplay policy);
 *  isso é aceito — usuário acaba clicando em algo no app antes de receber
 *  uma notificação. */
export function playNotificationBlip(): void {
  const ctx = getOrCreateAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    // ctx NÃO é fechado — reuso do singleton ao longo da sessão.
  } catch {
    // Erro de criação de osc/gain (raro) — silencioso.
  }
}

// ─── Desktop Notifications ──────────────────────────────────────────────────

export function isDesktopNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getDesktopPermission(): NotificationPermission | 'unsupported' {
  if (!isDesktopNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

/** Pede permissão. Retorna o estado final. Precisa ser chamada em
 *  resposta a user gesture (click) — Chrome bloqueia chamadas auto. */
export async function requestDesktopPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isDesktopNotificationSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

interface ShowDesktopOpts {
  title: string;
  body?: string;
  /** Tag dedupica notificações no SO (mesma tag substitui a anterior). */
  tag?: string;
  /** Se true, não mostra quando aba do navegador está visível (default true). */
  skipIfFocused?: boolean;
}

export function showDesktopNotification({
  title,
  body,
  tag,
  skipIfFocused = true,
}: ShowDesktopOpts): void {
  if (!isDesktopNotificationSupported()) return;
  if (Notification.permission !== 'granted') return;
  if (skipIfFocused && document.visibilityState === 'visible') return;
  try {
    new Notification(title, {
      body: body ?? '',
      icon: '/favicon.ico',
      tag,
    });
  } catch {
    // Browser pode rejeitar (Safari, alguns mobile) — silencioso.
  }
}
