import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { decryptToken } from '@/lib/utils/encryption';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';

const META_GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * GET /api/channels/whatsapp-templates?businessId=xxx
 *
 * Fetches approved WhatsApp message templates for a business from Meta Graph API.
 *
 * Flow:
 * 1. Get the business's phoneNumberId/wabaId and decrypted access token from Firestore
 * 2. Resolve WABA ID: use stored wabaId, or discover via phone number ID lookup,
 *    or treat stored ID as WABA ID (legacy fallback)
 * 3. List APPROVED templates from the WABA
 * 4. Return simplified template objects (name, language, category, components)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get('businessId');

    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
    }

    const authResult = await verifyAuth(req, businessId);
    if (isAuthError(authResult)) return authResult;

    // Load business document
    const bizSnap = await adminDb.doc(`businesses/${businessId}`).get();
    if (!bizSnap.exists) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const bizData = bizSnap.data()!;
    // Prefere o novo campo isolado whatsappCloud; fallback para legado whatsapp.
    // O legado pode ser um config Cloud OU Baileys — descartamos se for Baileys.
    const cloudFromNew = bizData?.channels?.whatsappCloud;
    const cloudFromLegacy = bizData?.channels?.whatsapp;
    const isLegacyBaileys = cloudFromLegacy?.connectedVia === 'baileys';
    // ?? só dispara em null/undefined; usamos checagem explícita para tratar
    // objeto vazio {} ou parcialmente populado como ausente
    const cloudIsValid = cloudFromNew && cloudFromNew.isConnected && cloudFromNew.accessToken && cloudFromNew.phoneNumberId;
    const legacyIsValidCloud = !isLegacyBaileys && cloudFromLegacy && cloudFromLegacy.isConnected && cloudFromLegacy.accessToken && cloudFromLegacy.phoneNumberId;
    const waConfig = cloudIsValid ? cloudFromNew : (legacyIsValidCloud ? cloudFromLegacy : null);

    if (!waConfig) {
      console.warn('[WhatsApp Templates] No valid Cloud config for business', businessId, {
        hasNew: !!cloudFromNew,
        hasLegacy: !!cloudFromLegacy,
        legacyIsBaileys: isLegacyBaileys,
        newConnected: cloudFromNew?.isConnected,
        legacyConnected: cloudFromLegacy?.isConnected,
      });
      return NextResponse.json(
        { error: 'WhatsApp Cloud não está conectado. Configure em Configurações → Canais.' },
        { status: 400 },
      );
    }

    // Decrypt the access token
    let accessToken: string;
    try {
      accessToken = await decryptToken(waConfig.accessToken);
    } catch {
      return NextResponse.json(
        { error: 'Erro ao descriptografar token do WhatsApp.' },
        { status: 500 },
      );
    }

    const phoneNumberId: string = waConfig.phoneNumberId;

    // Step 1: Resolve WABA ID — use stored wabaId when available (avoids extra round-trip),
    // otherwise discover it via the Meta API (handles both phone number IDs and legacy data
    // where the WABA ID was mistakenly stored as phoneNumberId).
    let wabaId: string | undefined = waConfig.wabaId as string | undefined;

    if (!wabaId) {
      // Try treating stored ID as a phone number ID → fetch its parent WABA
      const phoneRes = await fetch(
        `${META_GRAPH}/${phoneNumberId}?fields=id,whatsapp_business_account`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(10000),
        },
      );

      if (phoneRes.ok) {
        const phoneData = await phoneRes.json();
        wabaId = phoneData?.whatsapp_business_account?.id;
      }

      // Fallback: stored ID might itself be a WABA ID (legacy data before meta-signup fix)
      if (!wabaId) {
        const wabaTestRes = await fetch(
          `${META_GRAPH}/${phoneNumberId}/phone_numbers?fields=id&limit=1`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(10000),
          },
        );
        if (wabaTestRes.ok) {
          wabaId = phoneNumberId; // stored ID is actually the WABA ID
        }
      }

      if (!wabaId) {
        console.error('[WhatsApp Templates] Could not resolve WABA ID for phoneNumberId:', phoneNumberId);
        return NextResponse.json(
          { error: 'Não foi possível obter informações do número do WhatsApp.' },
          { status: 502 },
        );
      }

      // Backfill wabaId — escreve no campo correto (novo ou legado conforme leu)
      const backfillField = cloudFromNew ? 'channels.whatsappCloud.wabaId' : 'channels.whatsapp.wabaId';
      adminDb.doc(`businesses/${businessId}`).update({ [backfillField]: wabaId }).catch(() => {});
    }

    // Step 2: List APPROVED templates from WABA
    const templatesRes = await fetch(
      `${META_GRAPH}/${wabaId}/message_templates?fields=name,language,status,category,components&status=APPROVED&limit=50`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!templatesRes.ok) {
      const err = await templatesRes.text();
      console.error('[WhatsApp Templates] Failed to list templates:', err);
      return NextResponse.json(
        { error: 'Não foi possível listar os templates do WhatsApp.' },
        { status: 502 },
      );
    }

    const templatesData = await templatesRes.json();
    const rawTemplates: Array<{
      id: string;
      name: string;
      language: string;
      status: string;
      category: string;
      components?: Array<{ type: string; text?: string; format?: string }>;
    }> = templatesData?.data || [];

    // Shape the response — extract preview text from BODY component
    const templates = rawTemplates.map((tpl) => {
      const bodyComponent = tpl.components?.find((c) => c.type === 'BODY');
      const headerComponent = tpl.components?.find((c) => c.type === 'HEADER');
      return {
        name: tpl.name,
        language: tpl.language,
        category: tpl.category,
        // Preview text for the UI
        preview: bodyComponent?.text || headerComponent?.text || tpl.name,
        hasVariables: (bodyComponent?.text || '').includes('{{'),
      };
    });

    return NextResponse.json({ templates, wabaId });
  } catch (err) {
    console.error('[WhatsApp Templates] Error:', err);
    return NextResponse.json(
      { error: 'Erro interno ao buscar templates.' },
      { status: 500 },
    );
  }
}
