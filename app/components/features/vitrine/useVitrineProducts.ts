'use client';

import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import type { Product } from '@/lib/types';
import { isCatalogProduct } from '@/lib/utils/vitrineCatalog';

/**
 * As abas do shell ficam montadas depois de abertas — sem `enabled` o listener
 * seguiria lendo o catálogo inteiro com a Vitrine escondida. Ao desativar, mantém
 * o que já carregou (reabrir a aba não pisca vazio) e só reassina quando voltar.
 */
export function useVitrineProducts(businessId: string | undefined, enabled: boolean) {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    if (!businessId) {
      setIsLoading(false);
      return;
    }

    // Single-field query, mesmo teto de segurança do PDV/Vendas (sem índice composto).
    const catalogQuery = query(collection(db, 'products'), where('businessId', '==', businessId), limit(2000));
    const unsubscribe = onSnapshot(catalogQuery, (snapshot) => {
      setProducts(
        snapshot.docs
          .map((doc) => ({ ...doc.data(), id: doc.id }) as Product)
          .filter(isCatalogProduct)
          .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR')),
      );
      setIsLoading(false);
    }, (error) => {
      console.error('[Vitrine] products snapshot error:', error);
      setIsLoading(false);
    });
    return unsubscribe;
  }, [businessId, enabled]);

  return { products, isLoading };
}
