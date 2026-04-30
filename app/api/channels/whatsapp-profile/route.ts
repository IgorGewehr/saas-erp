/**
 * GET  /api/channels/whatsapp-profile?businessId=xxx
 * POST /api/channels/whatsapp-profile  (body: { businessId, ...campos })
 *
 * Proxy para a API de perfil WhatsApp Business (Meta Cloud API):
 *   GET  /{phone-number-id}/whatsapp_business_profile  → lê perfil atual
 *   POST /{phone-number-id}/whatsapp_business_profile  → atualiza
 *
 * Campos editáveis pelo cliente:
 *   - about (string, max 139 chars — "Olá! Estou usando WhatsApp")
 *   - description (string, max 512 chars)
 *   - address (string, max 256 chars)
 *   - email (string, formato email)
 *   - websites (string[], até 2 URLs)
 *   - vertical (enum — categoria do negócio)
 *   - profile_picture_handle (string opaco — vem do upload em /photo)
 *
 * NÃO editável (limitação Meta — só via Meta Business Manager + revisão):
 *   - display_name (nome do perfil que aparece pro cliente)
 *   - phone number
 *
 * Auth: Firebase Bearer + role admin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { decryptToken } from '@/lib/utils/encryption';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { UserRole } from '@/lib/types';

const META_GRAPH = 'https://graph.facebook.com/v21.0';

// Verticais aceitas pela Meta — qualquer outra string é rejeitada com 400
const ALLOWED_VERTICALS = new Set([
  'UNDEFINED', 'OTHER', 'AUTO', 'BEAUTY', 'APPAREL', 'EDU', 'ENTERTAIN',
  'EVENT_PLAN', 'FINANCE', 'GROCERY', 'GOVT', 'HOTEL', 'HEALTH',
  'NONPROFIT', 'PROF_SERVICES', 'RETAIL', 'TRAVEL', 'RESTAURANT', 'NOT_A_BIZ',
]);

const MAX_ABOUT_LEN = 139;
const MAX_DESCRIPTION_LEN = 512;
const MAX_ADDRESS_LEN = 256;
const MAX_WEBSITES = 2;
const MAX_WEBSITE_URL_LEN = 256;

function requireAdmin(role: string): NextResponse | null {
  if ((ROLE_HIERARCHY[role as UserRole] || 0) < ROLE_HIERARCHY['admin']) {
    return NextResponse.json({ error: 'Forbidden — admin role required' }, { status: 403 });
  }
  return null;
}

/**
 * Lê config do canal WhatsApp Cloud do business + decifra access token.
 * Retorna `null` se não conectado, ou objeto pronto pra usar nos calls Meta.
 */
async function loadCloudConfig(businessId: string) {
  const bizSnap = await adminDb.doc(`businesses/${businessId}`).get();
  if (!bizSnap.exists) return null;
  const data = bizSnap.data();
  const cloud = data?.channels?.whatsappCloud;
  const legacy = data?.channels?.whatsapp;
  const cloudIsValid = cloud?.isConnected && cloud?.accessToken && cloud?.phoneNumberId;
  const legacyIsCloud = !legacy?.connectedVia || legacy.connectedVia !== 'baileys';
  const legacyValid = !cloud && legacyIsCloud && legacy?.isConnected && legacy?.accessToken && legacy?.phoneNumberId;
  const cfg = cloudIsValid ? cloud : (legacyValid ? legacy : null);
  if (!cfg) return null;

  let accessToken: string;
  try {
    accessToken = await decryptToken(cfg.accessToken);
  } catch {
    return null;
  }
  return {
    accessToken,
    phoneNumberId: cfg.phoneNumberId as string,
  };
}

// Reutilizado da rota whatsapp-templates — interpreta erro Meta em mensagem útil
function parseMetaError(body: string): {
  userMessage: string;
  isTokenExpired: boolean;
  isPermissionError: boolean;
  isRateLimited: boolean;
  metaCode?: number;
} {
  let parsed: { error?: { code?: number; message?: string } } = {};
  try { parsed = JSON.parse(body); } catch { /* not JSON */ }
  const code = parsed.error?.code;
  const msg = parsed.error?.message;
  const isTokenExpired = code === 190;
  const isPermissionError = code === 200 || code === 10;
  const isRateLimited = code === 4 || code === 17 || code === 32 || code === 80007;
  let userMessage = msg || 'Erro desconhecido na API da Meta';
  if (isTokenExpired) userMessage = 'Token do WhatsApp expirou. Reconecte o canal.';
  else if (isPermissionError) userMessage = 'Sem permissão. Reconecte o WhatsApp para renovar escopos.';
  else if (isRateLimited) userMessage = 'Meta API rate-limited. Tente novamente em alguns minutos.';
  return { userMessage, isTokenExpired, isPermissionError, isRateLimited, metaCode: code };
}

