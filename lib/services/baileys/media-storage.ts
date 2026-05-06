/**
 * Download de mídia recebida via Baileys + upload pra Firebase Storage.
 *
 * Sem este pipeline, mensagens inbound de imagem/áudio/vídeo/documento ficavam
 * com `mediaUrl: null` no Firestore e a UI não conseguia renderizar a mídia —
 * cliente mandava foto e o operador via bolha vazia.
 *
 * Espelha o padrão usado por app/api/webhooks/meta/route.ts pra Cloud API.
 * Diferenças:
 *   - Baileys já tem a mensagem em mãos (não precisa de fetch da Graph API);
 *   - usamos `downloadMediaMessage` do Baileys, que decodifica os blobs E2EE;
 *   - mantém o mesmo path no Storage (`conversations/{biz}/{conv}/{file}`)
 *     pra que a UI use a mesma URL signed do Firebase Storage de sempre.
 */

import {
  downloadMediaMessage,
  type WAMessage,
  type proto,
} from '@whiskeysockets/baileys';
import { uploadServerMedia } from '@/lib/services/storage/adminUpload';

// Storage uploads via uploadServerMedia (admin SDK). Antes este arquivo
// inicializava o client SDK manualmente (com firebaseConfig) e chamava
// uploadBytes — mas como Baileys roda server-side sem auth do Firebase, as
// Storage Rules retornavam `storage/unauthorized` em todas as mídias inbound.

// MIMEs que precisam ser convertidos pra M4A pra rodar em todos os navegadores.
// WhatsApp voice notes usam audio/ogg;codecs=opus — Safari não toca OGG.
const AUDIO_CONVERT_MIMES = new Set([
  'audio/ogg',
  'audio/opus',
  'audio/webm',
  'audio/amr',
  'audio/amr-wb',
]);

function mimeToExtension(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/3gpp': '.3gp',
    'audio/aac': '.aac',
    'audio/amr': '.amr',
    'audio/amr-wb': '.amr',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/ogg': '.ogg',
    'audio/opus': '.opus',
    'audio/webm': '.webm',
    'application/pdf': '.pdf',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  };
  return map[mime] || '.bin';
}

/**
 * Converte um buffer de áudio pra M4A (AAC) pra compatibilidade cross-browser.
 * Mesma lógica do Meta webhook — duplicada aqui pra não criar dependência
 * entre arquivos sem necessidade. Se virar manutenção, vale extrair pra utility.
 */
async function convertAudioToM4a(inputBuffer: Buffer, inputExt: string): Promise<Buffer> {
  const ffmpegInstaller = await import('@ffmpeg-installer/ffmpeg');
  const ffmpeg = (await import('fluent-ffmpeg')).default;
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { writeFile, readFile, unlink } = await import('node:fs/promises');

  ffmpeg.setFfmpegPath(ffmpegInstaller.path);

  const inputPath = join(tmpdir(), `bly_in_${Date.now()}${inputExt}`);
  const outputPath = join(tmpdir(), `bly_out_${Date.now()}.m4a`);

  await writeFile(inputPath, inputBuffer);

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('aac')
      .audioBitrate('128k')
      .audioChannels(1)
      .format('ipod') // M4A/AAC container
      .on('error', reject)
      .on('end', () => resolve())
      .save(outputPath);
  });

  const outputBuffer = await readFile(outputPath);
  // Cleanup non-fatal — se falhar, /tmp eventualmente limpa
  try { await unlink(inputPath); } catch { /* ignore */ }
  try { await unlink(outputPath); } catch { /* ignore */ }
  return outputBuffer;
}

/**
 * Extrai o mimetype declarado pelo Baileys no proto da mensagem.
 * Cada tipo de mídia (image/video/audio/document/sticker) tem seu próprio campo.
 */
