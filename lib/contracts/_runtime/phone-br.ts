/**
 * lib/contracts/_runtime/phone-br.ts
 *
 * Canonicalização e fuzzy matching de telefones brasileiros.
 *
 * Antes existia duplicação:
 *   - lib/services/conversationFromCampaign.ts
 *   - lib/services/baileys/* (resolução @lid → phone)
 *   - app/api/webhooks/meta/route.ts
 *
 * Tudo deve passar por aqui. Fecha o gap G4 (duplicação) para identidade WhatsApp BR.
 *
 * Convenção: canonical form = digits-only, prefixo de país explícito (55 para BR).
 *
 * Exemplos:
 *   "+55 (11) 98765-4321" → "5511987654321"
 *   "11 9876-5432"        → "5511987654321" (assume BR + adiciona 9)
 *   "5511987654321"       → "5511987654321"
 *   "551187654321"        → "551187654321"  (sem 9; variação válida)
 *
 * Fuzzy match:
 *   "5511987654321" ↔ "551187654321" → MATCH (com/sem 9)
 *   "5511987654321" ↔ "+55 11 98765-4321" → MATCH (normalização)
 */

const DEFAULT_COUNTRY = '55'; // Brazil

/**
 * Retorna apenas dígitos. `undefined` se vazio.
 */
export function digitsOnly(input: string | null | undefined): string {
  if (!input) return '';
  return input.replace(/\D+/g, '');
}

/**
 * Forma canônica BR: adiciona prefixo 55 se for número local; preserva como veio
 * caso já comece com prefixo de outro país (qualquer string com dígito ≠ 55 no início
 * fica imutável, evitando "consertar" números estrangeiros).
 */
export function canonicalizeBr(input: string | null | undefined): string {
  const digits = digitsOnly(input);
  if (!digits) return '';
  // Heurística: se começa com 55 e tem 12–13 dígitos, já é canonical
  if (digits.startsWith(DEFAULT_COUNTRY) && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }
  // 10–11 dígitos (DDD + número, com/sem 9) → adiciona 55
  if (digits.length === 10 || digits.length === 11) {
    return DEFAULT_COUNTRY + digits;
  }
  // Outros casos (internacional não-BR, ou string esquisita): devolve como veio
  return digits;
}

/**
 * Gera variação BR alternando o "9" pós-DDD.
 *   "5511987654321" → "551187654321"
 *   "551187654321"  → "5511987654321"
 *
 * Retorna `null` se a variação não faz sentido (número internacional, ou
 * formato incompatível).
 */
export function alternativeBrPhone(canonical: string): string | null {
  if (!canonical.startsWith(DEFAULT_COUNTRY)) return null;
  const rest = canonical.slice(2); // remove "55"
  // DDD = 2 dígitos. Depois pode ter 8 ou 9 dígitos.
  if (rest.length === 11) {
    // Com 9: tira o 9 depois do DDD
    const ddd = rest.slice(0, 2);
    const ninth = rest.slice(2, 3);
    const number = rest.slice(3);
    if (ninth === '9' && number.length === 8) {
      return DEFAULT_COUNTRY + ddd + number;
    }
    return null;
  }
  if (rest.length === 10) {
    // Sem 9: adiciona 9 depois do DDD
    const ddd = rest.slice(0, 2);
    const number = rest.slice(2);
    if (number.length === 8) {
      return DEFAULT_COUNTRY + ddd + '9' + number;
    }
    return null;
  }
  return null;
}

/**
 * Gera todas as variações candidatas para fuzzy match. Ordem:
 *   1. canonical
 *   2. alternativa com/sem 9
 *   3. últimos 8 dígitos + DDD (fallback p/ formatações esquisitas)
 *
 * Use em queries `where('contactExternalId', 'in', candidates(canon))` ou em
 * loops de comparação cliente-side.
 */
export function brPhoneCandidates(input: string | null | undefined): string[] {
  const canonical = canonicalizeBr(input);
  if (!canonical) return [];
  const out = new Set<string>([canonical]);
  const alt = alternativeBrPhone(canonical);
  if (alt) out.add(alt);
  // Fallback: últimos 8 dígitos
  if (canonical.length >= 10) {
    out.add(canonical.slice(-8));
  }
  return Array.from(out);
}

/**
 * True se dois telefones referem-se à mesma identidade (após canonicalização BR).
 */
export function brPhonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const candidatesA = new Set(brPhoneCandidates(a));
  const candidatesB = brPhoneCandidates(b);
  return candidatesB.some((c) => candidatesA.has(c));
}
