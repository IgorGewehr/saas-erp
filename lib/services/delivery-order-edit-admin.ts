/**
 * lib/services/delivery-order-edit-admin.ts
 *
 * Edição server-side de DeliveryOrder — fonte única pra UI (OrdersModule) e
 * agente (`app/api/agent/tools/orders/route.ts`'s `updateItems`), mesmo
 * padrão de `delivery-order-transition-admin.ts` (M02.5d).
 *
 * Contexto: sob a arquitetura atual (M02.5a/b/c), o estoque é debitado NA
 * CRIAÇÃO do pedido (checkpoint `stock_applied` do coordenador comercial) —
 * não em `preparando`. Isso significa que, ao contrário do que uma leitura
 * ingênua da FSM sugeriria, praticamente todo pedido que um operador abriria
 * pra editar JÁ tem efeito de estoque aplicado, mesmo em `recebido`.
 *
 * Decisão de escopo (ver docs/paridade/M02_EDICAO_PEDIDO_POS_EFEITO.md):
 *   - Campos SENSÍVEIS (`items`, `deliveryFee`, `discount`, `deliveryType`,
 *     `deliveryAddress` — determinam subtotal/total e, no caso de `items`, o
 *     estoque) só podem mudar de valor enquanto `status === 'recebido'`. Fora
 *     disso, rejeita com erro claro — cancelar e criar novo pedido é o
 *     caminho, mesma filosofia de `reversePurchaseNoteAdmin` (bloquear quando
 *     não dá pra provar que é seguro, não adivinhar). Isso cobre de graça os
 *     efeitos de receita (`transactionId`, só existe a partir de `entregue`)
 *     e fiscal (`fiscalDocumentId`, idem) — nunca existem antes de `recebido`
 *     sair de cena, então não precisam de reconciliação própria.
 *   - Campos LIVRES (contato do cliente, notas, forma/status de pagamento
 *     quando não for Mercado Pago, previsão de entrega) mudam em qualquer
 *     status — não afetam estoque nem valores já efetivados.
 *   - Mudança de `items` em `recebido` reconcilia estoque por RESTAURA TUDO +
 *     DEDUZ TUDO DE NOVO (não delta cirúrgico por SKU) — reaproveita
 *     `restoreStockAdmin`/`deductStockAdmin` (já expandem BOM corretamente,
 *     ao contrário de `ajuste`, que exige expansão manual). Mais simples e
 *     mais seguro que computar delta por SKU; custo extra de alguns
 *     `stockMovements` é aceitável pro volume de edições de um restaurante.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type {
  DeliveryOrder, DeliveryOrderItem, DeliveryOrderAddress, DeliveryOrderPaymentMethod,
  DeliveryOrderPaymentStatus, DeliveryType, StockAlert,
} from '@/lib/types';
import { buildOrderStockLines } from '@/lib/services/stock-lines';
import { checkStockAvailability, deductStockAdmin, restoreStockAdmin } from '@/lib/services/stock-admin';
import { resolveOrderStockProductIndex } from '@/lib/services/order-stock-restore';

export class DeliveryOrderEditBlockedError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DeliveryOrderEditBlockedError';
  }
}

export interface DeliveryOrderEditActor {
  id: string;
  name: string;
  type: 'user' | 'agent';
}

export interface DeliveryOrderEditPatch {
  clientId?: string;
  clientName?: string;
  clientPhone?: string;
  items?: DeliveryOrderItem[];
  deliveryFee?: number;
  discount?: number;
  deliveryType?: DeliveryType;
  deliveryAddress?: DeliveryOrderAddress;
  /** Número/identificador da mesa — campo livre (não afeta estoque/total),
   *  editável em qualquer status (ex: hóspede trocou de mesa). */
  tableNumber?: string;
  paymentMethod?: DeliveryOrderPaymentMethod;
  paymentStatus?: DeliveryOrderPaymentStatus;
  changeFor?: number;
  customerNotes?: string;
  internalNotes?: string;
  estimatedDeliveryAt?: string;
}

export interface DeliveryOrderEditResult {
  order: DeliveryOrder;
  stockReconciled: boolean;
  stockAlerts: StockAlert[];
}

const SENSITIVE_KEYS = ['items', 'deliveryFee', 'discount', 'deliveryType', 'deliveryAddress'] as const;

