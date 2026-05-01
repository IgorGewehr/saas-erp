/**
 * WhatsApp Web (Baileys) — SSE QR Code Stream
 *
 * GET /api/whatsapp/connect?businessId=xxx
 *   → Server-Sent Events: QR codes, connection status
 *
 * Delegates socket management to baileys-manager.ts (singleton).
 */

import { NextRequest } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import {
  sessions,
  createBaileysSession,
  destroySession,
} from '../baileys-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get('businessId');
  // `connectionId` (Phase 2): identifica qual channelConnection conectar.
  // Quando ausente, usa primary business (comportamento legado idêntico).
  // Quando presente, conecta a connection específica — usado pro flow
  // "Meus Canais" onde operator conecta o próprio Baileys pessoal.
  const connectionId = searchParams.get('connectionId') || undefined;
  // `?force=1` destroys any existing session first — used when the user explicitly
  // clicks "reconnect" after a flaky state where Firestore says connected but no
  // messages arrive (zombie socket on WhatsApp side).
  const forceReconnect = searchParams.get('force') === '1';

  if (!businessId) {
    return new Response('data: {"type":"error","message":"businessId required"}\n\n', {
      status: 400,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  const authResult = await verifyAuth(req);
  if (isAuthError(authResult)) return authResult;

  // Resolve sessionKey antecipadamente pra poder consultar sessions.get com
  // a chave correta antes de criar nova sessão.
  let sessionKey: string;
  if (connectionId) {
    sessionKey = connectionId;
  } else {
    const { ensurePrimaryBaileysBusinessConnection } = await import('@/lib/services/channels/channelConnections');
    sessionKey = (await ensurePrimaryBaileysBusinessConnection(businessId)).id;
  }

  // Get or create session (fresh = show QR)
  if (forceReconnect) {
    await destroySession(businessId, sessionKey);
  }
  let session = sessions.get(sessionKey);
  const isNewSession = !session;

  if (!session) {
    session = await createBaileysSession(businessId, 'fresh', sessionKey);
  }

  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController | null = null;
  let closed = false;

  const listener = (data: Record<string, unknown>) => {
    if (closed || !controllerRef) return;
    try {
      controllerRef.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      if (data.type === 'connected' || data.type === 'stream_end') {
        setTimeout(() => {
          if (!closed) {
            closed = true;
            try { controllerRef?.close(); } catch { /* ignore */ }
          }
        }, 500);
      }
    } catch {
      closed = true;
      session?.listeners.delete(listener);
    }
  };

  session.listeners.add(listener);

  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller;
      listener({ type: 'status', status: 'connecting' });

      if (!isNewSession && session!.lastQr) {
        listener({ type: 'qr', qr: session!.lastQr });
      }
      if (session!.isConnected) {
        const phone = session!.sock?.user?.id?.split(':')[0] || null;
        listener({ type: 'connected', phoneNumber: phone, status: 'connected' });
      }
    },
    cancel() {
      closed = true;
      session?.listeners.delete(listener);

      // CRÍTICO: passa sessionKey explicitamente. Antes era destroySession(businessId)
      // sem connectionId — destruía a primary business mesmo quando o user fechou
      // o modal de canal pessoal, sequestrando a sessão da empresa.
      if (session && session.listeners.size === 0 && !session.isConnected) {
        void destroySession(businessId, sessionKey);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
