'use client';

import { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Tabela LC 116/2003 com códigos municipais de São Paulo (IN SF/SUREM 08/2011)
// spCode: código municipal SP — preenchido automaticamente quando disponível
// ---------------------------------------------------------------------------

export interface NfseServicoEntry {
  lc116: string;   // ex: "01.07"
  descricao: string;
  spCode?: string; // código municipal SP
}

export const NFSE_SERVICOS: NfseServicoEntry[] = [
  // ── Grupo 01 — Informática ────────────────────────────────────────────
  { lc116: '01.01', descricao: 'Análise e desenvolvimento de sistemas',                              spCode: '2660' },
  { lc116: '01.02', descricao: 'Programação',                                                        spCode: '2668' },
  { lc116: '01.03', descricao: 'Processamento, armazenamento ou hospedagem de dados (cloud)',         spCode: '2684' },
  { lc116: '01.04', descricao: 'Elaboração de programas de computadores (software)',                  spCode: '2692' },
  { lc116: '01.05', descricao: 'Licenciamento ou cessão de direito de uso de programas',             spCode: '2800' },
  { lc116: '01.06', descricao: 'Assessoria e consultoria em informática',                            spCode: '2881' },
  { lc116: '01.07', descricao: 'Suporte técnico em informática, instalação e manutenção',            spCode: '2919' },
  { lc116: '01.08', descricao: 'Planejamento, confecção e atualização de páginas eletrônicas',       spCode: '2935' },
  { lc116: '01.09', descricao: 'Disponibilização de conteúdos de áudio, vídeo, imagem e texto',     spCode: '2684' },

  // ── Grupo 02 — Pesquisa e desenvolvimento ────────────────────────────
  { lc116: '02.01', descricao: 'Pesquisa e desenvolvimento de qualquer natureza',                    spCode: '6629' },

  // ── Grupo 04 — Saúde e assistência médica ────────────────────────────
  { lc116: '04.01', descricao: 'Medicina e biomedicina',                                             spCode: '4030' },
  { lc116: '04.02', descricao: 'Análises clínicas, patologia, eletricidade médica',                 spCode: '4111' },
  { lc116: '04.03', descricao: 'Hospitais, clínicas, laboratórios, sanatórios',                     spCode: '4030' },
  { lc116: '04.06', descricao: 'Enfermagem, inclusive serviços auxiliares',                          spCode: '4170' },
  { lc116: '04.07', descricao: 'Serviços farmacêuticos',                                            spCode: '4669' },
  { lc116: '04.08', descricao: 'Terapia ocupacional, fisioterapia e fonoaudiologia',                spCode: '4200' },
  { lc116: '04.12', descricao: 'Odontologia',                                                       spCode: '4294' },
  { lc116: '04.15', descricao: 'Psicanálise',                                                       spCode: '4464' },
  { lc116: '04.16', descricao: 'Psicologia',                                                        spCode: '4472' },

  // ── Grupo 05 — Medicina veterinária ──────────────────────────────────
  { lc116: '05.01', descricao: 'Medicina veterinária e zootecnia',                                  spCode: '5011' },

  // ── Grupo 06 — Educação ───────────────────────────────────────────────
  { lc116: '06.01', descricao: 'Ensino regular pré-escolar, fundamental, médio e superior',         spCode: '6130' },
  { lc116: '06.02', descricao: 'Instrução, treinamento e orientação pedagógica',                    spCode: '6181' },
  { lc116: '06.03', descricao: 'Elaboração e ministração de cursos e treinamentos',                 spCode: '6181' },

  // ── Grupo 07 — Engenharia e construção civil ──────────────────────────
  { lc116: '07.01', descricao: 'Engenharia, agronomia, arquitetura e urbanismo',                    spCode: '1520' },
  { lc116: '07.02', descricao: 'Execução de obras de construção civil (empreitada)',                spCode: '1023' },
  { lc116: '07.03', descricao: 'Elaboração de planos diretores e projetos de engenharia',           spCode: '1694' },
  { lc116: '07.04', descricao: 'Demolição',                                                         spCode: '1872' },
  { lc116: '07.05', descricao: 'Reparação, conservação e reforma de edifícios',                     spCode: '1023' },
  { lc116: '07.09', descricao: 'Varrição, coleta, remoção e tratamento de lixo',                   spCode: '7501' },
  { lc116: '07.10', descricao: 'Limpeza e conservação de vias e logradouros',                       spCode: '7501' },
  { lc116: '07.11', descricao: 'Decoração e jardinagem',                                            spCode: '1686' },
  { lc116: '07.17', descricao: 'Acompanhamento e fiscalização de obras de engenharia',              spCode: '1805' },

  // ── Grupo 10 — Intermediação e representação ─────────────────────────
  { lc116: '10.01', descricao: 'Agenciamento, corretagem ou intermediação de câmbio',               spCode: '8680' },
  { lc116: '10.02', descricao: 'Agenciamento, corretagem ou intermediação de seguros',              spCode: '8753' },
  { lc116: '10.05', descricao: 'Agenciamento de contratos de arrendamento mercantil (leasing)',     spCode: '8842' },

  // ── Grupo 14 — Manutenção e reparação ────────────────────────────────
  { lc116: '14.01', descricao: 'Lubrificação, limpeza e revisão de máquinas e veículos',           spCode: '2285' },
  { lc116: '14.02', descricao: 'Assistência técnica',                                               spCode: '2285' },
  { lc116: '14.05', descricao: 'Restauração, recondicionamento e pintura de veículos',              spCode: '2315' },
  { lc116: '14.06', descricao: 'Instalação e montagem de aparelhos, máquinas e equipamentos',      spCode: '2323' },

  // ── Grupo 17 — Assessoria, consultoria e serviços técnicos ───────────
  { lc116: '17.01', descricao: 'Assessoria ou consultoria de qualquer natureza',                    spCode: '3115' },
  { lc116: '17.02', descricao: 'Datilografia, digitação, estenografia, secretaria',                 spCode: '3093' },
  { lc116: '17.04', descricao: 'Recrutamento, agenciamento e seleção de mão de obra',               spCode: '3212' },
  { lc116: '17.06', descricao: 'Propaganda e publicidade, inclusive promoção de vendas',            spCode: '3255' },
  { lc116: '17.08', descricao: 'Perícias, laudos e análises técnicas',                              spCode: '3301' },
  { lc116: '17.10', descricao: 'Organização de festas e recepções',                                 spCode: '3395' },
  { lc116: '17.13', descricao: 'Advocacia',                                                         spCode: '3220' },
  { lc116: '17.14', descricao: 'Arbitragem de qualquer espécie',                                    spCode: '3263' },
  { lc116: '17.15', descricao: 'Auditoria',                                                         spCode: '3107' },
  { lc116: '17.17', descricao: 'Atuária e cálculos técnicos de qualquer natureza',                 spCode: '3085' },
  { lc116: '17.18', descricao: 'Contabilidade, inclusive serviços técnicos e auxiliares',           spCode: '3476' },
  { lc116: '17.19', descricao: 'Consultoria e assessoria econômica ou financeira',                  spCode: '3093' },
  { lc116: '17.20', descricao: 'Estatística',                                                       spCode: '3107' },
  { lc116: '17.21', descricao: 'Cobrança em geral',                                                 spCode: '3484' },
  { lc116: '17.23', descricao: 'Apresentação de palestras, conferências, seminários',               spCode: '3492' },

  // ── Grupo 21 — Registros públicos ────────────────────────────────────
  { lc116: '21.01', descricao: 'Serviços de registros públicos, cartorários e notariais',           spCode: '9270' },

  // ── Grupo 25 — Serviços funerários ───────────────────────────────────
  { lc116: '25.01', descricao: 'Funerais, fornecimento de caixão e cremação',                       spCode: '9377' },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface NfseServicoComboboxProps {
  lc116Value: string;
  spCodeValue: string;
  onChange: (lc116: string, spCode: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NfseServicoCombobox({ lc116Value, spCodeValue, onChange }: NfseServicoComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedEntry = NFSE_SERVICOS.find((o) => o.lc116 === lc116Value);
  const displayValue = selectedEntry ? `${selectedEntry.lc116} — ${selectedEntry.descricao}` : lc116Value;

  function closeDropdown() {
    setOpen(false);
    setSearch('');
  }

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) closeDropdown();
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') { closeDropdown(); inputRef.current?.blur(); }
    }
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open]);

  const filtered = search.trim()
    ? NFSE_SERVICOS.filter(
        (o) =>
          o.lc116.includes(search) ||
          o.descricao.toLowerCase().includes(search.toLowerCase()) ||
          (o.spCode && o.spCode.includes(search)),
      )
    : NFSE_SERVICOS;

  function handleSelect(entry: NfseServicoEntry) {
    onChange(entry.lc116, entry.spCode ?? '');
    closeDropdown();
  }

  const inputBase = cn(
    'w-full px-3.5 py-2.5 rounded-xl border text-sm',
    'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
    'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-300 dark:focus:border-red-500/40',
    'transition-all duration-200',
  );

  return (
    <div ref={containerRef} className={cn('w-full space-y-3', open && 'relative z-[100]')}>
      {/* Trigger / search */}
      <div>
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">
          Código do Serviço (LC 116)
        </label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />

          {/* Closed state — display button */}
          {!open && (
            <button
              type="button"
              onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
              className={cn(
                'w-full h-10 rounded-xl border pl-9 pr-16 text-sm text-left truncate',
                'transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-red-500/20',
                selectedEntry
                  ? 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-500/5 text-gray-900 dark:text-gray-100 focus:border-emerald-400'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-400 dark:text-gray-500 focus:border-red-300',
              )}
            >
              <span className="truncate">{displayValue || 'Selecionar serviço...'}</span>
            </button>
          )}

          {/* Open state — search input */}
          {open && (
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por código LC 116, descrição ou código SP..."
              autoFocus
              className={cn(
                'w-full h-10 rounded-xl border pl-9 pr-10 text-sm',
                'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100',
                'placeholder:text-gray-400 dark:placeholder:text-gray-500',
                'border-red-300 dark:border-red-500/40 ring-2 ring-red-500/20',
                'outline-none transition-all duration-200',
              )}
            />
          )}

          {/* Right buttons */}
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {lc116Value && !open && (
              <button
                type="button"
                tabIndex={-1}
                onClick={() => onChange('', '')}
                className="h-6 w-6 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            )}
            <button
              type="button"
              tabIndex={-1}
              onClick={() => { setOpen((o) => !o); if (!open) setTimeout(() => inputRef.current?.focus(), 0); }}
              className="h-6 w-6 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              <ChevronDown className={cn('w-4 h-4 transition-transform duration-200', open && 'rotate-180')} />
            </button>
          </div>

          {/* Dropdown */}
          {open && (
            <div className="absolute z-[200] top-full mt-1 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg max-h-64 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-4 py-4 text-center text-sm text-gray-400 dark:text-gray-500">
                  Nenhum serviço encontrado. Use os campos manuais abaixo.
                </div>
              ) : (
                filtered.map((entry) => (
                  <button
                    key={entry.lc116}
                    type="button"
                    onClick={() => handleSelect(entry)}
                    className={cn(
                      'w-full text-left px-4 py-2.5 flex items-start gap-3',
                      'hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors',
                      'border-b border-gray-100 dark:border-gray-700/50 last:border-b-0',
                      entry.lc116 === lc116Value && 'bg-red-50 dark:bg-red-500/10',
                    )}
                  >
                    <span className="shrink-0 font-mono text-xs font-semibold text-red-600 dark:text-red-400 mt-0.5 w-10">
                      {entry.lc116}
                    </span>
                    <span className="flex-1 text-sm text-gray-700 dark:text-gray-300 leading-snug">
                      {entry.descricao}
                    </span>
                    {entry.spCode && (
                      <span className="shrink-0 font-mono text-xs text-gray-400 dark:text-gray-500 mt-0.5 whitespace-nowrap">
                        SP: {entry.spCode}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Hint */}
        <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
          {selectedEntry?.spCode
            ? `Código municipal SP preenchido automaticamente: ${selectedEntry.spCode}`
            : 'Selecione da lista ou preencha os campos manuais abaixo.'}
        </p>
      </div>

      {/* Manual override fields */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">
            Cod. LC 116 (manual)
          </label>
          <input
            type="text"
            value={lc116Value}
            onChange={(e) => onChange(e.target.value, spCodeValue)}
            placeholder="01.07"
            className={cn(inputBase, 'font-mono')}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">
            Cod. Municipal SP (manual)
          </label>
          <input
            type="text"
            value={spCodeValue}
            onChange={(e) => onChange(lc116Value, e.target.value)}
            placeholder="2919"
            className={cn(inputBase, 'font-mono')}
          />
        </div>
      </div>
    </div>
  );
}
