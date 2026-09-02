import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

vi.mock('@/lib/services/structured-operation-log', () => ({ writeStructuredOperationLog: vi.fn() }));

import { ProductV2Schema, type ProductV2 } from '@/contracts/domain/productV2';
import {
  CreateDeliveryOrderWithSideEffectsInputSchema,
  type CreateDeliveryOrderWithSideEffectsInput,
} from '@/contracts/api/services/delivery-order-server';
import { CommercialOperationError, CommercialOperationIdempotencyConflictError } from '@/lib/services/commercial-operation-admin';
import { CommercialQuoteError } from '@/lib/services/commercial-quote';
import { createDeliveryOrderWithSideEffects } from '@/lib/services/delivery-order-server';
import { transitionDeliveryOrderAdmin } from '@/lib/services/delivery-order-transition-admin';

interface FakeQuery {
  _coll: string;
  _filters: Array<{ field: string; op: string; expected: unknown }>;
  where: (field: string, operator: string, expected: unknown) => FakeQuery;
  orderBy: () => FakeQuery;
  limit: () => FakeQuery;
  get: () => Promise<FakeQuerySnapshot>;
}

interface FakeSnapshot {
  id: string;
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}

interface FakeQuerySnapshot {
  docs: FakeSnapshot[];
  empty: boolean;
  size: number;
}

interface FakeRef {
  id: string;
  _coll: string;
  get: () => Promise<FakeSnapshot>;
  collection: (name: string) => FakeCollection;
  update: (data: Record<string, unknown>) => Promise<void>;
}

interface FakeCollection {
  doc: (id?: string) => FakeRef;
  where: (field: string, operator: string, expected: unknown) => FakeQuery;
  add: (data: Record<string, unknown>) => Promise<FakeRef>;
}

type PendingWrite =
  | { kind: 'create' | 'set'; ref: FakeRef; data: Record<string, unknown> }
  | { kind: 'update'; ref: FakeRef; data: Record<string, unknown> };

function clone<T>(value: T): T { return structuredClone(value); }

function mergeWithIncrement(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && '__increment' in (value as Record<string, unknown>)) {
      merged[key] = Number(current[key] ?? 0) + Number((value as { __increment: number }).__increment);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function fieldValue(data: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), data);
}

let autoIdCounter = 0;

