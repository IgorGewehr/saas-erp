'use client';

/**
 * ConciliacaoBaldesCard — card direito de Bancário: os "3 baldes" da
 * conciliação (mockup bancario.html). Overview = 3 grupos por severidade
 * (bateu / sobrou no banco / sobrou no sistema); detalhe = itens com ação de
 * 1 clique. Drill PRÓPRIO (independente do card esquerdo — ver `DualDrillPair`).
 *
 * Mutações Firestore ficam aqui, mesmo padrão do `BaixaDialog`/`LancarSheet`:
 * addDoc/updateDoc direto (R1 businessId sempre presente) + `logAudit` +
 * invalidate de query + toast. Nenhum re-import de dados aqui — o motor de
 * IMPORTAR extrato (OFX/CSV) continua sendo a `ConciliacaoTab` clássica
 * (botão "Importar extrato" no subhead da aba).
 */

import { useState } from 'react';
import { addDoc, collection, doc, increment, updateDoc } from 'firebase/firestore';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { Check } from 'lucide-react';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { logAudit } from '@/lib/services/audit';
import { DrillCardHeader } from '../../components/DrillPair';
import type { ConciliacaoBaldesOverview, BaldeBancoItem, BaldeSistemaItem } from '../../read-models/conciliacao-3-baldes';
import type { BankAccount } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils/format';

export type BaldeId = 'ok' | 'banco' | 'sistema';

interface ConciliacaoBaldesCardProps {
  overview: ConciliacaoBaldesOverview;
  contas: BankAccount[];
  selectedId: BaldeId | null;
  onSelect: (id: BaldeId) => void;
  onBack: () => void;
}

const rowClass =
  'flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-left w-full transition-colors bg-gray-50 dark:bg-gray-800/60 ' +
  'hover:brightness-[0.97] dark:hover:brightness-125 focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-[hsl(var(--fin-primary))] focus-visible:outline-offset-2';

const SEV_DOT: Record<'pos' | 'warn', string> = {
  pos: 'bg-[hsl(var(--fin-pos))]',
  warn: 'bg-[hsl(var(--fin-warn))]',
};

