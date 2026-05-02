/**
 * GET /api/whatsapp/debug?businessId=xxx
 *
 * Retorna o estado interno da sessão Baileys em tempo real:
 *  - conexão, contadores de mensagens, filtros, erros
 *
 * Autenticado via Firebase session (operador precisa estar logado).
 * Apenas admin/founder pode usar em produção — não expõe credenciais.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { sessions } from '../baileys-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get('businessId');

  if (!businessId) {
    return NextResponse.json({ error: 'businessId required' }, { status: 400 });
  }

  const authResult = await verifyAuth(req, businessId);
  if (isAuthError(authResult)) return authResult;

  // Coleta todas as sessões deste business
  const result: Record<string, unknown>[] = [];

  for (const [key, session] of sessions.entries()) {
    if (session.businessId !== businessId) continue;

    result.push({
      connectionId: session.connectionId,
      isConnected: session.isConnected,
      isDestroyed: session.isDestroyed,
      hasSock: !!session.sock,
      sockReadyState: session.sock?.ws?.readyState ?? null,
      // Sock user info
      sockUserId: session.sock?.user?.id ?? null,
      sockUserName: session.sock?.user?.name ?? null,
      sockUserPhone: session.sock?.user?.phoneNumber ?? null,
      // LID map
      lidToPhoneSize: session.lidToPhone.size,
      lidToPhoneSample: Object.fromEntries([...session.lidToPhone.entries()].slice(0, 5)),
      // Debug counters
      debug: session._dbg,
    });
  }

  if (result.length === 0) {
    return NextResponse.json({
      sessions: [],
      message: 'Nenhuma sessão Baileys ativa para este business. O servidor pode ter sido reiniciado.',
    });
  }

  return NextResponse.json({ sessions: result });
}
