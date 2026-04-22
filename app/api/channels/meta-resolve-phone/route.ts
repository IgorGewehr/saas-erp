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
    const waChannel = (bizData?.channels as Record<string, unknown>)?.whatsapp as Record<string, unknown> | undefined;

    if (!waChannel?.isConnected) {
      return NextResponse.json({ error: 'WhatsApp not connected' }, { status: 400 });
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

    // Step 1: resolve WABA from phoneNumberId
    let displayPhoneNumber = '';
    let displayName = '';

    const wabaRes = await fetch(
      `${META_GRAPH}/${phoneNumberId}?fields=id,whatsapp_business_account`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!wabaRes.ok) {
      const errText = await wabaRes.text();
      console.error('[resolve-phone] WABA fetch failed:', errText);
      return NextResponse.json(
        { error: 'Failed to fetch WABA from Meta', details: errText },
        { status: 502 }
      );
    }

    const wabaData = await wabaRes.json();
    const wabaId: string | undefined = wabaData?.whatsapp_business_account?.id;

    if (!wabaId) {
      return NextResponse.json(
        { error: 'Could not resolve WABA ID from Meta' },
        { status: 502 }
      );
    }

    // Step 2: list phone numbers from WABA
    const numRes = await fetch(
      `${META_GRAPH}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name&limit=10`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!numRes.ok) {
      const errText = await numRes.text();
      console.error('[resolve-phone] phone_numbers fetch failed:', errText);
      return NextResponse.json(
        { error: 'Failed to list phone numbers from WABA', details: errText },
        { status: 502 }
      );
    }

    const numData = await numRes.json();
    const match =
      (numData?.data || []).find((p: { id: string }) => p.id === phoneNumberId) ||
      numData?.data?.[0];

    if (match) {
      displayPhoneNumber = match.display_phone_number || '';
      displayName = match.verified_name || match.display_phone_number || '';
    }

    if (!displayPhoneNumber) {
      return NextResponse.json(
        { error: 'Could not find display_phone_number from Meta' },
        { status: 502 }
      );
    }

    // Save resolved data back to Firestore
    await adminDb.doc(`businesses/${businessId}`).update({
      'channels.whatsapp.displayPhoneNumber': displayPhoneNumber,
      'channels.whatsapp.displayName': displayName || null,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      resolved: true,
      phoneNumberId,
      displayPhoneNumber,
      displayName: displayName || null,
    });
  } catch (err) {
    console.error('[resolve-phone] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
