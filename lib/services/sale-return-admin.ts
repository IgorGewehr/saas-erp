/**
 * lib/services/sale-return-admin.ts
 *
 * Devolução PARCIAL de venda (item-a-item), M02 — retomada 10/09/2026.
 * Complementa `sale-transition-admin.ts` (cancelamento TOTAL, M02.7):
 * aquele reverte 100% e move `status→cancelada`; este reverte só os itens
 * pedidos e NUNCA muda `sale.status` (a venda continua 'finalizada' — ela
 * de fato aconteceu; a devolução é um ajuste posterior, não uma anulação).
 *
 * Efeitos, na ordem:
 *   1. Gate fiscal — MESMO gate de `cancelSaleAdmin` (checkpoint com o
 *      usuário: nota já `autorizada` bloqueia devolução parcial também —
 *      o sistema não sabe emitir nota de devolução/carta de correção).
 *   2. CAS transacional: valida que `quantity` pedida não excede o que
 *      resta (`item.quantity - item.returnedQuantity`) e persiste o
 *      incremento + o doc `saleReturns/{id}` NA MESMA transação — sem isso,
 *      duas devoluções parciais concorrentes da mesma linha poderiam
 *      devolver mais do que foi vendido (achado da investigação: o núcleo
 *      de estoque, `applyStockOperationAdmin`, NÃO protege contra isso
 *      sozinho — ele só aplica o delta que mandarmos, sem saber quanto já
 *      foi restaurado antes).
 *   3. Restaura estoque — só as linhas/quantidades devolvidas
 *      (`applyStockOperationAdmin`, idempotencyKey própria por devolução,
 *      distinta da key do cancelamento total pra nunca colidir).
 *   4. Estorno financeiro — CONTRA-LANÇAMENTO (nova Transaction
 *      despesa/"Estornos"), nunca muta a Transaction de receita original
 *      (preserva trilha de auditoria — mesmo padrão de
 *      `transaction-reversal.ts`, que já faz isso pro estorno cheio do
 *      Mercado Pago; aqui é a primeira vez que o padrão é usado com um
 *      valor PARCIAL, não o total).
 *   5. Ajusta `client.totalSpent` proporcionalmente (não `visitCount` — uma
 *      devolução não desfaz a visita).
 *
 * Deliberadamente FORA de escopo (ver docs/paridade/M02_PLANO_IMPLEMENTACAO.md
 * pra o raciocínio completo de cada um):
 *   - Cupom/gift card/pontos de fidelidade — modelados hoje no nível da
 *     VENDA, não por item (confirmado: `SaleItem.discount` é sempre 0 nas
 *     vendas reais); reverter proporcionalmente exigiria uma política de
 *     rateio que não existe e um primitivo de compensação parcial que
 *     `compensateCommercialBenefitsAdmin` não tem.
 *   - Comissão do operador — política de negócio (a empresa reclama
 *     comissão de item devolvido?), não decisão de engenharia.
 *   - Emissão de nota fiscal de devolução/carta de correção — por isso o
 *     gate fiscal bloqueia quando já há nota autorizada, em vez de tentar
 *     reconciliar.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/config/firebaseAdmin';
import type { SaleReturn, SaleReturnLine } from '@/lib/contracts/domain/saleReturn';
import { applyStockOperationAdmin } from '@/lib/services/stock-core-admin';
import { loadProductIndex } from '@/lib/services/stock-admin';
import { buildOrderStockLines } from '@/lib/services/stock-lines';
import { createTransactionSafeAdmin } from '@/lib/services/transactionTxGuardAdmin';
import type { DeliveryOrder, Sale, SaleItem, StockAlert } from '@/lib/types';

export class SaleReturnError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SaleReturnError';
  }
}

export interface SaleReturnActor {
  id: string;
  name: string;
}

export interface SaleReturnLineInput {
  itemId: string;
  quantity: number;
}

export interface SaleReturnResult {
  saleReturn: SaleReturn;
  stockApplied: boolean;
  stockAlerts: StockAlert[];
  refundTransactionId?: string;
  /** true = idempotencyKey já processada antes; nenhum efeito novo aplicado. */
  replayed: boolean;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function deterministicReturnId(saleId: string, idempotencyKey: string): string {
  return `saleReturn_${hash(`${saleId}:${idempotencyKey}`).slice(0, 40)}`;
}

/** Ausente do caller ⇒ deriva das próprias linhas pedidas (mesmo padrão de
 *  `order-server.ts`/`delivery-order-server.ts`) — retry idêntico dedupe,
 *  pedido de devolução diferente vira um evento novo. */
