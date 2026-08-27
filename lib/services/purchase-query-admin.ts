import type { Firestore } from 'firebase-admin/firestore';
import type { PurchaseNote, PurchaseNoteStatus } from '@/lib/types';

export interface PurchaseNoteListResult {
  notes: PurchaseNote[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
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
}): Promise<PurchaseNoteListResult> {
  const limit = Math.min(Math.max(params.limit ?? 30, 1), 100);
  const offset = Math.min(Math.max(params.offset ?? 0, 0), 1000);
  let query: FirebaseFirestore.Query = params.db
    .collection('purchaseNotes')
    .where('businessId', '==', params.businessId);
  if (params.status) query = query.where('status', '==', params.status);
  if (params.supplierId) query = query.where('supplierId', '==', params.supplierId);

  const snapshot = await query.orderBy('issueDate', 'desc').limit(offset + limit + 1).get();
  const rows = snapshot.docs.map((document) => ({
    ...(document.data() as PurchaseNote),
    id: document.id,
  }));
  return {
    notes: rows.slice(offset, offset + limit),
    pagination: { limit, offset, hasMore: rows.length > offset + limit },
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
