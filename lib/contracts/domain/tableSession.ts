/**
 * lib/contracts/domain/tableSession.ts
 *
 * TableSession — a "comanda" de uma mesa do salão (restaurante). Uma sessão
 * agrega VÁRIOS `deliveryOrder` (`deliveryType='mesa'`) da mesma mesa física
 * enquanto ela está ocupada, some tudo numa conta corrente, e no fechamento
 * joga os itens consolidados no PDV como UMA venda única.
 *
 * ─── Por que não lançar receita por pedido ──────────────────────────────────
 * Pedido de mesa vinculado a uma sessão NÃO passa pelo caminho normal de
 * receita (`transactions/{orderId}_revenue` na entrega). A receita, o
 * pagamento e a NFC-e saem UMA vez, pelo checkout do PDV, quando a conta é
 * fechada (`settleTableSessionAdmin`). Cada pedido então vira `entregue` com
 * `settledViaSaleId` apontando pra Sale — sem transação de receita própria.
 * Ver `lib/services/delivery-order-transition-admin.ts` (param `settleViaSaleId`).
 *
 * ─── Invariantes (superRefine) ──────────────────────────────────────────────
 *   - status 'fechada' ⇒ `closedAt` + `closedByUid` + `subtotalSnapshot`.
 *   - status 'paga'    ⇒ `saleId` + `paidAt` + `closedAt` (fechou antes de pagar).
 *   - status 'aberta'  ⇒ nenhum campo de fechamento/pagamento preenchido.
 *   - `orderIds` sem duplicatas.
 *
 * ─── O que NÃO vive aqui ────────────────────────────────────────────────────
 *   - Transições de status → `lib/contracts/fsm/tableSession.ts`.
 *   - Efeitos do fechamento/pagamento → `lib/services/table-session-admin.ts`.
 *   - Evento de auditoria do fechamento → `table.settled` em
 *     `lib/contracts/events/index.ts` (audit-only; efeito roda inline no serviço).
 *   - Regra "só 1 sessão aberta por mesa por vez" → `openTableSessionAdmin`
 *     resolve dentro de `runTransaction` (reusa a sessão aberta se já existe).
 */

import { z } from 'zod';

export const TABLE_SESSION_STATUSES = ['aberta', 'fechada', 'paga', 'cancelada'] as const;
export const TableSessionStatusSchema = z.enum(TABLE_SESSION_STATUSES);
export type TableSessionStatus = z.infer<typeof TableSessionStatusSchema>;

export const TABLE_SESSION_STATUS_LABELS: Record<TableSessionStatus, string> = {
  aberta: 'Aberta',
  fechada: 'Conta fechada',
  paga: 'Paga',
  cancelada: 'Cancelada',
};

export const TableSessionSchema = z
  .object({
    id: z.string().optional(),
    businessId: z.string().min(1, 'businessId obrigatório (multi-tenant)'),

    /** Rótulo humano da mesa — ex. "Mesa 12", "Varanda 3". É o que casa com o
     *  `?mesa=` do QR code e com o `tableNumber` do pedido. */
    tableLabel: z.string().trim().min(1).max(40),
    /** FK opcional pra `businesses/{id}.settings.pedidos.tables[].id`. Livre
     *  (mesa avulsa digitada na hora não precisa). */
    tableId: z.string().min(1).max(60).optional(),

    status: TableSessionStatusSchema,

    openedAt: z.string().min(1),
    /** uid do operador, ou `'public'` quando a sessão nasce de um QR anônimo. */
    openedByUid: z.string().min(1),
    openedByName: z.string().min(1).max(200),

    /** Pedidos vinculados. Sempre via `arrayUnion` — nunca reescreve o array. */
    orderIds: z.array(z.string().min(1)).default([]),

    guestName: z.string().trim().max(200).optional(),
    guestCount: z.number().int().positive().max(999).optional(),

    /** Herda a regra de visibilidade por setor dos demais módulos (Conversas,
     *  Kanban, Financeiro...). Ausente = visível a todos do negócio. */
    sectorId: z.string().min(1).optional(),

    closedAt: z.string().min(1).optional(),
    closedByUid: z.string().min(1).optional(),
    closedByName: z.string().min(1).max(200).optional(),
    /** Σ `total` dos pedidos não-cancelados, congelada no fechamento. */
    subtotalSnapshot: z.number().nonnegative().optional(),

    /** FK pra `sales/{id}` gerada no checkout do PDV. Presente só em 'paga'. */
    saleId: z.string().min(1).optional(),
    paidAt: z.string().min(1).optional(),
    paidByUid: z.string().min(1).optional(),

    /** Motivo do cancelamento (quando status 'cancelada'). */
    cancelReason: z.string().trim().max(500).optional(),

    notes: z.string().max(1000).optional(),

    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .superRefine((s, ctx) => {
    const closingFields = [s.closedAt, s.closedByUid, s.subtotalSnapshot];
    const payingFields = [s.saleId, s.paidAt];

    if (s.status === 'fechada') {
      if (closingFields.some((f) => f === undefined)) {
        ctx.addIssue({
          code: 'custom', path: ['status'],
          message: 'Sessão fechada precisa de closedAt, closedByUid e subtotalSnapshot',
        });
      }
    }

    if (s.status === 'paga') {
      if (payingFields.some((f) => f === undefined) || s.closedAt === undefined) {
        ctx.addIssue({
          code: 'custom', path: ['status'],
          message: 'Sessão paga precisa de saleId, paidAt e closedAt',
        });
      }
    }

    if (s.status === 'aberta' && (closingFields.some((f) => f !== undefined) || payingFields.some((f) => f !== undefined))) {
      ctx.addIssue({
        code: 'custom', path: ['status'],
        message: 'Sessão aberta não pode ter campos de fechamento/pagamento preenchidos',
      });
    }

    if (new Set(s.orderIds).size !== s.orderIds.length) {
      ctx.addIssue({ code: 'custom', path: ['orderIds'], message: 'orderIds não pode ter duplicatas' });
    }
  });

export type TableSession = z.infer<typeof TableSessionSchema>;

/** Mesa configurada nas settings do negócio (`settings.pedidos.tables`). */
export const BusinessTableSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().trim().min(1).max(40),
});
export type BusinessTable = z.infer<typeof BusinessTableSchema>;
