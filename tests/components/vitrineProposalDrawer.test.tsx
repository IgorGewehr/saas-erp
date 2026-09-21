import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// A gaveta importa o seletor de cliente e a tela "negócio fechado", que assinam o Firestore só em efeito
// (não roda em renderToStaticMarkup) — os mocks só evitam inicializar o SDK real no import.
vi.mock('@/lib/config/firebase', () => ({ db: {}, auth: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), query: vi.fn(), where: vi.fn(), onSnapshot: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), updateDoc: vi.fn(),
}));
vi.mock('react-toastify', () => ({ toast: { warning: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

import { ProposalDrawer } from '@/app/components/features/vitrine/ProposalDrawer';
import type { ClosedDeal, DealPhase, VitrineProposal } from '@/app/components/features/vitrine/useVitrineProposal';
import { computeProposalTotals, type ProposalLine } from '@/lib/utils/vitrineProposal';
import type { BusinessPromotion } from '@/lib/types';

const NOW = new Date('2026-09-18T12:00:00.000Z');

const promo: BusinessPromotion = { id: 'promo1', name: 'Lançamento', type: 'percentage', value: 10, isActive: true };

const line: ProposalLine = { productId: 'p1', name: 'Pacote Spot 30s', unitPriceCents: 150_000, quantity: 2 };

function makeProposal(overrides: Partial<VitrineProposal> = {}, options: { lines?: ProposalLine[]; installments?: number } = {}): VitrineProposal {
  const lines = options.lines ?? [line];
  const installments = options.installments ?? 1;
  const noop = () => undefined;
  const asyncNoop = async () => undefined;
  return {
    lines,
    client: { id: 'cli_1', name: 'Padaria do Zé' },
    promotionId: null,
    negotiatedText: '',
    negotiatedInvalid: false,
    installments,
    phase: { kind: 'editing' } as DealPhase,
    totals: computeProposalTotals({ lines, promotion: null, negotiatedTotalCents: null, installments, now: NOW }),
    shortfalls: [],
    blockers: [],
    canClose: true,
    editable: true,
    itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
    addProduct: () => ({ ok: true }),
    setQuantity: noop,
    removeItem: noop,
    chooseClient: noop,
    choosePromotion: noop,
    setNegotiatedText: noop,
    chooseInstallments: noop,
    close: asyncNoop,
    retry: asyncNoop,
    discard: asyncNoop,
    reset: noop,
    totalMoney: 3000,
    ...overrides,
  } as VitrineProposal;
}

function render(proposal: VitrineProposal, props: { canNegotiate?: boolean; canSeeReceivables?: boolean; promotions?: BusinessPromotion[] } = {}) {
  return renderToStaticMarkup(
    <ProposalDrawer
      proposal={proposal}
      businessId="biz_1"
      activePromotions={props.promotions ?? [promo]}
      canNegotiate={props.canNegotiate ?? true}
      canSeeReceivables={props.canSeeReceivables ?? true}
      request={async () => ({ ok: true, data: null })}
      onClose={() => undefined}
      onNavigate={() => undefined}
    />,
  );
}

/** O <button> que contém o texto (sem atravessar outros botões). */
function buttonWith(html: string, text: string): string | undefined {
  return [...html.matchAll(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<\/button>/g)].map((m) => m[0]).find((b) => b.includes(text));
}

describe('ProposalDrawer — edição', () => {
  it('mostra cliente, itens, quantidade, total e o cronograma de pagamento', () => {
    const html = render(makeProposal());
    expect(html).toContain('Padaria do Zé');
    expect(html).toContain('Pacote Spot 30s');
    expect(html).toMatch(/R\$\s?3\.000,00/);
    expect(html).toContain('Pagamento');
    expect(html).toContain('18/09/2026');
  });

  it('parcelado: lista cada parcela com vencimento', () => {
    const html = render(makeProposal({}, { installments: 3 }));
    expect(html).toContain('Parcela 1');
    expect(html).toContain('Parcela 3');
    expect(html).toContain('17/11/2026');
  });

  it('gerente vê negociação e promoções; operador não', () => {
    const manager = render(makeProposal(), { canNegotiate: true });
    expect(manager).toContain('Valor negociado (total)');
    expect(manager).toContain('Lançamento');

    const operator = render(makeProposal(), { canNegotiate: false });
    expect(operator).not.toContain('Valor negociado');
    expect(operator).not.toContain('Lançamento');
  });

  it('desconto aparece no rodapé com o motivo, e o total já vem descontado', () => {
    const lines = [line];
    const totals = computeProposalTotals({ lines, promotion: promo, negotiatedTotalCents: null, installments: 1, now: NOW });
    const html = render(makeProposal({ totals, promotionId: 'promo1' }));
    expect(html).toContain('Desconto (Promoção: Lançamento)');
    expect(html).toMatch(/R\$\s?2\.700,00/);
  });

  it('botão "Fechar negócio" fica desabilitado quando há bloqueio, e o motivo é mostrado', () => {
    const html = render(makeProposal({ canClose: false, blockers: ['Escolha o cliente.'] }));
    expect(buttonWith(html, 'Fechar negócio')).toContain('disabled');
    expect(html).toContain('Escolha o cliente.');
  });

  it('botão habilitado quando pode fechar', () => {
    expect(buttonWith(render(makeProposal()), 'Fechar negócio')).not.toContain('disabled=""');
  });

  it('proposta vazia orienta o vendedor', () => {
    const html = render(makeProposal({ canClose: false, blockers: [], totals: computeProposalTotals({ lines: [], promotion: null, negotiatedTotalCents: null, installments: 1, now: NOW }) }, { lines: [] }));
    expect(html).toContain('Adicionar à proposta');
    expect(html).not.toContain('Negociação');
  });
});

describe('ProposalDrawer — fechamento', () => {
  it('em andamento: mostra a etapa e trava o botão', () => {
    const html = render(makeProposal({ phase: { kind: 'closing', step: 'invoice' }, editable: false, canClose: false }));
    expect(html).toContain('Faturando e gerando as parcelas');
    expect(buttonWith(html, 'Faturando')).toContain('disabled');
  });

  it('preço mudou (stale): explica e mantém a edição', () => {
    const html = render(makeProposal({ phase: { kind: 'stale', message: 'O valor do catálogo mudou.' } }));
    expect(html).toContain('O valor do catálogo mudou.');
    expect(html).toContain('preços já foram atualizados');
  });

  it('falhou COM pedido: mensagem do servidor, tentar de novo, descartar e link pra Vendas', () => {
    const html = render(makeProposal({
      phase: { kind: 'failed', message: 'Estoque insuficiente: Camiseta (disponível: 0, solicitado: 2)', orderId: 'order_abc', retryable: true },
      editable: false,
      canClose: false,
    }));
    expect(html).toContain('Estoque insuficiente: Camiseta');
    expect(html).toContain('O pedido já foi criado');
    expect(html).toContain('Tentar de novo');
    expect(html).toContain('Descartar e editar');
    expect(html).toContain('Ver em Vendas');
  });

  it('falhou sem retentativa possível: só descartar (sem "Tentar de novo")', () => {
    const html = render(makeProposal({
      phase: { kind: 'failed', message: 'Seu perfil não permite aplicar desconto manual.', retryable: false },
      editable: false,
      canClose: false,
    }));
    expect(html).not.toContain('Tentar de novo');
    expect(html).toContain('Descartar e editar');
    expect(html).not.toContain('Ver em Vendas');
  });

  it('itens ficam travados (controles desabilitados) enquanto a proposta não é editável', () => {
    const html = render(makeProposal({ editable: false, phase: { kind: 'closing', step: 'create' }, canClose: false }));
    expect(buttonWith(html, 'aria-label="Aumentar quantidade"') ?? '').toContain('disabled');
  });
});

describe('ProposalDrawer — negócio fechado', () => {
  const deal: ClosedDeal = {
    orderId: 'order_0123456789abcdef',
    client: { id: 'cli_1', name: 'Padaria do Zé' },
    totalCents: 270_000,
    installments: 3,
    transactionIds: ['tx1', 'tx2', 'tx3'],
    schedule: computeProposalTotals({ lines: [line], promotion: null, negotiatedTotalCents: 270_000, installments: 3, now: NOW }).schedule,
  };

  it('mostra o resumo do negócio e o número curto do pedido', () => {
    const html = render(makeProposal({ phase: { kind: 'done', deal } }));
    expect(html).toContain('Negócio fechado!');
    expect(html).toContain('Padaria do Zé');
    expect(html).toMatch(/R\$\s?2\.700,00/);
    expect(html).toContain('em 3 parcelas');
    expect(html).toContain('#ABCDEF');
    expect(html).toContain('Nova proposta');
  });

  it('operador vê o cronograma planejado e o aviso de que gerente registra o recebimento', () => {
    const html = render(makeProposal({ phase: { kind: 'done', deal } }), { canSeeReceivables: false });
    expect(html).toContain('Parcela 1');
    expect(html).toContain('feito por um gerente');
    expect(html).not.toContain('Financeiro');
  });

  it('gerente tem o atalho pro Financeiro', () => {
    const html = render(makeProposal({ phase: { kind: 'done', deal } }), { canSeeReceivables: true });
    expect(html).toContain('Financeiro');
    expect(html).toContain('Clientes');
    expect(html).toContain('Vendas');
  });
});
