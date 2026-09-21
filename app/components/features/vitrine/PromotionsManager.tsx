'use client';

import { useEffect, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { motion } from 'framer-motion';
import { toast } from 'react-toastify';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import { db } from '@/lib/config/firebase';
import { cn } from '@/lib/utils';
import { generateIdempotencyKey } from '@/lib/utils/idempotencyKey';
import { toLocalDateString } from '@/lib/utils/localDate';
import {
  describePromotionTerms,
  describePromotionValue,
  parsePromotionForm,
  promotionStatus,
  removePromotion,
  setPromotionActive,
  upsertPromotion,
  type PromotionFormErrors,
  type PromotionFormInput,
  type PromotionStatus,
} from '@/lib/utils/promotionForm';
import type { BusinessPromotion } from '@/lib/types';

interface PromotionsManagerProps {
  businessId: string;
  /** Lista completa de `settings.promotions` (ativas, inativas e vencidas). */
  promotions: BusinessPromotion[];
  onClose: () => void;
}

const EMPTY_FORM: PromotionFormInput = { name: '', type: 'percentage', valueText: '', minOrderText: '', validUntil: '' };

const STATUS_LABEL: Record<PromotionStatus, { text: string; className: string }> = {
  active: { text: 'Ativa', className: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' },
  inactive: { text: 'Desativada', className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
  expired: { text: 'Vencida', className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' },
};

const INPUT_CLASS =
  'h-12 w-full rounded-xl border border-gray-200 bg-white px-4 text-[16px] text-gray-900 placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white';

/** Escreve `settings.promotions` inteiro (mesmo padrão dos demais campos de `settings`); só admin+ (rules). */
async function savePromotions(businessId: string, promotions: BusinessPromotion[]): Promise<void> {
  await updateDoc(doc(db, 'businesses', businessId), {
    'settings.promotions': promotions,
    updatedAt: new Date().toISOString(),
  });
}

/** Renderizado pelo módulo num portal em `document.body`, só com a aba Vitrine ativa. */
export function PromotionsManager({ businessId, promotions, onClose }: PromotionsManagerProps) {
  const [form, setForm] = useState<PromotionFormInput>(EMPTY_FORM);
  const [errors, setErrors] = useState<PromotionFormErrors>({});
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [saving, onClose]);

  const persist = async (next: BusinessPromotion[], successMessage: string): Promise<boolean> => {
    setSaving(true);
    try {
      await savePromotions(businessId, next);
      toast.success(successMessage, { autoClose: 2000 });
      return true;
    } catch (error) {
      console.error('[Vitrine] falha ao salvar promoções:', error);
      toast.error('Não foi possível salvar. Confirme que você é administrador e tente de novo.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    if (saving) return;
    const parsed = parsePromotionForm(form, toLocalDateString(new Date()));
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    const promotion: BusinessPromotion = { id: generateIdempotencyKey(), isActive: true, ...parsed.value };
    if (await persist(upsertPromotion(promotions, promotion), 'Promoção criada.')) setForm(EMPTY_FORM);
  };

  const update = (patch: Partial<PromotionFormInput>) => setForm((current) => ({ ...current, ...patch }));
  const now = new Date();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 md:items-center md:p-6"
      onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Promoções"
        initial={{ opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 32 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-gray-950 md:rounded-3xl"
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-4 py-2 dark:border-gray-800">
          <h2 className="font-display text-lg font-bold text-gray-900 dark:text-white">Promoções</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Fechar"
            className="flex h-12 w-12 touch-manipulation items-center justify-center rounded-full text-gray-500 active:bg-gray-100 disabled:opacity-40 dark:active:bg-gray-800"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4">
          <section aria-label="Promoções cadastradas">
            {promotions.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                Nenhuma promoção cadastrada.
              </p>
            ) : (
              <ul className="space-y-2">
                {promotions.map((promotion) => {
                  const status = promotionStatus(promotion, now);
                  const terms = describePromotionTerms(promotion);
                  return (
                    <li key={promotion.id} className="rounded-2xl border border-gray-100 p-3 dark:border-gray-800">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-gray-900 dark:text-white">{promotion.name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {describePromotionValue(promotion)}{terms && ` · ${terms}`}
                          </p>
                        </div>
                        <span className={cn('flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', STATUS_LABEL[status].className)}>
                          {STATUS_LABEL[status].text}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void persist(setPromotionActive(promotions, promotion.id, !promotion.isActive), promotion.isActive ? 'Promoção desativada.' : 'Promoção ativada.')}
                          className="h-11 touch-manipulation rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-700 active:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:active:bg-gray-900"
                        >
                          {promotion.isActive ? 'Desativar' : 'Ativar'}
                        </button>
                        {confirmingDelete === promotion.id ? (
                          <>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={async () => {
                                if (await persist(removePromotion(promotions, promotion.id), 'Promoção excluída.')) setConfirmingDelete(null);
                              }}
                              className="h-11 touch-manipulation rounded-xl bg-red-600 px-4 text-sm font-semibold text-white active:bg-red-700 disabled:opacity-50"
                            >
                              Confirmar exclusão
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingDelete(null)}
                              className="h-11 touch-manipulation rounded-xl px-3 text-sm font-medium text-gray-500"
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => setConfirmingDelete(promotion.id)}
                            aria-label={`Excluir ${promotion.name}`}
                            className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-xl text-gray-400 active:bg-gray-100 disabled:opacity-50 dark:active:bg-gray-800"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-label="Nova promoção" className="space-y-4 rounded-2xl bg-gray-50 p-4 dark:bg-gray-900">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Nova promoção</h3>

            <Field label="Nome" error={errors.name}>
              <input value={form.name} onChange={(event) => update({ name: event.target.value })} placeholder="Ex.: Lançamento de setembro" autoComplete="off" className={INPUT_CLASS} />
            </Field>

            <div role="radiogroup" aria-label="Tipo de desconto" className="grid grid-cols-2 gap-2">
              {([['percentage', 'Percentual (%)'], ['fixed', 'Valor fixo (R$)']] as const).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={form.type === type}
                  onClick={() => update({ type })}
                  className={cn(
                    'h-12 touch-manipulation rounded-xl text-sm font-medium transition-colors',
                    form.type === type
                      ? 'bg-red-600 text-white shadow-sm shadow-red-500/25'
                      : 'bg-white text-gray-600 active:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:active:bg-gray-700',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <Field label={form.type === 'percentage' ? 'Percentual de desconto' : 'Valor do desconto (R$)'} error={errors.valueText}>
              <input
                inputMode="decimal"
                value={form.valueText}
                onChange={(event) => update({ valueText: event.target.value })}
                placeholder={form.type === 'percentage' ? 'Ex.: 10' : 'Ex.: 200,00'}
                className={INPUT_CLASS}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Pedido mínimo (R$, opcional)" error={errors.minOrderText}>
                <input inputMode="decimal" value={form.minOrderText} onChange={(event) => update({ minOrderText: event.target.value })} placeholder="Ex.: 1.500,00" className={INPUT_CLASS} />
              </Field>
              <Field label="Válida até (opcional)" error={errors.validUntil}>
                <input type="date" value={form.validUntil} onChange={(event) => update({ validUntil: event.target.value })} className={INPUT_CLASS} />
              </Field>
            </div>

            <button
              type="button"
              onClick={() => void create()}
              disabled={saving}
              className="flex h-14 w-full touch-manipulation items-center justify-center gap-2 rounded-2xl bg-red-600 text-md font-semibold text-white active:bg-red-700 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
              Criar promoção
            </button>
          </section>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
      {children}
      {error && <span role="alert" className="mt-1 block text-xs text-red-600 dark:text-red-400">{error}</span>}
    </label>
  );
}
