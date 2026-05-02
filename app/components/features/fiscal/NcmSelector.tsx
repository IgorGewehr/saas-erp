'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, X, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NCM_TABLE, NcmEntry, isCustomNcm, normalizeNcmSearch } from '@/lib/fiscal/ncm-table';

export interface NcmSelectorProps {
  value: string;
  onChange: (code: string) => void;
  onClear?: () => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

function groupByCategory(entries: NcmEntry[]): Record<string, NcmEntry[]> {
  const groups: Record<string, NcmEntry[]> = {};
  for (const entry of entries) {
    if (!groups[entry.category]) groups[entry.category] = [];
    groups[entry.category].push(entry);
  }
  return groups;
}

const NCM_CUSTOM_RE = /^\d{8}$/;

export default function NcmSelector({
  value,
  onChange,
  onClear,
  placeholder = 'NCM (buscar ou digitar 8 dígitos)',
  className,
  disabled,
}: NcmSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Resolve current value into either a known entry or a custom-code placeholder
  const selectedEntry = useMemo<NcmEntry | null>(() => {
    if (!value) return null;
    const normalized = value.replace(/\D/g, '');
    const found = NCM_TABLE.find(e => e.code.replace(/\D/g, '') === normalized);
    if (found) return found;
    if (NCM_CUSTOM_RE.test(normalized)) {
      return { code: normalized, description: '(NCM não cadastrado)', category: 'Personalizado' };
    }
    return null;
  }, [value]);

  // If the search text is a fresh 8-digit code, surface a "create custom" option
  const customNcmOption = useMemo(() => {
    const digits = search.replace(/\D/g, '');
    if (!NCM_CUSTOM_RE.test(digits)) return null;
    if (NCM_TABLE.some(e => e.code.replace(/\D/g, '') === digits)) return null;
    return digits;
  }, [search]);

  const filtered = useMemo(() => {
    if (!search.trim()) return NCM_TABLE;
    const term = normalizeNcmSearch(search);
    return NCM_TABLE.filter(e =>
      normalizeNcmSearch(e.code).includes(term) ||
      normalizeNcmSearch(e.description).includes(term) ||
      normalizeNcmSearch(e.category).includes(term),
    );
  }, [search]);

  const grouped = useMemo(() => groupByCategory(filtered), [filtered]);
  const categories = useMemo(() => Object.keys(grouped).sort(), [grouped]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setSearch(''); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const handleOpen = () => {
    if (disabled) return;
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleSelect = (entry: NcmEntry) => {
    onChange(entry.code.replace(/\D/g, ''));
    setOpen(false);
    setSearch('');
  };

  const handleSelectCustom = (code: string) => {
    onChange(code);
    setOpen(false);
    setSearch('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onClear) onClear();
    else onChange('');
    setOpen(false);
    setSearch('');
  };

  const valueIsCustom = value ? isCustomNcm(value) : false;

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      {/* Trigger */}
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className={cn(
          'w-full flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-sm text-left',
          'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700',
          'text-gray-900 dark:text-gray-100',
          'hover:border-red-300 dark:hover:border-red-500/40',
          'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-300 dark:focus:border-red-500/40',
          'transition-all duration-200',
          disabled && 'opacity-50 cursor-not-allowed',
          open && 'ring-2 ring-red-500/20 border-red-300 dark:border-red-500/40',
        )}
      >
        <span className={cn('flex-1 truncate', !selectedEntry && 'text-gray-400 dark:text-gray-500')}>
          {selectedEntry ? (
            <>
              <span className="font-mono">{selectedEntry.code}</span>
              {' — '}
              <span className={valueIsCustom ? 'italic text-amber-600 dark:text-amber-400' : ''}>
                {selectedEntry.description}
              </span>
            </>
          ) : (
            placeholder
          )}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {value && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleClear}
              onKeyDown={(e) => e.key === 'Enter' && handleClear(e as unknown as React.MouseEvent)}
              className="h-5 w-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className={cn('h-4 w-4 text-gray-400 transition-transform', open && 'rotate-180')} />
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute z-50 mt-1 left-0 w-full min-w-[420px] rounded-xl border bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 shadow-lg flex flex-col"
          style={{ maxHeight: 360 }}
        >
          {/* Search */}
          <div className="p-2 border-b border-gray-100 dark:border-gray-800 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Código, descrição ou 8 dígitos…"
                className="w-full h-8 pl-8 pr-3 rounded-lg text-sm border bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-300 dark:focus:border-red-500/40"
              />
            </div>
          </div>

          {/* Results */}
          <div className="overflow-y-auto flex-1">
            {customNcmOption && (
              <button
                type="button"
                onClick={() => handleSelectCustom(customNcmOption)}
                className="w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors border-b border-gray-100 dark:border-gray-800 bg-amber-50 dark:bg-amber-900/10 hover:bg-amber-100 dark:hover:bg-amber-900/20"
              >
                <Plus className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="font-mono text-xs font-medium text-gray-900 dark:text-gray-100">{customNcmOption}</span>
                <span className="text-sm italic text-amber-600 dark:text-amber-400">(NCM não cadastrado)</span>
              </button>
            )}

            {categories.length === 0 && !customNcmOption ? (
              <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                Nenhum NCM encontrado. Digite 8 dígitos para criar um customizado.
              </div>
            ) : (
              categories.map((category) => (
                <div key={category}>
                  <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-800 sticky top-0">
                    {category}
                  </div>
                  {grouped[category].map((entry) => {
                    const isSelected = !!value && entry.code.replace(/\D/g, '') === value.replace(/\D/g, '');
                    return (
                      <button
                        key={entry.code}
                        type="button"
                        onClick={() => handleSelect(entry)}
                        className={cn(
                          'w-full text-left px-3 py-2 flex items-start gap-2 transition-colors border-b border-gray-100 dark:border-gray-800/60 last:border-b-0',
                          isSelected
                            ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/40',
                        )}
                      >
                        <span className={cn(
                          'shrink-0 font-mono text-xs font-medium mt-0.5',
                          isSelected ? 'text-red-700 dark:text-red-300' : 'text-gray-500 dark:text-gray-400',
                        )}>
                          {entry.code}
                        </span>
                        <span className="text-sm text-gray-800 dark:text-gray-200 leading-tight">
                          {entry.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer hint */}
          <div className="px-3 py-1.5 border-t border-gray-100 dark:border-gray-800 shrink-0">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {filtered.length} NCM{filtered.length !== 1 ? 's' : ''} encontrado{filtered.length !== 1 ? 's' : ''}
              {customNcmOption && ' · Digite 8 dígitos para usar NCM customizado'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
