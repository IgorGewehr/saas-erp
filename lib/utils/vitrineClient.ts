/**
 * lib/utils/vitrineClient.ts
 *
 * Regras puras do seletor de cliente da Vitrine: busca na lista e validação do
 * cadastro rápido (nome + telefone + e-mail opcional).
 */

import type { Client } from '@/lib/types';
import { normalizeSearchText } from '@/lib/utils/vitrineCatalog';

type SearchableClient = Pick<Client, 'name' | 'company' | 'phone' | 'whatsapp' | 'email'>;

function digits(text: string | undefined): string {
  return (text ?? '').replace(/\D/g, '');
}

/** Busca por nome/empresa/e-mail (sem acento) ou por pedaço do telefone (só dígitos). */
export function filterClients<T extends SearchableClient>(clients: T[], search: string): T[] {
  const term = normalizeSearchText(search);
  if (!term) return clients;
  const termDigits = digits(search);

  return clients.filter((client) => {
    const text = normalizeSearchText([client.name, client.company, client.email].filter(Boolean).join(' '));
    if (text.includes(term)) return true;
    // Só busca por telefone com 3+ dígitos: "1" não pode casar com todo cliente que tem um "1" no número.
    return termDigits.length >= 3 && (digits(client.phone).includes(termDigits) || digits(client.whatsapp).includes(termDigits));
  });
}

export interface QuickClientInput {
  name: string;
  phone: string;
  email: string;
}

export type QuickClientErrors = Partial<Record<keyof QuickClientInput, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Telefone BR: 10–13 dígitos (DDD + número, com ou sem 55). */
export function validateQuickClient(input: QuickClientInput): QuickClientErrors {
  const errors: QuickClientErrors = {};
  if (input.name.trim().length < 2) errors.name = 'Informe o nome ou a empresa.';
  const phoneDigits = digits(input.phone);
  if (phoneDigits.length < 10 || phoneDigits.length > 13) errors.phone = 'Informe o telefone com DDD.';
  if (input.email.trim() !== '' && !EMAIL.test(input.email.trim())) errors.email = 'E-mail inválido.';
  return errors;
}