function makeFakeDb(initial: Record<string, Record<string, unknown>> = {}) {
  const documents = new Map(Object.entries(initial).map(([path, data]) => [path, clone(data)]));
  let transactionTail: Promise<void> = Promise.resolve();

  const snapshot = (ref: FakeRef): FakeSnapshot => {
    const data = documents.get(`${ref._coll}/${ref.id}`);
    return { id: ref.id, exists: Boolean(data), data: () => data ? clone(data) : undefined };
  };
  const matchesFilter = (data: Record<string, unknown>, filter: FakeQuery['_filters'][number]): boolean => {
    const value = fieldValue(data, filter.field);
    if (filter.op === 'in') return Array.isArray(filter.expected) && (filter.expected as unknown[]).includes(value);
    return value === filter.expected;
  };
  const querySnapshot = (query: FakeQuery): FakeQuerySnapshot => {
    const prefix = `${query._coll}/`;
    const docs = [...documents.entries()]
      .filter(([path, data]) => path.startsWith(prefix)
        && !path.slice(prefix.length).includes('/')
        && query._filters.every((filter) => matchesFilter(data, filter)))
      .map(([path, data]) => ({ id: path.slice(prefix.length), exists: true, data: () => clone(data) }));
    return { docs, empty: docs.length === 0, size: docs.length };
  };
  const makeQuery = (coll: string, filters: FakeQuery['_filters']): FakeQuery => ({
    _coll: coll,
    _filters: filters,
    where(field: string, operator: string, expected: unknown) {
      return makeQuery(coll, [...filters, { field, op: operator, expected }]);
    },
    orderBy() { return makeQuery(coll, filters); },
    limit() { return makeQuery(coll, filters); },
    async get() { return querySnapshot(this); },
  });
  const makeCollection = (coll: string): FakeCollection => ({
    doc(id?: string): FakeRef {
      const docId = id ?? `auto_${++autoIdCounter}`;
      const ref: FakeRef = {
        id: docId,
        _coll: coll,
        async get() { return snapshot(ref); },
        collection(name: string) { return makeCollection(`${coll}/${docId}/${name}`); },
        async update(data: Record<string, unknown>) {
          const path = `${coll}/${docId}`;
          const current = documents.get(path);
          if (!current) throw new Error(`Documento ausente: ${path}`);
          documents.set(path, mergeWithIncrement(current, data));
        },
      };
      return ref;
    },
    where(field: string, operator: string, expected: unknown) {
      return makeQuery(coll, []).where(field, operator, expected);
    },
    async add(data: Record<string, unknown>) {
      const ref = this.doc();
      documents.set(`${ref._coll}/${ref.id}`, clone(data));
      return ref;
    },
  });

  const db = {
    collection(coll: string) { return makeCollection(coll); },
    async getAll(...refs: FakeRef[]) { return refs.map(snapshot); },
    async runTransaction<T>(handler: (tx: unknown) => Promise<T>): Promise<T> {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const writes: PendingWrite[] = [];
      const tx = {
        async get(ref: FakeRef | FakeQuery) {
          return '_filters' in ref ? querySnapshot(ref) : snapshot(ref);
        },
        create(ref: FakeRef, data: Record<string, unknown>) {
          if (documents.has(`${ref._coll}/${ref.id}`) || writes.some((write) => write.ref._coll === ref._coll && write.ref.id === ref.id)) {
            throw new Error(`Documento já existe: ${ref._coll}/${ref.id}`);
          }
          writes.push({ kind: 'create', ref, data: clone(data) });
        },
        set(ref: FakeRef, data: Record<string, unknown>) {
          writes.push({ kind: 'set', ref, data: clone(data) });
        },
        update(ref: FakeRef, data: Record<string, unknown>) {
          writes.push({ kind: 'update', ref, data: clone(data) });
        },
      };
      try {
        const result = await handler(tx);
        for (const write of writes) {
          const path = `${write.ref._coll}/${write.ref.id}`;
          if (write.kind === 'update') {
            const current = documents.get(path);
            if (!current) throw new Error(`Documento ausente: ${path}`);
            documents.set(path, mergeWithIncrement(current, clone(write.data)));
          } else {
            documents.set(path, clone(write.data));
          }
        }
        return result;
      } finally {
        release();
      }
    },
    async update(ref: FakeRef, data: Record<string, unknown>) {
      const path = `${ref._coll}/${ref.id}`;
      const current = documents.get(path);
      if (!current) throw new Error(`Documento ausente: ${path}`);
      documents.set(path, mergeWithIncrement(current, data));
    },
  };

  return {
    db: db as unknown as Firestore,
    get(path: string) { const data = documents.get(path); return data ? clone(data) : undefined; },
    list(collection: string) {
      const prefix = `${collection}/`;
      return [...documents.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([path, data]) => ({ id: path.slice(prefix.length), data: clone(data) }));
    },
  };
}

const NOW = new Date('2026-08-31T18:00:00.000Z');

function product(overrides: Record<string, unknown> = {}): ProductV2 {
  return ProductV2Schema.parse({
    schemaVersion: 2,
    id: 'p1',
    businessId: 'biz1',
    kind: 'simple',
    name: 'Pizza autoritativa',
    category: 'Geral',
    unit: 'UN',
    purchaseUnit: 'UN',
    purchaseToStockFactor: 1,
    costMethod: 'moving_average',
    costPrice: 10,
    salePrice: 40,
    currentStock: 5,
    minStock: 0,
    trackStock: true,
    trackLots: false,
    trackExpiry: false,
    expiryWarningDays: 30,
    isActive: true,
    isDeliverable: true,
    images: [],
    variants: [],
    menuAvailable: true,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  });
}

function stored<T extends { id: string }>(item: T) {
  const { id, ...data } = item;
  return data as Record<string, unknown>;
}

function business(overrides: Record<string, unknown> = {}) {
  return {
    id: 'biz1',
    businessId: 'biz1',
    name: 'Loja Teste',
    settings: { aiAgent: { pedidos: { deliveryFee: 6 } } },
    ...overrides,
  };
}

function baseInput(overrides: Record<string, unknown> = {}): CreateDeliveryOrderWithSideEffectsInput {
  return CreateDeliveryOrderWithSideEffectsInputSchema.parse({
    businessId: 'biz1',
    clientName: 'Cliente Site',
    items: [{
      productId: 'p1',
      productName: 'Nome adulterado',
      quantity: 1,
      unitPrice: 40,
      total: 40,
    }],
    deliveryType: 'retirada',
    idempotencyKey: 'delivery-checkout-1',
    ...overrides,
  });
}

function initialDocuments() {
  return {
    'products/p1': stored(product()),
    'businesses/biz1': business(),
  };
}

