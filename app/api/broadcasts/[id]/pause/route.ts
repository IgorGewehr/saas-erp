/**
 * POST /api/broadcasts/[id]/pause
 *
 * Marca um broadcast em envio como 'paused'. O loop em /api/broadcasts/send
 * detecta a mudança via isPausedFresh() (cache TTL 3s) e interrompe na
 * próxima iteração — mensagens já enfileiradas concluem, demais ficam
 * pendentes para o operador retomar via /resume.
 *
 * Operator+ (operadores podem pausar pra emergências). Admin pode tudo.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { Broadcast, UserRole } from '@/lib/types';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`pause:${clientIp}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Aguarde antes de pausar outra campanha.' }, { status: 429 });
  }

  try {
    const { id: broadcastId } = await ctx.params;
    if (!broadcastId) {
      return NextResponse.json({ error: 'broadcastId is required' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const businessId = body.businessId as string | undefined;
    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required in body' }, { status: 400 });
    }

    const authResult = await verifyAuth(req, businessId);
    if (isAuthError(authResult)) return authResult;

    const role = authResult.role as UserRole;
    if ((ROLE_HIERARCHY[role] || 0) < ROLE_HIERARCHY['operator']) {
      return NextResponse.json({ error: 'Forbidden — operator role required' }, { status: 403 });
    }

    const broadcastRef = adminDb.collection('broadcasts').doc(broadcastId);

    // CAS: só pausa se ainda está em sending. Idempotente — se já paused, retorna ok.
    let alreadyPaused = false;
    let invalidStatus: string | undefined;
    try {
      await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(broadcastRef);
        if (!snap.exists) throw new Error('NOT_FOUND');
        const data = snap.data() as Broadcast;
        if (data.businessId !== businessId) throw new Error('FORBIDDEN');
        if (data.status === 'paused') {
          alreadyPaused = true;
          return;
        }
        if (data.status !== 'sending') {
          invalidStatus = data.status;
          return;
        }
        tx.update(broadcastRef, {
          status: 'paused',
          updatedAt: new Date().toISOString(),
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      if (msg === 'NOT_FOUND') return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 });
      if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      throw err;
    }

    if (invalidStatus) {
      return NextResponse.json({
        error: `Só é possível pausar broadcasts em envio. Status atual: ${invalidStatus}`,
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      alreadyPaused,
      message: alreadyPaused
        ? 'Campanha já estava pausada.'
        : 'Pausa solicitada — o envio para nas próximas mensagens (até 3s).',
    });
  } catch (err) {
    console.error('[Broadcast pause] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
