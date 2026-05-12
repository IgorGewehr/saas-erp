/**
 * Logger de falhas do pipeline de mensageria — escreve em `webhookFailures`,
 * consumido pelo painel Configurações → Logs (Settings).
 *
 * Substitui o helper local `logMediaFailure` que vivia em meta/route.ts, e
 * estende pra cobrir falhas de OUTBOUND send (broadcast + envio manual) que
 * antes só caíam em console.error — operador não tinha como diagnosticar
 * "Business eligibility payment issue" / "Message undeliverable" sem ler logs
 * do servidor.
 *
 * Best-effort: nunca throw. Registrar erro não pode causar um segundo erro.
 */

import { adminDb } from '@/lib/config/firebaseAdmin';

export type PipelineFailureSource =
  // Pipeline de mídia (inbound, recebimento)
  | 'meta-media-pipeline'
  | 'meta-media-url-fetch'
  | 'meta-media-url-missing'
  | 'meta-media-download'
  | 'meta-audio-conversion'
  | 'baileys-media-download'
  | 'baileys-media-oversize'
  | 'baileys-audio-conversion'
  // Envio outbound (manual + campanha) — captura erros tipo "Business
  // eligibility payment issue" da Meta que antes só apareciam em
  // broadcastMessages.errorMessage e não eram visíveis no painel de logs.
  | 'whatsapp-send'
  | 'webhook-handler';

export interface PipelineFailureInput {
  source: PipelineFailureSource;
  channel?: 'whatsapp' | 'facebook' | 'instagram' | 'email';
  businessId?: string | null;
  conversationId?: string | null;
  /** Phone digits (WA) ou IGSID/PSID (FB/IG) — facilita reproduzir o problema. */
  recipientId?: string;
  /** Quando a falha ocorreu durante envio de campanha. */
  broadcastId?: string;
  /** 'cloud' (Meta Cloud API) | 'baileys' (WhatsApp Web). */
  transport?: 'cloud' | 'baileys';
  /** Mensagem curta apresentada na UI. */
  error?: string;
  /** Stack trace ou body bruto pra debug avançado. */
  errorStack?: string;
  errorBody?: string;
  /** HTTP status do upstream (Meta API, etc), se aplicável. */
  httpStatus?: number;
  /** 'error' (default) | 'warning' (esperado, ex: janela 24h fechou). */
  severity?: 'error' | 'warning';
  /** Campos extras específicos de cada source. */
  [extra: string]: unknown;
}

export async function logPipelineFailure(input: PipelineFailureInput): Promise<void> {
  try {
    const { source, channel, businessId, conversationId, severity, ...rest } = input;
    await adminDb.collection('webhookFailures').add({
      source,
      channel: channel ?? 'whatsapp',
      severity: severity ?? 'error',
      ...(businessId ? { businessId } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...rest,
      createdAt: new Date().toISOString(),
    });
  } catch (logErr) {
    // Registrar erro não pode causar um segundo erro. Best-effort only.
    console.warn('[pipelineFailures] webhookFailures log failed (non-fatal):', logErr);
  }
}

/**
 * Heurística pra severidade de erro de envio. "Business eligibility",
 * tokens inválidos e quedas de rede são `error` (problema real do tenant).
 * Janela 24h fechada e "número sem WhatsApp" são `warning` (esperado em
 * uso normal — operador já vê esses no detalhe da campanha/conversa).
 */
export function classifySendErrorSeverity(message: string | undefined | null): 'error' | 'warning' {
  if (!message) return 'error';
  const m = message.toLowerCase();
  // Esperado em uso normal: avisa, não destaca.
  if (m.includes('re-engagement') || m.includes('24 hours') || m.includes('24h')) return 'warning';
  if (m.includes('does not exist on whatsapp') || m.includes('not a whatsapp')) return 'warning';
  // Tudo o mais é falha real (eligibility, payment, undeliverable, token).
  return 'error';
}
