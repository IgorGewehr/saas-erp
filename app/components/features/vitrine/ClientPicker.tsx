'use client';

import { useMemo, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { ArrowLeft, Check, Loader2, Plus, Search, UserPlus } from 'lucide-react';
import { db } from '@/lib/config/firebase';
import { cn } from '@/lib/utils';
import { resolveClientIdentityClient } from '@/lib/services/clients/resolveIdentity';
import { filterClients, validateQuickClient, type QuickClientErrors } from '@/lib/utils/vitrineClient';
import type { Client } from '@/lib/types';
import type { ProposalClient } from './useVitrineProposal';
import { useVitrineClients } from './useVitrineClients';

interface ClientPickerProps {
  businessId: string;
  selected: ProposalClient | null;
  onSelect: (client: ProposalClient) => void;
  onBack: () => void;
}

const MAX_RESULTS = 50;
const INPUT_CLASS =
  'h-12 w-full rounded-xl border border-gray-200 bg-white px-4 text-[16px] text-gray-900 placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white';

export function ClientPicker({ businessId, selected, onSelect, onBack }: ClientPickerProps) {
  const { clients, isLoading } = useVitrineClients(businessId, true);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const results = useMemo(() => filterClients(clients, search), [clients, search]);

  if (creating) {
    return (
      <QuickCreateClient
        businessId={businessId}
        initialName={search}
        onCancel={() => setCreating(false)}
        onCreated={onSelect}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-800">
        <button
          type="button"
          onClick={onBack}
          aria-label="Voltar para a proposta"
          className="flex h-12 w-12 touch-manipulation items-center justify-center rounded-full text-gray-500 active:bg-gray-100 dark:active:bg-gray-800"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="font-display text-lg font-bold text-gray-900 dark:text-white">Escolher cliente</h2>
      </div>

      <div className="space-y-3 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nome, empresa, telefone ou e-mail"
            aria-label="Buscar cliente"
            className={cn(INPUT_CLASS, 'pl-12')}
          />
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-xl border border-dashed border-red-300 text-sm font-semibold text-red-600 active:bg-red-50 dark:border-red-500/40 dark:text-red-400 dark:active:bg-red-500/10"
        >
          <UserPlus className="h-4 w-4" />
          Cadastrar novo cliente
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, position) => <div key={position} className="h-14 rounded-xl shimmer" />)}
          </div>
        ) : results.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
            {clients.length === 0 ? 'Nenhum cliente cadastrado ainda.' : 'Nenhum cliente encontrado.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {results.slice(0, MAX_RESULTS).map((client) => (
              <li key={client.id}>
                <ClientRow client={client} isSelected={client.id === selected?.id} onSelect={() => onSelect({ id: client.id, name: client.name })} />
              </li>
            ))}
            {results.length > MAX_RESULTS && (
              <li className="py-2 text-center text-xs text-gray-400">Mostrando {MAX_RESULTS} de {results.length} — refine a busca.</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function ClientRow({ client, isSelected, onSelect }: { client: Client; isSelected: boolean; onSelect: () => void }) {
  const details = [client.company, client.phone, client.email].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex min-h-[3.5rem] w-full touch-manipulation items-center gap-3 rounded-xl border px-4 py-2 text-left transition-colors',
        isSelected
          ? 'border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10'
          : 'border-gray-100 bg-white active:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:active:bg-gray-800',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-gray-900 dark:text-white">{client.name}</p>
        {details && <p className="truncate text-xs text-gray-500 dark:text-gray-400">{details}</p>}
      </div>
      {isSelected && <Check className="h-5 w-5 flex-shrink-0 text-red-600" />}
    </button>
  );
}

function QuickCreateClient({
  businessId,
  initialName,
  onCancel,
  onCreated,
}: {
  businessId: string;
  initialName: string;
  onCancel: () => void;
  onCreated: (client: ProposalClient) => void;
}) {
  // O texto da busca vira o nome só se não parece telefone (quem digitou "11 9876…" quer o telefone).
  const [name, setName] = useState(/\d{3,}/.test(initialName) ? '' : initialName);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<QuickClientErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving) return;
    const found = validateQuickClient({ name, phone, email });
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    setSubmitError(null);
    try {
      // Acha-ou-cria por telefone: evita duplicar quem já está na base com outro nome/máscara.
      const resolved = await resolveClientIdentityClient({ businessId, phone, name: name.trim() });
      if (!resolved.clientId) throw new Error('Não foi possível cadastrar o cliente.');

      const clientRef = doc(db, 'clients', resolved.clientId);
      if (resolved.created && email.trim()) {
        await updateDoc(clientRef, { email: email.trim(), updatedAt: new Date().toISOString() });
      }
      // Se o telefone já existia, usa o cadastro existente (com o nome que ele já tem).
      const snapshot = await getDoc(clientRef);
      const finalName = (snapshot.data() as Client | undefined)?.name || name.trim();
      onCreated({ id: resolved.clientId, name: finalName });
    } catch (error) {
      setSubmitError(error instanceof Error && /telefone inválido/i.test(error.message)
        ? 'Telefone inválido. Confira o DDD e o número.'
        : 'Não foi possível cadastrar o cliente. Tente de novo.');
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-800">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          aria-label="Voltar para a lista de clientes"
          className="flex h-12 w-12 touch-manipulation items-center justify-center rounded-full text-gray-500 active:bg-gray-100 disabled:opacity-40 dark:active:bg-gray-800"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="font-display text-lg font-bold text-gray-900 dark:text-white">Novo cliente</h2>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
        <Field label="Nome ou empresa" error={errors.name}>
          <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" className={INPUT_CLASS} />
        </Field>
        <Field label="Telefone / WhatsApp" error={errors.phone}>
          <input type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(11) 98765-4321" className={INPUT_CLASS} />
        </Field>
        <Field label="E-mail (opcional)" error={errors.email}>
          <input type="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" className={INPUT_CLASS} />
        </Field>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Os demais dados (CNPJ, endereço) podem ser completados depois no módulo Clientes.
        </p>
        {submitError && (
          <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">{submitError}</p>
        )}
      </div>

      <div className="border-t border-gray-100 p-4 dark:border-gray-800">
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="flex h-14 w-full touch-manipulation items-center justify-center gap-2 rounded-2xl bg-red-600 text-md font-semibold text-white active:bg-red-700 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
          {saving ? 'Cadastrando…' : 'Cadastrar e usar'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
      {children}
      {error && <span role="alert" className="mt-1 block text-xs text-red-600 dark:text-red-400">{error}</span>}
    </label>
  );
}