function extractMimeType(msg: proto.IMessage | null | undefined): string | null {
  if (!msg) return null;
  if (msg.imageMessage?.mimetype) return msg.imageMessage.mimetype;
  if (msg.videoMessage?.mimetype) return msg.videoMessage.mimetype;
  if (msg.audioMessage?.mimetype) return msg.audioMessage.mimetype;
  if (msg.documentMessage?.mimetype) return msg.documentMessage.mimetype;
  if (msg.stickerMessage?.mimetype) return msg.stickerMessage.mimetype;
  return null;
}

/**
 * Tenta extrair o nome de arquivo declarado (apenas documentMessage tem isso).
 * Usado como hint na construção do nome do arquivo no Storage.
 */
function extractFileName(msg: proto.IMessage | null | undefined): string | null {
  if (!msg) return null;
  return msg.documentMessage?.fileName || null;
}

export interface DownloadAndUploadParams {
  waMessage: WAMessage;
  businessId: string;
  conversationId: string;
  /** Logger usado pelo downloadMediaMessage do Baileys; passe pino do socket. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logger?: any;
  /**
   * Função de re-upload — só necessária se o WhatsApp pedir reupload (raro).
   * Passar `sock.updateMediaMessage` da socket Baileys.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reuploadRequest?: any;
}

/**
 * Persiste falha do pipeline em `webhookFailures` para diagnóstico via UI
 * (Configurações → Enterprise → Logs). Não throw — registrar erro nunca pode
 * causar segundo erro.
 */
async function logMediaFailure(
  source: string,
  businessId: string,
  conversationId: string | null,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    const { adminDb } = await import('@/lib/config/firebaseAdmin');
    await adminDb.collection('webhookFailures').add({
      source,
      channel: 'whatsapp',
      businessId,
      ...(conversationId ? { conversationId } : {}),
      ...details,
      createdAt: new Date().toISOString(),
    });
  } catch (logErr) {
    console.warn('[Baileys Media] webhookFailures log failed (non-fatal):', logErr);
  }
}

/**
 * Baixa a mídia da mensagem Baileys, opcionalmente converte áudio pra M4A,
 * e faz upload pro Firebase Storage. Retorna a URL pública (signed) do arquivo,
 * ou null se algo falhar (caller mantém mediaUrl=null nesse caso).
 *
 * Não lança — mídia que falha em download/upload não pode bloquear a persistência
 * da mensagem no Firestore (operador veria menos do que deveria, mas pelo menos
 * o texto/preview chega).
 *
 * Falhas são persistidas em `webhookFailures` para diagnóstico via UI
 * (Configurações → Enterprise → Logs), sem precisar de acesso aos logs do servidor.
 */
