'use client';

/**
 * LancarSheet — o FAB "⊕ Lançar" global do mockup: cria uma Transaction
 * avulsa (`status: 'pendente'`) direto na linha do tempo. O checkbox "isso se
 * repete todo mês" é só o gancho inicial (plano §4 `LancarSheet`) — grava uma
 * `recurrence` mensal mínima e ativa; a configuração completa (frequência,
 * dia fixo, ajuste de feriado) acontece depois em Recorrentes
 * (`RecurrenceDetailDialog`-equivalente do v2, fora do escopo desta tela).
 */

import { useEffect, useState } from 'react';
import { addDoc, collection } from 'firebase/firestore';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { logAudit } from '@/lib/services/audit';
import { cn } from '@/lib/utils';
import { FinModal, FinModalButton } from './FinModal';
import type { TransactionType } from '@/lib/types';

// Réplica das categorias hardcoded do FinancialModule clássico
// (INCOME_CATEGORIES/EXPENSE_CATEGORIES, linha ~152) — mantém as MESMAS
// categorias pra `resumo-por-categoria.ts` agrupar contra o histórico real do
// tenant em vez de fragmentar em rótulos novos.
const INCOME_CATEGORIES = ['Assinaturas', 'Implantacao', 'Consultoria', 'Servicos', 'Vendas', 'Juros', 'Outros'];
const EXPENSE_CATEGORIES = ['Escritorio', 'Infraestrutura', 'Folha', 'Beneficios', 'Marketing', 'Software', 'Contabilidade', 'Impostos', 'Pro-labore', 'Energia', 'Juridico', 'Aluguel', 'Transporte', 'Estornos', 'Taxas de pagamento', 'Outros'];

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const inputClass = 'w-full rounded-[10px] border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--fin-primary))]';

interface LancarSheetProps {
  open: boolean;
  onClose: () => void;
}

export function LancarSheet({ open, onClose }: LancarSheetProps) {
  const { business, user } = useAuth();
  const queryClient = useQueryClient();
  const [tipo, setTipo] = useState<TransactionType>('receita');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(INCOME_CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(todayStr());
  const [recorrente, setRecorrente] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTipo('receita');
    setDescription('');
    setCategory(INCOME_CATEGORIES[0]);
    setAmount('');
    setDueDate(todayStr());
    setRecorrente(false);
  }, [open]);

  useEffect(() => {
    setCategory(tipo === 'receita' ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0]);
  }, [tipo]);

  const categories = tipo === 'receita' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const amountValue = Number(amount);
  const canSave = description.trim().length > 0 && amountValue > 0 && !!dueDate;

  function handleClose() {
    if (saving) return;
    onClose();
  }

  async function handleSave() {
    if (!canSave || !business?.id || !user) return;
    setSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const trimmedDescription = description.trim();
      const payload: Record<string, unknown> = {
        businessId: business.id,
        type: tipo,
        description: trimmedDescription,
        category,
        amount: amountValue,
        dueDate,
        status: 'pendente',
        createdAt: nowIso,
        updatedAt: nowIso,
        createdBy: user.uid,
        createdByName: user.name,
      };
      if (recorrente) {
        payload.recurrence = {
          frequency: 'monthly',
          nextDueDate: dueDate,
          isActive: true,
          label: trimmedDescription,
          history: [],
        };
      }

      const ref = await addDoc(collection(db, 'transactions'), payload);
      await logAudit(db, {
        businessId: business.id,
        entity: 'transaction',
        entityId: ref.id,
        action: 'create',
        actor: { uid: user.uid, name: user.name },
        after: payload,
        amount: amountValue,
        description: trimmedDescription,
      });

      queryClient.invalidateQueries({ queryKey: ['fin2-transactions', business.id] });
      toast.success('Lançamento criado — já apareceu na linha do tempo.');
      onClose();
    } catch (err) {
      console.error('[LancarSheet] erro ao salvar lançamento:', err);
      toast.error('Não deu pra salvar o lançamento. Tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <FinModal
      open={open}
      onClose={handleClose}
      eyebrow="Lançamento rápido"
      title="Novo lançamento"
      description="Registre uma entrada ou saída. Dá pra ajustar tudo depois."
      footer={
        <>
          <FinModalButton onClick={handleClose} disabled={saving}>Cancelar</FinModalButton>
          <FinModalButton variant="primary" onClick={handleSave} disabled={!canSave || saving}>
            {saving ? 'Salvando…' : 'Salvar lançamento'}
          </FinModalButton>
        </>
      }
    >
      <div className="inline-flex self-start rounded-[11px] border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-800/60 p-[3px] gap-0.5">
        {(['receita', 'despesa'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTipo(t)}
            className={cn(
              'px-3.5 py-1.5 rounded-lg text-[13px] font-semibold transition-colors',
              tipo === t ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-50 shadow-sm' : 'text-gray-500 dark:text-gray-400',
            )}
          >
            {t === 'receita' ? 'Entrada' : 'Saída'}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Descrição</span>
        <input
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Ex.: Recebimento Padaria Central"
          className={inputClass}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Categoria</span>
          <select value={category} onChange={e => setCategory(e.target.value)} className={inputClass}>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Valor</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0"
            className={cn(inputClass, 'fin-num')}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Vencimento</span>
        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={cn(inputClass, 'fin-num')} />
      </label>

      <label className="flex items-start gap-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 px-3.5 py-3 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
        <input type="checkbox" checked={recorrente} onChange={e => setRecorrente(e.target.checked)} className="mt-0.5" />
        <span>
          🔁 <b className="text-gray-800 dark:text-gray-200 font-bold">Isso se repete todo mês</b> — depois de salvar, dá pra
          configurar a recorrência completa em Recorrentes.
        </span>
      </label>
    </FinModal>
  );
}
