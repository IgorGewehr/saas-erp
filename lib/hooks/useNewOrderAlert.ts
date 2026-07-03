'use client';

/**
 * useNewOrderAlert — alerta de cozinha para pedidos novos na vertical cardápio.
 *
 * Enquanto houver pedidos novos (`newCount > 0`) e o som estiver ligado, toca
 * um BEEP curto em loop (~4s) via Web Audio API — sem asset externo. Quando
 * `newCount` sobe (chegou pedido), dispara uma Notification desktop.
 *
 * Autoplay: browsers bloqueiam áudio até a 1ª interação do usuário. Por isso o
 * som só começa depois que o operador ligou o toggle (que roda sob clique) — a
 * partir daí o AudioContext é retomado com segurança.
 *
 * SSR-safe: window/AudioContext/Notification só são tocados dentro de efeitos
 * client. Nada é acessado no corpo do render.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const BEEP_INTERVAL_MS = 4000;
const BEEP_DURATION_S = 0.18;
const BEEP_FREQ_HZ = 880;
const BEEP_GAIN = 0.15;

type NotifPermission = 'default' | 'granted' | 'denied' | 'unsupported';

interface UseNewOrderAlertOptions {
  enabled?: boolean;
}

interface UseNewOrderAlertResult {
  soundOn: boolean;
  toggleSound: () => void;
  notifPermission: NotifPermission;
  requestNotif: () => Promise<void>;
}

// ─── Web Audio ───────────────────────────────────────────────────────────────

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ??
    null
  );
}

/** Toca um beep único. Cria oscillator+gain descartáveis (não reusa nodes,
 *  que são one-shot por design). Envelope de gain evita cliques audíveis. */
function playBeep(ctx: AudioContext): void {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(BEEP_FREQ_HZ, now);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(BEEP_GAIN, now + 0.01);
  gain.gain.linearRampToValueAtTime(0, now + BEEP_DURATION_S);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + BEEP_DURATION_S + 0.02);
}

// ─── Notification ────────────────────────────────────────────────────────────

function readNotifPermission(): NotifPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as NotifPermission;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useNewOrderAlert(
  newCount: number,
  opts?: UseNewOrderAlertOptions,
): UseNewOrderAlertResult {
  const enabled = opts?.enabled ?? true;

  const [soundOn, setSoundOn] = useState(false);
  const [notifPermission, setNotifPermission] = useState<NotifPermission>('default');

  const audioCtxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevCountRef = useRef<number>(newCount);
  const settledRef = useRef<boolean>(false);

  // Sincroniza permissão real do browser no mount (client-only).
  useEffect(() => {
    setNotifPermission(readNotifPermission());
  }, []);

  const clearBeepLoop = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const requestNotif = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotifPermission('unsupported');
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setNotifPermission(result as NotifPermission);
    } catch {
      setNotifPermission(readNotifPermission());
    }
  }, []);

  const toggleSound = useCallback(() => {
    setSoundOn(prev => {
      const next = !prev;
      if (next) {
        // Sob interação do usuário: cria/retoma o AudioContext (desbloqueia
        // autoplay) e, de brinde, pede permissão de notificação.
        const Ctor = getAudioContextCtor();
        if (Ctor) {
          if (!audioCtxRef.current) audioCtxRef.current = new Ctor();
          void audioCtxRef.current.resume().catch(() => {});
        }
        if (readNotifPermission() === 'default') void requestNotif();
      }
      return next;
    });
  }, [requestNotif]);

  // Loop de beep: ativo enquanto houver pedidos novos, som ligado e enabled.
  useEffect(() => {
    const active = enabled && soundOn && newCount > 0;
    if (!active) {
      clearBeepLoop();
      return;
    }
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    void ctx.resume().catch(() => {});
    playBeep(ctx); // toca imediatamente, depois em loop
    intervalRef.current = setInterval(() => {
      if (audioCtxRef.current) playBeep(audioCtxRef.current);
    }, BEEP_INTERVAL_MS);

    return clearBeepLoop;
  }, [enabled, soundOn, newCount, clearBeepLoop]);

  // Desktop notification: dispara quando o count SOBE (novo pedido chegou).
  useEffect(() => {
    const prev = prevCountRef.current;
    prevCountRef.current = newCount;

    if (!enabled) return;
    // Baseline: ignora o 1º assentamento (load inicial do snapshot pode trazer
    // pedidos 'recebido' JÁ existentes — não são "novos", não devem notificar).
    if (!settledRef.current) { settledRef.current = true; return; }
    if (newCount <= prev) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    try {
      const delta = newCount - prev;
      new Notification('Novo pedido!', {
        body: delta > 1 ? `${delta} novos pedidos na cozinha` : 'Um novo pedido chegou na cozinha',
        tag: 'kitchen-new-order',
        renotify: true,
      } as NotificationOptions);
    } catch {
      // Notification pode lançar em alguns browsers (ex: Android exige SW).
    }
  }, [newCount, enabled]);

  // Cleanup no unmount: para o loop e fecha o AudioContext.
  useEffect(() => {
    return () => {
      clearBeepLoop();
      const ctx = audioCtxRef.current;
      audioCtxRef.current = null;
      if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
    };
  }, [clearBeepLoop]);

  return { soundOn, toggleSound, notifPermission, requestNotif };
}
