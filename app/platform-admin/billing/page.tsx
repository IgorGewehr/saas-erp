'use client';

/**
 * app/platform-admin/billing/page.tsx
 *
 * Painel do OPERADOR DA PLATAFORMA (M12) — lista todas as businesses com
 * status de assinatura do próprio SaaS, permite gerar link de checkout pras
 * que ainda não têm assinatura ativa/pendente. Cross-tenant por natureza —
 * não é uma aba de Settings (que é por-tenant).
 *
 * Sem allowlist duplicada no client: a real autorização é server-side
 * (lib/utils/verifyPlatformOperator.ts, allowlist via env var). Esta página
 * só tenta carregar os dados — se o servidor devolver 401/403, mostra
 * "acesso restrito". Duplicar a allowlist aqui só criaria risco de
 * dessincronia sem ganho de segurança real (o client nunca é a fonte da
 * verdade de autorização).
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { Loader2, RefreshCw, Copy, Check, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'react-toastify';

type SubscriptionStatus = 'pending_payment' | 'active' | 'overdue' | 'cancelled';

interface SubscriptionRow {
  businessId: string;
  businessName: string;
  subscription: {
    status: SubscriptionStatus;
    checkoutUrl?: string;
    nextBillingDate?: string;
    lastPaymentAt?: string;
  } | null;
}

const STATUS_CONFIG: Record<SubscriptionStatus, { label: string; className: string }> = {
  pending_payment: { label: 'Aguardando pagamento', className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' },
  active: { label: 'Em dia', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' },
  overdue: { label: 'Inadimplente', className: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400' },
  cancelled: { label: 'Cancelada', className: 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400' },
};

function formatDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
  } catch {
    return '—';
  }
}

export default function PlatformBillingPage() {
  const { firebaseUser, isLoading: authLoading } = useAuth();
  const [rows, setRows] = useState<SubscriptionRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [copiedFor, setCopiedFor] = useState<string | null>(null);
  // Dormente até MP_PLATFORM_ACCESS_TOKEN existir (decisão do usuário —
  // configurar PLATFORM_OPERATOR_EMAILS primeiro, MP depois). Esconde a
  // ação de gerar checkout em vez de deixar clicar e tomar erro.
  const [mpConfigured, setMpConfigured] = useState(true);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/admin/platform-billing/subscriptions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        setForbidden(true);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRows(data.subscriptions);
      setMpConfigured(!!data.mpConfigured);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar assinaturas');
    } finally {
      setLoading(false);
    }
  }, [firebaseUser]);

  useEffect(() => { load(); }, [load]);

  const handleGenerateCheckout = async (businessId: string) => {
    if (!firebaseUser) return;
    setGeneratingFor(businessId);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/admin/platform-billing/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ businessId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success(data.alreadyExisted ? 'Link já existente reaproveitado' : 'Link de cobrança gerado');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao gerar link de cobrança');
    } finally {
      setGeneratingFor(null);
    }
  };

  const handleCopy = async (businessId: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedFor(businessId);
      setTimeout(() => setCopiedFor((prev) => (prev === businessId ? null : prev)), 2000);
    } catch {
      toast.error('Não foi possível copiar o link');
    }
  };

  if (authLoading || (loading && rows === null && !forbidden && !error)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-[#0B0F19]">
        <Loader2 className="w-8 h-8 animate-spin text-red-500" />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-[#0B0F19] p-6">
        <div className="text-center max-w-sm">
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">Acesso restrito</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Este painel é exclusivo do operador da plataforma.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0B0F19] p-6 sm:p-10">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 font-display">Billing da plataforma</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Status de assinatura de cada tenant — sem bloqueio automático (M12 v1).
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-white/5 disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            Atualizar
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {!mpConfigured && (
          <div className="mb-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            Cobrança via Mercado Pago ainda não configurada — defina <code className="font-mono text-xs">MP_PLATFORM_ACCESS_TOKEN</code> e <code className="font-mono text-xs">MP_PLATFORM_WEBHOOK_SECRET</code> pra habilitar a geração de link de cobrança. Por enquanto, só a listagem funciona.
          </div>
        )}

        <div className="bg-white dark:bg-[#111827] rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  <th className="px-4 py-3">Negócio</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Próxima cobrança</th>
                  <th className="px-4 py-3">Último pagamento</th>
                  <th className="px-4 py-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((row) => {
                  const sub = row.subscription;
                  const status = sub?.status;
                  const needsCheckout = !sub || sub.status === 'cancelled';
                  return (
                    <tr key={row.businessId} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                      <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">{row.businessName}</td>
                      <td className="px-4 py-3">
                        {status ? (
                          <span className={cn('inline-flex px-2 py-0.5 rounded-full text-xs font-semibold', STATUS_CONFIG[status].className)}>
                            {STATUS_CONFIG[status].label}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">Sem assinatura</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{formatDate(sub?.nextBillingDate)}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{formatDate(sub?.lastPaymentAt)}</td>
                      <td className="px-4 py-3 text-right">
                        {needsCheckout ? (
                          mpConfigured ? (
                            <button
                              type="button"
                              onClick={() => handleGenerateCheckout(row.businessId)}
                              disabled={generatingFor === row.businessId}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-50"
                            >
                              {generatingFor === row.businessId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                              Gerar link de cobrança
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400">Aguardando configuração do MP</span>
                          )
                        ) : sub?.checkoutUrl ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <a
                              href={sub.checkoutUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              Abrir
                            </a>
                            <button
                              type="button"
                              onClick={() => handleCopy(row.businessId, sub.checkoutUrl!)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5"
                            >
                              {copiedFor === row.businessId ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                              {copiedFor === row.businessId ? 'Copiado' : 'Copiar link'}
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {rows?.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">Nenhuma business encontrada.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
