/**
 * Helpers de normalização de telefone brasileiro.
 *
 * SDD: este arquivo agora é um WRAPPER fino sobre
 * `lib/contracts/_runtime/phone-br.ts` (fonte da verdade).
 * Mantemos `getAlternativeBrazilianPhone` exportada para não quebrar os callers
 * existentes — eles serão migrados gradualmente para `brPhoneCandidates`/`brPhonesMatch`.
 *
 * Reexporta também as funções novas pra facilitar a migração.
 */

import { alternativeBrPhone } from '@/contracts/_runtime/phone-br';

/**
 * Retorna o formato alternativo do telefone BR (com ou sem o 9 inicial).
 * Aceita apenas dígitos (sem `+`, sem espaços).
 *
 * @deprecated Use `brPhoneCandidates(phone)` de `@/contracts/_runtime/phone-br`
 *             — retorna todas as variações em um array, mais robusto.
 */
export function getAlternativeBrazilianPhone(phone: string): string | null {
  if (!phone) return null;
  return alternativeBrPhone(phone);
}

export { brPhoneCandidates, brPhonesMatch, canonicalizeBr } from '@/contracts/_runtime/phone-br';
