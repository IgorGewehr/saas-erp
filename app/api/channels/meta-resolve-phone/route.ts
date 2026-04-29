import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { decryptToken } from '@/lib/utils/encryption';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';

const META_GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * GET /api/channels/meta-resolve-phone?businessId=xxx
 *
 * Reads the stored WhatsApp access token from Firestore, calls Meta Graph API
 * to resolve the phoneNumberId → display_phone_number + verified_name,
 * saves the resolved data back to Firestore, and returns it.
 *
 * Used by SettingsModule when it detects a numeric-only phoneNumberId is being
 * displayed instead of an actual phone number (e.g. accounts connected before
 * the two-step WABA fetch was implemented).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get('businessId');

    if (!businessId) {
      return NextResponse.json({ error: 'Missing businessId' }, { status: 400 });
    }

    const authResult = await verifyAuth(req, businessId);
    if (isAuthError(authResult)) return authResult;

    // Read business doc from Firestore (Admin SDK — bypasses security rules)
    const bizDoc = await adminDb.doc(`businesses/${businessId}`).get();
    if (!bizDoc.exists) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const bizData = bizDoc.data() as Record<string, unknown>;
    const channelsData = bizData?.channels as Record<string, unknown> | undefined;
    // Prefere whatsappCloud (novo); fallback para legado se Cloud (não Baileys).
    const cloudCfg = channelsData?.whatsappCloud as Record<string, unknown> | undefined;
    const legacy = channelsData?.whatsapp as Record<string, unknown> | undefined;
    const legacyIsCloud = legacy?.connectedVia !== 'baileys';
    const waChannel = cloudCfg ?? (legacyIsCloud ? legacy : undefined);
    const writeToNew = !!cloudCfg; // se lemos do novo, gravamos no novo

    if (!waChannel?.isConnected) {
      return NextResponse.json({ error: 'WhatsApp Cloud not connected' }, { status: 400 });
    }

    const phoneNumberId = waChannel.phoneNumberId as string | undefined;
    if (!phoneNumberId) {
      return NextResponse.json({ error: 'No phoneNumberId stored' }, { status: 400 });
    }

    // If display_phone_number is already a real phone number (not a pure numeric ID),
    // skip the fetch and return what we have.
    const existing = waChannel.displayPhoneNumber as string | undefined;
    if (existing && !/^\d+$/.test(existing)) {
      return NextResponse.json({
        resolved: true,
        phoneNumberId,
        displayPhoneNumber: existing,
        displayName: (waChannel.displayName as string) || null,
      });
    }

    // Decrypt access token
    const encryptedToken = waChannel.accessToken as string | undefined;
    if (!encryptedToken) {
      return NextResponse.json({ error: 'No access token stored' }, { status: 400 });
    }

    let accessToken: string;
    try {
      accessToken = await decryptToken(encryptedToken);
    } catch {
      return NextResponse.json({ error: 'Failed to decrypt access token' }, { status: 500 });
    }

    // The stored "phoneNumberId" might actually be a WABA ID (WhatsApp Business Account ID)
    // if the account was connected before we fixed the signup flow. The granular_scopes
    // target_ids for whatsapp_business_messaging are WABA IDs, not phone number IDs.
    //
    // Strategy:
    //   1. Try treating it as a WABA ID directly → GET /{id}/phone_numbers
    //   2. If that fails (it's a real phone number ID), fall back to the two-step approach:
    //      GET /{phoneNumberId}?fields=whatsapp_business_account → GET /{wabaId}/phone_numbers
    let displayPhoneNumber = '';
    let displayName = '';
    let resolvedPhoneNumberId = phoneNumberId;

    // Attempt 1: treat stored ID as WABA ID — fetch phone numbers directly
    const directNumRes = await fetch(
      `${META_GRAPH}/${phoneNumberId}/phone_numbers?fields=id,display_phone_number,verified_name&limit=10`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (directNumRes.ok) {
      const directNumData = await directNumRes.json();
      const phone = directNumData?.data?.[0];
      if (phone) {
        resolvedPhoneNumberId = phone.id; // actual phone number ID
        displayPhoneNumber = phone.display_phone_number || '';
        displayName = phone.verified_name || phone.display_phone_number || '';
        console.log('[resolve-phone] Resolved via WABA ID path:', resolvedPhoneNumberId, displayPhoneNumber);
      }
    }

    // Attempt 2 (fallback): treat stored ID as a real phone number ID
    if (!displayPhoneNumber) {
      const wabaRes = await fetch(
        `${META_GRAPH}/${phoneNumberId}?fields=id,whatsapp_business_account`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (wabaRes.ok) {
        const wabaData = await wabaRes.json();
        const wabaId: string | undefined = wabaData?.whatsapp_business_account?.id;

        if (wabaId) {
          const numRes = await fetch(
            `${META_GRAPH}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name&limit=10`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (numRes.ok) {
            const numData = await numRes.json();
            const match =
              (numData?.data || []).find((p: { id: string }) => p.id === phoneNumberId) ||
              numData?.data?.[0];
            if (match) {
              resolvedPhoneNumberId = match.id;
              displayPhoneNumber = match.display_phone_number || '';
              displayName = match.verified_name || match.display_phone_number || '';
              console.log('[resolve-phone] Resolved via phone number ID path:', resolvedPhoneNumberId, displayPhoneNumber);
            }
          }
        }
      }
    }

    if (!displayPhoneNumber) {
      return NextResponse.json(
        { error: 'Could not find display_phone_number from Meta' },
        { status: 502 }
      );
    }

    // Save resolved data back to Firestore — escreve no campo de onde leu
    const fieldPrefix = writeToNew ? 'channels.whatsappCloud' : 'channels.whatsapp';
    const firestoreUpdate: Record<string, string | null> = {
      [`${fieldPrefix}.displayPhoneNumber`]: displayPhoneNumber,
      [`${fieldPrefix}.displayName`]: displayName || null,
      updatedAt: new Date().toISOString(),
    };
    if (resolvedPhoneNumberId !== phoneNumberId) {
      firestoreUpdate[`${fieldPrefix}.phoneNumberId`] = resolvedPhoneNumberId;
      console.log('[resolve-phone] Correcting stored phoneNumberId:', phoneNumberId, '→', resolvedPhoneNumberId);
    }
    await adminDb.doc(`businesses/${businessId}`).update(firestoreUpdate);

    return NextResponse.json({
      resolved: true,
      phoneNumberId: resolvedPhoneNumberId,
      displayPhoneNumber,
      displayName: displayName || null,
    });
  } catch (err) {
    console.error('[resolve-phone] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
