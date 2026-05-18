/**
 * Detecta se a janela de 24h da WhatsApp Cloud API esta aberta para um contato.
 *
 * Regra Meta: mensagens de texto livre (`type: 'text'`) so podem ser enviadas
 * ate 24h depois da ULTIMA mensagem INBOUND do contato. Fora dessa janela,
 * a API rejeita com erro 131047 ("outside 24h window, use template") e a
 * mensagem precisa ser enviada como template aprovado (`type: 'template'`).
 *
 * Baileys (WhatsApp Web nao-oficial) nao tem janela 24h — funciona sempre.
 * Os callers devem checar o transporte antes de aplicar esta logica.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000; // 24h em ms

/** True quando o ultimo inbound do contato esta a mais de 24h atras (ou
 *  inexistente). Trate `lastInboundAt = undefined/null` como FORA da janela —
 *  sem inbound conhecido, nao da pra garantir que esta aberta. */
export function isOutsideMetaWindow(
  lastInboundAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastInboundAt) return true;
  const last = new Date(lastInboundAt).getTime();
  if (!isFinite(last)) return true;
  return now.getTime() - last > WINDOW_MS;
}
