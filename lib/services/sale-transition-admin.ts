/**
 * lib/services/sale-transition-admin.ts
 *
 * Cancelamento server-side ÚNICO de Sale (PDV), M02.7. Substitui os dois
 * caminhos divergentes que existiam antes:
 *   - `PDVModule.tsx` (client SDK) — fazia quase tudo (estoque, transações,
 *     stats do cliente), mas SEM trava contra reexecução (double-click/2
 *     abas duplicava o decremento de totalSpent/visitCount) e SEM reverter
 *     benefícios (cupom/gift card ficavam consumidos pra sempre).
 *   - `app/api/agent/tools/sales/route.ts` (Admin SDK) — só mudava `status`,
 *     deixando estoque e dinheiro órfãos.
 *
 * Efeitos, na ordem:
 *   1. Gate fiscal: nota já `autorizada` bloqueia (cancele a nota primeiro).
 *   2. Status→cancelada + reversão de stats do cliente, ATÔMICOS na MESMA
 *      transação, com CAS real (`clientStatsReversedAt`) — fecha o bug de
 *      duplo-decremento.
 *   3. Restaura estoque (applyStockOperationAdmin, MESMA idempotencyKey que
 *      o client já usava — `sale:{id}:restore` — retomar depois de uma
 *      tentativa parcial não duplica).
 *   4. Cancela cada Transaction vinculada (receita + comissão) via
 *      transitionTransactionSafeAdmin (núcleo M03.2, FSM real).
 *   5. Reverte benefícios (cupom/gift card/fidelidade) via
 *      compensateCommercialBenefitsAdmin (núcleo M02.4), reconstruindo o
 *      contexto a partir do `commercialOperations/{sale.commercialOperationId}`
 *      original — SEM essa fatia, nenhum cancelamento no repo jamais liberava
 *      cupom/gift card (achado real da investigação de abertura do M02.7).
 *
 * Cada passo é independentemente idempotente — uma reexecução (retry após
 * falha parcial) não duplica nenhum efeito, mesmo que o passo 2 já tenha
 * marcado a venda como cancelada numa tentativa anterior.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { canTransitionSale } from '@/lib/contracts/fsm/sale';
import { CommercialOperationSchema } from '@/lib/contracts/domain/commercialOperation';
import { applyStockOperationAdmin } from '@/lib/services/stock-core-admin';
import { loadProductIndex } from '@/lib/services/stock-admin';
import { buildOrderStockLines } from '@/lib/services/stock-lines';
import { transitionTransactionSafeAdmin } from '@/lib/services/transactionTxGuardAdmin';
import { compensateCommercialBenefitsAdmin } from '@/lib/services/commercial-benefits-admin';
import type { DeliveryOrder, Sale, StockAlert } from '@/lib/types';

export class SaleCancelError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SaleCancelError';
  }
}

export interface SaleCancelActor {
  id: string;
  name: string;
}

export interface CancelSaleResult {
  sale: Sale;
  stockApplied: boolean;
  clientStatsReversed: boolean;
  benefitsReversed: boolean;
  transactionIds: string[];
  stockAlerts: StockAlert[];
}

export async function cancelSaleAdmin(params: {
  db?: Firestore;
  saleId: string;
  businessId: string;
  actor: SaleCancelActor;
  reason?: string;
  now?: Date;
}): Promise<CancelSaleResult> {
  const db = params.db ?? adminDb;
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const saleRef = db.collection('sales').doc(params.saleId);

  const snapshot = await saleRef.get();
  if (!snapshot.exists) throw new SaleCancelError('SALE_NOT_FOUND', 'Venda não encontrada.');
  const sale = { id: snapshot.id, ...snapshot.data() } as Sale;
  if (sale.businessId !== params.businessId) {
    throw new SaleCancelError('TENANT_MISMATCH', 'Venda pertence a outro negócio.');
  }

  // ── Gate fiscal — nota já autorizada exige cancelamento fiscal primeiro. ──
  if (sale.fiscalDocId) {
    const fiscalSnap = await db.collection('fiscalDocuments').doc(sale.fiscalDocId).get();
    if (fiscalSnap.exists && fiscalSnap.data()?.status === 'autorizada') {
      throw new SaleCancelError(
        'FISCAL_DOCUMENT_ISSUED',
        'Nota fiscal já autorizada — cancele o documento fiscal (Fiscal → Cancelar) antes de cancelar a venda.',
      );
    }
  }

  const alreadyCancelled = sale.status === 'cancelada';
  if (!alreadyCancelled && !canTransitionSale(sale.status, 'cancelada')) {
    throw new SaleCancelError('INVALID_TRANSITION', `Transição inválida: ${sale.status} → cancelada.`);
  }

  // Recalcula lastVisit ANTES da transação (mesma tolerância best-effort que
  // o caminho anterior já tinha — falha aqui não bloqueia o cancelamento,
  // só mantém o valor atual do cliente).
  let newLastVisit: string | null = null;
  if (sale.clientId) {
    try {
      const otherSalesSnap = await db.collection('sales')
        .where('businessId', '==', params.businessId)
        .where('clientId', '==', sale.clientId)
        .get();
      const validSales = otherSalesSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as { status?: string; createdAt?: string }) }))
        .filter((s) => s.id !== sale.id && s.status !== 'cancelada' && s.createdAt)
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      newLastVisit = validSales[0]?.createdAt ?? null;
    } catch (err) {
      console.warn('[SaleCancel] falha ao recalcular lastVisit:', err);
    }
  }

  // ── Status→cancelada + reversão de stats, atômico com CAS real. ──────────
  let clientStatsReversed = false;
  await db.runTransaction(async (tx) => {
    const freshSnap = await tx.get(saleRef);
    if (!freshSnap.exists) throw new SaleCancelError('SALE_NOT_FOUND', 'Venda não encontrada.');
    const fresh = freshSnap.data() as Sale;

    const clientRef = sale.clientId ? db.collection('clients').doc(sale.clientId) : undefined;
    const clientSnap = clientRef ? await tx.get(clientRef) : undefined;

    if (fresh.status !== 'cancelada') {
      tx.update(saleRef, {
        status: 'cancelada',
        cancelledAt: nowIso,
        cancelledBy: params.actor.id,
        cancelledByName: params.actor.name,
        updatedAt: nowIso,
      });
    }

    // CAS: só reverte stats se ainda não foi revertido por uma execução anterior.
    if (!fresh.clientStatsReversedAt && clientSnap?.exists && clientSnap.data()?.businessId === params.businessId) {
      const data = clientSnap.data()!;
      const updates: Record<string, unknown> = {
        totalSpent: Math.max(0, Number(data.totalSpent ?? 0) - sale.total),
        visitCount: Math.max(0, Number(data.visitCount ?? 0) - 1),
        updatedAt: nowIso,
      };
      updates.lastVisit = newLastVisit ?? FieldValue.delete();
      tx.update(clientRef!, updates);
      tx.update(saleRef, { clientStatsReversedAt: nowIso });
      clientStatsReversed = true;
    }
  });

  // ── Restaura estoque — simétrico à baixa, mesma idempotencyKey do client. ──
  let stockApplied = false;
  let stockAlerts: StockAlert[] = [];
  const productIds = sale.items.map((i) => i.productId).filter((id): id is string => !!id);
  if (productIds.length > 0) {
    const productIndex = await loadProductIndex(db, productIds, params.businessId);
    const lines = buildOrderStockLines({ items: sale.items } as unknown as DeliveryOrder, productIndex);
    if (lines.length > 0) {
      const result = await applyStockOperationAdmin(db, {
        businessId: params.businessId,
        type: 'restauracao',
        lines,
        operatorId: params.actor.id,
        operatorName: params.actor.name,
        sourceType: 'refund',
        sourceId: sale.id,
        sourceDocument: { collection: 'sales', id: sale.id, existence: 'required' },
        idempotencyKey: `sale:${sale.id}:restore`,
        reason: params.reason || `Cancelamento venda #${sale.id.slice(0, 6)}`,
        expandBom: true,
      });
      stockApplied = true;
      stockAlerts = result.adjustments.flatMap((a) => (a.alert ? [a.alert] : []));
    }
  }

  // ── Cancela transações vinculadas (receita + comissão). ──────────────────
  const txSnap = await db.collection('transactions')
    .where('businessId', '==', params.businessId)
    .where('saleId', '==', sale.id)
    .get();
  const transactionIds: string[] = [];
  for (const doc of txSnap.docs) {
    if (doc.data().status === 'cancelado') continue;
    try {
      await transitionTransactionSafeAdmin({
        db,
        transactionId: doc.id,
        businessId: params.businessId,
        targetStatus: 'cancelado',
      });
      transactionIds.push(doc.id);
    } catch (err) {
      console.warn(`[SaleCancel] falha ao cancelar transaction ${doc.id}:`, err);
    }
  }

  // ── Reverte benefícios (cupom/gift card/fidelidade) via a operação original. ──
  let benefitsReversed = false;
  if (sale.commercialOperationId) {
    try {
      const opSnap = await db.collection('commercialOperations').doc(sale.commercialOperationId).get();
      if (opSnap.exists) {
        const operation = CommercialOperationSchema.parse({ ...opSnap.data(), operationId: opSnap.id });
        if (operation.businessId === params.businessId) {
          await compensateCommercialBenefitsAdmin(
            {
              db,
              operationId: operation.operationId,
              requestFingerprint: operation.requestFingerprint,
              request: operation.request,
              effectIds: operation.effectIds,
              documentId: operation.effectIds.documentId,
            },
            params.reason || 'Cancelamento de venda',
          );
          benefitsReversed = true;
        }
      }
    } catch (err) {
      console.warn('[SaleCancel] falha ao reverter benefícios:', err);
    }
  }

  const finalSnapshot = await saleRef.get();
  return {
    sale: { id: finalSnapshot.id, ...finalSnapshot.data() } as Sale,
    stockApplied,
    clientStatsReversed,
    benefitsReversed,
    transactionIds,
    stockAlerts,
  };
}