export function ConciliacaoBaldesCard({ overview, contas, selectedId, onSelect, onBack }: ConciliacaoBaldesCardProps) {
  if (selectedId === 'ok') return <BateuDetail overview={overview} onBack={onBack} />;
  if (selectedId === 'banco') return <SobrouBancoDetail items={overview.sobrouBanco} contas={contas} onBack={onBack} />;
  if (selectedId === 'sistema') return <SobrouSistemaDetail items={overview.sobrouSistema} onBack={onBack} />;

  const rows: { id: BaldeId; label: string; count: number; sev: 'pos' | 'warn'; desc: string }[] = [
    {
      id: 'ok',
      label: 'Bateu certinho',
      count: overview.bateuCount,
      sev: 'pos',
      desc: `${overview.bateuCount} item${overview.bateuCount !== 1 ? 's' : ''} conciliado${overview.bateuCount !== 1 ? 's' : ''} — nada a fazer.`,
    },
    {
      id: 'banco',
      label: 'Sobrou no banco',
      count: overview.sobrouBanco.length,
      sev: overview.sobrouBanco.length ? 'warn' : 'pos',
      desc: 'Aparece no extrato importado, mas não tem lançamento no sistema.',
    },
    {
      id: 'sistema',
      label: 'Sobrou no sistema',
      count: overview.sobrouSistema.length,
      sev: overview.sobrouSistema.length ? 'warn' : 'pos',
      desc: 'Lançado como pago no sistema, mas o banco ainda não confirmou.',
    },
  ];

  return (
    <>
      <DrillCardHeader title="Conciliação" hint="clique num grupo p/ ver os itens →" />
      <div className="px-3 pb-3.5 flex flex-col gap-2">
        {rows.map(r => (
          <button key={r.id} type="button" onClick={() => onSelect(r.id)} className={rowClass}>
            <span className={`flex-none w-1.5 self-stretch rounded-md ${SEV_DOT[r.sev]}`} />
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-gray-900 dark:text-gray-100">
                {r.label} <span className="fin-num">· {r.count}</span>
              </span>
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{r.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

function BateuDetail({ overview, onBack }: { overview: ConciliacaoBaldesOverview; onBack: () => void }) {
  return (
    <>
      <DrillCardHeader title="Bateu certinho" hint={`${overview.bateuCount} itens · amostra`} onBack={onBack} />
      <div className="px-4.5 pb-2 flex flex-col">
        {overview.bateuAmostra.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">Nenhum item conciliado ainda.</div>
        ) : (
          overview.bateuAmostra.map(a => (
            <div key={a.id} className="flex items-center gap-2.5 py-2 border-b border-gray-100 dark:border-gray-800/60 last:border-0 text-[12.5px]">
              <span className="fin-num flex-none w-16 text-gray-400 dark:text-gray-500">{formatDate(a.date)}</span>
              <span className="flex-1 min-w-0 truncate text-gray-700 dark:text-gray-300">{a.desc}</span>
              <span className="flex-none inline-flex items-center gap-1 text-[11px] font-semibold text-[hsl(var(--fin-pos))]">
                <Check className="w-3 h-3" /> auto
              </span>
            </div>
          ))
        )}
      </div>
      <div className="px-4.5 pb-4 text-xs text-gray-400 dark:text-gray-500">
        Valor e data batem automaticamente — nenhuma ação necessária.
      </div>
    </>
  );
}

function useReconciliationInvalidate() {
  const { business } = useAuth();
  const queryClient = useQueryClient();
  return () => {
    if (!business?.id) return;
    queryClient.invalidateQueries({ queryKey: ['fin2-reconciliationItems', business.id] });
    queryClient.invalidateQueries({ queryKey: ['fin2-transactions', business.id] });
    queryClient.invalidateQueries({ queryKey: ['bankAccounts', business.id] });
  };
}

function SobrouBancoDetail({ items, contas, onBack }: { items: BaldeBancoItem[]; contas: BankAccount[]; onBack: () => void }) {
  const { business, user } = useAuth();
  const invalidateAll = useReconciliationInvalidate();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function handleConfirm(item: BaldeBancoItem) {
    if (!business?.id || !user || !item.sugestao) return;
    setPendingId(item.id);
    try {
      const nowIso = new Date().toISOString();
      await updateDoc(doc(db, 'reconciliationItems', item.id), {
        status: 'matched',
        transactionId: item.sugestao.transactionId,
        matchConfidence: item.sugestao.confidence,
        reconciledBy: user.uid,
        reconciledAt: nowIso,
      });
      await logAudit(db, {
        businessId: business.id,
        entity: 'transaction',
        entityId: item.sugestao.transactionId,
        action: 'update',
        actor: { uid: user.uid, name: user.name },
        after: { reconciled: true },
        description: `Conciliado com item do banco: ${item.desc}`,
      });
      invalidateAll();
      toast.success('Conciliado — o item saiu de "sobrou no banco".');
    } catch (err) {
      console.error('[ConciliacaoBaldesCard] erro ao confirmar match:', err);
      toast.error('Não deu pra confirmar. Tente de novo.');
    } finally {
      setPendingId(null);
    }
  }

  async function handleIgnore(item: BaldeBancoItem) {
    if (!business?.id) return;
    setPendingId(item.id);
    try {
      await updateDoc(doc(db, 'reconciliationItems', item.id), { status: 'ignored' });
      invalidateAll();
      toast.success('Item ignorado.');
    } catch (err) {
      console.error('[ConciliacaoBaldesCard] erro ao ignorar:', err);
      toast.error('Não deu pra ignorar. Tente de novo.');
    } finally {
      setPendingId(null);
    }
  }

  async function handleLancar(item: BaldeBancoItem) {
    if (!business?.id || !user) return;
    const targetAccountId = item.bankAccountId || (contas.length === 1 ? contas[0].id : undefined);
    if (!targetAccountId) {
      toast.error('Esse item não tem conta associada — importe vinculado a uma conta específica pra lançar direto.');
      return;
    }
    setPendingId(item.id);
    try {
      const nowIso = new Date().toISOString();
      const type = item.valor >= 0 ? 'receita' : 'despesa';
      const payload = {
        businessId: business.id,
        type,
        description: item.desc,
        category: 'Outros',
        amount: Math.abs(item.valor),
        dueDate: item.date,
        paymentDate: item.date,
        status: 'pago' as const,
        bankAccountId: targetAccountId,
        createdAt: nowIso,
        updatedAt: nowIso,
        createdBy: user.uid,
        createdByName: user.name,
      };
      const ref = await addDoc(collection(db, 'transactions'), payload);
      await updateDoc(doc(db, 'bankAccounts', targetAccountId), { balance: increment(item.valor), updatedAt: nowIso });
      await updateDoc(doc(db, 'reconciliationItems', item.id), {
        status: 'matched',
        transactionId: ref.id,
        matchConfidence: 100,
        reconciledBy: user.uid,
        reconciledAt: nowIso,
      });
      await logAudit(db, {
        businessId: business.id,
        entity: 'transaction',
        entityId: ref.id,
        action: 'create',
        actor: { uid: user.uid, name: user.name },
        after: payload,
        amount: payload.amount,
        description: payload.description,
      });
      invalidateAll();
      toast.success('Lançamento criado e conciliado.');
    } catch (err) {
      console.error('[ConciliacaoBaldesCard] erro ao lançar:', err);
      toast.error('Não deu pra lançar. Tente de novo.');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <DrillCardHeader title="Sobrou no banco" hint={`${items.length} pendente${items.length === 1 ? '' : 's'}`} onBack={onBack} />
      <div className="px-3.5 pb-3.5 flex flex-col gap-2 max-h-[340px] overflow-y-auto">
        {items.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Tudo resolvido por aqui.</div>
        ) : (
          items.map(item => {
            const busy = pendingId === item.id;
            return (
              <div key={item.id} className="rounded-xl bg-gray-50 dark:bg-gray-800/60 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2 text-[13px] font-semibold">
                  <span className="text-gray-800 dark:text-gray-200 min-w-0 truncate">{formatDate(item.date)} · {item.desc}</span>
                  <span className={`fin-num flex-none ${item.valor < 0 ? 'text-[hsl(var(--fin-crit))]' : 'text-[hsl(var(--fin-pos))]'}`}>
                    {item.valor < 0 ? '−' : '+'}{formatCurrency(Math.abs(item.valor))}
                  </span>
                </div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  {item.sugestao
                    ? `Parece a "${item.sugestao.label}" (${item.sugestao.confidence}% de confiança).`
                    : 'Sem lançamento correspondente no sistema.'}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.sugestao ? (
                    <button
                      disabled={busy}
                      onClick={() => handleConfirm(item)}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[hsl(var(--fin-pos))] text-white disabled:opacity-50 transition-opacity"
                    >
                      {busy ? 'Confirmando…' : 'É essa! confirmar'}
                    </button>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() => handleLancar(item)}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[hsl(var(--fin-primary))] text-white disabled:opacity-50 transition-opacity"
                    >
                      {busy ? 'Lançando…' : `Lançar como ${item.valor < 0 ? 'despesa' : 'receita'}`}
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => handleIgnore(item)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-50 transition-opacity"
                  >
                    {item.sugestao ? 'Não é essa' : 'Ignorar'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

function SobrouSistemaDetail({ items, onBack }: { items: BaldeSistemaItem[]; onBack: () => void }) {
  const { business, user } = useAuth();
  const invalidateAll = useReconciliationInvalidate();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function handleConfirm(item: BaldeSistemaItem) {
    if (!business?.id || !user) return;
    setPendingId(item.id);
    try {
      const nowIso = new Date().toISOString();
      const payload: Record<string, unknown> = {
        businessId: business.id,
        importId: 'manual',
        statementDate: item.date,
        statementDescription: item.desc,
        statementAmount: item.valor,
        transactionId: item.id,
        status: 'matched',
        matchConfidence: 100,
        reconciledBy: user.uid,
        reconciledAt: nowIso,
        createdAt: nowIso,
      };
      if (item.bankAccountId) payload.bankAccountId = item.bankAccountId;
      await addDoc(collection(db, 'reconciliationItems'), payload);
      await logAudit(db, {
        businessId: business.id,
        entity: 'transaction',
        entityId: item.id,
        action: 'update',
        actor: { uid: user.uid, name: user.name },
        after: { reconciled: true },
        description: `Confirmado manualmente que caiu no banco: ${item.desc}`,
      });
      invalidateAll();
      toast.success('Marcado como conciliado.');
    } catch (err) {
      console.error('[ConciliacaoBaldesCard] erro ao marcar conciliado:', err);
      toast.error('Não deu pra marcar. Tente de novo.');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <DrillCardHeader title="Sobrou no sistema" hint={`${items.length} pendente${items.length === 1 ? '' : 's'}`} onBack={onBack} />
      <div className="px-3.5 pb-3.5 flex flex-col gap-2 max-h-[340px] overflow-y-auto">
        {items.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">Tudo resolvido por aqui.</div>
        ) : (
          items.map(item => {
            const busy = pendingId === item.id;
            return (
              <div key={item.id} className="rounded-xl bg-gray-50 dark:bg-gray-800/60 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2 text-[13px] font-semibold">
                  <span className="text-gray-800 dark:text-gray-200 min-w-0 truncate">{formatDate(item.date)} · {item.desc}</span>
                  <span className={`fin-num flex-none ${item.valor < 0 ? 'text-[hsl(var(--fin-crit))]' : 'text-[hsl(var(--fin-pos))]'}`}>
                    {item.valor < 0 ? '−' : '+'}{formatCurrency(Math.abs(item.valor))}
                  </span>
                </div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  Lançado no sistema, mas o banco ainda não confirmou — normal em D+1 no cartão.
                </div>
                <div className="mt-2">
                  <button
                    disabled={busy}
                    onClick={() => handleConfirm(item)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[hsl(var(--fin-pos))] text-white disabled:opacity-50 transition-opacity"
                  >
                    {busy ? 'Confirmando…' : 'Confirmar que caiu no banco'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
