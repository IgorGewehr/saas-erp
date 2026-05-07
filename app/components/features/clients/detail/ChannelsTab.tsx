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
 *   - Click no card abre conversa interna se já existe; senão WhatsApp abre
 *     dialog perguntando Cloud vs Baileys e cria conversa nova; FB/IG ficam
 *     desabilitados (sem conversa prévia, não dá pra iniciar pelo nosso lado).
 *   - Ícone secundário discreto pra link externo (wa.me, facebook.com/x, etc.).
 *
 * Sem Firestore writes diretos — só leitura. Cria conversa via NewConversationDialog
 * do ConversasModule, acionado por intent no AppContext (pendingNewConversation).
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { collection, query, where, getDocs, limit as firestoreLimit } from 'firebase/firestore';
import { ExternalLink, Star, Users, Facebook as FacebookIcon, Instagram as InstagramIcon, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useAppContext } from '@/app/app/AppContext';
import type { Client, Conversation, ConversationChannel } from '@/lib/types';
import { WhatsAppIcon } from '@/app/components/features/crm/SourceIcon';

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
  const { business } = useAuth();
  const { setActivePage, setPendingOpenConversationId, setPendingNewConversation } = useAppContext();

  // Connectividade WhatsApp — espelha lógica de NewConversationDialog. Cloud
  // exige token ativo; Baileys exige sessão WhatsApp Web aberta. Cada modo é
  // checado independentemente pra que botões fiquem desabilitados quando o
  // operador clicar e o WhatsApp do business não estiver pronto.
  const channels = business?.channels as ((NonNullable<typeof business>['channels'] | undefined) & {
    whatsappCloud?: { isConnected?: boolean; accessToken?: string };
    whatsappBaileys?: { isConnected?: boolean };
    whatsapp?: { isConnected?: boolean; connectedVia?: string; accessToken?: string };
  }) | undefined;
  const cloudCfg = channels?.whatsappCloud;
  const baileysCfg = channels?.whatsappBaileys;
  const legacyWa = channels?.whatsapp;
  const cloudAvailable = !!(cloudCfg?.isConnected && cloudCfg.accessToken)
    || (!cloudCfg && !!legacyWa?.isConnected && legacyWa.connectedVia !== 'baileys' && !!legacyWa.accessToken);
  const baileysAvailable = !!baileysCfg?.isConnected
    || (!baileysCfg && !!legacyWa?.isConnected && legacyWa.connectedVia === 'baileys');

  // Carrega últimas conversas do cliente pra exibir "última atividade" por canal.
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

  // Dialog WhatsApp (Cloud vs Baileys) — só aparece quando user clica no card
  // do WA e não há conversa prévia. State local pq é ephemeral e estritamente
  // visual. Após escolha, dispara intent global e fecha.
  const [waDialogOpen, setWaDialogOpen] = useState(false);

  // Click no card: navega pra conversa existente OU inicia nova (com prompt
  // de modo no caso de WA). FB/IG sem conv → noop (visual já indica disabled).
  const handleCardClick = (ch: ChannelDef) => {
    const lastConv = lastByChannel.get(ch.id);
    if (lastConv) {
      // Conversa existente — abre direto.
      setPendingOpenConversationId(lastConv.id);
      setActivePage('Conversas');
      return;
    }
    if (ch.id === 'whatsapp') {
      // Sem conv prévia: pergunta qual transporte usar.
      setWaDialogOpen(true);
      return;
    }
    // FB/IG sem conv prévia: noop. Botão já está visualmente disabled.
  };

  const startWaConversation = (mode: 'cloud' | 'baileys') => {
    setWaDialogOpen(false);
    setPendingNewConversation({
      clientId: client.id,
      channel: 'whatsapp',
      whatsappMode: mode,
    });
    setActivePage('Conversas');
  };

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
            const isRegistered = !!identifier;
            // Card é clicável quando: (a) tem conversa pra abrir, OU
            // (b) é WhatsApp + tem identifier + algum modo conectado.
            // FB/IG sem conv ficam read-only (greyed out) — não dá pra iniciar
            // novo chat pelo nosso lado nessas plataformas, só responder.
            const canStartWa = ch.id === 'whatsapp' && isRegistered && (cloudAvailable || baileysAvailable);
            const isClickable = hasActivity || canStartWa;

            return (
              <div
                key={ch.id}
                className={cn(
                  'rounded-2xl border transition-colors',
                  isClickable
                    ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 hover:border-red-300 dark:hover:border-red-500/40 hover:shadow-sm'
                    : isRegistered
                      ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 opacity-70'
                      : 'border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-900/20 opacity-60',
                )}
              >
                <div className="flex items-stretch">
                  {/* Área principal clicável (ou read-only) */}
                  <button
                    type="button"
                    onClick={() => isClickable && handleCardClick(ch)}
                    disabled={!isClickable}
                    title={!isClickable && isRegistered && ch.id !== 'whatsapp'
                      ? 'Não é possível iniciar conversa por aqui — Facebook/Instagram só permitem responder mensagens recebidas.'
                      : undefined}
                    className={cn(
                      'flex-1 flex items-start gap-3 p-3 text-left transition-colors rounded-l-2xl',
                      isClickable
                        ? 'cursor-pointer hover:bg-gray-50/40 dark:hover:bg-gray-800/30'
                        : 'cursor-not-allowed',
                    )}
                  >
                    {/* Channel icon — usa cor da marca como fundo claro. */}
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: ch.color + '18', color: ch.color }}
                    >
                      <Icon className="w-5 h-5" />
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
                        {!isRegistered && (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500">
                            Sem registro
                          </span>
                        )}
                        {/* Hint visual quando o card é clicável e como vai
                            comportar — operador entende sem precisar tooltip. */}
                        {hasActivity && (
                          <span className="text-[10px] text-red-500 dark:text-red-400 font-semibold">
                            Abrir conversa →
                          </span>
                        )}
                        {!hasActivity && canStartWa && (
                          <span className="text-[10px] text-red-500 dark:text-red-400 font-semibold">
                            Iniciar conversa →
                          </span>
                        )}
                        {!hasActivity && !canStartWa && isRegistered && ch.id !== 'whatsapp' && (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 italic">
                            sem conversa prévia
                          </span>
                        )}
                        {!hasActivity && ch.id === 'whatsapp' && isRegistered && !canStartWa && (
                          <span className="text-[10px] text-amber-500 dark:text-amber-400 italic">
                            WhatsApp não conectado
                          </span>
                        )}
                      </div>

                      {identifier && (
                        <div className="mt-1">
                          <span className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate">
                            {identifier}
                          </span>
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
                  </button>

                  {/* Ação secundária: link externo discreto. Só aparece quando
                      o identifier permite deep-link (ver externalUrl da definição). */}
                  {url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center justify-center px-3 border-l border-gray-100 dark:border-gray-700/50 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors rounded-r-2xl"
                      title="Abrir na plataforma original"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Dialog: escolha de transporte WhatsApp (Cloud vs Baileys) ao
          iniciar nova conversa. Só aparece quando user clicou em "Iniciar
          conversa" no card de WA — modo lê de business.channels e desabilita
          o botão correspondente quando não conectado. */}
      {waDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setWaDialogOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 font-display">
                Iniciar conversa via WhatsApp
              </h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                Escolha qual transporte usar pra enviar mensagem ao cliente.
              </p>
            </div>
            <div className="p-4 space-y-2">
              <button
                type="button"
                onClick={() => cloudAvailable && startWaConversation('cloud')}
                disabled={!cloudAvailable}
                className={cn(
                  'w-full text-left p-3 rounded-xl border-2 transition-colors',
                  cloudAvailable
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/20 cursor-pointer'
                    : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 opacity-50 cursor-not-allowed',
                )}
              >
                <div className="flex items-center gap-2">
                  <MessageCircle className={cn('w-4 h-4', cloudAvailable ? 'text-blue-500' : 'text-gray-400')} />
                  <span className="text-sm font-bold text-gray-900 dark:text-gray-100">WhatsApp Business (Cloud)</span>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                  {cloudAvailable
                    ? 'Oficial Meta. Requer template aprovado pra primeira mensagem.'
                    : 'Não conectado — vá em Configurações → Canais pra conectar.'}
                </p>
              </button>

              <button
                type="button"
                onClick={() => baileysAvailable && startWaConversation('baileys')}
                disabled={!baileysAvailable}
                className={cn(
                  'w-full text-left p-3 rounded-xl border-2 transition-colors',
                  baileysAvailable
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 cursor-pointer'
                    : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 opacity-50 cursor-not-allowed',
                )}
              >
                <div className="flex items-center gap-2">
                  <WhatsAppIcon className={cn('w-4 h-4', baileysAvailable ? 'text-emerald-500' : 'text-gray-400')} />
                  <span className="text-sm font-bold text-gray-900 dark:text-gray-100">WhatsApp Web (Baileys)</span>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                  {baileysAvailable
                    ? 'Texto livre. Sem necessidade de template aprovado.'
                    : 'Não conectado — vá em Configurações → Canais pra parear via QR Code.'}
                </p>
              </button>
            </div>
            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.02] flex justify-end">
              <button
                type="button"
                onClick={() => setWaDialogOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
