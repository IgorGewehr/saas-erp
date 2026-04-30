/**
 * DELETE /api/broadcast-lists/[id]
 *
 * Apaga uma lista reusável de recipientes. Não afeta broadcasts já criados —
 * Broadcast.recipients é cópia, não referência.
 *
 * Auth: Bearer token. Role mínimo: operator. Tenant isolation via businessId.
 *
 * Body: { businessId: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { BroadcastList, UserRole } from '@/lib/types';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`broadcast-lists-delete:${clientIp}`, 30, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const businessId = typeof body.businessId === 'string' ? body.businessId : '';
  if (!businessId) {
    return NextResponse.json({ error: 'businessId is required in body' }, { status: 400 });
  }

  const authResult = await verifyAuth(req, businessId);
  if (isAuthError(authResult)) return authResult;

  const role = authResult.role as UserRole;
  if ((ROLE_HIERARCHY[role] || 0) < ROLE_HIERARCHY['operator']) {
    return NextResponse.json({ error: 'Forbidden — operator role required' }, { status: 403 });
  }

  try {
    const ref = adminDb.collection('broadcastLists').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      // Idempotente — apagar lista que não existe não é erro
      return NextResponse.json({ ok: true, alreadyDeleted: true });
    }
    const list = snap.data() as BroadcastList;
    if (list.businessId !== businessId) {
      return NextResponse.json({ error: 'Forbidden — business mismatch' }, { status: 403 });
    }

    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[broadcast-lists DELETE] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
