/**
 * POST /api/channels/whatsapp-profile/photo (multipart/form-data)
 *
 * Faz upload de foto para o WhatsApp Business Profile via Meta Resumable
 * Upload API. Retorna o `handle` que o caller deve passar em
 * `profile_picture_handle` no PATCH do perfil.
 *
 * Fluxo Meta (3 etapas):
 *   1. POST /{APP_ID}/uploads?file_length=N&file_type=MIME → cria sessão (id)
 *   2. POST /{UPLOAD_ID} (Authorization: OAuth ACCESS_TOKEN, file_offset: 0,
 *      raw bytes) → retorna `h` (handle opaco)
 *   3. Caller usa `h` em /whatsapp_business_profile (separado, ver POST do
 *      endpoint /whatsapp-profile).
 *
 * FormData:
 *   businessId: string
 *   file: File (image/jpeg ou image/png, ≤ 5MB)
 *
 * Response: { handle: string }
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
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png']);
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB (limite oficial Meta)

function requireAdmin(role: string): NextResponse | null {
  if ((ROLE_HIERARCHY[role as UserRole] || 0) < ROLE_HIERARCHY['admin']) {
    return NextResponse.json({ error: 'Forbidden — admin role required' }, { status: 403 });
  }
  return null;
}

async function loadCloudAccessToken(businessId: string): Promise<string | null> {
  const bizSnap = await adminDb.doc(`businesses/${businessId}`).get();
  if (!bizSnap.exists) return null;
  const data = bizSnap.data();
  const cloud = data?.channels?.whatsappCloud;
  const legacy = data?.channels?.whatsapp;
  const cloudIsValid = cloud?.isConnected && cloud?.accessToken;
  const legacyIsCloud = !legacy?.connectedVia || legacy.connectedVia !== 'baileys';
  const legacyValid = !cloud && legacyIsCloud && legacy?.isConnected && legacy?.accessToken;
  const cfg = cloudIsValid ? cloud : (legacyValid ? legacy : null);
  if (!cfg) return null;
  try {
    return await decryptToken(cfg.accessToken);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  // Rate limit: 5 uploads/min — operação cara (round-trip Meta + bytes)
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`wa-photo-upload:${clientIp}`, 5, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Aguarde antes de fazer upload novamente.' }, { status: 429 });
  }

  // App ID da Meta — obrigatório pra criar upload session
  const metaAppId = process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID || '';
  if (!metaAppId) {
    return NextResponse.json({ error: 'META_APP_ID não configurado no servidor' }, { status: 500 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Body deve ser multipart/form-data' }, { status: 400 });
  }

  const businessId = String(formData.get('businessId') || '');
  const file = formData.get('file');
  if (!businessId) {
    return NextResponse.json({ error: 'businessId é obrigatório' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file é obrigatório (multipart)' }, { status: 400 });
  }
  if (!ALLOWED_MIMES.has(file.type)) {
    return NextResponse.json({
      error: `Tipo de arquivo inválido (${file.type || 'desconhecido'}). Use JPEG ou PNG.`,
    }, { status: 400 });
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({
      error: `Arquivo excede 5MB (recebido ${(file.size / 1024 / 1024).toFixed(1)}MB)`,
    }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Arquivo vazio' }, { status: 400 });
  }

  const authResult = await verifyAuth(req, businessId);
  if (isAuthError(authResult)) return authResult;
  const adminCheck = requireAdmin(authResult.role);
  if (adminCheck) return adminCheck;

  const accessToken = await loadCloudAccessToken(businessId);
  if (!accessToken) {
    return NextResponse.json({ error: 'WhatsApp Cloud não conectado.' }, { status: 400 });
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());

  try {
    // ── Etapa 1: cria upload session ──────────────────────────────────────
    // Meta exige access_token via query OU Authorization. Usamos Authorization
    // pra evitar log de token em URL.
    const sessionUrl = `${META_GRAPH}/${metaAppId}/uploads?file_length=${file.size}&file_type=${encodeURIComponent(file.type)}`;
    const sessionRes = await fetch(sessionUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!sessionRes.ok) {
      const errBody = await sessionRes.text().catch(() => '');
      console.error('[WA Photo] Session create failed:', sessionRes.status, errBody);
      return NextResponse.json({
        error: 'Falha ao criar sessão de upload na Meta. Token pode ter expirado.',
        metaError: errBody.slice(0, 500),
      }, { status: 502 });
    }
    const sessionData = await sessionRes.json();
    const uploadId = sessionData?.id; // formato esperado: "upload:HEX..."
    if (!uploadId || typeof uploadId !== 'string') {
      console.error('[WA Photo] Invalid session response:', sessionData);
      return NextResponse.json({ error: 'Resposta inválida da Meta na criação da sessão' }, { status: 502 });
    }

    // ── Etapa 2: envia bytes do arquivo ───────────────────────────────────
    // Meta exige header `Authorization: OAuth TOKEN` (não Bearer aqui — quirk do endpoint)
    // e `file_offset: 0` (resumable, mas mandamos tudo de uma vez já que ≤5MB).
    const uploadRes = await fetch(`${META_GRAPH}/${uploadId}`, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${accessToken}`,
        file_offset: '0',
      },
      body: fileBuffer,
      signal: AbortSignal.timeout(60000), // upload pode demorar mais em conexões lentas
    });
    if (!uploadRes.ok) {
      const errBody = await uploadRes.text().catch(() => '');
      console.error('[WA Photo] Upload failed:', uploadRes.status, errBody);
      return NextResponse.json({
        error: 'Falha ao enviar bytes para a Meta.',
        metaError: errBody.slice(0, 500),
      }, { status: 502 });
    }
    const uploadData = await uploadRes.json();
    const handle = uploadData?.h;
    if (!handle || typeof handle !== 'string') {
      console.error('[WA Photo] Invalid upload response:', uploadData);
      return NextResponse.json({ error: 'Handle não retornado pela Meta' }, { status: 502 });
    }

    // Retorna o handle. Caller fará PATCH no perfil incluindo profile_picture_handle.
    return NextResponse.json({ handle });
  } catch (err) {
    console.error('[WA Photo] Error:', err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Erro interno no upload',
    }, { status: 500 });
  }
}
