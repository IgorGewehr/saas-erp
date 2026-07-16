'use client';

/**
 * CaixaAgoraCard — card direito de Fluxo de Caixa: status AO VIVO de cada
 * gaveta (aberta com troco/entrou/saiu/sangrias/esperado agora, ou fechada
 * com botão pra abrir). Não é um drill de fato (não navega overview⇄detalhe)
 * — vive na mesma moldura `DualDrillPair` só pra manter a gramática visual de
 * 2 cards lado a lado; as mutações (abrir/sangria/fechar) ficam nos dialogs
 * dedicados (`AbrirCaixaDialog`/`SangriaDialog`/`FecharCaixaDialog`), abertos
 * via callback — mesmo padrão de `BaixaDialog`/`LancarSheet`.
 */

import { DrillCardHeader } from '../../components/DrillPair';
import type { FluxoCaixaOverview, CashSessionRow } from '../../read-models/fluxo-caixa-especie';
import { formatOpenDuration } from '../../read-models/fluxo-caixa-especie';
import type { BankAccount } from '@/lib/types';
import { formatCurrency } from '@/lib/utils/format';

interface CaixaAgoraCardProps {
  overview: FluxoCaixaOverview;
  onAbrir: (account: BankAccount) => void;
  onSangria: (session: CashSessionRow) => void;
  onFechar: (session: CashSessionRow) => void;
}

export function CaixaAgoraCard({ overview, onAbrir, onSangria, onFechar }: CaixaAgoraCardProps) {
  const openByAccount = new Map(overview.openSessions.map(s => [s.accountId, s]));

  return (
    <>
      <DrillCardHeader
        title="Caixa agora"
        hint={`${overview.caixaAccounts.length} gaveta${overview.caixaAccounts.length !== 1 ? 's' : ''}`}
      />
      <div className="px-3.5 pb-3.5 flex flex-col gap-2.5">
        {overview.caixaAccounts.length === 0 ? (
          <div className="px-1 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
            Nenhuma gaveta (conta tipo espécie) cadastrada em Bancário ainda.
          </div>
        ) : (
          overview.caixaAccounts.map(account => {
            const session = openByAccount.get(account.id);
            return session ? (
              <OpenAccountStatus key={account.id} session={session} onSangria={() => onSangria(session)} onFechar={() => onFechar(session)} />
            ) : (
              <ClosedAccountStatus key={account.id} account={account} onAbrir={() => onAbrir(account)} />
            );
          })
        )}
      </div>
    </>
  );
}

function OpenAccountStatus({ session, onSangria, onFechar }: { session: CashSessionRow; onSangria: () => void; onFechar: () => void }) {
  return (
    <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{session.accountLabel}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold text-[hsl(var(--fin-pos))] bg-[hsl(var(--fin-pos-soft))]">
          <span className="w-1.5 h-1.5 rounded-full bg-current" />
          Aberto há {formatOpenDuration(session.openedAt)}
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
        <span className="text-gray-500 dark:text-gray-400">Troco inicial</span>
        <span className="fin-num text-right text-gray-700 dark:text-gray-300">{formatCurrency(session.openingAmount)}</span>
        <span className="text-gray-500 dark:text-gray-400">Entrou</span>
        <span className="fin-num text-right text-[hsl(var(--fin-pos))]">+{formatCurrency(session.entrouSession)}</span>
        <span className="text-gray-500 dark:text-gray-400">Saiu</span>
        <span className="fin-num text-right text-[hsl(var(--fin-crit))]">−{formatCurrency(session.saiuSession)}</span>
        {session.sangriaTotal > 0 && (
          <>
            <span className="text-gray-500 dark:text-gray-400">Sangrias</span>
            <span className="fin-num text-right text-[hsl(var(--fin-crit))]">−{formatCurrency(session.sangriaTotal)}</span>
          </>
        )}
      </div>
      <div className="mt-2.5 flex items-center justify-between rounded-lg bg-white dark:bg-gray-900 px-2.5 py-2 border border-gray-200 dark:border-gray-800">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Saldo esperado agora</span>
        <span className="fin-num text-sm font-bold text-gray-900 dark:text-gray-50">{formatCurrency(session.expectedNow)}</span>
      </div>
      <div className="mt-2.5 flex gap-2">
        <button
          onClick={onSangria}
          className="flex-1 px-2.5 py-2 rounded-[9px] text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-900 transition-colors"
        >
          + Sangria
        </button>
        <button
          onClick={onFechar}
          className="flex-1 px-2.5 py-2 rounded-[9px] text-xs font-semibold bg-[hsl(var(--fin-primary))] text-white hover:brightness-[1.06] transition-[filter]"
        >
          Fechar caixa
        </button>
      </div>
    </div>
  );
}

function ClosedAccountStatus({ account, onAbrir }: { account: BankAccount; onAbrir: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 px-3.5 py-3 flex items-center justify-between gap-2.5">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-gray-900 dark:text-gray-100 truncate">{account.name}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Nenhum caixa aberto · saldo informado {formatCurrency(account.balance)}</div>
      </div>
      <button
        onClick={onAbrir}
        className="flex-none px-3 py-1.5 rounded-[9px] text-xs font-semibold bg-[hsl(var(--fin-primary))] text-white hover:brightness-[1.06] transition-[filter]"
      >
        Abrir caixa
      </button>
    </div>
  );
}
