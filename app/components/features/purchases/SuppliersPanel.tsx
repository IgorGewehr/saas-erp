'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive, Building2, CalendarClock, ChevronRight, CircleDollarSign, Edit3,
  FileText, History, Mail, MapPin, Package, Phone, Plus, RotateCcw, Search,
  Truck, X,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { useAuth } from '@/app/components/providers/AuthProvider';
import type { SupplierCatalogData } from '@/lib/contracts/api/supplier-catalog';
import {
  archiveSupplier,
  createSupplier,
  getSupplierWithRelations,
  listSuppliersPage,
  updateSupplier,
} from '@/lib/services/supplier-client';
import type { Supplier } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate } from '@/lib/utils/format';

interface SupplierFormState {
  documentType: 'cpf' | 'cnpj';
  document: string;
  razaoSocial: string;
  nomeFantasia: string;
  inscricaoEstadual: string;
  phone: string;
  email: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  notes: string;
  paymentTerms: string;
  leadTimeDays: string;
  minimumOrderValue: string;
  minimumOrderQuantity: string;
  orderMultiple: string;
}

const emptyForm: SupplierFormState = {
  documentType: 'cnpj', document: '', razaoSocial: '', nomeFantasia: '', inscricaoEstadual: '',
  phone: '', email: '', logradouro: '', numero: '', complemento: '', bairro: '', municipio: '',
  uf: '', cep: '', notes: '', paymentTerms: '', leadTimeDays: '', minimumOrderValue: '',
  minimumOrderQuantity: '', orderMultiple: '',
};

function formFromSupplier(supplier: Supplier): SupplierFormState {
  return {
    ...emptyForm,
    documentType: supplier.documentType ?? ((supplier.document ?? supplier.cnpj ?? '').replace(/\D/g, '').length === 11 ? 'cpf' : 'cnpj'),
    document: supplier.document ?? supplier.cnpj ?? '',
    razaoSocial: supplier.razaoSocial,
    nomeFantasia: supplier.nomeFantasia ?? '',
    inscricaoEstadual: supplier.inscricaoEstadual ?? '',
    phone: supplier.phone ?? '',
    email: supplier.email ?? '',
    logradouro: supplier.endereco?.logradouro ?? '',
    numero: supplier.endereco?.numero ?? '',
    complemento: supplier.endereco?.complemento ?? '',
    bairro: supplier.endereco?.bairro ?? '',
    municipio: supplier.endereco?.municipio ?? '',
    uf: supplier.endereco?.uf ?? '',
    cep: supplier.endereco?.cep ?? '',
    notes: supplier.notes ?? '',
    paymentTerms: supplier.paymentTerms ?? '',
    leadTimeDays: supplier.leadTimeDays?.toString() ?? '',
    minimumOrderValue: supplier.minimumOrderValue?.toString() ?? '',
    minimumOrderQuantity: supplier.minimumOrderQuantity?.toString() ?? '',
    orderMultiple: supplier.orderMultiple?.toString() ?? '',
  };
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formData(form: SupplierFormState): SupplierCatalogData {
  return {
    documentType: form.documentType,
    document: form.document,
    razaoSocial: form.razaoSocial,
    nomeFantasia: form.nomeFantasia || undefined,
    inscricaoEstadual: form.inscricaoEstadual || undefined,
    phone: form.phone || undefined,
    email: form.email || undefined,
    endereco: {
      logradouro: form.logradouro || undefined,
      numero: form.numero || undefined,
      complemento: form.complemento || undefined,
      bairro: form.bairro || undefined,
      municipio: form.municipio || undefined,
      uf: form.uf.toUpperCase() || undefined,
      cep: form.cep || undefined,
    },
    notes: form.notes || undefined,
    paymentTerms: form.paymentTerms || undefined,
    leadTimeDays: optionalNumber(form.leadTimeDays),
    minimumOrderValue: optionalNumber(form.minimumOrderValue),
    minimumOrderQuantity: optionalNumber(form.minimumOrderQuantity),
    orderMultiple: optionalNumber(form.orderMultiple),
    isActive: true,
  };
}

function documentLabel(supplier: Supplier): string {
  const digits = supplier.document ?? supplier.cnpj ?? '';
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return digits;
}

function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={cn('block', props.className)}>
      <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">{props.label}</span>
      <input
        type={props.type ?? 'text'} value={props.value} required={props.required}
        placeholder={props.placeholder} onChange={(event) => props.onChange(event.target.value)}
        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
      />
    </label>
  );
}

