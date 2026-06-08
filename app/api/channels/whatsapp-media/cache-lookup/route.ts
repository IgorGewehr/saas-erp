/**
 * POST /api/channels/whatsapp-media/cache-lookup
 *
 * Checa se um arquivo (identificado por sha256) já tem mediaId cacheado e
 * não expirado. Em hit, devolve mediaId direto — operador NÃO precisa upar
 * o arquivo, economizando 5-100MB de banda por envio.
 *
 * Por que separado do /upload: pra economia ter sentido, a checagem precisa
 * acontecer ANTES do upload. Se fosse no mesmo endpoint, o cliente já teria
 * mandado os bytes pra descobrir que tava cacheado — defeat the purpose.
 *
 * Body:
 *   { businessId, sha256 }
 *
 * Response:
 *   200 + { cached: true, mediaId, mimeType, fileName, sizeBytes, category }
 *   200 + { cached: false }  ← miss: client deve fazer upload normal
 *   400/401/500 padrão
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { decryptToken } from '@/lib/utils/encryption';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { lookupAndBumpCache } from '@/lib/services/channels/whatsappMediaCache';

interface CloudConfig {
  accessToken: string;
  phoneNumberId: string;
}

// Mesma resolução de /upload — mediaId scope é por phoneNumberId, então
// precisamos descobrir qual phoneNumberId desse business pra consultar a cache.
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

export async function POST(req: NextRequest) {
  // Rate limit alto — lookup é barato e operador pode estar testando vários
  // arquivos antes de mandar (drag-drop, troca de seleção, etc).
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`wa-media-lookup:${clientIp}`, 60, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  let body: { businessId?: string; sha256?: string };
  try {
    body = (await req.json()) as { businessId?: string; sha256?: string };
  } catch {
    return NextResponse.json({ error: 'Body inválido (esperado JSON)' }, { status: 400 });
  }

  const businessId = body.businessId;
  const sha256 = body.sha256;
  if (!businessId || !sha256) {
    return NextResponse.json({ error: 'businessId e sha256 são obrigatórios' }, { status: 400 });
  }
  // Validação leve do sha256 — 64 chars hex lowercase. Sem isso, caller maligno
  // poderia injetar payload exótico no docId via business ID alheio.
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    return NextResponse.json({ error: 'sha256 mal-formado (esperado 64 hex chars lowercase)' }, { status: 400 });
  }

  const authResult = await verifyAuth(req, businessId);
  if (isAuthError(authResult)) return authResult;

  const config = await loadCloudConfig(businessId);
  if (!config) {
    // Sem Cloud configurado, não há como ter cache. Devolve miss em vez de erro
    // — UI cai no fluxo de upload (que tem mensagem mais útil de "configure o canal").
    return NextResponse.json({ cached: false });
  }

  try {
    const entry = await lookupAndBumpCache(businessId, config.phoneNumberId, sha256);
    if (!entry) {
      return NextResponse.json({ cached: false });
    }
    return NextResponse.json({
      cached: true,
      mediaId: entry.mediaId,
      mimeType: entry.mimeType,
      fileName: entry.fileName,
      sizeBytes: entry.sizeBytes,
      category: entry.category,
    });
  } catch (err) {
    console.error('[WA Media Cache Lookup] Error:', err);
    // Em erro de cache, melhor degradar pra miss — força upload, garante envio.
    return NextResponse.json({ cached: false });
  }
}