// ─── GET — lê perfil atual ────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId');
  if (!businessId) {
    return NextResponse.json({ error: 'businessId é obrigatório' }, { status: 400 });
  }

  const authResult = await verifyAuth(req, businessId);
  if (isAuthError(authResult)) return authResult;
  // Não exige admin para LER o perfil — qualquer membro do business pode visualizar

  const cfg = await loadCloudConfig(businessId);
  if (!cfg) {
    return NextResponse.json({
      error: 'WhatsApp Cloud não conectado para este business.',
    }, { status: 400 });
  }

  try {
    const fields = 'about,address,description,email,profile_picture_url,websites,vertical,messaging_product';
    const res = await fetch(
      `${META_GRAPH}/${cfg.phoneNumberId}/whatsapp_business_profile?fields=${fields}`,
      {
        headers: { Authorization: `Bearer ${cfg.accessToken}` },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) {
      const meta = parseMetaError(await res.text().catch(() => ''));
      console.error('[WA Profile GET] Meta error:', meta);
      return NextResponse.json(
        { error: meta.userMessage, metaCode: meta.metaCode, isTokenExpired: meta.isTokenExpired },
        { status: meta.isTokenExpired || meta.isPermissionError ? 401 : 502 },
      );
    }
    const data = await res.json();
    // A API Meta retorna `data: [...]` com 1 elemento (perfil)
    const profile = Array.isArray(data?.data) ? data.data[0] : data;
    return NextResponse.json({ profile: profile || {} });
  } catch (err) {
    console.error('[WA Profile GET] Error:', err);
    return NextResponse.json({ error: 'Erro ao buscar perfil' }, { status: 500 });
  }
}

// ─── POST — atualiza perfil ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`wa-profile-update:${clientIp}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Aguarde antes de salvar novamente.' }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const businessId = typeof body.businessId === 'string' ? body.businessId : '';
  if (!businessId) {
    return NextResponse.json({ error: 'businessId é obrigatório' }, { status: 400 });
  }

  const authResult = await verifyAuth(req, businessId);
  if (isAuthError(authResult)) return authResult;
  const adminCheck = requireAdmin(authResult.role);
  if (adminCheck) return adminCheck;

  // Sanitização dos campos
  const update: Record<string, unknown> = { messaging_product: 'whatsapp' };

  if (typeof body.about === 'string') {
    const v = body.about.trim();
    if (v.length > MAX_ABOUT_LEN) {
      return NextResponse.json({ error: `'about' excede ${MAX_ABOUT_LEN} caracteres` }, { status: 400 });
    }
    update.about = v;
  }
  if (typeof body.description === 'string') {
    const v = body.description.trim();
    if (v.length > MAX_DESCRIPTION_LEN) {
      return NextResponse.json({ error: `'description' excede ${MAX_DESCRIPTION_LEN} caracteres` }, { status: 400 });
    }
    update.description = v;
  }
  if (typeof body.address === 'string') {
    const v = body.address.trim();
    if (v.length > MAX_ADDRESS_LEN) {
      return NextResponse.json({ error: `'address' excede ${MAX_ADDRESS_LEN} caracteres` }, { status: 400 });
    }
    update.address = v;
  }
  if (typeof body.email === 'string') {
    const v = body.email.trim();
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      return NextResponse.json({ error: 'email inválido' }, { status: 400 });
    }
    update.email = v;
  }
  if (Array.isArray(body.websites)) {
    const cleaned = (body.websites as unknown[])
      .filter((w): w is string => typeof w === 'string' && w.trim().length > 0)
      .map(w => w.trim());
    if (cleaned.length > MAX_WEBSITES) {
      return NextResponse.json({ error: `Máximo ${MAX_WEBSITES} websites` }, { status: 400 });
    }
    for (const w of cleaned) {
      if (w.length > MAX_WEBSITE_URL_LEN) {
        return NextResponse.json({ error: `URL excede ${MAX_WEBSITE_URL_LEN} chars` }, { status: 400 });
      }
      if (!/^https?:\/\//i.test(w)) {
        return NextResponse.json({ error: `Website deve começar com http:// ou https://: ${w}` }, { status: 400 });
      }
    }
    update.websites = cleaned;
  }
  if (typeof body.vertical === 'string') {
    const v = body.vertical.trim().toUpperCase();
    if (v && !ALLOWED_VERTICALS.has(v)) {
      return NextResponse.json({ error: `Vertical inválido: ${v}` }, { status: 400 });
    }
    if (v) update.vertical = v;
  }
  if (typeof body.profile_picture_handle === 'string' && body.profile_picture_handle.trim()) {
    update.profile_picture_handle = body.profile_picture_handle.trim();
  }

  // Se só messaging_product está presente (nada pra atualizar), não chama Meta
  if (Object.keys(update).length <= 1) {
    return NextResponse.json({ error: 'Nenhum campo para atualizar' }, { status: 400 });
  }

  const cfg = await loadCloudConfig(businessId);
  if (!cfg) {
    return NextResponse.json({ error: 'WhatsApp Cloud não conectado.' }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${META_GRAPH}/${cfg.phoneNumberId}/whatsapp_business_profile`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(update),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) {
      const meta = parseMetaError(await res.text().catch(() => ''));
      console.error('[WA Profile POST] Meta error:', meta, { update });
      return NextResponse.json(
        { error: meta.userMessage, metaCode: meta.metaCode, isTokenExpired: meta.isTokenExpired },
        { status: meta.isTokenExpired || meta.isPermissionError ? 401 : 502 },
      );
    }
    const data = await res.json();
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    console.error('[WA Profile POST] Error:', err);
    return NextResponse.json({ error: 'Erro ao atualizar perfil' }, { status: 500 });
  }
}
