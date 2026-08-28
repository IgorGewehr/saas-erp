export interface FirestorePageCursor {
  sortValue: string;
  documentId: string;
}

export function encodeFirestorePageCursor(cursor: FirestorePageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeFirestorePageCursor(value?: string | null): FirestorePageCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<FirestorePageCursor>;
    if (typeof parsed.sortValue !== 'string' || typeof parsed.documentId !== 'string') return null;
    if (!parsed.sortValue || !parsed.documentId) return null;
    return { sortValue: parsed.sortValue, documentId: parsed.documentId };
  } catch {
    return null;
  }
}
