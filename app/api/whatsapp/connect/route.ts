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

  if (!businessId) {
    return new Response('data: {"type":"error","message":"businessId required"}\n\n', {
      status: 400,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  const authResult = await verifyAuth(req);
  if (isAuthError(authResult)) return authResult;

  // Get or create session (fresh = show QR)
  let session = sessions.get(businessId);
  const isNewSession = !session;

  if (!session) {
    session = await createBaileysSession(businessId, 'fresh');
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

      if (session && session.listeners.size === 0 && !session.isConnected) {
        destroySession(businessId);
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
