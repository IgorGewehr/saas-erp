import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { decryptToken } from '@/lib/utils/encryption';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';

const META_GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * Interpreta o body de erro da Meta Graph API e retorna um payload útil
 * para o cliente, com mensagem em PT-BR e detecção de cenários comuns.
 *
 * Códigos Meta comuns:
 *   190 — Token expirado/invalidado (precisa reconectar Embedded Signup)
 *   200 — Permissão insuficiente (token sem scope correto)
 *   100 — Parâmetro inválido (geralmente WABA/phoneNumberId errado)
 *   368 — Bloqueio temporário da conta
 *   80007 — Rate limit da WABA
 */
function parseMetaError(body: string): {
  code?: number;
  type?: string;
  message?: string;
  fbtrace_id?: string;
  userMessage: string;
  isTokenExpired: boolean;
  isPermissionError: boolean;
  isRateLimited: boolean;
} {
  let parsed: { error?: { code?: number; type?: string; message?: string; fbtrace_id?: string } } = {};
  try { parsed = JSON.parse(body); } catch { /* not JSON */ }
  const err = parsed.error || {};
  const code = err.code;
  const message = err.message;

  const isTokenExpired = code === 190;
  const isPermissionError = code === 200 || code === 10;
  const isRateLimited = code === 4 || code === 80007 || code === 17 || code === 32;

  let userMessage = message || 'Erro desconhecido na API da Meta';
  if (isTokenExpired) {
    userMessage = 'Token do WhatsApp expirou. Reconecte o canal em Configurações → Canais → WhatsApp.';
  } else if (isPermissionError) {
    userMessage = 'Sem permissão para acessar a WABA. Reconecte o WhatsApp para renovar os escopos.';
  } else if (isRateLimited) {
    userMessage = 'Muitas requisições à Meta API. Aguarde alguns minutos e tente novamente.';
  } else if (code === 100) {
    userMessage = 'WABA ou número de telefone inválido — verifique a configuração do canal WhatsApp.';
  }

  return {
    code,
    type: err.type,
    message,
    fbtrace_id: err.fbtrace_id,
    userMessage,
    isTokenExpired,
    isPermissionError,
    isRateLimited,
  };
}

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
      let lastErrorBody = '';
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
      } else {
        lastErrorBody = await phoneRes.text().catch(() => '');
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
        } else if (!lastErrorBody) {
          lastErrorBody = await wabaTestRes.text().catch(() => '');
        }
      }

      if (!wabaId) {
        const meta = parseMetaError(lastErrorBody);
        console.error('[WhatsApp Templates] Could not resolve WABA ID', {
          phoneNumberId,
          businessId,
          metaCode: meta.code,
          metaMessage: meta.message,
          fbtrace_id: meta.fbtrace_id,
        });
        return NextResponse.json(
          {
            error: meta.userMessage,
            metaCode: meta.code,
            isTokenExpired: meta.isTokenExpired,
            isPermissionError: meta.isPermissionError,
          },
          { status: meta.isTokenExpired || meta.isPermissionError ? 401 : 502 },
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
      const errBody = await templatesRes.text().catch(() => '');
      const meta = parseMetaError(errBody);
      console.error('[WhatsApp Templates] Failed to list templates', {
        wabaId,
        businessId,
        httpStatus: templatesRes.status,
        metaCode: meta.code,
        metaMessage: meta.message,
        fbtrace_id: meta.fbtrace_id,
      });
      return NextResponse.json(
        {
          error: meta.userMessage,
          metaCode: meta.code,
          isTokenExpired: meta.isTokenExpired,
          isPermissionError: meta.isPermissionError,
          isRateLimited: meta.isRateLimited,
        },
        { status: meta.isTokenExpired || meta.isPermissionError ? 401 : meta.isRateLimited ? 429 : 502 },
      );
    }

    const templatesData = await templatesRes.json();
    // Estrutura crua dos componentes que a Meta devolve em /message_templates.
    // Antes só consumíamos type/text/format (suficiente pra header TEXT + body de variáveis).
    // Agora preservamos também `example` (precisamos do header_handle pra mídia futura),
    // `buttons` (QUICK_REPLY/URL/PHONE_NUMBER/COPY_CODE/OTP) e devolvemos os components
    // crus pro consumer (broadcast/send) poder montar o payload Meta correto com header
    // de mídia (IMAGE/VIDEO/DOCUMENT) — UI ainda não usa, mas precisa estar disponível.
    type MetaTemplateButton = {
      type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE' | 'OTP';
      text: string;
      url?: string;
      phone_number?: string;
    };
    type MetaTemplateComponent = {
      type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
      format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';
      text?: string;
      example?: {
        header_text?: string[];
        header_handle?: string[];
        body_text?: string[][];
      };
      buttons?: MetaTemplateButton[];
    };
    const rawTemplates: Array<{
      id: string;
      name: string;
      language: string;
      status: string;
      category: string;
      components?: MetaTemplateComponent[];
    }> = templatesData?.data || [];

    // Normaliza pro shape que UI/broadcast precisam. Mantém os campos antigos
    // (name/language/category/preview/hasVariables) por back-compat com
    // ConversasModule.tsx (linhas 8080,10229,10233) + SettingsModule + TemplateSelector.
    const templates = rawTemplates.map((tpl) => {
      const components = tpl.components ?? [];
      const headerComp = components.find((c) => c.type === 'HEADER');
      const bodyComp = components.find((c) => c.type === 'BODY');
      const footerComp = components.find((c) => c.type === 'FOOTER');
      const buttonsComp = components.find((c) => c.type === 'BUTTONS');

      // Header normalizado. `format` é a chave que destrava IMAGE/VIDEO/DOCUMENT
      // no UI — VIDEO em particular é o gatilho pro novo fluxo de mídia.
      const header = headerComp
        ? {
            format: (headerComp.format ?? 'TEXT') as 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION',
            text: headerComp.text,
            // example.header_handle vem do template criado com Resumable Upload.
            // Não usamos pra enviar (precisamos URL/id em runtime), só pra UI exibir
            // referência do sample que foi submetido à Meta.
            example: headerComp.example,
          }
        : null;

      return {
        name: tpl.name,
        language: tpl.language,
        category: tpl.category,
        // Back-compat: preview = body text ou fallback (UI já mostra direto).
        preview: bodyComp?.text || headerComp?.text || tpl.name,
        hasVariables: (bodyComp?.text || '').includes('{{'),
        // Novos campos estruturados — opcionais no consumer, ignorados pelos antigos.
        header,
        body: bodyComp
          ? { text: bodyComp.text || '', example: bodyComp.example }
          : null,
        footer: footerComp?.text ? { text: footerComp.text } : null,
        buttons: buttonsComp?.buttons ?? null,
        // Components crus pra quem vai montar o payload de envio (broadcast builder).
        // Sem isso, builder não tem como saber a ordem dos parameters por componente.
        components,
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
