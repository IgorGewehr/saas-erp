/**
 * lib/services/conversationMessageOwnershipFanOut.ts
 *
 * conversationMessages docs recebem channelOwnerType/channelOwnerId/
 * visibleToUserIds denormalizados NA CRIAÇÃO (ver
 * lib/utils/conversationMessageOwnership.ts) pra que firestore.rules decida
 * quem pode ler a mensagem sem get() no `conversations` pai. Quando uma
 * conversa muda de dono de canal (transfer-channel) OU de visibilidade
 * (setor/privacidade/atribuição), as mensagens JÁ CRIADAS ficam com o valor
 * ANTIGO — sem este fan-out, elas continuariam legíveis (ou ilegíveis) pra
 * quem não deveria mais (ou já deveria) pra sempre, mesma classe de
 * vazamento que a correção do ownership/visibilidade da própria
 * conversation fecha.
 *
 * Admin-SDK only (roda em rota server-side) — por isso não vive junto do
 * helper puro em lib/utils/, que precisa ser importável no client bundle.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';

const BATCH_SIZE = 500; // limite de escrita atômica do Firestore

export interface MessageFieldFanOutPatch {
  /** Presente = atualiza ownership (channelOwnerType obrigatório junto). */
  channelOwnerType?: 'business' | 'user';
  channelOwnerId?: string;
  /** Chave presente (mesmo que valor null) = atualiza visibilidade. */
  visibleToUserIds?: string[] | null;
}

function sameVisibleToUserIds(a: string[] | null | undefined, b: string[] | null): boolean {
  const na = a ?? null;
  if (na === null || b === null) return na === b;
  if (na.length !== b.length) return false;
  const setA = new Set(na);
  return b.every((id) => setA.has(id));
}

/**
 * Reescreve em lote channelOwnerType/channelOwnerId e/ou visibleToUserIds
 * de TODAS as mensagens de uma conversa. `patch` é parcial — só os campos
 * presentes são tocados (ownership via `channelOwnerType` presente,
 * visibilidade via `visibleToUserIds` presente na chave, mesmo que null).
 */
export async function fanOutMessageFields(
  conversationId: string,
  patch: MessageFieldFanOutPatch,
): Promise<void> {
  const hasOwnershipPatch = !!patch.channelOwnerType;
  const hasVisibilityPatch = 'visibleToUserIds' in patch;
  if (!hasOwnershipPatch && !hasVisibilityPatch) return;

  let lastDocId: string | null = null;

  for (;;) {
    let query = adminDb.collection('conversationMessages')
      .where('conversationId', '==', conversationId)
      .orderBy('__name__')
      .limit(BATCH_SIZE);
    if (lastDocId) {
      query = query.startAfter(lastDocId);
    }
    const snap = await query.get();
    if (snap.empty) break;

    const batch = adminDb.batch();
    for (const doc of snap.docs) {
      const data = doc.data();
      const update: Record<string, unknown> = {};

      if (hasOwnershipPatch && (data.channelOwnerType !== patch.channelOwnerType || data.channelOwnerId !== patch.channelOwnerId)) {
        update.channelOwnerType = patch.channelOwnerType;
        update.channelOwnerId = patch.channelOwnerId ?? FieldValue.delete();
      }
      if (hasVisibilityPatch && !sameVisibleToUserIds(data.visibleToUserIds, patch.visibleToUserIds ?? null)) {
        update.visibleToUserIds = patch.visibleToUserIds ?? null;
      }

      if (Object.keys(update).length > 0) {
        batch.update(doc.ref, update);
      }
    }
    await batch.commit();

    if (snap.docs.length < BATCH_SIZE) break;
    lastDocId = snap.docs[snap.docs.length - 1].id;
  }
}
