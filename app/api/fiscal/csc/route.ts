/**
 * CSC (Código de Segurança do Contribuinte) — encrypt-and-save for NFC-e.
 *
 * POST: Receives plaintext CSC token, encrypts it, and saves to Firestore.
 * GET:  Returns decrypted CSC token for admin display in Settings.
 *
 * Admin+ only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { encryptToken, decryptToken } from '@/lib/utils/encryption';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { UserRole } from '@/lib/types';

async function checkAdmin(req: NextRequest, businessId: string) {
  const auth = await verifyAuth(req, businessId);
  if (isAuthError(auth)) return auth;
  if (ROLE_HIERARCHY[auth.role as UserRole] < ROLE_HIERARCHY['admin']) {
    return NextResponse.json({ error: 'admin role required' }, { status: 403 });
  }
  return auth;
}

export async function POST(req: NextRequest) {
  try {
    const { businessId, cscId, cscToken } = await req.json();
    if (!businessId) return NextResponse.json({ error: 'businessId required' }, { status: 400 });

    const auth = await checkAdmin(req, businessId);
    if (auth instanceof NextResponse) return auth;

    const encryptedToken = cscToken ? await encryptToken(cscToken) : undefined;

    const ref = adminDb.collection('businesses').doc(businessId);
    await ref.update({
      'fiscal.nfceConfig.cscId': cscId || null,
      'fiscal.nfceConfig.cscTokenEncrypted': encryptedToken || null,
      'fiscal.nfceConfig.cscToken': null, // Remove plaintext legacy field
      'fiscal.updatedAt': new Date().toISOString(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[fiscal/csc] POST error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const businessId = req.nextUrl.searchParams.get('businessId');
    if (!businessId) return NextResponse.json({ error: 'businessId required' }, { status: 400 });

    const auth = await checkAdmin(req, businessId);
    if (auth instanceof NextResponse) return auth;

    const snap = await adminDb.collection('businesses').doc(businessId).get();
    if (!snap.exists) return NextResponse.json({ cscId: '', cscToken: '' });

    const nfce = snap.data()?.fiscal?.nfceConfig;
    const cscId = nfce?.cscId || '';

    // Prefer encrypted field, fallback to legacy plaintext
    let cscToken = '';
    if (nfce?.cscTokenEncrypted) {
      cscToken = await decryptToken(nfce.cscTokenEncrypted);
    } else if (nfce?.cscToken) {
      cscToken = nfce.cscToken; // Legacy plaintext — will be migrated on next save
    }

    return NextResponse.json({ cscId, cscToken });
  } catch (err) {
    console.error('[fiscal/csc] GET error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
