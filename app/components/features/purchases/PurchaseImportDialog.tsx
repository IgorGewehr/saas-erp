'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Ban, Building2, CheckCircle2, FileText, Link2, PackagePlus, Sparkles, Upload, X } from 'lucide-react';
import { toast } from 'react-toastify';
import type { PurchaseNoteReviewItem } from '@/lib/contracts/api/purchase-note-review';
import type { PurchaseNoteItemV2 } from '@/lib/contracts/domain/purchaseNoteV2';
import { listCatalogProductsPage } from '@/lib/services/product-catalog-client';
import { preparePurchaseNote, savePurchaseNoteReview } from '@/lib/services/purchase-import-client';
import type { PreparedPurchaseNote } from '@/lib/services/purchase-import-admin';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate } from '@/lib/utils/format';

type ReviewAction = 'pending' | 'match' | 'create' | 'skip';

interface ItemDraft {
  action: ReviewAction;
  productKey: string;
  conversionFactor: string;
  landedUnitCost: string;
  newProductName: string;
  newProductCategory: string;
  newProductUnit: string;
  newProductSku: string;
  newProductBarcode: string;
  lotCode: string;
  manufacturedAt: string;
  expiresAt: string;
}

interface ProductOption {
  key: string;
  productId: string;
  variantId?: string;
  label: string;
}

function initialDraft(item: PurchaseNoteItemV2): ItemDraft {
  const suggestion = item.matchSuggestions?.[0];
  const newProduct = item.newProduct;
  return {
    action: item.action === 'pending' ? 'pending' : item.action,
    productKey: item.productId
      ? `${item.productId}::${item.variantId ?? ''}`
      : suggestion ? `${suggestion.productId}::${suggestion.variantId ?? ''}` : '',
    conversionFactor: String(item.conversionFactor || 1),
    landedUnitCost: String(item.landedUnitCost || item.unitPrice),
    newProductName: newProduct?.name ?? item.productName,
    newProductCategory: newProduct?.category ?? 'Produto',
    newProductUnit: newProduct?.unit ?? item.stockUnit ?? item.purchaseUnit,
    newProductSku: newProduct?.sku ?? item.supplierProductCode ?? '',
    newProductBarcode: newProduct?.barcode ?? item.gtin ?? '',
    lotCode: item.lot?.code ?? '',
    manufacturedAt: item.lot?.manufacturedAt ?? '',
    expiresAt: item.lot?.expiresAt ?? '',
  };
}

function productOptions(products: Product[]): ProductOption[] {
  return products.flatMap((product) => {
    const allVariants = product.variants ?? [];
    const variants = allVariants.filter((variant) => variant.isActive !== false && variant.trackStock !== false);
    if (allVariants.length) return variants.map((variant) => ({
      key: `${product.id}::${variant.id}`,
      productId: product.id,
      variantId: variant.id,
      label: `${product.name} — ${variant.name}`,
    }));
    return product.trackStock === false ? [] : [{ key: `${product.id}::`, productId: product.id, label: product.name }];
  });
}

function UploadZone(props: { disabled: boolean; onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const pick = useCallback((file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xml')) return toast.error('Selecione um arquivo .xml.');
    props.onFile(file);
  }, [props]);
  return (
    <div onClick={() => !props.disabled && inputRef.current?.click()}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); pick(event.dataTransfer.files[0]); }}
      className={cn('flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed p-10 transition', dragging ? 'border-red-400 bg-red-50 dark:bg-red-500/10' : 'border-gray-200 hover:border-red-300 dark:border-gray-700')}>
      <input ref={inputRef} type="file" accept=".xml,application/xml,text/xml" className="hidden" onChange={(event) => { pick(event.target.files?.[0]); event.target.value = ''; }} />
      {props.disabled ? <div className="h-10 w-10 animate-spin rounded-full border-2 border-red-500 border-t-transparent" /> : <Upload className="h-10 w-10 text-gray-400" />}
      <p className="mt-3 text-sm font-semibold text-gray-700 dark:text-gray-200">{props.disabled ? 'Validando e preparando a NF-e...' : 'Arraste o XML ou clique para selecionar'}</p>
      <p className="mt-1 text-xs text-gray-400">NF-e modelo 55 · máximo de 5 MB</p>
    </div>
  );
}

