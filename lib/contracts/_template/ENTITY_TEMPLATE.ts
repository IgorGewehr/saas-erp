/**
 * lib/contracts/_template/ENTITY_TEMPLATE.ts
 *
 * Template para criar um novo schema de domínio.
 * Copie para lib/contracts/domain/{entity}.ts e adapte.
 *
 * Regra: o schema é a fonte da verdade. O tipo TS é derivado com z.infer.
 * NÃO redeclare manualmente uma interface paralela.
 */

import { z } from 'zod';

// 1. ENUMS / DISCRIMINANTS — declarados como const arrays + z.enum
//    Permite reusar em FSM e em outros contratos sem duplicação.
export const ENTITY_STATUSES = ['rascunho', 'ativo', 'arquivado'] as const;
export const EntityStatusSchema = z.enum(ENTITY_STATUSES);
export type EntityStatus = z.infer<typeof EntityStatusSchema>;

// 2. SUB-SCHEMAS — quebre em partes para reuso (input vs persisted)
const EntityBaseSchema = z.object({
  businessId: z.string().min(1, 'businessId obrigatório (multi-tenant)'),
  name: z.string().min(1).max(200),
  status: EntityStatusSchema,
});

// 3. PERSISTED — o que vive no Firestore (com id, timestamps, audit)
export const EntitySchema = EntityBaseSchema.extend({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().min(1),
}).superRefine((data, ctx) => {
  // INVARIANTES — regras que cruzam campos
  if (data.status === 'arquivado' && !data.updatedAt) {
    ctx.addIssue({
      code: 'custom',
      message: 'updatedAt obrigatório quando arquivado',
      path: ['updatedAt'],
    });
  }
});
export type Entity = z.infer<typeof EntitySchema>;

// 4. CREATE INPUT — o que o cliente envia (sem id/timestamps/audit)
export const EntityCreateInputSchema = EntityBaseSchema;
export type EntityCreateInput = z.infer<typeof EntityCreateInputSchema>;

// 5. UPDATE INPUT — parcial, sem businessId (não deve mudar de tenant)
export const EntityUpdateInputSchema = EntityBaseSchema
  .omit({ businessId: true })
  .partial();
export type EntityUpdateInput = z.infer<typeof EntityUpdateInputSchema>;
