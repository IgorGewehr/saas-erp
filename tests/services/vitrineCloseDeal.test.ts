import { describe, it, expect } from 'vitest';
import { closeDeal, cancelDeal, settleReceivable, type CloseDealStep } from '@/lib/services/vitrine/closeDeal';
import { createApiRequest, type ApiRequest, type ApiResult } from '@/lib/services/vitrine/apiClient';
import { buildCreateOrderBody } from '@/lib/utils/vitrineProposal';

const body = buildCreateOrderBody({
  businessId: 'biz_1',
  lines: [{ productId: 'p1', name: 'Pacote Spot', unitPriceCents: 150_000, quantity: 2 }],
  clientId: 'cli_1',
  clientName: 'Padaria do Zé',
  discountCents: 30_000,
  discountReason: 'Promoção: Lançamento',
  installments: 3,
  idempotencyKey: '5b3c0c9e-0000-4000-8000-000000000001',
});

interface Call { path: string; method: string; body: unknown }

/** Servidor de mentira com o mesmo contrato das rotas: criação idempotente + FSM de status. */
function makeFakeServer(options: {
  initialStatus?: 'pendente' | 'confirmado' | 'faturado' | 'cancelado';
  createFailure?: Extract<ApiResult, { ok: false }>;
  /** Falhas sucessivas do faturamento (uma por chamada) antes de passar a funcionar. */
  invoiceFailures?: Array<Extract<ApiResult, { ok: false }>>;
  confirmFailure?: Extract<ApiResult, { ok: false }>;
  createResponse?: unknown;
} = {}) {
  const calls: Call[] = [];
  let order: { id: string; status: string; total: number; transactionIds?: string[] } | null = null;
  const invoiceFailures = [...(options.invoiceFailures ?? [])];

  const request: ApiRequest = async (path, init) => {
    calls.push({ path, method: init.method, body: init.body });

    if (path === '/api/b2b-orders') {
      if (options.createFailure) return options.createFailure;
      if (options.createResponse !== undefined) return { ok: true, data: options.createResponse };
      order ??= {
        id: 'order_abc',
        status: options.initialStatus ?? 'pendente',
        total: 2700,
        ...(options.initialStatus === 'faturado' ? { transactionIds: ['tx1', 'tx2', 'tx3'] } : {}),
      };
      return { ok: true, data: { ...order } };
    }

    const status = (init.body as { status: string }).status;
    if (!order) return { ok: false, status: 404, error: 'Pedido não encontrado.' };

    if (status === 'confirmado') {
      if (options.confirmFailure) return options.confirmFailure;
      order.status = 'confirmado';
      return { ok: true, data: { status: 'confirmado', transactionIds: [], stockAlerts: [] } };
    }
    if (status === 'faturado') {
      const failure = invoiceFailures.shift();
      if (failure) return failure;
      order.status = 'faturado';
      order.transactionIds = ['tx1', 'tx2', 'tx3'];
      return {
        ok: true,
        data: {
          status: 'faturado',
          transactionIds: ['tx1', 'tx2', 'tx3'],
          stockAlerts: [{ severity: 'low', productName: 'Camiseta', newStock: 1, minStock: 2 }],
        },
      };
    }
    if (status === 'cancelado') {
      order.status = 'cancelado';
      return { ok: true, data: { status: 'cancelado' } };
    }
    return { ok: false, status: 400, error: 'status inválido' };
  };

  return { request, calls, getOrder: () => order };
}

const noStock: Extract<ApiResult, { ok: false }> = {
  ok: false, status: 409, code: 'INSUFFICIENT_STOCK', error: 'Estoque insuficiente: Camiseta (disponível: 0, solicitado: 2)',
};

