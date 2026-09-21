import { describe, it, expect, beforeAll, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useVitrineProposal } from '@/app/components/features/vitrine/useVitrineProposal';
import type { ApiRequest, ApiResult } from '@/lib/services/vitrine/apiClient';
import type { BusinessPromotion, Product, ProductVariant } from '@/lib/types';

vi.mock('react-toastify', () => ({ toast: { warning: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

type Params = Parameters<typeof useVitrineProposal>[0];

function renderHook(initial: Params) {
  const state = { params: initial };
  const result = { current: undefined as unknown as ReturnType<typeof useVitrineProposal> };
  function Probe() {
    result.current = useVitrineProposal(state.params);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  act(() => root.render(<Probe />));
  return {
    result,
    rerender(next: Partial<Params>) {
      state.params = { ...state.params, ...next };
      act(() => root.render(<Probe />));
    },
  };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1', businessId: 'biz_1', name: 'Pacote Spot', category: 'Pacotes', unit: 'UN',
    costPrice: 0, salePrice: 1500, currentStock: 0, minStock: 0, isActive: true, trackStock: false,
    createdAt: '', updatedAt: '', ...overrides,
  };
}

function variant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: 'v30', name: '30s', attributes: {}, salePrice: 1200, costPrice: 0, currentStock: 0,
    minStock: 0, trackStock: false, isActive: true, ...overrides,
  };
}

const promo: BusinessPromotion = { id: 'promo1', name: 'Lançamento', type: 'percentage', value: 10, isActive: true };

interface Call { path: string; body: Record<string, unknown> }

/** Servidor de mentira: criação idempotente por chave + FSM de status. */
function makeServer(options: { invoiceFailures?: Array<Extract<ApiResult, { ok: false }>>; createFailure?: Extract<ApiResult, { ok: false }> } = {}) {
  const calls: Call[] = [];
  const orders = new Map<string, { id: string; status: string; total: number; transactionIds?: string[] }>();
  const invoiceFailures = [...(options.invoiceFailures ?? [])];
  let sequence = 0;

  const request: ApiRequest = async (path, init) => {
    const body = init.body as Record<string, unknown>;
    calls.push({ path, body });

    if (path === '/api/b2b-orders') {
      if (options.createFailure) return options.createFailure;
      const key = body.idempotencyKey as string;
      let order = orders.get(key);
      if (!order) {
        order = { id: `order_${++sequence}`, status: 'pendente', total: (body.expectedTotalCents as number) / 100 };
        orders.set(key, order);
      }
      return { ok: true, data: { ...order } };
    }

    const orderId = path.split('/')[3];
    const order = [...orders.values()].find((candidate) => candidate.id === orderId);
    if (!order) return { ok: false, status: 404, error: 'Pedido não encontrado.' };
    const status = body.status as string;
    if (status === 'faturado') {
      const failure = invoiceFailures.shift();
      if (failure) return failure;
      order.status = 'faturado';
      order.transactionIds = ['tx1'];
      return { ok: true, data: { status: 'faturado', transactionIds: ['tx1'], stockAlerts: [] } };
    }
    order.status = status;
    return { ok: true, data: { status } };
  };

  return { request, calls, orders };
}

const noStock: Extract<ApiResult, { ok: false }> = {
  ok: false, status: 409, code: 'INSUFFICIENT_STOCK', error: 'Estoque insuficiente: Camiseta (disponível: 0, solicitado: 2)',
};

function setup(overrides: Partial<Params> = {}, serverOptions: Parameters<typeof makeServer>[0] = {}) {
  const server = makeServer(serverOptions);
  const hook = renderHook({
    businessId: 'biz_1',
    products: [product(), product({ id: 'p2', name: 'Menção ao vivo', salePrice: 500 })],
    catalogReady: true,
    promotions: [promo],
    canNegotiate: true,
    request: server.request,
    ...overrides,
  });
  return { ...hook, server };
}

const creates = (calls: Call[]) => calls.filter((call) => call.path === '/api/b2b-orders');

describe('useVitrineProposal — montar a proposta', () => {
  it('adiciona itens, soma quantidade do mesmo item e calcula o total', () => {
    const { result } = setup();
    act(() => { result.current.addProduct(product()); });
    act(() => { result.current.addProduct(product()); });
    act(() => { result.current.addProduct(product({ id: 'p2', name: 'Menção ao vivo', salePrice: 500 })); });

    expect(result.current.lines).toHaveLength(2);
    expect(result.current.itemCount).toBe(3);
    expect(result.current.totals.totalCents).toBe(350_000);
  });

  it('item que exige opção só entra com a opção escolhida', () => {
    const withVariants = product({ variants: [variant()] });
    const { result } = setup({ products: [withVariants] });

    let outcome: { ok: boolean } | undefined;
    act(() => { outcome = result.current.addProduct(withVariants); });
    expect(outcome).toMatchObject({ ok: false });
    expect(result.current.lines).toHaveLength(0);

    act(() => { outcome = result.current.addProduct(withVariants, variant()); });
    expect(outcome).toEqual({ ok: true });
    expect(result.current.lines[0]).toMatchObject({ variantId: 'v30', unitPriceCents: 120_000 });
  });

  it('só permite fechar com item + cliente; bloqueios explicam o que falta', () => {
    const { result } = setup();
    expect(result.current.canClose).toBe(false);
    expect(result.current.blockers).toEqual(['Adicione ao menos um item.', 'Escolha o cliente.']);

    act(() => { result.current.addProduct(product()); });
    act(() => { result.current.chooseClient({ id: 'cli_1', name: 'Padaria do Zé' }); });
    expect(result.current.canClose).toBe(true);
    expect(result.current.blockers).toEqual([]);
  });

  it('item com controle de estoque sem saldo bloqueia o fechamento (evita negócio a meio caminho)', () => {
    const tracked = product({ trackStock: true, currentStock: 1 });
    const { result } = setup({ products: [tracked] });
    act(() => { result.current.addProduct(tracked); result.current.addProduct(tracked); });
    act(() => { result.current.chooseClient({ id: 'cli_1', name: 'Zé' }); });

    expect(result.current.canClose).toBe(false);
    expect(result.current.blockers[0]).toContain('Sem saldo de Pacote Spot');
  });

  it('promoção que não vale (pedido mínimo) bloqueia em vez de fechar sem desconto em silêncio', () => {
    const strict: BusinessPromotion = { ...promo, minOrderValue: 99_999 };
    const { result } = setup({ promotions: [strict] });
    act(() => { result.current.addProduct(product()); result.current.chooseClient({ id: 'cli_1', name: 'Zé' }); });
    act(() => { result.current.choosePromotion('promo1'); });

    expect(result.current.canClose).toBe(false);
    expect(result.current.blockers.join(' ')).toContain('não vale para este pedido');
  });

  it('valor negociado inválido bloqueia; escolher promoção limpa o valor digitado e vice-versa', () => {
    const { result } = setup();
    act(() => { result.current.addProduct(product()); result.current.chooseClient({ id: 'cli_1', name: 'Zé' }); });

    act(() => { result.current.setNegotiatedText('abc'); });
    expect(result.current.negotiatedInvalid).toBe(true);
    expect(result.current.canClose).toBe(false);

    act(() => { result.current.choosePromotion('promo1'); });
    expect(result.current.negotiatedText).toBe('');
    expect(result.current.promotionId).toBe('promo1');

    act(() => { result.current.setNegotiatedText('1.200,00'); });
    expect(result.current.promotionId).toBeNull();
    expect(result.current.totals.totalCents).toBe(120_000);
  });

  it('operador (sem permissão de desconto) ignora negociação e promoção', () => {
    const { result } = setup({ canNegotiate: false });
    act(() => { result.current.addProduct(product()); });
    act(() => { result.current.setNegotiatedText('100'); result.current.choosePromotion('promo1'); });

    expect(result.current.totals.discountCents).toBe(0);
    expect(result.current.totals.totalCents).toBe(150_000);
  });
});

describe('useVitrineProposal — fechar negócio', () => {
  async function readyToClose(overrides: Partial<Params> = {}, serverOptions: Parameters<typeof makeServer>[0] = {}) {
    const ctx = setup(overrides, serverOptions);
    act(() => { ctx.result.current.addProduct(product()); });
    act(() => { ctx.result.current.chooseClient({ id: 'cli_1', name: 'Padaria do Zé' }); });
    return ctx;
  }

  it('fecha: cria, confirma, fatura e guarda a foto do negócio', async () => {
    const { result, server } = await readyToClose();
    act(() => { result.current.chooseInstallments(3); });

    await act(async () => { await result.current.close(); });

    expect(result.current.phase.kind).toBe('done');
    if (result.current.phase.kind !== 'done') return;
    expect(result.current.phase.deal).toMatchObject({
      orderId: 'order_1', client: { id: 'cli_1' }, totalCents: 150_000, installments: 3, transactionIds: ['tx1'],
    });
    expect(result.current.phase.deal.schedule).toHaveLength(3);

    const body = creates(server.calls)[0].body;
    expect(body).toMatchObject({
      businessId: 'biz_1', type: 'b2b', clientId: 'cli_1', installments: 3, paymentTerms: '3x a cada 30 dias', expectedTotalCents: 150_000,
    });
    expect(body.idempotencyKey).toEqual(expect.any(String));
  });

  it('duplo toque no botão dispara UMA criação só', async () => {
    const { result, server } = await readyToClose();

    await act(async () => {
      const first = result.current.close();
      const second = result.current.close();
      await Promise.all([first, second]);
    });

    expect(creates(server.calls)).toHaveLength(1);
    expect(server.orders.size).toBe(1);
  });

  it('com promoção manda desconto em reais + motivo e o total já descontado', async () => {
    const { result, server } = await readyToClose();
    act(() => { result.current.choosePromotion('promo1'); });
    await act(async () => { await result.current.close(); });

    expect(creates(server.calls)[0].body).toMatchObject({
      discount: 150, discountReason: 'Promoção: Lançamento', expectedTotalCents: 135_000,
    });
  });

  it('falha ao faturar TRAVA a proposta; tentar de novo retoma o MESMO pedido com a MESMA chave', async () => {
    const { result, server } = await readyToClose({}, { invoiceFailures: [noStock] });

    await act(async () => { await result.current.close(); });
    expect(result.current.phase).toMatchObject({ kind: 'failed', orderId: 'order_1', retryable: true });
    expect(result.current.editable).toBe(false);

    // travada: não aceita item novo (senão o reenvio devolveria o pedido antigo com conteúdo antigo)
    let outcome: { ok: boolean } | undefined;
    act(() => { outcome = result.current.addProduct(product({ id: 'p2', name: 'Menção ao vivo', salePrice: 500 })); });
    expect(outcome).toMatchObject({ ok: false });
    expect(result.current.lines).toHaveLength(1);
  });

  it('retry: a chave enviada na 2ª tentativa é a mesma da 1ª', async () => {
    const { result, server } = await readyToClose({}, { invoiceFailures: [noStock] });
    await act(async () => { await result.current.close(); });
    expect(result.current.phase.kind).toBe('failed');

    await act(async () => { await result.current.retry(); });

    const keys = creates(server.calls).map((call) => call.body.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(server.orders.size).toBe(1);
    expect(result.current.phase.kind).toBe('done');
  });

  it('descartar cancela o pedido a meio caminho, destrava a edição e a próxima tentativa usa chave NOVA', async () => {
    const { result, server } = await readyToClose({}, { invoiceFailures: [noStock] });
    await act(async () => { await result.current.close(); });
    const firstKey = creates(server.calls)[0].body.idempotencyKey;

    await act(async () => { await result.current.discard(); });

    expect(server.calls.some((c) => c.path.endsWith('/transition') && c.body.status === 'cancelado')).toBe(true);
    expect(result.current.phase.kind).toBe('editing');
    expect(result.current.editable).toBe(true);

    await act(async () => { await result.current.close(); });
    const secondKey = creates(server.calls)[1].body.idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
    expect(server.orders.size).toBe(2);
  });

  it('preço do catálogo mudou (STALE_QUOTE): volta a permitir edição com a mesma chave (nada foi criado)', async () => {
    const stale: Extract<ApiResult, { ok: false }> = { ok: false, status: 409, code: 'STALE_QUOTE', error: 'mudou' };
    const { result, server } = await readyToClose({}, { createFailure: stale });

    await act(async () => { await result.current.close(); });
    expect(result.current.phase.kind).toBe('stale');
    expect(result.current.editable).toBe(true);
    expect(server.orders.size).toBe(0);

    act(() => { result.current.setQuantity('p1::', 2); });
    expect(result.current.phase.kind).toBe('editing');
    expect(result.current.lines[0].quantity).toBe(2);
  });

  it('depois de fechar, adicionar um item começa a próxima proposta com chave nova', async () => {
    const { result, server } = await readyToClose();
    await act(async () => { await result.current.close(); });
    expect(result.current.phase.kind).toBe('done');

    act(() => { result.current.addProduct(product({ id: 'p2', name: 'Menção ao vivo', salePrice: 500 })); });
    expect(result.current.phase.kind).toBe('editing');
    expect(result.current.lines.map((line) => line.productId)).toEqual(['p2']);
    expect(result.current.client).toBeNull();

    act(() => { result.current.chooseClient({ id: 'cli_1', name: 'Padaria do Zé' }); });
    await act(async () => { await result.current.close(); });

    const keys = creates(server.calls).map((call) => call.body.idempotencyKey);
    expect(keys[0]).not.toBe(keys[1]);
    expect(server.orders.size).toBe(2);
  });

  it('opções do PDF: validade padrão 7 dias, editáveis, e zeradas numa nova proposta', async () => {
    const { result } = await readyToClose();
    expect(result.current.pdfOptions).toEqual({ validityDays: 7, notes: '' });

    act(() => { result.current.setPdfValidityDays(15); result.current.setPdfNotes('Inclui gravação.'); });
    expect(result.current.pdfOptions).toEqual({ validityDays: 15, notes: 'Inclui gravação.' });

    act(() => { result.current.reset(); });
    expect(result.current.pdfOptions).toEqual({ validityDays: 7, notes: '' });
  });

  it('opções do PDF NÃO travam com a proposta (não afetam o pedido)', async () => {
    const { result } = await readyToClose({}, { invoiceFailures: [noStock] });
    await act(async () => { await result.current.close(); });
    expect(result.current.editable).toBe(false);

    act(() => { result.current.setPdfNotes('ainda dá pra anotar'); });
    expect(result.current.pdfOptions.notes).toBe('ainda dá pra anotar');
  });

  it('o negócio fechado guarda itens e desconto (é o que alimenta o PDF do negócio)', async () => {
    const { result } = await readyToClose();
    act(() => { result.current.choosePromotion('promo1'); });
    await act(async () => { await result.current.close(); });

    expect(result.current.phase.kind).toBe('done');
    if (result.current.phase.kind !== 'done') return;
    expect(result.current.phase.deal).toMatchObject({
      subtotalCents: 150_000,
      discountCents: 15_000,
      discountReason: 'Promoção: Lançamento',
      lines: [{ productId: 'p1', quantity: 1 }],
    });
  });

  it('nova proposta zera tudo', async () => {
    const { result } = await readyToClose();
    await act(async () => { await result.current.close(); });

    act(() => { result.current.reset(); });

    expect(result.current.phase.kind).toBe('editing');
    expect(result.current.lines).toEqual([]);
    expect(result.current.client).toBeNull();
    expect(result.current.installments).toBe(1);
  });
});

describe('useVitrineProposal — catálogo ao vivo', () => {
  it('preço novo no catálogo entra na proposta enquanto ela ainda é editável', () => {
    const { result, rerender } = setup();
    act(() => { result.current.addProduct(product()); });

    rerender({ products: [product({ salePrice: 1800 }), product({ id: 'p2', name: 'Menção ao vivo', salePrice: 500 })] });

    expect(result.current.lines[0].unitPriceCents).toBe(180_000);
  });

  it('item que sai do catálogo sai da proposta', () => {
    const { result, rerender } = setup();
    act(() => { result.current.addProduct(product()); });

    rerender({ products: [product({ id: 'p2', name: 'Menção ao vivo', salePrice: 500 })] });

    expect(result.current.lines).toEqual([]);
  });

  it('enquanto o catálogo não carregou (lista vazia transitória) a proposta NÃO é apagada', () => {
    const { result, rerender } = setup();
    act(() => { result.current.addProduct(product()); });

    rerender({ products: [], catalogReady: false });

    expect(result.current.lines).toHaveLength(1);
  });
});