describe('M02.5a — checkout comercial do cardápio público', () => {
  it('cria pedido de retirada simples com número, operação e sem taxa de entrega', async () => {
    const fake = makeFakeDb(initialDocuments());
    const result = await createDeliveryOrderWithSideEffects(baseInput(), fake.db, { now: () => NOW });

    expect(result.order).toMatchObject({
      businessId: 'biz1', status: 'recebido', deliveryFee: 0, total: 40,
    });
    expect(result.order.discount).toBeUndefined();
    expect(result.order.giftCardAmount).toBeUndefined();
    expect(result.order.number).toBeGreaterThan(0);
    expect(result.order.commercialOperationId).toBe(result.operationId);
    expect(result.trackingToken).toHaveLength(43); // 32 bytes base64url
    expect(fake.list('deliveryOrders')).toHaveLength(1);
    expect(fake.get('products/p1')?.currentStock).toBe(4);
    // Regressão: sem isto, delivery-order-transition-admin.ts tratava todo
    // pedido novo como "legado sem stockDeductedAt" e debitava o estoque de
    // novo na transição recebido→preparando (dedução dupla).
    expect(result.order.stockDeductedAt).toBeTruthy();
  });

  it('rejeita preço de item adulterado antes de tocar estoque ou número', async () => {
    const fake = makeFakeDb(initialDocuments());
    await expect(createDeliveryOrderWithSideEffects(baseInput({
      items: [{ productId: 'p1', productName: 'Pizza', quantity: 1, unitPrice: 1, total: 1 }],
    }), fake.db, { now: () => NOW })).rejects.toBeInstanceOf(CommercialOperationError);
    expect(fake.list('deliveryOrders')).toHaveLength(0);
    expect(fake.get('products/p1')?.currentStock).toBe(5);
    expect(fake.get('businesses/biz1')?.lastOrderNumber).toBeUndefined();
  });

  it('calcula taxa de entrega pela zona resolvida e reconstrói modificador adulterado do catálogo', async () => {
    const withModifier = product({
      modifierGroups: [{
        id: 'extras', name: 'Extras', required: false, minSelections: 0, maxSelections: 3,
        selectionType: 'quantity', priceStrategy: 'sum', sortOrder: 0,
        options: [{ id: 'bacon', name: 'Bacon', additionalPrice: 4, available: true, maxQuantity: 2, sortOrder: 0 }],
      }],
    });
    const fake = makeFakeDb({ ...initialDocuments(), 'products/p1': stored(withModifier) });
    const result = await createDeliveryOrderWithSideEffects(baseInput({
      items: [{
        productId: 'p1', productName: 'Nome falso', quantity: 1, unitPrice: 44, total: 44,
        selectedModifiers: [{
          groupId: 'extras', groupName: 'Grupo falso', priceStrategy: 'sum',
          selectedOptions: [{ optionId: 'bacon', optionName: 'Opção falsa', additionalPrice: 0, quantity: 1 }],
        }],
      }],
      deliveryType: 'entrega',
      deliveryAddress: { logradouro: 'Rua X', numero: '1', bairro: 'Centro', municipio: 'POA', uf: 'RS' },
    }), fake.db, { now: () => NOW });

    expect(result.order.items[0]).toMatchObject({
      productName: 'Pizza autoritativa', unitPrice: 44,
      selectedModifiers: [{ groupName: 'Extras', selectedOptions: [{ optionName: 'Bacon', additionalPrice: 4 }] }],
    });
    expect(result.order.deliveryFee).toBe(6);
    expect(result.order.total).toBe(50);
  });

  it('aplica cupom appliesTo=entrega num pedido de entrega (regressão do bug de deliveryType fixo)', async () => {
    const coupon = {
      id: 'cp-1', businessId: 'biz1', code: 'ENTREGA10', discountType: 'fixed', discountValue: 10,
      appliesTo: 'entrega', status: 'active', usedCount: 0, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    };
    const fake = makeFakeDb({ ...initialDocuments(), 'coupons/cp-1': coupon });
    const result = await createDeliveryOrderWithSideEffects(baseInput({
      deliveryType: 'entrega',
      deliveryAddress: { logradouro: 'Rua X', numero: '1', bairro: 'Centro', municipio: 'POA', uf: 'RS' },
      couponCode: 'ENTREGA10',
    }), fake.db, { now: () => NOW });

    expect(result.order).toMatchObject({
      couponId: 'cp-1', couponCode: 'ENTREGA10', couponDiscount: 10, discount: 10, deliveryFee: 6, total: 36,
    });
    expect(fake.get('coupons/cp-1')?.usedCount).toBe(1);
  });

  it('cupom de frete grátis zera a taxa sem contar como discount de mercadoria', async () => {
    const coupon = {
      id: 'cp-free', businessId: 'biz1', code: 'FRETEGRATIS', discountType: 'free_delivery', discountValue: 0,
      appliesTo: 'all', status: 'active', usedCount: 0, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    };
    const fake = makeFakeDb({ ...initialDocuments(), 'coupons/cp-free': coupon });
    const result = await createDeliveryOrderWithSideEffects(baseInput({
      deliveryType: 'entrega',
      deliveryAddress: { logradouro: 'Rua X', numero: '1', bairro: 'Centro', municipio: 'POA', uf: 'RS' },
      couponCode: 'FRETEGRATIS',
    }), fake.db, { now: () => NOW });

    expect(result.order).toMatchObject({ deliveryFee: 0, total: 40, couponId: 'cp-free' });
    expect(result.order.discount).toBeUndefined();
  });

  it('gift card cobre parcialmente o total sem entrar no campo discount', async () => {
    const giftCard = {
      id: 'gc-1', businessId: 'biz1', code: 'GIFT10', originalValue: 10, remainingValue: 10, status: 'active',
      purchasedAt: NOW.toISOString(), createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    };
    const fake = makeFakeDb({ ...initialDocuments(), 'giftCards/gc-1': giftCard });
    const result = await createDeliveryOrderWithSideEffects(baseInput({
      giftCardCode: 'GIFT10',
    }), fake.db, { now: () => NOW });

    expect(result.order).toMatchObject({ giftCardAmount: 10, giftCardId: 'gc-1', total: 30 });
    expect(result.order.discount).toBeUndefined();
    expect(fake.get('giftCards/gc-1')?.remainingValue).toBe(0);
    expect(fake.get('giftCards/gc-1')?.status).toBe('used');
  });

  it('gift card inexistente aborta toda a operação sem criar pedido nem baixar estoque', async () => {
    const fake = makeFakeDb(initialDocuments());
    await expect(createDeliveryOrderWithSideEffects(baseInput({
      giftCardCode: 'NAOEXISTE',
    }), fake.db, { now: () => NOW })).rejects.toBeInstanceOf(CommercialOperationError);
    expect(fake.list('deliveryOrders')).toHaveLength(0);
    expect(fake.get('products/p1')?.currentStock).toBe(5);
  });

  it('regressão: transição recebido→preparando não debita o estoque de novo (dedução dupla corrigida)', async () => {
    const fake = makeFakeDb(initialDocuments());
    const created = await createDeliveryOrderWithSideEffects(baseInput(), fake.db, { now: () => NOW });
    expect(fake.get('products/p1')?.currentStock).toBe(4); // já debitado na criação

    const result = await transitionDeliveryOrderAdmin({
      db: fake.db, orderId: created.order.id, businessId: 'biz1', targetStatus: 'preparando',
      actor: { id: 'user-1', name: 'Atendente', type: 'user' }, now: NOW,
    });

    expect(result.stockApplied).toBe(false); // stockDeductedAt já estava setado — não é "legado"
    expect(fake.get('products/p1')?.currentStock).toBe(4); // inalterado, não debitou de novo
  });

  it('bloqueia produto sem estoque (mesma regra do PDV: nenhum canal aceita saldo negativo)', async () => {
    const fake = makeFakeDb({ ...initialDocuments(), 'products/p1': stored(product({ currentStock: 0 })) });
    await expect(createDeliveryOrderWithSideEffects(baseInput(), fake.db, { now: () => NOW }))
      .rejects.toThrow();
    expect(fake.list('deliveryOrders')).toHaveLength(0);
  });

  it('replay pela mesma chave de idempotência não cria pedido nem baixa estoque de novo', async () => {
    const fake = makeFakeDb(initialDocuments());
    const input = baseInput();
    const first = await createDeliveryOrderWithSideEffects(input, fake.db, { now: () => NOW });
    const replay = await createDeliveryOrderWithSideEffects(input, fake.db, { now: () => new Date('2026-09-01T10:00:00.000Z') });

    expect(replay).toMatchObject({ operationId: first.operationId, orderNumber: first.orderNumber, replayed: true });
    expect(fake.list('deliveryOrders')).toHaveLength(1);
    expect(fake.get('products/p1')?.currentStock).toBe(4);
  });

  it('retentativa sem idempotencyKey mas com carrinho idêntico deduplica pelo conteúdo', async () => {
    const fake = makeFakeDb(initialDocuments());
    const input = baseInput({ idempotencyKey: undefined });
    const first = await createDeliveryOrderWithSideEffects(input, fake.db, { now: () => NOW });
    const second = await createDeliveryOrderWithSideEffects(input, fake.db, { now: () => NOW });

    expect(second.operationId).toBe(first.operationId);
    expect(fake.list('deliveryOrders')).toHaveLength(1);
  });

  it('rejeita a mesma chave de idempotência com um carrinho diferente', async () => {
    const fake = makeFakeDb(initialDocuments());
    const key = 'reused-key-1';
    await createDeliveryOrderWithSideEffects(baseInput({ idempotencyKey: key }), fake.db, { now: () => NOW });
    await expect(createDeliveryOrderWithSideEffects(baseInput({
      idempotencyKey: key,
      items: [{ productId: 'p1', productName: 'Pizza', quantity: 2, unitPrice: 40, total: 80 }],
    }), fake.db, { now: () => NOW })).rejects.toBeInstanceOf(CommercialOperationIdempotencyConflictError);
  });

  it('isola produto de outro tenant', async () => {
    const fake = makeFakeDb({ ...initialDocuments(), 'products/p1': stored(product({ businessId: 'biz2' })) });
    await expect(createDeliveryOrderWithSideEffects(baseInput(), fake.db, { now: () => NOW }))
      .rejects.toBeInstanceOf(CommercialQuoteError);
  });
});

