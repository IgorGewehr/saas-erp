'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import type { Client } from '@/lib/types';
import { isActiveClient } from '@/lib/utils/clientFilters';

/** Só assina enquanto o seletor está aberto (`enabled`) — a lista de clientes pode ser grande. */
export function useVitrineClients(businessId: string | undefined, enabled: boolean) {
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    if (!businessId) {
      setIsLoading(false);
      return;
    }

    const clientsQuery = query(collection(db, 'clients'), where('businessId', '==', businessId));
    const unsubscribe = onSnapshot(clientsQuery, (snapshot) => {
      setClients(
        snapshot.docs
          .map((doc) => ({ ...doc.data(), id: doc.id }) as Client)
          .filter(isActiveClient)
          .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR')),
      );
      setIsLoading(false);
    }, (error) => {
      console.error('[Vitrine] clients snapshot error:', error);
      setIsLoading(false);
    });
    return unsubscribe;
  }, [businessId, enabled]);

  return { clients, isLoading };
}