function SupplierEditor(props: {
  supplier: Supplier | null;
  onClose: () => void;
  onSave: (data: SupplierCatalogData) => Promise<void>;
  isSaving: boolean;
}) {
  const [form, setForm] = useState(() => props.supplier ? formFromSupplier(props.supplier) : emptyForm);
  const set = (key: keyof SupplierFormState) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const digits = form.document.replace(/\D/g, '');
    if ((form.documentType === 'cpf' && digits.length !== 11) || (form.documentType === 'cnpj' && digits.length !== 14)) {
      toast.error(`Informe um ${form.documentType.toUpperCase()} válido.`);
      return;
    }
    await props.onSave(formData({ ...form, document: digits }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onMouseDown={(event) => {
      if (event.target === event.currentTarget) props.onClose();
    }}>
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white">{props.supplier ? 'Editar fornecedor' : 'Novo fornecedor'}</h2>
            <p className="text-xs text-gray-500">Dados comerciais e condições de compra</p>
          </div>
          <button type="button" onClick={props.onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-6 p-6">
          <section>
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">Identificação</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Tipo</span>
                <select value={form.documentType} onChange={(event) => setForm((current) => ({ ...current, documentType: event.target.value as 'cpf' | 'cnpj', document: '' }))}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white">
                  <option value="cnpj">Pessoa jurídica (CNPJ)</option>
                  <option value="cpf">Pessoa física (CPF)</option>
                </select>
              </label>
              <Field label={form.documentType.toUpperCase()} value={form.document} onChange={set('document')} required />
              <Field label="Razão social / Nome" value={form.razaoSocial} onChange={set('razaoSocial')} required />
              <Field label="Nome fantasia" value={form.nomeFantasia} onChange={set('nomeFantasia')} />
              <Field label="Inscrição estadual" value={form.inscricaoEstadual} onChange={set('inscricaoEstadual')} />
            </div>
          </section>
          <section>
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">Contato e endereço</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Telefone" value={form.phone} onChange={set('phone')} />
              <Field label="E-mail" value={form.email} onChange={set('email')} type="email" className="lg:col-span-2" />
              <Field label="Logradouro" value={form.logradouro} onChange={set('logradouro')} className="sm:col-span-2" />
              <Field label="Número" value={form.numero} onChange={set('numero')} />
              <Field label="Complemento" value={form.complemento} onChange={set('complemento')} />
              <Field label="Bairro" value={form.bairro} onChange={set('bairro')} />
              <Field label="Município" value={form.municipio} onChange={set('municipio')} />
              <Field label="UF" value={form.uf} onChange={set('uf')} />
              <Field label="CEP" value={form.cep} onChange={set('cep')} />
            </div>
          </section>
          <section>
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">Condições comerciais</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Condições de pagamento" value={form.paymentTerms} onChange={set('paymentTerms')} className="sm:col-span-2" placeholder="Ex.: 30/60 dias" />
              <Field label="Prazo médio (dias)" value={form.leadTimeDays} onChange={set('leadTimeDays')} type="number" />
              <Field label="Pedido mínimo (R$)" value={form.minimumOrderValue} onChange={set('minimumOrderValue')} type="number" />
              <Field label="Quantidade mínima" value={form.minimumOrderQuantity} onChange={set('minimumOrderQuantity')} type="number" />
              <Field label="Múltiplo de compra" value={form.orderMultiple} onChange={set('orderMultiple')} type="number" />
            </div>
            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Observações</span>
              <textarea value={form.notes} onChange={(event) => set('notes')(event.target.value)} rows={3}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white" />
            </label>
          </section>
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-100 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
          <button type="button" onClick={props.onClose} className="rounded-xl px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">Cancelar</button>
          <button disabled={props.isSaving} className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
            {props.isSaving ? 'Salvando...' : 'Salvar fornecedor'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function SuppliersPanel() {
  const { business } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Supplier | null | undefined>(undefined);

  const listQuery = useInfiniteQuery({
    queryKey: ['suppliers', business?.id, includeInactive],
    enabled: Boolean(business?.id),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listSuppliersPage({
      businessId: business!.id,
      includeInactive,
      cursor: pageParam,
      limit: 100,
    }),
    getNextPageParam: (page) => page.hasMore ? page.nextCursor : undefined,
  });
  const suppliers = useMemo(() => listQuery.data?.pages.flatMap((page) => page.suppliers) ?? [], [listQuery.data]);
  const filtered = useMemo(() => {
    const term = search.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const digits = search.replace(/\D/g, '');
    if (!term) return suppliers;
    return suppliers.filter((supplier) => {
      const names = `${supplier.razaoSocial} ${supplier.nomeFantasia ?? ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const document = supplier.document ?? supplier.cnpj ?? '';
      return names.includes(term) || (digits && document.includes(digits));
    });
  }, [search, suppliers]);

  const detailQuery = useQuery({
    queryKey: ['supplier-relations', business?.id, selectedId],
    enabled: Boolean(business?.id && selectedId),
    queryFn: () => getSupplierWithRelations(business!.id, selectedId!),
  });
  const selected = detailQuery.data?.supplier ?? suppliers.find((supplier) => supplier.id === selectedId) ?? null;

  const saveMutation = useMutation({
    mutationFn: async (data: SupplierCatalogData) => {
      if (!business?.id) throw new Error('Empresa não encontrada.');
      if (editing) return updateSupplier({ businessId: business.id, supplierId: editing.id, data });
      return createSupplier({ businessId: business.id, data });
    },
    onSuccess: async (supplier) => {
      toast.success(editing ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.');
      setEditing(undefined);
      setSelectedId(supplier.id);
      await queryClient.invalidateQueries({ queryKey: ['suppliers', business?.id] });
      await queryClient.invalidateQueries({ queryKey: ['supplier-relations', business?.id, supplier.id] });
    },
    onError: (cause: Error) => toast.error(cause.message),
  });
  const statusMutation = useMutation({
    mutationFn: async (supplier: Supplier) => {
      if (!business?.id) throw new Error('Empresa não encontrada.');
      return supplier.isActive
        ? archiveSupplier({ businessId: business.id, supplierId: supplier.id })
        : updateSupplier({ businessId: business.id, supplierId: supplier.id, data: { isActive: true } });
    },
    onSuccess: async (supplier) => {
      toast.success(supplier.isActive ? 'Fornecedor reativado.' : 'Fornecedor inativado.');
      await queryClient.invalidateQueries({ queryKey: ['suppliers', business?.id] });
      await queryClient.invalidateQueries({ queryKey: ['supplier-relations', business?.id, supplier.id] });
    },
    onError: (cause: Error) => toast.error(cause.message),
  });

  const relations = detailQuery.data?.relations;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold text-gray-900 dark:text-white"><Building2 className="h-6 w-6 text-red-500" />Fornecedores</h1>
          <p className="mt-0.5 text-sm text-gray-500">Cadastro, condições comerciais e histórico de compras</p>
        </div>
        <button onClick={() => setEditing(null)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700">
          <Plus className="h-4 w-4" /> Novo fornecedor
        </button>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, CNPJ ou CPF..."
            className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-800/60 dark:text-white" />
        </div>
        <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
          <input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} className="accent-red-600" /> Mostrar inativos
        </label>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className={cn('min-w-0 flex-1 overflow-y-auto pr-1', selected && 'hidden lg:block')}>
          {listQuery.isLoading ? (
            <div className="space-y-2">{[0, 1, 2, 3].map((item) => <div key={item} className="h-20 rounded-xl shimmer" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center"><Building2 className="mb-3 h-10 w-10 text-gray-300" /><p className="font-medium text-gray-600 dark:text-gray-300">Nenhum fornecedor encontrado</p></div>
          ) : (
            <div className="space-y-2">
              {filtered.map((supplier) => (
                <button key={supplier.id} onClick={() => setSelectedId(supplier.id)} className={cn(
                  'flex w-full items-center gap-3 rounded-xl border p-4 text-left transition',
                  selectedId === supplier.id ? 'border-red-200 bg-red-50/60 dark:border-red-500/30 dark:bg-red-500/5' : 'border-transparent hover:border-gray-200 hover:bg-gray-50 dark:hover:border-gray-700 dark:hover:bg-gray-800/50',
                )}>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-500/10"><Building2 className="h-5 w-5 text-blue-500" /></div>
                  <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{supplier.nomeFantasia || supplier.razaoSocial}</p>{!supplier.isActive && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800">Inativo</span>}</div><p className="truncate text-xs text-gray-500">{supplier.razaoSocial} · {documentLabel(supplier)}</p></div>
                  <ChevronRight className="h-4 w-4 text-gray-300" />
                </button>
              ))}
              {listQuery.hasNextPage && <button disabled={listQuery.isFetchingNextPage} onClick={() => listQuery.fetchNextPage()} className="w-full rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">{listQuery.isFetchingNextPage ? 'Carregando...' : 'Carregar mais'}</button>}
            </div>
          )}
        </div>

        {selected && (
          <aside className="w-full shrink-0 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900/60 lg:w-[420px]">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div><p className="text-lg font-bold text-gray-900 dark:text-white">{selected.nomeFantasia || selected.razaoSocial}</p><p className="text-xs text-gray-500">{selected.razaoSocial}</p></div>
              <button onClick={() => setSelectedId(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
              <p className="flex items-center gap-2"><FileText className="h-4 w-4 text-gray-400" />{documentLabel(selected)}</p>
              {selected.phone && <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-gray-400" />{selected.phone}</p>}
              {selected.email && <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-gray-400" />{selected.email}</p>}
              {selected.endereco?.municipio && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-gray-400" />{selected.endereco.municipio}/{selected.endereco.uf}</p>}
            </div>
            <div className="my-5 grid grid-cols-2 gap-2">
              <button onClick={() => setEditing(selected)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"><Edit3 className="h-4 w-4" />Editar</button>
              <button disabled={statusMutation.isPending} onClick={() => statusMutation.mutate(selected)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">{selected.isActive ? <Archive className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}{selected.isActive ? 'Inativar' : 'Reativar'}</button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/60"><CalendarClock className="mb-2 h-4 w-4 text-amber-500" /><p className="text-xs text-gray-500">Prazo médio</p><p className="font-semibold text-gray-900 dark:text-white">{selected.leadTimeDays !== undefined ? `${selected.leadTimeDays} dias` : 'Não informado'}</p></div>
              <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/60"><CircleDollarSign className="mb-2 h-4 w-4 text-emerald-500" /><p className="text-xs text-gray-500">Pedido mínimo</p><p className="font-semibold text-gray-900 dark:text-white">{selected.minimumOrderValue !== undefined ? formatCurrency(selected.minimumOrderValue) : 'Não informado'}</p></div>
            </div>
            {selected.paymentTerms && <div className="mt-2 rounded-xl bg-gray-50 p-3 text-sm dark:bg-gray-800/60"><p className="text-xs text-gray-500">Condições de pagamento</p><p className="mt-1 text-gray-800 dark:text-gray-200">{selected.paymentTerms}</p></div>}

            {detailQuery.isLoading ? <div className="mt-5 h-28 rounded-xl shimmer" /> : relations && <div className="mt-6 space-y-5">
              <section><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white"><Truck className="h-4 w-4 text-red-500" />Compras vinculadas ({relations.purchaseNotes.length})</h3>{relations.purchaseNotes.slice(0, 5).map((note) => <div key={note.id} className="mb-1 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-gray-800/60"><span>NF-e {note.numero}/{note.serie}</span><span className="font-medium">{formatCurrency(note.totalValue)}</span></div>)}{relations.purchaseNotes.length === 0 && <p className="text-xs text-gray-400">Nenhuma nota vinculada.</p>}</section>
              <section><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white"><Package className="h-4 w-4 text-blue-500" />Produtos comprados ({relations.products.length})</h3><div className="flex flex-wrap gap-1.5">{relations.products.map((product) => <span key={product.id} className="rounded-lg bg-blue-50 px-2 py-1 text-xs text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{product.name}</span>)}{relations.products.length === 0 && <p className="text-xs text-gray-400">Os produtos aparecerão após uma entrada de compra vinculada.</p>}</div></section>
              <section><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white"><History className="h-4 w-4 text-purple-500" />Histórico ({relations.history.length})</h3>{relations.history.slice(0, 8).map((entry) => <div key={entry.id} className="mb-2 border-l-2 border-purple-200 pl-3 text-xs dark:border-purple-500/30"><p className="font-medium text-gray-700 dark:text-gray-200">{{ created: 'Cadastro realizado', updated: 'Dados atualizados', archived: 'Fornecedor inativado', reactivated: 'Fornecedor reativado' }[entry.action]}</p><p className="text-gray-400">{entry.actorName} · {formatDate(entry.createdAt)}</p></div>)}</section>
            </div>}
          </aside>
        )}
      </div>

      {editing !== undefined && <SupplierEditor supplier={editing} onClose={() => setEditing(undefined)} onSave={async (data) => { await saveMutation.mutateAsync(data); }} isSaving={saveMutation.isPending} />}
    </div>
  );
}
