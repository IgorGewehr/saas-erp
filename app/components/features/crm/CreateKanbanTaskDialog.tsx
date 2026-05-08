'use client';

/**
 * CreateKanbanTaskDialog — modal compacto pra criar uma tarefa no Kanban
 * a partir do detalhe de um contato CRM.
 *
 * Substitui o caso de uso "atividade tipo tarefa" (deprecated em
 * Activities CRM). Tarefas com prazo + múltiplos responsáveis vivem no
 * Kanban. Esse modal é ponte: cria o card, vincula via
 * relatedContactId/relatedContactName e mostra toast com link pro
 * módulo Kanban.
 *
 * Schema mínimo: título obrigatório, prazo opcional, board+coluna
 * selecionados. Pra editar prioridade, labels, assignees, checklist —
 * abre o card no Kanban depois.
 */

import { useEffect, useState } from 'react';
import { collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { ModernDialog, ModernDialogActions, ModernCancelButton, ModernPrimaryButton, ModernSection } from '@/app/components/ui/dialog';
import { TextField, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { CheckSquare } from 'lucide-react';
import { toast } from 'react-toastify';
import type { CRMContact, KanbanBoard, KanbanColumn } from '@/lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  contact: CRMContact;
  businessId: string;
  user: { uid: string; name: string };
  /** Callback quando o card é criado com sucesso, recebe o card.id.
   *  O caller pode usar pra navegar pro Kanban. */
  onCreated?: (cardId: string, boardId: string) => void;
}

export default function CreateKanbanTaskDialog({ open, onClose, contact, businessId, user, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [boardId, setBoardId] = useState('');
  const [columnId, setColumnId] = useState('');
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Carrega boards do business quando o modal abre. Filter client-side
  // por isActive (rules + visibility já cobrem cross-tenant).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'kanbanBoards'),
          where('businessId', '==', businessId),
        ));
        const list = snap.docs
          .map(d => ({ ...d.data(), id: d.id } as KanbanBoard))
          .filter(b => !b.isArchived);
        if (cancelled) return;
        setBoards(list);
        // Pré-seleciona o primeiro board e sua primeira coluna
        if (list.length > 0) {
          setBoardId(list[0].id);
          setColumnId(list[0].columns?.[0]?.id ?? '');
        }
      } catch (err) {
        console.error('[CreateKanbanTaskDialog] load boards error:', err);
        toast.error('Erro ao carregar quadros');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, businessId]);

  // Reseta form ao abrir/fechar
  useEffect(() => {
    if (!open) {
      setTitle('');
      setDueDate('');
    } else {
      // Pré-popula título com o nome do contato pra dar contexto rápido
      setTitle(`Tarefa: ${contact.name}`);
    }
  }, [open, contact.name]);

  const selectedBoard = boards.find(b => b.id === boardId);
  const columns: KanbanColumn[] = selectedBoard?.columns ?? [];

  // Quando muda o board, reseta a coluna pra primeira do novo board
  useEffect(() => {
    if (selectedBoard) {
      setColumnId(selectedBoard.columns?.[0]?.id ?? '');
    }
  }, [selectedBoard]);

  const handleSubmit = async () => {
    if (!title.trim() || !boardId || !columnId) return;
    setSaving(true);
    try {
      // Conta cards existentes na coluna pra colocar este no fim
      const existingSnap = await getDocs(query(
        collection(db, 'kanbanCards'),
        where('businessId', '==', businessId),
        where('boardId', '==', boardId),
        where('columnId', '==', columnId),
      ));
      const orderInColumn = existingSnap.size;

      const now = new Date().toISOString();
      const cardRef = await addDoc(collection(db, 'kanbanCards'), {
        businessId,
        boardId,
        columnId,
        title: title.trim(),
        description: null,
        priority: 'medium',
        labels: [],
        assigneeIds: [],
        assigneeNames: [],
        dueDate: dueDate || null,
        checklist: [],
        commentsCount: 0,
        attachmentsCount: 0,
        coverColor: null,
        order: orderInColumn,
        // Vínculo com o contato CRM — listado nas tarefas pendentes do
        // contato no detail panel + clique abre o card no Kanban.
        relatedContactId: contact.id,
        relatedContactName: contact.name,
        createdBy: user.uid,
        createdAt: now,
        updatedAt: now,
      });

      toast.success('Tarefa criada no Kanban');
      onCreated?.(cardRef.id, boardId);
      onClose();
    } catch (err) {
      console.error('[CreateKanbanTaskDialog] create error:', err);
      toast.error('Erro ao criar tarefa');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModernDialog
      open={open}
      onClose={onClose}
      icon={CheckSquare}
      title="Nova tarefa no Kanban"
      maxWidth="sm"
      footer={
        <ModernDialogActions>
          <ModernCancelButton onClick={onClose}>Cancelar</ModernCancelButton>
          <ModernPrimaryButton
            onClick={handleSubmit}
            disabled={saving || !title.trim() || !boardId || !columnId || boards.length === 0}
          >
            {saving ? 'Criando...' : 'Criar tarefa'}
          </ModernPrimaryButton>
        </ModernDialogActions>
      }
    >
      <ModernSection icon={CheckSquare} title="Detalhes">
        <div className="space-y-3">
          {boards.length === 0 && !loading && (
            <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2">
              Nenhum quadro Kanban disponível. Crie um quadro no módulo Kanban antes.
            </p>
          )}
          <TextField
            label="Título"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
            size="small"
            autoFocus
          />
          <TextField
            label="Prazo (opcional)"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            fullWidth
            size="small"
            InputLabelProps={{ shrink: true }}
          />
          {boards.length > 0 && (
            <>
              <FormControl size="small" fullWidth>
                <InputLabel>Quadro</InputLabel>
                <Select value={boardId} label="Quadro" onChange={(e) => setBoardId(e.target.value)}>
                  {boards.map(b => (
                    <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" fullWidth disabled={columns.length === 0}>
                <InputLabel>Coluna</InputLabel>
                <Select value={columnId} label="Coluna" onChange={(e) => setColumnId(e.target.value)}>
                  {columns.map(c => (
                    <MenuItem key={c.id} value={c.id}>{c.title}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </>
          )}
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Vinculado ao contato <strong>{contact.name}</strong>. Edite prioridade, responsáveis e checklist após criar, no módulo Kanban.
          </p>
        </div>
      </ModernSection>
    </ModernDialog>
  );
}
