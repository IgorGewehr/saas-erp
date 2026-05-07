'use client';

/**
 * Preferências de alertas de notificação (som + desktop).
 *
 * Armazenadas em localStorage por escolha de design — o que vale aqui é
 * o **contexto do navegador**: usuário pode querer mute no notebook do
 * trabalho mas alerta no PC pessoal. Sincronizar via Firestore não faz
 * sentido nesse caso.
 *
 * Cross-tab sync: `storage` event nativo cobre tabs diferentes; pra
 * mesma tab usamos um CustomEvent disparado em setNotificationPrefs.
 */

import { useCallback, useEffect, useState } from 'react';

export interface NotificationPrefs {
  /** Toca um beep curto quando chega notificação do sistema (atribuição,
   *  menção, lembrete de tarefa, etc.). */
  soundEnabled: boolean;
  /** Toca um beep quando chega mensagem nova em qualquer conversa do
   *  business (unreadCount aumentando). Separado de `soundEnabled` porque
   *  são naturezas diferentes — atendente pode querer alerta pra "fui
   *  atribuído numa task" mas mute pra mensagens de cliente enquanto está
   *  focado em outra coisa. */
  conversationsSoundEnabled: boolean;
  /** Mostra notificação nativa do SO (browser API). Requer permissão concedida. */
  desktopEnabled: boolean;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  soundEnabled: true,
  conversationsSoundEnabled: true,
  // Falso por padrão — pra ser true precisa permissão do browser concedida.
  // Permissão exige user gesture, então o toggle do TopBar liga isso quando
  // o usuário clica e concede. Antes disso, deixar `true` no localStorage
  // seria mentira (pref ligada mas Notification.permission !== 'granted').
  desktopEnabled: false,
};

const PREFS_KEY = 'aevo:notif-prefs';
const CHANGE_EVENT = 'aevo:notif-prefs-changed';

export function getNotificationPrefs(): NotificationPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setNotificationPrefs(prefs: NotificationPrefs): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  // CustomEvent dispara na mesma tab (storage event só cross-tab). Combinados,
  // todos os useNotificationPrefs() em qualquer tab atualizam.
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: prefs }));
}

/** Hook reativo. Retorna [prefs, update]. */
export function useNotificationPrefs(): [NotificationPrefs, (next: NotificationPrefs) => void] {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    // Inicial — só client-side (defaultPrefs no SSR pra evitar hydration mismatch).
    setPrefs(getNotificationPrefs());
    const handler = () => setPrefs(getNotificationPrefs());
    window.addEventListener('storage', handler);
    window.addEventListener(CHANGE_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener(CHANGE_EVENT, handler as EventListener);
    };
  }, []);

  const update = useCallback((next: NotificationPrefs) => {
    setPrefs(next);
    setNotificationPrefs(next);
  }, []);

  return [prefs, update];
}
