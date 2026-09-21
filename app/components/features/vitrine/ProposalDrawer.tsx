'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, ChevronRight, Loader2, Minus, Plus, Trash2, User, X } from 'lucide-react';
import type { MenuPage } from '@/app/components/layout/Sidebar';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import { formatDateOnly } from '@/lib/utils/localDate';
import { centsToMoney, lineKey, lineTotalCents } from '@/lib/utils/vitrineProposal';
import type { ApiRequest } from '@/lib/services/vitrine/apiClient';
import type { CloseDealStep } from '@/lib/services/vitrine/closeDeal';
import type { BusinessPromotion } from '@/lib/types';
import { ClientPicker } from './ClientPicker';
import { DealClosedView } from './DealClosedView';
import { INSTALLMENT_OPTIONS, type VitrineProposal } from './useVitrineProposal';

interface ProposalDrawerProps {
  proposal: VitrineProposal;
  businessId: string;
  activePromotions: BusinessPromotion[];
  /** manager+: negocia valor e aplica promoção. */
  canNegotiate: boolean;
  canSeeReceivables: boolean;
  request: ApiRequest;
  onClose: () => void;
  onNavigate: (page: MenuPage) => void;
}

const STEP_LABEL: Record<CloseDealStep, string> = {
  create: 'Criando o pedido…',
  confirm: 'Confirmando o pedido…',
  invoice: 'Faturando e gerando as parcelas…',
};

const CHIP = 'h-11 shrink-0 touch-manipulation rounded-full px-4 text-sm font-medium transition-colors';
const CHIP_IDLE = 'bg-gray-100 text-gray-600 active:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:active:bg-gray-700';
const CHIP_ON = 'bg-red-600 text-white shadow-sm shadow-red-500/25';

/** Renderizado pelo módulo num portal em `document.body`, só com a aba Vitrine ativa. */
export function ProposalDrawer(props: ProposalDrawerProps) {
  const { proposal, onClose } = props;
  const [view, setView] = useState<'proposal' | 'client'>('proposal');
  const closing = proposal.phase.kind === 'closing';

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !closing) onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [closing, onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex justify-end bg-black/60"
      onClick={(event) => { if (event.target === event.currentTarget && !closing) onClose(); }}
    >
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-label="Proposta"
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 40 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="flex h-full w-full flex-col bg-white shadow-2xl dark:bg-gray-950 md:max-w-[480px]"
      >
        {proposal.phase.kind === 'done' ? (
          <DealClosedView
            deal={proposal.phase.deal}
            businessId={props.businessId}
            canSeeReceivables={props.canSeeReceivables}
            request={props.request}
            onNewProposal={() => { proposal.reset(); setView('proposal'); }}
            onNavigate={props.onNavigate}
            onClose={onClose}
          />
        ) : view === 'client' ? (
          <ClientPicker
            businessId={props.businessId}
            selected={proposal.client}
            onSelect={(client) => { proposal.chooseClient(client); setView('proposal'); }}
            onBack={() => setView('proposal')}
          />
        ) : (
          <ProposalEditor {...props} onPickClient={() => setView('client')} />
        )}
      </motion.aside>
    </motion.div>
  );
}

