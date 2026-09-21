import { describe, it, expect } from 'vitest';
import {
  addDaysLocal,
  buildLetterhead,
  buildProposalDocument,
  formatAddressLine,
  moneyText,
  type ProposalDocumentInput,
} from '@/lib/pdf/proposalDocument';
import { toPdfText } from '@/lib/pdf/pdfText';
import { computeProposalTotals, type ProposalLine } from '@/lib/utils/vitrineProposal';

const ISSUED = new Date(2026, 8, 21, 14, 30); // 21/09/2026 (fuso local)

const lines: ProposalLine[] = [
  { productId: 'p1', name: 'Pacote Spot 30s', unitPriceCents: 150_000, quantity: 2 },
  { productId: 'p2', variantId: 'v15', name: 'Menção ao vivo', variantName: '15s', unitPriceCents: 50_000, quantity: 1 },
];

function input(overrides: Partial<ProposalDocumentInput> = {}, negotiated: number | null = null, installments = 1): ProposalDocumentInput {
  const totals = computeProposalTotals({ lines, promotion: null, negotiatedTotalCents: negotiated, installments, now: ISSUED });
  return {
    kind: 'proposal',
    business: { name: 'Rádio Nova FM', document: 'CNPJ 12.345.678/0001-90', phone: '(11) 3333-4444', email: 'comercial@nova.fm', address: 'Rua das Ondas, 100 - Centro - São Paulo/SP' },
    client: { name: 'Padaria do Zé', company: 'Zé Alimentos', phone: '(11) 98765-4321', email: 'ze@padaria.com.br' },
    lines,
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    discountReason: totals.discountReason,
    totalCents: totals.totalCents,
    installments,
    schedule: totals.schedule,
    issuedAt: ISSUED,
    validityDays: 7,
    ...overrides,
  };
}

describe('buildProposalDocument — proposta', () => {
  it('título, referência com emissão e validade, e nome do arquivo', () => {
    const model = buildProposalDocument(input());
    expect(model.title).toBe('Proposta comercial');
    expect(model.reference).toEqual(['Emitida em 21/09/2026', 'Válida até 28/09/2026']);
    expect(model.fileName).toBe('proposta-padaria-do-ze-20260921.pdf');
  });

  it('itens com quantidade, valor unitário e total em reais; opção entra na descrição', () => {
    const model = buildProposalDocument(input());
    expect(model.items).toEqual([
      { description: 'Pacote Spot 30s', quantity: '2', unitPrice: 'R$ 1.500,00', total: 'R$ 3.000,00' },
      { description: 'Menção ao vivo — 15s', quantity: '1', unitPrice: 'R$ 500,00', total: 'R$ 500,00' },
    ]);
  });

  it('sem desconto: só a linha de Total', () => {
    expect(buildProposalDocument(input()).summary).toEqual([{ label: 'Total', value: 'R$ 3.500,00', emphasis: true }]);
  });

  it('com desconto negociado: subtotal, desconto e total', () => {
    const model = buildProposalDocument(input({}, 3_000_00));
    expect(model.summary).toEqual([
      { label: 'Subtotal', value: 'R$ 3.500,00' },
      { label: 'Desconto', value: '- R$ 500,00' },
      { label: 'Total', value: 'R$ 3.000,00', emphasis: true },
    ]);
  });

  it('desconto por promoção leva o motivo', () => {
    const model = buildProposalDocument(input({ discountCents: 35_000, discountReason: 'Promoção: Lançamento', totalCents: 315_000 }));
    expect(model.summary[1]).toEqual({ label: 'Desconto (Promoção: Lançamento)', value: '- R$ 350,00' });
  });

  it('à vista: uma linha "À vista" no fechamento', () => {
    const { payment } = buildProposalDocument(input());
    expect(payment.description).toBe('À vista');
    expect(payment.head).toEqual(['Pagamento', 'Vencimento', 'Valor']);
    expect(payment.rows).toEqual([['À vista', 'No fechamento', 'R$ 3.500,00']]);
  });

  it('parcelado (proposta): vencimentos RELATIVOS ao fechamento, soma das parcelas = total', () => {
    const { payment } = buildProposalDocument(input({}, null, 3));
    expect(payment.description).toBe('3x a cada 30 dias');
    expect(payment.head[0]).toBe('Parcela');
    expect(payment.rows.map((row) => row[0])).toEqual(['1/3', '2/3', '3/3']);
    expect(payment.rows.map((row) => row[1])).toEqual(['No fechamento', '30 dias após o fechamento', '60 dias após o fechamento']);
  });

  it('cliente: empresa e contato em linhas; sem dados extras, sem linhas', () => {
    expect(buildProposalDocument(input()).client).toEqual({
      name: 'Padaria do Zé',
      lines: ['Zé Alimentos', '(11) 98765-4321 · ze@padaria.com.br'],
    });
    expect(buildProposalDocument(input({ client: { name: 'Só o nome' } })).client.lines).toEqual([]);
  });

  it('timbre: CNPJ, endereço e contato; campos ausentes somem', () => {
    expect(buildProposalDocument(input()).business).toEqual({
      name: 'Rádio Nova FM',
      lines: ['CNPJ 12.345.678/0001-90', 'Rua das Ondas, 100 - Centro - São Paulo/SP', '(11) 3333-4444 · comercial@nova.fm'],
    });
    expect(buildProposalDocument(input({ business: { name: 'Só o nome' } })).business.lines).toEqual([]);
  });

  it('observações: aparadas e limitadas; vazias não geram bloco', () => {
    expect(buildProposalDocument(input({ notes: '  Inclui gravação do spot.  ' })).notes).toBe('Inclui gravação do spot.');
    expect(buildProposalDocument(input({ notes: 'x'.repeat(900) })).notes).toHaveLength(600);
    expect('notes' in buildProposalDocument(input({ notes: '   ' }))).toBe(false);
  });

  it('sem validade informada não imprime "Válida até"', () => {
    expect(buildProposalDocument(input({ validityDays: undefined })).reference).toEqual(['Emitida em 21/09/2026']);
    expect(buildProposalDocument(input({ validityDays: 0 })).reference).toEqual(['Emitida em 21/09/2026']);
  });

  it('nome de cliente com acento e símbolos vira um nome de arquivo seguro', () => {
    expect(buildProposalDocument(input({ client: { name: '  Ótica São João & Filhos!! ' } })).fileName)
      .toBe('proposta-otica-sao-joao-filhos-20260921.pdf');
    expect(buildProposalDocument(input({ client: { name: '🎉🎉' } })).fileName).toBe('proposta-cliente-20260921.pdf');
  });
});