describe('closeDeal — caminho feliz', () => {
  it('cria, confirma e fatura, na ordem, e devolve os recebíveis', async () => {
    const server = makeFakeServer();
    const steps: CloseDealStep[] = [];

    const result = await closeDeal({ businessId: 'biz_1', body, request: server.request, onStep: (s) => steps.push(s) });

    expect(steps).toEqual(['create', 'confirm', 'invoice']);
    expect(result).toMatchObject({ status: 'done', orderId: 'order_abc', total: 2700, transactionIds: ['tx1', 'tx2', 'tx3'] });
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/b2b-orders',
      'PATCH /api/b2b-orders/order_abc/transition',
      'PATCH /api/b2b-orders/order_abc/transition',
    ]);
  });

  it('manda o corpo da proposta como está (idempotencyKey e total esperado inclusos) e o negócio nas transições', async () => {
    const server = makeFakeServer();
    await closeDeal({ businessId: 'biz_1', body, request: server.request });

    expect(server.calls[0].body).toBe(body);
    expect(server.calls[1].body).toEqual({ businessId: 'biz_1', status: 'confirmado' });
    expect(server.calls[2].body).toEqual({ businessId: 'biz_1', status: 'faturado' });
  });

  it('repassa os alertas de estoque do faturamento', async () => {
    const server = makeFakeServer();
    const result = await closeDeal({ businessId: 'biz_1', body, request: server.request });
    expect(result.status === 'done' && result.stockAlerts).toHaveLength(1);
  });
});

describe('closeDeal — retomada por status (pedido já existe)', () => {
  it('replay com o pedido já faturado: não chama transição nenhuma', async () => {
    const server = makeFakeServer({ initialStatus: 'faturado' });
    const result = await closeDeal({ businessId: 'biz_1', body, request: server.request });

    expect(result).toMatchObject({ status: 'done', transactionIds: ['tx1', 'tx2', 'tx3'] });
    expect(server.calls).toHaveLength(1);
  });

  it('replay com o pedido confirmado: pula a confirmação e só fatura', async () => {
    const server = makeFakeServer({ initialStatus: 'confirmado' });
    const steps: CloseDealStep[] = [];
    const result = await closeDeal({ businessId: 'biz_1', body, request: server.request, onStep: (s) => steps.push(s) });

    expect(steps).toEqual(['create', 'invoice']);
    expect(result.status).toBe('done');
  });

  it('falta de saldo no faturamento: erro RETENTÁVEL com o pedido; a 2ª tentativa retoma e fatura sem recriar', async () => {
    const server = makeFakeServer({ invoiceFailures: [noStock] });

    const first = await closeDeal({ businessId: 'biz_1', body, request: server.request });
    expect(first).toMatchObject({ status: 'error', retryable: true, orderId: 'order_abc' });
    expect((first as { message: string }).message).toContain('Estoque insuficiente');
    expect(server.getOrder()?.status).toBe('confirmado');

    const steps: CloseDealStep[] = [];
    const second = await closeDeal({ businessId: 'biz_1', body, request: server.request, onStep: (s) => steps.push(s) });
    expect(second).toMatchObject({ status: 'done', orderId: 'order_abc' });
    expect(steps).toEqual(['create', 'invoice']);
    // uma única criação de pedido no servidor, mesmo com duas tentativas
    expect(server.getOrder()?.id).toBe('order_abc');
  });

  it('a mesma chave é reenviada na retomada (é ela que impede pedido duplicado)', async () => {
    const server = makeFakeServer({ invoiceFailures: [noStock] });
    await closeDeal({ businessId: 'biz_1', body, request: server.request });
    await closeDeal({ businessId: 'biz_1', body, request: server.request });

    const creates = server.calls.filter((c) => c.path === '/api/b2b-orders');
    expect(creates).toHaveLength(2);
    expect(creates.every((c) => (c.body as { idempotencyKey: string }).idempotencyKey === body.idempotencyKey)).toBe(true);
  });

  it('pedido cancelado no replay: erro definitivo (proposta nova)', async () => {
    const server = makeFakeServer({ initialStatus: 'cancelado' });
    const result = await closeDeal({ businessId: 'biz_1', body, request: server.request });
    expect(result).toMatchObject({ status: 'error', retryable: false, orderId: 'order_abc' });
    expect(server.calls).toHaveLength(1);
  });
});

