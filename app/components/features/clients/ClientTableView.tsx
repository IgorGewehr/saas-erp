'use client';

import React, { useMemo, useCallback } from 'react';
import { TableVirtuoso } from 'react-virtuoso';
import { ChevronUp, ChevronDown, ChevronsUpDown, Building2, Tag, Gift } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import type { Client, LeadStatus } from '@/lib/types';

// Tipos exportados pro parent gerenciar o sort state — antes vivia em useState
// interno aqui, mas isso fazia o TableView IGNORAR o dropdown de sort do
// parent (ClientsModule), causando "filtros não funcionam" no modo tabela.
// Agora é controlled — parent é fonte da verdade, header clicks notificam via onSort.
export type ClientSortField = 'name' | 'status' | 'totalSpent' | 'visitCount' | 'lastContact' | 'churnRisk' | 'createdAt';
export type ClientSortDir = 'asc' | 'desc';

const STATUS_CFG: Record<LeadStatus, { label: string; bg: string; text: string; dot: string }> = {
  novo:       { label: 'Novo',        bg: 'bg-blue-100   dark:bg-blue-500/20',   text: 'text-blue-700   dark:text-blue-300',   dot: 'bg-blue-400'   },
  contatado:  { label: 'Contatado',   bg: 'bg-purple-100 dark:bg-purple-500/20', text: 'text-purple-700 dark:text-purple-300', dot: 'bg-purple-400' },
  qualificado:{ label: 'Qualificado', bg: 'bg-amber-100  dark:bg-amber-500/20',  text: 'text-amber-700  dark:text-amber-300',  dot: 'bg-amber-400'  },
  proposta:   { label: 'Proposta',    bg: 'bg-pink-100   dark:bg-pink-500/20',   text: 'text-pink-700   dark:text-pink-300',   dot: 'bg-pink-400'   },
  negociacao: { label: 'Negociação',  bg: 'bg-orange-100 dark:bg-orange-500/20', text: 'text-orange-700 dark:text-orange-300', dot: 'bg-orange-400' },
  ganho:      { label: 'Cliente',     bg: 'bg-emerald-100 dark:bg-emerald-500/20',text:'text-emerald-700 dark:text-emerald-300',dot:'bg-emerald-400' },
  perdido:    { label: 'Inativo',     bg: 'bg-red-100    dark:bg-red-500/20',    text: 'text-red-700    dark:text-red-300',    dot: 'bg-red-400'    },
};

