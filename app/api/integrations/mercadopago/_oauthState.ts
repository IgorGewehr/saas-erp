/**
 * app/api/integrations/mercadopago/_oauthState.ts
 *
 * Helpers do `state` do OAuth Marketplace do Mercado Pago. SERVER-ONLY.
 *
 * O `state` carrega o tenant através do redirect do MP e protege contra CSRF
 * (assinatura HMAC) + replay (nonce de uso único persistido em private/mpAuth
 * com janela curta). Não é um route file (prefixo `_`), só utilidades.
 *
 * Formato do state: `<base64url(JSON do payload)>.<base64url(HMAC-SHA256)>`
 * onde o payload obedece MpOAuthStateSchema {businessId, nonce, iat}.
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  MpOAuthStateSchema,
  type MpOAuthState,
} from '@/contracts/api/integrations/mercadopago';

/** Janela de validade do state/nonce (anti-replay). */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // ~10min

function getStateSecret(): string {
  const secret = process.env.MP_OAUTH_STATE_SECRET;
  if (!secret) {
    throw new Error('[MercadoPago] MP_OAUTH_STATE_SECRET é obrigatório');
  }
  return secret;
}

const mpAuthRef = (businessId: string) =>
  adminDb.collection('businesses').doc(businessId).collection('private').doc('mpAuth');

/** Gera um nonce aleatório (hex) para o state. */
export function newNonce(): string {
  return randomBytes(16).toString('hex');
}

/** Assina o payload do state com HMAC-SHA256 (MP_OAUTH_STATE_SECRET). */
export function signState(payload: MpOAuthState): string {
  const validated = MpOAuthStateSchema.parse(payload);
  const body = Buffer.from(JSON.stringify(validated)).toString('base64url');
  const sig = createHmac('sha256', getStateSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Verifica a assinatura HMAC e decodifica o payload. Retorna null se a
 * assinatura não bate, o formato é inválido ou o schema não valida.
 * NÃO checa nonce/janela aqui — isso é responsabilidade de consumeOAuthNonce.
 */
export function verifyStateSignature(state: string): MpOAuthState | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expected = createHmac('sha256', getStateSecret()).update(body).digest();
  let got: Buffer;
  try {
    got = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const result = MpOAuthStateSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/**
 * Persiste o nonce pendente em businesses/{id}/private/mpAuth (merge), pra
 * validar no callback (anti-replay). Sobrescreve qualquer nonce anterior — só
 * o último connect iniciado é válido.
 */
export async function persistOAuthNonce(businessId: string, nonce: string): Promise<void> {
  await mpAuthRef(businessId).set(
    { oauthNonce: nonce, oauthNonceAt: new Date().toISOString() },
    { merge: true },
  );
}

/**
 * Valida e CONSOME o nonce de uso único: confere assinatura já feita (state
 * decodificado), match contra o nonce persistido e janela de validade. Remove
 * o nonce ao final (sucesso ou falha por replay) pra impedir reuso.
 *
 * Retorna true se o state é legítimo e dentro da janela.
 */
export async function consumeOAuthNonce(
  businessId: string,
  state: MpOAuthState,
): Promise<boolean> {
  const snap = await mpAuthRef(businessId).get();
  const data = snap.exists ? snap.data() : undefined;
  const storedNonce = data?.oauthNonce as string | undefined;
  const storedAtRaw = data?.oauthNonceAt as string | undefined;

  // Limpa o nonce sempre que houver um (uso único — vale ou queima).
  const clearNonce = async () => {
    if (snap.exists && storedNonce) {
      await mpAuthRef(businessId)
        .set({ oauthNonce: FieldValue.delete(), oauthNonceAt: FieldValue.delete() }, { merge: true })
        .catch(() => undefined);
    }
  };

  if (!storedNonce || storedNonce !== state.nonce) {
    await clearNonce();
    return false;
  }

  const storedAt = storedAtRaw ? new Date(storedAtRaw).getTime() : NaN;
  const iatMs = state.iat * 1000;
  const now = Date.now();
  const fresh =
    Number.isFinite(storedAt) &&
    now - storedAt <= OAUTH_STATE_TTL_MS &&
    now - iatMs <= OAUTH_STATE_TTL_MS;

  await clearNonce();
  return fresh;
}
