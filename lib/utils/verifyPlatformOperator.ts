import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/config/firebaseAdmin';

/**
 * lib/utils/verifyPlatformOperator.ts
 *
 * Autenticação pro OPERADOR DA PLATAFORMA (M12 — você, dono deste SaaS) em
 * rotas cross-tenant (ex: painel de billing que lista TODAS as businesses).
 * Deliberadamente DIFERENTE de verifyAuth.ts: não exige `businessId`/perfil
 * em `users/{uid}` — um operador de plataforma não é membro de nenhum
 * tenant.
 *
 * Allowlist de e-mail via env var, NÃO um campo booleano em Firestore. Esta
 * mesma sessão achou e corrigiu um bug (M09) onde um campo de elevação de
 * privilégio (`users/{uid}.role`) era gravável pelo próprio client SDK antes
 * da correção de firestore.rules — um novo campo do tipo "sou admin" em um
 * doc que QUALQUER client pode em tese tentar escrever reintroduziria a
 * mesma classe de risco. Env var nunca é gravável a partir do client.
 */

interface PlatformOperatorResult {
  uid: string;
  email: string;
}

function getAllowlist(): Set<string> {
  const raw = process.env.PLATFORM_OPERATOR_EMAILS || '';
  return new Set(raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
}

export async function verifyPlatformOperator(req: NextRequest): Promise<PlatformOperatorResult | NextResponse> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized — missing token' }, { status: 401 });
  }
  const idToken = authHeader.split('Bearer ')[1];
  if (!idToken) {
    return NextResponse.json({ error: 'Unauthorized — empty token' }, { status: 401 });
  }

  const allowlist = getAllowlist();
  if (allowlist.size === 0) {
    // Fail-closed: sem allowlist configurada, ninguém passa — nunca "abre
    // geral" por omissão de configuração.
    console.error('[verifyPlatformOperator] PLATFORM_OPERATOR_EMAILS não configurada');
    return NextResponse.json({ error: 'Forbidden — platform billing not configured' }, { status: 403 });
  }

  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    const email = (decoded.email || '').toLowerCase();
    if (!email || !decoded.email_verified || !allowlist.has(email)) {
      return NextResponse.json({ error: 'Forbidden — platform operator only' }, { status: 403 });
    }
    return { uid: decoded.uid, email };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token verification failed';
    console.error('[verifyPlatformOperator] Token verification failed:', message);
    return NextResponse.json({ error: 'Unauthorized — invalid token' }, { status: 401 });
  }
}

export function isPlatformOperatorError(result: PlatformOperatorResult | NextResponse): result is NextResponse {
  return result instanceof NextResponse;
}
