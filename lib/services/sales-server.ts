/**
 * lib/services/sales-server.ts
 *
 * Serviço único server-side (firebase-admin) para criar uma venda com TODOS os
 * seus side-effects financeiros e de estoque numa operação idempotente:
 *
 *   Sale
 *   + Transaction de receita  (Transaction.saleId ↔ Sale.transactionId)
 *   + StockMovements          (dedução atômica via deductStockAdmin)
 *   + Transaction de comissão (opcional; Sale.commissionTransactionId)  ← P2.12
 *   + stats do cliente        (totalSpent/visitCount/lastVisit)
 *
 * Resolve os achados de auditoria:
 *   - P1.2  agent sales_create criava Sale sem Transaction/estoque/idempotência
 *   - P1.8  rotas financeiras do agent sem idempotência (R3)
 *   - P2.12 comissão do PDV não idempotente nem linkada à Sale
 *
 * Idempotência (R3): `withIdempotency` com chave do header `X-Idempotency-Key`
 * OU chave determinística derivada do conteúdo da venda (padrão de
 * agent/tools/agenda/route.ts). A pré-checagem acontece dentro de withIdempotency
 * (transação que cria a entrada `in_progress`), então um retry cujo response se
 * perdeu devolve o resultado salvo em vez de re-emitir venda/transação/estoque.
 *
 * Mantém R1: todo doc gravado carrega businessId; toda leitura filtra por ele.
 * Mantém R6: input validado no boundary (CreateSaleWithSideEffectsInputSchema).
 *
 * Nota de atomicidade: deductStockAdmin roda seu próprio runTransaction (P1.6),
 * por isso o estoque é deduzido num passo separado da escrita de Sale+Transactions.
 * A barreira contra duplicação é a idempotência (chave determinística), exatamente
 * como na rota v1 original (withIdempotency + deductStockAdmin). IDs de doc são
 * determinísticos a partir do saleId, então um replay não cria docs novos.
 */

import { createHash } from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  deductStockAdmin,
  loadProductIndex,
  type StockAdjustmentAdmin,
} from '@/lib/services/stock-admin';
import { buildOrderStockLines } from '@/lib/services/stock-lines';
import { recordClientPurchaseAdmin } from '@/lib/services/clients/recordPurchase';
import { withIdempotency, type IdempotencyResult } from '@/contracts/_runtime/idempotency';
import {
  CreateSaleWithSideEffectsInputSchema,
  type CreateSaleWithSideEffectsInput,
} from '@/contracts/api/services/sale-server';
import type { DeliveryOrder, Sale } from '@/lib/types';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface CreateSaleResult {
  sale: Sale;
  transactionId: string;
  commissionTransactionId?: string;
  stockMovements: number;
  stockAdjustments: StockAdjustmentAdmin[];
  /** True quando o resultado veio de um replay idempotente (não criou nada novo). */
  replayed: boolean;
}

/**
 * Deriva uma chave de idempotência determinística a partir do conteúdo da venda.
 * Usada quando o caller não fornece `idempotencyKey` (ex: agent sem header).
 * Mesma família de hash usada em agent/tools/agenda/route.ts.
 */