describe('closeDeal — falhas', () => {
  it('STALE_QUOTE na criação: "stale", nada mais é chamado', async () => {
    const server = makeFakeServer({
      createFailure: { ok: false, status: 409, code: 'STALE_QUOTE', error: 'O total foi atualizado de 270000 para 300000 centavos.' },
    });
    const result = await closeDeal({ businessId: 'biz_1', body, request: server.request });

    expect(result.status).toBe('stale');
    expect(server.calls).toHaveLength(1);
  });

  it('desconto sem permissão (403): erro definitivo, sem pedido', async () => {
    const server = makeFakeServer({
      createFailure: { ok: false, status: 403, code: 'DISCOUNT_FORBIDDEN', error: 'Seu perfil não permite aplicar desconto manual.' },
    });
    const result = await closeDeal({ businessId: 'biz_1', body, request: server.request });
    expect(result).toEqual({ status: 'error', message: 'Seu perfil não permite aplicar desconto manual.', retryable: false });
  });

  it('sem conexão na criação (status 0): retentável e sem pedido', async () => {
    const server = makeFakeServer({ createFailure: { ok: false, status: 0, error: 'Sem conexão' } });
    const result = await closeDeal({ businessId: 'biz_1', body, request: server.request });
    expect(result).toMatchObject({ status: 'error', retryable: true });
    expect((result as { orderId?: string }).orderId).toBeUndefined();
  });

  it('queda de rede ao confirmar: retentável e já informa o pedido criado', async () => {
    const server = makeFakeServer({ confirmFailure: { ok: false, status: 0, error: 'Sem conexão' } });
    const result = await closeDeal({ businessId: 'biz_1', body, request: server.request });
    expect(result).toMatchObject({ status: 'error', retryable: true, orderId: 'order_abc' });
  });

  it('erro 500 do servidor é retentável; 400 não é', async () => {
    const serverError = makeFakeServer({ createFailure: { ok: false, status: 500, error: 'Falhou' } });
    expect(await closeDeal({ businessId: 'biz_1', body, request: serverError.request })).toMatchObject({ retryable: true });

    const badRequest = makeFakeServer({ createFailure: { ok: false, status: 400, error: 'Dados inválidos' } });
    expect(await closeDeal({ businessId: 'biz_1', body, request: badRequest.request })).toMatchObject({ retryable: false });
  });

  it('resposta de criação fora do formato: erro definitivo (não segue adiante com id desconhecido)', async () => {
    const server = makeFakeServer({ createResponse: { qualquer: 'coisa' } });
    const result = await closeDeal({ businessId: 'biz_1', body, request: server.request });
    expect(result).toMatchObject({ status: 'error', retryable: false });
    expect(server.calls).toHaveLength(1);
  });
});

describe('cancelDeal', () => {
  it('cancela o pedido que ficou a meio caminho', async () => {
    const server = makeFakeServer({ invoiceFailures: [noStock] });
    await closeDeal({ businessId: 'biz_1', body, request: server.request });

    const result = await cancelDeal({ businessId: 'biz_1', orderId: 'order_abc', request: server.request });
    expect(result).toEqual({ ok: true });
    expect(server.getOrder()?.status).toBe('cancelado');
  });

  it('devolve a mensagem do servidor quando não consegue', async () => {
    const request: ApiRequest = async () => ({ ok: false, status: 409, error: 'Transição inválida: faturado → cancelado.' });
    expect(await cancelDeal({ businessId: 'biz_1', orderId: 'x', request })).toEqual({
      ok: false, message: 'Transição inválida: faturado → cancelado.',
    });
  });
});

