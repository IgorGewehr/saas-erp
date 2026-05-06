'use client';

/**
 * Aba "Canais" do detalhe do cliente.
 *
 * Mostra os 3 canais omnichannel do Aevo (WhatsApp, Facebook Messenger,
 * Instagram Direct) num card cada, com:
 *   - Identifier do canal (telefone WA, @user FB/IG) — fonte: client.channelIdentities
 *     e client.socialMedia (fallback)
 *   - Última atividade — fonte: query em `conversations` (most recent por canal)
 *   - Badge "Preferido" no canal preferredChannel
 *   - Link externo pra plataforma (wa.me, facebook.com/{user}, instagram.com/{user})
 *
 * Sem Firestore writes — só leitura. A navegação pra abrir a conversa dentro
 * do Aevo fica pra fase futura (precisaria ponte com AppContext + state da
 * Conversas tab); aqui o "abrir" leva pra plataforma externa, que cobre 90%
 * do uso (operador clica pra ver perfil ou continuar conversa lá).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { collection, query, where, getDocs, limit as firestoreLimit } from 'firebase/firestore';
import { ExternalLink, Star, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { db } from '@/lib/config/firebase';
import type { Client, Conversation, ConversationChannel } from '@/lib/types';
import { WhatsAppIcon } from '@/app/components/features/crm/SourceIcon';
import { Facebook as FacebookIcon, Instagram as InstagramIcon } from 'lucide-react';

interface ChannelDef {
  id: ConversationChannel;
  label: string;
  /** Cor da marca pro card (hex pra usar em style). */
  color: string;
  /** Ícone do canal. */
  icon: React.ElementType;
  /** Constrói URL externa pra abrir a plataforma — recebe identifier
   *  (que já passou pelo extractIdentifier). Retorna null pra cair no
   *  comportamento "sem link" quando o identifier não permite deep-link
   *  (ex: PSID do FB não vira URL legível). */
  externalUrl: (identifier: string) => string | null;
}

const CHANNELS: ChannelDef[] = [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    color: '#25D366',
    icon: WhatsAppIcon,
    externalUrl: (id) => {
      const digits = id.replace(/\D/g, '');
      return digits ? `https://wa.me/${digits}` : null;
    },
  },
  {
    id: 'facebook',
    label: 'Facebook Messenger',
    color: '#0866FF',
    icon: FacebookIcon,
    // PSIDs (sequência longa de dígitos) não viram URL legível. Username
    // (@nomedeperfil) sim. Se identifier parece PSID, retorna null.
    externalUrl: (id) => {
      const cleaned = id.replace(/^@/, '').trim();
      if (!cleaned) return null;
      if (/^\d{10,}$/.test(cleaned)) return null; // looks like PSID
      return `https://www.facebook.com/${cleaned}`;
    },
  },
  {
    id: 'instagram',
    label: 'Instagram Direct',
    color: '#E1306C',
    icon: InstagramIcon,
    externalUrl: (id) => {
      const cleaned = id.replace(/^@/, '').trim();
      if (!cleaned) return null;
      if (/^\d{10,}$/.test(cleaned)) return null; // looks like IGSID
      return `https://www.instagram.com/${cleaned}`;
    },
  },
];

/** Resolve o identifier exibido pra um canal — prioriza channelIdentities
 *  (PSID/IGSID/telefone usado nas mensagens reais) com fallback pra socialMedia
 *  (username preenchido manualmente no cadastro). Sem identifier, retorna null
 *  e o card aparece como "Sem registro". */
function extractIdentifier(client: Client, channel: ConversationChannel): string | null {
  const ci = client.channelIdentities?.[channel];
  if (ci) return ci;
  if (channel === 'facebook') return client.socialMedia?.facebook ?? null;
  if (channel === 'instagram') return client.socialMedia?.instagram ?? null;
  if (channel === 'whatsapp') return client.whatsapp || client.phone || null;
  return null;
}

