/**
 * lib/utils/vitrineProposal.ts
 *
 * Aritmética e montagem do corpo do pedido da Vitrine (proposta comercial no
 * tablet). Tudo em CENTAVOS inteiros — nunca compara nem soma reais em ponto
 * flutuante. O servidor continua sendo a fonte da verdade do preço (só recebe
 * a INTENÇÃO de item); `expectedTotalCents` faz o servidor recusar (409
 * STALE_QUOTE) se o catálogo mudou desde que o vendedor negociou o total.
 */

import type { BusinessPromotion, Product, ProductVariant } from '@/lib/types';
import { applyPromotion } from '@/lib/utils/promotions';
import { buildInstallmentSchedule, type InstallmentScheduleEntry } from '@/lib/utils/installments';
import { getActiveVariants } from '@/lib/utils/vitrineCatalog';

export interface ProposalLine {
  productId: string;
  /** Presente quando o produto tem opções (variações) — o servidor exige. */
  variantId?: string;
  name: string;
  variantName?: string;
  /** Preço de catálogo no momento em que entrou na proposta (só pra exibição
   *  e pra calcular o total esperado — o servidor re-resolve o preço). */
  unitPriceCents: number;
  quantity: number;
}

export const MAX_LINE_QUANTITY = 999;

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

// ── Linhas da proposta ───────────────────────────────────────────────────────

/** Identidade da linha: mesmo produto com opções diferentes são linhas diferentes. */
export function lineKey(line: Pick<ProposalLine, 'productId' | 'variantId'>): string {
  return `${line.productId}::${line.variantId ?? ''}`;
}

function clampQuantity(quantity: number): number {
  return Math.min(MAX_LINE_QUANTITY, Math.max(0, Math.floor(quantity)));
}

/** Adiciona a linha; se o mesmo item já está na proposta, soma a quantidade. */
export function addLine(lines: ProposalLine[], incoming: ProposalLine): ProposalLine[] {
  const key = lineKey(incoming);
  const quantity = clampQuantity(incoming.quantity);
  if (quantity <= 0) return lines;

  const existing = lines.find((line) => lineKey(line) === key);
  if (!existing) return [...lines, { ...incoming, quantity }];
  return lines.map((line) => (line === existing ? { ...line, quantity: clampQuantity(line.quantity + quantity) } : line));
}

/** Quantidade ≤ 0 remove a linha. */
export function setLineQuantity(lines: ProposalLine[], key: string, quantity: number): ProposalLine[] {
  const next = clampQuantity(quantity);
  if (next <= 0) return lines.filter((line) => lineKey(line) !== key);
  return lines.map((line) => (lineKey(line) === key ? { ...line, quantity: next } : line));
}

export function removeLine(lines: ProposalLine[], key: string): ProposalLine[] {
  return lines.filter((line) => lineKey(line) !== key);
}

export type AddToProposalCheck = { ok: true } | { ok: false; reason: string };

/** O que impede um item de entrar na proposta — a Vitrine não monta personalização. */
export function checkProductForProposal(product: Product, variant?: ProductVariant): AddToProposalCheck {
  if (product.modifierGroups?.some((group) => group.required)) {
    return { ok: false, reason: 'Este item exige personalização — feche pelo módulo Vendas ou PDV.' };
  }

  // Mesma regra do servidor (commercial-quote): qualquer variação cadastrada obriga a escolher uma.
  const hasVariants = product.kind === 'variant' || (product.variants?.length ?? 0) > 0;
  if (hasVariants) {
    if (!variant) return { ok: false, reason: 'Escolha uma opção.' };
    if (!getActiveVariants(product).some((candidate) => candidate.id === variant.id)) {
      return { ok: false, reason: 'Esta opção não está disponível.' };
    }
    if (!(variant.salePrice > 0)) return { ok: false, reason: 'Opção sem preço cadastrado.' };
    return { ok: true };
  }

  if (!(product.salePrice > 0)) return { ok: false, reason: 'Item sem preço cadastrado.' };
  return { ok: true };
}

export function toProposalLine(product: Product, variant?: ProductVariant, quantity = 1): ProposalLine {
  return {
    productId: product.id,
    ...(variant ? { variantId: variant.id, variantName: variant.name } : {}),
    name: product.name,
    unitPriceCents: moneyToCents(variant ? variant.salePrice : product.salePrice),
    quantity,
  };
}

export interface CatalogSyncResult {
  /** Mesma referência de `lines` quando nada mudou (evita re-render em loop). */
  lines: ProposalLine[];
  /** Itens que saíram do catálogo (inativos, arquivados, sem preço) e foram tirados da proposta. */
  removed: string[];
  /** Itens cujo preço de catálogo mudou desde que entraram na proposta. */
  repriced: string[];
}

