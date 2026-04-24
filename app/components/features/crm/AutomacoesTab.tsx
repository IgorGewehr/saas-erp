'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import type { CRMAutomationRule, CRMAutomationTrigger, CRMAutomationActionType } from '@/lib/types';
import {
  Plus, Zap, Trash2, X, Check, ToggleLeft, ToggleRight,
  UserX, Cake, CalendarCheck, TrendingDown, UserPlus, Clock,
  MessageSquare, CheckSquare, Tag, ArrowRightLeft, Bell,
} from 'lucide-react';

interface Props {
  businessId: string;
  userId: string;
  userName: string;
  isDark: boolean;
}

const TRIGGERS: { value: CRMAutomationTrigger; label: string; icon: React.ElementType; desc: string; configFields?: string[] }[] = [
  { value: 'client_inactive', label: 'Cliente inativo', icon: UserX, desc: 'Sem visita/contato há X dias', configFields: ['inactiveDays'] },
  { value: 'client_birthday', label: 'Aniversário', icon: Cake, desc: 'No dia do aniversário do cliente' },
  { value: 'post_appointment', label: 'Pós-atendimento', icon: CalendarCheck, desc: 'X horas após atendimento concluído', configFields: ['hoursAfter'] },
  { value: 'high_churn_risk', label: 'Risco de churn', icon: TrendingDown, desc: 'Score de risco acima do limite', configFields: ['threshold'] },
  { value: 'new_lead', label: 'Novo lead', icon: UserPlus, desc: 'Quando um novo contato é criado' },
];

const ACTIONS: { value: CRMAutomationActionType; label: string; icon: React.ElementType; placeholder: string }[] = [
  { value: 'send_whatsapp', label: 'Enviar WhatsApp', icon: MessageSquare, placeholder: 'Olá {{primeiro_nome}}, sentimos sua falta!' },
  { value: 'add_tag', label: 'Adicionar tag', icon: Tag, placeholder: 'inativo-30d' },
  { value: 'change_lifecycle', label: 'Mudar estágio', icon: ArrowRightLeft, placeholder: 'churned' },
  { value: 'notify_team', label: 'Notificar equipe', icon: Bell, placeholder: 'Cliente inativo precisa de atenção' },
  { value: 'create_task', label: 'Criar tarefa', icon: CheckSquare, placeholder: 'Follow-up com {{nome}}' },
];

interface FormState {
  name: string;
  trigger: CRMAutomationTrigger;
  triggerConfig: Record<string, unknown>;
  actions: { type: CRMAutomationActionType; value: string }[];
}

const DEFAULT_FORM: FormState = {
  name: '',
  trigger: 'client_inactive',
  triggerConfig: { inactiveDays: 30 },
  actions: [{ type: 'send_whatsapp', value: '' }],
};

