'use client';

/**
 * ValidatorChipSection — seção dedicada do chip validador dentro da aba
 * Canais (Settings).
 *
 * Esse "chip" é um WhatsApp Web (Baileys) marcado com purpose='validator'.
 * Ele NUNCA envia mensagens — serve apenas pra checar via `sock.onWhatsApp([num])`
 * se números têm WhatsApp antes de uma campanha em massa, evitando que o
 * chip principal (Cloud ou outro Baileys) tome `Message undeliverable` em
 * lote e perca reputação na Meta.
 *
 * Decisões de design (intencionais):
 *  - **Card visual MUITO distinto** (amber/warning) pra não confundir com
 *    canais de envio. Operador olhando rápido reconhece: "esse é especial".
 *  - **Aviso prominente** explicando que NÃO envia. Sem isso operador
 *    poderia pensar "ah, conectei um WhatsApp novo, vou usar pra campanha".
 *  - **1 validator por business** (limite enforçado no backend e na UI).
 *    Limite simples evita ambiguidade ("qual validator usar?"); pode aumentar
 *    depois se uso real exigir rotação.
 *  - **Sem botão de renomear, sem promover a principal**: validator é
 *    one-shot — conecta, usa, remove. Mexer em metadata só dá margem pra
 *    confusão. (Backend já bloqueia isPrimary=true em validators e a
 *    mutação de purpose é imutável.)
 */

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Shield, Plus, Loader2, Trash2, RefreshCw, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { toast } from 'react-toastify';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { ChannelConnection } from '@/lib/types';
import BaileysQrModal from './BaileysQrModal';