function deriveIdempotencyKey(input: CreateSaleWithSideEffectsInput): string {
  const itemSig = input.items
    .map((it) => `${it.productId || it.serviceId || it.description}:${it.quantity}:${it.unitPrice}`)
    .join('|');
  const paySig = input.payments.map((p) => `${p.method}:${p.amount}`).join('|');
  return createHash('sha256')
    .update(`${input.businessId}:${input.clientId || ''}:${input.operatorId}:${itemSig}:${paySig}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Cria uma venda com receita + estoque + comissão, idempotente.
 * O `db` é injetável para testes; default = adminDb.
 */
export async function createSaleWithSideEffects(
  rawInput: CreateSaleWithSideEffectsInput,
  db: Firestore = adminDb,
): Promise<CreateSaleResult> {
  // R6: valida no boundary do serviço.
  const input = CreateSaleWithSideEffectsInputSchema.parse(rawInput);
  const { businessId } = input;

  const key = input.idempotencyKey || deriveIdempotencyKey(input);

  const idemp: IdempotencyResult<Omit<CreateSaleResult, 'replayed'>> = await withIdempotency<Omit<CreateSaleResult, 'replayed'>>(
    db,
    { businessId, key, endpoint: 'service:createSaleWithSideEffects' },
    async () => runCreate(db, input, key),
  );

  return { ...idemp.result, replayed: idemp.replayed };
}

async function runCreate(
  db: Firestore,
  input: CreateSaleWithSideEffectsInput,
  idempotencyKey: string,
): Promise<Omit<CreateSaleResult, 'replayed'>> {
  const { businessId } = input;
  const now = new Date().toISOString();
  const today = now.split('T')[0];

  // ── Totais consistentes ──────────────────────────────────────────────────
  const items = input.items.map((item, idx) => ({
    id: `item_${idx}`,
    description: item.description.trim(),
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    discount: item.discount,
    total: round2(item.total ?? item.quantity * item.unitPrice - item.discount),
    ...(item.productId ? { productId: item.productId } : {}),
    ...(item.serviceId ? { serviceId: item.serviceId } : {}),
    ...(item.basePrice !== undefined ? { basePrice: item.basePrice } : {}),
    ...(item.selectedModifiers?.length ? { selectedModifiers: item.selectedModifiers } : {}),
  }));
  const subtotal = round2(items.reduce((acc, it) => acc + it.total, 0));
  const total = round2(Math.max(subtotal - input.discount + (input.tip ?? 0), 0));

  // ── IDs determinísticos a partir do saleRef ──────────────────────────────
  // saleRef.id é gerado uma vez; transação de receita e comissão derivam dele,
  // então um replay (mesma idempotencyKey) não duplica documentos.
  const saleRef = db.collection('sales').doc(
    `sale_${createHash('sha256')
      .update(`${businessId}:${idempotencyKey}`)
      .digest('hex')
      .slice(0, 40)}`,
  );
  const saleId = saleRef.id;
  const txRef = db.collection('transactions').doc(`${saleId}_revenue`);
  const commissionRate = input.commissionRate ?? 0;
  const hasCommission = commissionRate > 0 && total > 0;
  const commissionRef = hasCommission
    ? db.collection('transactions').doc(`${saleId}_commission`)
    : null;

  const sale: Record<string, unknown> = {
    businessId,
    items,
    payments: input.payments.map((p) => ({
      method: p.method,
      amount: round2(p.amount),
      ...(p.installments ? { installments: p.installments } : {}),
      ...(p.cardBrand ? { cardBrand: p.cardBrand } : {}),
    })),
    subtotal,
    discount: input.discount,
    ...(input.tip !== undefined ? { tip: input.tip } : {}),
    total,
    status: input.status,
    transactionId: txRef.id,
    ...(commissionRef ? { commissionTransactionId: commissionRef.id } : {}),
    operatorId: input.operatorId,
    operatorName: input.operatorName,
    createdAt: now,
    updatedAt: now,
    ...(input.clientId ? { clientId: input.clientId, contactId: input.clientId } : {}),
    ...(input.clientName ? { clientName: input.clientName } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.channelType ? { channelType: input.channelType } : {}),
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.sectorId ? { sectorId: input.sectorId } : {}),
    // FKs de resultado (P2.10) — gravadas quando a origem é conhecida.
    ...(input.dealId ? { dealId: input.dealId } : {}),
    ...(input.appointmentId ? { appointmentId: input.appointmentId } : {}),
  };

  // ── Estoque (atômico, próprio runTransaction) ────────────────────────────
  const productItemIds = items
    .filter((it) => !!it.productId)
    .map((it) => it.productId as string);
  const productIndex = productItemIds.length
    ? await loadProductIndex(db, productItemIds, businessId)
    : new Map();
  const productLines = productItemIds.length
    ? buildOrderStockLines(
        { items } as unknown as DeliveryOrder,
        productIndex,
      )
    : [];

  // ── Sale + Transaction de receita + comissão num batch atômico ───────────
  const batch = db.batch();
  batch.set(saleRef, sale);

  const revenueTx: Record<string, unknown> = {
    businessId,
    type: 'receita',
    category: 'Vendas',
    description: `Venda ${input.clientName ? `- ${input.clientName}` : ''}`.trim(),
    amount: total,
    dueDate: today,
    paymentDate: today,
    status: 'pago',
    saleId,
    paymentMethod: input.payments[0]?.method || 'dinheiro',
    createdAt: now,
    updatedAt: now,
    ...(input.clientId ? { clientId: input.clientId, contactId: input.clientId } : {}),
    ...(input.clientName ? { clientName: input.clientName } : {}),
    ...(input.channelType ? { channelType: input.channelType } : {}),
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.sectorId ? { sectorId: input.sectorId } : {}),
  };
  batch.set(txRef, revenueTx);

  if (commissionRef) {
    const commissionAmount = round2((total * commissionRate) / 100);
    batch.set(commissionRef, {
      businessId,
      type: 'despesa',
      category: 'Comissoes',
      description: `Comissão ${input.operatorName} — Venda #${saleId.slice(0, 6)} (${commissionRate}%)`,
      amount: commissionAmount,
      dueDate: today,
      paymentDate: null,
      status: 'pendente',
      clientId: input.operatorId,
      clientName: input.operatorName,
      saleId,
      operatorId: input.operatorId,
      operatorName: input.operatorName,
      createdAt: now,
      updatedAt: now,
    });
  }

  let stockMovements = 0;
  let stockAdjustments: StockAdjustmentAdmin[] = [];
  if (productLines.length > 0) {
    try {
      const adjustments = await deductStockAdmin(db, productLines, {
        businessId,
        operatorId: input.operatorId,
        operatorName: input.operatorName,
        sourceType: 'sale',
        sourceId: saleId,
        sourceDocument: { collection: 'sales', id: saleId, existence: 'if-present' },
        idempotencyKey: `sale:${saleId}:deduct`,
        reason: `Venda #${saleId.substring(0, 6)}`,
        productIndex,
        negativeStockPolicy: 'prevent',
      });
      stockAdjustments = adjustments;
      stockMovements = adjustments.length;
    } catch (stockErr) {
      console.error('[sales-server] stock deduction failed:', stockErr);
      throw stockErr;
    }
  }

  // O estoque vem primeiro e é idempotente. Se este batch falhar, o retry
  // reaproveita a mesma operação de estoque e tenta persistir a venda novamente.
  await batch.commit();

  // ── Stats do cliente (idempotente por saleId) ─────────────────────────────
  if (input.clientId) {
    try {
      await recordClientPurchaseAdmin({
        db,
        businessId,
        clientId: input.clientId,
        sourceId: saleId,
        amount: total,
      });
      const clientRef = db.collection('clients').doc(input.clientId);
      const clientSnap = await clientRef.get();
      if (
        clientSnap.exists &&
        clientSnap.data()?.businessId === businessId &&
        clientSnap.data()?.status !== 'ganho'
      ) {
        await clientRef.update({ status: 'ganho', updatedAt: now });
      }
    } catch (statErr) {
      console.warn('[sales-server] client stats update failed:', statErr);
    }
  }

  return {
    sale: { id: saleId, ...(sale as Omit<Sale, 'id'>) } as Sale,
    transactionId: txRef.id,
    ...(commissionRef ? { commissionTransactionId: commissionRef.id } : {}),
    stockMovements,
    stockAdjustments,
  };
}
