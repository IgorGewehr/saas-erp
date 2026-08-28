import type { Firestore } from 'firebase-admin/firestore';
import type { StockMovement } from '@/lib/types';
import {
  decodeFirestorePageCursor,
  encodeFirestorePageCursor,
} from '@/lib/services/firestore-page-cursor';

export interface StockMovementPage {
  movements: StockMovement[];
  hasMore: boolean;
  nextCursor: string | null;
}

export async function listStockMovementsAdmin(params: {
  db: Firestore;
  businessId: string;
  cursor?: string | null;
  limit?: number;
}): Promise<StockMovementPage> {
  const pageSize = Math.min(Math.max(params.limit ?? 100, 1), 200);
  const cursor = decodeFirestorePageCursor(params.cursor);
  if (params.cursor && !cursor) throw new Error('Cursor de movimentações inválido.');

  let query: FirebaseFirestore.Query = params.db
    .collection('stockMovements')
    .where('businessId', '==', params.businessId)
    .orderBy('createdAt', 'desc')
    .orderBy('__name__', 'desc')
    .limit(pageSize + 1);
  if (cursor) query = query.startAfter(cursor.sortValue, cursor.documentId);

  const snapshot = await query.get();
  const hasMore = snapshot.docs.length > pageSize;
  const documents = snapshot.docs.slice(0, pageSize);
  const movements = documents.map((document) => ({
    ...(document.data() as StockMovement),
    id: document.id,
  }));
  const last = documents.at(-1);
  return {
    movements,
    hasMore,
    nextCursor: hasMore && last
      ? encodeFirestorePageCursor({
          sortValue: String(last.data().createdAt ?? ''),
          documentId: last.id,
        })
      : null,
  };
}