function deriveIdempotencyKey(lines: SaleReturnLineInput[]): string {
  const stable = [...lines]
    .sort((a, b) => a.itemId.localeCompare(b.itemId))
    .map((l) => `${l.itemId}:${l.quantity}`)
    .join('|');
  return hash(stable).slice(0, 40);
}

export async function returnSaleItemsAdmin(params: {
  db?: Firestore;
  saleId: string;
  businessId: string;
  lines: SaleReturnLineInput[];
  reason?: string;
  actor: SaleReturnActor;
  idempotencyKey?: string;
  now?: Date;
}): Promise<SaleReturnResult> {
  const db = params.db ?? adminDb;
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const saleRef = db.collection('sales').doc(params.saleId);

  if (params.lines.length === 0) {
    throw new SaleReturnError('EMPTY_RETURN', 'Informe ao menos um item pra devolver.');
  }
  for (const line of params.lines) {
    if (!(line.quantity > 0)) {
      throw new SaleReturnError('INVALID_QUANTITY', `Quantidade inválida pro item ${line.itemId}.`);
    }
  }

  const snapshot = await saleRef.get();
  if (!snapshot.exists) throw new SaleReturnError('SALE_NOT_FOUND', 'Venda não encontrada.');
  const sale = { id: snapshot.id, ...snapshot.data() } as Sale;
  if (sale.businessId !== params.businessId) {
    throw new SaleReturnError('TENANT_MISMATCH', 'Venda pertence a outro negócio.');
  }

  // Só faz sentido devolver item de uma venda que de fato se completou.
  // 'aberta' nunca debitou estoque nem gerou receita (nada a devolver);
  // 'cancelada' já reverteu tudo via cancelSaleAdmin. Devolução NÃO é uma
  // transição do FSM de Sale — `status` nunca muda aqui, diferente do
  // cancelamento total.
  if (sale.status !== 'finalizada') {
    throw new SaleReturnError(
      'INVALID_SALE_STATUS',
      `Só é possível devolver itens de uma venda finalizada (status atual: ${sale.status}).`,
    );
  }

  // ── Gate fiscal — MESMO gate do cancelamento total (checkpoint com o usuário). ──
  if (sale.fiscalDocumentId) {
    const fiscalSnap = await db.collection('fiscalDocuments').doc(sale.fiscalDocumentId).get();
    if (fiscalSnap.exists && fiscalSnap.data()?.status === 'autorizada') {
      throw new SaleReturnError(
        'FISCAL_DOCUMENT_ISSUED',
        'Nota fiscal já autorizada — devolução parcial não suportada após emissão. Cancele o documento fiscal e a venda inteira, se necessário.',
      );
    }
  }

  const idemKey = params.idempotencyKey || deriveIdempotencyKey(params.lines);
  const returnId = deterministicReturnId(params.saleId, idemKey);
  const returnRef = db.collection('saleReturns').doc(returnId);

  let replayed = false;
  let returnedItems: Array<SaleItem & { returnedNow: number }> = [];
  let totalAmount = 0;

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(returnRef);
    if (existing.exists) {
      replayed = true;
      return;
    }

    const freshSnap = await tx.get(saleRef);
    if (!freshSnap.exists) throw new SaleReturnError('SALE_NOT_FOUND', 'Venda não encontrada.');
    const fresh = { id: freshSnap.id, ...freshSnap.data() } as Sale;
    if (fresh.status !== 'finalizada') {
      throw new SaleReturnError('INVALID_SALE_STATUS', `Só é possível devolver itens de uma venda finalizada (status atual: ${fresh.status}).`);
    }

    const updatedItems = [...fresh.items];
    const lines: SaleReturnLine[] = [];
    for (const line of params.lines) {
      const idx = updatedItems.findIndex((it) => it.id === line.itemId);
      if (idx === -1) throw new SaleReturnError('ITEM_NOT_FOUND', `Item ${line.itemId} não encontrado na venda.`);
      const item = updatedItems[idx];
      const alreadyReturned = item.returnedQuantity ?? 0;
      const remaining = round2(item.quantity - alreadyReturned);
      if (line.quantity > remaining + 0.001) {
        throw new SaleReturnError(
          'QUANTITY_EXCEEDS_REMAINING',
          `Item "${item.description}": só restam ${remaining} unidade(s) pra devolver (${alreadyReturned} já devolvida(s) de ${item.quantity}).`,
        );
      }
      updatedItems[idx] = { ...item, returnedQuantity: round2(alreadyReturned + line.quantity) };
      lines.push({ itemId: item.id, quantity: line.quantity, unitPrice: item.unitPrice });
      returnedItems.push({ ...item, returnedNow: line.quantity });
    }
    totalAmount = round2(lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0));

    tx.update(saleRef, { items: updatedItems, updatedAt: nowIso });

    const returnDoc: Omit<SaleReturn, 'id'> = {
      businessId: params.businessId,
      saleId: params.saleId,
      lines,
      totalAmount,
      ...(params.reason ? { reason: params.reason } : {}),
      stockRestored: false,
      operatorId: params.actor.id,
      operatorName: params.actor.name,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    tx.create(returnRef, returnDoc);
  });

  if (replayed) {
    const doc = await returnRef.get();
    return {
      saleReturn: { id: doc.id, ...doc.data() } as SaleReturn,
      stockApplied: false,
      stockAlerts: [],
      refundTransactionId: (doc.data() as SaleReturn | undefined)?.refundTransactionId,
      replayed: true,
    };
  }

  // ── Ajuste de totalSpent — transação PRÓPRIA (mantém a tx principal acima
  // enxuta e focada em CAS de quantidade; falha aqui é best-effort). ────────
  if (sale.clientId) {
    try {
      await db.runTransaction(async (tx) => {
        const clientRef = db.collection('clients').doc(sale.clientId!);
        const clientSnap = await tx.get(clientRef);
        if (!clientSnap.exists || clientSnap.data()?.businessId !== params.businessId) return;
        const current = Number(clientSnap.data()?.totalSpent ?? 0);
        tx.update(clientRef, { totalSpent: Math.max(0, round2(current - totalAmount)), updatedAt: nowIso });
      });
    } catch (err) {
      console.warn('[SaleReturn] falha ao ajustar totalSpent do cliente:', err);
    }
  }

  // ── Restaura estoque — só as linhas/quantidades devolvidas. ──────────────
  let stockApplied = false;
  let stockAlerts: StockAlert[] = [];
  const productIds = returnedItems.map((i) => i.productId).filter((id): id is string => !!id);
  if (productIds.length > 0) {
    const productIndex = await loadProductIndex(db, productIds, params.businessId);
    const syntheticItems = returnedItems.map((i) => ({
      productId: i.productId,
      ...(i.variantId ? { variantId: i.variantId } : {}),
      quantity: i.returnedNow,
      ...(i.selectedModifiers ? { selectedModifiers: i.selectedModifiers } : {}),
    }));
    const lines = buildOrderStockLines({ items: syntheticItems } as unknown as DeliveryOrder, productIndex);
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
        idempotencyKey: `sale:${sale.id}:return:${returnId}:stock`,
        reason: params.reason || `Devolução parcial venda #${sale.id.slice(0, 6)}`,
        expandBom: true,
      });
      stockApplied = true;
      stockAlerts = result.adjustments.flatMap((a) => (a.alert ? [a.alert] : []));
    }
  }

  // ── Estorno financeiro — contra-lançamento, nunca muta a receita original. ──
  let refundTransactionId: string | undefined;
  if (totalAmount > 0) {
    const dateStr = nowIso.split('T')[0];
    const result = await createTransactionSafeAdmin(db, {
      businessId: params.businessId,
      type: 'despesa',
      status: 'pago',
      category: 'Estornos',
      description: `Devolução parcial — venda #${sale.id.slice(0, 6)}`,
      amount: totalAmount,
      dueDate: dateStr,
      paymentDate: dateStr,
      saleId: sale.id,
      // Chave EXPLÍCITA e ancorada no returnId — a chave derivada
      // (sale:{id}:despesa) colidiria entre múltiplas devoluções parciais da
      // MESMA venda, já que todas compartilham saleId+type.
      idempotencyKey: `sale:${sale.id}:return:${returnId}:refund`,
      ...(sale.clientId ? { clientId: sale.clientId, contactId: sale.clientId } : {}),
      ...(sale.clientName ? { clientName: sale.clientName } : {}),
    });
    refundTransactionId = result.id;
  }

  await returnRef.update({
    stockRestored: stockApplied,
    ...(refundTransactionId ? { refundTransactionId } : {}),
    updatedAt: new Date().toISOString(),
  });

  const finalDoc = await returnRef.get();
  return {
    saleReturn: { id: finalDoc.id, ...finalDoc.data() } as SaleReturn,
    stockApplied,
    stockAlerts,
    refundTransactionId,
    replayed: false,
  };
}
