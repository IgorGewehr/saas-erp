/**
 * lib/contracts/api/agent/send-interactive.ts
 *
 * Contrato para /api/agent/tools/send-interactive — envia lista interativa do
 * WhatsApp (Baileys only) com opções selecionáveis (ex: horários disponíveis).
 *
 * M11.1: rota nunca teve contrato REGISTRADO (não estava em AGENT_TOOL_DOMAINS,
 * então nenhum handler o consumia). Um arquivo com este mesmo path já existia
 * (commit 97f2d0f) mas nunca foi wireado — usava `action: z.literal('send').
 * optional()`, incompatível com o literal real que o agente Python envia:
 * `_split_action('conversation_send_interactive')` (agent/app/tools/client.py)
 * gera `action: 'send_interactive'`, não `'send'`. Reescrito com o literal
 * correto (verificado contra o client.py atual), preservando os limites de
 * tamanho do arquivo original (bounds defensivos, não limite exato da API do
 * WhatsApp).
 */

import { z } from 'zod';
import { DocIdSchema } from './_shared';

export const InteractiveRowSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(60),
  description: z.string().max(200).optional(),
});

export const InteractiveSectionSchema = z.object({
  title: z.string().min(1).max(60),
  rows: z.array(InteractiveRowSchema).min(1).max(10),
});

export const SendInteractiveParamsSchema = z.object({
  conversation_id: DocIdSchema,
  title: z.string().min(1).max(60),
  body: z.string().min(1).max(1024),
  footer: z.string().max(60).optional(),
  button_text: z.string().min(1).max(20),
  sections: z.array(InteractiveSectionSchema).min(1).max(10),
});

export const SendInteractiveDataSchema = z.object({
  externalMessageId: z.string().min(1),
});

export const SendInteractiveToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send_interactive'), params: SendInteractiveParamsSchema }),
]);

export type SendInteractiveToolRequest = z.infer<typeof SendInteractiveToolRequestSchema>;
export type SendInteractiveToolAction = SendInteractiveToolRequest['action'];

export const SEND_INTERACTIVE_DATA_SCHEMAS = {
  send_interactive: SendInteractiveDataSchema,
} as const satisfies Record<SendInteractiveToolAction, z.ZodTypeAny>;
