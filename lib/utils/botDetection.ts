/**
 * Heurística pra detectar quando um inbound de contato é auto-reply (bot
 * de atendimento, "mensagem de ausência" do WhatsApp Business, etc.) em
 * vez de resposta humana real.
 *
 * Combina dois sinais com OR (qualquer um flagra):
 *
 *  1. Tempo < 5s entre nosso último outbound e o inbound. Humanos raramente
 *     conseguem digitar mesmo um "ok" em menos disso, mesmo com a notificação
 *     na tela. Bots respondem em 500ms-2s tipicamente. Conservador (5s) pra
 *     ainda pegar bots ligeiramente lentos sem capturar humanos digitando
 *     uma palavra única.
 *
 *  2. Match com padrões conhecidos de auto-reply (regex case-insensitive).
 *     Independente do tempo — auto-replies longos podem demorar minutos
 *     pra disparar (rate-limited do lado deles), e queremos pegar mesmo
 *     assim. Lista cresce conforme observamos novos templates em produção.
 *
 * Decisão de design: NÃO usar tamanho da mensagem como sinal — muitos
 * auto-replies brasileiros são longos (descrição completa do horário,
 * canal alternativo, etc.) e cortar por tamanho gerava falsos negativos.
 */

/** Padrões textuais comuns em respostas automáticas brasileiras. */
const BOT_REPLY_PATTERNS: readonly RegExp[] = [
  /mensagem autom[aá]tica/i,
  /resposta autom[aá]tica/i,
  /auto[-\s]?resposta/i,
  /fora do hor[aá]rio/i,
  /hor[aá]rio de atendimento/i,
  /n[aã]o estamos dispon[ií]veis/i,
  /n[aã]o estamos online/i,
  /responderemos.{0,30}breve/i,
  /retornaremos.{0,30}(breve|contato)/i,
  /entraremos em contato/i,
  /agradecemos.{0,20}contato/i,
  /em breve.{0,30}atendente/i,
  /atendente.{0,30}em breve/i,
  /\br[oó]b[oô]\b/i,
  /\bbot\b/i,
  /obrigado por entrar em contato/i,
  /recebemos sua mensagem/i,
  /aguarde.{0,20}retorno/i,
  /retornaremos.{0,20}assim que poss[ií]vel/i,
];

const QUICK_REPLY_THRESHOLD_MS = 5_000;

export interface DetectBotReplyParams {
  /** Conteúdo textual da mensagem do contato. */
  content: string;
  /** Timestamp da mensagem inbound (ms epoch). */
  msgTimestampMs: number;
  /** Timestamp do último outbound nosso ANTES desse inbound, ou null se
   *  não houver (ex: conversa iniciada pelo próprio contato). */
  prevOutboundAtMs: number | null;
}

export function detectLikelyBotReply({ content, msgTimestampMs, prevOutboundAtMs }: DetectBotReplyParams): boolean {
  const delta = prevOutboundAtMs != null ? msgTimestampMs - prevOutboundAtMs : null;
  const isQuickReply = delta != null && delta >= 0 && delta < QUICK_REPLY_THRESHOLD_MS;
  const hasBotPhrase = !!content && BOT_REPLY_PATTERNS.some(rx => rx.test(content));
  return isQuickReply || hasBotPhrase;
}

/** Exposto pra testes e backfill — não usar diretamente em runtime. */
export const _BOT_REPLY_PATTERNS_FOR_TESTING = BOT_REPLY_PATTERNS;
export const _QUICK_REPLY_THRESHOLD_MS_FOR_TESTING = QUICK_REPLY_THRESHOLD_MS;