export default function ValidatorChipSection() {
  const { user, business } = useAuth();
  const businessId = business?.id;
  const isAdmin = !!user && ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY['admin'];

  const [validator, setValidator] = useState<ChannelConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [qrConnectionId, setQrConnectionId] = useState<string | null>(null);

  const fetchValidator = useCallback(async () => {
    if (!businessId) return;
    try {
      const { getAuth } = await import('firebase/auth');
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch(`/api/channels/connections?businessId=${encodeURIComponent(businessId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const all = (data.connections || []) as ChannelConnection[];
      const v = all.find(c => c.purpose === 'validator') || null;
      setValidator(v);
    } catch (err) {
      console.error('[ValidatorChipSection] fetch failed:', err);
      // Falha silenciosa — não polui a UI com toast pq esta seção é
      // secundária. O BusinessChannelsSection acima já reporta falhas
      // do mesmo endpoint.
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { void fetchValidator(); }, [fetchValidator]);

  // Polling rápido enquanto QR modal aberto — pega o "Conectado!" e fecha.
  useEffect(() => {
    if (!qrConnectionId) return;
    const t = setInterval(() => { void fetchValidator(); }, 3_000);
    return () => clearInterval(t);
  }, [qrConnectionId, fetchValidator]);

  const handleConnect = async () => {
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
          purpose: 'validator',
          displayName: 'Chip validador',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.existingConnectionId) {
          // Já existe — abre QR do existente direto
          setQrConnectionId(data.existingConnectionId);
          await fetchValidator();
          return;
        }
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      await fetchValidator();
      setQrConnectionId(data.connection.id);
    } catch (err) {
      console.error('[ValidatorChipSection] create failed:', err);
      toast.error(err instanceof Error ? err.message : 'Falha ao criar chip validador');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!validator) return;
    if (!confirm('Remover o chip validador? A higienização de campanhas vai parar de funcionar até reconectar.')) return;
    setDeleting(true);
    try {
      const { getAuth } = await import('firebase/auth');
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch(`/api/channels/connections/${validator.id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      toast.success('Chip validador removido.');
      await fetchValidator();
    } catch (err) {
      console.error('[ValidatorChipSection] delete failed:', err);
      toast.error(err instanceof Error ? err.message : 'Falha ao remover');
    } finally {
      setDeleting(false);
    }
  };

  if (!businessId) return null;

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-display font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Shield className="w-4 h-4 text-amber-500" />
          Chip validador
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[9px] font-bold uppercase tracking-wider">
            <AlertTriangle className="w-2.5 h-2.5" />
            Não envia
          </span>
        </h3>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
          Chip especial usado APENAS pra checar se números têm WhatsApp antes de campanhas em massa.
        </p>
      </div>

      {/* Card destacado em amber pra fixar visualmente que é um canal especial,
          distinto dos "WhatsApp da empresa" acima. */}
      <div className="p-4 rounded-2xl border-2 border-amber-300 dark:border-amber-500/40 bg-amber-50/60 dark:bg-amber-500/[0.07]">
        {/* Aviso prominente — operador olhando rápido NÃO pode confundir esse
            chip com um WhatsApp de envio. Repetimos a explicação aqui mesmo
            estando no header da seção, porque a margem de erro é alta
            (queimar o validator = perder a higienização da campanha inteira). */}
        <div className="flex items-start gap-3 mb-3 pb-3 border-b border-amber-200/60 dark:border-amber-500/20">
          <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center shrink-0">
            <Shield className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-amber-800 dark:text-amber-300 leading-relaxed">
              Pra que serve este chip
            </p>
            <p className="text-[11px] text-amber-700/90 dark:text-amber-400/90 mt-1 leading-relaxed">
              Antes de disparar uma campanha pra muitos contatos, o sistema pergunta
              pro WhatsApp aqui &quot;esse número existe?&quot; — assim removemos da lista os
              números inválidos ou que não usam WhatsApp, evitando que o seu chip
              principal perca reputação na Meta. <strong>Este chip NUNCA envia
              mensagens</strong> — ele só consulta. Recomendamos usar um número
              descartável (chip pré-pago, número novo), porque o uso intensivo de
              consulta pode eventualmente bloquear o número.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="text-xs text-gray-400 py-2">Carregando…</div>
        ) : validator ? (
          // Validator já conectado — mostra status e botões mínimos
          <div className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-white/[0.02] border border-amber-200 dark:border-amber-500/20">
            <div className={cn(
              'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
              validator.isConnected
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : 'bg-gray-200 dark:bg-white/[0.06] text-gray-500',
            )}>
              <Shield className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                {validator.displayName}
              </p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {validator.phoneNumber && (
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 font-mono">
                    +{validator.phoneNumber}
                  </span>
                )}
                {validator.isConnected ? (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                    Conectado
                  </span>
                ) : (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                    Desconectado
                  </span>
                )}
                <span
                  title="Este chip apenas consulta. Não envia mensagens."
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                >
                  VALIDADOR
                </span>
              </div>
            </div>
            {isAdmin && (
              <div className="flex items-center gap-1 shrink-0">
                {!validator.isConnected && (
                  <button
                    onClick={() => setQrConnectionId(validator.id)}
                    title="Reconectar / mostrar QR"
                    className="p-1.5 rounded-lg text-[#25D366] hover:bg-[#25D366]/10 transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  title="Remover chip validador"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                >
                  {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            )}
          </div>
        ) : (
          // Sem validator ainda — CTA pra conectar (admin only).
          // Pra não-admin: mostra placeholder informativo de "ainda não configurado".
          isAdmin ? (
            <button
              onClick={handleConnect}
              disabled={creating}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50 transition-colors"
            >
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Conectar chip validador
            </button>
          ) : (
            <div className="text-[11px] text-amber-700/80 dark:text-amber-400/80 italic py-2">
              Nenhum chip validador configurado. Peça pra um admin conectar pra usar higienização em campanhas.
            </div>
          )
        )}
      </div>

      {/* QR modal compartilhado com BusinessChannelsSection — passa título
          customizado pra deixar claro que é o chip validador (e não um WA
          de envio) sendo conectado. */}
      <AnimatePresence>
        {qrConnectionId && (
          <BaileysQrModal
            businessId={businessId}
            connectionId={qrConnectionId}
            onClose={() => { setQrConnectionId(null); void fetchValidator(); }}
            title="Chip validador"
            subtitle="Escaneie com o número descartável"
          />
        )}
      </AnimatePresence>
    </section>
  );
}
