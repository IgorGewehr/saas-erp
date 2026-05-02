'use client';

/**
 * MyChannelsTab — gestão dos canais visíveis ao usuário (Phase 2 do refactor
 * multi-canal).
 *
 * O que mostra:
 *   - Canais da empresa (ownerType='business') — read-only, exibidos em cinza
 *     pra contexto. Quem gerencia é admin via Settings → Empresa → Canais.
 *   - Canais pessoais do usuário (ownerType='user', ownerId=self) — totalmente
 *     gerenciáveis. Operator+ pode adicionar/remover/renomear.
 *
 * Fluxo de adicionar Baileys pessoal:
 *   1. POST /api/channels/connections {type:'whatsapp_baileys', ownerType:'user'}
 *   2. Abre modal QR conectado a /api/whatsapp/connect?connectionId=...
 *   3. SSE entrega QR → user escaneia → status='connected'
 *   4. Modal fecha, lista atualiza via refetch (channelConnection.isConnected=true)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Smartphone, Plus, Loader2, X, Check, AlertCircle, QrCode,
  Trash2, RefreshCw, Building2, User as UserIcon, Edit3, Star,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { toast } from 'react-toastify';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { ChannelConnection } from '@/lib/types';

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp_cloud: 'WhatsApp Business (Cloud)',
  whatsapp_baileys: 'WhatsApp Web',
  facebook: 'Facebook Messenger',
  instagram: 'Instagram',
};

export default function MyChannelsTab() {
  const { user, business } = useAuth();
  const businessId = business?.id;
  const userId = user?.uid;
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
      console.error('[MyChannelsTab] fetch failed:', err);
      toast.error('Falha ao carregar canais.');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { void fetchConnections(); }, [fetchConnections]);

  // Polling leve enquanto há conexão sendo estabelecida (modal QR aberto)
  useEffect(() => {
    if (!qrConnectionId) return;
    const t = setInterval(() => { void fetchConnections(); }, 3_000);
    return () => clearInterval(t);
  }, [qrConnectionId, fetchConnections]);

  const handleCreatePersonal = async () => {
    return createConnection('user');
  };

  /**
   * Phase 3.1: admin pode adicionar canais Baileys da EMPRESA (não-pessoais).
   * Quando já existe primary, esta vira secundária — admin promove via UI.
   */
  const handleCreateBusinessChannel = async () => {
    if (!isAdmin) return;
    return createConnection('business');
  };

  const createConnection = async (ownerKind: 'user' | 'business') => {
    if (!businessId) return;
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
          ownerType: ownerKind,
          ...(ownerKind === 'business' ? { displayName: 'WhatsApp Empresa' } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.existingConnectionId) {
          // Já tem — abre QR direto da existente
          setQrConnectionId(data.existingConnectionId);
          await fetchConnections();
          return;
        }
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      await fetchConnections();
      // Abre modal QR pra escaneamento
      setQrConnectionId(data.connection.id);
    } catch (err) {
      console.error('[MyChannelsTab] create failed:', err);
      toast.error(err instanceof Error ? err.message : 'Falha ao criar canal');
    } finally {
      setCreating(false);
    }
  };

  /**
   * Phase 3.1: promove uma connection a primary. Backend faz demote da
   * primary atual automaticamente (PATCH com isPrimary=true).
   */
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
      console.error('[MyChannelsTab] set primary failed:', err);
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
      console.error('[MyChannelsTab] delete failed:', err);
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
      console.error('[MyChannelsTab] rename failed:', err);
      toast.error(err instanceof Error ? err.message : 'Falha ao renomear');
    }
  };

  // Separa em duas seções: canais empresa (compartilhados) e pessoais.
  // Phase 3.1: business pode ter MÚLTIPLOS Baileys; ordena com primary primeiro.
  const businessChannels = connections
    .filter(c => c.ownerType === 'business')
    .sort((a, b) => {
      // Primary primeiro
      if (a.isPrimary && !b.isPrimary) return -1;
      if (!a.isPrimary && b.isPrimary) return 1;
      // Connected antes de desconectado
      if (a.isConnected && !b.isConnected) return -1;
      if (!a.isConnected && b.isConnected) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
  const baileysBusinessChannels = businessChannels.filter(c => c.type === 'whatsapp_baileys');
  const myChannels = connections.filter(c => c.ownerType === 'user' && c.ownerId === userId);
  // Admin também vê canais 'user' de OUTROS operadores
  const otherUserChannels = isAdmin
    ? connections.filter(c => c.ownerType === 'user' && c.ownerId !== userId)
    : [];

  if (!businessId) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-display font-bold text-gray-900 dark:text-gray-100">
          Meus canais
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Conecte seu WhatsApp pessoal de trabalho. As conversas que chegam nele
          aparecem na sua bandeja com o número como remetente.
        </p>
      </div>

      {/* Adicionar canal pessoal */}
      <div className="p-4 rounded-2xl border border-dashed border-gray-300 dark:border-white/[0.1] bg-gray-50/40 dark:bg-white/[0.02]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#25D366]/15 flex items-center justify-center shrink-0">
            <Smartphone className="w-5 h-5 text-[#25D366]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Adicionar WhatsApp pessoal
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              Escaneie o QR Code com o WhatsApp do seu celular pra conectar.
            </p>
          </div>
          <button
            onClick={handleCreatePersonal}
            disabled={creating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#25D366] hover:bg-[#128C7E] text-white disabled:opacity-50 transition-colors shrink-0"
          >
            {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            Conectar
          </button>
        </div>
      </div>

      {/* Lista: Meus canais pessoais */}
      <ConnectionSection
        title="Pessoais"
        subtitle="Canais conectados ao seu próprio número"
        icon={<UserIcon className="w-4 h-4 text-violet-500" />}
        connections={myChannels}
        loading={loading}
        emptyMsg="Nenhum canal pessoal conectado ainda."
        deletingId={deletingId}
        onDelete={handleDelete}
        onConnect={(conn) => setQrConnectionId(conn.id)}
        onRenameStart={(conn) => { setRenamingId(conn.id); setRenameValue(conn.displayName); }}
        renamingId={renamingId}
        renameValue={renameValue}
        onRenameChange={setRenameValue}
        onRenameSubmit={handleRename}
        onRenameCancel={() => { setRenamingId(null); setRenameValue(''); }}
        canManage={() => true}
      />

      {/* Phase 3.1: admin pode adicionar mais Baileys-empresa.
          Útil pra ter número Comercial + Suporte separados, etc. */}
      {isAdmin && (
        <div className="p-4 rounded-2xl border border-dashed border-blue-300 dark:border-blue-500/30 bg-blue-50/30 dark:bg-blue-500/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-500/15 flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Adicionar WhatsApp da empresa
                {baileysBusinessChannels.length > 0 && (
                  <span className="ml-2 text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                    {baileysBusinessChannels.length} já conectados
                  </span>
                )}
              </p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                Conecte mais um número da empresa (ex: Comercial, Suporte). Operadores acessam todos.
                {baileysBusinessChannels.length > 0 && ' O novo canal será secundário — promova como principal depois se quiser.'}
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

      {/* Lista: Canais da empresa */}
      <ConnectionSection
        title="Da empresa"
        subtitle={isAdmin ? 'Compartilhados — você pode promover, renomear e remover.' : 'Compartilhados pela empresa'}
        icon={<Building2 className="w-4 h-4 text-blue-500" />}
        connections={businessChannels}
        loading={loading}
        emptyMsg="A empresa não tem canais conectados."
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

      {/* Admin extra: canais pessoais de outros operadores */}
      {isAdmin && otherUserChannels.length > 0 && (
        <ConnectionSection
          title="Canais pessoais da equipe (admin)"
          subtitle="Visível porque você é admin. Você pode remover ou transferir ownership."
          icon={<UserIcon className="w-4 h-4 text-amber-500" />}
          connections={otherUserChannels}
          loading={false}
          emptyMsg=""
          deletingId={deletingId}
          onDelete={handleDelete}
          onConnect={(conn) => setQrConnectionId(conn.id)}
          onRenameStart={() => {}}
          renamingId={null}
          renameValue=""
          onRenameChange={() => {}}
          onRenameSubmit={() => {}}
          onRenameCancel={() => {}}
          canManage={() => true}
        />
      )}

      {/* QR modal */}
      <AnimatePresence>
        {qrConnectionId && (
          <QrModal
            businessId={businessId}
            connectionId={qrConnectionId}
            onClose={() => { setQrConnectionId(null); void fetchConnections(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
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
  /** Phase 3.1: admin pode promover canal-empresa secundário a principal. */
  onSetPrimary?: (c: ChannelConnection) => void;
}

function ConnectionSection(p: SectionProps) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        {p.icon}
        <div className="flex-1 min-w-0">
          <h3 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
            {p.title}
          </h3>
          <p className="text-[10px] text-gray-400 dark:text-gray-500">{p.subtitle}</p>
        </div>
      </div>
      {p.loading ? (
        <div className="text-xs text-gray-400 py-3">Carregando…</div>
      ) : p.connections.length === 0 ? (
        <div className="text-xs text-gray-400 py-3">{p.emptyMsg}</div>
      ) : (
        <ul className="space-y-2">
          {p.connections.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02]"
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
                <div className="flex items-center gap-2 mt-0.5">
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
                  <span className={cn(
                    'text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                    c.isConnected
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                      : 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400',
                  )}>
                    {c.isConnected ? 'Conectado' : 'Desconectado'}
                  </span>
                  {/* Phase 3.1: badge "Principal" pra connection primária */}
                  {c.ownerType === 'business' && c.isPrimary && (
                    <span
                      title="Canal principal — usado como default em fallbacks"
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                    >
                      PRINCIPAL
                    </span>
                  )}
                </div>
              </div>
              {!p.readonly && p.canManage(c) && (
                <div className="flex items-center gap-1 shrink-0">
                  {/* Phase 3.1: tornar principal (só pra business secundárias) */}
                  {p.onSetPrimary && c.ownerType === 'business' && !c.isPrimary && c.isConnected && (
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
      )}
    </section>
  );
}

interface QrModalProps {
  businessId: string;
  connectionId: string;
  onClose: () => void;
}

function QrModal({ businessId, connectionId, onClose }: QrModalProps) {
  const { firebaseUser } = useAuth();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'connecting' | 'scanning' | 'connected' | 'error'>('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();

    const connect = async () => {
      try {
        const token = await firebaseUser?.getIdToken();
        if (!token || cancelled) return;

        const qs = new URLSearchParams({ businessId, connectionId });
        const url = `/api/whatsapp/connect?${qs.toString()}`;

        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: abortController.signal,
        });

        if (!response.ok || !response.body) {
          if (!cancelled) {
            setStatus('error');
            setErrorMsg('Falha ao conectar com o servidor.');
          }
          return;
        }

        const reader = response.body.getReader();
        readerRef.current = reader;
        const decoder = new TextDecoder();
        let buffer = '';

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'qr') {
                setQrDataUrl(data.qr);
                setStatus('scanning');
              } else if (data.type === 'connected') {
                setStatus('connected');
                setTimeout(onClose, 800);
              } else if (data.type === 'error') {
                setStatus('error');
                setErrorMsg(data.message || 'Erro desconhecido');
              } else if (data.type === 'disconnected') {
                if (data.reason === 'logged_out') {
                  setStatus('error');
                  setErrorMsg('Sessão revogada. Tente novamente.');
                }
              }
            } catch { /* skip malformed line */ }
          }
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setStatus('error');
          setErrorMsg('Erro de conexão.');
          console.error('[MyChannels QR] SSE error:', err);
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
      readerRef.current?.cancel().catch(() => {});
      readerRef.current = null;
      abortController.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, businessId]);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div
        initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 12 }}
        className="relative z-10 w-full max-w-sm bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-black/[0.06] dark:border-white/[0.08] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#25D366]/15 flex items-center justify-center">
              <QrCode className="w-4.5 h-4.5 text-[#25D366]" />
            </div>
            <div>
              <h3 className="font-display font-bold text-gray-900 dark:text-white text-sm">WhatsApp Web</h3>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">Escaneie com seu celular</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-6 py-6 flex flex-col items-center">
          {status === 'connecting' && (
            <div className="w-[240px] h-[240px] rounded-2xl bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/[0.06] flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-8 h-8 text-[#25D366] animate-spin" />
              <p className="text-xs text-gray-500 dark:text-gray-400">Gerando QR Code…</p>
            </div>
          )}
          {status === 'scanning' && qrDataUrl && (
            <div className="flex flex-col items-center gap-4">
              <div className="p-3 bg-white rounded-2xl shadow-lg border border-gray-100">
                <img src={qrDataUrl} alt="WhatsApp QR Code" className="w-[220px] h-[220px]" />
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <div className="w-1.5 h-1.5 rounded-full bg-[#25D366] animate-pulse" />
                Aguardando leitura do QR Code…
              </div>
            </div>
          )}
          {status === 'connected' && (
            <div className="w-[240px] h-[240px] rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex flex-col items-center justify-center gap-3">
              <div className="w-14 h-14 rounded-full bg-[#25D366] flex items-center justify-center">
                <Check className="w-7 h-7 text-white" />
              </div>
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Conectado!</p>
            </div>
          )}
          {status === 'error' && (
            <div className="w-[240px] h-[240px] rounded-2xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 flex flex-col items-center justify-center gap-3 px-4">
              <AlertCircle className="w-8 h-8 text-red-500" />
              <p className="text-xs text-red-700 dark:text-red-400 text-center">{errorMsg}</p>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
