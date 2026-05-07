'use client';

/**
 * useNotificationAlerts — escuta a coleção `notifications/` filtrada pelo
 * usuário logado e dispara alertas (som + desktop) pra notificações novas.
 *
 * "Novas" = createdAt > timestamp do mount AND id não visto antes. Isso
 * evita disparar alerts pra notificações antigas quando a hook monta
 * (ex: page reload com 5 notifs pendentes — o usuário NÃO recebe 5 dings).
 *
 * Mountado UMA VEZ no layout autenticado. Multi-tab dedup via localStorage:
 * tabs concorrentes do mesmo usuário verificam um timestamp por notif-id e
 * skipam se outra tab já disparou recente.
 */

import { useEffect, useRef } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import {
  playNotificationBlip,
  showDesktopNotification,
  isDesktopNotificationSupported,
} from '@/lib/utils/notification-alerts';
import { useNotificationPrefs, type NotificationPrefs } from '@/lib/utils/notification-prefs';
import { claimGlobalBeepSlot } from '@/lib/utils/notification-throttle';

// ─── Multi-tab dedup ────────────────────────────────────────────────────────

const DEDUP_KEY = 'aevo:notif-last-alerts';
const DEDUP_WINDOW_MS = 2000;
const DEDUP_GC_MS = DEDUP_WINDOW_MS * 5; // entries > 10s viram garbage

/** Retorna true se essa tab é a "primeira" disparando esse notifId no
 *  window de DEDUP_WINDOW_MS. Usa localStorage como mutex frouxo entre tabs.
 *  Não é atomic, mas a janela curta + comparação evita dings duplicados em
 *  99% dos casos. Falha = fallback pra fire (no overlap, just slightly
 *  duplicate UX, não data loss). */
function claimAlertSlot(notifId: string): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = localStorage.getItem(DEDUP_KEY);
    const map: Record<string, number> = raw ? JSON.parse(raw) : {};
    const now = Date.now();

    // GC: limpa entries muito antigas pra map não crescer indefinidamente.
    for (const k of Object.keys(map)) {
      if (now - map[k] > DEDUP_GC_MS) delete map[k];
    }

    if (map[notifId] && now - map[notifId] < DEDUP_WINDOW_MS) {
      return false; // outra tab já fired recentemente
    }

    map[notifId] = now;
    localStorage.setItem(DEDUP_KEY, JSON.stringify(map));
    return true;
  } catch {
    // localStorage cheio/bloqueado → não suprime
    return true;
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

const SEEN_IDS_MAX = 100;
const SEEN_IDS_PRUNE_TO = 50;

export function useNotificationAlerts(): void {
  const { user, business } = useAuth();
  const [prefs] = useNotificationPrefs();

  const mountedAtRef = useRef<number>(Date.now());
  const seenIdsRef = useRef<Set<string>>(new Set());
  // Ref pra prefs — `send` lê o valor mais novo sem precisar reanexar listener
  // a cada toggle (evita derrubar a subscription quando user clica nos icons).
  const prefsRef = useRef<NotificationPrefs>(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    if (!user?.uid || !business?.id) return;

    // Reset state ao mudar de business/usuário — IDs e timestamp do tenant
    // anterior não deveriam interferir no novo.
    mountedAtRef.current = Date.now();
    seenIdsRef.current = new Set();

    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', user.uid),
      where('businessId', '==', business.id),
      orderBy('createdAt', 'desc'),
      limit(20),
    );

    const unsub = onSnapshot(q, snap => {
      // docChanges pega só deltas — first snapshot vem com 'added' pra todos
      // os existentes; filtramos pelo createdAt < mountedAt pra não disparar.
      for (const change of snap.docChanges()) {
        if (change.type !== 'added') continue;
        const data = change.doc.data() as { title?: string; body?: string; createdAt?: string };
        const createdAtMs = data.createdAt ? new Date(data.createdAt).getTime() : 0;
        if (createdAtMs < mountedAtRef.current) continue;
        if (seenIdsRef.current.has(change.doc.id)) continue;

        // Multi-tab: outra tab pode ter disparado esse alerta nos últimos 2s.
        if (!claimAlertSlot(change.doc.id)) {
          seenIdsRef.current.add(change.doc.id);
          continue;
        }

        seenIdsRef.current.add(change.doc.id);
        // Prune se Set crescer demais — Sets em JS preservam insertion order,
        // então slice(-N) pega os N mais recentes.
        if (seenIdsRef.current.size > SEEN_IDS_MAX) {
          const arr = Array.from(seenIdsRef.current);
          seenIdsRef.current = new Set(arr.slice(-SEEN_IDS_PRUNE_TO));
        }

        const currentPrefs = prefsRef.current;
        // Throttle global (compartilhado com useConversationsAlerts) só é
        // consumido quando vamos efetivamente beepar — desktop notification
        // não conta. Evita double-beep quando notif system + msg nova
        // chegam juntas, sem suprimir o desktop alert do outro hook.
        if (currentPrefs.soundEnabled && claimGlobalBeepSlot()) {
          playNotificationBlip();
        }
        if (currentPrefs.desktopEnabled && isDesktopNotificationSupported()) {
          showDesktopNotification({
            title: data.title ?? 'Nova notificação',
            body: data.body,
            tag: change.doc.id,
            skipIfFocused: true,
          });
        }
      }
    }, err => {
      console.error('[useNotificationAlerts] subscription error:', err);
    });

    return () => unsub();
  }, [user?.uid, business?.id]);
}
