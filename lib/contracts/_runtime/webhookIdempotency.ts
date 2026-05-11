/**
 * lib/contracts/_runtime/webhookIdempotency.ts
 *
 * Idempotência de webhooks externos (Meta/Facebook/Instagram).
 *
 * Meta pode retransmitir o mesmo evento (timeout do destinatário, retry interno).
 * Sem dedup, criamos ConversationMessage duplicado, double-count de stats, etc.
 *
 * Estratégia:
 *   - Para cada `wamid` (WhatsApp) / `mid` (FB/IG) processado, registra em
 *     `webhookSeen/{businessId}_{externalMessageId}` com TTL de 24h.
 *   - Antes de processar, chama `markWebhookSeen()` que retorna `seen=true`
 *     se já existe → caller pula processamento.
 *
 * Race: 2 webhooks idênticos processando ao mesmo tempo. Solução: a checagem
 * usa `create` (não `set`) — se outro pod já criou, lança ALREADY_EXISTS e
 * retornamos seen=true. Atômico.
 */

import type { Firestore } from 'firebase-admin/firestore';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export interface WebhookSeenOpts {
  businessId: string;
  /** wamid (WhatsApp Cloud), mid (FB/IG), key.id (Baileys). Único por canal. */
  externalMessageId: string;
  /** Identificador da fonte para auditoria (ex: 'meta_whatsapp', 'meta_facebook', 'baileys'). */
  source: string;
  ttlMs?: number;
}

export interface WebhookSeenResult {
  /** True se já vimos esse evento antes (não processe de novo). */
  seen: boolean;
}

/**
 * Tenta marcar um evento como visto. Atômico (usa `.create`).
 *
 *   const { seen } = await markWebhookSeen(adminDb, { businessId, externalMessageId: wamid, source: 'meta_whatsapp' });
 *   if (seen) return; // duplicate — skip
 *   // ...processa mensagem...
 */
export async function markWebhookSeen(
  db: Firestore,
  opts: WebhookSeenOpts,
): Promise<WebhookSeenResult> {
  const docId = `${opts.businessId}_${opts.externalMessageId}`;
  const ref = db.collection('webhookSeen').doc(docId);
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  try {
    await ref.create({
      businessId: opts.businessId,
      externalMessageId: opts.externalMessageId,
      source: opts.source,
      seenAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    });
    return { seen: false };
  } catch (err) {
    // ALREADY_EXISTS — já processado por outro caller (ou retry duplicado)
    if (isAlreadyExistsError(err)) {
      return { seen: true };
    }
    throw err;
  }
}

function isAlreadyExistsError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: number | string }).code;
  // Firestore admin: code 6 = ALREADY_EXISTS
  if (code === 6 || code === 'already-exists') return true;
  const message = (err as { message?: string }).message ?? '';
  return /already exists/i.test(message);
}
