/**
 * Certificate status — lightweight read used by the Fiscal settings tab to show
 * "configured / expires in N days / expired" states without downloading the PFX.
 *
 * Admin+ only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { FiscalCertificate, UserRole } from '@/lib/types';

export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId');
  if (!businessId) {
    return NextResponse.json({ error: 'businessId required' }, { status: 400 });
  }

  const auth = await verifyAuth(req, businessId);
  if (isAuthError(auth)) return auth;
  if (ROLE_HIERARCHY[auth.role as UserRole] < ROLE_HIERARCHY['admin']) {
    return NextResponse.json({ error: 'admin role required' }, { status: 403 });
  }

  const snap = await adminDb.collection('businesses').doc(businessId).get();
  if (!snap.exists) return NextResponse.json({ configured: false });
  const cert = snap.data()?.fiscal?.certificate as FiscalCertificate | undefined;
  const hasPassword = !!snap.data()?.fiscal?.certPasswordEncrypted;

  if (!cert || !cert.storagePath || !hasPassword) {
    return NextResponse.json({ configured: false });
  }

  const expiresAt = new Date(cert.expiresAt);
  const daysUntilExpiry = Math.floor((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  return NextResponse.json({
    configured: true,
    subject: cert.subject,
    issuer: cert.issuer,
    serialNumber: cert.serialNumber,
    thumbprint: cert.thumbprint,
    validFrom: cert.validFrom,
    expiresAt: cert.expiresAt,
    daysUntilExpiry,
    isExpired: daysUntilExpiry < 0,
    isExpiringSoon: daysUntilExpiry >= 0 && daysUntilExpiry <= 30,
  });
}
