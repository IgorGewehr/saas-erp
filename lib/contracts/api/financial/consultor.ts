/**
 * lib/contracts/api/financial/consultor.ts — contrato do Super Consultor (financial-v2)
 *
 * Princípio (financiero-ia-plano.md §D.3, adaptado no saas-erp-financeiro-plano.md §5):
 * o motor de regras DETERMINÍSTICO roda no client sobre os read-models (ver
 * `read-models/consultor-rules.ts` em financial-v2) e escolhe 1 fato prioritário.
 * Esta rota apenas FRASEIA o fato via OpenAI — nunca decide o quê dizer nem a
 * navegação do CTA. `businessId` vem do token verificado (verifyAuth), nunca
 * do body (R1/R6).
 *
 * Idempotência (R3): a chave de cache `financialInsightCache/{businessId}_{tab}_
 * {period}_{ruleId}_{factsHash8}` é determinística a partir do request — reenviar
 * o mesmo request nunca duplica custo de LLM nem grava duas vezes.
 */

import { z } from 'zod';

// ─── Abas com linha do Super Consultor ───────────────────────────────────────
// Relatórios é a única aba do plano sem consultor (documento/consulta, não decisão).
export const FINANCIAL_CONSULTOR_TABS = [
  'visao-geral',
  'entradas-saidas',
  'recorrentes',
  'bancario',
  'assinaturas',
  'fluxo-caixa',
] as const;
export const FinancialConsultorTabSchema = z.enum(FINANCIAL_CONSULTOR_TABS);
export type FinancialConsultorTab = z.infer<typeof FinancialConsultorTabSchema>;

// ─── Facts ────────────────────────────────────────────────────────────────────
// Chaves curtas, valores já agregados (números/strings formatadas). Nunca nomes
// de cliente/pessoa — o consultor fala de números, não de identidade (privacidade
// + o LLM nunca deveria precisar de PII pra frasear um fato agregado).
export const FINANCIAL_CONSULTOR_FACT_KEY_DENYLIST = [
  'clientName', 'clientId', 'contactName', 'customerName', 'name',
  'email', 'phone', 'cpf', 'cnpj',
] as const;

export const ConsultorFactsSchema = z
  .record(z.string().min(1).max(40), z.union([z.string().max(120), z.number()]))
  .refine((obj) => Object.keys(obj).length > 0, 'facts não pode ser vazio')
  .refine((obj) => Object.keys(obj).length <= 12, 'facts: no máximo 12 chaves')
  .superRefine((obj, ctx) => {
    for (const key of Object.keys(obj)) {
      if ((FINANCIAL_CONSULTOR_FACT_KEY_DENYLIST as readonly string[]).includes(key)) {
        ctx.addIssue({
          code: 'custom',
          message: `facts não pode conter chave identificável de pessoa/cliente: "${key}"`,
          path: [key],
        });
      }
    }
  });
export type ConsultorFacts = z.infer<typeof ConsultorFactsSchema>;

// ─── Request / Response ──────────────────────────────────────────────────────
const PeriodSchema = z.string().regex(/^\d{4}-\d{2}$/, 'Formato YYYY-MM');

export const FinancialConsultorRequestSchema = z.object({
  tab: FinancialConsultorTabSchema,
  period: PeriodSchema,
  ruleId: z.string().min(1).max(60),
  facts: ConsultorFactsSchema,
  /** Frase determinística já renderizada pela UI antes da rede — usada como
   *  referência de conteúdo pro LLM e como retorno garantido em caso de falha. */
  templateFallback: z.string().min(1).max(400),
});
export type FinancialConsultorRequest = z.infer<typeof FinancialConsultorRequestSchema>;

export const FINANCIAL_CONSULTOR_SOURCES = ['llm', 'template', 'cache'] as const;
export const FinancialConsultorSourceSchema = z.enum(FINANCIAL_CONSULTOR_SOURCES);
export type FinancialConsultorSource = z.infer<typeof FinancialConsultorSourceSchema>;

export const FinancialConsultorResponseSchema = z.object({
  phrase: z.string().min(1),
  source: FinancialConsultorSourceSchema,
  ruleId: z.string(),
});
export type FinancialConsultorResponse = z.infer<typeof FinancialConsultorResponseSchema>;

// ─── Cache doc (financialInsightCache/{businessId}_{tab}_{period}_{ruleId}_{factsHash8}) ──
// Gravado apenas server-side (Admin SDK) — nunca lido/escrito pelo client SDK,
// então não entra em firestore.rules (mesmo padrão de agentRateLimits).
export const FinancialInsightCacheDocSchema = z.object({
  businessId: z.string().min(1),
  tab: FinancialConsultorTabSchema,
  period: PeriodSchema,
  ruleId: z.string(),
  factsHash: z.string(),
  phrase: z.string(),
  model: z.string(),
  createdAt: z.string(),
});
export type FinancialInsightCacheDoc = z.infer<typeof FinancialInsightCacheDocSchema>;

/** Monta a chave determinística de cache/idempotência (R3). */
export function buildFinancialInsightCacheKey(params: {
  businessId: string;
  tab: FinancialConsultorTab;
  period: string;
  ruleId: string;
  factsHash8: string;
}): string {
  return `${params.businessId}_${params.tab}_${params.period}_${params.ruleId}_${params.factsHash8}`;
}
