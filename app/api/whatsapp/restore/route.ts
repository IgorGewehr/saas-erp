/**
 * WhatsApp Session Restore
 *
 * POST /api/whatsapp/restore
 *   Body: { businessId: string }
 *
 * Called once on frontend login to restore Baileys sessions
 * that were connected before the server restarted.
 *
 * Only restores if:
 *   1. The session files exist on disk (whatsapp-sessions/{businessId}/)
 *   2. The session is NOT already in the in-memory Map
 *   3. The business has channels.whatsapp.isConnected: true in Firestore
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import {
  sessions,
  createBaileysSession,
  SESSIONS_DIR,
} from '../baileys-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // Verify auth
  const authResult = await verifyAuth(req);
  if (isAuthError(authResult)) return authResult;

  let businessId: string;
  try {
    const body = await req.json();
    businessId = body.businessId;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (!businessId) {
    return NextResponse.json({ error: 'businessId required' }, { status: 400 });
  }

  // Already running — nothing to do
  if (sessions.has(businessId)) {
    const session = sessions.get(businessId)!;
    return NextResponse.json({
      status: 'already_active',
      isConnected: session.isConnected,
    });
  }

  // Check if session files exist on disk
  const sessionDir = path.join(SESSIONS_DIR, businessId);
  const hasSessionFiles = fs.existsSync(sessionDir) &&
    fs.readdirSync(sessionDir).some((f) => f.endsWith('.json'));

  if (!hasSessionFiles) {
    return NextResponse.json({
      status: 'no_session',
      message: 'No session files found on disk',
    });
  }

  // Restore session silently (reuse existing auth files, no QR needed)
  try {
    console.log(`[Baileys Restore] Restaurando sessao para business: ${businessId}`);
    await createBaileysSession(businessId, 'restore');

    return NextResponse.json({
      status: 'restored',
      message: 'Session restored successfully',
    });
  } catch (err) {
    console.error('[Baileys Restore] Falha ao restaurar sessao:', err);
    return NextResponse.json({
      status: 'error',
      message: 'Failed to restore session',
    }, { status: 500 });
  }
}
