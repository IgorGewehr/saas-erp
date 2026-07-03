'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import {
  collection, query, where, orderBy, onSnapshot, getDocs,
  addDoc, updateDoc, deleteDoc, doc, deleteField,
} from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { ROLE_HIERARCHY } from '@/lib/types';
import {
  CouponSchema, COUPON_CODE_REGEX,
  type Coupon, type CouponDiscountType, type CouponStatus, type CouponAppliesTo,
} from '@/lib/contracts/domain/coupon';
import { assertTransitionCoupon } from '@/lib/contracts/fsm/coupon';
import { normalizeCouponCode, deriveCouponStatus } from '@/lib/services/orders/coupons';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import {
  Plus, Ticket, Trash2, X, Check, Pause, Play, Percent, DollarSign, Truck,
  Infinity as InfinityIcon,
} from 'lucide-react';

interface Props {
  businessId: string;
}

const DISCOUNT_TYPES: { value: CouponDiscountType; label: string; icon: React.ElementType }[] = [
  { value: 'percent', label: 'Percentual (%)', icon: Percent },
  { value: 'fixed', label: 'Valor fixo (R$)', icon: DollarSign },
  { value: 'free_delivery', label: 'Frete grátis', icon: Truck },
];

const APPLIES_TO: { value: CouponAppliesTo; label: string }[] = [
  { value: 'all', label: 'Entrega e retirada' },
  { value: 'entrega', label: 'Só entrega' },
  { value: 'retirada', label: 'Só retirada' },
];

