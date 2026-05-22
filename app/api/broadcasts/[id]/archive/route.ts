/**
 * POST /api/broadcasts/[id]/archive
 *
 * Marca um broadcast finalizado como 'archived' — esconde da lista
 * principal de campanhas sem apagar o historico. Permite restore via
 * unarchive (futuro) ou cleanup manual.
 *
 * Quem pode: operator+ (mesmo nivel de pause/resume — n e destrutivo).
 *
 * CAS-based: so transiciona se status atual e 'sent' ou 'failed'. Permite
 * arquivar 'failed' tambem pra limpar campanhas mal-sucedidas da lista.
 * Idempotente: re-chamar em 'archived' retorna ok sem mudar nada.
 *
 * Bloqueia status que ainda estao em "operacao" (draft, scheduled,
 * sending, paused) — arquivar com worker ativo confundiria a UI.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { Broadcast, UserRole } from '@/lib/types';

const ARCHIVABLE_STATUSES = new Set(['sent', 'failed']);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`archive:${clientIp}`, 20, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Aguarde antes de arquivar outra campanha.' }, { status: 429 });
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

    let alreadyArchived = false;
    let invalidStatus: string | undefined;
    try {
      await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(broadcastRef);
        if (!snap.exists) throw new Error('NOT_FOUND');
        const data = snap.data() as Broadcast;
        if (data.businessId !== businessId) throw new Error('FORBIDDEN');
        if (data.status === 'archived') {
          alreadyArchived = true;
          return;
        }
        if (!ARCHIVABLE_STATUSES.has(data.status)) {
          invalidStatus = data.status;
          return;
        }
        tx.update(broadcastRef, {
          status: 'archived',
          archivedAt: new Date().toISOString(),
          archivedBy: authResult.uid,
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
        error: `So e possivel arquivar campanhas finalizadas (sent/failed). Status atual: ${invalidStatus}`,
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      alreadyArchived,
      message: alreadyArchived
        ? 'Campanha ja estava arquivada.'
        : 'Campanha arquivada — escondida da lista principal.',
    });
  } catch (err) {
    console.error('[Broadcast archive] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
