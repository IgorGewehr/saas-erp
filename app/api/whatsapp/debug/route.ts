/**
 * GET /api/whatsapp/debug?businessId=xxx
 * Endpoint de diagnóstico — expõe apenas estado interno da sessão, sem credenciais.
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { sessions } from '../baileys-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get('businessId');

    if (!businessId) {
      return NextResponse.json({ error: 'businessId required' }, { status: 400 });
    }

    // Lightweight auth: verifica que o business existe no Firestore
    const bizSnap = await adminDb.collection('businesses').doc(businessId).get();
    if (!bizSnap.exists) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const result: Record<string, unknown>[] = [];

    for (const [, session] of sessions.entries()) {
      if (session.businessId !== businessId) continue;
      result.push({
        connectionId: session.connectionId,
        isConnected: session.isConnected,
        isDestroyed: session.isDestroyed,
        hasSock: !!session.sock,
        sockReadyState: session.sock?.ws?.readyState ?? null,
        sockUserId: session.sock?.user?.id ?? null,
        sockUserName: session.sock?.user?.name ?? null,
        sockUserPhone: session.sock?.user?.phoneNumber ?? null,
        lidToPhoneSize: session.lidToPhone.size,
        lidToPhoneSample: Object.fromEntries([...session.lidToPhone.entries()].slice(0, 5)),
        debug: session._dbg,
      });
    }

    if (result.length === 0) {
      return NextResponse.json({
        sessions: [],
        sessionsMapSize: sessions.size,
        message: 'Nenhuma sessão Baileys ativa. Servidor pode ter sido reiniciado — reconecte o QR.',
      });
    }

    return NextResponse.json({ sessions: result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