describe('buildProposalDocument — negócio fechado', () => {
  it('título, número do pedido e datas REAIS das parcelas', () => {
    const totals = computeProposalTotals({ lines, promotion: null, negotiatedTotalCents: null, installments: 3, now: ISSUED });
    const model = buildProposalDocument(input({
      kind: 'deal', orderNumber: 'ABC123', schedule: totals.schedule, validityDays: undefined,
    }, null, 3));

    expect(model.title).toBe('Confirmação de negócio');
    expect(model.reference).toEqual(['Pedido #ABC123', 'Fechado em 21/09/2026']);
    expect(model.payment.rows.map((row) => row[1])).toEqual(['21/09/2026', '21/10/2026', '20/11/2026']);
    expect(model.fileName).toBe('negocio-padaria-do-ze-20260921.pdf');
    expect(model.footer).not.toContain('Valores em reais');
  });
});

describe('helpers', () => {
  it('moneyText usa espaço comum (a fonte padrão do PDF não tem espaço não quebrável)', () => {
    expect(moneyText(123_456)).toBe('R$ 1.234,56');
    expect(moneyText(123_456)).not.toContain(' ');
  });

  it('addDaysLocal soma dias no calendário local, atravessando mês e ano', () => {
    expect(addDaysLocal(new Date(2026, 8, 21), 7)).toBe('2026-09-28');
    expect(addDaysLocal(new Date(2026, 11, 28), 7)).toBe('2027-01-04');
    expect(addDaysLocal(new Date(2026, 8, 21, 23, 59), 30)).toBe('2026-10-21');
  });

  it('formatAddressLine monta com o que existir', () => {
    expect(formatAddressLine({ logradouro: 'Rua A', numero: '10', bairro: 'Centro', municipio: 'Recife', uf: 'PE' })).toBe('Rua A, 10 - Centro - Recife/PE');
    expect(formatAddressLine({ municipio: 'Recife' })).toBe('Recife');
    expect(formatAddressLine(undefined)).toBe('');
  });

  it('buildLetterhead: nome fantasia, senão razão social; CNPJ só se tiver 14 dígitos', () => {
    expect(buildLetterhead({ nomeFantasia: ' Nova FM ', razaoSocial: 'Nova Radiodifusão LTDA', cnpj: '12345678000190' }))
      .toMatchObject({ name: 'Nova FM', document: 'CNPJ 12.345.678/0001-90' });
    expect(buildLetterhead({ razaoSocial: 'Nova Radiodifusão LTDA', cnpj: '123' })).toEqual({ name: 'Nova Radiodifusão LTDA' });
    expect(buildLetterhead({})).toEqual({ name: 'Empresa' });
  });
});

describe('toPdfText', () => {
  it('mantém acentos do português', () => {
    expect(toPdfText('Ação promoção: Menção — coração ÀÉÎÕÜ')).toBe('Ação promoção: Menção - coração ÀÉÎÕÜ');
  });

  it('troca pontuação tipográfica por ASCII e o espaço não quebrável por espaço', () => {
    expect(toPdfText('“Olá” ‘x’ – … •')).toBe('"Olá" \'x\' - ... *');
    expect(toPdfText('R$ 1.500,00')).toBe('R$ 1.500,00');
  });

  it('descarta emoji e caracteres fora do Latin-1, sem quebrar o resto', () => {
    expect(toPdfText('Spot 🎙️ premium 日本')).toBe('Spot premium');
  });

  it('preserva quebras de linha', () => {
    expect(toPdfText('linha 1\nlinha 2')).toBe('linha 1\nlinha 2');
  });
});
