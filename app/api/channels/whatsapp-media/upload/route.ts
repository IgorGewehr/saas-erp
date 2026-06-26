/**
 * POST /api/channels/whatsapp-media/upload (multipart/form-data)
 *
 * Faz upload de mídia (vídeo/imagem/áudio/documento) pra Meta via Cloud API
 * Media endpoint: POST /{PHONE_NUMBER_ID}/media.
 *
 * Retorna `mediaId` que pode ser usado como:
 *   - mensagem direta:  { type: 'video', video: { id: mediaId } }
 *   - header de template: { type: 'header',
 *                            parameters: [{ type: 'video', video: { id: mediaId } }] }
 *
 * Por que /media em vez de link direto:
 *   - Em broadcasts com o mesmo vídeo pra N recipients, a Meta só cacheia URL
 *     idêntica por 10 minutos. Upload uma vez → media_id reusável em todos.
 *   - URLs públicas vazam por logs/referrers. media_id é opaco e curto.
 *   - Firebase Storage com Content-Type default 'application/octet-stream'
 *     falha na Meta. Upload via /media força o MIME correto.
 *
 * NÃO usar Resumable Upload (/uploads) aqui — esse é pra CRIAÇÃO de template
 * (sample com header_handle) e foto de perfil. Pra runtime de envio, /media
 * é a API certa e devolve media_id (não handle).
 *
 * FormData:
 *   businessId: string
 *   file: File
 *
 * Response:
 *   200: { mediaId, mimeType, sizeBytes, category }
 *   400: validação local (tipo/tamanho/businessId)
 *   401: auth
 *   502: erro upstream Meta
 *   500: erro inesperado
 *
 * Auth: Firebase Bearer (qualquer role com acesso ao business — operadores
 * que enviam mensagem precisam poder upar mídia).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { decryptToken } from '@/lib/utils/encryption';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import {
  lookupAndBumpCache,
  upsertCachedMedia,
} from '@/lib/services/channels/whatsappMediaCache';

const META_GRAPH = 'https://graph.facebook.com/v21.0';

// MIME types aceitos pela Meta Cloud API + size limit por categoria (bytes).
// Ref: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
// Limites validados em runtime — Meta rejeita silenciosamente alguns tipos,
// melhor travar antes do round-trip.
type MediaCategory = 'image' | 'video' | 'audio' | 'document';
const MEDIA_LIMITS: Record<string, { category: MediaCategory; maxBytes: number }> = {
  // Imagens — 5 MB
  'image/jpeg': { category: 'image', maxBytes: 5 * 1024 * 1024 },
  'image/jpg': { category: 'image', maxBytes: 5 * 1024 * 1024 },
  'image/png': { category: 'image', maxBytes: 5 * 1024 * 1024 },
  // Vídeos — 16 MB (H.264 baseline + AAC pra renderizar em todo Android)
  'video/mp4': { category: 'video', maxBytes: 16 * 1024 * 1024 },
  'video/3gpp': { category: 'video', maxBytes: 16 * 1024 * 1024 },
  // Áudios — 16 MB. Vários browsers reportam aliases não-canônicos
  // (audio/mp3 em vez de audio/mpeg, audio/x-m4a em vez de audio/mp4) —
  // normalizamos pra evitar rejeição falsa antes do upload.
  'audio/aac': { category: 'audio', maxBytes: 16 * 1024 * 1024 },
  'audio/mp4': { category: 'audio', maxBytes: 16 * 1024 * 1024 },
  'audio/x-m4a': { category: 'audio', maxBytes: 16 * 1024 * 1024 },
  'audio/mpeg': { category: 'audio', maxBytes: 16 * 1024 * 1024 },
  'audio/mp3': { category: 'audio', maxBytes: 16 * 1024 * 1024 },
  'audio/amr': { category: 'audio', maxBytes: 16 * 1024 * 1024 },
  'audio/ogg': { category: 'audio', maxBytes: 16 * 1024 * 1024 },
  // Documentos — 100 MB
  'application/pdf': { category: 'document', maxBytes: 100 * 1024 * 1024 },
  'application/msword': { category: 'document', maxBytes: 100 * 1024 * 1024 },
  'application/vnd.ms-excel': { category: 'document', maxBytes: 100 * 1024 * 1024 },
  'application/vnd.ms-powerpoint': { category: 'document', maxBytes: 100 * 1024 * 1024 },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    { category: 'document', maxBytes: 100 * 1024 * 1024 },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    { category: 'document', maxBytes: 100 * 1024 * 1024 },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    { category: 'document', maxBytes: 100 * 1024 * 1024 },
  'text/plain': { category: 'document', maxBytes: 100 * 1024 * 1024 },
};

interface CloudConfig {
  accessToken: string;
  phoneNumberId: string;
}

// Reproduz a resolução de config Cloud usada pelas outras rotas (templates,
// profile/photo, conversations/send). Quando virar 4º call-site, vale extrair
// pra lib/services/channels/whatsappCloud.ts — por ora, paridade com vizinhos.
async function loadCloudConfig(businessId: string): Promise<CloudConfig | null> {
  const bizSnap = await adminDb.doc(`businesses/${businessId}`).get();
  if (!bizSnap.exists) return null;
  const data = bizSnap.data();
  const cloud = data?.channels?.whatsappCloud;
  const legacy = data?.channels?.whatsapp;
  const cloudIsValid = cloud?.isConnected && cloud?.accessToken && cloud?.phoneNumberId;
  const legacyIsBaileys = legacy?.connectedVia === 'baileys';
  const legacyValid = !legacyIsBaileys && legacy?.isConnected && legacy?.accessToken && legacy?.phoneNumberId;
  const cfg = cloudIsValid ? cloud : (legacyValid ? legacy : null);
  if (!cfg) return null;
  try {
    return {
      accessToken: await decryptToken(cfg.accessToken),
      phoneNumberId: cfg.phoneNumberId,
    };
  } catch {
    return null;
  }
}

// Hard cap absoluto de body — protege contra request maliciosa antes do
// formData() bufferizar a memória do processo. 110MB = 100MB doc + folga
// pra overhead do multipart envelope.
const HARD_BODY_BYTES_CAP = 110 * 1024 * 1024;

export async function POST(req: NextRequest) {
  // Rate limit: 10 uploads/min por IP. Mais alto que photo upload (5/min) porque
  // operadores podem mandar várias mídias em sequência num atendimento ativo.
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`wa-media-upload:${clientIp}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Aguarde antes de fazer upload novamente.' },
      { status: 429 },
    );
  }

  // ── Defesas ANTES de bufferizar o body ────────────────────────────────────
  // formData() consome até 100MB em memória. Atacante anônimo sem token
  // sustentando 10 req/min/IP x 100MB = 1GB/min de pressão. Travamos cedo:

  // 1. Auth presence: rejeita request sem Authorization header sem ler nada.
  //    verifyAuth completo precisa do businessId (que tá no body), mas a
  //    ausência do header já basta pra rejeitar 401 sem custo de banda.
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return NextResponse.json({ error: 'Authorization Bearer obrigatório' }, { status: 401 });
  }

  // 2. Content-Length: rejeita bodies maiores que o teto absoluto antes de
  //    bufferizar. Atacante pode mentir no header, mas então o parse falha
  //    cedo quando passa do declarado. Defense em profundidade.
  const contentLength = req.headers.get('content-length');
  if (contentLength) {
    const cl = Number(contentLength);
    if (Number.isFinite(cl) && cl > HARD_BODY_BYTES_CAP) {
      return NextResponse.json(
        { error: `Body excede limite absoluto (${HARD_BODY_BYTES_CAP / 1024 / 1024}MB)` },
        { status: 413 },
      );
    }
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Body deve ser multipart/form-data' }, { status: 400 });
  }

  const businessId = String(formData.get('businessId') || '');
  const file = formData.get('file');
  // sha256 opcional — quando presente, ativamos cache (lookup antes do upload
  // pra evitar round-trip Meta, write após upload pra próximos envios pegarem
  // cache). Quando ausente, comportamento legado (upload sempre).
  const sha256Raw = String(formData.get('sha256') || '').toLowerCase();
  const sha256 = /^[a-f0-9]{64}$/.test(sha256Raw) ? sha256Raw : null;
  if (!businessId) {
    return NextResponse.json({ error: 'businessId é obrigatório' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file é obrigatório (multipart)' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Arquivo vazio' }, { status: 400 });
  }

  // Validação de tipo + tamanho antes do round-trip Meta.
  // Normaliza MIME: alguns browsers/servers mandam `audio/ogg;codecs=opus` ou
  // `video/mp4; charset=binary` — o split(';') extrai só o tipo base. Lowercase
  // protege contra `Video/MP4` que aparece em alguns clients server-to-server.
  const normalizedMime = (file.type || '').split(';')[0].trim().toLowerCase();
  const limit = MEDIA_LIMITS[normalizedMime];
  if (!limit) {
    return NextResponse.json(
      {
        error:
          `Tipo de arquivo não aceito pela WhatsApp Cloud API: ${file.type || 'desconhecido'}. ` +
          'Aceitos: JPEG, PNG, MP4, 3GP, AAC, M4A, MP3, AMR, OGG, PDF, Office (doc/xls/ppt) e TXT.',
      },
      { status: 400 },
    );
  }
  if (file.size > limit.maxBytes) {
    const limitMb = (limit.maxBytes / 1024 / 1024).toFixed(0);
    const sizeMb = (file.size / 1024 / 1024).toFixed(1);
    return NextResponse.json(
      { error: `Arquivo excede o limite Meta para ${limit.category} (${sizeMb}MB > ${limitMb}MB).` },
      { status: 400 },
    );
  }

  // Auth obrigatória — caller precisa ser membro do business.
  const authResult = await verifyAuth(req, businessId);
  if (isAuthError(authResult)) return authResult;

  const config = await loadCloudConfig(businessId);
  if (!config) {
    return NextResponse.json(
      { error: 'WhatsApp Cloud não está conectado. Configure em Configurações → Canais.' },
      { status: 400 },
    );
  }

  // Cache lookup quando sha256 foi fornecido — economiza o round-trip pra Meta
  // se o mesmo arquivo já foi upado neste phoneNumberId nos últimos 25 dias.
  // Cliente também pode (e deve) consultar via /cache-lookup ANTES de mandar
  // os bytes; este lookup aqui é seguro extra caso o cliente legado/agente
  // não tenha feito o pre-check.
  if (sha256) {
    try {
      const cached = await lookupAndBumpCache(businessId, config.phoneNumberId, sha256);
      if (cached) {
        return NextResponse.json({
          mediaId: cached.mediaId,
          mimeType: cached.mimeType,
          sizeBytes: cached.sizeBytes,
          category: cached.category,
          fromCache: true,
        });
      }
    } catch (err) {
      // Cache miss/falha não bloqueia upload — só log e segue pro fluxo Meta.
      console.warn('[WA Media] Cache lookup failed (continuing with upload):', err);
    }
  }

  try {
    // POST /{PHONE_NUMBER_ID}/media — spec Meta:
    //   multipart/form-data com:
    //     messaging_product = 'whatsapp'
    //     type              = '<mime>'
    //     file              = <binary>
    //   Authorization: Bearer ACCESS_TOKEN
    // Resposta: { id: 'MEDIA_ID' }
    //
    // IMPORTANTE pro futuro cache:
    // media_id é SCOPED por phone_number_id. Não pode ser reusado num phone
    // diferente, mesmo na mesma WABA. Em multi-tenant, cache deve ser keyed
    // por (businessId, phoneNumberId, fileHash) — não só (businessId, fileHash).
    const metaForm = new FormData();
    metaForm.append('messaging_product', 'whatsapp');
    // Envia o MIME normalizado (sem ';codecs=...') pra Meta — ela só aceita
    // o tipo base na validação do upload.
    metaForm.append('type', normalizedMime);
    metaForm.append('file', file, file.name || `upload.${limit.category}`);

    const uploadRes = await fetch(`${META_GRAPH}/${config.phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.accessToken}` },
      body: metaForm,
      // Timeout generoso pra documento grande (100MB em 5Mbps ≈ 160s).
      signal: AbortSignal.timeout(180_000),
    });

    if (!uploadRes.ok) {
      const errBody = await uploadRes.text().catch(() => '');
      console.error('[WA Media] Upload failed:', {
        status: uploadRes.status,
        size: file.size,
        type: file.type,
        businessId,
        body: errBody.slice(0, 500),
      });
      // Tenta extrair mensagem útil do erro Meta pra UI
      let userMessage = 'Falha ao enviar arquivo para a Meta.';
      let metaCode: number | undefined;
      try {
        const errJson = JSON.parse(errBody) as {
          error?: { message?: string; code?: number };
        };
        if (errJson?.error?.message) userMessage = `Meta: ${errJson.error.message}`;
        metaCode = errJson?.error?.code;
      } catch {
        /* not JSON */
      }
      return NextResponse.json(
        { error: userMessage, metaCode, metaError: errBody.slice(0, 500) },
        { status: 502 },
      );
    }

    const uploadData = (await uploadRes.json()) as { id?: string };
    const mediaId = uploadData?.id;
    if (!mediaId || typeof mediaId !== 'string') {
      console.error('[WA Media] Invalid Meta response:', uploadData);
      return NextResponse.json({ error: 'Meta não retornou media_id' }, { status: 502 });
    }

    // Grava na cache quando sha256 fornecido. Best-effort: falha aqui não
    // bloqueia o response — operador recebe o mediaId e pode usar; só perdemos
    // o ganho de cache no próximo envio do mesmo arquivo.
    if (sha256) {
      try {
        await upsertCachedMedia(businessId, {
          phoneNumberId: config.phoneNumberId,
          sha256,
          mimeType: normalizedMime,
          fileName: file.name || `upload.${limit.category}`,
          sizeBytes: file.size,
          category: limit.category,
          mediaId,
        });
      } catch (err) {
        console.warn('[WA Media] Cache upsert failed (non-blocking):', err);
      }
    }

    return NextResponse.json({
      mediaId,
      mimeType: normalizedMime,
      sizeBytes: file.size,
      category: limit.category,
      fromCache: false,
    });
  } catch (err) {
    console.error('[WA Media] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro interno no upload' },
      { status: 500 },
    );
  }
}
