import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import type { ApiKeyScope } from '@/lib/types';

export interface ApiKeyAuthResult {
  businessId: string;
  keyId: string;
  scopes: ApiKeyScope[];
}

async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Authenticates a request using an API key.
 *
 * The key is expected in the `Authorization: Bearer sp_live_...` header
 * or in the `x-api-key` header.
 *
 * Validates: key exists, is active, not expired, and has required scopes.
 */
export async function verifyApiKey(
  req: NextRequest,
  requiredScopes: ApiKeyScope[] = [],
): Promise<ApiKeyAuthResult | NextResponse> {
  // Extract key from Authorization header or x-api-key header
  let apiKey: string | null = null;

  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer sp_')) {
    apiKey = authHeader.split('Bearer ')[1];
  }

  if (!apiKey) {
    apiKey = req.headers.get('x-api-key');
  }

  if (!apiKey || !apiKey.startsWith('sp_live_')) {
    return NextResponse.json(
      { error: 'Unauthorized — missing or invalid API key. Expected format: sp_live_...' },
      { status: 401 },
    );
  }

  try {
    const keyHash = await hashApiKey(apiKey);

    // Look up key by hash
    const snapshot = await adminDb
      .collection('saasApiKeys')
      .where('keyHash', '==', keyHash)
      .where('status', '==', 'active')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json(
        { error: 'Unauthorized — API key not found or revoked' },
        { status: 401 },
      );
    }

    const keyDoc = snapshot.docs[0];
    const keyData = keyDoc.data();

    // Check expiration
    if (keyData.expiresAt) {
      const expiresAt = new Date(keyData.expiresAt);
      if (expiresAt < new Date()) {
        return NextResponse.json(
          { error: 'Unauthorized — API key expired' },
          { status: 401 },
        );
      }
    }

    const scopes = (keyData.scopes || []) as ApiKeyScope[];
    const hasAdmin = scopes.includes('admin:all');

    // Check required scopes
    if (requiredScopes.length > 0 && !hasAdmin) {
      const missing = requiredScopes.filter(s => !scopes.includes(s));
      if (missing.length > 0) {
        return NextResponse.json(
          {
            error: `Forbidden — missing scopes: ${missing.join(', ')}`,
            requiredScopes: missing,
            yourScopes: scopes,
          },
          { status: 403 },
        );
      }
    }

    // Update lastUsedAt (fire-and-forget, don't block response)
    keyDoc.ref.update({ lastUsedAt: new Date().toISOString() }).catch(() => {});

    return {
      businessId: keyData.businessId as string,
      keyId: keyDoc.id,
      scopes,
    };
  } catch (err) {
    console.error('[ApiKeyAuth] Verification failed:', err);
    return NextResponse.json(
      { error: 'Internal server error during authentication' },
      { status: 500 },
    );
  }
}

/**
 * Type guard to check if verifyApiKey returned an error response.
 */
export function isApiKeyError(result: ApiKeyAuthResult | NextResponse): result is NextResponse {
  return result instanceof NextResponse;
}

/**
 * Helper: checks if the authenticated key has a given scope (or admin:all).
 */
export function hasScope(auth: ApiKeyAuthResult, scope: ApiKeyScope): boolean {
  return auth.scopes.includes('admin:all') || auth.scopes.includes(scope);
}

/**
 * Standard JSON error response helper.
 */
export function apiError(message: string, status: number, details?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...details }, { status });
}

/**
 * Standard JSON success response helper.
 */
export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}