export async function downloadAndUploadBaileysMedia(
  params: DownloadAndUploadParams,
): Promise<{ mediaUrl: string; contentType: string } | null> {
  const { waMessage, businessId, conversationId, logger, reuploadRequest } = params;

  if (!waMessage.message) return null;
  const declaredMime = extractMimeType(waMessage.message);
  if (!declaredMime) {
    // Mensagem não é mídia — não há o que baixar.
    return null;
  }

  // Tipo extraído pra logging — mantém parity com extractMediaType do caller
  // sem importar (dependência circular).
  const mediaTypeForLog =
    waMessage.message.imageMessage ? 'image' :
    waMessage.message.videoMessage ? 'video' :
    waMessage.message.audioMessage ? 'audio' :
    waMessage.message.documentMessage ? 'document' :
    waMessage.message.stickerMessage ? 'sticker' : 'unknown';
  const messageId = waMessage.key.id || null;
  const declaredFileName = extractFileName(waMessage.message);

  try {
    // 1. Download via Baileys (decodifica E2EE blobs).
    // Timeout via Promise.race — se o WhatsApp demorar mais que 30s, desistimos
    // pra não travar o handler de inbound (próximas mensagens ficariam atrás).
    // CRÍTICO: limpar o timer no finally pra não vazar timers em alta carga
    // (100+ mensagens/min com mídia acumularia 3000+ timers pendentes).
    const downloadPromise = downloadMediaMessage(
      waMessage,
      'buffer',
      {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ logger, reuploadRequest } as any),
    );
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error('Baileys media download timeout (30s)')),
        30_000,
      );
    });
    let downloaded: Buffer;
    try {
      downloaded = (await Promise.race([downloadPromise, timeoutPromise])) as Buffer;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
    let buffer = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded);

    // 2. Limites de tamanho (defesa contra OOM com vídeos enormes).
    const MAX_BYTES = 100 * 1024 * 1024; // 100MB — alinhado com Cloud doc limit
    if (buffer.length > MAX_BYTES) {
      console.warn(`[Baileys Media] Arquivo grande demais (${buffer.length} bytes), pulando upload`);
      await logMediaFailure('baileys-media-oversize', businessId, conversationId, {
        mediaType: mediaTypeForLog,
        declaredMime,
        bufferSize: buffer.length,
        maxBytes: MAX_BYTES,
        messageId,
        declaredFileName,
        error: `Arquivo excede limite (${(buffer.length / 1024 / 1024).toFixed(1)}MB > ${MAX_BYTES / 1024 / 1024}MB)`,
      });
      return null;
    }

    // 3. Determinar content-type final — começa pelo declarado, normaliza
    //    "audio/ogg; codecs=opus" pra "audio/ogg" (split por ";").
    let contentType = declaredMime.split(';')[0]?.trim() || 'application/octet-stream';

    // 4. Converte áudios incompatíveis pra M4A (Safari não toca OGG, etc).
    if (AUDIO_CONVERT_MIMES.has(contentType)) {
      try {
        console.log(`[Baileys Media] Convertendo ${contentType} → audio/mp4`);
        buffer = await convertAudioToM4a(buffer, mimeToExtension(contentType));
        contentType = 'audio/mp4';
      } catch (convErr) {
        // Falha de ffmpeg é uma das suspeitas mais prováveis pro problema
        // "operador não recebe áudio". Persistimos no webhookFailures pro
        // operador conseguir confirmar a hipótese sem acesso ao log.
        console.warn('[Baileys Media] Falha na conversão de áudio (mantendo original):', convErr);
        await logMediaFailure('baileys-audio-conversion', businessId, conversationId, {
          mediaType: 'audio',
          declaredMime,
          contentType,
          bufferSize: buffer.length,
          messageId,
          error: convErr instanceof Error ? convErr.message : String(convErr),
          errorStack: convErr instanceof Error ? convErr.stack?.slice(0, 500) : undefined,
          severity: 'warning', // não-fatal: mantém arquivo original
        });
      }
    }

    // 5. Monta path no Storage.
    const ext = mimeToExtension(contentType);
    const declaredName = extractFileName(waMessage.message);
    const baseName = declaredName
      ? declaredName.replace(/[^\w.-]/g, '_').slice(0, 60)
      : `inbound_${Date.now()}_${(waMessage.key.id || 'msg').slice(-8)}${ext}`;
    const storagePath = `conversations/${businessId}/${conversationId}/${Date.now()}_${baseName}`;

    // 6. Upload via admin SDK (bypassa Storage Rules que rejeitam
    //    requests sem `request.auth`). URL retornada tem o mesmo formato
    //    da gerada pelo client SDK, então a UI consome igual.
    const downloadUrl = await uploadServerMedia({ storagePath, buffer, contentType });

    return { mediaUrl: downloadUrl, contentType };
  } catch (err) {
    console.error('[Baileys Media] Erro no download/upload:', err);
    await logMediaFailure('baileys-media-download', businessId, conversationId, {
      mediaType: mediaTypeForLog,
      declaredMime,
      messageId,
      declaredFileName,
      error: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack?.slice(0, 500) : undefined,
    });
    return null;
  }
}
