/**
 * lib/contracts/domain/saleReturn.ts
 *
 * Devolução PARCIAL de venda (item-a-item), M02. Um doc por evento de
 * devolução — mesmo padrão de ledger já usado em `stockMovements`/
 * `couponRedemptions`/`giftCardRedemptions` (append-only, referencia a Sale
 * de origem), não um array dentro do doc da Sale (evita crescimento
 * ilimitado + contenção de escrita no doc principal).
 *
 * Diferente do cancelamento TOTAL (`sale-transition-admin.ts`, M02.7), que
 * reverte 100% dos efeitos (estoque, receita, benefícios) e move
 * `sale.status → 'cancelada'`: devolução parcial NÃO muda `sale.status`
 * (a venda continua 'finalizada' — ela realmente aconteceu; a devolução é um
 * ajuste posterior, não uma anulação). Escopo deliberadamente restrito a
 * estoque + financeiro; ver `lib/services/sale-return-admin.ts` pro
 * raciocínio completo de cada decisão de escopo.
 */

import { z } from 'zod';

export const SaleReturnLineSchema = z.object({
  /** Corresponde a `SaleItem.id` na venda de origem. */
  itemId: z.string().min(1),
  quantity: z.number().positive(),
  /** Snapshot do `SaleItem.unitPrice` no momento da devolução — imutável
   *  mesmo se o preço do produto mudar depois. */
  unitPrice: z.number().nonnegative(),
});
export type SaleReturnLine = z.infer<typeof SaleReturnLineSchema>;

export const SaleReturnSchema = z.object({
  id: z.string().min(1),
  businessId: z.string().min(1),
  saleId: z.string().min(1),
  lines: z.array(SaleReturnLineSchema).min(1),
  /** round2(sum(lines.quantity * lines.unitPrice)) — base do estorno financeiro. */
  totalAmount: z.number().nonnegative(),
  reason: z.string().max(500).optional(),
  stockRestored: z.boolean(),
  /** FK pra Transaction de despesa/"Estornos" (contra-lançamento) — ausente
   *  quando totalAmount é 0 (não deveria acontecer, mas o schema permite). */
  refundTransactionId: z.string().optional(),
  operatorId: z.string().min(1),
  operatorName: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type SaleReturn = z.infer<typeof SaleReturnSchema>;
