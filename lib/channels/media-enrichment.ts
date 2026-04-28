/**
 * Transform incoming audio/image messages into text the agent can reason about.
 *
 * Called by the webhook BEFORE the conversation message is saved, so:
 *   - The persisted content field contains the transcript/description.
 *   - The agent sees it as a normal text turn (no tool call needed to look at media).
 *   - Conversation history stays searchable and scannable in the UI.
 *
 * Providers:
 *   - Audio  → OpenAI Whisper (whisper-1) — pt-BR first-class, low latency.
 *   - Image  → OpenAI GPT-4o-mini vision — cheap + fast; returns structured JSON
 *              with {description, extractedText, detectedIntent}.
 *
 * Fail-safe: if transcription/vision fails, we leave content empty so the agent
 * falls back to the default "[Audio]"/"[Imagem]" preview — the human operator
 * sees the media + a soft warning and can respond manually.
 */

const OPENAI_API_URL = 'https://api.openai.com/v1';
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
const WHISPER_MODEL = process.env.OPENAI_WHISPER_MODEL || 'whisper-1';

// Rough upper bounds — anything above is skipped to avoid runaway costs.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;  // Whisper API limit
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;  // 10MB — Meta ceiling anyway

export interface EnrichedMedia {
  /** Text to use as ConversationMessage.content (replaces empty/preview). */
  content: string;
  /** Short description for sidebar preview. */
  preview: string;
  /** Raw provider response (kept for debugging/audit). */
  rawPayload?: Record<string, unknown>;
  /** ISO timestamp of enrichment */
  enrichedAt: string;
  /** Provider identifier */
  provider: 'whisper' | 'gpt4o-vision' | 'fallback';
}

export interface EnrichAudioInput {
  mediaUrl: string;           // Firebase Storage URL (we re-download here — fresh signed URL at agent time)
  mimeType?: string;
  /** Optional hint for Whisper; pt-BR is our default tenant locale. */
  language?: string;
}

export interface EnrichImageInput {
  mediaUrl: string;
  mimeType?: string;
  /** Optional tenant context for better disambiguation (menu order, etc.). */
  businessHint?: string;
}

/**
 * Transcribe a voice note (WhatsApp/Messenger/Instagram) into pt-BR text.
 * Returns null if the API key is missing or the call fails.
 */
