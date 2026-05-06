'use client';

/**
 * Modal de ajuste manual de pontos do programa de fidelidade.
 *
 * Disparado pelo botão "Ajustar pontos" do detalhe do cliente. Faz batch
 * write em Firestore: atualiza `clients/{id}.loyaltyPoints` e cria entrada
 * em `loyaltyHistory` no mesmo commit pra garantir consistência (ledger
 * append-only — operador não consegue ajustar pontos sem deixar rastro).
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Gift, X, Plus as PlusIcon, Minus } from 'lucide-react';
import { writeBatch, doc, collection } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import { db } from '@/lib/config/firebase';
import type { Client, LoyaltyHistoryEntry } from '@/lib/types';

export function PointsAdjustModal({
  client,
  businessId,
  user,
  onClose,
  onDone,
}: {
  client: Client;
  businessId: string;
  user: { uid: string; name: string };
  onClose: () => void;
  onDone: (newBalance: number) => void;
}) {
  const [mode, setMode] = useState<'add' | 'subtract'>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const currentPts = client.loyaltyPoints ?? 0;
  const delta = Number(amount) || 0;
  const newBalance = mode === 'add' ? currentPts + delta : Math.max(0, currentPts - delta);

  const handleSave = async () => {
    if (!delta || !reason.trim()) return;
    setSaving(true);
    const now = new Date().toISOString();
    const signedAmount = mode === 'add' ? delta : -delta;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'clients', client.id), { loyaltyPoints: newBalance, updatedAt: now });
      const histRef = doc(collection(db, 'loyaltyHistory'));
      const entry: Omit<LoyaltyHistoryEntry, 'id'> = {
        clientId: client.id,
        businessId,
        type: 'manual',
        amount: signedAmount,
        balance: newBalance,
        reason: reason.trim(),
        createdBy: user.uid,
        createdByName: user.name,
        createdAt: now,
      };
      batch.set(histRef, entry);
      await batch.commit();
      onDone(newBalance);
      onClose();
    } catch (err) {
      console.error('Points adjust error:', err);
    } finally {
      setSaving(false);
    }
  };

  // Portal pra escapar containing block do wrapper de tabs (will-change-transform).
  if (typeof document === 'undefined') return null;
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50 overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <Gift className="w-4 h-4 text-amber-500" />
            <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Ajustar pontos</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Current balance */}
          <div className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-500/10 rounded-xl">
            <p className="text-xs text-amber-700 dark:text-amber-300">Saldo atual de {client.name.split(' ')[0]}</p>
            <p className="text-xl font-bold text-amber-700 dark:text-amber-300">{currentPts} pts</p>
          </div>

          {/* Add / Subtract toggle */}
          <div className="flex gap-2">
            {(['add', 'subtract'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn('flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold transition-all border',
                  mode === m
                    ? m === 'add' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-red-500 text-white border-red-500'
                    : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                )}
              >
                {m === 'add' ? <PlusIcon className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                {m === 'add' ? 'Adicionar' : 'Subtrair'}
              </button>
            ))}
          </div>

          <div>
            <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider block mb-1">Quantidade de pontos</label>
            <input
              type="number"
              min="1"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-lg font-bold text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 text-center"
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider block mb-1">Motivo *</label>
            <input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="ex: Aniversário do cliente, resgate de brinde..."
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
            />
          </div>

          {delta > 0 && (
            <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800/60 rounded-xl text-xs">
              <span className="text-gray-500">Novo saldo:</span>
              <span className={cn('font-bold', mode === 'add' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                {newBalance} pts
              </span>
            </div>
          )}
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !delta || !reason.trim()}
            className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-40"
          >
            {saving ? 'Salvando...' : 'Confirmar'}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
