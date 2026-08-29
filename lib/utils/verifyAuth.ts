import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/config/firebaseAdmin';

interface AuthResult {
  uid: string;
  businessId: string;
  role: string;
  name: string;
  commissionRate: number;
}

/**
 * Verifies Firebase Auth token and returns user info.
 * Use in API routes that require authentication.
 *
 * @param req - Next.js request
 * @param requireBusinessId - If provided, validates the user belongs to this business
 * @returns AuthResult on success, NextResponse (error) on failure
 */
export async function verifyAuth(
  req: NextRequest,
  requireBusinessId?: string,
): Promise<AuthResult | NextResponse> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized — missing token' }, { status: 401 });
  }

  const idToken = authHeader.split('Bearer ')[1];
  if (!idToken) {
    return NextResponse.json({ error: 'Unauthorized — empty token' }, { status: 401 });
  }

  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    const uid = decoded.uid;

    // Fetch user profile to get businessId and role
    const userDoc = await adminDb.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 403 });
    }

    const userData = userDoc.data()!;
    const businessId = userData.businessId as string;
    const role = (userData.role as string) || 'viewer';
    const name = (userData.name as string) || (userData.displayName as string) || 'Usuário';
    const commissionRate = typeof userData.commissionRate === 'number'
      && Number.isFinite(userData.commissionRate)
      && userData.commissionRate >= 0
      && userData.commissionRate <= 100
      ? userData.commissionRate
      : 0;

    if (!businessId) {
      return NextResponse.json({ error: 'User has no business assigned' }, { status: 403 });
    }

    // If a specific businessId is required, verify ownership
    if (requireBusinessId && businessId !== requireBusinessId) {
      return NextResponse.json({ error: 'Forbidden — business mismatch' }, { status: 403 });
    }

    return { uid, businessId, role, name, commissionRate };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token verification failed';
    console.error('[Auth] Token verification failed:', message);
    return NextResponse.json({ error: 'Unauthorized — invalid token' }, { status: 401 });
  }
}

/**
 * Type guard to check if verifyAuth returned an error response.
 */
export function isAuthError(result: AuthResult | NextResponse): result is NextResponse {
  return result instanceof NextResponse;
}