export async function enrichAudio(input: EnrichAudioInput): Promise<EnrichedMedia | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[media-enrich] OPENAI_API_KEY missing, skipping audio transcription');
    return null;
  }

  try {
    const res = await fetch(input.mediaUrl, { method: 'GET' });
    if (!res.ok) throw new Error(`media fetch ${res.status}`);
    const blob = await res.blob();
    if (blob.size > MAX_AUDIO_BYTES) {
      console.warn(`[media-enrich] audio too large (${blob.size} bytes), skipping`);
      return fallbackFor('audio');
    }

    const form = new FormData();
    const ext = guessAudioExt(input.mimeType);
    form.append('file', blob, `voice${ext}`);
    form.append('model', WHISPER_MODEL);
    form.append('language', (input.language || 'pt').split('-')[0]);
    form.append('response_format', 'verbose_json');

    const t0 = Date.now();
    const resp = await fetch(`${OPENAI_API_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.warn(`[media-enrich] whisper ${resp.status}: ${body.slice(0, 200)}`);
      return fallbackFor('audio');
    }
    const data = await resp.json() as { text?: string; duration?: number; language?: string };
    const text = (data.text || '').trim();
    if (!text) return fallbackFor('audio');

    console.log(`[media-enrich] whisper ${Date.now() - t0}ms — ${data.duration?.toFixed(1)}s → ${text.length} chars`);
    return {
      content: `🎤 (mensagem de voz transcrita): ${text}`,
      preview: text.length > 60 ? text.slice(0, 57) + '...' : text,
      rawPayload: data as Record<string, unknown>,
      enrichedAt: new Date().toISOString(),
      provider: 'whisper',
    };
  } catch (err) {
    console.warn('[media-enrich] audio failed:', (err as Error).message);
    return fallbackFor('audio');
  }
}

/**
 * Describe an image sent by the customer — extracts visible text (receipts,
 * screenshots) and intent (e.g., "customer sent a photo of the delivery address
 * handwritten on paper").
 */
export async function enrichImage(input: EnrichImageInput): Promise<EnrichedMedia | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[media-enrich] OPENAI_API_KEY missing, skipping image description');
    return null;
  }

  try {
    // For GPT-4o vision, we can pass the URL directly — cheaper than base64 inlining.
    const prompt = `Você vê uma imagem enviada por um cliente brasileiro via WhatsApp/Messenger/Instagram para um estabelecimento${input.businessHint ? ` (contexto: ${input.businessHint})` : ''}. Responda em JSON puro (sem markdown, sem backticks) com as chaves:

{
  "description": "descrição curta em pt-BR do conteúdo visível (1-2 frases)",
  "extracted_text": "todo texto legível na imagem, ou null se não houver",
  "detected_intent": "comprovante | endereço | foto_pessoal | produto | documento | outro",
  "actionable": true | false
}

Seja objetivo. Se a imagem for ilegível ou ofensiva, retorne {"description":"imagem ilegível","extracted_text":null,"detected_intent":"outro","actionable":false}.`;

    const t0 = Date.now();
    const resp = await fetch(`${OPENAI_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        temperature: 0.1,
        max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: input.mediaUrl, detail: 'low' } },
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.warn(`[media-enrich] vision ${resp.status}: ${body.slice(0, 200)}`);
      return fallbackFor('image');
    }

    const payload = await resp.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: unknown;
    };
    const raw = payload.choices?.[0]?.message?.content?.trim();
    if (!raw) return fallbackFor('image');

    let parsed: { description?: string; extracted_text?: string | null; detected_intent?: string; actionable?: boolean };
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Vision model returned non-JSON (rare with response_format=json_object).
      // Fall back to raw text.
      parsed = { description: raw.slice(0, 240) };
    }

    const desc = (parsed.description || '').trim();
    const text = parsed.extracted_text?.trim();
    const intent = parsed.detected_intent;

    // Build a single content string the agent can reason about
    const parts: string[] = [];
    parts.push(`🖼️ (imagem anexada)`);
    if (desc) parts.push(`Descrição: ${desc}`);
    if (text) parts.push(`Texto na imagem: ${text}`);
    if (intent && intent !== 'outro') parts.push(`Tipo aparente: ${intent}`);

    const content = parts.join(' — ');
    const preview = desc.length > 60 ? desc.slice(0, 57) + '...' : desc || '[Imagem]';

    console.log(`[media-enrich] vision ${Date.now() - t0}ms — intent=${intent} hasText=${!!text}`);
    return {
      content,
      preview,
      rawPayload: parsed as Record<string, unknown>,
      enrichedAt: new Date().toISOString(),
      provider: 'gpt4o-vision',
    };
  } catch (err) {
    console.warn('[media-enrich] image failed:', (err as Error).message);
    return fallbackFor('image');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fallbackFor(kind: 'audio' | 'image'): EnrichedMedia {
  return {
    content: kind === 'audio' ? '[Áudio recebido — não foi possível transcrever]' : '[Imagem recebida — não foi possível descrever]',
    preview: kind === 'audio' ? '[Áudio]' : '[Imagem]',
    enrichedAt: new Date().toISOString(),
    provider: 'fallback',
  };
}

function guessAudioExt(mime?: string): string {
  if (!mime) return '.ogg';
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('opus')) return '.ogg';
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return '.m4a';
  if (mime.includes('mp3') || mime.includes('mpeg')) return '.mp3';
  if (mime.includes('amr')) return '.amr';
  if (mime.includes('webm')) return '.webm';
  if (mime.includes('wav')) return '.wav';
  return '.ogg';
}