describe('M02.5b — pedido manual (canal manual, autenticado)', () => {
  const manualCtx = { now: () => NOW, channel: 'manual' as const, actorType: 'user' as const };

  it('usa clientId já resolvido pelo operador e grava createdBy/createdByName/originChannel', async () => {
    const fake = makeFakeDb({
      ...initialDocuments(),
      'clients/client-1': { businessId: 'biz1', name: 'Cliente Existente', visitCount: 2 },
    });
    const result = await createDeliveryOrderWithSideEffects(baseInput({
      clientId: 'client-1',
      clientName: 'Cliente Existente',
      operatorId: 'user-1',
      operatorName: 'Atendente Teste',
      originChannel: 'whatsapp',
    }), fake.db, manualCtx);

    expect(result.order).toMatchObject({
      clientId: 'client-1', channel: 'whatsapp', createdBy: 'user-1', createdByName: 'Atendente Teste',
    });
  });

  it('rejeita clientId de outro tenant antes de qualquer efeito', async () => {
    const fake = makeFakeDb({
      ...initialDocuments(),
      'clients/client-2': { businessId: 'biz2', name: 'Cliente Alheio' },
    });
    await expect(createDeliveryOrderWithSideEffects(baseInput({
      clientId: 'client-2', operatorId: 'user-1', operatorName: 'Atendente Teste',
    }), fake.db, manualCtx)).rejects.toMatchObject({ code: 'TENANT_MISMATCH' });
    expect(fake.list('deliveryOrders')).toHaveLength(0);
  });

  it('aplica desconto manual com permissão de gerente', async () => {
    const fake = makeFakeDb(initialDocuments());
    const result = await createDeliveryOrderWithSideEffects(baseInput({
      discount: 10, discountReason: 'Cliente fidelizado', operatorId: 'user-1', operatorName: 'Gerente Teste',
    }), fake.db, { ...manualCtx, canApplyManualDiscount: true });

    expect(result.order).toMatchObject({ discount: 10, total: 30 });
  });

  it('rejeita desconto manual sem permissão', async () => {
    const fake = makeFakeDb(initialDocuments());
    await expect(createDeliveryOrderWithSideEffects(baseInput({
      discount: 10, operatorId: 'user-1', operatorName: 'Operador Teste',
    }), fake.db, { ...manualCtx, canApplyManualDiscount: false }))
      .rejects.toBeInstanceOf(CommercialQuoteError);
    expect(fake.list('deliveryOrders')).toHaveLength(0);
  });

  it('permite taxa de entrega manual fora de área com permissão de gerente', async () => {
    const fake = makeFakeDb({
      ...initialDocuments(),
      'businesses/biz1': business({
        settings: { aiAgent: { deliveryZones: [{ id: 'z1', name: 'Centro', type: 'neighborhood', value: 'Centro', fee: 6 }] } },
      }),
    });
    const result = await createDeliveryOrderWithSideEffects(baseInput({
      deliveryType: 'entrega',
      deliveryAddress: { logradouro: 'Rua X', numero: '1', bairro: 'Bairro Fora De Área', municipio: 'POA', uf: 'RS' },
      manualDeliveryFee: 15,
      operatorId: 'user-1', operatorName: 'Gerente Teste',
    }), fake.db, { ...manualCtx, canOverrideDeliveryFee: true });

    expect(result.order).toMatchObject({ deliveryFee: 15, total: 55 });
  });

  it('rejeita taxa de entrega manual fora de área sem permissão', async () => {
    const fake = makeFakeDb({
      ...initialDocuments(),
      'businesses/biz1': business({
        settings: { aiAgent: { deliveryZones: [{ id: 'z1', name: 'Centro', type: 'neighborhood', value: 'Centro', fee: 6 }] } },
      }),
    });
    await expect(createDeliveryOrderWithSideEffects(baseInput({
      deliveryType: 'entrega',
      deliveryAddress: { logradouro: 'Rua X', numero: '1', bairro: 'Bairro Fora De Área', municipio: 'POA', uf: 'RS' },
      manualDeliveryFee: 15,
      operatorId: 'user-1', operatorName: 'Operador Teste',
    }), fake.db, { ...manualCtx, canOverrideDeliveryFee: false }))
      .rejects.toBeInstanceOf(CommercialQuoteError);
  });

  it('ignora a taxa manual quando o endereço casa numa zona configurada', async () => {
    const fake = makeFakeDb({
      ...initialDocuments(),
      'businesses/biz1': business({
        settings: { aiAgent: { deliveryZones: [{ id: 'z1', name: 'Centro', type: 'neighborhood', value: 'Centro', fee: 6 }] } },
      }),
    });
    const result = await createDeliveryOrderWithSideEffects(baseInput({
      deliveryType: 'entrega',
      deliveryAddress: { logradouro: 'Rua X', numero: '1', bairro: 'Centro', municipio: 'POA', uf: 'RS' },
      manualDeliveryFee: 999,
      operatorId: 'user-1', operatorName: 'Gerente Teste',
    }), fake.db, { ...manualCtx, canOverrideDeliveryFee: true });

    expect(result.order.deliveryFee).toBe(6);
  });

  it('respeita paymentStatus explícito (pago) em vez do default pendente', async () => {
    const fake = makeFakeDb(initialDocuments());
    const result = await createDeliveryOrderWithSideEffects(baseInput({
      paymentStatus: 'pago', operatorId: 'user-1', operatorName: 'Atendente Teste',
    }), fake.db, manualCtx);

    expect(result.order.paymentStatus).toBe('pago');
  });
});

