/**
 * lib/contracts/api/tableSession.ts
 *
 * Contratos de request das rotas de comanda de mesa:
 *   POST /api/table-sessions              → abrir (open)
 *   POST /api/table-sessions/[id]/close   → fechar conta
 *   POST /api/table-sessions/[id]/reopen  → reabrir
 *   POST /api/table-sessions/[id]/cancel  → cancelar mesa
 *   POST /api/table-sessions/[id]/settle  → liquidar (chamada pelo PDV após checkout)
 *
 * Todas autenticadas (Bearer Firebase ID token), operador+. Ver
 * lib/services/table-session-admin.ts.
 */

import { z } from 'zod';

export const OpenTableSessionBodySchema = z.object({
  businessId: z.string().min(1),
  tableLabel: z.string().trim().min(1).max(40),
  tableId: z.string().min(1).max(60).optional(),
  sectorId: z.string().min(1).optional(),
  guestName: z.string().trim().max(200).optional(),
  guestCount: z.number().int().positive().max(999).optional(),
});
export type OpenTableSessionBody = z.infer<typeof OpenTableSessionBodySchema>;

export const CloseTableSessionBodySchema = z.object({
  businessId: z.string().min(1),
});
export type CloseTableSessionBody = z.infer<typeof CloseTableSessionBodySchema>;

export const ReopenTableSessionBodySchema = CloseTableSessionBodySchema;
export type ReopenTableSessionBody = z.infer<typeof ReopenTableSessionBodySchema>;

export const CancelTableSessionBodySchema = z.object({
  businessId: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});
export type CancelTableSessionBody = z.infer<typeof CancelTableSessionBodySchema>;

export const SettleTableSessionBodySchema = z.object({
  businessId: z.string().min(1),
  saleId: z.string().min(1),
});
export type SettleTableSessionBody = z.infer<typeof SettleTableSessionBodySchema>;
