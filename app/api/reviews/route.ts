/**
 * Reviews API
 *
 * POST /api/reviews — submit a review (public, rate-limited)
 * GET  /api/reviews?businessId=xxx — list reviews (authenticated)
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';

export async function POST(req: NextRequest) {
  // Rate limit: 5 reviews per hour per IP
  const ip = getClientIp(req);
  const rl = checkRateLimit(`review-submit:${ip}`, 5, 60 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  let body: {
    businessId: string;
    clientName?: string;
    professionalId?: string;
    professionalName?: string;
    serviceId?: string;
    serviceName?: string;
    appointmentId?: string;
    rating: number;
    comment?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.businessId || !body.rating || body.rating < 1 || body.rating > 5) {
    return NextResponse.json({ error: 'businessId and rating (1-5) required' }, { status: 400 });
  }

  // Verify business exists
  const bizDoc = await adminDb.collection('businesses').doc(body.businessId).get();
  if (!bizDoc.exists) {
    return NextResponse.json({ error: 'Business not found' }, { status: 404 });
  }

  const now = new Date().toISOString();

  const review = {
    businessId: body.businessId,
    clientName: body.clientName || null,
    professionalId: body.professionalId || null,
    professionalName: body.professionalName || null,
    serviceId: body.serviceId || null,
    serviceName: body.serviceName || null,
    appointmentId: body.appointmentId || null,
    rating: Math.round(body.rating),
    comment: body.comment?.trim() || null,
    source: 'internal' as const,
    createdAt: now,
  };

  const ref = await adminDb.collection('reviews').add(review);

  return NextResponse.json({ ok: true, id: ref.id });
}

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (isAuthError(auth)) return auth;

  const snap = await adminDb.collection('reviews')
    .where('businessId', '==', auth.businessId)
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get();

  const reviews = snap.docs.map(d => ({ ...d.data(), id: d.id }));

  return NextResponse.json({ ok: true, data: reviews });
}
