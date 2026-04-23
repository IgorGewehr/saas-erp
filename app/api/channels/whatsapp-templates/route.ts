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
 * 1. Get the business's phoneNumberId and decrypted access token from Firestore
 * 2. Fetch the WABA ID from the phoneNumberId via Graph API
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
    const waConfig = bizData?.channels?.whatsapp;

    if (!waConfig?.isConnected || !waConfig?.phoneNumberId || !waConfig?.accessToken) {
      return NextResponse.json(
        { error: 'WhatsApp não está conectado. Configure em Configurações → Canais.' },
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

    // Step 1: Get WABA ID from phone number ID
    const phoneRes = await fetch(
      `${META_GRAPH}/${phoneNumberId}?fields=id,whatsapp_business_account`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!phoneRes.ok) {
      const err = await phoneRes.text();
      console.error('[WhatsApp Templates] Failed to get phone number info:', err);
      return NextResponse.json(
        { error: 'Não foi possível obter informações do número do WhatsApp.' },
        { status: 502 },
      );
    }

    const phoneData = await phoneRes.json();
    const wabaId: string | undefined = phoneData?.whatsapp_business_account?.id;

    if (!wabaId) {
      console.error('[WhatsApp Templates] No WABA ID in response:', phoneData);
      return NextResponse.json(
        { error: 'Não foi possível obter o ID do WhatsApp Business Account.' },
        { status: 502 },
      );
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
