/**
 * lib/services/order-stock-restore.ts
 *
 * Restauro de estoque RECUPERÁVEL e idempotente de um DeliveryOrder. SERVER-ONLY
 * (Admin SDK). FONTE ÚNICA do restauro automático — consumido por:
 *   - cron expire-pix (PIX vencido),
 *   - webhook-settle (estorno/chargeback),
 *   - agent tool (cancelamento via agente).
 *
 * Invariantes (anti duplo-restauro entre os eixos fabricação↔pagamento e entre
 * runs concorrentes):
 *   - Claim DISTINGUÍVEL com janela de obsolescência (stockRestoreClaimedAt):
 *     outro run em progresso (claim recente <5min) NÃO restaura de novo; um claim
 *     antigo (run que crashou) volta a ser elegível — recupera sem duplo-restauro.
 *   - Guard de já-restaurado = stockRestoredAt é string (timestamp). null/undefined
 *     ainda são elegíveis.
 *   - Linhas reconstruídas via buildOrderStockLines (itens + insumos de
 *     modificadores com linkedProductId) — simetria EXATA com a dedução.
 *   - Ordem recuperável: restaura o estoque PRIMEIRO, grava o timestamp DEPOIS;
 *     se restoreStockAdmin falhar, o campo fica null e a varredura de recuperação
 *     reprocessa no próximo run (sem vazamento de estoque).
 */
import { adminDb } from '@/lib/config/firebaseAdmin';
import type { DeliveryOrder } from '@/lib/types';
import { loadProductIndex, restoreStockAdmin } from '@/lib/services/stock-admin';
import { buildOrderStockLines } from '@/lib/services/stock-lines';

const CLAIM_STALE_MS = 5 * 60 * 1000;

export async function restoreOrderStockRecoverable(
  orderId: string,
  businessId: string,
  opts: { operatorName: string; context: string },
): Promise<boolean> {
  const orderRef = adminDb.collection('deliveryOrders').doc(orderId);

  // CAS claim DENTRO da tx ANTES de restaurar (M4 — restoreStockAdmin não é idempotente).
  const order = await adminDb.runTransaction(async (tx) => {
    const s = await tx.get(orderRef);
    if (!s.exists) return null;
    const o = s.data() as DeliveryOrder;
    if (o.businessId !== businessId) return null; // R1 re-check
    if (!o.stockDeductedAt) return null; // nada debitado a restaurar
    if (typeof o.stockRestoredAt === 'string') return null; // já restaurado
    const claimedAt = o.stockRestoreClaimedAt;
    if (typeof claimedAt === 'string' && Date.now() - Date.parse(claimedAt) < CLAIM_STALE_MS) return null;
    const nowIso = new Date().toISOString();
    tx.update(orderRef, { stockRestoreClaimedAt: nowIso, stockRestoredAt: null, updatedAt: nowIso });
    return o;
  });
  if (!order) return false;

  const itemIds = (order.items ?? []).map((i) => i.productId);
  if (itemIds.length === 0) return false;

  // 1º passe: produtos dos itens p/ descobrir linkedProductIds dos modificadores;
  // 2º passe: índice completo (itens + insumos) p/ a restauração.
  const itemIndex = await loadProductIndex(adminDb, itemIds, businessId);
  const linkedIds: string[] = [];
  for (const item of order.items ?? []) {
    const product = itemIndex.get(item.productId);
    for (const sm of item.selectedModifiers ?? []) {
      const group = product?.modifierGroups?.find((g) => g.id === sm.groupId);
      if (!group) continue;
      for (const opt of sm.selectedOptions) {
        const srcOpt = group.options.find((o) => o.id === opt.optionId);
        if (srcOpt?.linkedProductId) linkedIds.push(srcOpt.linkedProductId);
      }
    }
  }

  // Índice base (itens + insumos de modificadores).
  const baseIndex = await loadProductIndex(adminDb, [...itemIds, ...linkedIds], businessId);
  // CRÍTICO — simetria EXATA com a dedução (orders/public carrega
  // [...baseIds, ...componentIds]): inclui as FOLHAS de BOM dos produtos
  // compostos. restoreStockAdmin PULA linhas cujo produto não está no índice,
  // então SEM isto o estoque de COMPONENTES de produtos compostos nunca era
  // restaurado (cancelamento/PIX expirado/estorno) → corrupção de inventário.
  const componentIds = [...itemIds, ...linkedIds].flatMap((id) =>
    (baseIndex.get(id)?.components ?? []).map((c) => c.productId),
  );
  const productIndex = componentIds.length
    ? await loadProductIndex(adminDb, [...itemIds, ...linkedIds, ...componentIds], businessId)
    : baseIndex;
  const lines = buildOrderStockLines(order, productIndex);

  const adjustments = await restoreStockAdmin(adminDb, lines, {
    businessId,
    operatorId: 'system',
    operatorName: opts.operatorName,
    sourceType: 'refund',
    sourceId: orderId,
    sourceDocument: { collection: 'deliveryOrders', id: orderId, existence: 'required' },
    idempotencyKey: `order:${orderId}:restore`,
    reason: `Estorno de estoque — ${opts.context} (pedido #${order.number ?? orderId})`,
    productIndex,
  });

  // Timestamp gravado SÓ APÓS concluir (ordem recuperável).
  await orderRef.update({
    stockRestoredAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return adjustments.length > 0;
}
