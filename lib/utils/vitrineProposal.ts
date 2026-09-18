/**
 * lib/utils/vitrineProposal.ts
 *
 * Aritmética e montagem do corpo do pedido da Vitrine (proposta comercial no
 * tablet). Tudo em CENTAVOS inteiros — nunca compara nem soma reais em ponto
 * flutuante. O servidor continua sendo a fonte da verdade do preço (só recebe
 * a INTENÇÃO de item); `expectedTotalCents` faz o servidor recusar (409
 * STALE_QUOTE) se o catálogo mudou desde que o vendedor negociou o total.
 */

export interface ProposalLine {
  productId: string;
  name: string;
  /** Preço de catálogo no momento em que entrou na proposta (só pra exibição
   *  e pra calcular o total esperado — o servidor re-resolve o preço). */
  unitPriceCents: number;
  quantity: number;
}

export function moneyToCents(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

export function centsToMoney(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * Interpreta o que o vendedor digita no campo de valor negociado (pt-BR):
 * "1.500,50" → 150050, "1500,5" → 150050, "1500.50" → 150050, "1.500" → 150000,
 * "R$ 2.000" → 200000. Devolve `null` se não for um valor monetário válido (≥ 0).
 */
export function parseMoneyToCents(text: string): number | null {
  let value = text.replace(/R\$/gi, '').replace(/\s/g, '');
  if (!value || !/^[\d.,]+$/.test(value)) return null;

  if (value.includes(',')) {
    // Com vírgula: ponto é separador de milhar, vírgula é o decimal.
    value = value.replace(/\./g, '').replace(',', '.');
  } else if (value.includes('.')) {
    const decimals = value.length - value.lastIndexOf('.') - 1;
    // "1.500" (3 dígitos depois do ponto) é milhar em pt-BR; "1500.50" é decimal.
    value = decimals === 3 ? value.replace(/\./g, '') : value;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export function lineTotalCents(line: ProposalLine): number {
  return Math.round(line.unitPriceCents) * Math.max(0, Math.floor(line.quantity));
}

export function subtotalCents(lines: ProposalLine[]): number {
  return lines.reduce((sum, line) => sum + lineTotalCents(line), 0);
}

/** Desconto necessário pra chegar no total negociado, preso em [0, subtotal]
 *  (o servidor também limita ao subtotal). Total negociado acima do subtotal
 *  não vira acréscimo — vira desconto zero. */
export function negotiatedToDiscountCents(subtotal: number, negotiatedTotalCents: number): number {
  return Math.min(Math.max(0, subtotal - negotiatedTotalCents), Math.max(0, subtotal));
}

export function totalAfterDiscountCents(subtotal: number, discountCents: number): number {
  return Math.max(0, subtotal - Math.min(Math.max(0, discountCents), Math.max(0, subtotal)));
}

export interface BuildCreateOrderBodyInput {
  businessId: string;
  lines: ProposalLine[];
  clientId: string;
  clientName: string;
  discountCents: number;
  /** Obrigatório (≥3 chars) quando há desconto. */
  discountReason?: string;
  installments: number;
  /** UUID gerado UMA vez por proposta (nunca por clique) — sem isso, propostas
   *  idênticas pro mesmo cliente deduplicam silenciosamente no servidor. */
  idempotencyKey: string;
}

export interface CreateOrderRequestBody {
  businessId: string;
  type: 'b2b';
  clientId: string;
  clientName: string;
  items: Array<{ productId: string; quantity: number }>;
  discount?: number;
  discountReason?: string;
  installments: number;
  paymentTerms: string;
  idempotencyKey: string;
  expectedTotalCents: number;
}

export function describePaymentTerms(installments: number): string {
  return installments > 1 ? `${installments}x a cada 30 dias` : 'À vista';
}

const DEFAULT_DISCOUNT_REASON = 'Negociação comercial';

export function buildCreateOrderBody(input: BuildCreateOrderBodyInput): CreateOrderRequestBody {
  const subtotal = subtotalCents(input.lines);
  const discountCents = Math.min(Math.max(0, Math.round(input.discountCents)), subtotal);
  const installments = Math.min(48, Math.max(1, Math.floor(input.installments)));

  const reason = input.discountReason?.trim();
  return {
    businessId: input.businessId,
    type: 'b2b',
    clientId: input.clientId,
    clientName: input.clientName,
    items: input.lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
    ...(discountCents > 0
      ? {
          discount: centsToMoney(discountCents),
          discountReason: reason && reason.length >= 3 ? reason.slice(0, 300) : DEFAULT_DISCOUNT_REASON,
        }
      : {}),
    installments,
    paymentTerms: describePaymentTerms(installments),
    idempotencyKey: input.idempotencyKey,
    expectedTotalCents: totalAfterDiscountCents(subtotal, discountCents),
  };
}
