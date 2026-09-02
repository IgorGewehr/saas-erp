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
import type { Firestore } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import type { DeliveryOrder, DeliveryOrderItem, Product } from '@/lib/types';
import { loadProductIndex, restoreStockAdmin } from '@/lib/services/stock-admin';
import { buildOrderStockLines } from '@/lib/services/stock-lines';

const CLAIM_STALE_MS = 5 * 60 * 1000;

/**
 * Resolve o productIndex completo (itens + insumos de modificadores + folhas
 * de BOM) pra um conjunto de itens de pedido — 3 passes, extraído daqui pra
 * ser reaproveitado por qualquer caller que precise reconstruir linhas de
 * estoque a partir de itens de DeliveryOrder (hoje: este módulo e
 * delivery-order-edit-admin.ts). Fonte única — evita a resolução divergir
 * entre restauro e reconciliação de edição (gap G4).
 *
 * CRÍTICO: sem os 3 passes, componentes de produtos compostos e insumos de
 * modificador nunca entram no índice e `buildOrderStockLines`/`restoreStockAdmin`
 * silenciosamente pulam essas linhas (produto ausente do índice).
 */
export async function resolveOrderStockProductIndex(
  db: Firestore,
  items: DeliveryOrderItem[],
  businessId: string,
): Promise<Map<string, Product>> {
  const itemIds = items.map((i) => i.productId);
  if (itemIds.length === 0) return new Map();

  // 1º passe: produtos dos itens p/ descobrir linkedProductIds dos modificadores;
  // 2º passe: índice completo (itens + insumos) p/ a restauração.
  const itemIndex = await loadProductIndex(db, itemIds, businessId);
  const linkedIds: string[] = [];
  for (const item of items) {
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
  const baseIndex = await loadProductIndex(db, [...itemIds, ...linkedIds], businessId);
  // CRÍTICO — simetria EXATA com a dedução: inclui as FOLHAS de BOM dos
  // produtos compostos. Sem isto o estoque de COMPONENTES nunca era
  // restaurado/reconciliado → corrupção de inventário.
  const componentIds = [...itemIds, ...linkedIds].flatMap((id) =>
    (baseIndex.get(id)?.components ?? []).map((c) => c.productId),
  );
  return componentIds.length
    ? loadProductIndex(db, [...itemIds, ...linkedIds, ...componentIds], businessId)
    : baseIndex;
}

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

  const items = order.items ?? [];
  if (items.length === 0) return false;

  const productIndex = await resolveOrderStockProductIndex(adminDb, items, businessId);
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
