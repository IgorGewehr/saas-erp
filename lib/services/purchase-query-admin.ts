import type { Firestore } from 'firebase-admin/firestore';
import type { PurchaseNote, PurchaseNoteStatus } from '@/lib/types';
import {
  decodeFirestorePageCursor,
  encodeFirestorePageCursor,
} from '@/lib/services/firestore-page-cursor';

export interface PurchaseNoteListResult {
  notes: PurchaseNote[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export async function getPurchaseNoteAdmin(params: {
  db: Firestore;
  businessId: string;
  noteId: string;
}): Promise<PurchaseNote | null> {
  if (!params.noteId) throw new Error('noteId required');
  const snapshot = await params.db.collection('purchaseNotes').doc(params.noteId).get();
  if (!snapshot.exists || snapshot.data()?.businessId !== params.businessId) return null;
  return { ...(snapshot.data() as PurchaseNote), id: snapshot.id };
}

export async function listPurchaseNotesAdmin(params: {
  db: Firestore;
  businessId: string;
  status?: PurchaseNoteStatus;
  supplierId?: string;
  limit?: number;
  offset?: number;
  cursor?: string | null;
}): Promise<PurchaseNoteListResult> {
  const limit = Math.min(Math.max(params.limit ?? 30, 1), 100);
  const offset = Math.min(Math.max(params.offset ?? 0, 0), 1000);
  const cursor = decodeFirestorePageCursor(params.cursor);
  if (params.cursor && !cursor) throw new Error('Cursor de notas inválido.');
  let query: FirebaseFirestore.Query = params.db
    .collection('purchaseNotes')
    .where('businessId', '==', params.businessId);
  if (params.status) query = query.where('status', '==', params.status);
  if (params.supplierId) query = query.where('supplierId', '==', params.supplierId);

  query = query.orderBy('issueDate', 'desc').orderBy('__name__', 'desc');
  if (cursor) query = query.startAfter(cursor.sortValue, cursor.documentId);
  else if (offset) query = query.offset(offset);
  const snapshot = await query.limit(limit + 1).get();
  const hasMore = snapshot.docs.length > limit;
  const documents = snapshot.docs.slice(0, limit);
  const rows = documents.map((document) => ({
    ...(document.data() as PurchaseNote),
    id: document.id,
  }));
  const last = documents.at(-1);
  return {
    notes: rows,
    pagination: {
      limit,
      offset,
      hasMore,
      nextCursor: hasMore && last
        ? encodeFirestorePageCursor({
            sortValue: String(last.data().issueDate ?? ''),
            documentId: last.id,
          })
        : null,
    },
  };
}

export function publicPurchaseNote(note: PurchaseNote): PurchaseNote {
  const sanitized = { ...note } as PurchaseNote & Record<string, unknown>;
  delete sanitized.xml;
  delete sanitized.xmlUrl;
  delete sanitized.xmlStoragePath;
  delete sanitized.importClaim;
  delete sanitized.reversalClaim;
  return sanitized;
}
