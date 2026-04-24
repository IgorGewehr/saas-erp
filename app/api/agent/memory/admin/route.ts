/**
 * Agent memory admin endpoint — Firebase session auth.
 *
 * UI-facing counterpart to `/api/agent/tools/memory` (HMAC, agent-only).
 * Lets the dashboard show what the agent remembers about a contact and
 * supports LGPD requests (remove/clear memory).
 *
 * GET  /api/agent/memory/admin?contactId=X        → returns MemoryDoc | null
 * DELETE /api/agent/memory/admin?contactId=X&factId=Y  → remove one fact
 * DELETE /api/agent/memory/admin?contactId=X      → clear all memory for that contact
 *
 * Role: operator+ can read; manager+ required for destructive operations
 * (clear/forget) to protect against accidental wipes.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { getMemory, removeFact, clearMemory } from '@/lib/rag/memory';

const ROLE_HIERARCHY: Record<string, number> = {
  founder: 100, admin: 80, manager: 60, operator: 40, viewer: 20,
};

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (isAuthError(auth)) return auth;
  const { businessId, role } = auth;

  if ((ROLE_HIERARCHY[role] || 0) < ROLE_HIERARCHY.operator) {
    return NextResponse.json({ ok: false, error: 'Role forbidden' }, { status: 403 });
  }

  const contactId = req.nextUrl.searchParams.get('contactId');
  if (!contactId) {
    return NextResponse.json({ ok: false, error: 'contactId required' }, { status: 400 });
  }

  const doc = await getMemory(businessId, contactId);
  const now = new Date().toISOString();
  const facts = (doc?.facts || []).filter((f) => !f.validUntil || f.validUntil > now);

  return NextResponse.json({
    ok: true,
    data: {
      contactId,
      facts,
      version: doc?.version || 0,
      updatedAt: doc?.updatedAt,
    },
  });
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (isAuthError(auth)) return auth;
  const { businessId, role } = auth;

  if ((ROLE_HIERARCHY[role] || 0) < ROLE_HIERARCHY.manager) {
    return NextResponse.json({ ok: false, error: 'Role forbidden — manager+ required' }, { status: 403 });
  }

  const contactId = req.nextUrl.searchParams.get('contactId');
  if (!contactId) {
    return NextResponse.json({ ok: false, error: 'contactId required' }, { status: 400 });
  }

  const factId = req.nextUrl.searchParams.get('factId');
  try {
    if (factId) {
      const removed = await removeFact(businessId, contactId, factId);
      return NextResponse.json({ ok: true, data: { removed } });
    }
    await clearMemory(businessId, contactId);
    return NextResponse.json({ ok: true, data: { cleared: true } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
