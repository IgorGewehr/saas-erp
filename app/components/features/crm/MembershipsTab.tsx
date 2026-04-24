'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import { useTranslation } from 'react-i18next';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import type { Membership, MembershipBillingCycle } from '@/lib/types';
import {
  Plus, CreditCard, Trash2, X, Check, ToggleLeft, ToggleRight,
  Crown, Lock, Users,
} from 'lucide-react';

interface Props {
  businessId: string;
  userId: string;
  isDark: boolean;
  gatewayConfigured: boolean;
}

const CYCLE_LABELS: Record<MembershipBillingCycle, string> = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  yearly: 'Anual',
};

export default function MembershipsTab({ businessId, userId, isDark, gatewayConfigured }: Props) {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<Membership[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formCycle, setFormCycle] = useState<MembershipBillingCycle>('monthly');
  const [formMaxUses, setFormMaxUses] = useState('');

  useEffect(() => {
    if (!businessId) return;
    const q = query(collection(db, 'memberships'), where('businessId', '==', businessId));
    const unsub = onSnapshot(q, snap => {
      setPlans(snap.docs.map(d => ({ ...d.data(), id: d.id } as Membership)));
    });
    return () => unsub();
  }, [businessId]);

  const resetForm = () => {
    setFormName(''); setFormDescription(''); setFormPrice(''); setFormCycle('monthly'); setFormMaxUses(''); setEditingId(null);
  };

  const handleSave = useCallback(async () => {
    if (!formName.trim() || !formPrice) return;
    setIsSaving(true);
    const now = new Date().toISOString();
    try {
      const data = {
        name: formName.trim(),
        description: formDescription.trim() || null,
        serviceIds: [],
        price: parseFloat(formPrice) || 0,
        billingCycle: formCycle,
        maxUsesPerCycle: formMaxUses ? parseInt(formMaxUses) : null,
      };
      if (editingId) {
        await updateDoc(doc(db, 'memberships', editingId), { ...data, updatedAt: now });
      } else {
        await addDoc(collection(db, 'memberships'), { ...data, businessId, isActive: true, createdAt: now, updatedAt: now });
      }
      setShowForm(false); resetForm();
    } catch (err) { console.error('Save membership error:', err); }
    setIsSaving(false);
  }, [formName, formDescription, formPrice, formCycle, formMaxUses, editingId, businessId]);

  const handleEdit = (plan: Membership) => {
    setFormName(plan.name); setFormDescription(plan.description || ''); setFormPrice(plan.price.toString());
    setFormCycle(plan.billingCycle); setFormMaxUses(plan.maxUsesPerCycle?.toString() || '');
    setEditingId(plan.id); setShowForm(true);
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-display flex items-center gap-2">
            {t('crm.memberships.title', 'Planos & Assinaturas')}
            <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 rounded-full">Beta</span>
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {t('crm.memberships.desc', 'Crie planos recorrentes para seus clientes')}
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <Plus size={16} />
          Novo plano
        </button>
      </div>

      {/* Gateway warning */}
      {!gatewayConfigured && (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 flex items-start gap-3">
          <Lock size={16} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Cobrança automática indisponível</p>
            <p className="text-xs text-amber-600 dark:text-amber-400/70 mt-0.5">
              Configure um gateway de pagamento em Configurações para habilitar cobranças recorrentes. Até lá, controle de pagamentos é manual.
            </p>
          </div>
        </div>
      )}

      {/* Plans list */}
      {plans.length === 0 && !showForm ? (
        <div className="text-center py-16">
          <Crown className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nenhum plano criado. Crie planos de assinatura para fidelizar seus clientes.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map(plan => (
            <div
              key={plan.id}
              onClick={() => handleEdit(plan)}
              className={cn(
                'p-5 rounded-xl border transition-colors cursor-pointer hover:shadow-sm',
                plan.isActive
                  ? 'bg-white dark:bg-gray-800/60 border-gray-200 dark:border-gray-700/60'
                  : 'bg-gray-50 dark:bg-gray-800/30 border-gray-200/50 dark:border-gray-700/30 opacity-60'
              )}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center">
                  <Crown size={18} className="text-violet-500" />
                </div>
                <span className={cn(
                  'text-xs font-medium px-2 py-0.5 rounded-full',
                  plan.isActive ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'
                )}>
                  {plan.isActive ? 'Ativo' : 'Inativo'}
                </span>
              </div>
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{plan.name}</h3>
              {plan.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{plan.description}</p>}
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatCurrency(plan.price)}</span>
                <span className="text-xs text-gray-500">/{CYCLE_LABELS[plan.billingCycle].toLowerCase()}</span>
              </div>
              {plan.maxUsesPerCycle && (
                <p className="text-xs text-gray-400 mt-1">{plan.maxUsesPerCycle} usos por ciclo</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Form modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowForm(false)}
          >
            <motion.div initial={{ opacity: 0, y: 20, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.96 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-white dark:bg-[#1e293b] rounded-2xl border border-gray-200 dark:border-gray-700/50 shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700/50">
                <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 font-display">
                  {editingId ? 'Editar plano' : 'Novo plano'}
                </h3>
                <button onClick={() => setShowForm(false)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"><X size={18} className="text-gray-400" /></button>
              </div>
              <div className="p-5 space-y-4">
                <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Nome do plano" className="w-full px-3 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 text-gray-900 dark:text-gray-100 font-semibold" />
                <input value={formDescription} onChange={(e) => setFormDescription(e.target.value)} placeholder="Descrição (opcional)" className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 text-gray-900 dark:text-gray-100" />
                <div className="grid grid-cols-2 gap-3">
                  <input type="number" value={formPrice} onChange={(e) => setFormPrice(e.target.value)} placeholder="Preço (R$)" className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 text-gray-900 dark:text-gray-100" />
                  <select value={formCycle} onChange={(e) => setFormCycle(e.target.value as MembershipBillingCycle)} className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
                    {Object.entries(CYCLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <input type="number" value={formMaxUses} onChange={(e) => setFormMaxUses(e.target.value)} placeholder="Usos por ciclo (vazio = ilimitado)" className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 text-gray-900 dark:text-gray-100" />
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-700/50">
                <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl">Cancelar</button>
                <button onClick={handleSave} disabled={isSaving || !formName.trim() || !formPrice} className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-xl flex items-center gap-2">
                  <Check size={16} />{isSaving ? '...' : editingId ? 'Salvar' : 'Criar plano'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
