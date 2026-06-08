/**
 * lib/services/unreadCounter.ts
 *
 * Mantém o doc denormalizado `unreadCounters/{businessId}` (Admin SDK,
 * server-side). Espelha as mutações que já ocorrem em
 * `conversations.unreadCount`:
 *
 *   - INCREMENTO (+1): chamado na MESMA operação que faz unreadCount:increment(1)
 *     na conversa, SOMENTE no caminho de mensagem nova (já guardado por dedupe
 *     de wamid/externalMessageId no caller). Ver R3.
 *   - DECREMENTO (markAsRead): aplica delta = -prevUnread no escopo certo, lido
 *     dentro de runTransaction junto com unreadCount:0 na conversa. Idempotente:
 *     2ª execução é no-op (já está 0). Clamp em Math.max(0, …) impede negativo.
 *
 * Escopo (ver lib/contracts/domain/unreadCounter.ts §2.1):
 *   channelOwnerType=='business'  → business + total
 *   senão (canal pessoal)         → byUser[channelOwnerId] + total
 *
 * Contrato: lib/contracts/domain/unreadCounter.ts (UnreadCounterSchema).
 */

import { FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

export interface UnreadScope {
  /** channelOwnerType da conversa. Ausente trata-se como 'business' (legado). */
  channelOwnerType?: 'business' | 'user' | string;
  /** channelOwnerId (uid) — obrigatório quando channelOwnerType==='user'. */
  channelOwnerId?: string;
}

function counterRef(db: Firestore, businessId: string) {
  return db.doc(`unreadCounters/${businessId}`);
}

/** Resolve o campo de escopo no doc de contador a partir do owner da conversa. */
function scopeField(scope: UnreadScope): string | null {
  if (scope.channelOwnerType === 'user') {
    if (!scope.channelOwnerId) return null; // sem owner não há onde somar
    return `byUser.${scope.channelOwnerId}`;
  }
  return 'business';
}

/**
 * Incrementa o contador de não-lidas para uma mensagem nova inbound.
 * Use o MESMO `delta` que foi aplicado em conversations.unreadCount (=1).
 * Doc criado on-demand via set({merge}) — FieldValue.increment funciona em
 * campo ausente (trata como 0). Não-fatal: caller decide se ignora erro.
 */
export async function incrementUnreadCounter(
  db: Firestore,
  businessId: string,
  scope: UnreadScope,
  delta = 1,
): Promise<void> {
  const field = scopeField(scope);
  if (!field) return; // owner=user sem id — não dá pra atribuir; pula (badge total ainda sobe via guarda do caller? não — pula tudo p/ consistência)

  await counterRef(db, businessId).set(
    {
      businessId,
      [field]: FieldValue.increment(delta),
      total: FieldValue.increment(delta),
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

/**
 * Aplica um incremento DENTRO de uma runTransaction já aberta pelo caller
 * (mesma tx que sobe conversations.unreadCount). Use o MESMO `delta` que foi
 * aplicado em conversations.unreadCount nesta tx — assim conversa e contador
 * sobem em lockstep. Usado pela ação manual "marcar como não-lida" (markUnread),
 * que precisa de uma escrita transacional (vs incrementUnreadCounter standalone,
 * usado no caminho de mensagem nova inbound).
 *
 * delta<=0 é no-op. Lê o doc via tx.get (Admin SDK exige leitura antes de
 * escrita) e soma com clamp não-negativo, espelhando decrementUnreadCounterInTx.
 */
export async function incrementUnreadCounterInTx(
  tx: FirebaseFirestore.Transaction,
  db: Firestore,
  businessId: string,
  scope: UnreadScope,
  delta: number,
): Promise<void> {
  if (!Number.isFinite(delta) || delta <= 0) return;

  const field = scopeField(scope);
  if (!field) return;

  const ref = counterRef(db, businessId);
  const snap = await tx.get(ref);

  const isUserScope = field.startsWith('byUser.');
  const data = snap.exists ? snap.data() ?? {} : {};

  const currentScopeVal = isUserScope
    ? Number(((data.byUser ?? {}) as Record<string, unknown>)[scope.channelOwnerId as string] ?? 0)
    : Number((data.business as number) ?? 0);
  const currentTotal = Number((data.total as number) ?? 0);

  const nextScopeVal = Math.max(0, currentScopeVal + delta);
  const nextTotal = Math.max(0, currentTotal + delta);

  tx.set(
    ref,
    {
      businessId,
      [field]: nextScopeVal,
      total: nextTotal,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

/**
 * Aplica o decremento do markAsRead DENTRO de uma runTransaction já aberta pelo
 * caller (mesma tx que zera conversations.unreadCount). Recebe `prevUnread`
 * (valor que a conversa tinha antes de zerar) e o escopo da conversa.
 *
 * Idempotente: se prevUnread<=0, é no-op. Clamp em Math.max(0,…) por cima do
 * valor lido garante que reexecução ou drift nunca deixa o contador negativo.
 */
export async function decrementUnreadCounterInTx(
  tx: FirebaseFirestore.Transaction,
  db: Firestore,
  businessId: string,
  scope: UnreadScope,
  prevUnread: number,
): Promise<void> {
  if (!Number.isFinite(prevUnread) || prevUnread <= 0) return;

  const field = scopeField(scope);
  if (!field) return;

  const ref = counterRef(db, businessId);
  const snap = await tx.get(ref);

  const isUserScope = field.startsWith('byUser.');
  const data = snap.exists ? snap.data() ?? {} : {};

  const currentScopeVal = isUserScope
    ? Number(((data.byUser ?? {}) as Record<string, unknown>)[scope.channelOwnerId as string] ?? 0)
    : Number((data.business as number) ?? 0);
  const currentTotal = Number((data.total as number) ?? 0);

  const nextScopeVal = Math.max(0, currentScopeVal - prevUnread);
  const nextTotal = Math.max(0, currentTotal - prevUnread);

  tx.set(
    ref,
    {
      businessId,
      [field]: nextScopeVal,
      total: nextTotal,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}
