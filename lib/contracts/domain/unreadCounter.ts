/**
 * lib/contracts/domain/unreadCounter.ts
 *
 * unreadCounters/{businessId} — contador denormalizado de mensagens não-lidas
 * por escopo, para evitar listeners full-collection sobre `conversations` nos
 * badges (TopBar/Sidebar). Um único doc por tenant, assinado por 1 onSnapshot.
 *
 * Granularidade (ver docs/audit/PLANO_LOTE_B_custo_firebase.md §2.1):
 *   - `business`        soma de unread de conversas channelOwnerType=='business'
 *   - `byUser[uid]`     soma de unread de conversas channelOwnerId==uid (canais pessoais)
 *   - `total`           todas as conversas do tenant (badge admin/founder lê isto)
 *
 * Badge operador = business + (byUser[uid] || 0). Badge admin/founder = total.
 *
 * Escrita SOMENTE via Admin SDK (server). Rules: read se membro do tenant,
 * write: if false. Ver firestore.rules match /unreadCounters/{businessId}.
 */

import { z } from 'zod';

export const UnreadCounterSchema = z.object({
  businessId: z.string().min(1, 'businessId obrigatório (multi-tenant)'),
  business: z.number().int().nonnegative(),
  byUser: z.record(z.string(), z.number().int().nonnegative()),
  total: z.number().int().nonnegative(),
  updatedAt: z.string().min(1),
});

export type UnreadCounter = z.infer<typeof UnreadCounterSchema>;
