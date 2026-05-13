'use client';

/**
 * Modal de "Importar cliente para o pipeline".
 *
 * Substitui os botões "Novo Deal" e "+ Contato" no header do CRM (que eram
 * pouco usados e duplicavam o cadastro de cliente). Agora o fluxo único pra
 * trazer alguém pro pipeline é: existe em /clients → importa pro CRM.
 *
 * 2 passos:
 *   1. Busca cliente com inPipeline:false (criado via quickCreate da conversa
 *      ou cadastrado em /clients fora do funil). Match em nome/email/
 *      telefone/CPF.
 *   2. Preenche os campos CRM-only que /clients não captura: status (stage
 *      inicial), assignedTo, preferredChannel, profile, suggestedAction.
 *
 * Salvar = updateDoc no doc do client: { inPipeline:true, status:stage, ... }.
 * Reaproveita o doc — sem criar duplicata.
 */

import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Search, X, UserPlus, ArrowLeft, Sparkles } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { cn } from '@/lib/utils';
import type { Client, CRMStageConfig, LeadStatus, User } from '@/lib/types';
import { digits, normEmail } from '../clients/shared/duplicates';
import {
  ModernDialog, ModernDialogActions, ModernCancelButton, ModernPrimaryButton, ModernSection,
} from '@/app/components/ui/dialog';
import { TextField, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { Tag } from 'lucide-react';

export function ImportLeadModal({
  open,
  onClose,
  onDone,
  contacts,
  members,
  stages,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (importedClientId: string) => void;
  /** Lista completa de contatos (Client[]) do tenant — o modal filtra
   *  internamente pra mostrar só quem está fora do pipeline. */
  contacts: Client[];
  members: User[];
  stages: CRMStageConfig[];
}) {
  const [step, setStep] = useState<'search' | 'fill'>('search');
  const [selected, setSelected] = useState<Client | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [saving, setSaving] = useState(false);

  // Form CRM-only — preenche o que /clients não captura.
  const [stage, setStage] = useState<LeadStatus>('novo');
  const [assignedTo, setAssignedTo] = useState('');
  const [preferredChannel, setPreferredChannel] = useState('');
  const [profile, setProfile] = useState('');
  const [suggestedAction, setSuggestedAction] = useState('');

  // Candidatos: clientes com inPipeline EXPLICITAMENTE false. Legacy (sem o
  // campo) já é tratado como visível no pipeline (ver pipelineContacts no
  // CRMModule), então não precisa ser "importado".
  const candidates = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const termDigits = digits(searchTerm);
    return contacts
      .filter(c => c.inPipeline === false)
      .filter(c => {
        if (!term) return true;
        if (c.name?.toLowerCase().includes(term)) return true;
        if (normEmail(c.email).includes(term)) return true;
        if (c.company?.toLowerCase().includes(term)) return true;
        if (termDigits) {
          if (digits(c.phone).includes(termDigits)) return true;
          if (digits(c.whatsapp).includes(termDigits)) return true;
          if (digits(c.cpfCnpj).includes(termDigits)) return true;
        }
        return false;
      })
      .slice(0, 50);
  }, [contacts, searchTerm]);

  const reset = () => {
    setStep('search');
    setSelected(null);
    setSearchTerm('');
    setStage('novo');
    setAssignedTo('');
    setPreferredChannel('');
    setProfile('');
    setSuggestedAction('');
  };

  const handleSelect = (c: Client) => {
    setSelected(c);
    // Pré-popula campos com o que já existe no doc (raramente já tem, mas
    // se o cliente passou por outro fluxo e tem profile/assignedTo, herda).
    setStage(c.status ?? 'novo');
    setAssignedTo(c.assignedTo ?? '');
    setPreferredChannel((c.preferredChannel as string) ?? '');
    setProfile((c.profile as string) ?? '');
    setSuggestedAction(c.suggestedAction ?? '');
    setStep('fill');
  };

  const handleImport = async () => {
    if (!selected || saving) return;
    setSaving(true);
    try {
      const member = members.find(m => m.id === assignedTo);
      const patch: Record<string, unknown> = {
        inPipeline: true,
        status: stage,
        updatedAt: new Date().toISOString(),
      };
      // Só grava campos preenchidos — evita sujar doc com strings vazias
      // e respeita o "Auto" do profile (que vira undefined).
      if (assignedTo) {
        patch.assignedTo = assignedTo;
        patch.assignedToName = member?.name || '';
      }
      if (preferredChannel) patch.preferredChannel = preferredChannel;
      if (profile) patch.profile = profile;
      if (suggestedAction.trim()) patch.suggestedAction = suggestedAction.trim();

      await updateDoc(doc(db, 'clients', selected.id), patch);
      const importedId = selected.id;
      reset();
      onDone(importedId);
    } catch (err) {
      console.error('[ImportLead] failed:', err);
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

  if (typeof document === 'undefined' || !open) return null;

  if (step === 'fill' && selected) {
    return (
      <ModernDialog
        open={open}
        onClose={handleClose}
        icon={UserPlus}
        title="Importar cliente — Campos do CRM"
        maxWidth="sm"
        footer={
          <ModernDialogActions>
            <ModernCancelButton
              onClick={() => { if (!saving) { setStep('search'); setSelected(null); } }}
            >
              <ArrowLeft className="w-3.5 h-3.5 inline mr-1" /> Voltar
            </ModernCancelButton>
            <ModernPrimaryButton onClick={handleImport} disabled={saving}>
              {saving ? 'Importando...' : 'Importar para pipeline'}
            </ModernPrimaryButton>
          </ModernDialogActions>
        }
      >
        {/* Preview do cliente — read-only. Pra editar dados gerais, vá em /clients. */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50/50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/20 mb-1">
          <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0">
            {selected.avatarUrl ? (
              <img src={selected.avatarUrl} alt={selected.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white text-sm font-bold">
                {(selected.name?.[0] ?? '?').toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{selected.name}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {[selected.phone, selected.email].filter(Boolean).join(' · ') || 'Sem contato'}
            </p>
          </div>
        </div>

        <ModernSection icon={Tag} title="Classificação no pipeline">
          <div className="grid grid-cols-2 gap-3">
            <FormControl size="small" fullWidth>
              <InputLabel>Estágio inicial</InputLabel>
              <Select
                value={stage}
                onChange={(e) => setStage(e.target.value as LeadStatus)}
                label="Estágio inicial"
              >
                {stages.map((s) => (
                  <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>Responsável</InputLabel>
              <Select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                label="Responsável"
              >
                <MenuItem value="">Nenhum</MenuItem>
                {members.map((m) => (
                  <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormControl size="small" fullWidth>
              <InputLabel>Canal preferido</InputLabel>
              <Select
                value={preferredChannel}
                onChange={(e) => setPreferredChannel(e.target.value)}
                label="Canal preferido"
              >
                <MenuItem value="">Nenhum</MenuItem>
                <MenuItem value="whatsapp">WhatsApp</MenuItem>
                <MenuItem value="facebook">Messenger</MenuItem>
                <MenuItem value="instagram">Instagram</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>Perfil</InputLabel>
              <Select
                value={profile}
                onChange={(e) => setProfile(e.target.value)}
                label="Perfil"
              >
                <MenuItem value="">Auto</MenuItem>
                <MenuItem value="vip">👑 VIP</MenuItem>
                <MenuItem value="regular">● Regular</MenuItem>
                <MenuItem value="sporadic">◌ Esporádico</MenuItem>
                <MenuItem value="new">✦ Novo</MenuItem>
                <MenuItem value="at_risk">⚠ Em risco</MenuItem>
                <MenuItem value="churned">✕ Perdido</MenuItem>
              </Select>
            </FormControl>
          </div>
        </ModernSection>

        <ModernSection icon={Sparkles} title="Inteligência">
          <TextField
            label="Próxima ação sugerida"
            value={suggestedAction}
            onChange={(e) => setSuggestedAction(e.target.value)}
            fullWidth
            size="small"
            placeholder="Ligar para qualificar, oferecer reunião..."
          />
        </ModernSection>
      </ModernDialog>
    );
  }

  // Passo 1: search
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50 overflow-hidden flex flex-col max-h-[calc(100vh-2rem)]"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0 gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-500/10 flex items-center justify-center flex-shrink-0">
              <UserPlus className="w-4 h-4 text-red-500" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-gray-900 dark:text-white text-sm">Importar cliente</h2>
              <p className="text-[10px] text-gray-400 truncate">
                Selecione um cliente cadastrado em /clientes para trazer ao pipeline
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por nome, telefone, email, CPF/CNPJ..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              autoFocus
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/40"
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-2 min-h-[200px]">
          {candidates.length === 0 ? (
            <div className="text-center py-10 text-xs text-gray-400">
              {searchTerm
                ? 'Nenhum cliente encontrado fora do pipeline'
                : 'Nenhum cliente fora do pipeline. Vincule contatos via Conversas pra que apareçam aqui.'}
            </div>
          ) : (
            <ul className="space-y-1">
              {candidates.map(c => (
                <li key={c.id}>
                  <button
                    onClick={() => handleSelect(c)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors text-left"
                  >
                    <div className="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0">
                      {c.avatarUrl ? (
                        <img src={c.avatarUrl} alt={c.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center text-white text-xs font-bold">
                          {(c.name?.[0] ?? '?').toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={cn(
                        'text-xs font-semibold text-gray-900 dark:text-white truncate',
                      )}>{c.name}</p>
                      <p className="text-[10px] text-gray-400 truncate">
                        {[c.phone, c.email, c.cpfCnpj].filter(Boolean).join(' · ') || 'Sem contato'}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}
