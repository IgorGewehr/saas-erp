'use client';

import { TextField } from '@mui/material';
import { ArrowDown, ArrowUp, ListPlus, Plus, Trash2 } from 'lucide-react';
import { PRODUCT_SPECS_MAX } from '@/lib/contracts/domain/productV2';
import { moveSpec, parseProductSpecs, type ProductSpec } from '@/lib/utils/productSpecs';

interface ProductSpecsEditorProps {
  value: ProductSpec[];
  onChange: (next: ProductSpec[]) => void;
  description: string;
  onDescriptionChange: (next: string) => void;
}

const ICON_BUTTON =
  'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-gray-800 dark:hover:text-gray-200';

/**
 * Especificações estruturadas do produto (tabela "Rótulo → valor" na Vitrine).
 * Linhas meio preenchidas são descartadas no salvar (`sanitizeSpecs`), então dá pra deixar uma
 * linha em branco sem barrar o cadastro.
 */
export function ProductSpecsEditor({ value, onChange, description, onDescriptionChange }: ProductSpecsEditorProps) {
  // Produtos antigos guardavam as specs como linhas "Rótulo: valor" na descrição: oferece migrar.
  const legacy = value.length === 0 ? parseProductSpecs(description) : null;
  const canImport = legacy !== null && legacy.specs.length > 0;

  const update = (index: number, patch: Partial<ProductSpec>) =>
    onChange(value.map((spec, position) => (position === index ? { ...spec, ...patch } : spec)));

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
      <div>
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Especificações</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Aparecem como tabela na Vitrine. Ex.: Duração → 30 segundos · Horário → nobre.
        </p>
      </div>

      {canImport && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          <span>
            A descrição tem {legacy.specs.length} linhas no formato “Rótulo: valor”.
          </span>
          <button
            type="button"
            onClick={() => {
              onChange(legacy.specs);
              onDescriptionChange(legacy.rest);
            }}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-3 font-semibold text-white hover:bg-amber-700"
          >
            <ListPlus className="h-4 w-4" />
            Converter em especificações
          </button>
        </div>
      )}

      {value.length > 0 && (
        <ul className="space-y-2">
          {value.map((spec, index) => (
            <li key={index} className="flex items-start gap-2">
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <TextField
                  label="Rótulo"
                  value={spec.label}
                  onChange={(event) => update(index, { label: event.target.value })}
                  size="small"
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: 60 } }}
                />
                <TextField
                  label="Valor"
                  value={spec.value}
                  onChange={(event) => update(index, { value: event.target.value })}
                  size="small"
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: 200 } }}
                />
              </div>
              <div className="flex flex-shrink-0">
                <button type="button" className={ICON_BUTTON} disabled={index === 0} onClick={() => onChange(moveSpec(value, index, -1))} aria-label="Subir">
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button type="button" className={ICON_BUTTON} disabled={index === value.length - 1} onClick={() => onChange(moveSpec(value, index, 1))} aria-label="Descer">
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button type="button" className={ICON_BUTTON} onClick={() => onChange(value.filter((_, position) => position !== index))} aria-label="Remover especificação">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        disabled={value.length >= PRODUCT_SPECS_MAX}
        onClick={() => onChange([...value, { label: '', value: '' }])}
        className="flex h-10 items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 text-sm font-medium text-gray-600 transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300"
      >
        <Plus className="h-4 w-4" />
        Adicionar especificação
      </button>
    </div>
  );
}