function relativeDate(iso: string | undefined | null): string {
  if (!iso) return '';
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'agora';
    if (m < 60) return `${m}min atrás`;
    const h = Math.floor(m / 60);
    if (h < 24) return `há ${h}h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `há ${d}d`;
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  } catch { return ''; }
}

export function ChannelsTab({ client, businessId }: { client: Client; businessId: string }) {
  // Carrega últimas conversas do cliente pra exibir "última atividade" por canal.
  // Limit 20 cobre cenário realista (cliente que muda de canal várias vezes).
  // Sort client-side por lastMessageAt desc, depois agrupa pegando o primeiro
  // de cada canal. Sem orderBy no query pra evitar exigir índice composto.
  const { data: conversations = [] } = useQuery({
    queryKey: ['client-conversations-by-channel', client.id, businessId],
    queryFn: async () => {
      const snap = await getDocs(query(
        collection(db, 'conversations'),
        where('businessId', '==', businessId),
        where('crmContactId', '==', client.id),
        firestoreLimit(20),
      ));
      return snap.docs.map(d => ({ ...(d.data() as Conversation), id: d.id }));
    },
    enabled: !!client.id && !!businessId,
    staleTime: 60 * 1000,
  });

  const lastByChannel = useMemo(() => {
    const out = new Map<ConversationChannel, Conversation>();
    for (const c of conversations) {
      const existing = out.get(c.channel);
      if (!existing || (c.lastMessageAt ?? '') > (existing.lastMessageAt ?? '')) {
        out.set(c.channel, c);
      }
    }
    return out;
  }, [conversations]);

  const hasAnyChannel = CHANNELS.some(c => extractIdentifier(client, c.id));

  return (
    <div className="p-5 space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Canais omnichannel onde este cliente já interagiu ou tem identidade cadastrada.
      </p>

      {!hasAnyChannel && conversations.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 p-6 text-center">
          <Users className="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
            Sem canais registrados
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Quando o cliente enviar mensagem ou você adicionar @user social, aparece aqui.
          </p>
        </div>
      )}

      {(hasAnyChannel || conversations.length > 0) && (
        <div className="space-y-2.5">
          {CHANNELS.map((ch) => {
            const identifier = extractIdentifier(client, ch.id);
            const lastConv = lastByChannel.get(ch.id);
            const isPreferred = client.preferredChannel === ch.id;
            const Icon = ch.icon;
            const url = identifier ? ch.externalUrl(identifier) : null;
            const hasActivity = !!lastConv;
            const isActive = !!identifier || hasActivity;

            return (
              <div
                key={ch.id}
                className={cn(
                  'rounded-2xl border p-3 transition-colors',
                  isActive
                    ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40'
                    : 'border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-900/20 opacity-60',
                )}
              >
                <div className="flex items-start gap-3">
                  {/* Channel icon — usa cor da marca como fundo claro */}
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: ch.color + '18' }}
                  >
                    <Icon className="w-5 h-5" style={{ color: ch.color }} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {ch.label}
                      </span>
                      {isPreferred && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400">
                          <Star className="w-2.5 h-2.5 fill-current" />
                          Preferido
                        </span>
                      )}
                      {!isActive && (
                        <span className="text-[10px] text-gray-400 dark:text-gray-500">
                          Sem registro
                        </span>
                      )}
                    </div>

                    {identifier && (
                      <div className="mt-1">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                          >
                            <span className="font-mono truncate">{identifier}</span>
                            <ExternalLink className="w-3 h-3 flex-shrink-0" />
                          </a>
                        ) : (
                          <span className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate">
                            {identifier}
                          </span>
                        )}
                      </div>
                    )}

                    {hasActivity && (
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                        <span>
                          Última mensagem: <span className="text-gray-700 dark:text-gray-300">{relativeDate(lastConv.lastMessageAt)}</span>
                        </span>
                        {lastConv.lastMessage && (
                          <span className="truncate text-gray-400 dark:text-gray-500">
                            · {lastConv.lastMessage.slice(0, 60)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