export default function AutomacoesTab({ businessId, userId, userName, isDark }: Props) {
  const { t } = useTranslation();
  const [rules, setRules] = useState<CRMAutomationRule[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...DEFAULT_FORM });
  const [isSaving, setIsSaving] = useState(false);

  // Real-time sync
  useEffect(() => {
    if (!businessId) return;
    const q = query(collection(db, 'automationRules'), where('businessId', '==', businessId));
    const unsub = onSnapshot(q, snap => {
      setRules(snap.docs.map(d => ({ ...d.data(), id: d.id } as CRMAutomationRule)));
    });
    return () => unsub();
  }, [businessId]);

  const handleSave = useCallback(async () => {
    if (!form.name.trim() || form.actions.length === 0) return;
    setIsSaving(true);
    const now = new Date().toISOString();
    try {
      if (editingId) {
        await updateDoc(doc(db, 'automationRules', editingId), {
          name: form.name.trim(),
          trigger: form.trigger,
          triggerConfig: form.triggerConfig,
          conditions: [],
          actions: form.actions.filter(a => a.value.trim()),
          updatedAt: now,
        });
      } else {
        await addDoc(collection(db, 'automationRules'), {
          businessId,
          name: form.name.trim(),
          trigger: form.trigger,
          triggerConfig: form.triggerConfig,
          conditions: [],
          actions: form.actions.filter(a => a.value.trim()),
          isActive: true,
          totalExecutions: 0,
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        });
      }
      setShowForm(false);
      setEditingId(null);
      setForm({ ...DEFAULT_FORM });
    } catch (err) {
      console.error('Error saving automation rule:', err);
    }
    setIsSaving(false);
  }, [form, editingId, businessId, userId]);

  const handleEdit = (rule: CRMAutomationRule) => {
    setForm({
      name: rule.name,
      trigger: rule.trigger,
      triggerConfig: rule.triggerConfig || {},
      actions: rule.actions.map(a => ({ type: a.type, value: a.value })),
    });
    setEditingId(rule.id);
    setShowForm(true);
  };

  const handleToggle = async (rule: CRMAutomationRule) => {
    await updateDoc(doc(db, 'automationRules', rule.id), {
      isActive: !rule.isActive,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, 'automationRules', id));
  };

  const triggerMeta = TRIGGERS.find(t => t.value === form.trigger);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-display">
            {t('crm.automations.title', 'Automações')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {t('crm.automations.desc', 'Regras automáticas para engajar clientes')}
          </p>
        </div>
        <button
          onClick={() => { setForm({ ...DEFAULT_FORM }); setEditingId(null); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <Plus size={16} />
          {t('crm.automations.new', 'Nova regra')}
        </button>
      </div>

      {/* Rules list */}
      {rules.length === 0 && !showForm ? (
        <div className="text-center py-16">
          <Zap className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('crm.automations.empty', 'Nenhuma automação criada. Crie regras para automatizar ações com seus clientes.')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map(rule => {
            const trg = TRIGGERS.find(t => t.value === rule.trigger);
            const TriggerIcon = trg?.icon || Zap;
            return (
              <div
                key={rule.id}
                className={cn(
                  'p-4 rounded-xl border transition-colors cursor-pointer',
                  rule.isActive
                    ? 'bg-white dark:bg-gray-800/60 border-gray-200 dark:border-gray-700/60'
                    : 'bg-gray-50 dark:bg-gray-800/30 border-gray-200/50 dark:border-gray-700/30 opacity-60'
                )}
                onClick={() => handleEdit(rule)}
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                    rule.isActive ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-500' : 'bg-gray-100 dark:bg-gray-700 text-gray-400'
                  )}>
                    <TriggerIcon size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{rule.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {trg?.label} → {rule.actions.length} {rule.actions.length === 1 ? 'ação' : 'ações'}
                      {rule.totalExecutions > 0 && ` · ${rule.totalExecutions} execuções`}
                    </p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleToggle(rule); }}
                    className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    title={rule.isActive ? 'Desativar' : 'Ativar'}
                  >
                    {rule.isActive
                      ? <ToggleRight size={22} className="text-emerald-500" />
                      : <ToggleLeft size={22} className="text-gray-400" />
                    }
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(rule.id); }}
                    className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
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
              className="w-full max-w-lg bg-white dark:bg-[#1e293b] rounded-2xl border border-gray-200 dark:border-gray-700/50 shadow-2xl overflow-hidden"
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700/50">
                <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 font-display">
                  {editingId ? t('crm.automations.edit', 'Editar regra') : t('crm.automations.create', 'Nova regra de automação')}
                </h3>
                <button onClick={() => setShowForm(false)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                  <X size={18} className="text-gray-400" />
                </button>
              </div>

              <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
                {/* Rule name */}
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {t('crm.automations.name', 'Nome da regra')}
                  </label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Ex: Reengajar inativos 30 dias"
                    className="mt-1.5 w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
                  />
                </div>

                {/* Trigger selection */}
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {t('crm.automations.when', 'Quando')}
                  </label>
                  <div className="mt-1.5 grid grid-cols-1 gap-2">
                    {TRIGGERS.map(trg => (
                      <button
                        key={trg.value}
                        onClick={() => setForm(f => ({ ...f, trigger: trg.value, triggerConfig: trg.value === 'client_inactive' ? { inactiveDays: 30 } : trg.value === 'high_churn_risk' ? { threshold: 70 } : trg.value === 'post_appointment' ? { hoursAfter: 24 } : {} }))}
                        className={cn(
                          'flex items-center gap-3 p-3 rounded-xl border text-left transition-all',
                          form.trigger === trg.value
                            ? 'border-red-300 dark:border-red-500/40 bg-red-50/50 dark:bg-red-500/5'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                        )}
                      >
                        <trg.icon size={16} className={form.trigger === trg.value ? 'text-red-500' : 'text-gray-400'} />
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{trg.label}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{trg.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Trigger config */}
                {triggerMeta?.configFields && (
                  <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 space-y-2">
                    {triggerMeta.configFields.includes('inactiveDays') && (
                      <div className="flex items-center gap-2">
                        <Clock size={14} className="text-gray-400" />
                        <span className="text-sm text-gray-600 dark:text-gray-400">Inativo há</span>
                        <input
                          type="number"
                          min={1}
                          max={365}
                          value={(form.triggerConfig.inactiveDays as number) || 30}
                          onChange={(e) => setForm(f => ({ ...f, triggerConfig: { ...f.triggerConfig, inactiveDays: Number(e.target.value) || 30 } }))}
                          className="w-16 px-2 py-1 text-sm text-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                        />
                        <span className="text-sm text-gray-600 dark:text-gray-400">dias</span>
                      </div>
                    )}
                    {triggerMeta.configFields.includes('hoursAfter') && (
                      <div className="flex items-center gap-2">
                        <Clock size={14} className="text-gray-400" />
                        <span className="text-sm text-gray-600 dark:text-gray-400">Após</span>
                        <input
                          type="number"
                          min={1}
                          max={168}
                          value={(form.triggerConfig.hoursAfter as number) || 24}
                          onChange={(e) => setForm(f => ({ ...f, triggerConfig: { ...f.triggerConfig, hoursAfter: Number(e.target.value) || 24 } }))}
                          className="w-16 px-2 py-1 text-sm text-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                        />
                        <span className="text-sm text-gray-600 dark:text-gray-400">horas</span>
                      </div>
                    )}
                    {triggerMeta.configFields.includes('threshold') && (
                      <div className="flex items-center gap-2">
                        <TrendingDown size={14} className="text-gray-400" />
                        <span className="text-sm text-gray-600 dark:text-gray-400">Risco ≥</span>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={(form.triggerConfig.threshold as number) || 70}
                          onChange={(e) => setForm(f => ({ ...f, triggerConfig: { ...f.triggerConfig, threshold: Number(e.target.value) || 70 } }))}
                          className="w-16 px-2 py-1 text-sm text-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                        />
                        <span className="text-sm text-gray-600 dark:text-gray-400">%</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {t('crm.automations.then', 'Então')}
                  </label>
                  <div className="mt-1.5 space-y-2">
                    {form.actions.map((action, idx) => {
                      const actionMeta = ACTIONS.find(a => a.value === action.type);
                      return (
                        <div key={idx} className="flex items-start gap-2">
                          <select
                            value={action.type}
                            onChange={(e) => {
                              const updated = [...form.actions];
                              updated[idx] = { type: e.target.value as CRMAutomationActionType, value: '' };
                              setForm(f => ({ ...f, actions: updated }));
                            }}
                            className="shrink-0 px-2 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                          >
                            {ACTIONS.map(a => (
                              <option key={a.value} value={a.value}>{a.label}</option>
                            ))}
                          </select>
                          <input
                            value={action.value}
                            onChange={(e) => {
                              const updated = [...form.actions];
                              updated[idx] = { ...updated[idx], value: e.target.value };
                              setForm(f => ({ ...f, actions: updated }));
                            }}
                            placeholder={actionMeta?.placeholder || ''}
                            className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
                          />
                          {form.actions.length > 1 && (
                            <button
                              onClick={() => setForm(f => ({ ...f, actions: f.actions.filter((_, i) => i !== idx) }))}
                              className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-500 transition-colors"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    <button
                      onClick={() => setForm(f => ({ ...f, actions: [...f.actions, { type: 'add_tag', value: '' }] }))}
                      className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 font-medium flex items-center gap-1"
                    >
                      <Plus size={12} /> Adicionar ação
                    </button>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-700/50">
                <button
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors"
                >
                  {t('common.cancel', 'Cancelar')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving || !form.name.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-xl transition-colors flex items-center gap-2"
                >
                  <Check size={16} />
                  {isSaving ? '...' : editingId ? t('common.save', 'Salvar') : t('crm.automations.create', 'Criar regra')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
