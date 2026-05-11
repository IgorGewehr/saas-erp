/**
 * lib/contracts/domain/channelConnection.ts
 *
 * Abstração unificada de canal omnichannel (Fase 1 do refactor de canais).
 * Cada conexão = uma identidade externa do business (ou de um usuário, no caso Baileys).
 *
 * Tipos:
 *  - whatsapp_cloud:    Meta WhatsApp Business API (oficial, via Embedded Signup)
 *  - whatsapp_baileys:  WhatsApp Web via Baileys (pessoal, por usuário)
 *  - facebook:          Facebook Messenger
 *  - instagram:         Instagram DM
 *
 * Credenciais são encriptadas em repouso (AES-256-GCM, vide lib/utils/encryption).
 * Aqui declaramos apenas o SHAPE — encryption fica como string no campo.
 */

import { z } from 'zod';

export const CHANNEL_CONNECTION_TYPES = [
  'whatsapp_cloud',
  'whatsapp_baileys',
  'facebook',
  'instagram',
] as const;
export const ChannelConnectionTypeSchema = z.enum(CHANNEL_CONNECTION_TYPES);
export type ChannelConnectionType = z.infer<typeof ChannelConnectionTypeSchema>;

export const CHANNEL_OWNER_TYPES = ['business', 'user'] as const;
export const ChannelOwnerTypeSchema = z.enum(CHANNEL_OWNER_TYPES);
export type ChannelOwnerType = z.infer<typeof ChannelOwnerTypeSchema>;

const WhatsappCloudCredsSchema = z.object({
  phoneNumberId: z.string().min(1),
  wabaId: z.string().min(1),
  /** Token encrypted (formato `enc::v1::<iv>::<tag>::<ciphertext>` ou similar) */
  accessTokenEncrypted: z.string().min(1),
});

const FacebookCredsSchema = z.object({
  pageId: z.string().min(1),
  pageAccessTokenEncrypted: z.string().min(1),
});

const InstagramCredsSchema = z.object({
  igAccountId: z.string().min(1),
  igAccountName: z.string().min(1),
  pageAccessTokenEncrypted: z.string().min(1).optional(),
});

const BaileysCredsSchema = z.object({
  /** Doc id em `baileysAuthStates/{id}` que carrega o state encriptado. */
  authStateRef: z.string().min(1),
  /** Número do operador (E.164) após pareamento. */
  registeredPhone: z.string().optional(),
});

export const ChannelConnectionSchema = z.object({
  id: z.string().min(1),
  businessId: z.string().min(1),
  type: ChannelConnectionTypeSchema,
  ownerType: ChannelOwnerTypeSchema,
  ownerId: z.string().optional(), // uid quando ownerType=user
  displayName: z.string().min(1).max(120),
  isPrimary: z.boolean(),
  isActive: z.boolean(),
  whatsappCloud: WhatsappCloudCredsSchema.optional(),
  facebook: FacebookCredsSchema.optional(),
  instagram: InstagramCredsSchema.optional(),
  baileys: BaileysCredsSchema.optional(),
  connectedAt: z.string().optional(),
  lastErrorAt: z.string().optional(),
  lastError: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).superRefine((c, ctx) => {
  // INVARIANTE 1: ownerType=user só faz sentido em Baileys
  if (c.ownerType === 'user' && c.type !== 'whatsapp_baileys') {
    ctx.addIssue({ code: 'custom', message: 'ownerType=user só é válido para whatsapp_baileys', path: ['ownerType'] });
  }
  // INVARIANTE 2: ownerType=user exige ownerId
  if (c.ownerType === 'user' && !c.ownerId) {
    ctx.addIssue({ code: 'custom', message: 'ownerType=user exige ownerId (uid)', path: ['ownerId'] });
  }
  // INVARIANTE 3: cada tipo exige seu bloco de credenciais
  const requiredCreds: Record<ChannelConnectionType, keyof typeof c> = {
    whatsapp_cloud: 'whatsappCloud',
    whatsapp_baileys: 'baileys',
    facebook: 'facebook',
    instagram: 'instagram',
  };
  const credsField = requiredCreds[c.type];
  if (!c[credsField]) {
    ctx.addIssue({
      code: 'custom',
      message: `type=${c.type} exige bloco '${credsField}'`,
      path: [credsField],
    });
  }
});

export type ChannelConnection = z.infer<typeof ChannelConnectionSchema>;
