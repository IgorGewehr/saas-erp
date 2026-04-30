/**
 * Helpers de normalização de telefone brasileiro.
 *
 * Contexto: WhatsApp armazena números BR de duas formas — com ou sem o
 * "9" inicial obrigatório de celular (introduzido pela ANATEL em 2014).
 * Mesmo número físico pode aparecer como:
 *   - 5554996785446  (13 dígitos: 55 + DDD 54 + 9 + 9678-5446)
 *   - 555496785446   (12 dígitos: 55 + DDD 54 + 9678-5446, sem o 9 extra)
 *
 * Diferentes APIs (Meta Cloud, Baileys, contatos importados) podem usar
 * formatos diferentes. Esses helpers permitem busca cruzada nos canais.
 */

/**
 * Retorna o formato alternativo do telefone BR (com ou sem o 9 inicial).
 * Retorna `null` se não for BR ou não for um celular reconhecível.
 *
 * Aceita só dígitos (sem `+`, sem espaços). Faça `.replace(/\D/g, '')` antes.
 *
 * Exemplos:
 *   getAlternativeBrazilianPhone('5554996785446') → '555496785446'
 *   getAlternativeBrazilianPhone('555496785446')  → '5554996785446'
 *   getAlternativeBrazilianPhone('5511999998888') → '551199998888' (mas inválido — fixo BR não tem isso)
 *   getAlternativeBrazilianPhone('15551234567')   → null (US, sem 55)
 */
export function getAlternativeBrazilianPhone(phone: string): string | null {
  if (!phone || !phone.startsWith('55')) return null;
  const withoutCountry = phone.substring(2);
  if (withoutCountry.length < 10) return null;
  const ddd = withoutCountry.substring(0, 2);
  const number = withoutCountry.substring(2);
  // 8 dígitos: número antigo, gera versão com 9 inicial (celular)
  if (number.length === 8) {
    return `55${ddd}9${number}`;
  }
  // 9 dígitos começando com 9: celular novo, gera versão sem o 9
  if (number.length === 9 && number.startsWith('9')) {
    return `55${ddd}${number.substring(1)}`;
  }
  return null;
}
