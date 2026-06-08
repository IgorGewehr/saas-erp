'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, ReactNode } from 'react';

/**
 * Defaults globais do TanStack Query.
 *
 * Estratégia de cache pra reduzir refetch desnecessário (coleções "frias"):
 *
 * - `staleTime: 3min` — dado é considerado fresco por 3 minutos, evitando
 *   refetch redundante quando o user navega entre páginas. Telas que precisam
 *   de tempo-real verdadeiro (Conversas, presença, Senhas/Clientes) usam
 *   `onSnapshot` direto, sobrescrevendo esses defaults — esse staleTime serve
 *   pras coleções "frias" (Reports, Dashboard, listings auxiliares).
 *
 * - `refetchOnWindowFocus: false` — não refetcha ao voltar pra aba. Evita
 *   reads agressivas; as telas live já têm onSnapshot próprio e o staleTime
 *   de 3min cobre a navegação normal.
 *
 * - `refetchOnMount: true` (default explícito) — refetcha ao montar SE o
 *   dado está stale (idade > staleTime). Combinado com staleTime: 3min,
 *   evita reads desnecessárias quando user navega entre páginas em <3min.
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
            staleTime: 3 * 60 * 1000,       // 3min
            refetchOnWindowFocus: false,
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