function ProposalEditor({
  proposal,
  activePromotions,
  canNegotiate,
  onClose,
  onNavigate,
  onPickClient,
}: ProposalDrawerProps & { onPickClient: () => void }) {
  const { phase, totals, lines, editable } = proposal;
  const closing = phase.kind === 'closing';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2 dark:border-gray-800">
        <h2 className="font-display text-lg font-bold text-gray-900 dark:text-white">Proposta</h2>
        <button
          type="button"
          onClick={onClose}
          disabled={closing}
          aria-label="Fechar proposta"
          className="flex h-12 w-12 touch-manipulation items-center justify-center rounded-full text-gray-500 active:bg-gray-100 disabled:opacity-40 dark:active:bg-gray-800"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4">
        <button
          type="button"
          onClick={onPickClient}
          disabled={!editable}
          className="flex min-h-[3.5rem] w-full touch-manipulation items-center gap-3 rounded-2xl border border-gray-200 px-4 py-2 text-left active:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:active:bg-gray-900"
        >
          <User className="h-5 w-5 flex-shrink-0 text-gray-400" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-400 dark:text-gray-500">Cliente</p>
            <p className={cn('truncate font-semibold', proposal.client ? 'text-gray-900 dark:text-white' : 'text-red-600 dark:text-red-400')}>
              {proposal.client?.name ?? 'Escolher cliente'}
            </p>
          </div>
          {editable && <ChevronRight className="h-5 w-5 flex-shrink-0 text-gray-300" />}
        </button>

        <section aria-label="Itens da proposta">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Itens</h3>
          {lines.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
              Toque em um item do catálogo e em “Adicionar à proposta”.
            </p>
          ) : (
            <ul className="space-y-2">
              {lines.map((line) => {
                const key = lineKey(line);
                return (
                  <li key={key} className="rounded-2xl border border-gray-100 p-3 dark:border-gray-800">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold leading-snug text-gray-900 dark:text-white">{line.name}</p>
                        {line.variantName && <p className="text-xs text-gray-500 dark:text-gray-400">{line.variantName}</p>}
                        <p className="mt-0.5 text-xs text-gray-400">{formatCurrency(centsToMoney(line.unitPriceCents))} cada</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => proposal.removeItem(key)}
                        disabled={!editable}
                        aria-label={`Remover ${line.name}`}
                        className="flex h-11 w-11 flex-shrink-0 touch-manipulation items-center justify-center rounded-full text-gray-400 active:bg-gray-100 disabled:opacity-30 dark:active:bg-gray-800"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <StepButton label="Diminuir quantidade" disabled={!editable} onClick={() => proposal.setQuantity(key, line.quantity - 1)}>
                          <Minus className="h-4 w-4" />
                        </StepButton>
                        <span className="w-10 text-center text-md font-semibold tabular-nums text-gray-900 dark:text-white">{line.quantity}</span>
                        <StepButton label="Aumentar quantidade" disabled={!editable} onClick={() => proposal.setQuantity(key, line.quantity + 1)}>
                          <Plus className="h-4 w-4" />
                        </StepButton>
                      </div>
                      <p className="font-bold text-gray-900 dark:text-white">{formatCurrency(centsToMoney(lineTotalCents(line)))}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {canNegotiate && lines.length > 0 && (
          <section aria-label="Negociação" className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Negociação</h3>
            {activePromotions.length > 0 && (
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-hide">
                {activePromotions.map((promotion) => {
                  const on = proposal.promotionId === promotion.id;
                  return (
                    <button
                      key={promotion.id}
                      type="button"
                      aria-pressed={on}
                      disabled={!editable}
                      onClick={() => proposal.choosePromotion(on ? null : promotion.id)}
                      className={cn(CHIP, on ? CHIP_ON : CHIP_IDLE, 'disabled:opacity-60')}
                    >
                      {promotion.name} · {promotion.type === 'percentage' ? `${promotion.value}%` : formatCurrency(promotion.value)}
                    </button>
                  );
                })}
              </div>
            )}
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Valor negociado (total)</span>
              {/* 16px: abaixo disso o iPad dá zoom no foco do campo. */}
              <input
                inputMode="decimal"
                value={proposal.negotiatedText}
                onChange={(event) => proposal.setNegotiatedText(event.target.value)}
                disabled={!editable}
                placeholder={`Ex.: ${formatCurrency(centsToMoney(totals.subtotalCents)).replace(/^R\$\s?/, '')}`}
                aria-invalid={proposal.negotiatedInvalid}
                className="h-12 w-full rounded-xl border border-gray-200 bg-white px-4 text-[16px] text-gray-900 placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </label>
          </section>
        )}

        {lines.length > 0 && (
          <section aria-label="Pagamento" className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Pagamento</h3>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-hide">
              {INSTALLMENT_OPTIONS.map((count) => (
                <button
                  key={count}
                  type="button"
                  aria-pressed={proposal.installments === count}
                  disabled={!editable}
                  onClick={() => proposal.chooseInstallments(count)}
                  className={cn(CHIP, proposal.installments === count ? CHIP_ON : CHIP_IDLE, 'disabled:opacity-60')}
                >
                  {count === 1 ? 'À vista' : `${count}x`}
                </button>
              ))}
            </div>
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100 text-sm dark:divide-gray-800 dark:border-gray-800">
              {totals.schedule.map((entry) => (
                <li key={entry.number} className="flex items-center justify-between px-3 py-2">
                  <span className="text-gray-600 dark:text-gray-300">
                    {totals.schedule.length > 1 ? `Parcela ${entry.number}` : 'Pagamento'} · {formatDateOnly(entry.dueDate)}
                  </span>
                  <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(entry.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {phase.kind === 'stale' && (
          <Notice tone="amber">{phase.message} Os preços já foram atualizados — confira o total e feche de novo.</Notice>
        )}
        {phase.kind === 'failed' && (
          <FailedNotice proposal={proposal} onNavigate={onNavigate} />
        )}
        {editable && proposal.blockers.length > 0 && lines.length > 0 && (
          <Notice tone="amber">
            <ul className="space-y-1">
              {proposal.blockers.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </Notice>
        )}
      </div>

      <div className="space-y-3 border-t border-gray-100 p-4 dark:border-gray-800">
        <dl className="space-y-1 text-sm">
          {totals.discountCents > 0 && (
            <>
              <div className="flex justify-between text-gray-500 dark:text-gray-400">
                <dt>Subtotal</dt>
                <dd>{formatCurrency(centsToMoney(totals.subtotalCents))}</dd>
              </div>
              <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                <dt>Desconto{totals.discountReason ? ` (${totals.discountReason})` : ''}</dt>
                <dd>− {formatCurrency(centsToMoney(totals.discountCents))}</dd>
              </div>
            </>
          )}
          <div className="flex items-baseline justify-between">
            <dt className="font-medium text-gray-700 dark:text-gray-300">Total</dt>
            <dd className="font-display text-2xl font-bold text-gray-900 dark:text-white">{formatCurrency(centsToMoney(totals.totalCents))}</dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={() => void proposal.close()}
          disabled={!proposal.canClose}
          className="flex h-14 w-full touch-manipulation items-center justify-center gap-2 rounded-2xl bg-red-600 text-md font-semibold text-white shadow-sm shadow-red-500/25 transition-colors active:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none dark:disabled:bg-gray-800 dark:disabled:text-gray-500"
        >
          {closing ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              {STEP_LABEL[phase.step]}
            </>
          ) : (
            'Fechar negócio'
          )}
        </button>
      </div>
    </div>
  );
}

function FailedNotice({ proposal, onNavigate }: { proposal: VitrineProposal; onNavigate: (page: MenuPage) => void }) {
  const { phase } = proposal;
  const [busy, setBusy] = useState(false);
  if (phase.kind !== 'failed') return null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); } finally { setBusy(false); }
  };

  return (
    <Notice tone="red">
      <p className="font-medium">{phase.message}</p>
      <p className="mt-1 text-xs opacity-80">
        {phase.orderId
          ? 'O pedido já foi criado. Tente de novo pra concluir, ou descarte para editar a proposta.'
          : 'Se o pedido chegou a ser criado, ele aparece em Vendas. Tente de novo ou descarte para editar.'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {phase.retryable && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => proposal.retry())}
            className="h-11 touch-manipulation rounded-xl bg-red-600 px-4 text-sm font-semibold text-white active:bg-red-700 disabled:opacity-60"
          >
            Tentar de novo
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => proposal.discard())}
          className="h-11 touch-manipulation rounded-xl border border-red-300 px-4 text-sm font-semibold text-red-700 active:bg-red-100 disabled:opacity-60 dark:border-red-500/40 dark:text-red-300 dark:active:bg-red-500/20"
        >
          Descartar e editar
        </button>
        {phase.orderId && (
          <button
            type="button"
            onClick={() => onNavigate('Vendas')}
            className="h-11 touch-manipulation rounded-xl px-4 text-sm font-medium text-red-700 underline dark:text-red-300"
          >
            Ver em Vendas
          </button>
        )}
      </div>
    </Notice>
  );
}

function Notice({ tone, children }: { tone: 'amber' | 'red'; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        'flex gap-2 rounded-2xl px-3 py-3 text-sm',
        tone === 'amber'
          ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300'
          : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function StepButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full bg-gray-100 text-gray-700 active:bg-gray-200 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-200 dark:active:bg-gray-700"
    >
      {children}
    </button>
  );
}
