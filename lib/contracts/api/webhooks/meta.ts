/**
 * lib/contracts/api/webhooks/meta.ts
 *
 * Schemas dos payloads que a Meta envia em /api/webhooks/meta.
 * Cobre WhatsApp Cloud + Facebook Messenger + Instagram DM
 * (mesma rota webhook, discriminada por `object`).
 *
 * Referências:
 *   - WhatsApp: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
 *   - Messenger: https://developers.facebook.com/docs/messenger-platform/webhooks
 *   - Instagram: https://developers.facebook.com/docs/instagram-api/guides/messaging
 *
 * INVARIANTE chave: cada `messages[].id` (wamid) é único globalmente — base
 * de toda a idempotência via `webhookSeen/{businessId}_{wamid}`.
 */

import { z } from 'zod';

// ─── GET (verification handshake) ───────────────────────────────────────────

export const MetaWebhookVerifyQuerySchema = z.object({
  'hub.mode': z.literal('subscribe'),
  'hub.verify_token': z.string().min(1),
  'hub.challenge': z.string().min(1),
});

// ─── POST headers (X-Hub-Signature-256 verifica HMAC do body) ───────────────

export const MetaWebhookHeadersSchema = z.object({
  'x-hub-signature-256': z.string().regex(/^sha256=[a-f0-9]{64}$/i),
}).passthrough();

// ─── Common message shapes ──────────────────────────────────────────────────

const WhatsAppTextSchema = z.object({
  body: z.string(),
});

const WhatsAppMediaSchema = z.object({
  id: z.string().min(1),
  mime_type: z.string().optional(),
  sha256: z.string().optional(),
  caption: z.string().optional(),
});

const WhatsAppLocationSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  name: z.string().optional(),
  address: z.string().optional(),
});

const WhatsAppMessageSchema = z.object({
  id: z.string().min(1),          // wamid — idempotency key
  from: z.string().min(1),         // E.164 sem '+'
  timestamp: z.string().min(1),    // Unix epoch as string
  type: z.enum(['text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'reaction', 'interactive', 'button']),
  text: WhatsAppTextSchema.optional(),
  image: WhatsAppMediaSchema.optional(),
  video: WhatsAppMediaSchema.optional(),
  audio: WhatsAppMediaSchema.optional(),
  document: WhatsAppMediaSchema.optional(),
  sticker: WhatsAppMediaSchema.optional(),
  location: WhatsAppLocationSchema.optional(),
  context: z.object({
    from: z.string().optional(),
    id: z.string().optional(),
  }).optional(),
}).passthrough();

const WhatsAppStatusSchema = z.object({
  id: z.string().min(1),           // wamid da mensagem original
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
  timestamp: z.string().min(1),
  recipient_id: z.string().min(1),
  errors: z.array(z.object({
    code: z.number().or(z.string()),
    title: z.string().optional(),
    message: z.string().optional(),
  })).optional(),
}).passthrough();

const WhatsAppContactSchema = z.object({
  profile: z.object({ name: z.string().optional() }).optional(),
  wa_id: z.string().min(1),
}).passthrough();

const WhatsAppValueSchema = z.object({
  messaging_product: z.literal('whatsapp'),
  metadata: z.object({
    display_phone_number: z.string().optional(),
    phone_number_id: z.string().min(1),
  }),
  contacts: z.array(WhatsAppContactSchema).optional(),
  messages: z.array(WhatsAppMessageSchema).optional(),
  statuses: z.array(WhatsAppStatusSchema).optional(),
  errors: z.array(z.unknown()).optional(),
}).passthrough();

const WhatsAppChangeSchema = z.object({
  value: WhatsAppValueSchema,
  field: z.literal('messages'),
});

const WhatsAppEntrySchema = z.object({
  id: z.string().min(1),  // wabaId
  changes: z.array(WhatsAppChangeSchema).min(1),
});

// ─── Messenger / Instagram (estrutura diferente: messaging[]) ───────────────

const MessengerMessageSchema = z.object({
  mid: z.string().min(1),
  text: z.string().optional(),
  attachments: z.array(z.object({
    type: z.enum(['image', 'video', 'audio', 'file', 'location', 'fallback', 'template']),
    payload: z.object({ url: z.string().optional() }).passthrough().optional(),
  })).optional(),
  is_echo: z.boolean().optional(),
  reply_to: z.object({ mid: z.string().optional() }).optional(),
}).passthrough();

const MessengerEventSchema = z.object({
  sender: z.object({ id: z.string().min(1) }),
  recipient: z.object({ id: z.string().min(1) }),
  timestamp: z.number(),
  message: MessengerMessageSchema.optional(),
  delivery: z.object({
    mids: z.array(z.string()).optional(),
    watermark: z.number(),
  }).optional(),
  read: z.object({ watermark: z.number() }).optional(),
  postback: z.object({
    title: z.string().optional(),
    payload: z.string().optional(),
    mid: z.string().optional(),
  }).optional(),
}).passthrough();

const MessengerEntrySchema = z.object({
  id: z.string().min(1),      // page id
  time: z.number(),
  messaging: z.array(MessengerEventSchema).optional(),
  changes: z.array(z.unknown()).optional(), // IG comments etc.
}).passthrough();

// ─── Discriminated union do body do webhook ─────────────────────────────────

export const MetaWebhookBodySchema = z.discriminatedUnion('object', [
  z.object({
    object: z.literal('whatsapp_business_account'),
    entry: z.array(WhatsAppEntrySchema).min(1),
  }),
  z.object({
    object: z.literal('page'),
    entry: z.array(MessengerEntrySchema).min(1),
  }),
  z.object({
    object: z.literal('instagram'),
    entry: z.array(MessengerEntrySchema).min(1),
  }),
]);

export type MetaWebhookBody = z.infer<typeof MetaWebhookBodySchema>;
export type WhatsAppMessage = z.infer<typeof WhatsAppMessageSchema>;
export type WhatsAppStatus = z.infer<typeof WhatsAppStatusSchema>;
export type MessengerEvent = z.infer<typeof MessengerEventSchema>;
