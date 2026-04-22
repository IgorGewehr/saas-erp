import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { encryptToken } from '@/lib/utils/encryption';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY } from '@/lib/types';

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
    // Support both flows: accessToken (JS SDK) or code (server-side)
    const { accessToken: shortLivedToken, code, businessId } = body;

    if ((!shortLivedToken && !code) || !businessId) {
      return NextResponse.json({ error: 'Missing accessToken/code or businessId' }, { status: 400 });
    }

    // Verify user is authenticated and belongs to this business
    const authResult = await verifyAuth(req, businessId);
    if (isAuthError(authResult)) return authResult;

    if ((ROLE_HIERARCHY[authResult.role as keyof typeof ROLE_HIERARCHY] || 0) < ROLE_HIERARCHY['admin']) {
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

    // ── Step 1: Get short-lived access token ────────────────────────────────
    let accessToken: string;

    if (shortLivedToken) {
      // JS SDK flow — token already provided by frontend
      accessToken = shortLivedToken;
    } else {
      // Legacy code flow (fallback)
      const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://localhost:3000';
      const redirectUri = origin.endsWith('/') ? origin : `${origin}/`;
      const tokenRes = await fetch(
        `${META_GRAPH}/oauth/access_token?` +
          new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code: code! }),
        { method: 'GET' },
      );
      if (!tokenRes.ok) {
        const err = await tokenRes.json();
        console.error('Token exchange failed:', err);
        return NextResponse.json({ error: 'Token exchange failed', details: err?.error?.message }, { status: 400 });
      }
      const tokenData = await tokenRes.json();
      accessToken = tokenData.access_token;
    }

    // ── Step 2: Exchange short-lived → long-lived token (60 days) ───────────
    // Uses fb_exchange_token grant — NO redirect_uri needed
    let longLivedToken = accessToken;
    let tokenExpiresAt: string | null = null;

    try {
      const exchangeRes = await fetch(
        `${META_GRAPH}/oauth/access_token?` +
          new URLSearchParams({
            grant_type: 'fb_exchange_token',
            client_id: appId,
            client_secret: appSecret,
            fb_exchange_token: accessToken,
          }),
      );

      if (exchangeRes.ok) {
        const exchangeData = await exchangeRes.json();
        if (exchangeData.access_token) {
          longLivedToken = exchangeData.access_token;
          if (exchangeData.expires_in) {
            tokenExpiresAt = new Date(Date.now() + exchangeData.expires_in * 1000).toISOString();
          }
          // Token de longa duração obtido
        }
      } else {
        const errBody = await exchangeRes.text();
        console.warn('[Meta Signup] Could not exchange for long-lived token:', errBody);
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

    // Validate required scopes — whatsapp_business_management was not approved;
    // use whatsapp_business_messaging (approved) which provides phone number IDs directly
    const hasRequiredScopes = granularScopes.some(
      (s: { scope: string }) =>
        ['whatsapp_business_messaging', 'pages_messaging', 'instagram_business_manage_messages'].includes(s.scope)
    );
    if (!hasRequiredScopes) {
      return NextResponse.json({
        error: 'Permissoes insuficientes. Certifique-se de autorizar todos os escopos solicitados.'
      }, { status: 400 });
    }

    // Extract IDs from granular_scopes target_ids
    // Note: instagram_business_manage_messages is NOT requestable via FB.login() —
    // it belongs to "Instagram API with Instagram Login". Instagram DM uses pages_messaging.
    let phoneNumberId = '';
    let displayPhoneNumber = '';
    let displayName = '';

    for (const scope of granularScopes) {
      if (scope.scope === 'whatsapp_business_messaging' && scope.target_ids?.length > 0) {
        phoneNumberId = scope.target_ids[0];
      }
    }

    // ── Step 3: Get phone number display details via WABA ───────────────────
    // Direct /{phoneNumberId}?fields=display_phone_number requires whatsapp_business_management
    // (not approved). The approved path: get WABA from the phone number, then list phone_numbers.
    if (phoneNumberId) {
      try {
        // 3a. Resolve WABA ID
        const wabaRes = await fetch(
          `${META_GRAPH}/${phoneNumberId}?fields=id,whatsapp_business_account`,
          { headers: { Authorization: `Bearer ${longLivedToken}` } }
        );
        if (wabaRes.ok) {
          const wabaData = await wabaRes.json();
          const wabaId: string | undefined = wabaData?.whatsapp_business_account?.id;

          if (wabaId) {
            // 3b. List phone numbers from WABA — returns display_phone_number and verified_name
            const numRes = await fetch(
              `${META_GRAPH}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name&limit=10`,
              { headers: { Authorization: `Bearer ${longLivedToken}` } }
            );
            if (numRes.ok) {
              const numData = await numRes.json();
              const match = (numData?.data || []).find((p: { id: string }) => p.id === phoneNumberId)
                || numData?.data?.[0];
              if (match) {
                displayPhoneNumber = match.display_phone_number || '';
                displayName = match.verified_name || match.display_phone_number || '';
              }
            }

            // ── 3c. Subscribe app to WABA webhook events ─────────────────────
            // Configuring the webhook URL in the Meta dashboard is not enough —
            // the app must be programmatically subscribed to each WABA so that
            // the WhatsApp Business API actually delivers events to our endpoint.
            // Without this, messages from real (non-test) WABAs are silently dropped.
            try {
              const wabaSubRes = await fetch(
                `${META_GRAPH}/${wabaId}/subscribeApp`,
                {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${longLivedToken}` },
                }
              );
              if (wabaSubRes.ok) {
                console.log('[Meta Signup] App subscribed to WABA webhook:', wabaId);
              } else {
                const errText = await wabaSubRes.text();
                console.warn('[Meta Signup] WABA subscription failed (non-fatal):', errText);
              }
            } catch (wabaSubErr) {
              console.warn('[Meta Signup] WABA subscription error (non-fatal):', wabaSubErr);
            }
          }
        }
      } catch {
        // Display info is optional — phoneNumberId alone is enough to send messages
      }
    }

    // ── Step 5: Get Facebook Page info (for Messenger + Instagram) ──────────
    let pageId = '';
    let pageName = '';
    let pageAccessToken = '';

    try {
      // Fetch all pages (paginated) to find the right one
      const pagesRes = await fetch(`${META_GRAPH}/me/accounts?limit=25`, {
        headers: { Authorization: `Bearer ${longLivedToken}` },
      });

      if (!pagesRes.ok) {
        const errText = await pagesRes.text();
        console.error('[Meta Signup] /me/accounts failed:', errText);
        // If this was a Facebook/Instagram-only connection (no WhatsApp), surface the error
        if (!phoneNumberId) {
          return NextResponse.json({
            error: 'Não foi possível listar suas Páginas do Facebook. Certifique-se de autorizar a permissão "pages_show_list".',
          }, { status: 400 });
        }
      } else {
        const pagesData = await pagesRes.json();
        const pages: Array<{ id: string; name: string; access_token?: string }> = pagesData?.data || [];

        if (pages.length > 0) {
          // Pick the first page that has messaging permissions
          const page = pages.find(p => p.access_token) || pages[0];
          pageId = page.id;
          pageName = page.name;
          pageAccessToken = page.access_token || '';
        } else if (!phoneNumberId) {
          // No WhatsApp and no pages found — likely pages_show_list was denied
          return NextResponse.json({
            error: 'Nenhuma Página do Facebook encontrada. Certifique-se de autorizar "pages_show_list" e de ter ao menos uma Página.',
          }, { status: 400 });
        }
      }
    } catch {
      // Pages are optional when connecting WhatsApp only
    }

    // ── Step 5b: Subscribe page to webhooks (Messenger + Instagram DM) ─────
    // 'instagram' field on page subscription enables Instagram DM webhooks
    // via the object:"page" delivery (fallback path when instagram_business_manage_messages
    // is not separately approved — the page-level subscription covers it).
    if (pageId && pageAccessToken) {
      try {
        const subRes = await fetch(
          `${META_GRAPH}/${pageId}/subscribed_apps`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${pageAccessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              subscribed_fields: [
                'messages',
                'messaging_postbacks',
                'message_deliveries',
                'message_reads',
                'feed',
                'instagram',
              ].join(','),
            }),
          },
        );

        if (!subRes.ok) {
          const errText = await subRes.text();
          console.error('[Meta Signup] Page subscription failed:', errText);
        } else {
          console.log('[Meta Signup] Page subscribed to webhooks (incl. instagram field)');
        }
      } catch (subErr) {
        console.warn('[Meta Signup] Page subscription error (non-fatal):', subErr);
      }
    }

    // ── Step 6: Get Instagram Business Account via linked Facebook Page ────────
    let igAccountId = '';
    let igAccountName = '';

    if (pageId) {
      try {
        const igRes = await fetch(
          `${META_GRAPH}/${pageId}?fields=instagram_business_account{id,name,username}`,
          { headers: { Authorization: `Bearer ${pageAccessToken || longLivedToken}` } }
        );

        if (!igRes.ok) {
          console.error('[Meta Signup] Instagram fetch via page failed:', await igRes.text());
        } else {
          const igData = await igRes.json();
          const igAccount = igData?.instagram_business_account;
          igAccountId = igAccount?.id || '';
          igAccountName = igAccount?.username || igAccount?.name || '';
        }
      } catch {
        // Instagram is optional
      }
    }

    // ── Step 6b: Subscribe Instagram account to webhooks (DMs) ──────────────
    if (igAccountId && pageAccessToken) {
      try {
        const igSubRes = await fetch(
          `${META_GRAPH}/${igAccountId}/subscribed_apps`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${pageAccessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              subscribed_fields: 'messages',
            }),
          },
        );

        if (!igSubRes.ok) {
          const errText = await igSubRes.text();
          console.warn('[Meta Signup] Instagram subscription failed:', errText);
          // Fallback: some apps need it via the page subscription only
        }
      } catch (igSubErr) {
        console.warn('[Meta Signup] Instagram subscription error (non-fatal):', igSubErr);
      }
    }

    // ── Step 7: Save channels directly to Firestore with encrypted tokens ───
    const channelUpdates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    if (phoneNumberId) {
      channelUpdates['channels.whatsapp'] = {
        phoneNumberId,
        accessToken: await encryptToken(longLivedToken),
        isConnected: true,
        connectedAt: new Date().toISOString(),
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

    // Guard: if no channel was discovered, the token is invalid or session expired
    const hasAnyChannel = !!(phoneNumberId || pageId || igAccountId);
    if (!hasAnyChannel) {
      return NextResponse.json({
        error: 'Nenhum canal encontrado. O token pode ter expirado ou a sessao do Facebook foi invalidada. Tente novamente.',
      }, { status: 401 });
    }

    // Save to Firestore via Admin SDK (bypasses security rules — server-side only)
    await adminDb.doc(`businesses/${businessId}`).update(channelUpdates);

    // Return channel info WITHOUT tokens
    return NextResponse.json({
      success: true,
      channels: {
        whatsapp: phoneNumberId
          ? {
              phoneNumberId,
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
