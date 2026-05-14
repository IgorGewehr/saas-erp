'use client';

/**
 * Dialog reutilizável de criar/editar cliente.
 *
 * Extraído do ClientsModule pra que outros módulos (Conversas, CRM) possam
 * editar/criar cliente sem precisar navegar até /clientes. O wrapper inteiro
 * vive aqui: ModernDialog + ClientForm + mutation de save (validação CPF/CNPJ,
 * dedup, addDoc/updateDoc).
 *
 * Modos:
 *   • Edit:   passa `client` → form pré-popula com dados do doc, save chama updateDoc
 *   • Create: omite `client` (ou null) → form parte do emptyForm + initialOverrides,
 *             save chama addDoc com businessId/score/totalSpent/etc. defaults.
 *
 * `onSaved(clientId)` permite o caller reagir (ex: ConversasModule vincula o
 * client recém-criado à conversation setando `crmContactId`).
 */

import { useEffect, useMemo, useState } from 'react';
import { Users, CheckCircle2 } from 'lucide-react';
import { toast } from 'react-toastify';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addDoc, collection, deleteField, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { validateCPF, validateCNPJ } from '@/lib/utils/validators';
import type { Client } from '@/lib/types';
import {
  ModernDialog, ModernDialogActions, ModernCancelButton, ModernPrimaryButton, ModernPill,
} from '@/app/components/ui/dialog';
import { ClientForm, emptyForm, type ClientFormData } from './ClientForm';
import { findDuplicate } from './shared/duplicates';

export interface ClientEditDialogProps {
  open: boolean;
  onClose: () => void;
  /** Cliente a editar. Quando ausente/null, dialog abre em modo "criar". */
  client?: Client | null;
  /** Sobreposições aplicadas a emptyForm quando criando — útil pra
   *  pré-preencher dados conhecidos (ex: nome+telefone vindos de uma conversa
   *  ao vincular um contato novo). Ignorado em edit (dados vêm do client). */
  initialOverrides?: Partial<ClientFormData>;
  /** Lista completa de clientes pra detectar duplicatas no client-side antes
   *  do Firestore write (UX: erro early com mensagem específica). Sem isso,
   *  o save passa direto e Firestore aceita — duplicata seria detectada só
   *  por outras heurísticas (merge tool, etc). */
  allClients?: Client[];
  /** Tags pra autocomplete no TagEditor. Sem isso, input simples sem sugestões. */
  tagSuggestions?: string[];
  /** Catálogos pra os campos de aquisição. Opcionais — irrelevantes pra fluxos
   *  fora de /clientes (Conversas raramente edita oferta de aquisição). */
  products?: Array<{ id: string; name: string }>;
  offers?: Array<{ id: string; name: string }>;
  onManageOffers?: () => void;
  /** Disparado após save bem-sucedido. Recebe o id do doc (novo ou existente). */
  onSaved?: (clientId: string) => void;
  /** Campos extra a injetar no `addDoc` quando estiver criando (modo create
   *  apenas — ignorado em edit). Útil pra setar campos que não existem no
   *  ClientForm, como `inPipeline`, `channelIdentities`, `avatarUrl`,
   *  `lastConversationId`. O form sobrescreve defaults aqui, então
   *  campos do form (name/email/phone/etc.) ganham prioridade. */
  creationDefaults?: Record<string, unknown>;
}

/** Constrói o estado inicial do form a partir do client (edit) ou de
 *  emptyForm + overrides (create). Extraído pra fácil leitura — a lógica
 *  é a mesma do `formInitial` que vivia no ClientsModule. */
function buildInitialForm(
  client: Client | null | undefined,
  overrides: Partial<ClientFormData> | undefined,
): ClientFormData {
  if (client) {
    return {
      name: client.name,
      email: client.email || '',
      phone: client.phone || '',
      whatsapp: client.whatsapp || '',
      company: client.company || '',
      tipo: client.tipo || 'pf',
      cpfCnpj: client.cpfCnpj || '',
      inscricaoEstadual: client.inscricaoEstadual || '',
      indicadorIE: client.indicadorIE || '',
      birthDate: client.birthDate || '',
      source: client.source,
      status: client.status,
      notes: client.notes || '',
      tags: client.tags ? [...client.tags] : [],
      cep: client.endereco?.cep || '',
      logradouro: client.endereco?.logradouro || '',
      numero: client.endereco?.numero || '',
      complemento: client.endereco?.complemento || '',
      bairro: client.endereco?.bairro || '',
      municipio: client.endereco?.municipio || '',
      uf: client.endereco?.uf || '',
      acquisitionOfferId: client.acquisitionOfferId || '',
      acquisitionProductId: client.acquisitionProductId || '',
      acquisitionOfferLabel: client.acquisitionOfferLabel || '',
    };
  }
  return { ...emptyForm, ...(overrides || {}) };
}