export default function PurchaseImportDialog(props: {
  businessId: string;
  initialNote?: PreparedPurchaseNote | null;
  onClose: () => void;
  onCompleted: (note: PreparedPurchaseNote) => void;
}) {
  const [note, setNote] = useState<PreparedPurchaseNote | null>(props.initialNote ?? null);
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>(() => Object.fromEntries(
    (props.initialNote?.items ?? []).map((item) => [item.lineId, initialDraft(item)]),
  ));
  const [notes, setNotes] = useState(props.initialNote?.notes ?? '');
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const productsQuery = useQuery({
    queryKey: ['purchase-review-products', props.businessId],
    queryFn: () => listCatalogProductsPage({ businessId: props.businessId, limit: 200 }),
    staleTime: 30_000,
  });
  const options = useMemo(() => productOptions(productsQuery.data?.products ?? []), [productsQuery.data]);
  const selectableOptions = useMemo(() => {
    const indexed = new Map(options.map((option) => [option.key, option]));
    note?.items.forEach((item) => item.matchSuggestions?.forEach((suggestion) => {
      const key = `${suggestion.productId}::${suggestion.variantId ?? ''}`;
      if (!indexed.has(key)) indexed.set(key, {
        key,
        productId: suggestion.productId,
        variantId: suggestion.variantId,
        label: suggestion.productName,
      });
    }));
    return [...indexed.values()];
  }, [note, options]);

  const processFile = async (file: File) => {
    setIsPreparing(true);
    try {
      const prepared = await preparePurchaseNote(props.businessId, file);
      setNote(prepared);
      setDrafts(Object.fromEntries(prepared.items.map((item) => [item.lineId, initialDraft(item)])));
      setNotes(prepared.notes ?? '');
      toast.success('NF-e validada. Revise todos os itens antes de continuar.');
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setIsPreparing(false);
    }
  };

  const change = (lineId: string, patch: Partial<ItemDraft>) => {
    setDrafts((current) => ({ ...current, [lineId]: { ...current[lineId], ...patch } }));
  };

  const chooseSuggestion = (item: PurchaseNoteItemV2) => {
    const suggestion = item.matchSuggestions?.[0];
    if (!suggestion) return;
    change(item.lineId, { action: 'match', productKey: `${suggestion.productId}::${suggestion.variantId ?? ''}` });
  };

  const save = async () => {
    if (!note) return;
    const pending = note.items.find((item) => drafts[item.lineId]?.action === 'pending');
    if (pending) return toast.error(`Escolha uma ação para “${pending.productName}”.`);
    try {
      const items: PurchaseNoteReviewItem[] = note.items.map((item) => {
        const draft = drafts[item.lineId];
        const factor = Number(draft.conversionFactor.replace(',', '.'));
        const cost = Number(draft.landedUnitCost.replace(',', '.'));
        if (!Number.isFinite(factor) || factor <= 0) throw new Error(`Fator inválido em “${item.productName}”.`);
        if (!Number.isFinite(cost) || cost < 0) throw new Error(`Custo inválido em “${item.productName}”.`);
        const [productId, variantId] = draft.productKey.split('::');
        if (draft.action === 'match' && !productId) throw new Error(`Selecione o produto para “${item.productName}”.`);
        if (draft.action === 'create' && (!draft.newProductName.trim() || !draft.newProductCategory.trim() || !draft.newProductUnit.trim())) {
          throw new Error(`Preencha os dados do novo produto em “${item.productName}”.`);
        }
        return {
          lineId: item.lineId,
          action: draft.action as 'match' | 'create' | 'skip',
          ...(draft.action === 'match' ? { productId, ...(variantId ? { variantId } : {}) } : {}),
          ...(draft.action === 'create' ? { newProduct: {
            name: draft.newProductName.trim(), category: draft.newProductCategory.trim(), unit: draft.newProductUnit.trim().toUpperCase(),
            sku: draft.newProductSku.trim() || undefined, barcode: draft.newProductBarcode.trim() || undefined,
          } } : {}),
          conversionFactor: draft.action === 'skip' ? 1 : factor,
          landedUnitCost: cost,
          ...(draft.action !== 'skip' && draft.lotCode.trim() ? { lot: {
            code: draft.lotCode.trim(), manufacturedAt: draft.manufacturedAt || undefined, expiresAt: draft.expiresAt || undefined,
          } } : {}),
        };
      });
      setIsSaving(true);
      const reviewed = await savePurchaseNoteReview({ businessId: props.businessId, noteId: note.id, items, notes: notes.trim() || undefined });
      toast.success('Revisão salva. A nota está pronta para confirmação.');
      props.onCompleted(reviewed);
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !isPreparing && !isSaving) props.onClose(); }}>
      <div className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
        <div className="sticky top-0 z-20 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
          <div><h2 className="font-semibold text-gray-900 dark:text-white">{note ? `Revisar NF-e ${note.numero}/${note.serie}` : 'Importar NF-e de compra'}</h2><p className="text-xs text-gray-500">{note ? 'Defina o destino de cada item; nenhum estoque será alterado nesta etapa.' : 'O arquivo será validado com segurança no servidor.'}</p></div>
          <button onClick={props.onClose} disabled={isPreparing || isSaving} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-6">
          {!note ? <UploadZone disabled={isPreparing} onFile={processFile} /> : <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-blue-50 p-3 dark:bg-blue-500/10"><Building2 className="mb-2 h-4 w-4 text-blue-500" /><p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{note.supplierName}</p><p className="text-xs text-gray-500">{note.supplierCnpj}</p></div>
              <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/60"><FileText className="mb-2 h-4 w-4 text-gray-500" /><p className="text-sm font-semibold text-gray-900 dark:text-white">Emissão {formatDate(note.issueDate)}</p><p className="text-xs text-gray-500">{note.items.length} itens</p></div>
              <div className="rounded-xl bg-red-50 p-3 dark:bg-red-500/10"><p className="text-xs text-gray-500">Total da NF-e</p><p className="mt-1 text-xl font-bold text-red-600 dark:text-red-400">{formatCurrency(note.totalValue)}</p></div>
            </div>
            {note.validationWarnings?.map((warning) => <div key={warning} className="flex gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"><AlertTriangle className="h-4 w-4 shrink-0" />{warning}</div>)}
            <div className="space-y-4">
              {note.items.map((item, index) => {
                const draft = drafts[item.lineId];
                if (!draft) return null;
                const suggestion = item.matchSuggestions?.[0];
                return <section key={item.lineId} className="rounded-2xl border border-gray-200 p-4 dark:border-gray-700">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="text-xs font-medium text-gray-400">Item {index + 1} · código {item.supplierProductCode || '—'}</p><p className="font-semibold text-gray-900 dark:text-white">{item.productName}</p><p className="text-xs text-gray-500">{item.purchaseQuantity} {item.purchaseUnit} × {formatCurrency(item.unitPrice)} · custo preliminar {formatCurrency(item.landedUnitCost)}</p></div><p className="shrink-0 font-bold text-gray-900 dark:text-white">{formatCurrency(item.productTotal)}</p></div>
                  {suggestion && <button type="button" onClick={() => chooseSuggestion(item)} className="mt-3 flex w-full items-center gap-2 rounded-xl bg-purple-50 px-3 py-2 text-left text-xs text-purple-700 hover:bg-purple-100 dark:bg-purple-500/10 dark:text-purple-300"><Sparkles className="h-4 w-4 shrink-0" /><span className="flex-1"><strong>Sugestão:</strong> {suggestion.productName} ({Math.round(suggestion.confidence * 100)}%) · {suggestion.reasons.join(', ')}</span></button>}
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {([{ action: 'match', label: 'Vincular', icon: Link2 }, { action: 'create', label: 'Criar produto', icon: PackagePlus }, { action: 'skip', label: 'Ignorar', icon: Ban }] as const).map((option) => <button type="button" key={option.action} onClick={() => change(item.lineId, { action: option.action })} className={cn('flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-medium', draft.action === option.action ? 'border-red-400 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' : 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-300')}><option.icon className="h-3.5 w-3.5" />{option.label}</button>)}
                  </div>
                  {draft.action === 'match' && <label className="mt-3 block text-xs text-gray-500">Produto/variação<select value={draft.productKey} onChange={(event) => change(item.lineId, { productKey: event.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white"><option value="">Selecione...</option>{selectableOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>}
                  {draft.action === 'create' && <div className="mt-3 grid gap-2 sm:grid-cols-3"><input value={draft.newProductName} onChange={(event) => change(item.lineId, { newProductName: event.target.value })} placeholder="Nome" className="rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" /><input value={draft.newProductCategory} onChange={(event) => change(item.lineId, { newProductCategory: event.target.value })} placeholder="Categoria" className="rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" /><input value={draft.newProductUnit} onChange={(event) => change(item.lineId, { newProductUnit: event.target.value })} placeholder="Unidade" className="rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" /><input value={draft.newProductSku} onChange={(event) => change(item.lineId, { newProductSku: event.target.value })} placeholder="SKU opcional" className="rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" /><input value={draft.newProductBarcode} onChange={(event) => change(item.lineId, { newProductBarcode: event.target.value })} placeholder="Código de barras" className="rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" /></div>}
                  {draft.action !== 'pending' && draft.action !== 'skip' && <div className="mt-3 grid gap-2 sm:grid-cols-3"><label className="text-xs text-gray-500">Fator de conversão<input type="number" min="0.000001" step="any" value={draft.conversionFactor} onChange={(event) => change(item.lineId, { conversionFactor: event.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" /></label><label className="text-xs text-gray-500">Custo unitário final<input type="number" min="0" step="0.0001" value={draft.landedUnitCost} onChange={(event) => change(item.lineId, { landedUnitCost: event.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" /></label><div className="rounded-xl bg-gray-50 p-2 text-xs dark:bg-gray-800/60"><span className="text-gray-500">Entrada prevista</span><p className="mt-1 font-semibold text-gray-900 dark:text-white">{Number(draft.conversionFactor || 0) * item.purchaseQuantity} {draft.action === 'create' ? draft.newProductUnit : 'unidades de estoque'}</p></div></div>}
                  {draft.action !== 'skip' && draft.action !== 'pending' && <div className="mt-2 grid gap-2 sm:grid-cols-3"><input value={draft.lotCode} onChange={(event) => change(item.lineId, { lotCode: event.target.value })} placeholder="Lote (opcional)" className="rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" /><input type="date" value={draft.manufacturedAt} onChange={(event) => change(item.lineId, { manufacturedAt: event.target.value })} className="rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" /><input type="date" value={draft.expiresAt} onChange={(event) => change(item.lineId, { expiresAt: event.target.value })} className="rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" /></div>}
                </section>;
              })}
            </div>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={2000} placeholder="Observações sobre a compra..." className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-800" />
            <div className="flex justify-end gap-2"><button onClick={props.onClose} className="rounded-xl px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">Fechar e revisar depois</button><button onClick={save} disabled={isSaving || productsQuery.isLoading} className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">{isSaving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <CheckCircle2 className="h-4 w-4" />}Salvar revisão</button></div>
          </div>}
        </div>
      </div>
    </div>
  );
}
