/**
 * Delete the business's digital certificate.
 *
 * Admin-only. Removes the PFX from Storage and clears the metadata fields in
 * businesses/{id}.fiscal. The encrypted password is also cleared so it can't
 * be decrypted against a future (different) PFX accidentally.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminStorage } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { invalidateCertCache } from '@/lib/fiscal/certificate-manager';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { UserRole } from '@/lib/types';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(req: NextRequest) {
  try {
    const { businessId } = await req.json();
    if (!businessId || typeof businessId !== 'string') {
      return NextResponse.json({ error: 'businessId required' }, { status: 400 });
    }

    const auth = await verifyAuth(req, businessId);
    if (isAuthError(auth)) return auth;
    if (ROLE_HIERARCHY[auth.role as UserRole] < ROLE_HIERARCHY['admin']) {
      return NextResponse.json(
        { error: 'Apenas administradores podem remover o certificado.' },
        { status: 403 },
      );
    }

    // Load current fiscal to get storagePath
    const snap = await adminDb.collection('businesses').doc(businessId).get();
    if (!snap.exists) return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    const storagePath = (snap.data()?.fiscal?.certificate?.storagePath as string | undefined)
      || `businesses/${businessId}/certificates/cert.pfx`;

    // Remove from Storage (tolerate already-deleted file)
    try {
      await adminStorage.bucket().file(storagePath).delete({ ignoreNotFound: true });
    } catch (err) {
      console.warn('[cert-delete] storage delete failed (non-fatal):', err);
    }

    // Clear Firestore fields
    await adminDb.collection('businesses').doc(businessId).update({
      'fiscal.certificate': FieldValue.delete(),
      'fiscal.certPasswordEncrypted': FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    invalidateCertCache(businessId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[cert-delete] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
