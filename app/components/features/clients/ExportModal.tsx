'use client';

/**
 * Modal de exportação CSV de clientes.
 *
 * Extraído do ClientsModule durante a Fase 1 da modularização.
 * Auto-contido — recebe `allClients` + `filteredClients` e gera download via
 * blob no client-side. Sem dependência de Firestore.
 *
 * Mantém suporte a:
 *   - Escolha entre filtrados x todos
 *   - Toggle por coluna individual ou grupo inteiro
 *   - Preset de colunas default (DEFAULT_EXPORT_COLS)
 *   - UTF-8 BOM no CSV pra Excel BR abrir sem mojibake
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { FileDown, X, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/utils/format';
import type { Client } from '@/lib/types';
import { STATUS_CONFIG, SOURCE_LABELS, TIPO_LABELS } from './shared/constants';

interface ExportColumn {
  id: string;
  label: string;
  group: string;
  get: (c: Client) => string;
}

const EXPORT_COLUMNS: ExportColumn[] = [
  { id: 'name',          label: 'Nome',           group: 'Básico',     get: c => c.name },
  { id: 'email',         label: 'E-mail',         group: 'Básico',     get: c => c.email || '' },
  { id: 'phone',         label: 'Telefone',       group: 'Básico',     get: c => c.phone || '' },
  { id: 'whatsapp',      label: 'WhatsApp',       group: 'Básico',     get: c => c.whatsapp || '' },
  { id: 'company',       label: 'Empresa',        group: 'Básico',     get: c => c.company || '' },
  { id: 'tipo',          label: 'Tipo',           group: 'Básico',     get: c => TIPO_LABELS[c.tipo || 'pf'] },
  { id: 'cpfCnpj',       label: 'CPF/CNPJ',       group: 'Básico',     get: c => c.cpfCnpj || '' },
  { id: 'birthDate',     label: 'Aniversário',    group: 'Básico',     get: c => c.birthDate ? formatDate(c.birthDate) : '' },
  { id: 'status',        label: 'Status',         group: 'Básico',     get: c => STATUS_CONFIG[c.status]?.label || c.status },
  { id: 'source',        label: 'Origem',         group: 'Básico',     get: c => SOURCE_LABELS[c.source] || c.source },
  { id: 'tags',          label: 'Tags',           group: 'Básico',     get: c => (c.tags || []).join(', ') },
  { id: 'totalSpent',    label: 'Total gasto',    group: 'Financeiro', get: c => String(c.totalSpent || 0) },
  { id: 'visitCount',    label: 'Compras',        group: 'Financeiro', get: c => String(c.visitCount || 0) },
  { id: 'lastVisit',     label: 'Última compra',  group: 'Financeiro', get: c => formatDate(c.lastVisit || '') },
  { id: 'loyaltyPoints', label: 'Pts fidelidade', group: 'Financeiro', get: c => String(c.loyaltyPoints || 0) },
  { id: 'cep',           label: 'CEP',            group: 'Endereço',   get: c => c.endereco?.cep || '' },
  { id: 'logradouro',    label: 'Logradouro',     group: 'Endereço',   get: c => c.endereco?.logradouro || '' },
  { id: 'numero',        label: 'Número',         group: 'Endereço',   get: c => c.endereco?.numero || '' },
  { id: 'bairro',        label: 'Bairro',         group: 'Endereço',   get: c => c.endereco?.bairro || '' },
  { id: 'municipio',     label: 'Município',      group: 'Endereço',   get: c => c.endereco?.municipio || '' },
  { id: 'uf',            label: 'UF',             group: 'Endereço',   get: c => c.endereco?.uf || '' },
  { id: 'notes',         label: 'Observações',    group: 'Avançado',   get: c => c.notes || '' },
  { id: 'createdAt',     label: 'Cadastrado em',  group: 'Avançado',   get: c => formatDate(c.createdAt) },
];

const DEFAULT_EXPORT_COLS = new Set(['name', 'email', 'phone', 'whatsapp', 'company', 'tipo', 'cpfCnpj', 'status', 'source', 'tags', 'totalSpent', 'visitCount']);

const EXPORT_GROUPS = ['Básico', 'Financeiro', 'Endereço', 'Avançado'];

function downloadCSV(clients: Client[], selectedCols: Set<string>, filename: string) {
  const cols = EXPORT_COLUMNS.filter(c => selectedCols.has(c.id));
  if (cols.length === 0 || clients.length === 0) return;

  const escape = (v: string) => {
    const s = String(v ?? '').replace(/"/g, '""');
    return s.includes(';') || s.includes('\n') || s.includes('"') ? `"${s}"` : s;
  };

  const lines = [
    cols.map(c => escape(c.label)).join(';'),
    ...clients.map(client => cols.map(col => escape(col.get(client))).join(';')),
  ];

  // UTF-8 BOM so Excel BR opens with correct encoding
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportModal({
  allClients,
  filteredClients,
  onClose,
}: {
  allClients: Client[];
  filteredClients: Client[];
  onClose: () => void;
}) {
  const [source, setSource] = useState<'filtered' | 'all'>('filtered');
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set(DEFAULT_EXPORT_COLS));

  const toggleCol = (id: string) =>
    setSelectedCols(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleGroup = (group: string) => {
    const groupIds = EXPORT_COLUMNS.filter(c => c.group === group).map(c => c.id);
    const allOn = groupIds.every(id => selectedCols.has(id));
    setSelectedCols(prev => {
      const next = new Set(prev);
      groupIds.forEach(id => allOn ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const clients = source === 'filtered' ? filteredClients : allClients;

  const handleExport = () => {
    const date = new Date().toISOString().slice(0, 10);
    downloadCSV(clients, selectedCols, `clientes_${date}.csv`);
    onClose();
  };

  // Portal pra escapar containing block do wrapper de tabs (will-change-transform).
  if (typeof document === 'undefined') return null;
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
              <FileDown className="w-4 h-4 text-emerald-500" />
            </div>
            <h2 className="font-semibold text-gray-900 dark:text-white text-sm">Exportar clientes</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Source */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Quais clientes</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: 'filtered', label: 'Filtrados atualmente', count: filteredClients.length },
                { key: 'all',      label: 'Todos os clientes',    count: allClients.length },
              ] as const).map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setSource(opt.key)}
                  className={cn(
                    'flex flex-col items-start px-4 py-3 rounded-xl border text-left transition-all',
                    source === opt.key
                      ? 'border-red-500 bg-red-50/50 dark:bg-red-500/5'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  )}
                >
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{opt.label}</span>
                  <span className={cn('text-lg font-bold mt-0.5', source === opt.key ? 'text-red-600 dark:text-red-400' : 'text-gray-400')}>
                    {opt.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Columns */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              Colunas — {selectedCols.size} selecionadas
            </p>
            <div className="space-y-3">
              {EXPORT_GROUPS.map(group => {
                const groupCols = EXPORT_COLUMNS.filter(c => c.group === group);
                const allOn = groupCols.every(c => selectedCols.has(c.id));
                return (
                  <div key={group} className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
                    <button
                      onClick={() => toggleGroup(group)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800/60 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      {group}
                      <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded', allOn ? 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400' : 'bg-gray-200 dark:bg-gray-700 text-gray-500')}>
                        {allOn ? 'Desmarcar todos' : 'Marcar todos'}
                      </span>
                    </button>
                    <div className="px-3 py-2 flex flex-wrap gap-2">
                      {groupCols.map(col => (
                        <button
                          key={col.id}
                          onClick={() => toggleCol(col.id)}
                          className={cn(
                            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border',
                            selectedCols.has(col.id)
                              ? 'bg-red-600 text-white border-red-600'
                              : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-gray-300'
                          )}
                        >
                          <CheckCircle2 className={cn('w-3 h-3', selectedCols.has(col.id) ? 'opacity-100' : 'opacity-0')} />
                          {col.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Formato CSV • abre no Excel
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Cancelar
            </button>
            <button
              onClick={handleExport}
              disabled={selectedCols.size === 0 || clients.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors disabled:opacity-40"
            >
              <FileDown className="w-4 h-4" />
              Baixar {clients.length} clientes
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
