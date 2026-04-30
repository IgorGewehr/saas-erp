/**
 * Tokens HMAC para links de descadastro em emails de broadcast.
 *
 * Estrutura do token: `${payload_b64url}.${signature_hex}` onde
 *   payload = `${businessId}|${channel}|${identifier}|${expiresAtMs}`
 *
 * Validade default: 1 ano. Links em emails antigos devem continuar funcionando
 * (compliance LGPD: usuário deve poder se descadastrar a qualquer momento).
 *
 * Segredo: variável de ambiente `UNSUBSCRIBE_SECRET` (≥32 chars).
 * Sem o segredo configurado, geração lança erro — endpoints público falham
 * fail-closed (preferível a tokens forjáveis).
 */

import crypto from 'crypto';
import type { OptOutChannel } from '@/lib/types';

const DEFAULT_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 ano

interface UnsubscribePayload {
  businessId: string;
  channel: OptOutChannel;
  identifier: string;
  expiresAt: number; // ms epoch
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

function b64urlDecode(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}

function getSecret(): string {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('UNSUBSCRIBE_SECRET env var is missing or too short (≥32 chars required)');
  }
  return secret;
}

/**
 * Gera token assinado para incluir em link de descadastro.
 */
export function generateUnsubscribeToken(
  businessId: string,
  channel: OptOutChannel,
  identifier: string,
  ttlMs: number = DEFAULT_TTL_MS,
): string {
  const secret = getSecret();
  const expiresAt = Date.now() + ttlMs;
  const raw = `${businessId}|${channel}|${identifier.toLowerCase()}|${expiresAt}`;
  const payload = b64urlEncode(raw);
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

/**
 * Verifica e decodifica o token. Retorna null se inválido/expirado.
 *
 * Validações:
 *  - Estrutura `${payload}.${sig}`
 *  - Assinatura HMAC bate (comparação timing-safe)
 *  - `expiresAt` ainda no futuro
 *  - Estrutura interna do payload (4 campos, channel valido)
 */
export function verifyUnsubscribeToken(token: string): UnsubscribePayload | null {
  if (!token || typeof token !== 'string') return null;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0 || dotIdx === token.length - 1) return null;

  const payloadB64 = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!/^[a-f0-9]+$/i.test(sig)) return null;

  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return null;
  }

  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');

  // Timing-safe compare
  let sigBuf: Buffer;
  let expectedBuf: Buffer;
  try {
    sigBuf = Buffer.from(sig, 'hex');
    expectedBuf = Buffer.from(expectedSig, 'hex');
  } catch {
    return null;
  }
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  // Decodifica e valida estrutura
  let raw: string;
  try {
    raw = b64urlDecode(payloadB64);
  } catch {
    return null;
  }
  const parts = raw.split('|');
  if (parts.length !== 4) return null;

  const [businessId, channelRaw, identifier, expiresStr] = parts;
  if (!businessId || !identifier) return null;

  const expiresAt = Number(expiresStr);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  const channel = channelRaw as OptOutChannel;
  if (!['email', 'whatsapp', 'all'].includes(channel)) return null;

  return { businessId, channel, identifier, expiresAt };
}
