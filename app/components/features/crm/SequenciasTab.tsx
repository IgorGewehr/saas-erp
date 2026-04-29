'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDocs, increment } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import type { CRMSequence, CRMSequenceStep, CRMSequenceEnrollment, CRMContact } from '@/lib/types';
import {
  Plus, X, Trash2, Play, Pause, Check, ChevronDown, ChevronUp,
  MessageSquare, CheckSquare, Mail, Tag, Bell, GitBranch,
  Clock, Users, ArrowRight, Edit3, MoreVertical,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { formatDate } from '@/lib/utils/format';

type StepAction = CRMSequenceStep['action'];

const ACTION_CONFIG: Record<StepAction, { label: string; icon: React.ElementType; color: string; placeholder: string }> = {
  send_whatsapp: { label: 'WhatsApp', icon: MessageSquare, color: '#25D366', placeholder: 'Olá {{nome}}, passando para confirmar...' },
  create_task: { label: 'Criar tarefa', icon: CheckSquare, color: '#3b82f6', placeholder: 'Follow-up com {{nome}}' },
  send_email: { label: 'E-mail', icon: Mail, color: '#6366f1', placeholder: 'Assunto: Proposta personalizada para {{empresa}}' },
  add_tag: { label: 'Adicionar tag', icon: Tag, color: '#f59e0b', placeholder: 'em-sequencia' },
  notify_team: { label: 'Notificar equipe', icon: Bell, color: '#ef4444', placeholder: 'Lead {{nome}} precisa de atenção' },
};

function newStep(): CRMSequenceStep {
  return { id: crypto.randomUUID(), delayDays: 1, action: 'send_whatsapp', content: '' };
}

// ── Enrollment Dialog ──────────────────────────────────────────────────────

function EnrollDialog({ sequence, contacts, onClose, onEnroll }: {
  sequence: CRMSequence;
  contacts: CRMContact[];
  onClose: () => void;
  onEnroll: (contactId: string) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const filtered = contacts.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || (c.company ?? '').toLowerCase().includes(search.toLowerCase()));

  const handleEnroll = async (c: CRMContact) => {
    setLoading(true);
    try { await onEnroll(c.id); onClose(); } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 8 }}
        className="bg-white dark:bg-[#111827] rounded-2xl shadow-2xl w-full max-w-sm border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-700">
          <div>
            <h3 className="font-bold text-sm text-gray-900 dark:text-gray-100">Iniciar sequência</h3>
            <p className="text-xs text-gray-400 mt-0.5">{sequence.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors"><X size={15} /></button>
        </div>
        <div className="p-4 space-y-3">
          <input type="text" placeholder="Buscar contato..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 text-gray-900 dark:text-gray-100 placeholder:text-gray-400" />
          <div className="max-h-56 overflow-y-auto space-y-1">
            {filtered.slice(0, 20).map(c => (
              <button key={c.id} onClick={() => handleEnroll(c)} disabled={loading}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors text-left group">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-600 flex items-center justify-center text-[10px] font-bold text-gray-600 dark:text-gray-300 shrink-0">
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate group-hover:text-red-600 dark:group-hover:text-red-400">{c.name}</p>
                  {c.company && <p className="text-[10px] text-gray-400 truncate">{c.company}</p>}
                </div>
                <ArrowRight size={12} className="text-gray-300 group-hover:text-red-400 shrink-0" />
              </button>
            ))}
            {filtered.length === 0 && <p className="text-center text-xs text-gray-400 py-4">Nenhum contato encontrado</p>}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── Sequence Form ──────────────────────────────────────────────────────────

function SequenceForm({ initial, onSave, onCancel }: {
  initial?: CRMSequence | null;
  onSave: (data: Partial<CRMSequence>) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [steps, setSteps] = useState<CRMSequenceStep[]>(initial?.steps ?? [newStep()]);
  const [saving, setSaving] = useState(false);

  const addStep = () => setSteps(s => [...s, { ...newStep(), delayDays: (s[s.length - 1]?.delayDays ?? 0) + 1 }]);
  const removeStep = (id: string) => setSteps(s => s.filter(st => st.id !== id));
  const updateStep = (id: string, patch: Partial<CRMSequenceStep>) => setSteps(s => s.map(st => st.id === id ? { ...st, ...patch } : st));

  const handleSave = async () => {
    if (!name.trim() || steps.length === 0) return;
    setSaving(true);
    try { await onSave({ name: name.trim(), description: description.trim() || undefined, steps, isActive: initial?.isActive ?? true }); }
    finally { setSaving(false); }
  };

  const totalDays = steps.reduce((s, st) => s + st.delayDays, 0);

  return (
    <div className="bg-white dark:bg-[#111827] rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-700">
        <h3 className="font-bold text-sm text-gray-900 dark:text-gray-100">{initial ? 'Editar' : 'Nova'} sequência</h3>
        <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors"><X size={15} /></button>
      </div>
      <div className="p-4 space-y-4">
        <div className="space-y-3">
          <input type="text" placeholder="Nome da sequência *" value={name} onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2.5 text-sm bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 text-gray-900 dark:text-gray-100 placeholder:text-gray-400" />
          <input type="text" placeholder="Descrição (opcional)" value={description} onChange={e => setDescription(e.target.value)}
            className="w-full px-3 py-2.5 text-sm bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 text-gray-900 dark:text-gray-100 placeholder:text-gray-400" />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">Passos ({steps.length} · {totalDays} dias)</p>
          </div>
          <div className="space-y-3">
            {steps.map((step, i) => {
              const cfg = ACTION_CONFIG[step.action];
              const Icon = cfg.icon;
              return (
                <div key={step.id} className="relative flex gap-2">
                  {/* Step connector */}
                  {i < steps.length - 1 && (
                    <div className="absolute left-4 top-10 bottom-0 w-px bg-gray-200 dark:bg-gray-700" style={{ height: 'calc(100% + 4px)' }} />
                  )}
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0 z-10 mt-1" style={{ backgroundColor: cfg.color }}>
                    <Icon size={13} />
                  </div>
                  <div className="flex-1 p-3 rounded-xl bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-gray-700 space-y-2">
                    <div className="flex items-center gap-2">
                      <select value={step.action} onChange={e => updateStep(step.id, { action: e.target.value as StepAction })}
                        className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-red-400 flex-1">
                        {Object.entries(ACTION_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                      <div className="flex items-center gap-1 shrink-0">
                        <Clock size={11} className="text-gray-400" />
                        <input type="number" min={0} max={365} value={step.delayDays}
                          onChange={e => updateStep(step.id, { delayDays: Math.max(0, Number(e.target.value)) })}
                          className="w-12 text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none text-center" />
                        <span className="text-xs text-gray-400">d</span>
                      </div>
                      <button onClick={() => removeStep(step.id)} className="p-1 text-gray-300 hover:text-red-500 transition-colors" disabled={steps.length <= 1}><X size={13} /></button>
                    </div>
                    <textarea value={step.content} onChange={e => updateStep(step.id, { content: e.target.value })}
                      placeholder={cfg.placeholder} rows={2}
                      className="w-full text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-red-400 text-gray-700 dark:text-gray-300 placeholder:text-gray-400" />
                  </div>
                </div>
              );
            })}
          </div>
          <button onClick={addStep}
            className="w-full py-2 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-400 hover:border-red-400 hover:text-red-500 transition-colors flex items-center justify-center gap-1.5">
            <Plus size={13} /> Adicionar passo
          </button>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onCancel} className="flex-1 py-2.5 text-sm font-semibold text-gray-500 bg-gray-100 dark:bg-white/[0.06] rounded-xl hover:bg-gray-200 dark:hover:bg-white/[0.1] transition-colors">Cancelar</button>
          <button onClick={handleSave} disabled={saving || !name.trim() || steps.length === 0}
            className="flex-1 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-red-600 to-red-500 rounded-xl hover:from-red-500 hover:to-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function SequenciasTab({ businessId, userId, userName, contacts }: {
  businessId: string;
  userId: string;
  userName: string;
  contacts: CRMContact[];
}) {
  const [sequences, setSequences] = useState<CRMSequence[]>([]);
  const [enrollments, setEnrollments] = useState<CRMSequenceEnrollment[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CRMSequence | null>(null);
  const [enrollTarget, setEnrollTarget] = useState<CRMSequence | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [view, setView] = useState<'sequences' | 'enrollments'>('sequences');

  useEffect(() => {
    if (!businessId) return;
    const unsub = onSnapshot(
      query(collection(db, 'crmSequences'), where('businessId', '==', businessId)),
      snap => setSequences(snap.docs.map(d => ({ ...d.data(), id: d.id } as CRMSequence))),
      err => console.error('[Seq] sequences snapshot error:', err),
    );
    return () => unsub();
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    const unsub = onSnapshot(
      query(collection(db, 'crmEnrollments'), where('businessId', '==', businessId)),
      snap => setEnrollments(snap.docs.map(d => ({ ...d.data(), id: d.id } as CRMSequenceEnrollment))),
      err => console.error('[Seq] enrollments snapshot error:', err),
    );
    return () => unsub();
  }, [businessId]);

  const handleSave = useCallback(async (data: Partial<CRMSequence>) => {
    const now = new Date().toISOString();
    try {
      if (editing) {
        await updateDoc(doc(db, 'crmSequences', editing.id), { ...data, updatedAt: now });
        toast.success('Sequência atualizada!');
      } else {
        await addDoc(collection(db, 'crmSequences'), { ...data, businessId, enrolledCount: 0, createdAt: now, updatedAt: now });
        toast.success('Sequência criada!');
      }
      setShowForm(false); setEditing(null);
    } catch (err) { console.error('[Seq] Save error:', err); toast.error('Erro ao salvar sequência'); }
  }, [businessId, editing]);

  const handleDelete = useCallback(async (seq: CRMSequence) => {
    try {
      await deleteDoc(doc(db, 'crmSequences', seq.id));
      toast.success('Sequência excluída');
    } catch { toast.error('Erro ao excluir'); }
  }, []);

  const handleToggle = useCallback(async (seq: CRMSequence) => {
    try {
      await updateDoc(doc(db, 'crmSequences', seq.id), { isActive: !seq.isActive, updatedAt: new Date().toISOString() });
    } catch { toast.error('Erro ao atualizar'); }
  }, []);

  const handleEnroll = useCallback(async (sequence: CRMSequence, contactId: string) => {
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;
    const now = new Date().toISOString();
    // Compute nextStepAt based on first step delay
    const firstStep = sequence.steps[0];
    const nextDate = firstStep
      ? new Date(Date.now() + firstStep.delayDays * 86_400_000).toISOString()
      : now;
    try {
      await addDoc(collection(db, 'crmEnrollments'), {
        businessId, sequenceId: sequence.id, sequenceName: sequence.name,
        contactId: contact.id, contactName: contact.name,
        status: 'active', currentStep: 0, enrolledAt: now, nextStepAt: nextDate,
        enrolledByUserId: userId, enrolledByUserName: userName,
      });
      // Bump enrolledCount atomically to handle concurrent enrollments
      await updateDoc(doc(db, 'crmSequences', sequence.id), { enrolledCount: increment(1), updatedAt: now });
      // Create scheduled activities for each step
      let cumDays = 0;
      for (const step of sequence.steps) {
        cumDays += step.delayDays;
        const scheduledAt = new Date(Date.now() + cumDays * 86_400_000).toISOString();
        const actType = step.action === 'send_whatsapp' ? 'whatsapp'
          : step.action === 'send_email' ? 'email'
          : step.action === 'create_task' ? 'tarefa'
          : 'nota';
        await addDoc(collection(db, 'crmActivities'), {
          businessId, contactId: contact.id,
          type: actType, title: `[Seq: ${sequence.name}] ${step.label ?? ACTION_CONFIG[step.action].label}`,
          notes: step.content,
          scheduledAt, isCompleted: false, createdAt: now, updatedAt: now,
          assignedTo: userId, assignedToName: userName,
        });
      }
      toast.success(`${contact.name} inscrito em "${sequence.name}"`);
    } catch (err) { console.error('[Seq] Enroll error:', err); toast.error('Erro ao inscrever contato'); }
  }, [businessId, contacts, userId, userName]);

  const handleCancelEnrollment = useCallback(async (enr: CRMSequenceEnrollment) => {
    try {
      await updateDoc(doc(db, 'crmEnrollments', enr.id), { status: 'cancelled', updatedAt: new Date().toISOString() });
      // Delete pending (not yet completed) activities created by this sequence enrollment
      const prefix = `[Seq: ${enr.sequenceName}]`;
      const actSnap = await getDocs(query(
        collection(db, 'crmActivities'),
        where('businessId', '==', enr.businessId),
        where('contactId', '==', enr.contactId),
      ));
      const orphans = actSnap.docs.filter(d => {
        const data = d.data();
        return !data.isCompleted && typeof data.title === 'string' && data.title.startsWith(prefix);
      });
      await Promise.all(orphans.map(d => deleteDoc(d.ref)));
      toast.success('Inscrição cancelada');
    } catch (err) {
      console.error('[Seq] Cancel enrollment error:', err);
      toast.error('Erro ao cancelar');
    }
  }, []);

  const activeEnrollments = enrollments.filter(e => e.status === 'active');
  const completedEnrollments = enrollments.filter(e => e.status !== 'active');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 bg-gray-100 dark:bg-white/[0.06] rounded-xl p-1">
          {(['sequences', 'enrollments'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                view === v ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400')}>
              {v === 'sequences' ? `Templates (${sequences.length})` : `Inscrições (${activeEnrollments.length} ativas)`}
            </button>
          ))}
        </div>
        {view === 'sequences' && !showForm && (
          <button onClick={() => { setShowForm(true); setEditing(null); }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-red-600 to-red-500 text-white rounded-xl font-semibold text-xs shadow-sm hover:from-red-500 hover:to-red-400 transition-colors">
            <Plus size={14} /> Nova sequência
          </button>
        )}
      </div>

      {/* Sequences view */}
      {view === 'sequences' && (
        <div className="space-y-3">
          <AnimatePresence>
            {(showForm || editing) && (
              <motion.div key="form" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <SequenceForm initial={editing} onSave={handleSave} onCancel={() => { setShowForm(false); setEditing(null); }} />
              </motion.div>
            )}
          </AnimatePresence>

          {sequences.length === 0 && !showForm && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-300 dark:text-gray-600">
              <GitBranch size={36} className="mb-3" strokeWidth={1.5} />
              <p className="text-sm font-medium">Nenhuma sequência criada</p>
              <p className="text-xs mt-1">Crie templates de follow-up com múltiplos passos</p>
            </div>
          )}

          {sequences.map((seq, i) => {
            const seqEnrollments = enrollments.filter(e => e.sequenceId === seq.id && e.status === 'active');
            const isExpanded = expandedId === seq.id;
            const totalDays = seq.steps.reduce((s, st) => s + st.delayDays, 0);

            return (
              <motion.div key={seq.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className="bg-white dark:bg-white/[0.03] border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden">
                {/* Card header */}
                <div className="flex items-center gap-3 p-4">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center shrink-0">
                    <GitBranch size={16} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{seq.name}</p>
                      <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', seq.isActive ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-400')}>
                        {seq.isActive ? 'Ativa' : 'Inativa'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-[11px] text-gray-400">{seq.steps.length} passos · {totalDays}d total</span>
                      <span className="text-[11px] text-gray-400 flex items-center gap-1"><Users size={10} /> {seqEnrollments.length} ativos</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => setEnrollTarget(seq)} title="Inscrever contato"
                      className="p-2 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-500 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors">
                      <Play size={13} />
                    </button>
                    <button onClick={() => { setEditing(seq); setShowForm(true); }} title="Editar"
                      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 transition-colors">
                      <Edit3 size={13} />
                    </button>
                    <button onClick={() => handleToggle(seq)} title={seq.isActive ? 'Pausar' : 'Ativar'}
                      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 transition-colors">
                      {seq.isActive ? <Pause size={13} /> : <Play size={13} />}
                    </button>
                    <button onClick={() => handleDelete(seq)} title="Excluir"
                      className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-500 transition-colors">
                      <Trash2 size={13} />
                    </button>
                    <button onClick={() => setExpandedId(isExpanded ? null : seq.id)}
                      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
                      {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  </div>
                </div>

                {/* Steps preview */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden border-t border-gray-100 dark:border-gray-700">
                      <div className="p-4 space-y-2">
                        {seq.steps.map((step, si) => {
                          const cfg = ACTION_CONFIG[step.action];
                          const Icon = cfg.icon;
                          return (
                            <div key={step.id} className="flex items-start gap-2.5">
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-white shrink-0" style={{ backgroundColor: cfg.color }}>
                                <Icon size={11} />
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{cfg.label}</span>
                                  <span className="text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded-full">Dia {seq.steps.slice(0, si + 1).reduce((s, st) => s + st.delayDays, 0)}</span>
                                </div>
                                {step.content && <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">{step.content}</p>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Enrollments view */}
      {view === 'enrollments' && (
        <div className="space-y-3">
          {activeEnrollments.length === 0 && completedEnrollments.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-300 dark:text-gray-600">
              <Users size={36} className="mb-3" strokeWidth={1.5} />
              <p className="text-sm font-medium">Nenhum contato inscrito</p>
              <p className="text-xs mt-1">Inscreva contatos nas sequências para iniciar follow-ups</p>
            </div>
          )}

          {[...activeEnrollments, ...completedEnrollments].map((enr, i) => (
            <motion.div key={enr.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className="flex items-center gap-3 p-3.5 bg-white dark:bg-white/[0.03] border border-gray-200 dark:border-gray-700 rounded-xl">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-600 flex items-center justify-center text-[11px] font-bold text-gray-600 dark:text-gray-300 shrink-0">
                {enr.contactName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-gray-800 dark:text-gray-200 truncate">{enr.contactName}</p>
                <p className="text-[10px] text-gray-400 truncate">{enr.sequenceName} · início {formatDate(enr.enrolledAt)}</p>
                {enr.nextStepAt && enr.status === 'active' && (
                  <p className="text-[10px] text-blue-500 dark:text-blue-400">Próximo passo: {formatDate(enr.nextStepAt)}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                  enr.status === 'active' ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                    : enr.status === 'completed' ? 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-400')}>
                  {enr.status === 'active' ? 'Ativo' : enr.status === 'completed' ? 'Concluído' : 'Cancelado'}
                </span>
                {enr.status === 'active' && (
                  <button onClick={() => handleCancelEnrollment(enr)}
                    className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-500 transition-colors">
                    <X size={13} />
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Enroll dialog */}
      <AnimatePresence>
        {enrollTarget && (
          <EnrollDialog
            sequence={enrollTarget}
            contacts={contacts}
            onClose={() => setEnrollTarget(null)}
            onEnroll={(contactId) => handleEnroll(enrollTarget, contactId)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
