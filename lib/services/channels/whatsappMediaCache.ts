/**
 * Cache de mediaIds da Meta Cloud API.
 *
 * Problema: cada upload de mídia (vídeo até 16MB, doc até 100MB) custa banda
 * + tempo do operador. Se o mesmo arquivo for enviado várias vezes — caso típico
 * em atendimento manual com template de vídeo promocional — re-upar a cada
 * envio é desperdício.
 *
 * Solução: cache por (businessId, phoneNumberId, sha256) com mediaId
 * refrescado preguiçosamente. A entrada da cache é PERMANENTE (mantém
 * histórico/stats); só o `mediaId` é renovado quando expira.
 *
 * Por que sha256 e não nome do arquivo: nome não é único (mesmo arquivo upado
 * com nomes diferentes geraria entradas distintas) e operador pode renomear.
 * Hash do conteúdo identifica o arquivo de verdade.
 *
 * Por que phoneNumberId no key: a Meta scopa `media_id` por phone_number_id —
 * não vale entre números diferentes mesmo dentro da mesma WABA.
 *
 * TTL local: 25 dias (Meta é ~30 dias, mantemos margem de 5 dias pra evitar
 * falha mid-flight quando o vídeo for usado próximo do limite).
 */

import { adminDb } from '@/lib/config/firebaseAdmin';

const CACHE_TTL_DAYS = 25;

export type MediaCategory = 'image' | 'video' | 'audio' | 'document';

export interface MediaCacheEntry {
  /** Scope keys — também usados como docId. */
  phoneNumberId: string;
  sha256: string;

  /** Metadata permanente do arquivo. */
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  category: MediaCategory;

  /** mediaId atual — refrescado preguiçosamente quando expira. */
  mediaId: string;
  mediaUploadedAt: string; // ISO
  mediaExpiresAt: string;  // ISO, mediaUploadedAt + 25d

  /** Stats — preservados entre refreshs do mediaId. */
  firstSeenAt: string;     // ISO
  lastUsedAt: string;      // ISO
  uses: number;            // incrementa em cada cache hit OU upload
}

function cacheDocId(phoneNumberId: string, sha256: string): string {
  // Firestore docId aceita / mas evitamos pra clareza visual no console.
  return `${phoneNumberId}_${sha256}`;
}

function cacheRef(businessId: string, phoneNumberId: string, sha256: string) {
  return adminDb
    .collection('businesses')
    .doc(businessId)
    .collection('whatsappMediaCache')
    .doc(cacheDocId(phoneNumberId, sha256));
}

function isExpired(entry: Pick<MediaCacheEntry, 'mediaExpiresAt'>): boolean {
  if (!entry.mediaExpiresAt) return true;
  const expMs = new Date(entry.mediaExpiresAt).getTime();
  if (!Number.isFinite(expMs)) return true;
  return Date.now() > expMs;
}

/**
 * Tenta achar mediaId cacheado e não expirado. Em hit, bumpa lastUsedAt+uses
 * atomicamente (única round-trip Firestore). Retorna null em miss ou expirado
 * — caller decide re-upar.
 */
export async function lookupAndBumpCache(
  businessId: string,
  phoneNumberId: string,
  sha256: string,
): Promise<MediaCacheEntry | null> {
  const ref = cacheRef(businessId, phoneNumberId, sha256);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data() as MediaCacheEntry;
    if (isExpired(data)) return null;

    // Hit válido — bumpa stats.
    const now = new Date().toISOString();
    tx.update(ref, {
      lastUsedAt: now,
      uses: (data.uses ?? 0) + 1,
    });
    return { ...data, lastUsedAt: now, uses: (data.uses ?? 0) + 1 };
  });
}

interface UpsertInput {
  phoneNumberId: string;
  sha256: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  category: MediaCategory;
  mediaId: string;
}

/**
 * Insere ou atualiza entrada após upload (ou re-upload) pra Meta. Preserva
 * `firstSeenAt` e acumula `uses` mesmo em refresh do mediaId — auditoria
 * mostra "esse arquivo já foi enviado N vezes desde X".
 */
export async function upsertCachedMedia(
  businessId: string,
  input: UpsertInput,
): Promise<void> {
  const ref = cacheRef(businessId, input.phoneNumberId, input.sha256);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? (snap.data() as MediaCacheEntry) : null;
    const payload: MediaCacheEntry = {
      ...input,
      mediaUploadedAt: now,
      mediaExpiresAt: expiresAt,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastUsedAt: now,
      uses: (existing?.uses ?? 0) + 1,
    };
    tx.set(ref, payload);
  });
}
