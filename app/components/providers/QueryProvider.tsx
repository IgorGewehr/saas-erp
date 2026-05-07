'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, ReactNode } from 'react';

/**
 * Defaults globais do TanStack Query.
 *
 * Decisões críticas pra resolver staleness em multi-user (refactor de
 * sincronização):
 *
 * - `staleTime: 30s` — antes era 5min. Mudança feita por colega só era
 *   visível depois de 5min OU mutação local. Agora 30s mantém balance
 *   entre custo (refetch frequente) e percepção de live (~30s pior caso
 *   sem foco). Telas críticas (Senhas/Clientes) usam `onSnapshot` direto
 *   pra real-time verdadeiro — esse staleTime serve pras coleções "frias"
 *   (Reports, Dashboard, listings auxiliares).
 *
 * - `refetchOnWindowFocus: true` — refetch automático ao voltar pra aba.
 *   Cobre o cenário "operador deixou aba aberta a tarde toda, voltou e
 *   continua vendo dados de manhã". Antes estava `false` (default era OFF
 *   por algum motivo histórico — provavelmente pra evitar refetch agressivo
 *   no dev, mas em prod o tradeoff inverte).
 *
 * - `refetchOnMount: true` (default explícito) — refetcha ao montar SE o
 *   dado está stale (idade > staleTime). Combinado com staleTime: 30s,
 *   cobre o cenário multi-user sem refetch redundante. Considerei `'always'`
 *   (refetch a cada montagem ignorando staleTime) mas é overkill: causa
 *   reads desnecessárias quando user navega entre páginas em <30s, e
 *   refetchOnWindowFocus já garante atualização ao voltar de outra aba.
 *
 * - `retry: 1` mantido — Firestore raramente falha; 1 retry cobre flakiness.
 *
 * Telas que precisam de tempo-real verdadeiro (não só ao mount/foco) usam
 * onSnapshot direto, sobrescrevendo esses defaults.
 */
export default function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,           // 30s (era 5min)
            refetchOnWindowFocus: true,     // (era false)
            refetchOnMount: true,           // default (refetch só se stale)
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
