/**
 * Detecção de cliente duplicado.
 *
 * Usado em 2 fluxos:
 *   - ClientForm onSave (ClientsModule mutationFn): bloqueia salvar se já existe
 *     outro cliente com mesmo CPF/CNPJ/email/telefone/WhatsApp.
 *   - ImportModal: marca linhas do CSV que vão dar conflito antes de importar.
 *
 * Estratégia de comparação de telefone BR é tolerante a:
 *   - 9º dígito (98765-4321 vs 8765-4321)
 *   - Código do país (+55 / sem +55)
 *   - Formatação (parênteses, hífens, espaços)
 *
 * Exporta também um tipo ClientFormData mínimo necessário pra rodar o algoritmo
 * (pra evitar importar a interface completa do form). Os campos opcionais
 * `phone`, `whatsapp`, `email`, `cpfCnpj`, `tipo` são suficientes.
 */

import type { Client } from '@/lib/types';

export const digits = (v: string | undefined | null) => (v || '').replace(/\D/g, '');
export const normEmail = (v: string | undefined | null) => (v || '').trim().toLowerCase();

/**
 * Compara dois telefones BR considerando que o mesmo número pode aparecer com
 * ou sem 9º dígito (ex: 11987654321 vs 1187654321), com ou sem código do país
 * (5511987654321 vs 11987654321), e com formatação (parênteses/hífen).
 *
 * Estratégia: normalizar para "core" = últimos 10 dígitos (DDD+8) ou últimos
 * 11 dígitos (DDD+9). Se os "cores" baterem em qualquer combinação, consideramos
 * o mesmo número. Sem isso, cliente cadastrado manualmente como (11) 98765-4321
 * (11 dígitos) e webhook que recebe E.164 sem + (5511987654321, 13 dígitos)
 * não eram detectados como duplicata.
 */
export function samePhoneBR(a: string, b: string): boolean {
  const da = digits(a);
  const db = digits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  // Remove código do país BR (55) se presente
  const stripCountry = (n: string) => (n.length >= 12 && n.startsWith('55')) ? n.slice(2) : n;
  const a2 = stripCountry(da);
  const b2 = stripCountry(db);
  if (a2 === b2) return true;
  // Compara últimos 8 dígitos (assinatura sem DDD nem 9º) — match mais agressivo
  const last8a = a2.slice(-8);
  const last8b = b2.slice(-8);
  // Mas só conta se DDD bate (evita falso positivo entre cidades distintas)
  const ddda = a2.slice(0, 2);
  const dddb = b2.slice(0, 2);
  return last8a === last8b && ddda === dddb && last8a.length === 8;
}

export interface DuplicateCheckInput {
  name?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  cpfCnpj?: string;
  tipo?: 'pf' | 'pj';
}

export function findDuplicate(
  form: DuplicateCheckInput,
  clients: Client[],
  editingId?: string,
): { client: Client; field: string } | null {
  const cpfCnpj = digits(form.cpfCnpj);
  const phone = (form.phone || '').trim();
  const whatsapp = (form.whatsapp || '').trim();
  const email = normEmail(form.email);

  for (const c of clients) {
    if (editingId && c.id === editingId) continue;
    if (c.mergedInto) continue; // skip already-merged secondary records
    if ((c as { deletedAt?: string }).deletedAt) continue; // skip soft-deleted
    if (cpfCnpj && digits(c.cpfCnpj) === cpfCnpj) return { client: c, field: form.tipo === 'pj' ? 'CNPJ' : 'CPF' };
    if (email && normEmail(c.email) === email) return { client: c, field: 'e-mail' };
    if (phone) {
      if (samePhoneBR(c.phone || '', phone)) return { client: c, field: 'telefone' };
      if (samePhoneBR(c.whatsapp || '', phone)) return { client: c, field: 'telefone' };
    }
    if (whatsapp) {
      if (samePhoneBR(c.whatsapp || '', whatsapp)) return { client: c, field: 'WhatsApp' };
      if (samePhoneBR(c.phone || '', whatsapp)) return { client: c, field: 'WhatsApp' };
    }
  }
  return null;
}
