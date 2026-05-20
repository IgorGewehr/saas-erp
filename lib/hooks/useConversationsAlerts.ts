'use client';

/**
 * useConversationsAlerts — escuta a coleção `conversations/` filtrada pelo
 * businessId do usuário e dispara um beep quando uma conversa recebe
 * mensagem nova (unreadCount aumenta).
 *
 * "Mensagem nova" é detectada via comparação de unreadCount entre snapshots
 * consecutivos. Tracking inicial: na primeira snapshot guardamos os valores
 * atuais sem disparar — evita beep em massa quando user faz F5 e tem 50
 * conversas com unreadCount > 0.
 *
 * Throttle: max 1 beep / 3s pra evitar spam quando vários webhooks chegam
 * em rajada (ex: cliente mandou 5 mensagens em 1 segundo).
 *


 * Filtros aplicados:
 *  - snoozedUntil > now → silencia (operador escolheu não receber agora)
 *  - isDeleted → ignora
 *  - lastMessageDirection !== 'inbound' → ignora (filtra "marcar como não
 *    lida" manual via handleMarkUnread, que incrementa unreadCount sem
 *    mexer em lastMessage* — beep falso positivo na auditoria)
 *  - conversa atualmente aberta + aba visível → ignora (operador já está
 *    vendo a thread, beep seria redundante e irritante)
 *  - throttle global compartilhado com useNotificationAlerts → evita
 *    double-beep quando notificação de sistema e msg nova chegam juntas
 *
 * Multi-tab dedup via localStorage (igual useNotificationAlerts) pra evitar
 * 2 tabs do mesmo user beeparem juntas.
 *
 * Visibilidade por setor NÃO é replicada aqui — admin recebe beep de tudo,
 * operador pode receber beep de conversas que nem visualiza no Conversas.
 * Trade-off aceito pra MVP: implementar lógica completa de visibility
 * duplicaria código do ConversasModule. Se virar problema, refinar.
 */

import { useEffect, useRef } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import {
  playNotificationBlip,
  showDesktopNotification,
  isDesktopNotificationSupported,
} from '@/lib/utils/notification-alerts';
import { useNotificationPrefs, type NotificationPrefs } from '@/lib/utils/notification-prefs';
import { isActiveRecord } from '@/lib/utils/recordFilters';
import { getActiveConversation, isTabVisible } from '@/lib/utils/active-conversation';
import { claimGlobalBeepSlot } from '@/lib/utils/notification-throttle';

// ─── Multi-tab dedup ────────────────────────────────────────────────────────

const DEDUP_KEY = 'aevo:convo-last-alerts';
const DEDUP_WINDOW_MS = 2000;
const DEDUP_GC_MS = DEDUP_WINDOW_MS * 5;

