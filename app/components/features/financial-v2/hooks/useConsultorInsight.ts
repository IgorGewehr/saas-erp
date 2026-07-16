'use client';

/**
 * useConsultorInsight — fiação client do Super Consultor (financial-v2/§5).
 *
 * A UI nunca espera rede: renderiza `insight.templateFallback` na hora e troca
 * pela frase da IA quando (e se) `/api/financial/consultor` responder — cache
 * TanStack com staleTime Infinity por factsHash (os mesmos facts nunca geram
 * 2 chamadas). Falha de rede/LLM é sempre absorvida no server (nunca chega
 * como erro aqui) — mas cobrimos timeout/offline com o mesmo fallback.
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { usePeriod } from '../state/PeriodContext';
import { hashFacts, type ConsultorInsight } from '../read-models/consultor-rules';
import {
  buildFinancialInsightCacheKey,
  type FinancialConsultorResponse,
} from '@/lib/contracts/api/financial/consultor';

export interface ConsultorLineData {
  phrase: string;
  source: 'llm' | 'template' | 'cache' | 'pending';
  cta?: ConsultorInsight['cta'];
}

export function useConsultorInsight(insight: ConsultorInsight): ConsultorLineData {
  const { business } = useAuth();
  const { period } = usePeriod();
  const factsHash8 = hashFacts(insight.facts);

  const { data } = useQuery({
    queryKey: ['fin2-consultor', business?.id, insight.tab, period, insight.ruleId, factsHash8],
    queryFn: async (): Promise<FinancialConsultorResponse> => {
      const { getAuth } = await import('firebase/auth');
      const token = await getAuth().currentUser?.getIdToken();
      if (!token || !business?.id) {
        return { phrase: insight.templateFallback, source: 'template', ruleId: insight.ruleId };
      }

      const cacheKey = buildFinancialInsightCacheKey({
        businessId: business.id,
        tab: insight.tab,
        period,
        ruleId: insight.ruleId,
        factsHash8,
      });

      const res = await fetch('/api/financial/consultor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Idempotency-Key': cacheKey,
        },
        body: JSON.stringify({
          tab: insight.tab,
          period,
          ruleId: insight.ruleId,
          facts: insight.facts,
          templateFallback: insight.templateFallback,
        }),
      });

      if (!res.ok) {
        return { phrase: insight.templateFallback, source: 'template', ruleId: insight.ruleId };
      }
      return res.json() as Promise<FinancialConsultorResponse>;
    },
    enabled: !!business?.id,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  return {
    phrase: data?.phrase ?? insight.templateFallback,
    source: data?.source ?? 'pending',
    cta: insight.cta,
  };
}
