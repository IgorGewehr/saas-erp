/**
 * lib/contracts/api/transactions/settle.ts — POST /api/transactions/{id}/settle
 * Auth: sessão de usuário, manager+ (mesma barreira de leitura/escrita de
 * `transactions` nas rules).
 *
 * Registra o RECEBIMENTO de uma receita pendente (ex.: parcela de um pedido
 * B2B faturado). O patch é whitelist — só `paymentDate` e `paymentMethod` —
 * pra o browser nunca conseguir reescrever valor, cliente ou vencimento por
 * aqui. Repetir a chamada numa receita já paga é no-op (não sobrescreve).
 */

import { z } from 'zod';

/** Subconjunto de PAYMENT_METHODS que faz sentido ao RECEBER um valor: fora
 *  creditoLoja/pontos/gift_card/semPagamento, que têm efeito próprio (baixa de
 *  saldo) e não são "o cliente pagou". */
export const SETTLE_PAYMENT_METHODS = ['dinheiro', 'pix', 'credito', 'debito', 'boleto', 'outros'] as const;
export const SettlePaymentMethodSchema = z.enum(SETTLE_PAYMENT_METHODS);

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` que existe no calendário (rejeita 2026-02-31). */
const DateOnlySchema = z.string().refine((value) => {
  const match = DATE_ONLY.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, { message: 'Data inválida (use AAAA-MM-DD).' });

export const SettleTransactionBodySchema = z.object({
  businessId: z.string().min(1),
  paymentMethod: SettlePaymentMethodSchema.optional(),
  /** Ausente ⇒ o servidor usa a data de hoje (UTC). O tablet manda a data local. */
  paymentDate: DateOnlySchema.optional(),
});
export type SettleTransactionBody = z.infer<typeof SettleTransactionBodySchema>;

export const SettleTransactionResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    id: z.string(),
    status: z.literal('pago'),
    paymentDate: z.string().optional(),
    paymentMethod: z.string().optional(),
    /** true = já estava paga; nada foi gravado. */
    alreadySettled: z.boolean(),
  }),
});
export type SettleTransactionResponse = z.infer<typeof SettleTransactionResponseSchema>;
