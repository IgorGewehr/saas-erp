'use client';

/**
 * BusinessChannelsSection — seção dentro da aba Canais (Settings) que lista
 * os WhatsApp Web (Baileys) COMPARTILHADOS da empresa.
 *
 * Origem: refator de MyChannelsTab. A aba "Meus Canais" foi removida porque
 * ninguém usava WhatsApp pessoal — agora tudo é canal-empresa, gerenciado
 * dentro da aba Canais ao lado dos canais oficiais (Cloud/FB/IG).
 *
 * O que mostra:
 *   - Lista de Baileys com ownerType='business' (compartilhados pela equipe)
 *   - CTA admin: "Adicionar WhatsApp da empresa" (limit Phase 3.1: múltiplos
 *     permitidos, o primeiro vira primary)
 *
 * O que EXCLUI (intencionalmente):
 *   - purpose='validator': o chip validador tem card próprio em outra seção
 *     (ValidatorChipSection) com aviso claro e fluxo distinto. Sem isolar,
 *     o validator apareceria misturado e o operador confundiria com chip de
 *     envio — um dos riscos centrais do design.
 *   - ownerType='user': WhatsApp pessoais foram descontinuados. Conexões
 *     legadas ainda funcionam no backend mas não são mais expostas aqui.
 */

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  Smartphone, Plus, Loader2, X, Check,
  Trash2, RefreshCw, Building2, Edit3, Star,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { toast } from 'react-toastify';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { ChannelConnection } from '@/lib/types';
import BaileysQrModal from './BaileysQrModal';

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp_cloud: 'WhatsApp Business (Cloud)',
  whatsapp_baileys: 'WhatsApp Web',
  facebook: 'Facebook Messenger',
  instagram: 'Instagram',
};

