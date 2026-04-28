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

  const ref = await adminDb.collection('formResponses').add(responseDoc);

  return NextResponse.json({ ok: true, id: ref.id });
}
