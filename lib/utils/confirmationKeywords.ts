/**
 * Detecção de keywords de confirmação em mensagens inbound (WhatsApp) — M06.5a.
 *
 * Mesmo formato de `lib/utils/optOutKeywords.ts`: tolerante a case/whitespace/
 * pontuação de borda, mas restritivo quanto a contexto — o texto INTEIRO
 * precisa ser a keyword (não apenas conter). "Sim, confirmo às 15h" NÃO
 * ativa — evita confirmar por engano uma resposta que só menciona a palavra.
 *
 * Set deliberadamente pequeno: mesma linguagem que o próprio Agente IA já
 * trata como suficiente pra confirmar (agent/app/graph/prompts.py: "responder
 * 'confirmo/sim'"). Não inclui "ok"/"okay" — genérico demais, alto risco de
 * falso positivo respondendo a algo sem relação com o agendamento.
 */

const CONFIRMATION_KEYWORDS = new Set([
  'confirmo', 'confirmado', 'sim',
]);

/**
 * Retorna true se o texto inteiro (após normalização) é uma keyword de
 * confirmação. Strings vazias ou não-texto retornam false.
 */
export function isConfirmationKeyword(text: string | null | undefined): boolean {
  if (!text || typeof text !== 'string') return false;
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/^[.!?,;:]+|[.!?,;:]+$/g, '')
    .trim();
  if (!normalized) return false;
  if (normalized.length > 30) return false;
  return CONFIRMATION_KEYWORDS.has(normalized);
}