export default function BusinessChannelsSection() {
  const { user, business } = useAuth();
  const businessId = business?.id;
  const isAdmin = !!user && ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY['admin'];

  const [connections, setConnections] = useState<ChannelConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [qrConnectionId, setQrConnectionId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const fetchConnections = useCallback(async () => {
    if (!businessId) return;
    try {
      const { getAuth } = await import('firebase/auth');
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch(`/api/channels/connections?businessId=${encodeURIComponent(businessId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setConnections((data.connections || []) as ChannelConnection[]);
    } catch (err) {
      console.error('[BusinessChannelsSection] fetch failed:', err);
      toast.error('Falha ao carregar canais.');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { void fetchConnections(); }, [fetchConnections]);

  // Polling rápido enquanto QR modal aberto — responde ao "Conectado!" e
  // fecha modal automaticamente.
  useEffect(() => {
    if (!qrConnectionId) return;
    const t = setInterval(() => { void fetchConnections(); }, 3_000);
    return () => clearInterval(t);
  }, [qrConnectionId, fetchConnections]);

  // Polling de fundo — captura mudanças tipo `disconnectReason='replaced'`
  // (outro dispositivo conectou com as mesmas creds) sem F5.
  useEffect(() => {
    if (qrConnectionId) return;
    const t = setInterval(() => { void fetchConnections(); }, 15_000);
    return () => clearInterval(t);
  }, [qrConnectionId, fetchConnections]);

  const handleCreateBusinessChannel = async () => {
    if (!isAdmin || !businessId) return;
    setCreating(true);
    try {
      const { getAuth } = await import('firebase/auth');
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch('/api/channels/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          businessId,
          type: 'whatsapp_baileys',
          ownerType: 'business',
          displayName: 'WhatsApp Empresa',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.existingConnectionId) {
          setQrConnectionId(data.existingConnectionId);
          await fetchConnections();
          return;
        }
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      await fetchConnections();
      setQrConnectionId(data.connection.id);
    } catch (err) {
      console.error('[BusinessChannelsSection] create failed:', err);
      toast.error(err instanceof Error ? err.message : 'Falha ao criar canal');
    } finally {
      setCreating(false);
    }
  };

  const handleSetPrimary = async (conn: ChannelConnection) => {
    try {
      const { getAuth } = await import('firebase/auth');
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch(`/api/channels/connections/${conn.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ isPrimary: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      toast.success('Canal definido como principal.');
      await fetchConnections();
    } catch (err) {
      console.error('[BusinessChannelsSection] set primary failed:', err);
      toast.error(err instanceof Error ? err.message : 'Falha ao alterar canal principal');
    }
  };

  const handleDelete = async (conn: ChannelConnection) => {
    if (!confirm(`Remover canal "${conn.displayName}"? A sessão será desconectada.`)) return;
    setDeletingId(conn.id);
    try {
      const { getAuth } = await import('firebase/auth');
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch(`/api/channels/connections/${conn.id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      toast.success('Canal removido.');
      await fetchConnections();
    } catch (err) {
      console.error('[BusinessChannelsSection] delete failed:', err);
      toast.error(err instanceof Error ? err.message : 'Falha ao remover');
    } finally {
      setDeletingId(null);
    }
  };

  const handleRename = async (conn: ChannelConnection) => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === conn.displayName) {
      setRenamingId(null);
      return;
    }
    try {
      const { getAuth } = await import('firebase/auth');
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch(`/api/channels/connections/${conn.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ displayName: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      await fetchConnections();
      setRenamingId(null);
      setRenameValue('');
    } catch (err) {
      console.error('[BusinessChannelsSection] rename failed:', err);
      toast.error(err instanceof Error ? err.message : 'Falha ao renomear');
    }
  };

  // Filtros:
  //  - ownerType='business' (compartilhado, não pessoal)
  //  - type='whatsapp_baileys' (esta seção é só pra WA Web)
  //  - purpose !== 'validator' (validator tem seção própria)
  // Ordena: primary primeiro, conectados antes de desconectados, depois nome.
  const businessBaileysChannels = connections
    .filter(c =>
      c.ownerType === 'business'
      && c.type === 'whatsapp_baileys'
      && c.purpose !== 'validator'
    )
    .sort((a, b) => {
      if (a.isPrimary && !b.isPrimary) return -1;
      if (!a.isPrimary && b.isPrimary) return 1;
      if (a.isConnected && !b.isConnected) return -1;
      if (!a.isConnected && b.isConnected) return 1;
      return a.displayName.localeCompare(b.displayName);
    });

  if (!businessId) return null;

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-display font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-blue-500" />
          WhatsApp da empresa (via QR Code)
        </h3>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
          Conecte celulares da empresa via WhatsApp Web. Operadores acessam todos compartilhados.
        </p>
      </div>

      {/* CTA admin: adicionar mais um WhatsApp business */}
      {isAdmin && (
        <div className="p-4 rounded-2xl border border-dashed border-blue-300 dark:border-blue-500/30 bg-blue-50/30 dark:bg-blue-500/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-500/15 flex items-center justify-center shrink-0">
              <Smartphone className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Adicionar WhatsApp da empresa
                {businessBaileysChannels.length > 0 && (
                  <span className="ml-2 text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                    {businessBaileysChannels.length} já {businessBaileysChannels.length === 1 ? 'conectado' : 'conectados'}
                  </span>
                )}
              </p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                Conecte mais um número (ex: Comercial, Suporte). Operadores acessam todos.
                {businessBaileysChannels.length > 0 && ' O novo canal será secundário — promova como principal depois se quiser.'}
              </p>
            </div>
            <button
              onClick={handleCreateBusinessChannel}
              disabled={creating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors shrink-0"
            >
              {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Conectar
            </button>
          </div>
        </div>
      )}

      {/* Lista dos canais business já conectados */}
      <ConnectionList
        connections={businessBaileysChannels}
        loading={loading}
        emptyMsg="Nenhum WhatsApp da empresa conectado ainda."
        deletingId={isAdmin ? deletingId : null}
        onDelete={isAdmin ? handleDelete : () => {}}
        onConnect={isAdmin ? (conn) => setQrConnectionId(conn.id) : () => {}}
        onRenameStart={isAdmin ? (conn) => { setRenamingId(conn.id); setRenameValue(conn.displayName); } : () => {}}
        renamingId={isAdmin ? renamingId : null}
        renameValue={isAdmin ? renameValue : ''}
        onRenameChange={isAdmin ? setRenameValue : () => {}}
        onRenameSubmit={isAdmin ? handleRename : () => {}}
        onRenameCancel={isAdmin ? () => { setRenamingId(null); setRenameValue(''); } : () => {}}
        canManage={() => isAdmin}
        readonly={!isAdmin}
        onSetPrimary={isAdmin ? handleSetPrimary : undefined}
      />

      {/* QR modal pro fluxo de pareamento Baileys (componente compartilhado
          com ValidatorChipSection — extraído em BaileysQrModal.tsx). */}
      <AnimatePresence>
        {qrConnectionId && (
          <BaileysQrModal
            businessId={businessId}
            connectionId={qrConnectionId}
            onClose={() => { setQrConnectionId(null); void fetchConnections(); }}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface ListProps {
  connections: ChannelConnection[];
  loading: boolean;
  emptyMsg: string;
  deletingId: string | null;
  onDelete: (c: ChannelConnection) => void;
  onConnect: (c: ChannelConnection) => void;
  onRenameStart: (c: ChannelConnection) => void;
  renamingId: string | null;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameSubmit: (c: ChannelConnection) => void;
  onRenameCancel: () => void;
  canManage: (c: ChannelConnection) => boolean;
  readonly?: boolean;
  onSetPrimary?: (c: ChannelConnection) => void;
}

function ConnectionList(p: ListProps) {
  if (p.loading) {
    return <div className="text-xs text-gray-400 py-3">Carregando…</div>;
  }
  if (p.connections.length === 0) {
    return <div className="text-xs text-gray-400 py-3">{p.emptyMsg}</div>;
  }
  return (
    <ul className="space-y-2">
      {p.connections.map((c) => (
        <li
          key={c.id}
          className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] group"
        >
          <div className={cn(
            'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
            c.isConnected
              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
              : 'bg-gray-200 dark:bg-white/[0.06] text-gray-500',
          )}>
            <Smartphone className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            {p.renamingId === c.id ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={p.renameValue}
                  onChange={(e) => p.onRenameChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') p.onRenameSubmit(c);
                    if (e.key === 'Escape') p.onRenameCancel();
                  }}
                  autoFocus
                  className="flex-1 text-sm font-semibold px-2 py-0.5 rounded border border-gray-300 dark:border-white/[0.1] bg-white dark:bg-white/[0.03] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
                />
                <button
                  onClick={() => p.onRenameSubmit(c)}
                  className="p-1 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={p.onRenameCancel}
                  className="p-1 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.04]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                  {c.displayName}
                </p>
                {!p.readonly && p.canManage(c) && (
                  <button
                    onClick={() => p.onRenameStart(c)}
                    title="Renomear"
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 opacity-0 group-hover:opacity-100"
                  >
                    <Edit3 className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                {CHANNEL_LABELS[c.type] || c.type}
              </span>
              {c.phoneNumber && (
                <>
                  <span className="text-[10px] text-gray-300 dark:text-gray-700">·</span>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 font-mono">
                    +{c.phoneNumber}
                  </span>
                </>
              )}
              {(() => {
                const isReplaced = !c.isConnected && c.disconnectReason === 'replaced';
                const isLoggedOut = !c.isConnected && c.disconnectReason === 'logged_out';
                if (c.isConnected) {
                  return (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                      Conectado
                    </span>
                  );
                }
                if (isReplaced) {
                  return (
                    <span
                      title="Outro dispositivo se conectou com as mesmas credenciais. Clique em 'Reconectar' pra usar aqui."
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                    >
                      Substituído
                    </span>
                  );
                }
                if (isLoggedOut) {
                  return (
                    <span
                      title="Sessão revogada pelo telefone — escaneie o QR Code novamente."
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400"
                    >
                      Revogado
                    </span>
                  );
                }
                return (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                    Desconectado
                  </span>
                );
              })()}
              {c.isPrimary && (
                <span
                  title="Canal principal — usado como default em fallbacks"
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                >
                  PRINCIPAL
                </span>
              )}
            </div>
            {!c.isConnected && c.disconnectReason === 'replaced' && (
              <p className="text-[10px] text-amber-700/90 dark:text-amber-400/90 mt-1 leading-snug">
                ⚠ Este canal foi tomado por outro dispositivo. Reconectar aqui vai
                desconectar o outro. WhatsApp permite até 4 dispositivos por número.
              </p>
            )}
            {!c.isConnected && c.disconnectReason === 'logged_out' && (
              <p className="text-[10px] text-red-700/90 dark:text-red-400/90 mt-1 leading-snug">
                A sessão foi revogada (logout pelo telefone ou WhatsApp Web). Escaneie o QR Code novamente para reconectar.
              </p>
            )}
          </div>
          {!p.readonly && p.canManage(c) && (
            <div className="flex items-center gap-1 shrink-0">
              {p.onSetPrimary && !c.isPrimary && c.isConnected && (
                <button
                  onClick={() => p.onSetPrimary?.(c)}
                  title="Definir como canal principal"
                  className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors"
                >
                  <Star className="w-3.5 h-3.5" />
                </button>
              )}
              {!c.isConnected && c.type === 'whatsapp_baileys' && (
                <button
                  onClick={() => p.onConnect(c)}
                  title="Reconectar / mostrar QR"
                  className="p-1.5 rounded-lg text-[#25D366] hover:bg-[#25D366]/10 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => p.onDelete(c)}
                disabled={p.deletingId === c.id}
                title="Remover canal"
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50 transition-colors"
              >
                {p.deletingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

