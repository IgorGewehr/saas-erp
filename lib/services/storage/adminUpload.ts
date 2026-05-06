/**
 * Upload de arquivos para Firebase Storage via Admin SDK retornando URL
 * compatível com `getDownloadURL` do client SDK.
 *
 * Por que admin SDK e não client SDK em código server-side:
 *   O client SDK (`firebase/storage`) requer `request.auth.uid` nas Storage
 *   Rules. Webhooks, workers e outras rotas server-side não têm contexto de
 *   usuário — então as rules retornam `storage/unauthorized` mesmo o caminho
 *   sendo legítimo (`conversations/{businessId}/...`). O admin SDK bypassa
 *   as rules pelo service account.
 *
 * Por que reconstruir a URL ao invés de usar `getSignedUrl`:
 *   - getSignedUrl retorna URLs com expiração (default 1h ou explícito), o que
 *     quebraria mensagens persistidas no Firestore — ao reabrir a conv depois
 *     de algumas horas, o card de mídia falharia.
 *   - O formato `firebasestorage.googleapis.com/.../o/path?alt=media&token=X`
 *     usado pelo client SDK não expira, contanto que o objeto tenha
 *     `metadata.firebaseStorageDownloadTokens` setado. Geramos um UUID, gravamos
 *     na metadata e construímos a URL — fica indistinguível de uma URL gerada
 *     pelo client SDK, e a UI usa do mesmo jeito.
 */

import { randomUUID } from 'node:crypto';
import { adminStorage } from '@/lib/config/firebaseAdmin';

export interface UploadServerMediaParams {
  /** Path completo dentro do bucket (ex: `conversations/{biz}/{conv}/file.ogg`). */
  storagePath: string;
  /** Conteúdo do arquivo. */
  buffer: Buffer | Uint8Array;
  /** MIME type — vai pra metadata.contentType e Content-Type da response do CDN. */
  contentType: string;
}

export async function uploadServerMedia(params: UploadServerMediaParams): Promise<string> {
  const { storagePath, buffer, contentType } = params;
  const token = randomUUID();
  const bucket = adminStorage.bucket();
  const file = bucket.file(storagePath);

  await file.save(Buffer.from(buffer), {
    contentType,
    metadata: {
      contentType,
      // Esse campo é o que faz a URL `?token=X&alt=media` funcionar como
      // download URL público sem expirar.
      metadata: { firebaseStorageDownloadTokens: token },
    },
    // resumable=false pra uploads pequenos (<5MB) — single PUT é mais rápido
    // que iniciar uma sessão resumable. Para uploads >5MB, save() escolhe
    // automaticamente o modo resumable mesmo com essa flag.
    resumable: false,
  });

  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}
