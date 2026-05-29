'use client';

/**
 * Cliente do markAsRead canônico server-side.
 *
 * A baixa de `conversations.unreadCount` agora passa SEMPRE pela rota
 * `POST /api/conversations/:id { businessId, action: 'markAsRead' }` para que
 * o decremento do contador denormalizado `unreadCounters/{businessId}`
 * aconteça transacional no server (ver lib/services/unreadCounter.ts e
 * app/api/conversations/[id]/route.ts). Os clients NÃO escrevem mais
 * `unreadCount: 0` direto — senão o contador denormalizado fica drift.
 *
 * Idempotente (R3): a rota lê prevUnread na própria transação; reexecutar é
 * no-op. Falha de rede é não-fatal aqui — o caller decide se faz update
 * otimista de UI; a fonte da verdade do `unreadCount:0` é o server.
 */

import { getAuth } from 'firebase/auth';

async function postConversationAction(
  conversationId: string,
  businessId: string,
  action: 'markAsRead' | 'markUnread',
): Promise<boolean> {
  try {
    const token = await getAuth().currentUser?.getIdToken();
    if (!token) return false;
    const res = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ businessId, action }),
    });
    return res.ok;
  } catch (err) {
    console.warn(`[conversation:${action}] failed:`, err);
    return false;
  }
}

export function markConversationRead(
  conversationId: string,
  businessId: string,
): Promise<boolean> {
  return postConversationAction(conversationId, businessId, 'markAsRead');
}

/**
 * Marca conversa como NÃO-lida via rota canônica. O server sobe
 * conversations.unreadCount E o contador denormalizado pelo MESMO delta na mesma
 * transação — diferente do antigo updateDoc direto no client, que deixava o
 * contador `unreadCounters/{businessId}` defasado (drift). Ver route POST.
 */
export function markConversationUnread(
  conversationId: string,
  businessId: string,
): Promise<boolean> {
  return postConversationAction(conversationId, businessId, 'markUnread');
}
