/**
 * GET /api/forms/template?id=xxx
 *
 * Public endpoint — returns a form template by ID.
 * Only returns active templates with non-sensitive fields.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const doc = await adminDb.collection('formTemplates').doc(id).get();
  if (!doc.exists) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 });
  }

  const data = doc.data()!;
  if (!data.isActive) {
    return NextResponse.json({ error: 'Form is inactive' }, { status: 404 });
  }

  // Return only public-safe fields
  return NextResponse.json({
    ok: true,
    data: {
      id: doc.id,
      name: data.name,
      description: data.description || null,
      fields: data.fields || [],
    },
  });
}
