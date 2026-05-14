'use client';

/**
 * CampaignTypeChooserDialog — modal de seleção entre "Campanha pontual"
 * (disparo único) e "Campanha recorrente" (aniversários, datas festivas).
 *
 * Substitui os 2 botões separados ("Nova de aniversariante" + "Nova Campanha")
 * por um único CTA "Nova Campanha" que abre este chooser. UX mais limpa, e
 * deixa claro que existem 2 modos sem ocupar dois slots de botão.
 *
 * Cores intencionalmente diferentes pra reforçar a identidade visual já
 * usada nos cards da lista:
 *   - Pontual: azul (disparo "frio", uma vez só)
 *   - Recorrente: amber (warmer, repete em ciclo)
 *
 * Nota: hoje "Recorrente" cobre só aniversários (campo birthDate do contato).
 * Datas festivas fixas no calendário (Natal, Dia das Mães) precisam de
 * backend novo — quando vier, este chooser já é o ponto de entrada certo.
 */

import { Megaphone, Send, Repeat } from 'lucide-react';
import { ModernDialog } from '@/app/components/ui/dialog';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelectPontual: () => void;
  onSelectRecorrente: () => void;
}

export default function CampaignTypeChooserDialog({
  open,
  onClose,
  onSelectPontual,
  onSelectRecorrente,
}: Props) {
  return (
    <ModernDialog
      open={open}
      onClose={onClose}
      icon={Megaphone}
      title="Nova campanha"
      subtitle="Escolha o tipo de disparo"
      maxWidth="sm"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Pontual — azul, ícone Send (disparo único) */}
        <button
          type="button"
          onClick={onSelectPontual}
          className="group flex flex-col items-start gap-2.5 p-4 rounded-2xl border-2 border-blue-200 dark:border-blue-500/30 bg-blue-50/40 dark:bg-blue-500/[0.05] hover:border-blue-400 dark:hover:border-blue-400/60 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-all text-left"
        >
          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-500/15 flex items-center justify-center">
            <Send className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Pontual</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            Disparo único pra uma lista de contatos — CSV, segmento ou lista colada.
          </p>
        </button>
        {/* Recorrente — amber, ícone Repeat (repete em ciclo) */}
        <button
          type="button"
          onClick={onSelectRecorrente}
          className="group flex flex-col items-start gap-2.5 p-4 rounded-2xl border-2 border-amber-300 dark:border-amber-500/30 bg-amber-50/40 dark:bg-amber-500/[0.05] hover:border-amber-400 dark:hover:border-amber-400/60 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-all text-left"
        >
          <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-500/15 flex items-center justify-center">
            <Repeat className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Recorrente</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            Aniversários e datas festivas — dispara automaticamente todos os anos pros contatos certos.
          </p>
        </button>
      </div>
    </ModernDialog>
  );
}
