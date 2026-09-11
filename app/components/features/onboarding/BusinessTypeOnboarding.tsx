'use client';

/**
 * app/components/features/onboarding/BusinessTypeOnboarding.tsx
 *
 * Passo único de onboarding logo após criar um negócio novo (ver
 * app/login/page.tsx) — pergunta o modo de uso (`UseCase`) e grava direto em
 * `settings.useCase`, mesma escrita que `ModoSistemaTab`
 * (app/components/features/settings/SettingsModule.tsx) já faz pós-signup.
 * Não reusa o componente da Settings porque lá há estado "ativo"/permissão
 * de edição que não fazem sentido aqui (o negócio acabou de nascer com o
 * DEFAULT_USE_CASE, ninguém "ativo" ainda, e quem está logado é sempre o
 * founder recém-criado).
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ShoppingBag, Calendar, Sparkles, Loader2, ArrowRight } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { cn } from '@/lib/utils';
import { USE_CASE_LABELS, USE_CASE_DESCRIPTIONS, type UseCase } from '@/lib/types';

const MODES: { id: UseCase; icon: React.ElementType; accent: string }[] = [
  { id: 'pedidos', icon: ShoppingBag, accent: 'from-orange-500 to-red-500' },
  { id: 'servicos', icon: Calendar, accent: 'from-blue-500 to-indigo-500' },
  { id: 'simples', icon: Sparkles, accent: 'from-emerald-500 to-teal-500' },
];

export default function BusinessTypeOnboarding({ businessId, onDone }: {
  businessId: string;
  onDone: () => void;
}) {
  const [saving, setSaving] = useState<UseCase | null>(null);

  const handleSelect = async (useCase: UseCase) => {
    setSaving(useCase);
    try {
      await updateDoc(doc(db, 'businesses', businessId), {
        'settings.useCase': useCase,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[Onboarding] failed to set useCase:', err);
      // Não bloqueia o onboarding por causa disso — o negócio já nasceu com
      // DEFAULT_USE_CASE ('servicos'), o usuário pode trocar depois em
      // Configurações → Modo do Sistema.
    } finally {
      setSaving(null);
      onDone();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-white dark:bg-[#0B0F19]"
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-2xl"
      >
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 font-display tracking-tight">
            Como é o seu negócio?
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1.5 text-sm">
            A interface se adapta ao modo escolhido — dá pra trocar depois em Configurações.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {MODES.map((mode, i) => {
            const Icon = mode.icon;
            const isSaving = saving === mode.id;
            return (
              <motion.button
                key={mode.id}
                type="button"
                onClick={() => handleSelect(mode.id)}
                disabled={!!saving}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                whileHover={!saving ? { y: -3 } : {}}
                whileTap={!saving ? { scale: 0.98 } : {}}
                className={cn(
                  'text-left p-5 rounded-2xl border-2 border-gray-200 dark:border-gray-700',
                  'bg-white dark:bg-gray-900 hover:border-red-300 dark:hover:border-red-500/40',
                  'transition-all',
                  saving && !isSaving && 'opacity-40 pointer-events-none',
                )}
              >
                <div className={cn(
                  'w-12 h-12 rounded-2xl flex items-center justify-center mb-3 shadow-sm bg-gradient-to-br text-white',
                  mode.accent,
                )}>
                  {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Icon className="w-6 h-6" />}
                </div>
                <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">{USE_CASE_LABELS[mode.id]}</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  {USE_CASE_DESCRIPTIONS[mode.id]}
                </p>
              </motion.button>
            );
          })}
        </div>

        <div className="text-center mt-7">
          <button
            type="button"
            onClick={onDone}
            disabled={!!saving}
            className="inline-flex items-center gap-1.5 text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 font-medium transition-colors disabled:opacity-50"
          >
            Pular por enquanto <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
