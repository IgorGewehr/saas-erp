/**
 * POST /api/forms/submit
 *
 * Public endpoint — submits a form response.
 * Rate-limited by IP to prevent abuse.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';

export async function POST(req: NextRequest) {
  // Rate limit: 10 submissions per minute per IP
  const ip = getClientIp(req);
  const rl = checkRateLimit(`form-submit:${ip}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  let body: {
    templateId: string;
    clientId?: string;
    clientName?: string;
    appointmentId?: string;
    responses: Record<string, unknown>;
    submittedVia?: 'link' | 'operator' | 'booking';
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.templateId || !body.responses) {
    return NextResponse.json({ error: 'templateId and responses required' }, { status: 400 });
  }

  // Fetch template to validate and get businessId
  const templateDoc = await adminDb.collection('formTemplates').doc(body.templateId).get();
  if (!templateDoc.exists) {
    return NextResponse.json({ error: 'Form template not found' }, { status: 404 });
  }

  const template = templateDoc.data()!;
  if (!template.isActive) {
    return NextResponse.json({ error: 'Form is inactive' }, { status: 400 });
  }

  // Validate required fields
  const fields = (template.fields || []) as Array<{ id: string; label: string; required: boolean }>;
  for (const field of fields) {
    if (field.required) {
      const val = body.responses[field.id];
      if (val === undefined || val === null || val === '') {
        return NextResponse.json(
          { error: `Campo obrigatório: ${field.label}` },
          { status: 400 },
        );
      }
    }
  }

  const now = new Date().toISOString();

  const responseDoc = {
    businessId: template.businessId,
    templateId: body.templateId,
    templateName: template.name,
    clientId: body.clientId || null,
    clientName: body.clientName || null,
    appointmentId: body.appointmentId || null,
    responses: body.responses,
    submittedAt: now,
    submittedVia: body.submittedVia || 'link',
  };

  // M05.3 (R3): endpoint público sem auth, só rate-limit por IP — duplo-clique
  // do paciente preenchendo a ficha ou retry de rede legítimo criava uma
  // SEGUNDA resposta pro mesmo formulário. X-Idempotency-Key é opcional (não
  // quebra callers existentes que não mandam o header); quando presente,
  // deriva um doc ID determinístico e usa `.create()` — Firestore rejeita
  // atomicamente se já existe, mesmo padrão de markWebhookSeen/
  // createTransactionSafeAdmin já usados nesta sessão.
  const idempotencyKey = req.headers.get('x-idempotency-key')?.trim();
  if (idempotencyKey) {
    const safeKey = idempotencyKey.toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 200);
    const docId = `${template.businessId}_${safeKey}`;
    const ref = adminDb.collection('formResponses').doc(docId);
    try {
      await ref.create(responseDoc);
      return NextResponse.json({ ok: true, id: ref.id }, { status: 201 });
    } catch (err) {
      const code = (err as { code?: number | string })?.code;
      const isAlreadyExists = code === 6 || code === 'already-exists';
      if (!isAlreadyExists) throw err;
      const existing = await ref.get();
      return NextResponse.json({ ok: true, id: ref.id, ...existing.data() }, { status: 200 });
    }
  }

  const ref = await adminDb.collection('formResponses').add(responseDoc);

  return NextResponse.json({ ok: true, id: ref.id }, { status: 201 });
}