function relTime(iso?: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}min`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

const STATUS_ORDER: LeadStatus[] = ['novo', 'contatado', 'qualificado', 'proposta', 'negociacao', 'ganho', 'perdido'];

// ── Virtualização (react-virtuoso) ────────────────────────────────────────────
// Contexto compartilhado pros componentes estáveis de tabela (seleção + toggles).
interface ClientTableCtx {
  selectedClientId: string | null;
  onSelectClient: (c: Client) => void;
  showCheckboxes: boolean;
  selectedIds?: Set<string>;
  onToggleSelectId?: (id: string) => void;
}

// Componentes de identidade estável (fora do render) — TableVirtuoso remonta se
// a referência de `components` mudar. Preservam a semântica de tabela, o header
// sticky e o scroll horizontal do min-width.
const CtvScroller = React.forwardRef<HTMLDivElement, React.HTMLProps<HTMLDivElement>>(
  (props, ref) => <div {...props} ref={ref} className="overflow-auto pr-1" />,
);
CtvScroller.displayName = 'CtvScroller';
const CtvTable = (props: React.HTMLProps<HTMLTableElement>) => (
  <table {...props} className="w-full text-sm border-collapse min-w-[680px]" />
);
const CtvHead = React.forwardRef<HTMLTableSectionElement, React.HTMLProps<HTMLTableSectionElement>>(
  (props, ref) => <thead {...props} ref={ref} className="sticky top-0 z-10 bg-white dark:bg-gray-900" />,
);
CtvHead.displayName = 'CtvHead';
const CtvBody = React.forwardRef<HTMLTableSectionElement, React.HTMLProps<HTMLTableSectionElement>>(
  (props, ref) => <tbody {...props} ref={ref} />,
);
CtvBody.displayName = 'CtvBody';
const CtvRow = ({ item, context, ...props }: any) => {
  const ctx = context as ClientTableCtx;
  const isSelected = item.id === ctx.selectedClientId;
  return (
    <tr
      {...props}
      onClick={() => ctx.onSelectClient(item)}
      className={cn(
        'border-b border-gray-50 dark:border-white/[0.03] cursor-pointer transition-colors group',
        isSelected
          ? 'bg-red-50/60 dark:bg-red-500/[0.08]'
          : 'hover:bg-gray-50 dark:hover:bg-gray-800/40',
      )}
    />
  );
};
const CTV_COMPONENTS = { Scroller: CtvScroller, Table: CtvTable, TableHead: CtvHead, TableBody: CtvBody, TableRow: CtvRow };

// Célula memoizada: só re-renderiza quando a própria linha muda.
const ClientRowCells = React.memo(function ClientRowCells({
  client, showCheckboxes, selectedIds, onToggleSelectId,
}: {
  client: Client;
  showCheckboxes: boolean;
  selectedIds?: Set<string>;
  onToggleSelectId?: (id: string) => void;
}) {
  const st = STATUS_CFG[client.status] ?? STATUS_CFG.ganho;
  const churnRisk = client.scores?.churnRisk ?? 0;
  const contact = client.phone || client.whatsapp || client.email || '—';
  return (
    <>
      {showCheckboxes && (
        <td className="px-3 py-2.5 w-10" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selectedIds?.has(client.id) ?? false}
            onChange={() => onToggleSelectId?.(client.id)}
            className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-red-600 focus:ring-red-500 focus:ring-offset-0 cursor-pointer accent-red-600"
            aria-label={`Selecionar ${client.name}`}
          />
        </td>
      )}
      {/* Nome */}
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl shrink-0 overflow-hidden">
            {client.avatarUrl ? (
              <img src={client.avatarUrl} alt={client.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center text-white font-bold text-xs">
                {(client.name?.[0] || '?').toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="font-semibold text-gray-900 dark:text-white truncate text-[13px] leading-snug">
                {client.name}
              </p>
              {client.tipo === 'pj' && (
                <Building2 className="w-3 h-3 text-gray-400 shrink-0" />
              )}
            </div>
            {client.company && (
              <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate leading-snug">{client.company}</p>
            )}
          </div>
        </div>
      </td>

      {/* Status */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold', st.bg, st.text)}>
          <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', st.dot)} />
          {st.label}
        </span>
      </td>

      {/* Total gasto */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <div className="flex flex-col gap-0.5">
          <span className={cn(
            'text-[13px] font-semibold tabular-nums',
            (client.totalSpent ?? 0) > 0 ? 'text-gray-800 dark:text-gray-200' : 'text-gray-300 dark:text-gray-600'
          )}>
            {formatCurrency(client.totalSpent ?? 0)}
          </span>
          {(client.loyaltyPoints ?? 0) > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400">
              <Gift className="w-2.5 h-2.5" />
              {client.loyaltyPoints} pts
            </span>
          )}
        </div>
      </td>

      {/* Visitas */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className={cn(
          'text-[13px] tabular-nums font-medium',
          (client.visitCount ?? 0) > 0 ? 'text-gray-700 dark:text-gray-300' : 'text-gray-300 dark:text-gray-600'
        )}>
          {client.visitCount ?? 0}
        </span>
      </td>

      {/* Risco churn */}
      <td className="px-3 py-2.5">
        {churnRisk > 0 ? (
          <div className="flex items-center gap-2">
            <div className="w-14 h-1.5 bg-gray-100 dark:bg-white/[0.08] rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full', churnRisk >= 70 ? 'bg-red-500' : churnRisk >= 40 ? 'bg-amber-500' : 'bg-emerald-500')}
                style={{ width: `${churnRisk}%` }}
              />
            </div>
            <span className="text-[11px] font-bold tabular-nums text-gray-500 dark:text-gray-400 w-5 text-right">
              {churnRisk}
            </span>
          </div>
        ) : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>}
      </td>

      {/* Último contato */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className="text-[12px] text-gray-400 dark:text-gray-500 tabular-nums">
          {relTime(client.lastContactDate ?? client.updatedAt)}
        </span>
      </td>

      {/* Tags */}
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1 flex-wrap max-w-[140px]">
          {(client.tags ?? []).slice(0, 2).map(tag => (
            <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 whitespace-nowrap">
              <Tag className="w-2 h-2" />{tag}
            </span>
          ))}
          {(client.tags?.length ?? 0) > 2 && (
            <span className="text-[10px] text-gray-400">+{(client.tags?.length ?? 0) - 2}</span>
          )}
        </div>
      </td>

      {/* Contato */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className="text-[12px] text-gray-500 dark:text-gray-400 tabular-nums">{contact}</span>
      </td>
    </>
  );
});

export function ClientTableView({
  clients,
  selectedClientId,
  onSelectClient,
  selectedIds,
  onToggleSelectId,
  onToggleSelectAll,
  sortField,
  sortDir,
  onSort,
}: {
  clients: Client[];
  selectedClientId: string | null;
  onSelectClient: (c: Client) => void;
  // Multi-seleção pra bulk delete. Opcionais — quando ausentes, a coluna
  // de checkbox some (mantém compat com call-sites que não usam multi-select).
  selectedIds?: Set<string>;
  onToggleSelectId?: (id: string) => void;
  onToggleSelectAll?: () => void;
  // Sort controlado pelo parent — click no header chama onSort(field), parent
  // alterna direção. ClientsModule também controla via dropdown de "Ordenar".
  sortField: ClientSortField;
  sortDir: ClientSortDir;
  onSort: (field: ClientSortField) => void;
}) {
  // Sort local: replica a lógica do parent pra renderização. Mantido aqui
  // (não no parent) pra evitar duplicar a regra de createdAt sort entre os
  // dois lugares — o array `clients` chega já ordenado pelo parent, mas
  // re-sortamos defensivamente caso o parent tenha enviado em ordem
  // arbitrária ou queiramos diferenciar 'lastContact' (campo da tabela) de
  // 'createdAt' (campo do dropdown). Se field for 'createdAt', deixa
  // a ordem do parent passar reta — parent já sortou.
  const sorted = useMemo(() => {
    if (sortField === 'createdAt') return clients; // parent ja sortou
    return [...clients].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name')            cmp = a.name.localeCompare(b.name, 'pt-BR');
      else if (sortField === 'status')     cmp = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      else if (sortField === 'totalSpent') cmp = (a.totalSpent ?? 0) - (b.totalSpent ?? 0);
      else if (sortField === 'visitCount') cmp = (a.visitCount ?? 0) - (b.visitCount ?? 0);
      else if (sortField === 'churnRisk')  cmp = (a.scores?.churnRisk ?? 0) - (b.scores?.churnRisk ?? 0);
      else if (sortField === 'lastContact') {
        const da = a.lastContactDate ?? a.updatedAt ?? '';
        const db2 = b.lastContactDate ?? b.updatedAt ?? '';
        cmp = da.localeCompare(db2);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [clients, sortField, sortDir]);

  const SortIcon = ({ field }: { field: ClientSortField }) => {
    if (sortField !== field) return <ChevronsUpDown size={11} className="text-gray-300 dark:text-gray-600 shrink-0" />;
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="text-red-500 shrink-0" />
      : <ChevronDown size={11} className="text-red-500 shrink-0" />;
  };

  const COLS: { field: ClientSortField; label: string }[] = [
    { field: 'name',        label: 'Nome'           },
    { field: 'status',      label: 'Status'         },
    { field: 'totalSpent',  label: 'Total gasto'    },
    { field: 'visitCount',  label: 'Visitas'        },
    { field: 'churnRisk',   label: 'Risco churn'   },
    { field: 'lastContact', label: 'Último contato' },
  ];

  const showCheckboxes = !!onToggleSelectId;
  const allOnPageSelected = showCheckboxes && clients.length > 0 && clients.every(c => selectedIds?.has(c.id));
  const someSelected = showCheckboxes && clients.some(c => selectedIds?.has(c.id));

  const context = useMemo<ClientTableCtx>(
    () => ({ selectedClientId, onSelectClient, showCheckboxes, selectedIds, onToggleSelectId }),
    [selectedClientId, onSelectClient, showCheckboxes, selectedIds, onToggleSelectId],
  );

  const renderHeader = useCallback(() => (
    <tr className="border-b border-gray-100 dark:border-white/[0.06] bg-white dark:bg-gray-900">
      {showCheckboxes && (
        <th className="px-3 py-3 w-10">
          <input
            type="checkbox"
            checked={allOnPageSelected}
            ref={el => { if (el) el.indeterminate = !allOnPageSelected && someSelected; }}
            onChange={() => onToggleSelectAll?.()}
            className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-red-600 focus:ring-red-500 focus:ring-offset-0 cursor-pointer accent-red-600"
            aria-label="Selecionar todos"
          />
        </th>
      )}
      {COLS.map(({ field, label }) => (
        <th
          key={field}
          onClick={() => onSort(field)}
          className="px-3 py-3 text-left text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 dark:hover:text-gray-300 transition-colors whitespace-nowrap"
        >
          <div className="flex items-center gap-1">
            {label}
            <SortIcon field={field} />
          </div>
        </th>
      ))}
      {/* Tags — non-sortable */}
      <th className="px-3 py-3 text-left text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider whitespace-nowrap">
        Tags
      </th>
      {/* Contato — non-sortable */}
      <th className="px-3 py-3 text-left text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider whitespace-nowrap">
        Contato
      </th>
    </tr>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [showCheckboxes, allOnPageSelected, someSelected, onToggleSelectAll, onSort, sortField, sortDir]);

  const renderRow = useCallback((_i: number, client: Client) => (
    <ClientRowCells
      client={client}
      showCheckboxes={showCheckboxes}
      selectedIds={selectedIds}
      onToggleSelectId={onToggleSelectId}
    />
  ), [showCheckboxes, selectedIds, onToggleSelectId]);

  if (clients.length === 0) return null;

  return (
    <div className="flex-1 min-h-0">
      <TableVirtuoso
        data={sorted}
        context={context}
        style={{ height: '100%' }}
        components={CTV_COMPONENTS}
        computeItemKey={(_i, c) => c.id}
        increaseViewportBy={{ top: 300, bottom: 300 }}
        fixedHeaderContent={renderHeader}
        itemContent={renderRow}
      />
    </div>
  );
}