/** Assinatura estável de um item — ordem de selectedModifiers não importa pro efeito de estoque/valor. */
function itemSignature(item: DeliveryOrderItem): string {
  const mods = (item.selectedModifiers ?? [])
    .map((m) => `${m.groupId}:${m.selectedOptions.map((o) => `${o.optionId}x${o.quantity}`).sort().join(',')}`)
    .sort().join('|');
  return `${item.productId}x${item.quantity}[${mods}]`;
}

function itemsEqual(a: DeliveryOrderItem[], b: DeliveryOrderItem[]): boolean {
  if (a.length !== b.length) return false;
  const sigA = a.map(itemSignature).sort();
  const sigB = b.map(itemSignature).sort();
  return sigA.every((s, i) => s === sigB[i]);
}

function addressEqual(a: DeliveryOrderAddress | undefined, b: DeliveryOrderAddress | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Quais campos sensíveis o patch está de fato MUDANDO (valor diferente do atual) — não só presentes. */
function touchedSensitiveFields(order: DeliveryOrder, patch: DeliveryOrderEditPatch): string[] {
  const touched: string[] = [];
  if (patch.items !== undefined && !itemsEqual(patch.items, order.items ?? [])) touched.push('items');
  if (patch.deliveryFee !== undefined && (patch.deliveryFee || 0) !== (order.deliveryFee || 0)) touched.push('deliveryFee');
  if (patch.discount !== undefined && (patch.discount || 0) !== (order.discount || 0)) touched.push('discount');
  if (patch.deliveryType !== undefined && patch.deliveryType !== order.deliveryType) touched.push('deliveryType');
  if (patch.deliveryAddress !== undefined && !addressEqual(patch.deliveryAddress, order.deliveryAddress)) touched.push('deliveryAddress');
  return touched;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

export async function editDeliveryOrderAdmin(params: {
  db: Firestore;
  orderId: string;
  businessId: string;
  patch: DeliveryOrderEditPatch;
  actor: DeliveryOrderEditActor;
  now?: Date;
}): Promise<DeliveryOrderEditResult> {
  const { db, orderId, businessId, patch, actor } = params;
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();

  const orderRef = db.collection('deliveryOrders').doc(orderId);
  const snap = await orderRef.get();
  if (!snap.exists) {
    throw new DeliveryOrderEditBlockedError('NOT_FOUND', 'Pedido não encontrado.');
  }
  const order = { id: snap.id, ...snap.data() } as DeliveryOrder;
  if (order.businessId !== businessId) {
    throw new DeliveryOrderEditBlockedError('TENANT_MISMATCH', 'Pedido pertence a outro negócio.');
  }

  const touched = touchedSensitiveFields(order, patch);
  if (touched.length > 0 && order.status !== 'recebido') {
    throw new DeliveryOrderEditBlockedError(
      'EDIT_BLOCKED',
      `Pedido já está em "${order.status}" — não é possível alterar ${touched.join(', ')}. Cancele e crie um novo pedido.`,
    );
  }

  let stockReconciled = false;
  let stockAlerts: StockAlert[] = [];
  const itemsChanged = touched.includes('items');

  if (itemsChanged) {
    const oldItems = order.items ?? [];
    const newItems = patch.items!;
    const productIndex = await resolveOrderStockProductIndex(db, [...oldItems, ...newItems], businessId);
    const oldLines = buildOrderStockLines({ ...order, items: oldItems }, productIndex);
    const newLines = buildOrderStockLines({ ...order, items: newItems }, productIndex);

    // Pré-checagem: estoque atual + o que os itens antigos vão devolver precisa
    // cobrir os itens novos. Rejeita cedo sem tocar em nada — evita deixar o
    // pedido num estado intermediário (restaurado mas não rededuzido).
    const netAvailability = new Map<string, number>();
    for (const line of oldLines) netAvailability.set(line.productId, (netAvailability.get(line.productId) || 0) + line.quantity);
    const projectedIndex = new Map(productIndex);
    for (const [productId, restored] of netAvailability) {
      const product = projectedIndex.get(productId);
      if (product) projectedIndex.set(productId, { ...product, currentStock: (product.currentStock ?? 0) + restored });
    }
    const shortages = checkStockAvailability(newLines, projectedIndex);
    if (shortages.length > 0) {
      const detail = shortages.map((s) => `${s.productName} (pede ${s.requested}, disponível ${s.available})`).join('; ');
      throw new DeliveryOrderEditBlockedError('INSUFFICIENT_STOCK', `Estoque insuficiente pros itens novos: ${detail}.`);
    }

    const editVersion = order.updatedAt || nowIso;
    await restoreStockAdmin(db, oldLines, {
      businessId,
      operatorId: actor.id,
      operatorName: actor.name,
      sourceType: 'refund',
      sourceId: orderId,
      sourceDocument: { collection: 'deliveryOrders', id: orderId, existence: 'required' },
      idempotencyKey: `order:${orderId}:edit:${editVersion}:restore`,
      reason: `Edição de pedido #${order.number} — restauro dos itens anteriores`,
      productIndex,
    });

    try {
      const result = await deductStockAdmin(db, newLines, {
        businessId,
        operatorId: actor.id,
        operatorName: actor.name,
        sourceType: 'order',
        sourceId: orderId,
        sourceDocument: { collection: 'deliveryOrders', id: orderId, existence: 'required' },
        idempotencyKey: `order:${orderId}:edit:${editVersion}:deduct`,
        reason: `Edição de pedido #${order.number} — dedução dos novos itens`,
        productIndex,
        negativeStockPolicy: 'prevent',
      });
      stockAlerts = result.flatMap((a) => (a.alert ? [a.alert] : []));
    } catch (err) {
      // Compensação: a pré-checagem cobre o caso comum, mas uma corrida real
      // (outro pedido consumiu o estoque entre o check e a dedução) pode
      // ainda assim falhar aqui. Devolve os itens ANTIGOS pra não deixar o
      // pedido sem NENHUM estoque debitado.
      await deductStockAdmin(db, oldLines, {
        businessId,
        operatorId: actor.id,
        operatorName: actor.name,
        sourceType: 'order',
        sourceId: orderId,
        sourceDocument: { collection: 'deliveryOrders', id: orderId, existence: 'required' },
        idempotencyKey: `order:${orderId}:edit:${editVersion}:compensate`,
        reason: `Edição de pedido #${order.number} — compensação após falha na redução`,
        productIndex,
      }).catch((compensateErr) => {
        console.error('[delivery-order-edit-admin] compensação falhou — estoque pode estar inconsistente', { orderId, compensateErr });
      });
      throw err;
    }
    stockReconciled = true;
  }

  const nextItems = patch.items ?? order.items;
  const subtotal = round2((nextItems ?? []).reduce((sum, it) => sum + (Number(it.total) || 0), 0));
  const deliveryFee = patch.deliveryFee ?? order.deliveryFee ?? 0;
  const discount = patch.discount ?? order.discount ?? 0;
  const total = round2(subtotal + deliveryFee - discount);

  const update: Record<string, unknown> = { updatedAt: nowIso };
  if (patch.clientId !== undefined) update.clientId = patch.clientId;
  if (patch.clientName !== undefined) update.clientName = patch.clientName;
  if (patch.clientPhone !== undefined) update.clientPhone = patch.clientPhone;
  if (patch.customerNotes !== undefined) update.customerNotes = patch.customerNotes;
  if (patch.internalNotes !== undefined) update.internalNotes = patch.internalNotes;
  if (patch.changeFor !== undefined) update.changeFor = patch.changeFor;
  if (patch.estimatedDeliveryAt !== undefined) update.estimatedDeliveryAt = patch.estimatedDeliveryAt;
  if (patch.tableNumber !== undefined) update.tableNumber = patch.tableNumber;
  // Pagamento trava só pra pedidos Mercado Pago (mesmo padrão já usado hoje).
  if (order.paymentProvider !== 'mercadopago') {
    if (patch.paymentMethod !== undefined) update.paymentMethod = patch.paymentMethod;
    if (patch.paymentStatus !== undefined) update.paymentStatus = patch.paymentStatus;
  }
  if (touched.length > 0) {
    update.items = nextItems;
    update.subtotal = subtotal;
    update.total = total;
    update.deliveryFee = deliveryFee;
    update.discount = discount;
    if (patch.deliveryType !== undefined) update.deliveryType = patch.deliveryType;
    if (patch.deliveryAddress !== undefined) update.deliveryAddress = patch.deliveryAddress;
  }

  await orderRef.update(update);
  const finalSnap = await orderRef.get();
  return {
    order: { id: finalSnap.id, ...finalSnap.data() } as DeliveryOrder,
    stockReconciled,
    stockAlerts,
  };
}
