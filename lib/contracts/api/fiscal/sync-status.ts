import { z } from 'zod';

/**
 * POST /api/fiscal/sync-status — sincroniza o status de um fiscalDocument com
 * a SEFAZ (consulta) e PERSISTE server-side, com guarda de FSM. Substitui o
 * write client-side (updateDoc) que burlava o FSM (R4): status é autoridade
 * do servidor.
 */
export const SyncStatusRequestSchema = z.object({
  businessId: z.string().min(1, 'businessId é obrigatório'),
  documentId: z.string().min(1, 'documentId é obrigatório'),
});

export type SyncStatusRequest = z.infer<typeof SyncStatusRequestSchema>;
