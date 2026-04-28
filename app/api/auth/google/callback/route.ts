/**
 * GET /api/auth/google/callback
 *
 * Google OAuth2 callback — exchanges code for tokens, encrypts and stores
 * them in Firestore calendarSyncTokens/{uid}, then redirects back to the app.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { encryptToken } from '@/lib/utils/encryption';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  const error = searchParams.get('error');

  const origin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
  const appUrl = `${origin}/app`;

  if (error) {
    console.error('[Google OAuth] Error:', error);
    return NextResponse.redirect(`${appUrl}?gcal_error=${error}`);
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(`${appUrl}?gcal_error=missing_params`);
  }

  let state: { uid: string; businessId: string };
  try {
    state = JSON.parse(Buffer.from(stateParam, 'base64url').toString());
  } catch {
    return NextResponse.redirect(`${appUrl}?gcal_error=invalid_state`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${appUrl}?gcal_error=not_configured`);
  }

  const redirectUri = `${origin}/api/auth/google/callback`;

  try {
    // Exchange code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('[Google OAuth] Token exchange failed:', err);
      return NextResponse.redirect(`${appUrl}?gcal_error=token_exchange`);
    }

    const tokens = await tokenRes.json();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (tokens.expires_in || 3600) * 1000).toISOString();

    // Encrypt tokens before storing
    const encAccessToken = await encryptToken(tokens.access_token);
    const encRefreshToken = tokens.refresh_token
      ? await encryptToken(tokens.refresh_token)
      : null;

    // Store in calendarSyncTokens/{uid}
    const docRef = adminDb.collection('calendarSyncTokens').doc(state.uid);
    const existing = await docRef.get();

    const data = {
      uid: state.uid,
      businessId: state.businessId,
      provider: 'google',
      accessToken: encAccessToken,
      ...(encRefreshToken ? { refreshToken: encRefreshToken } : {}),
      expiresAt,
      calendarId: 'primary',
      isActive: true,
      ...(existing.exists ? {} : { connectedAt: now.toISOString() }),
      lastSyncAt: null,
    };

    await docRef.set(data, { merge: true });

    return NextResponse.redirect(`${appUrl}?gcal_connected=true`);
  } catch (err) {
    console.error('[Google OAuth] Callback error:', err);
    return NextResponse.redirect(`${appUrl}?gcal_error=internal`);
  }
}
