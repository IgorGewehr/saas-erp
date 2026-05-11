/**
 * app/api/events/dispatch/route.ts
 *
 * Ponte do client SDK → dispatcher server-side de DomainEvent.
 *
 * Frontend (AgendaModule, etc.) chama:
 *   await fetch('/api/events/dispatch', {
 *     method: 'POST',
 *     headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
 *     body: JSON.stringify(event),
 *   });
 *
 * Server:
 *   1. Valida ID token Firebase → resolve uid + businessId
 *   2. Sobrescreve event.businessId pelo do user (impede tenant spoofing)
 *   3. Sobrescreve actorType/actorId quando ausentes
 *   4. Chama dispatchDomainEvent
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminAuth } from '@/lib/config/firebaseAdmin';
import { dispatchDomainEvent } from '@/contracts/_runtime/dispatch';
import { ensureDomainEventHandlers } from '@/contracts/_runtime/handlers';
import { DomainEventSchema } from '@/contracts/events';

// Garante handlers registrados antes do primeiro dispatch (idempotente).
ensureDomainEventHandlers();

export async function POST(req: NextRequest) {
  // ── Auth via Firebase ID token ───────────────────────────────────────────
  const authHeader = req.headers.get('authorization') || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) {
    return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Bearer token Firebase obrigatório' } }, { status: 401 });
  }

  let decoded: { uid: string };
  try {
    decoded = await adminAuth.verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Token inválido' } }, { status: 401 });
  }

  const userSnap = await adminDb.collection('users').doc(decoded.uid).get();
  if (!userSnap.exists) {
    return NextResponse.json({ ok: false, error: { code: 'NOT_FOUND', message: 'User não encontrado' } }, { status: 404 });
  }
  const userData = userSnap.data() as { businessId?: string; name?: string };
  if (!userData.businessId) {
    return NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'User sem businessId' } }, { status: 403 });
  }

  // ── Body ─────────────────────────────────────────────────────────────────
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== 'object') {
    return NextResponse.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'JSON body obrigatório' } }, { status: 400 });
  }

  // Tenant guard: forçar businessId do user (não confiar no que vem do cliente)
  const event = {
    ...(raw as Record<string, unknown>),
    businessId: userData.businessId,
    actorType: 'user',
    actorId: decoded.uid,
    occurredAt: (raw as { occurredAt?: string }).occurredAt ?? new Date().toISOString(),
  };

  const parsed = DomainEventSchema.safeParse(event);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Evento inválido', details: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  try {
    const result = await dispatchDomainEvent(adminDb, parsed.data);
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    console.error('[events/dispatch] erro:', err);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL', message: err instanceof Error ? err.message : 'Erro interno' } },
      { status: 500 },
    );
  }
}
