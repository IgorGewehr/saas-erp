/**
 * GET /api/auth/google/connect?uid=xxx&businessId=yyy
 *
 * Redirects the user to Google's OAuth2 consent screen.
 * After consent, Google redirects back to /api/auth/google/callback.
 */

import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'Google OAuth not configured' }, { status: 500 });
  }

  const { searchParams } = req.nextUrl;
  const uid = searchParams.get('uid');
  const businessId = searchParams.get('businessId');

  if (!uid || !businessId) {
    return NextResponse.json({ error: 'uid and businessId required' }, { status: 400 });
  }

  // Build callback URL dynamically
  const origin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/google/callback`;

  const state = Buffer.from(JSON.stringify({ uid, businessId })).toString('base64url');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  return NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
}
