import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get('slug')?.toLowerCase().trim();
  const excludeId = searchParams.get('businessId'); // own business — always available to itself

  if (!slug || slug.length < 2) {
    return NextResponse.json({ available: false, reason: 'too_short' });
  }
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) {
    return NextResponse.json({ available: false, reason: 'invalid_format' });
  }

  const snap = await adminDb
    .collection('businesses')
    .where('slug', '==', slug)
    .limit(1)
    .get();

  if (snap.empty) {
    return NextResponse.json({ available: true });
  }

  const taken = snap.docs[0].id;
  if (excludeId && taken === excludeId) {
    return NextResponse.json({ available: true }); // it's the same business re-saving its own slug
  }

  return NextResponse.json({ available: false, reason: 'taken' });
}
