/**
 * lib/contracts/api/services/sale-server.ts
 *
 * Contrato de input do serviço único `createSaleWithSideEffects`
 * (lib/services/sales-server.ts), reutilizado por:
 *   - app/api/v1/sales/route.ts (público, Bearer SaasApiKey)
 *   - app/api/agent/tools/sales/route.ts (agent, HMAC)
 *
 * O serviço cria, numa única operação idempotente:
 *   Sale + Transaction de receita (com saleId ↔ Sale.transactionId) +
 *   StockMovements (dedução atômica de estoque) + Transaction de comissão opcional
 *   (com Sale.commissionTransactionId).
 *
 * SDD: tipo derivado via z.infer — não redeclarar interface paralela.
 */

import { z } from 'zod';
import { PaymentSchema, SaleStatusSchema } from '@/contracts/domain/sale';
import { SelectedModifierSchema } from '@/contracts/domain/deliveryOrder';

const SaleItemInputSchema = z.object({
  productId: z.string().optional(),
  serviceId: z.string().optional(),
  variantId: z.string().optional(),
  description: z.string().min(1).max(300),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  discount: z.number().nonnegative().default(0),
  basePrice: z.number().nonnegative().optional(),
  selectedModifiers: z.array(SelectedModifierSchema).optional(),
  notes: z.string().max(500).optional(),
  /** Server recomputa se ausente. */
  total: z.number().nonnegative().optional(),
}).superRefine((it, ctx) => {
  if (!it.productId && !it.serviceId) {
    ctx.addIssue({ code: 'custom', message: 'productId ou serviceId obrigatório', path: ['productId'] });
  }
});

export const CreateSaleWithSideEffectsInputSchema = z.object({
  businessId: z.string().min(1),
  clientId: z.string().optional(),
  clientName: z.string().max(200).optional(),
  items: z.array(SaleItemInputSchema).min(1),
  payments: z.array(PaymentSchema).min(1),
  discount: z.number().nonnegative().default(0),
  tip: z.number().nonnegative().optional(),
  status: SaleStatusSchema.default('finalizada'),
  notes: z.string().max(2000).optional(),
  channelType: z.enum(['whatsapp', 'facebook', 'instagram']).optional(),
  conversationId: z.string().optional(),
  sectorId: z.string().optional(),
  /** FKs de resultado (P2.10) — origem conhecida que esta venda concretizou.
   *  Aditivas/opcionais: o deal/appointment que a venda fechou ou cobrou. */
  dealId: z.string().optional(),
  appointmentId: z.string().optional(),
  /** Quem origina a venda — preenchido por cada caller (API/agent/PDV). */
  operatorId: z.string().min(1),
  operatorName: z.string().min(1),
  /** Taxa de comissão (%) do operador. 0/ausente → sem comissão. */
  commissionRate: z.number().nonnegative().optional(),
  /** Motivo auditável do desconto; callers legados recebem um motivo padrão. */
  discountReason: z.string().min(3).max(300).optional(),
  /**
   * Chave de idempotência. Se ausente, o serviço deriva uma determinística
   * do conteúdo da venda (mesmo padrão de agenda/route.ts). Pré-checagem
   * antes de criar evita Sale/Transaction/StockMovement duplicados em retry.
   */
  idempotencyKey: z.string().min(1).max(200).optional(),
}).superRefine((s, ctx) => {
  if (s.status === 'finalizada') {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const itemsTotal = round2(
      s.items.reduce((acc, it) => acc + (it.total ?? it.quantity * it.unitPrice - it.discount), 0),
    );
    const expectedTotal = round2(Math.max(itemsTotal - s.discount + (s.tip ?? 0), 0));
    const paid = round2(s.payments.reduce((acc, p) => acc + p.amount, 0));
    if (Math.abs(paid - expectedTotal) > 0.011) {
      ctx.addIssue({
        code: 'custom',
        message: `sum(payments) (${paid}) ≠ total esperado (${expectedTotal}) numa venda finalizada`,
        path: ['payments'],
      });
    }
  }
});

export type CreateSaleWithSideEffectsInput = z.infer<typeof CreateSaleWithSideEffectsInputSchema>;