export function ClientEditDialog({
  open,
  onClose,
  client,
  initialOverrides,
  allClients = [],
  tagSuggestions = [],
  products = [],
  offers = [],
  onManageOffers,
  onSaved,
  creationDefaults,
}: ClientEditDialogProps) {
  const { business } = useAuth();
  const queryClient = useQueryClient();

  const formInitial = useMemo(
    () => buildInitialForm(client ?? null, initialOverrides),
    [client, initialOverrides],
  );
  const [form, setForm] = useState<ClientFormData>(formInitial);

  // Re-sincroniza ao abrir ou trocar o cliente — sem isso, abrir o dialog 2x
  // em clientes diferentes mostraria o form do primeiro.
  useEffect(() => {
    if (open) setForm(formInitial);
  }, [open, client?.id, formInitial]);

  const { mutate: saveClient, isPending: isSaving } = useMutation({
    mutationFn: async (data: ClientFormData) => {
      // Validação CPF/CNPJ antes do save evita registrar lixo que quebra
      // emissão fiscal depois (NFe rejeita CNPJ inválido).
      const cpfCnpjRaw = (data.cpfCnpj || '').trim();
      if (cpfCnpjRaw) {
        const isValid = data.tipo === 'pj' ? validateCNPJ(cpfCnpjRaw) : validateCPF(cpfCnpjRaw);
        if (!isValid) {
          throw new Error(`${data.tipo === 'pj' ? 'CNPJ' : 'CPF'} inválido — confira os dígitos`);
        }
      }

      const dup = findDuplicate(data, allClients, client?.id);
      if (dup) {
        throw new Error(`Já existe um cliente com esse ${dup.field}: "${dup.client.name}"`);
      }

      const now = new Date().toISOString();
      const payload: Partial<Client> = {
        name: data.name.trim(),
        email: data.email.trim() || undefined,
        phone: data.phone.trim() || undefined,
        whatsapp: data.whatsapp.trim() || undefined,
        company: data.company.trim() || undefined,
        tipo: data.tipo,
        cpfCnpj: data.cpfCnpj.trim() || undefined,
        inscricaoEstadual: data.inscricaoEstadual.trim() || undefined,
        indicadorIE: (['1', '2', '9'] as const).includes(data.indicadorIE as '1' | '2' | '9')
          ? (data.indicadorIE as '1' | '2' | '9')
          : undefined,
        birthDate: data.birthDate.trim() || undefined,
        source: data.source,
        status: data.status,
        notes: data.notes.trim() || undefined,
        tags: data.tags.length ? data.tags : undefined,
        acquisitionOfferId: data.acquisitionOfferId.trim() || undefined,
        acquisitionProductId: data.acquisitionProductId.trim() || undefined,
        acquisitionOfferLabel: data.acquisitionOfferLabel.trim() || undefined,
        updatedAt: now,
      };

      // Endereço nested: monta só com chaves preenchidas — updateDoc rejeita
      // undefined em campos nested, então qualquer chave vazia precisa ficar
      // de fora do objeto (sanitizer top-level abaixo só limpa o root).
      if (data.cep || data.logradouro || data.municipio) {
        const endereco: Record<string, string> = {};
        const cep = data.cep.trim();         if (cep) endereco.cep = cep;
        const log = data.logradouro.trim();  if (log) endereco.logradouro = log;
        const num = data.numero.trim();      if (num) endereco.numero = num;
        const cmp = data.complemento.trim(); if (cmp) endereco.complemento = cmp;
        const bai = data.bairro.trim();      if (bai) endereco.bairro = bai;
        const mun = data.municipio.trim();   if (mun) endereco.municipio = mun;
        const uf  = data.uf.trim();          if (uf)  endereco.uf = uf;
        if (Object.keys(endereco).length > 0) payload.endereco = endereco;
      }

      if (client) {
        // updateDoc rejeita undefined → converte para deleteField() (limpa
        // campos que o operador apagou via UI).
        const updatePayload = Object.fromEntries(
          Object.entries(payload).map(([k, v]) => [k, v === undefined ? deleteField() : v]),
        );
        await updateDoc(doc(db, 'clients', client.id), updatePayload);
        return client.id;
      }
      // create: addDoc remove undefined silenciosamente, mas filtramos
      // explicitamente pra não gravar chaves "vazias". Ordem dos spreads:
      //   1. creationDefaults — campos extras que não vêm do form (inPipeline,
      //      channelIdentities, avatarUrl, lastConversationId, etc.)
      //   2. createPayload — campos do form (sobrescreve defaults com a
      //      escolha do operador no formulário)
      //   3. businessId/score/etc — defaults técnicos imutáveis no ponto final
      const createPayload = Object.fromEntries(
        Object.entries(payload).filter(([, v]) => v !== undefined),
      );
      const ref = await addDoc(collection(db, 'clients'), {
        ...(creationDefaults || {}),
        ...createPayload,
        businessId: business!.id,
        score: 0,
        isActive: true,
        totalSpent: 0,
        visitCount: 0,
        createdAt: now,
      });
      return ref.id;
    },
    onSuccess: (clientId) => {
      queryClient.invalidateQueries({ queryKey: ['clients', business?.id] });
      toast.success(client ? 'Cliente atualizado!' : 'Cliente cadastrado!');
      onSaved?.(clientId);
      onClose();
    },
    onError: (err: Error) => {
      console.error('[ClientEditDialog] Save error:', err);
      toast.error(err?.message || 'Erro ao salvar cliente');
    },
  });

  return (
    <ModernDialog
      open={open}
      onClose={onClose}
      icon={Users}
      title={client ? 'Editar cliente' : 'Novo cliente'}
      badges={
        <ModernPill tone={form.tipo === 'pj' ? 'blue' : 'red'}>
          {form.tipo === 'pj' ? 'PJ' : 'PF'}
        </ModernPill>
      }
      footer={
        <ModernDialogActions>
          <ModernCancelButton onClick={onClose}>Cancelar</ModernCancelButton>
          <ModernPrimaryButton
            onClick={() => saveClient(form)}
            disabled={isSaving || !form.name.trim()}
            startIcon={!isSaving ? <CheckCircle2 size={16} /> : undefined}
          >
            {isSaving ? 'Salvando…' : client ? 'Salvar alterações' : 'Criar cliente'}
          </ModernPrimaryButton>
        </ModernDialogActions>
      }
    >
      <ClientForm
        form={form}
        setForm={setForm}
        tagSuggestions={tagSuggestions}
        products={products}
        offers={offers}
        onManageOffers={onManageOffers}
      />
    </ModernDialog>
  );
}
