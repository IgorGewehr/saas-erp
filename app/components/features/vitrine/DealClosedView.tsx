'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { CheckCircle2, Loader2, Users, Wallet, ClipboardList, X } from 'lucide-react';
import type { MenuPage } from '@/app/components/layout/Sidebar';
import { db } from '@/lib/config/firebase';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import { formatDateOnly, toLocalDateString } from '@/lib/utils/localDate';
import { centsToMoney } from '@/lib/utils/vitrineProposal';
import type { ApiRequest } from '@/lib/services/vitrine/apiClient';
import { settleReceivable } from '@/lib/services/vitrine/closeDeal';
import type { Transaction } from '@/lib/types';
import type { ClosedDeal } from './useVitrineProposal';

interface DealClosedViewProps {
  deal: ClosedDeal;
  businessId: string;
  /** manager+: lê `transactions` (rules) e registra recebimentos. */
  canSeeReceivables: boolean;
  request: ApiRequest;
  onNewProposal: () => void;
  onNavigate: (page: MenuPage) => void;
  onClose: () => void;
}

const RECEIPT_METHODS = [
  { value: 'pix', label: 'PIX' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'credito', label: 'Cartão de crédito' },
  { value: 'debito', label: 'Cartão de débito' },
  { value: 'outros', label: 'Outro' },
] as const;

type ReceiptMethod = (typeof RECEIPT_METHODS)[number]['value'];

/** Recebíveis gerados pelo pedido, em tempo real — o "Registrar recebimento" aparece pago sozinho. */
function useDealReceivables(businessId: string, orderId: string, enabled: boolean) {
  const [receivables, setReceivables] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) return;
    const receivablesQuery = query(
      collection(db, 'transactions'),
      where('businessId', '==', businessId),
      where('orderId', '==', orderId),
    );
    const unsubscribe = onSnapshot(receivablesQuery, (snapshot) => {
      setReceivables(
        snapshot.docs
          .map((doc) => ({ ...doc.data(), id: doc.id }) as Transaction)
          .filter((transaction) => transaction.type === 'receita' && transaction.status !== 'cancelado')
          .sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0)
            || (a.dueDate ?? '').localeCompare(b.dueDate ?? '')),
      );
      setIsLoading(false);
    }, (error) => {
      console.error('[Vitrine] receivables snapshot error:', error);
      setIsLoading(false);
    });
    return unsubscribe;
  }, [businessId, orderId, enabled]);

  return { receivables, isLoading };
}

