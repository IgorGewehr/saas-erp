'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import type { FormTemplate, FormField, FormFieldType } from '@/lib/types';
import {
  Plus, FileText, Trash2, X, Check, Copy, ExternalLink, GripVertical,
  ToggleLeft, ToggleRight, Type, AlignLeft, Hash, Calendar, List, CircleDot, CheckSquare, Paperclip,
} from 'lucide-react';

interface Props {
  businessId: string;
  userId: string;
  userName: string;
  isDark: boolean;
}

const FIELD_TYPES: { value: FormFieldType; label: string; icon: React.ElementType }[] = [
  { value: 'text', label: 'Texto curto', icon: Type },
  { value: 'textarea', label: 'Texto longo', icon: AlignLeft },
  { value: 'number', label: 'Número', icon: Hash },
  { value: 'date', label: 'Data', icon: Calendar },
  { value: 'select', label: 'Seleção', icon: List },
  { value: 'radio', label: 'Múltipla escolha', icon: CircleDot },
  { value: 'checkbox', label: 'Caixas de seleção', icon: CheckSquare },
  { value: 'file', label: 'Arquivo', icon: Paperclip },
];

function generateFieldId(): string {
  return 'f_' + Math.random().toString(36).slice(2, 8);
}

export default function FormulariosTab({ businessId, userId, userName, isDark }: Props) {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Builder state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    const q = query(collection(db, 'formTemplates'), where('businessId', '==', businessId));
    const unsub = onSnapshot(q, snap => {
      setTemplates(snap.docs.map(d => ({ ...d.data(), id: d.id } as FormTemplate)));
    });
    return () => unsub();
  }, [businessId]);

  const resetBuilder = () => {
    setFormName('');
    setFormDescription('');
    setFormFields([]);
    setEditingId(null);
  };

  const handleEdit = (tpl: FormTemplate) => {
    setFormName(tpl.name);
    setFormDescription(tpl.description || '');
    setFormFields(tpl.fields);
    setEditingId(tpl.id);
    setShowBuilder(true);
  };

  const handleSave = useCallback(async () => {
    if (!formName.trim() || formFields.length === 0) return;
    setIsSaving(true);
    const now = new Date().toISOString();
    try {
      if (editingId) {
        await updateDoc(doc(db, 'formTemplates', editingId), {
          name: formName.trim(),
          description: formDescription.trim() || null,
          fields: formFields,
          updatedAt: now,
        });
      } else {
        await addDoc(collection(db, 'formTemplates'), {
          businessId,
          name: formName.trim(),
          description: formDescription.trim() || null,
          fields: formFields,
          isActive: true,
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        });
      }
      setShowBuilder(false);
      resetBuilder();
    } catch (err) {
      console.error('Error saving form template:', err);
    }
    setIsSaving(false);
  }, [formName, formDescription, formFields, editingId, businessId, userId]);

  const handleToggle = async (tpl: FormTemplate) => {
    await updateDoc(doc(db, 'formTemplates', tpl.id), { isActive: !tpl.isActive, updatedAt: new Date().toISOString() });
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, 'formTemplates', id));
  };

  const addField = (type: FormFieldType) => {
    setFormFields(prev => [...prev, {
      id: generateFieldId(),
      type,
      label: '',
      required: false,
      ...((['select', 'radio', 'checkbox'] as FormFieldType[]).includes(type) ? { options: ['Opção 1'] } : {}),
    }]);
  };

  const updateField = (idx: number, patch: Partial<FormField>) => {
    setFormFields(prev => prev.map((f, i) => i === idx ? { ...f, ...patch } : f));
  };

  const removeField = (idx: number) => {
    setFormFields(prev => prev.filter((_, i) => i !== idx));
  };

  const copyLink = (id: string) => {
    const url = `${window.location.origin}/forms/${id}`;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-display">
            {t('crm.forms.title', 'Formulários')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {t('crm.forms.desc', 'Fichas de anamnese e intake para clientes')}
          </p>
        </div>
        <button
          onClick={() => { resetBuilder(); setShowBuilder(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <Plus size={16} />
          {t('crm.forms.new', 'Novo formulário')}
        </button>
      </div>

      {/* Templates list */}
      {templates.length === 0 && !showBuilder ? (
        <div className="text-center py-16">
          <FileText className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('crm.forms.empty', 'Nenhum formulário criado. Crie fichas de anamnese para seus serviços.')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map(tpl => (
            <div
              key={tpl.id}
              className={cn(
                'p-4 rounded-xl border transition-colors',
                tpl.isActive
                  ? 'bg-white dark:bg-gray-800/60 border-gray-200 dark:border-gray-700/60'
                  : 'bg-gray-50 dark:bg-gray-800/30 border-gray-200/50 dark:border-gray-700/30 opacity-60'
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                  tpl.isActive ? 'bg-violet-50 dark:bg-violet-500/10 text-violet-500' : 'bg-gray-100 dark:bg-gray-700 text-gray-400'
                )}>
                  <FileText size={18} />
                </div>
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleEdit(tpl)}>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{tpl.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {tpl.fields.length} {tpl.fields.length === 1 ? 'campo' : 'campos'}
                    {tpl.description && ` · ${tpl.description}`}
                  </p>
                </div>
                <button
                  onClick={() => copyLink(tpl.id)}
                  className={cn(
                    'p-1.5 rounded-lg transition-colors text-xs flex items-center gap-1',
                    copiedId === tpl.id
                      ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-500'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600'
                  )}
                  title="Copiar link público"
                >
                  {copiedId === tpl.id ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <a
                  href={`/forms/${tpl.id}`}
                  target="_blank"
                  rel="noopener"
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 transition-colors"
                  title="Abrir formulário"
                >
                  <ExternalLink size={14} />
                </a>
                <button
                  onClick={() => handleToggle(tpl)}
                  className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  {tpl.isActive
                    ? <ToggleRight size={22} className="text-emerald-500" />
                    : <ToggleLeft size={22} className="text-gray-400" />
                  }
                </button>
                <button
                  onClick={() => handleDelete(tpl.id)}
                  className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Builder modal */}
      <AnimatePresence>
        {showBuilder && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowBuilder(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.96 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl bg-white dark:bg-[#1e293b] rounded-2xl border border-gray-200 dark:border-gray-700/50 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700/50 shrink-0">
                <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 font-display">
                  {editingId ? t('crm.forms.edit', 'Editar formulário') : t('crm.forms.create', 'Novo formulário')}
                </h3>
                <button onClick={() => setShowBuilder(false)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                  <X size={18} className="text-gray-400" />
                </button>
              </div>

              <div className="p-5 space-y-5 overflow-y-auto flex-1 min-h-0">
                {/* Name + description */}
                <div className="space-y-3">
                  <input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder={t('crm.forms.namePlaceholder', 'Nome do formulário (ex: Anamnese Facial)')}
                    className="w-full px-3 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 font-semibold"
                  />
                  <input
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder={t('crm.forms.descPlaceholder', 'Descrição (opcional)')}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
                  />
                </div>

                {/* Fields */}
                <div className="space-y-3">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {t('crm.forms.fields', 'Campos')} ({formFields.length})
                  </p>

                  {formFields.map((field, idx) => {
                    const meta = FIELD_TYPES.find(ft => ft.value === field.type);
                    const Icon = meta?.icon || Type;
                    const hasOptions = ['select', 'radio', 'checkbox'].includes(field.type);
                    return (
                      <div key={field.id} className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 space-y-2">
                        <div className="flex items-center gap-2">
                          <GripVertical size={14} className="text-gray-300 dark:text-gray-600 shrink-0" />
                          <Icon size={14} className="text-gray-400 shrink-0" />
                          <input
                            value={field.label}
                            onChange={(e) => updateField(idx, { label: e.target.value })}
                            placeholder="Nome do campo"
                            className="flex-1 px-2 py-1 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                          />
                          <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer shrink-0">
                            <input
                              type="checkbox"
                              checked={field.required}
                              onChange={(e) => updateField(idx, { required: e.target.checked })}
                              className="accent-red-500"
                            />
                            Obrig.
                          </label>
                          <button onClick={() => removeField(idx)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-500">
                            <X size={14} />
                          </button>
                        </div>
                        {hasOptions && (
                          <div className="pl-7 space-y-1">
                            {(field.options || []).map((opt, oi) => (
                              <div key={oi} className="flex items-center gap-1">
                                <input
                                  value={opt}
                                  onChange={(e) => {
                                    const opts = [...(field.options || [])];
                                    opts[oi] = e.target.value;
                                    updateField(idx, { options: opts });
                                  }}
                                  className="flex-1 px-2 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                                  placeholder={`Opção ${oi + 1}`}
                                />
                                <button
                                  onClick={() => updateField(idx, { options: (field.options || []).filter((_, i) => i !== oi) })}
                                  className="text-gray-300 hover:text-red-400"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ))}
                            <button
                              onClick={() => updateField(idx, { options: [...(field.options || []), ''] })}
                              className="text-xs text-red-500 hover:text-red-600 font-medium"
                            >
                              + Opção
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Add field buttons */}
                  <div className="flex flex-wrap gap-1.5">
                    {FIELD_TYPES.map(ft => (
                      <button
                        key={ft.value}
                        onClick={() => addField(ft.value)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-red-300 dark:hover:border-red-500/40 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                      >
                        <ft.icon size={12} />
                        {ft.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-700/50 shrink-0">
                <button onClick={() => setShowBuilder(false)} className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors">
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving || !formName.trim() || formFields.length === 0}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-xl transition-colors flex items-center gap-2"
                >
                  <Check size={16} />
                  {isSaving ? '...' : editingId ? 'Salvar' : 'Criar formulário'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
