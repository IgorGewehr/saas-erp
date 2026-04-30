/**
 * Detecção de keywords de opt-out em mensagens inbound (WhatsApp).
 *
 * Conformidade LGPD/GDPR: usuário deve poder se descadastrar via canal
 * usado para o broadcast. Para WhatsApp, padrão de mercado é responder
 * com palavras-chave (PARAR, STOP, etc.).
 *
 * A detecção é tolerante a:
 *  - case-insensitive ("Parar" = "PARAR" = "parar")
 *  - whitespace ao redor ("  STOP  ")
 *  - acentuação ("não", "nao")
 *
 * Mas é restritiva quanto a contexto: o texto INTEIRO precisa ser a
 * keyword (não apenas conter). "Pare de mandar mensagem" NÃO ativa —
 * apenas "PARE" sozinho. Evita false positives em conversas legítimas.
 */

const OPT_OUT_KEYWORDS = new Set([
  // Português
  'parar', 'pare', 'sair', 'cancelar', 'descadastrar', 'descadastro',
  'remover', 'remova', 'nao', 'não',
  // Inglês (clientes internacionais)
  'stop', 'unsubscribe', 'cancel', 'remove', 'optout', 'opt-out',
]);

/**
 * Retorna true se o texto inteiro (após normalização) é uma keyword
 * de descadastro. Strings vazias ou não-texto retornam false.
 */
export function isOptOutKeyword(text: string | null | undefined): boolean {
  if (!text || typeof text !== 'string') return false;
  const normalized = text
    .trim()
    .toLowerCase()
    // Remove pontuação ao redor (".", "!", "?")
    .replace(/^[.!?,;:]+|[.!?,;:]+$/g, '')
    .trim();
  if (!normalized) return false;
  // Texto curto demais ou longo demais não é considerado (evita typos massivos)
  if (normalized.length > 30) return false;
  return OPT_OUT_KEYWORDS.has(normalized);
}
