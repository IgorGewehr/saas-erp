/**
 * POST /api/broadcasts/[id]/cancel-schedule
 *
 * Cancela o agendamento de uma campanha em status='scheduled', voltando-a
 * para 'draft' e removendo `scheduledAt`.
 *
 * Por que precisa de endpoint dedicado em vez de updateDoc client-side:
 *  - Há corrida com /api/broadcasts/process-scheduled (cron). O cron faz
 *    CAS scheduled→sending; se o updateDoc do cliente rodar em paralelo,
 *    pode acontecer:
 *      1) Cron lê status='scheduled', começa CAS
 *      2) Cliente faz update status='draft'
 *      3) CAS aplica update status='sending' por cima do 'draft'
 *      → Worker dispara campanha que o operador acabou de cancelar.
 *  - Esse endpoint usa runTransaction com guard `status === 'scheduled'`
 *    pra fechar a janela completamente.
 *
 * Operator+ (qualquer um que pode disparar pode cancelar).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { Broadcast, UserRole } from '@/lib/types';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`cancel-schedule:${clientIp}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Aguarde antes de cancelar outro agendamento.' }, { status: 429 });
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

    let invalidStatus: string | undefined;
    try {
      await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(broadcastRef);
        if (!snap.exists) throw new Error('NOT_FOUND');
        const data = snap.data() as Broadcast;
        if (data.businessId !== businessId) throw new Error('FORBIDDEN');
        if (data.status !== 'scheduled') {
          invalidStatus = data.status;
          return;
        }
        const { FieldValue } = await import('firebase-admin/firestore');
        tx.update(broadcastRef, {
          status: 'draft',
          scheduledAt: FieldValue.delete(),
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
        error: `Só é possível cancelar agendamento de campanhas em 'scheduled'. Status atual: ${invalidStatus}`,
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: 'Agendamento cancelado.',
    });
  } catch (err) {
    console.error('[Broadcast cancel-schedule] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
