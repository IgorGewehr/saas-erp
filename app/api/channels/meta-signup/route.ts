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
    // selectedPageId / selectedPhoneNumberId are sent in phase-2 (after selection modal)
    const {
      accessToken: shortLivedToken,
      code,
      businessId,
      selectedPageId,
      selectedPhoneNumberId,
    } = body;

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

    // ── Step 1.5: Validate token belongs to our Meta App (CSRF protection) ──
    try {
      const debugRes = await fetch(
        `${META_GRAPH}/debug_token?input_token=${accessToken}&access_token=${appId}|${appSecret}`,
      );
      if (debugRes.ok) {
        const debugData = await debugRes.json();
        const tokenAppId = debugData.data?.app_id;
        if (tokenAppId && tokenAppId !== appId) {
          return NextResponse.json(
            { error: 'Token does not belong to this application' },
            { status: 403 },
          );
        }
        if (debugData.data?.is_valid === false) {
          return NextResponse.json(
            { error: 'Invalid or expired Meta access token' },
            { status: 401 },
          );
        }
      }
    } catch {
      // Non-blocking — if debug fails, proceed (Graph API calls will catch invalid tokens)
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

    // granular_scopes.whatsapp_business_messaging.target_ids contains WABA IDs (WhatsApp Business
    // Account IDs), NOT phone number IDs. We must fetch the actual phone number ID from the WABA.
    let wabaIdFromScopes = '';
    for (const scope of granularScopes) {
      if (scope.scope === 'whatsapp_business_messaging' && scope.target_ids?.length > 0) {
        wabaIdFromScopes = scope.target_ids[0]; // This is the WABA ID
      }
    }

    // ── Step 3: Get phone number ID + display details from WABA ────────────
    // Track available phone numbers for multi-phone selection
    let availablePhoneNumbers: Array<{ id: string; displayPhoneNumber: string; verifiedName: string }> = [];
    let phonesNeedSelection = false;

    if (wabaIdFromScopes) {
      try {
        // Fetch phone numbers directly from the WABA ID (no intermediate step needed)
        const numRes = await fetch(
          `${META_GRAPH}/${wabaIdFromScopes}/phone_numbers?fields=id,display_phone_number,verified_name&limit=25`,
          { headers: { Authorization: `Bearer ${longLivedToken}` } }
        );
        if (numRes.ok) {
          const numData = await numRes.json();
          const phones: Array<{ id: string; display_phone_number?: string; verified_name?: string }> = numData?.data || [];

          if (phones.length > 1 && !selectedPhoneNumberId) {
            // Multiple phone numbers — need user to pick one
            phonesNeedSelection = true;
            availablePhoneNumbers = phones.map(p => ({
              id: p.id,
              displayPhoneNumber: p.display_phone_number || '',
              verifiedName: p.verified_name || p.display_phone_number || '',
            }));
            console.log('[Meta Signup] Multiple phone numbers found, selection required:', availablePhoneNumbers.length);
          } else {
            // Single phone or selection already made
            const phone = phones.find(p => p.id === selectedPhoneNumberId) || phones[0];
            if (phone) {
              phoneNumberId = phone.id; // Actual phone number ID for sending messages
              displayPhoneNumber = phone.display_phone_number || '';
              displayName = phone.verified_name || phone.display_phone_number || '';
              console.log('[Meta Signup] Resolved phoneNumberId from WABA:', phoneNumberId, displayPhoneNumber);
            }
          }
        } else {
          console.warn('[Meta Signup] phone_numbers fetch failed:', await numRes.text());
        }

        // ── 3c. Subscribe app to WABA webhook events ─────────────────────
        // Configuring the webhook URL in the Meta dashboard is not enough —
        // the app must be programmatically subscribed to each WABA so that
        // the WhatsApp Business API actually delivers events to our endpoint.
        // Without this, messages from real (non-test) WABAs are silently dropped.
        const wabaId = wabaIdFromScopes;
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
      } catch {
        // Phone number fetch is best-effort; wabaId alone is enough to subscribe
      }
    }

    // ── Step 5: Get Facebook Page info (for Messenger + Instagram) ──────────
    let pageId = '';
    let pageName = '';
    let pageAccessToken = '';
    let availablePages: Array<{ id: string; name: string }> = [];
    let pagesNeedSelection = false;

    try {
      // Fetch all pages (paginated) to find the right one
      const pagesRes = await fetch(`${META_GRAPH}/me/accounts?limit=25`, {
        headers: { Authorization: `Bearer ${longLivedToken}` },
      });

      if (!pagesRes.ok) {
        const errText = await pagesRes.text();
        console.error('[Meta Signup] /me/accounts failed:', errText);
        // If this was a Facebook/Instagram-only connection (no WhatsApp), surface the error
        if (!phoneNumberId && !phonesNeedSelection) {
          return NextResponse.json({
            error: 'Não foi possível listar suas Páginas do Facebook. Certifique-se de autorizar a permissão "pages_show_list".',
          }, { status: 400 });
        }
      } else {
        const pagesData = await pagesRes.json();
        const pages: Array<{ id: string; name: string; access_token?: string }> = pagesData?.data || [];

        if (pages.length > 1 && !selectedPageId) {
          // Multiple pages — need user to pick one
          pagesNeedSelection = true;
          availablePages = pages.map(p => ({ id: p.id, name: p.name }));
          console.log('[Meta Signup] Multiple pages found, selection required:', availablePages.length);
        } else if (pages.length > 0) {
          // Single page or selection already made
          const page = pages.find(p => p.id === selectedPageId) || pages.find(p => p.access_token) || pages[0];
          pageId = page.id;
          pageName = page.name;
          pageAccessToken = page.access_token || '';

          // Exchange for a long-lived page access token — page tokens derived from a
          // long-lived user token NEVER expire, unlike those from /me/accounts (short-lived).
          // Without this, fetchSenderProfile calls fail once the token expires (hours).
          try {
            const llPageRes = await fetch(
              `${META_GRAPH}/${pageId}?fields=access_token`,
              { headers: { Authorization: `Bearer ${longLivedToken}` } }
            );
            if (llPageRes.ok) {
              const llPageData = await llPageRes.json();
              if (llPageData.access_token) {
                pageAccessToken = llPageData.access_token;
                console.log('[Meta Signup] Long-lived page token obtained for page:', pageId);
              } else {
                console.warn('[Meta Signup] Long-lived page token response had no access_token:', JSON.stringify(llPageData));
              }
            } else {
              const errText = await llPageRes.text();
              console.warn('[Meta Signup] Could not get long-lived page token (using short-lived):', errText);
            }
          } catch (llPageErr) {
            console.warn('[Meta Signup] Error fetching long-lived page token (non-fatal):', llPageErr);
          }
        } else if (!phoneNumberId && !phonesNeedSelection) {
          // No WhatsApp and no pages found — likely pages_show_list was denied
          return NextResponse.json({
            error: 'Nenhuma Página do Facebook encontrada. Certifique-se de autorizar "pages_show_list" e de ter ao menos uma Página.',
          }, { status: 400 });
        }
      }
    } catch {
      // Pages are optional when connecting WhatsApp only
    }

    // ── Early return: selection required ────────────────────────────────────
    // If the user has multiple pages or phone numbers we cannot auto-pick —
    // return the available options so the frontend can show a selector modal.
    // The frontend will re-POST with selectedPageId / selectedPhoneNumberId.
    if (phonesNeedSelection || pagesNeedSelection) {
      return NextResponse.json({
        selectionRequired: true,
        options: {
          ...(pagesNeedSelection && { pages: availablePages }),
          ...(phonesNeedSelection && { phoneNumbers: availablePhoneNumbers }),
        },
      });
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
      // Escreve APENAS em channels.whatsappCloud — campo isolado que não é
      // sobrescrito quando Baileys conecta. O campo legado channels.whatsapp
      // não é mais tocado para preservar isolamento entre canais.
      channelUpdates['channels.whatsappCloud'] = {
        phoneNumberId,
        wabaId: wabaIdFromScopes || null,
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
      // Verifica em ambos os campos: novo (whatsappCloud) e legado (whatsapp)
      const [existingNew, existingLegacy] = await Promise.all([
        adminDb.collection('businesses')
          .where('channels.whatsappCloud.phoneNumberId', '==', phoneNumberId)
          .where('channels.whatsappCloud.isConnected', '==', true)
          .limit(1).get(),
        adminDb.collection('businesses')
          .where('channels.whatsapp.phoneNumberId', '==', phoneNumberId)
          .where('channels.whatsapp.isConnected', '==', true)
          .limit(1).get(),
      ]);
      const conflict = (!existingNew.empty && existingNew.docs[0].id !== businessId)
        || (!existingLegacy.empty && existingLegacy.docs[0].id !== businessId);
      if (conflict) {
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