describe('settleReceivable', () => {
  const params = { businessId: 'biz_1', transactionId: 'tx1', paymentMethod: 'pix' as const, paymentDate: '2026-09-18' };

  it('chama a rota de recebimento com forma e data locais', async () => {
    let seen: Call | undefined;
    const request: ApiRequest = async (path, init) => {
      seen = { path, method: init.method, body: init.body };
      return { ok: true, data: { id: 'tx1', status: 'pago', alreadySettled: false } };
    };
    const result = await settleReceivable({ ...params, request });

    expect(result).toEqual({ ok: true, alreadySettled: false });
    expect(seen).toEqual({
      path: '/api/transactions/tx1/settle',
      method: 'POST',
      body: { businessId: 'biz_1', paymentMethod: 'pix', paymentDate: '2026-09-18' },
    });
  });

  it('já recebida vira ok com alreadySettled (duplo toque não é erro)', async () => {
    const request: ApiRequest = async () => ({ ok: true, data: { alreadySettled: true } });
    expect(await settleReceivable({ ...params, request })).toEqual({ ok: true, alreadySettled: true });
  });

  it('erro do servidor vira mensagem', async () => {
    const request: ApiRequest = async () => ({ ok: false, status: 403, error: 'Sem permissão para registrar recebimentos.' });
    expect(await settleReceivable({ ...params, request })).toEqual({ ok: false, message: 'Sem permissão para registrar recebimentos.' });
  });
});

describe('createApiRequest', () => {
  function fakeFetch(response: { status: number; json: unknown } | 'throw') {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const impl = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      if (response === 'throw') throw new TypeError('Failed to fetch');
      return { ok: response.status >= 200 && response.status < 300, status: response.status, json: async () => response.json };
    }) as unknown as typeof fetch;
    return { impl, seen };
  }

  it('manda Authorization Bearer e corpo JSON, e devolve data quando ok', async () => {
    const { impl, seen } = fakeFetch({ status: 200, json: { ok: true, data: { id: 'o1' } } });
    const request = createApiRequest(async () => 'tok123', impl);

    const result = await request('/api/b2b-orders', { method: 'POST', body: { a: 1 } });

    expect(result).toEqual({ ok: true, data: { id: 'o1' } });
    expect(seen[0].url).toBe('/api/b2b-orders');
    expect(seen[0].init.method).toBe('POST');
    expect((seen[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok123');
    expect(seen[0].init.body).toBe('{"a":1}');
  });

  it('resposta de erro preserva status, mensagem e code', async () => {
    const { impl } = fakeFetch({ status: 409, json: { ok: false, error: 'O total foi atualizado', code: 'STALE_QUOTE' } });
    const result = await createApiRequest(async () => 't', impl)('/x', { method: 'POST', body: {} });
    expect(result).toEqual({ ok: false, status: 409, error: 'O total foi atualizado', code: 'STALE_QUOTE' });
  });

  it('corpo de erro que não é JSON cai numa mensagem genérica', async () => {
    const impl = (async () => ({ ok: false, status: 502, json: async () => { throw new Error('html'); } })) as unknown as typeof fetch;
    const result = await createApiRequest(async () => 't', impl)('/x', { method: 'POST', body: {} });
    expect(result).toMatchObject({ ok: false, status: 502, error: 'Erro na requisição.' });
  });

  it('fetch que lança (offline) vira status 0', async () => {
    const { impl } = fakeFetch('throw');
    const result = await createApiRequest(async () => 't', impl)('/x', { method: 'POST', body: {} });
    expect(result).toMatchObject({ ok: false, status: 0 });
  });

  it('token indisponível vira 401 sem nem chamar a rede', async () => {
    const { impl, seen } = fakeFetch({ status: 200, json: { ok: true, data: null } });
    const request = createApiRequest(async () => { throw new Error('auth/expired'); }, impl);
    const result = await request('/x', { method: 'POST', body: {} });
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(seen).toHaveLength(0);
  });
});
