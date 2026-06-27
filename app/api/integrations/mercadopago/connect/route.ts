/**
 * POST|GET /api/integrations/mercadopago/connect
 *
 * Inicia o OAuth Marketplace do Mercado Pago. Exige usuário autenticado com
 * role admin+ dono do business. O `businessId` vem SEMPRE da sessão (R1),
 * nunca de param do client.
 *
 * Gera um `state` assinado (HMAC-SHA256 / MP_OAUTH_STATE_SECRET) com
 * {businessId, nonce, iat}, persiste o nonce em private/mpAuth (anti-replay,
 * janela ~10min) e devolve a authUrl pro painel abrir o popup do MP.
 */

import { NextRequest } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { UserRole } from '@/lib/types';
import { MpConnectBodySchema } from '@/contracts/api/integrations/mercadopago';
import { ok, fail } from '../_response';
import { signState, persistOAuthNonce, newNonce } from '../_oauthState';

async function handle(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (isAuthError(auth)) {
    return fail('UNAUTHORIZED', 'Autenticação obrigatória', 401);
  }
  const role = (auth.role || 'viewer') as UserRole;
  if ((ROLE_HIERARCHY[role] || 0) < ROLE_HIERARCHY['admin']) {
    return fail('FORBIDDEN', 'Apenas admin pode conectar o Mercado Pago', 403);
  }

  // returnTo é opcional e por ora não influencia o fluxo (popup volta via
  // window.opener.postMessage). Validamos só pra cumprir o boundary (R6).
  if (req.method === 'POST') {
    let raw: unknown = {};
    try {
      raw = await req.json();
    } catch {
      raw = {};
    }
    const parsed = MpConnectBodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', 'Corpo inválido', 400, { details: parsed.error.flatten() });
    }
  }

  const clientId = process.env.MP_CLIENT_ID;
  const redirectUri = process.env.MP_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return fail('INTERNAL', 'Integração Mercado Pago não configurada (env ausente)', 500);
  }

  const nonce = newNonce();
  const iat = Math.floor(Date.now() / 1000);
  let state: string;
  try {
    state = signState({ businessId: auth.businessId, nonce, iat });
  } catch (err) {
    console.error('[mp/connect] signState falhou:', err instanceof Error ? err.message : err);
    return fail('INTERNAL', 'Integração Mercado Pago não configurada (state secret)', 500);
  }

  await persistOAuthNonce(auth.businessId, nonce);

  const authUrl =
    'https://auth.mercadopago.com/authorization' +
    `?client_id=${encodeURIComponent(clientId)}` +
    '&response_type=code' +
    '&platform_id=mp' +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;

  return ok({ authUrl });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
