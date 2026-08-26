'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Landmark, ReceiptText, Wallet, X } from 'lucide-react';
import { toast } from 'react-toastify';
import { db } from '@/lib/config/firebase';
import { linkPurchaseFinancial } from '@/lib/services/purchase-import-client';
import type { PurchaseNote, BankAccount } from '@/lib/types';
import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils';

type PurchasePaymentMethod = 'dinheiro' | 'pix' | 'credito' | 'debito' | 'boleto' | 'outros';

const PAYMENT_METHODS: Array<{ value: PurchasePaymentMethod; label: string }> = [
  { value: 'pix', label: 'Pix' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'debito', label: 'Débito' },
  { value: 'credito', label: 'Crédito' },
  { value: 'outros', label: 'Outro' },
];

function datePlusDays(value: string, days: number): string {
  const parsed = new Date(value);
  const base = Number.isFinite(parsed.getTime()) ? parsed : new Date();
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export default function PurchaseFinancialDialog(props: {
  businessId: string;
  note: PurchaseNote;
  onClose: () => void;
  onCompleted: (note: PurchaseNote) => void;
}) {
  const [mode, setMode] = useState<'payable' | 'paid'>('payable');
  const [dueDate, setDueDate] = useState(() => datePlusDays(props.note.issueDate, 30));
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<PurchasePaymentMethod>('pix');
  const [bankAccountId, setBankAccountId] = useState('');
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void getDocs(query(collection(db, 'bankAccounts'), where('businessId', '==', props.businessId)))
      .then((snapshot) => {
        if (!active) return;
        const rows = snapshot.docs
          .map((document) => ({ ...document.data(), id: document.id } as BankAccount))
          .filter((account) => account.isActive !== false);
        setAccounts(rows);
        if (rows.length === 1) setBankAccountId(rows[0].id);
      })
      .catch((cause) => {
        console.error('[PurchaseFinancialDialog] bank accounts failed', cause);
        toast.error('Não foi possível carregar as contas financeiras.');
      })
      .finally(() => { if (active) setLoadingAccounts(false); });
    return () => { active = false; };
  }, [props.businessId]);

  const canSave = mode === 'payable' ? Boolean(dueDate) : Boolean(paymentDate && bankAccountId);
  const selectedAccount = useMemo(() => accounts.find((account) => account.id === bankAccountId), [accounts, bankAccountId]);

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const result = mode === 'payable'
        ? await linkPurchaseFinancial({
            businessId: props.businessId,
            noteId: props.note.id,
            mode,
            dueDate,
            paymentMethod,
          })
        : await linkPurchaseFinancial({
            businessId: props.businessId,
            noteId: props.note.id,
            mode,
            bankAccountId,
            paymentDate,
            paymentMethod,
          });
      toast.success(result.replayed
        ? 'O financeiro desta compra já estava vinculado; nenhum lançamento foi duplicado.'
        : mode === 'paid' ? 'Compra paga registrada e saldo da conta atualizado.' : 'Conta a pagar criada no Financeiro.');
      props.onCompleted(result.note as unknown as PurchaseNote);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Não foi possível organizar o financeiro da compra.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) props.onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
        <div className="flex items-start justify-between border-b border-gray-100 p-5 dark:border-gray-800">
          <div><p className="text-xs font-semibold uppercase tracking-wider text-red-500">Financeiro da compra</p><h2 className="mt-1 text-lg font-bold text-gray-900 dark:text-white">NF-e {props.note.numero}/{props.note.serie}</h2><p className="text-sm text-gray-500">{props.note.supplierName} · {formatCurrency(props.note.totalValue)}</p></div>
          <button type="button" onClick={props.onClose} disabled={saving} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode('payable')} className={cn('rounded-xl border p-3 text-left', mode === 'payable' ? 'border-red-400 bg-red-50 dark:bg-red-500/10' : 'border-gray-200 dark:border-gray-700')}><ReceiptText className="mb-2 h-5 w-5 text-red-500" /><p className="text-sm font-semibold text-gray-900 dark:text-white">Conta a pagar</p><p className="mt-1 text-xs text-gray-500">Registra o compromisso para pagar depois.</p></button>
            <button type="button" onClick={() => setMode('paid')} className={cn('rounded-xl border p-3 text-left', mode === 'paid' ? 'border-red-400 bg-red-50 dark:bg-red-500/10' : 'border-gray-200 dark:border-gray-700')}><Wallet className="mb-2 h-5 w-5 text-red-500" /><p className="text-sm font-semibold text-gray-900 dark:text-white">Já foi paga</p><p className="mt-1 text-xs text-gray-500">Registra a saída e atualiza o saldo agora.</p></button>
          </div>

          {mode === 'payable' ? <label className="block text-xs font-medium text-gray-500">Vencimento<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-800" /></label> : <>
            <label className="block text-xs font-medium text-gray-500">Data do pagamento<input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-800" /></label>
            <label className="block text-xs font-medium text-gray-500">Conta utilizada<select value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)} disabled={loadingAccounts} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-800"><option value="">Selecione a conta...</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · saldo {formatCurrency(account.balance)}</option>)}</select></label>
            {!loadingAccounts && accounts.length === 0 && <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">Cadastre uma conta ativa no Financeiro antes de registrar a compra como paga.</p>}
            {selectedAccount && <div className="flex items-center gap-2 rounded-xl bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-800/60 dark:text-gray-300"><Landmark className="h-4 w-4" />O saldo de {selectedAccount.name} será reduzido em {formatCurrency(props.note.totalValue)}.</div>}
          </>}

          <label className="block text-xs font-medium text-gray-500">Forma de pagamento<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PurchasePaymentMethod)} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-800">{PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 p-5 dark:border-gray-800"><button type="button" onClick={props.onClose} disabled={saving} className="rounded-xl px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">Cancelar</button><button type="button" onClick={save} disabled={!canSave || saving} className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">{saving ? 'Salvando...' : mode === 'paid' ? 'Registrar pagamento' : 'Criar conta a pagar'}</button></div>
      </div>
    </div>
  );
}