/**
 * Mantém a proposta fiel ao catálogo em tempo real: preço novo entra na hora (o total mostrado
 * é o que o servidor vai cotar) e item que deixou de existir sai, em vez de estourar só no
 * fechamento. Recebe a lista já filtrada por `isCatalogProduct`.
 */
export function syncLinesWithCatalog(lines: ProposalLine[], products: Product[]): CatalogSyncResult {
  const byId = new Map(products.map((product) => [product.id, product]));
  const removed: string[] = [];
  const repriced: string[] = [];
  let changed = false;

  const next: ProposalLine[] = [];
  for (const line of lines) {
    const product = byId.get(line.productId);
    const variant = line.variantId
      ? getActiveVariants(product ?? { variants: [] }).find((candidate) => candidate.id === line.variantId)
      : undefined;
    const price = product ? moneyToCents(variant ? variant.salePrice : product.salePrice) : 0;
    const gone = !product || (line.variantId !== undefined && !variant) || price <= 0;

    if (gone) {
      removed.push(line.variantName ? `${line.name} — ${line.variantName}` : line.name);
      changed = true;
      continue;
    }
    if (price !== line.unitPriceCents) {
      repriced.push(line.variantName ? `${line.name} — ${line.variantName}` : line.name);
      changed = true;
      next.push({ ...line, unitPriceCents: price });
      continue;
    }
    next.push(line);
  }

  return { lines: changed ? next : lines, removed, repriced };
}

export interface StockShortfall {
  key: string;
  name: string;
  requested: number;
  available: number;
}

/**
 * Itens COM controle de estoque em que o saldo não cobre a quantidade — faturar recusaria
 * (política `prevent`) e o negócio ficaria a meio caminho. Produto composto (BOM) e produto
 * ausente da lista ficam de fora: quem decide é o servidor.
 */
export function getStockShortfalls(lines: ProposalLine[], products: Product[]): StockShortfall[] {
  const byId = new Map(products.map((product) => [product.id, product]));
  const shortfalls: StockShortfall[] = [];

  for (const line of lines) {
    const product = byId.get(line.productId);
    if (!product || product.components?.length) continue;
    const variant = line.variantId ? product.variants?.find((candidate) => candidate.id === line.variantId) : undefined;
    if (line.variantId && !variant) continue;

    const source = variant ?? product;
    if (source.trackStock === false) continue;

    const available = Number.isFinite(source.currentStock) ? source.currentStock : 0;
    if (available < line.quantity) {
      shortfalls.push({
        key: lineKey(line),
        name: line.variantName ? `${line.name} — ${line.variantName}` : line.name,
        requested: line.quantity,
        available,
      });
    }
  }
  return shortfalls;
}

// ── Totais ───────────────────────────────────────────────────────────────────

export interface ProposalTotals {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  /** Só quando há desconto por promoção: vai em `discountReason` do pedido. */
  discountReason?: string;
  /** false = a promoção escolhida não vale (pedido mínimo não atingido). */
  promotionApplies: boolean;
  schedule: InstallmentScheduleEntry[];
}

/**
 * Tudo que a tela mostra do valor da proposta, derivado do estado — nenhum centavo guardado
 * em duplicidade. Promoção escolhida tem prioridade sobre o valor digitado (a UI limpa um
 * quando o vendedor passa pro outro).
 */
export function computeProposalTotals(input: {
  lines: ProposalLine[];
  promotion: BusinessPromotion | null;
  /** Total digitado pelo vendedor (centavos); `null` = sem negociação. */
  negotiatedTotalCents: number | null;
  installments: number;
  now: Date;
}): ProposalTotals {
  const subtotal = subtotalCents(input.lines);

  let discountCents = 0;
  let discountReason: string | undefined;
  let promotionApplies = true;

  if (input.promotion) {
    const applied = applyPromotion(input.promotion, subtotal);
    promotionApplies = applied !== null;
    if (applied) {
      discountCents = applied.discountCents;
      discountReason = applied.reason;
    }
  } else if (input.negotiatedTotalCents !== null) {
    discountCents = negotiatedToDiscountCents(subtotal, input.negotiatedTotalCents);
  }

  const totalCents = totalAfterDiscountCents(subtotal, discountCents);
  return {
    subtotalCents: subtotal,
    discountCents,
    totalCents,
    ...(discountReason ? { discountReason } : {}),
    promotionApplies,
    schedule: buildInstallmentSchedule(centsToMoney(totalCents), input.installments, input.now),
  };
}

// ── Corpo do pedido ──────────────────────────────────────────────────────────

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
  items: Array<{ productId: string; variantId?: string; quantity: number }>;
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
    items: input.lines.map((line) => ({
      productId: line.productId,
      ...(line.variantId ? { variantId: line.variantId } : {}),
      quantity: line.quantity,
    })),
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