function claimAlertSlot(convId: string, msgCounter: number): boolean {
  if (typeof window === 'undefined') return true;
  // Chave inclui o counter pra que o MESMO unread bump em duas tabs seja
  // dedup'd, mas mensagens subsequentes (counter diferente) ainda beepam.
  const slotKey = `${convId}:${msgCounter}`;
  try {
    const raw = localStorage.getItem(DEDUP_KEY);
    const map: Record<string, number> = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    for (const k of Object.keys(map)) {
      if (now - map[k] > DEDUP_GC_MS) delete map[k];
    }
    if (map[slotKey] && now - map[slotKey] < DEDUP_WINDOW_MS) return false;
    map[slotKey] = now;
    localStorage.setItem(DEDUP_KEY, JSON.stringify(map));
    return true;
  } catch {
    return true;
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

const THROTTLE_MS = 3000;

interface ConvoSnapshot {
  unreadCount: number;
  snoozedUntil?: string;
  isDeleted?: boolean;
  contactName?: string;
  lastMessageDirection?: string; // 'inbound' | 'outbound'
}

export function useConversationsAlerts(): void {
  const { user, business } = useAuth();
  const [prefs] = useNotificationPrefs();

  // Estado por-conversa: último unreadCount visto. Sem entry = ainda não
  // viu, na primeira snapshot só popula sem alertar.
  const lastSeenRef = useRef<Map<string, ConvoSnapshot>>(new Map());
  const initializedRef = useRef(false);
  const lastBeepAtRef = useRef(0);
  const prefsRef = useRef<NotificationPrefs>(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    if (!user?.uid || !business?.id) return;

    // Reset state ao mudar de business — counters do tenant anterior não
    // devem virar gatilho de alerta no novo.
    lastSeenRef.current = new Map();
    initializedRef.current = false;
    lastBeepAtRef.current = 0;

    const q = query(
      collection(db, 'conversations'),
      where('businessId', '==', business.id),
    );

    const unsub = onSnapshot(q, snap => {
      const now = Date.now();
      let shouldBeep = false;
      let beepedConv: { id: string; contactName?: string; unreadCount: number } | null = null;

      for (const change of snap.docChanges()) {
        const data = change.doc.data() as ConvoSnapshot;
        const id = change.doc.id;

        if (change.type === 'removed') {
          lastSeenRef.current.delete(id);
          continue;
        }

        // Soneca ativa ou conversa deletada — atualiza state mas não alerta.
        // isActiveRecord cobre ambos formatos (legado isDeleted + novo deletedAt).
        const snoozedActive = data.snoozedUntil && new Date(data.snoozedUntil).getTime() > now;
        const isDeleted = !isActiveRecord(data);
        if (snoozedActive || isDeleted) {
          lastSeenRef.current.set(id, data);
          continue;
        }

        const prev = lastSeenRef.current.get(id);
        const prevUnread = prev?.unreadCount ?? 0;
        const currUnread = data.unreadCount ?? 0;

        // Primeira snapshot: só popula. Evita rajada de beeps no F5.
        if (!initializedRef.current) {
          lastSeenRef.current.set(id, data);
          continue;
        }

        // Beep apenas quando unreadCount AUMENTOU (nova mensagem chegou) E
        // a última mensagem é inbound. Filtra falso positivo de
        // handleMarkUnread (incrementa só unreadCount sem tocar em
        // lastMessage*). Mensagens do operador também não devem beepar
        // (são outbound — nem incrementam unreadCount, mas defesa extra).
        const isInboundBump = currUnread > prevUnread
          && data.lastMessageDirection === 'inbound';

        // Skip se operador já está vendo essa conversa com a aba em foco —
        // beep seria redundante (msg aparece visualmente) e irritante.
        // Quando a aba não está visível, beep ainda é desejável (alerta
        // pra trazer atenção mesmo que conversa esteja "selecionada").
        const isViewingThis = id === getActiveConversation() && isTabVisible();

        if (isInboundBump && !isViewingThis) {
          // Multi-tab dedup: só uma tab beepa por bump.
          if (claimAlertSlot(id, currUnread)) {
            shouldBeep = true;
            beepedConv = { id, contactName: data.contactName, unreadCount: currUnread };
          }
        }

        lastSeenRef.current.set(id, data);
      }

      // Marca inicializado APÓS processar a primeira snapshot.
      if (!initializedRef.current) {
        initializedRef.current = true;
        return;
      }

      if (!shouldBeep || !beepedConv) return;

      // Throttle local (rajadas de webhooks no mesmo hook).
      if (now - lastBeepAtRef.current < THROTTLE_MS) return;
      lastBeepAtRef.current = now;

      const currentPrefs = prefsRef.current;
      // Throttle global só é consumido se vamos beepar de fato — desktop
      // alert sai independente de sound (é canal separado).
      if (currentPrefs.conversationsSoundEnabled && claimGlobalBeepSlot()) {
        playNotificationBlip();
      }
      if (currentPrefs.desktopEnabled && isDesktopNotificationSupported()) {
        showDesktopNotification({
          title: beepedConv.contactName || 'Nova mensagem',
          body: 'Você recebeu uma nova mensagem em Conversas',
          tag: `conv:${beepedConv.id}`,
          skipIfFocused: true,
        });
      }
    }, err => {
      console.error('[useConversationsAlerts] subscription error:', err);
    });

    return () => unsub();
  }, [user?.uid, business?.id]);
}
