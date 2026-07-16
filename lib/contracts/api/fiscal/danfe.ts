/**
 * lib/contracts/api/fiscal/danfe.ts — POST /api/fiscal/danfe
 *
 * Geração de DANFE/DANFCE em HTML a partir do XML autorizado.
 *
 * `businessId` passou a ser OBRIGATÓRIO (auditoria P2): a rota antes aceitava
 * xml/status/cancelReason 100% client-supplied com qualquer usuário
 * autenticado de qualquer tenant. Agora o handler exige
 * verifyAuth(request, businessId) — binding explícito ao tenant.
 */

import { z } from 'zod';

export const DanfeRequestSchema = z
  .object({
    businessId: z.string().min(1, 'businessId e obrigatorio.'),
    xml: z.string().min(1, 'XML e obrigatorio para gerar DANFE.'),
    type: z.string().optional(),
    status: z.string().optional(),
    canceledAt: z.string().optional(),
    cancelReason: z.string().max(1000).optional(),
    contingenciaMotivo: z.string().max(1000).optional(),
  })
  .passthrough();

export type DanfeRequest = z.infer<typeof DanfeRequestSchema>;
