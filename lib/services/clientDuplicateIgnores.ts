/**
 * lib/services/clientDuplicateIgnores.ts
 *
 * Persiste em Firestore os pares de clientes que o operador marcou como
 * "não-duplicata" no MergeModal. Sem isso, `dismissed` era state local do
 * modal e o par voltava a aparecer ao reabrir.
 *
 * Padrão R1 (CLAUDE.md): coleção raiz `clientDuplicateIgnores` com
 * `businessId` em todo doc + filtro `where('businessId','==',...)` em toda
 * query. Cross-tenant garantido pelas Firestore rules e pelo guard manual
 * em queries.
 *
 * Idempotência: doc id é `${businessId}_${pairKey}` (determinístico).
 * Clicar "Ignorar" no mesmo par duas vezes não duplica registro nem
 * dispara onSnapshot espúrio. setDoc com merge:false sobrescreve, mas
 * como o conteúdo é o mesmo, é no-op funcional.
 */

import {
  collection,
  doc,
  query,
  where,
  onSnapshot,
  setDoc,
  deleteDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import type { ClientDuplicateIgnore } from '@/lib/types';

/** Constrói a chave estável do par. Ordena os ids pra que (A,B) e (B,A)
 *  resultem no mesmo doc id. */
export function pairKeyOf(idA: string, idB: string): string {
  return [idA, idB].sort().join('|');
}

/** Doc id = `${businessId}_${pairKey}`. Inclui businessId pra defesa em
 *  profundidade contra colisão entre tenants (em teoria a rule já protege,
 *  mas custa nada). */
function ignoreDocId(businessId: string, pairKey: string): string {
  return `${businessId}_${pairKey}`;
}

/**
 * Assina mudanças em tempo real dos ignores do tenant. Retorna unsubscribe
 * pra cleanup no useEffect.
 *
 * Usa onSnapshot (não query+cache) porque o estado precisa refletir
 * inserções/remoções em segundos pra que o badge "Duplicatas N" no header
 * atualize logo após clicar Ignorar/Desfazer.
 */
export function subscribeClientDuplicateIgnores(
  businessId: string,
  onChange: (items: ClientDuplicateIgnore[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'clientDuplicateIgnores'),
    where('businessId', '==', businessId),
  );
  return onSnapshot(q, (snap) => {
    const items: ClientDuplicateIgnore[] = snap.docs.map((d) => ({
      ...(d.data() as Omit<ClientDuplicateIgnore, 'id'>),
      id: d.id,
    }));
    onChange(items);
  });
}

/** Marca um par como ignorado. Idempotente — chamar duas vezes é no-op. */
export async function addClientDuplicateIgnore(params: {
  businessId: string;
  clientIdA: string;
  clientIdB: string;
  user: { id: string; name: string };
}): Promise<void> {
  const pairKey = pairKeyOf(params.clientIdA, params.clientIdB);
  const id = ignoreDocId(params.businessId, pairKey);
  const payload: Omit<ClientDuplicateIgnore, 'id'> = {
    businessId: params.businessId,
    pairKey,
    clientIdA: params.clientIdA,
    clientIdB: params.clientIdB,
    ignoredBy: params.user.id,
    ignoredByName: params.user.name,
    ignoredAt: new Date().toISOString(),
  };
  await setDoc(doc(db, 'clientDuplicateIgnores', id), payload);
}

/** Remove ignore pelo ID do doc. Para "Desfazer ignore". */
export async function removeClientDuplicateIgnore(id: string): Promise<void> {
  await deleteDoc(doc(db, 'clientDuplicateIgnores', id));
}