const STATUS_BADGE: Record<CouponStatus, { label: string; className: string }> = {
  active: { label: 'Ativo', className: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  paused: { label: 'Pausado', className: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  expired: { label: 'Expirado', className: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400' },
  exhausted: { label: 'Esgotado', className: 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400' },
};

interface FormState {
  code: string;
  description: string;
  discountType: CouponDiscountType;
  discountValue: string;
  maxDiscountAmount: string;
  minOrderValue: string;
  appliesTo: CouponAppliesTo;
  firstOrderOnly: boolean;
  usageLimit: string;
  usageLimitPerClient: string;
  startsAt: string;
  endsAt: string;
}

const DEFAULT_FORM: FormState = {
  code: '',
  description: '',
  discountType: 'percent',
  discountValue: '',
  maxDiscountAmount: '',
  minOrderValue: '',
  appliesTo: 'all',
  firstOrderOnly: false,
  usageLimit: '',
  usageLimitPerClient: '',
  startsAt: '',
  endsAt: '',
};

/** ISO → valor de <input type="datetime-local"> (hora local, sem timezone). */
function isoToLocalInput(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** valor de datetime-local → ISO (UTC). */
function localInputToIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** Numeric input string → número, ou undefined quando vazio/ inválido. */
function toNumberOrUndefined(v: string): number | undefined {
  const t = v.trim();
  if (!t) return undefined;
  const n = Number(t);
  return isNaN(n) ? undefined : n;
}

function discountSummary(c: Coupon): string {
  if (c.discountType === 'free_delivery') return 'Frete grátis';
  if (c.discountType === 'percent') return `${c.discountValue}% OFF`;
  return `${formatCurrency(c.discountValue)} OFF`;
}

function validityLabel(c: Coupon): string | null {
  const start = c.startsAt ? formatDate(c.startsAt) : null;
  const end = c.endsAt ? formatDate(c.endsAt) : null;
  if (start && end) return `${start} — ${end}`;
  if (start) return `A partir de ${start}`;
  if (end) return `Até ${end}`;
  return null;
}

export default function CuponsTab({ businessId }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canManage = ROLE_HIERARCHY[user?.role ?? 'viewer'] >= ROLE_HIERARCHY['manager'];
  const canDelete = ROLE_HIERARCHY[user?.role ?? 'viewer'] >= ROLE_HIERARCHY['admin'];

  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [form, setForm] = useState<FormState>({ ...DEFAULT_FORM });
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    const q = query(
      collection(db, 'coupons'),
      where('businessId', '==', businessId),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(q, snap => {
      setCoupons(snap.docs.map(d => ({ ...d.data(), id: d.id } as Coupon)));
    });
    return () => unsub();
  }, [businessId]);

  const openCreate = () => {
    setForm({ ...DEFAULT_FORM });
    setEditing(null);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (c: Coupon) => {
    setForm({
      code: c.code,
      description: c.description ?? '',
      discountType: c.discountType,
      discountValue: c.discountType === 'free_delivery' ? '' : String(c.discountValue),
      maxDiscountAmount: c.maxDiscountAmount != null ? String(c.maxDiscountAmount) : '',
      minOrderValue: c.minOrderValue != null ? String(c.minOrderValue) : '',
      appliesTo: c.appliesTo,
      firstOrderOnly: !!c.firstOrderOnly,
      usageLimit: c.usageLimit != null ? String(c.usageLimit) : '',
      usageLimitPerClient: c.usageLimitPerClient != null ? String(c.usageLimitPerClient) : '',
      startsAt: isoToLocalInput(c.startsAt),
      endsAt: isoToLocalInput(c.endsAt),
    });
    setEditing(c);
    setFormError(null);
    setShowForm(true);
  };

  const handleSave = useCallback(async () => {
    if (!businessId || !canManage) return;
    setFormError(null);

    const code = normalizeCouponCode(form.code);
    if (!COUPON_CODE_REGEX.test(code)) {
      setFormError('Código inválido — use 3 a 32 letras, números, "-" ou "_".');
      return;
    }

    const now = new Date().toISOString();
    const candidate = {
      businessId,
      code,
      description: form.description.trim() || undefined,
      discountType: form.discountType,
      discountValue: form.discountType === 'free_delivery' ? 0 : (toNumberOrUndefined(form.discountValue) ?? 0),
      maxDiscountAmount: form.discountType === 'percent' ? toNumberOrUndefined(form.maxDiscountAmount) : undefined,
      minOrderValue: toNumberOrUndefined(form.minOrderValue),
      appliesTo: form.appliesTo,
      firstOrderOnly: form.firstOrderOnly || undefined,
      usageLimit: toNumberOrUndefined(form.usageLimit),
      usageLimitPerClient: toNumberOrUndefined(form.usageLimitPerClient),
      usedCount: editing?.usedCount ?? 0,
      startsAt: localInputToIso(form.startsAt),
      endsAt: localInputToIso(form.endsAt),
      status: editing?.status ?? ('active' as CouponStatus),
      createdAt: editing?.createdAt ?? now,
      updatedAt: now,
      createdBy: editing?.createdBy ?? user?.uid,
      createdByName: editing?.createdByName ?? user?.name,
    };

    const parsed = CouponSchema.safeParse(candidate);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Dados do cupom inválidos.');
      return;
    }

    setIsSaving(true);
    try {
      // Unicidade do code por negócio (índice businessId+code).
      const dupSnap = await getDocs(query(
        collection(db, 'coupons'),
        where('businessId', '==', businessId),
        where('code', '==', code),
      ));
      const clash = dupSnap.docs.find(d => d.id !== editing?.id);
      if (clash) {
        setFormError('Já existe um cupom com esse código.');
        setIsSaving(false);
        return;
      }

      const c = parsed.data;
      if (editing?.id) {
        // Só os campos de configuração — status/usedCount/createdAt são preservados.
        await updateDoc(doc(db, 'coupons', editing.id), {
          code: c.code,
          description: c.description ?? deleteField(),
          discountType: c.discountType,
          discountValue: c.discountValue,
          maxDiscountAmount: c.maxDiscountAmount ?? deleteField(),
          minOrderValue: c.minOrderValue ?? deleteField(),
          appliesTo: c.appliesTo,
          firstOrderOnly: c.firstOrderOnly ?? deleteField(),
          usageLimit: c.usageLimit ?? deleteField(),
          usageLimitPerClient: c.usageLimitPerClient ?? deleteField(),
          startsAt: c.startsAt ?? deleteField(),
          endsAt: c.endsAt ?? deleteField(),
          updatedAt: c.updatedAt,
        });
      } else {
        const payload: Record<string, unknown> = { ...c };
        delete payload.id;
        for (const k of Object.keys(payload)) {
          if (payload[k] === undefined) delete payload[k];
        }
        await addDoc(collection(db, 'coupons'), payload);
      }

      setShowForm(false);
      setEditing(null);
      setForm({ ...DEFAULT_FORM });
    } catch (err) {
      console.error('Error saving coupon:', err);
      setFormError('Não foi possível salvar o cupom. Tente novamente.');
    }
    setIsSaving(false);
  }, [form, editing, businessId, canManage, user]);

  const handleTogglePause = async (c: Coupon) => {
    if (!c.id || !canManage) return;
    const target: CouponStatus = c.status === 'paused' ? 'active' : 'paused';
    try {
      assertTransitionCoupon(c.status, target);
    } catch (err) {
      console.error('Coupon FSM:', err);
      return;
    }
    await updateDoc(doc(db, 'coupons', c.id), { status: target, updatedAt: new Date().toISOString() });
  };

  const handleDelete = async (c: Coupon) => {
    if (!c.id || !canDelete) return;
    if (!confirm(`Apagar o cupom ${c.code}? Esta ação não pode ser desfeita.`)) return;
    await deleteDoc(doc(db, 'coupons', c.id));
  };

  const now = new Date();
  const typeMeta = DISCOUNT_TYPES.find(d => d.value === form.discountType);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-display">
            {t('crm.coupons.title', 'Cupons')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {t('crm.coupons.desc', 'Códigos promocionais para o cardápio, PDV e agente')}
          </p>
        </div>
        {canManage && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <Plus size={16} />
            {t('crm.coupons.new', 'Novo cupom')}
          </button>
        )}
      </div>

      {/* List */}
      {coupons.length === 0 && !showForm ? (
        <div className="text-center py-16">
          <Ticket className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('crm.coupons.empty', 'Nenhum cupom criado. Crie códigos de desconto para converter mais pedidos.')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {coupons.map(c => {
            const effective = deriveCouponStatus(c, now);
            const badge = STATUS_BADGE[effective];
            const validity = validityLabel(c);
            return (
              <div
                key={c.id}
                className={cn(
                  'p-4 rounded-xl border transition-colors',
                  effective === 'active'
                    ? 'bg-white dark:bg-gray-800/60 border-gray-200 dark:border-gray-700/60'
                    : 'bg-gray-50 dark:bg-gray-800/30 border-gray-200/50 dark:border-gray-700/30',
                )}
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                    effective === 'active'
                      ? 'bg-red-50 dark:bg-red-500/10 text-red-500'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-400',
                  )}>
                    <Ticket size={18} />
                  </div>

                  <div
                    className={cn('flex-1 min-w-0', canManage && 'cursor-pointer')}
                    onClick={canManage ? () => openEdit(c) : undefined}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 font-mono tracking-wide">
                        {c.code}
                      </p>
                      <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full', badge.className)}>
                        {badge.label}
                      </span>
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                        {discountSummary(c)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        {c.usedCount}
                        {' / '}
                        {c.usageLimit != null
                          ? c.usageLimit
                          : <InfinityIcon size={12} className="inline" />}
                        {' usos'}
                      </span>
                      {c.minOrderValue != null && <span>· mín. {formatCurrency(c.minOrderValue)}</span>}
                      {c.firstOrderOnly && <span>· 1ª compra</span>}
                      {validity && <span>· {validity}</span>}
                    </p>
                  </div>

                  {canManage && (effective === 'active' || effective === 'paused') && (
                    <button
                      onClick={() => handleTogglePause(c)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                      title={c.status === 'paused' ? 'Reativar' : 'Pausar'}
                    >
                      {c.status === 'paused' ? <Play size={16} /> : <Pause size={16} />}
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => handleDelete(c)}
                      className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-500 transition-colors"
                      title="Apagar"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Form modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowForm(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.96 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-white dark:bg-[#1e293b] rounded-2xl border border-gray-200 dark:border-gray-700/50 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700/50 shrink-0">
                <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 font-display">
                  {editing ? t('crm.coupons.edit', 'Editar cupom') : t('crm.coupons.create', 'Novo cupom')}
                </h3>
                <button onClick={() => setShowForm(false)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                  <X size={18} className="text-gray-400" />
                </button>
              </div>

              <div className="p-5 space-y-5 overflow-y-auto flex-1 min-h-0">
                {/* Code + description */}
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {t('crm.coupons.code', 'Código')}
                    </label>
                    <input
                      value={form.code}
                      onChange={(e) => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                      placeholder="Ex: BEMVINDO10"
                      maxLength={32}
                      className="mt-1.5 w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 font-mono tracking-wide uppercase"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {t('crm.coupons.description', 'Descrição')}
                    </label>
                    <input
                      value={form.description}
                      onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="Opcional — ex: 10% na primeira compra"
                      maxLength={200}
                      className="mt-1.5 w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
                    />
                  </div>
                </div>

                {/* Discount type */}
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {t('crm.coupons.type', 'Tipo de desconto')}
                  </label>
                  <div className="mt-1.5 grid grid-cols-3 gap-2">
                    {DISCOUNT_TYPES.map(dt => (
                      <button
                        key={dt.value}
                        onClick={() => setForm(f => ({ ...f, discountType: dt.value }))}
                        className={cn(
                          'flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all',
                          form.discountType === dt.value
                            ? 'border-red-300 dark:border-red-500/40 bg-red-50/50 dark:bg-red-500/5'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600',
                        )}
                      >
                        <dt.icon size={16} className={form.discountType === dt.value ? 'text-red-500' : 'text-gray-400'} />
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{dt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Discount value (hidden for free_delivery) */}
                {form.discountType !== 'free_delivery' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        {form.discountType === 'percent'
                          ? t('crm.coupons.percent', 'Percentual (%)')
                          : t('crm.coupons.amount', 'Valor (R$)')}
                      </label>
                      <input
                        type="number"
                        min={form.discountType === 'percent' ? 1 : 0.01}
                        max={form.discountType === 'percent' ? 100 : undefined}
                        step={form.discountType === 'percent' ? 1 : 0.01}
                        value={form.discountValue}
                        onChange={(e) => setForm(f => ({ ...f, discountValue: e.target.value }))}
                        placeholder={form.discountType === 'percent' ? '10' : '15,00'}
                        className="mt-1.5 w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
                      />
                    </div>
                    {form.discountType === 'percent' && (
                      <div>
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          {t('crm.coupons.maxDiscount', 'Teto (R$)')}
                        </label>
                        <input
                          type="number"
                          min={0.01}
                          step={0.01}
                          value={form.maxDiscountAmount}
                          onChange={(e) => setForm(f => ({ ...f, maxDiscountAmount: e.target.value }))}
                          placeholder="Sem teto"
                          className="mt-1.5 w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Min order + applies to */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {t('crm.coupons.minOrder', 'Pedido mínimo (R$)')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={form.minOrderValue}
                      onChange={(e) => setForm(f => ({ ...f, minOrderValue: e.target.value }))}
                      placeholder="Sem mínimo"
                      className="mt-1.5 w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {t('crm.coupons.appliesTo', 'Vale para')}
                    </label>
                    <select
                      value={form.appliesTo}
                      onChange={(e) => setForm(f => ({ ...f, appliesTo: e.target.value as CouponAppliesTo }))}
                      className="mt-1.5 w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 text-gray-900 dark:text-gray-100"
                    >
                      {APPLIES_TO.map(a => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Usage limits */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {t('crm.coupons.usageLimit', 'Limite total')}
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={form.usageLimit}
                      onChange={(e) => setForm(f => ({ ...f, usageLimit: e.target.value }))}
                      placeholder="Ilimitado"
                      className="mt-1.5 w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {t('crm.coupons.usageLimitPerClient', 'Limite por cliente')}
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={form.usageLimitPerClient}
                      onChange={(e) => setForm(f => ({ ...f, usageLimitPerClient: e.target.value }))}
                      placeholder="Ilimitado"
                      className="mt-1.5 w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
                    />
                  </div>
                </div>

                {/* Validity window */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {t('crm.coupons.startsAt', 'Início')}
                    </label>
                    <input
                      type="datetime-local"
                      value={form.startsAt}
                      onChange={(e) => setForm(f => ({ ...f, startsAt: e.target.value }))}
                      className="mt-1.5 w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {t('crm.coupons.endsAt', 'Fim')}
                    </label>
                    <input
                      type="datetime-local"
                      value={form.endsAt}
                      onChange={(e) => setForm(f => ({ ...f, endsAt: e.target.value }))}
                      className="mt-1.5 w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                </div>

                {/* First order only */}
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.firstOrderOnly}
                    onChange={(e) => setForm(f => ({ ...f, firstOrderOnly: e.target.checked }))}
                    className="accent-red-500 w-4 h-4"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {t('crm.coupons.firstOrderOnly', 'Válido apenas no primeiro pedido do cliente')}
                  </span>
                </label>

                {typeMeta?.value === 'free_delivery' && (
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {t('crm.coupons.freeDeliveryHint', 'Frete grátis zera a taxa de entrega; não há valor de desconto a definir.')}
                  </p>
                )}

                {formError && (
                  <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">
                    {formError}
                  </p>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-700/50 shrink-0">
                <button
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors"
                >
                  {t('common.cancel', 'Cancelar')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving || !form.code.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-xl transition-colors flex items-center gap-2"
                >
                  <Check size={16} />
                  {isSaving ? '...' : editing ? t('common.save', 'Salvar') : t('crm.coupons.create', 'Criar cupom')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