describe('M02.5c — pedido do agente (canal agent)', () => {
  it('ignora unitPrice/total=0 do item (agente nunca teve preço real pra enviar) e usa o preço do catálogo', async () => {
    const fake = makeFakeDb(initialDocuments());
    const result = await createDeliveryOrderWithSideEffects(baseInput({
      items: [{ productId: 'p1', productName: 'p1', quantity: 1, unitPrice: 0, total: 0 }],
      operatorId: 'agent', operatorName: 'Agente IA',
    }), fake.db, { now: () => NOW, channel: 'agent', actorType: 'agent' });

    expect(result.order.total).toBe(40);
    expect(result.order.items[0]).toMatchObject({ productName: 'Pizza autoritativa', unitPrice: 40 });
  });

  it('não permite desconto manual nem override de frete mesmo se enviados (sem permissão concedida ao canal)', async () => {
    const fake = makeFakeDb({
      ...initialDocuments(),
      'businesses/biz1': business({
        settings: { aiAgent: { deliveryZones: [{ id: 'z1', name: 'Centro', type: 'neighborhood', value: 'Centro', fee: 6 }] } },
      }),
    });
    await expect(createDeliveryOrderWithSideEffects(baseInput({
      items: [{ productId: 'p1', productName: 'p1', quantity: 1, unitPrice: 0, total: 0 }],
      deliveryType: 'entrega',
      deliveryAddress: { logradouro: 'Rua X', numero: '1', bairro: 'Fora De Área', municipio: 'POA', uf: 'RS' },
      manualDeliveryFee: 15,
      operatorId: 'agent', operatorName: 'Agente IA',
    }), fake.db, { now: () => NOW, channel: 'agent', actorType: 'agent' }))
      .rejects.toBeInstanceOf(CommercialQuoteError);
  });
});
