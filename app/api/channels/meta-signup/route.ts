import { NextRequest, NextResponse } from 'next/server';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { encryptToken } from '@/lib/utils/encryption';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';

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
 * 4. Save encrypted channel credentials directly to Firestore (server-side).
 * 5. Return channel info (without tokens) to frontend.
 */

const META_GRAPH = 'https://graph.facebook.com/v21.0';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { code, businessId } = body;

    if (!code || !businessId) {
      return NextResponse.json({ error: 'Missing code or businessId' }, { status: 400 });
    }

    // Verify user is authenticated and belongs to this business
    const authResult = await verifyAuth(req, businessId);
    if (isAuthError(authResult)) return authResult;

    // authResult.uid, authResult.businessId, authResult.role are now available
    const ROLE_HIERARCHY: Record<string, number> = { founder: 100, admin: 80, manager: 60, operator: 40, viewer: 20 };
    if ((ROLE_HIERARCHY[authResult.role] || 0) < ROLE_HIERARCHY['admin']) {
      return NextResponse.json({ error: 'Forbidden — admin role required' }, { status: 403 });
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

    // Exchange short-lived token for long-lived token (60 days)
    let longLivedToken = accessToken;
    let tokenExpiresAt: string | null = null;

    try {
      const exchangeRes = await fetch(
        `${META_GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${accessToken}`
      );

      if (exchangeRes.ok) {
        const exchangeData = await exchangeRes.json();
        if (exchangeData.access_token) {
          longLivedToken = exchangeData.access_token;
          // Meta returns expires_in in seconds (typically 5184000 = 60 days)
          if (exchangeData.expires_in) {
            tokenExpiresAt = new Date(Date.now() + exchangeData.expires_in * 1000).toISOString();
          }
          console.log('[Meta Signup] Exchanged for long-lived token, expires:', tokenExpiresAt);
        }
      } else {
        console.warn('[Meta Signup] Could not exchange for long-lived token, using short-lived');
        // Short-lived token expires in ~1 hour
        tokenExpiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
      }
    } catch (exchangeErr) {
      console.warn('[Meta Signup] Token exchange error:', exchangeErr);
      tokenExpiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
    }

    // ── Step 2: Get debug token info (to find WABA) ─────────────────────────
    const debugRes = await fetch(
      `${META_GRAPH}/debug_token?input_token=${longLivedToken}&access_token=${appId}|${appSecret}`
    );

    if (!debugRes.ok) {
      console.error('[Meta Signup] debug_token failed:', await debugRes.text());
      return NextResponse.json({ error: 'Failed to validate token with Meta' }, { status: 502 });
    }

    const debugData = await debugRes.json();

    // Extract granted scopes and WABA from the shared data
    const granularScopes = debugData?.data?.granular_scopes || [];

    // Validate required scopes
    const hasRequiredScopes = granularScopes.some(
      (s: { scope: string }) => ['whatsapp_business_management', 'pages_messaging'].includes(s.scope)
    );
    if (!hasRequiredScopes) {
      return NextResponse.json({
        error: 'Permissoes insuficientes. Certifique-se de autorizar todos os escopos solicitados.'
      }, { status: 400 });
    }

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
        { headers: { Authorization: `Bearer ${longLivedToken}` } }
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
          headers: { Authorization: `Bearer ${longLivedToken}` },
        });
      } catch (webhookErr) {
        console.warn('Webhook subscription warning:', webhookErr);
        // Non-fatal — the user can manually subscribe later
      }
    }

    // ── Step 5: Get Facebook Page info (for Messenger) ──────────────────────
    let pageId = '';
    let pageName = '';
    let pageAccessToken = '';

    try {
      const pagesRes = await fetch(`${META_GRAPH}/me/accounts`, {
        headers: { Authorization: `Bearer ${longLivedToken}` },
      });

      if (!pagesRes.ok) {
        console.error('[Meta Signup] /me/accounts failed:', await pagesRes.text());
      } else {
        const pagesData = await pagesRes.json();

        if (pagesData?.data?.length > 0) {
          const page = pagesData.data[0];
          pageId = page.id;
          pageName = page.name;
          pageAccessToken = page.access_token || '';
        }
      }
    } catch {
      // Pages are optional if the user only connected WhatsApp
    }

    // ── Step 6: Get Instagram Business Account ──────────────────────────────
    let igAccountId = '';
    let igAccountName = '';

    if (pageId) {
      try {
        const igRes = await fetch(
          `${META_GRAPH}/${pageId}?fields=instagram_business_account`,
          { headers: { Authorization: `Bearer ${longLivedToken}` } }
        );

        if (!igRes.ok) {
          console.error('[Meta Signup] Instagram fetch failed:', await igRes.text());
        } else {
          const igData = await igRes.json();
          igAccountId = igData?.instagram_business_account?.id || '';
        }
      } catch {
        // Instagram is optional
      }
    }

    // ── Step 7: Save channels directly to Firestore with encrypted tokens ───
    const channelUpdates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    if (wabaId && phoneNumberId) {
      channelUpdates['channels.whatsapp'] = {
        phoneNumberId,
        businessAccountId: wabaId,
        accessToken: await encryptToken(longLivedToken),
        isConnected: true,
        connectedAt: new Date().toISOString(),
        wabaId,
        displayName: displayName || null,
        displayPhoneNumber: displayPhoneNumber || null,
        tokenExpiresAt,
      };
    }

    if (pageId) {
      channelUpdates['channels.facebook'] = {
        pageId,
        pageName: pageName || null,
        pageAccessToken: await encryptToken(pageAccessToken || longLivedToken),
        isConnected: true,
        connectedAt: new Date().toISOString(),
      };
    }

    if (igAccountId) {
      channelUpdates['channels.instagram'] = {
        accountId: igAccountId,
        accountName: igAccountName || null,
        isConnected: true,
        connectedAt: new Date().toISOString(),
      };
    }

    channelUpdates['channels.connectedVia'] = 'embedded_signup';

    // ── Check uniqueness of channel identifiers before saving ─────────────
    if (phoneNumberId) {
      const existingWa = await adminDb.collection('businesses')
        .where('channels.whatsapp.phoneNumberId', '==', phoneNumberId)
        .where('channels.whatsapp.isConnected', '==', true)
        .limit(1)
        .get();

      if (!existingWa.empty && existingWa.docs[0].id !== businessId) {
        return NextResponse.json({
          error: `Este numero do WhatsApp ja esta conectado a outra empresa. Desconecte-o primeiro.`,
        }, { status: 409 });
      }
    }

    if (pageId) {
      const existingFb = await adminDb.collection('businesses')
        .where('channels.facebook.pageId', '==', pageId)
        .where('channels.facebook.isConnected', '==', true)
        .limit(1)
        .get();

      if (!existingFb.empty && existingFb.docs[0].id !== businessId) {
        return NextResponse.json({
          error: `Esta pagina do Facebook ja esta conectada a outra empresa. Desconecte-a primeiro.`,
        }, { status: 409 });
      }
    }

    if (igAccountId) {
      const existingIg = await adminDb.collection('businesses')
        .where('channels.instagram.accountId', '==', igAccountId)
        .where('channels.instagram.isConnected', '==', true)
        .limit(1)
        .get();

      if (!existingIg.empty && existingIg.docs[0].id !== businessId) {
        return NextResponse.json({
          error: `Esta conta do Instagram ja esta conectada a outra empresa. Desconecte-a primeiro.`,
        }, { status: 409 });
      }
    }

    // Save to Firestore server-side
    await updateDoc(doc(db, 'businesses', businessId), channelUpdates);

    // Return channel info WITHOUT tokens
    return NextResponse.json({
      success: true,
      channels: {
        whatsapp: wabaId
          ? {
              phoneNumberId,
              businessAccountId: wabaId,
              isConnected: true,
              displayPhoneNumber: displayPhoneNumber || phoneNumberId,
              displayName: displayName || null,
            }
          : null,
        facebook: pageId
          ? {
              pageId,
              pageName: pageName || null,
              isConnected: true,
            }
          : null,
        instagram: igAccountId
          ? {
              accountId: igAccountId,
              accountName: igAccountName || null,
              isConnected: true,
            }
          : null,
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
