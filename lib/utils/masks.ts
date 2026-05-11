/**
 * Ponto de entrada canônico de máscaras de input do projeto.
 *
 * Re-exporta as máscaras de identificadores (CPF, CNPJ, telefone, CEP) de
 * `fiscal-masks.ts` e adiciona máscaras de valores monetários e percentuais.
 *
 * Use SEMPRE este arquivo em código novo:
 *   import { maskCpfCnpj, maskPhone, maskMoney, unmaskDigits } from '@/lib/utils/masks';
 *
 * `fiscal-masks.ts` continua existindo pra retrocompat (já é importado em
 * vários módulos) — não deletar sem migração coordenada.
 *
 * Padrão de uso em inputs controlados:
 *   <input value={value} onChange={e => setValue(maskMoney(e.target.value))} />
 *   // No submit: const numeric = unmaskMoney(value);
 */

export {
  unmaskDigits,
  maskCpfCnpj,
  maskCpf,
  maskCnpj,
  maskPhone,
  maskCep,
} from './fiscal-masks';

// ── Dinheiro ────────────────────────────────────────────────────────────────

/**
 * Máscara de moeda BRL pra inputs digitados. O usuário digita só dígitos —
 * a máscara trata os 2 últimos como centavos.
 *
 * Exemplos:
 *   maskMoney('1')      → '0,01'
 *   maskMoney('150')    → '1,50'
 *   maskMoney('150050') → '1.500,50'
 *   maskMoney('')       → ''
 *
 * Retorna string vazia se não houver dígitos — útil pra placeholder vazio.
 * NÃO inclui prefixo "R$ "; deixe o prefixo como adornment do TextField.
 */
export function maskMoney(value: string | number): string {
  if (typeof value === 'number') {
    if (!isFinite(value) || value === 0) return '';
    return value.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  const num = parseInt(digits, 10) / 100;
  // Trata "0,00" como vazio pra evitar input travado em zero — usuário que
  // apaga via backspace conseguiria zerar, mas com '0,00' sticky o estado
  // não muda em backspace e o campo fica preso. Retornar '' libera o reset.
  if (num === 0) return '';
  return num.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Converte string mascarada de volta pra número.
 * Aceita '1.500,50' → 1500.5 | '0,00' → 0 | '' → 0 | 'R$ 100,00' → 100
 *
 * Preserva sinal negativo se a string começa com '-' (após trim) — necessário
 * pro round-trip de saldos negativos (ex: bankBalance pode ser negativo).
 */
export function unmaskMoney(value: string): number {
  if (!value) return 0;
  const isNegative = value.trim().startsWith('-');
  const digits = value.replace(/\D/g, '');
  if (!digits) return 0;
  const num = parseInt(digits, 10) / 100;
  return isNegative ? -num : num;
}

// ── Percentual ──────────────────────────────────────────────────────────────

/**
 * Máscara de percentual com 2 casas decimais. Não inclui o símbolo '%';
 * use como suffix adornment.
 *
 * Exemplos:
 *   maskPercent('5')    → '0,05'
 *   maskPercent('500')  → '5,00'
 *   maskPercent('1250') → '12,50'
 */
export function maskPercent(value: string | number): string {
  return maskMoney(value);
}

/** Inverso de `maskPercent` — retorna número (5,00 → 5). */
export function unmaskPercent(value: string): number {
  return unmaskMoney(value);
}
