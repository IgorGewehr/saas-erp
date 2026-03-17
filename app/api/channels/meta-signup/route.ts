import { NextRequest, NextResponse } from 'next/server';

/**
 * Meta Embedded Signup — Token Exchange
 *
 * Receives the `code` from the frontend after the user completes the
 * Facebook Login for Business (Embedded Signup) flow.
 *
 * Steps:
 * 1. Exchange the short-lived `code` for a long-lived System User Access Token.
 * 2. Fetch linked WABA and phone number details.
 * 3. Subscribe the WABA to webhooks.
 * 4. Return channel credentials for the frontend to persist.
 */

const META_GRAPH = 'https://graph.facebook.com/v21.0';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { code, businessId } = body;

    if (!code || !businessId) {
      return NextResponse.json({ error: 'Missing code or businessId' }, { status: 400 });
    }

    const appId = process.env.NEXT_PUBLIC_META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;

    if (!appId || !appSecret) {
      return NextResponse.json(
        { error: 'Meta app credentials not configured on server' },
        { status: 500 }
      );
    }

    // ── Step 1: Exchange code for access token ──────────────────────────────
    const tokenRes = await fetch(
      `${META_GRAPH}/oauth/access_token?` +
        new URLSearchParams({
          client_id: appId,
          client_secret: appSecret,
          code,
        }),
      { method: 'GET' }
    );

    if (!tokenRes.ok) {
      const err = await tokenRes.json();
      console.error('Token exchange failed:', err);
      return NextResponse.json(
        { error: 'Token exchange failed', details: err?.error?.message },
        { status: 400 }
      );
    }

    const tokenData = await tokenRes.json();
    const accessToken: string = tokenData.access_token;

    // ── Step 2: Get debug token info (to find WABA) ─────────────────────────
    const debugRes = await fetch(
      `${META_GRAPH}/debug_token?input_token=${accessToken}&access_token=${appId}|${appSecret}`
    );
    const debugData = await debugRes.json();

    // Extract granted scopes and WABA from the shared data
    const granularScopes = debugData?.data?.granular_scopes || [];

    // Find the WABA ID from the whatsapp_business_management scope
    let wabaId: string | null = null;
    for (const scope of granularScopes) {
      if (
        scope.scope === 'whatsapp_business_management' &&
        scope.target_ids?.length > 0
      ) {
        wabaId = scope.target_ids[0];
        break;
      }
    }

    // ── Step 3: Get WABA phone numbers ──────────────────────────────────────
    let phoneNumberId = '';
    let displayPhoneNumber = '';
    let displayName = '';

    if (wabaId) {
      const phonesRes = await fetch(
        `${META_GRAPH}/${wabaId}/phone_numbers`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const phonesData = await phonesRes.json();

      if (phonesData?.data?.length > 0) {
        const phone = phonesData.data[0];
        phoneNumberId = phone.id;
        displayPhoneNumber = phone.display_phone_number;
        displayName = phone.verified_name || phone.display_phone_number;
      }

      // ── Step 4: Subscribe WABA to webhooks ──────────────────────────────
      try {
        await fetch(`${META_GRAPH}/${wabaId}/subscribed_apps`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch (webhookErr) {
        console.warn('Webhook subscription warning:', webhookErr);
        // Non-fatal — the user can manually subscribe later
      }
    }

    // ── Step 5: Get Facebook Page info (for Messenger) ──────────────────────
    let pageId = '';
    let pageName = '';

    try {
      const pagesRes = await fetch(`${META_GRAPH}/me/accounts`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const pagesData = await pagesRes.json();

      if (pagesData?.data?.length > 0) {
        const page = pagesData.data[0];
        pageId = page.id;
        pageName = page.name;
      }
    } catch {
      // Pages are optional if the user only connected WhatsApp
    }

    // ── Step 6: Get Instagram Business Account ──────────────────────────────
    let igAccountId = '';

    if (pageId) {
      try {
        const igRes = await fetch(
          `${META_GRAPH}/${pageId}?fields=instagram_business_account`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const igData = await igRes.json();
        igAccountId = igData?.instagram_business_account?.id || '';
      } catch {
        // Instagram is optional
      }
    }

    // Return the credentials for the frontend to save to Firestore
    return NextResponse.json({
      success: true,
      channels: {
        whatsapp: wabaId
          ? {
              phoneNumberId,
              businessAccountId: wabaId,
              accessToken: Buffer.from(accessToken).toString('base64'),
              isConnected: true,
              wabaId,
              displayName,
              phoneNumber: displayPhoneNumber,
              tokenExpiresAt: null, // System user tokens don't expire
            }
          : null,
        facebook: pageId
          ? {
              pageId,
              pageAccessToken: Buffer.from(accessToken).toString('base64'),
              isConnected: true,
              pageName,
            }
          : null,
        instagram: igAccountId
          ? {
              accountId: igAccountId,
              isConnected: true,
            }
          : null,
        connectedVia: 'embedded_signup' as const,
      },
    });
  } catch (err) {
    console.error('Meta signup error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
