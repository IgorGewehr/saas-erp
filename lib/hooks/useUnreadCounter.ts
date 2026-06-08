'use client';

/**
 * useUnreadCounter — lê o doc denormalizado `unreadCounters/{businessId}` para
 * alimentar os BADGES de mensagens não-lidas (Sidebar/Dashboard) com 1 único
 * onSnapshot, em vez de um full-scan da coleção `conversations`.
 *
 * Escopo do badge (ver lib/contracts/domain/unreadCounter.ts §badge):
 *   - admin/founder → `total` (vê tudo do tenant)
 *   - demais        → `business + (byUser[uid] || 0)` (canais business + pessoais próprios)
 *
 * Escrita do doc é SOMENTE server-side (Admin SDK, no webhook/markAsRead).
 * Rules: read se membro do tenant; write: if false. Aqui só lemos.
 *
 * Fail-soft: erro de snapshot mantém o último valor visível (não zera o badge
 * durante outage curta). `loading` vira false na 1ª resposta (ou erro).
 */

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { UnreadCounterSchema } from '@/lib/contracts/domain/unreadCounter';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { UserRole } from '@/lib/types';

interface UseUnreadCounterArgs {
  businessId?: string;
  uid?: string;
  role?: UserRole;
}

interface UseUnreadCounterResult {
  /** Contagem de não-lidas no escopo do usuário atual. */
  count: number;
  loading: boolean;
}

export function useUnreadCounter({ businessId, uid, role }: UseUnreadCounterArgs): UseUnreadCounterResult {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const isAdmin = ROLE_HIERARCHY[role ?? 'viewer'] >= ROLE_HIERARCHY['admin'];

  useEffect(() => {
    if (!businessId || !uid) {
      setCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ref = doc(db, 'unreadCounters', businessId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setCount(0);
          setLoading(false);
          return;
        }
        const parsed = UnreadCounterSchema.safeParse(snap.data());
        if (!parsed.success) {
          // Doc malformado/legado — fail-soft, não derruba o badge.
          console.warn('[useUnreadCounter] invalid unreadCounters doc:', parsed.error.issues);
          setLoading(false);
          return;
        }
        const data = parsed.data;
        const next = isAdmin
          ? data.total
          : data.business + (data.byUser[uid] ?? 0);
        setCount(Math.max(0, next));
        setLoading(false);
      },
      (err) => {
        // Fail-soft: mantém último valor visível durante outage curta.
        console.warn('[useUnreadCounter] snapshot error:', err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [businessId, uid, isAdmin]);

  return { count, loading };
}
