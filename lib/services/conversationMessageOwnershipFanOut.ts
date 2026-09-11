/**
 * lib/services/conversationMessageOwnershipFanOut.ts
 *
 * conversationMessages docs recebem channelOwnerType/channelOwnerId
 * denormalizados NA CRIAÇÃO (ver lib/utils/conversationMessageOwnership.ts)
 * pra que firestore.rules decida quem pode ler a mensagem sem get() no
 * `conversations` pai. Quando uma conversa é transferida de canal
 * (app/api/conversations/[id]/transfer-channel/route.ts), as mensagens JÁ
 * CRIADAS ficam com o ownership ANTIGO — sem este fan-out, uma conversa
 * transferida de canal 'business' pra 'user' manteria suas mensagens
 * antigas legíveis por qualquer operator do negócio pra sempre (mesma classe
 * de vazamento que a correção do ownership da própria conversation fecha).
 *
 * Admin-SDK only (roda em rota server-side) — por isso não vive junto do
 * helper puro em lib/utils/, que precisa ser importável no client bundle.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';

const BATCH_SIZE = 500; // limite de escrita atômica do Firestore

export async function fanOutMessageOwnership(
  conversationId: string,
  ownership: { channelOwnerType: 'business' | 'user'; channelOwnerId?: string },
): Promise<void> {
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
      // Só reescreve se o valor mudou de verdade — evita write amplification
      // (updatedAt/gatilhos) em mensagens que já estavam corretas.
      if (data.channelOwnerType === ownership.channelOwnerType && data.channelOwnerId === ownership.channelOwnerId) {
        continue;
      }
      batch.update(doc.ref, {
        channelOwnerType: ownership.channelOwnerType,
        channelOwnerId: ownership.channelOwnerId ?? FieldValue.delete(),
      });
    }
    await batch.commit();

    if (snap.docs.length < BATCH_SIZE) break;
    lastDocId = snap.docs[snap.docs.length - 1].id;
  }
}