export function DealClosedView({ deal, businessId, canSeeReceivables, request, onNewProposal, onNavigate, onClose }: DealClosedViewProps) {
  const { receivables, isLoading } = useDealReceivables(businessId, deal.orderId, canSeeReceivables);
  const received = receivables.filter((transaction) => transaction.status === 'pago').length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end border-b border-gray-100 px-4 py-2 dark:border-gray-800">
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="flex h-12 w-12 touch-manipulation items-center justify-center rounded-full text-gray-500 active:bg-gray-100 dark:active:bg-gray-800"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4">
        <div className="flex flex-col items-center py-4 text-center">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/10">
            <CheckCircle2 className="h-9 w-9 text-emerald-500" />
          </div>
          <h2 className="font-display text-2xl font-bold text-gray-900 dark:text-white">Negócio fechado!</h2>
          <p className="mt-1 text-gray-500 dark:text-gray-400">{deal.client.name}</p>
          <p className="mt-2 font-display text-3xl font-bold text-gray-900 dark:text-white">{formatCurrency(centsToMoney(deal.totalCents))}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {deal.installments > 1 ? `em ${deal.installments} parcelas` : 'à vista'} · pedido #{deal.orderId.slice(-6).toUpperCase()}
          </p>
        </div>

        <section aria-label="Recebimentos">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Recebimentos</h3>
            {canSeeReceivables && receivables.length > 0 && (
              <span className="text-xs text-gray-400">{received}/{receivables.length} recebidos</span>
            )}
          </div>

          {!canSeeReceivables ? (
            <>
              <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100 text-sm dark:divide-gray-800 dark:border-gray-800">
                {deal.schedule.map((entry) => (
                  <li key={entry.number} className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-gray-600 dark:text-gray-300">
                      {deal.schedule.length > 1 ? `Parcela ${entry.number}` : 'Pagamento'} · vence {formatDateOnly(entry.dueDate)}
                    </span>
                    <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(entry.amount)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-gray-400">O registro de recebimentos é feito por um gerente.</p>
            </>
          ) : isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: Math.max(1, deal.transactionIds.length) }, (_, position) => <div key={position} className="h-16 rounded-xl shimmer" />)}
            </div>
          ) : receivables.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-800">
              Os lançamentos ainda não apareceram. Confira em Financeiro.
            </p>
          ) : (
            <ul className="space-y-2">
              {receivables.map((receivable) => (
                <ReceivableRow
                  key={receivable.id}
                  receivable={receivable}
                  total={receivables.length}
                  businessId={businessId}
                  request={request}
                />
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Atalhos" className="grid grid-cols-3 gap-2">
          {canSeeReceivables && <Shortcut icon={Wallet} label="Financeiro" onClick={() => onNavigate('Financeiro')} />}
          <Shortcut icon={Users} label="Clientes" onClick={() => onNavigate('Clientes')} />
          <Shortcut icon={ClipboardList} label="Vendas" onClick={() => onNavigate('Vendas')} />
        </section>
      </div>

      <div className="border-t border-gray-100 p-4 dark:border-gray-800">
        <button
          type="button"
          onClick={onNewProposal}
          className="h-14 w-full touch-manipulation rounded-2xl bg-red-600 text-md font-semibold text-white active:bg-red-700"
        >
          Nova proposta
        </button>
      </div>
    </div>
  );
}

function ReceivableRow({ receivable, total, businessId, request }: { receivable: Transaction; total: number; businessId: string; request: ApiRequest }) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<ReceiptMethod | null>(null);
  const [saving, setSaving] = useState(false);
  const paid = receivable.status === 'pago';
  const number = receivable.installmentNumber;
  const label = useMemo(
    () => (total > 1 ? `Parcela ${number ?? '·'}/${total}` : 'Pagamento'),
    [total, number],
  );

  const confirm = async () => {
    if (!method || saving) return;
    setSaving(true);
    const result = await settleReceivable({
      businessId,
      transactionId: receivable.id,
      paymentMethod: method,
      paymentDate: toLocalDateString(new Date()),
      request,
    });
    setSaving(false);
    if (result.ok) {
      toast.success(result.alreadySettled ? 'Este recebimento já estava registrado.' : 'Recebimento registrado.');
      setOpen(false);
    } else {
      toast.error(result.message);
    }
  };

  return (
    <li className="rounded-2xl border border-gray-100 p-3 dark:border-gray-800">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 dark:text-white">{label}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {paid ? `Recebido em ${formatDateOnly(receivable.paymentDate)}` : `Vence ${formatDateOnly(receivable.dueDate)}`}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-3">
          <p className="font-bold text-gray-900 dark:text-white">{formatCurrency(receivable.amount)}</p>
          {paid ? (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">Recebido</span>
          ) : (
            <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              aria-expanded={open}
              className="h-11 touch-manipulation rounded-xl border border-red-200 px-3 text-sm font-semibold text-red-600 active:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:active:bg-red-500/10"
            >
              Receber
            </button>
          )}
        </div>
      </div>

      {open && !paid && (
        <div className="mt-3 space-y-3 border-t border-gray-100 pt-3 dark:border-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">Como o cliente pagou?</p>
          <div className="flex flex-wrap gap-2">
            {RECEIPT_METHODS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={method === option.value}
                onClick={() => setMethod(option.value)}
                className={cn(
                  'h-11 touch-manipulation rounded-full px-4 text-sm font-medium transition-colors',
                  method === option.value
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-100 text-gray-600 active:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:active:bg-gray-700',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={!method || saving}
            className="flex h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white active:bg-emerald-700 disabled:opacity-40"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmar recebimento de {formatCurrency(receivable.amount)}
          </button>
        </div>
      )}
    </li>
  );
}

function Shortcut({ icon: Icon, label, onClick }: { icon: React.ElementType; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[4rem] touch-manipulation flex-col items-center justify-center gap-1 rounded-2xl border border-gray-100 text-xs font-medium text-gray-600 active:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:active:bg-gray-900"
    >
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );
}
