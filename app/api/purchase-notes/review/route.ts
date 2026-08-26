import { NextResponse, type NextRequest } from 'next/server';
import { ReviewPurchaseNoteRequestSchema } from '@/lib/contracts/api/purchase-note-review';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { PurchaseNoteNotReviewableError, reviewPurchaseNoteAdmin } from '@/lib/services/purchase-import-admin';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { isAuthError, verifyAuth } from '@/lib/utils/verifyAuth';

function error(message: string, status: number, code?: string) {
  return NextResponse.json({ ok: false, error: message, ...(code ? { code } : {}) }, { status });
}

export async function PATCH(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = ReviewPurchaseNoteRequestSchema.safeParse(raw);
  if (!parsed.success) return error(`Revisão inválida: ${JSON.stringify(parsed.error.flatten())}`, 400, 'INVALID_REVIEW');
  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.manager) return error('Sem permissão para revisar compras.', 403);
  try {
    const note = await reviewPurchaseNoteAdmin({
      db: adminDb,
      businessId: auth.businessId,
      noteId: parsed.data.noteId,
      items: parsed.data.items,
      notes: parsed.data.notes,
      actor: { uid: auth.uid, name: auth.name },
    });
    return NextResponse.json({ ok: true, data: note });
  } catch (cause) {
    if (cause instanceof PurchaseNoteNotReviewableError) return error(cause.message, 409, 'NOTE_NOT_REVIEWABLE');
    if (cause instanceof Error && cause.name === 'ZodError') return error(`Revisão inválida: ${cause.message}`, 400, 'INVALID_REVIEW');
    console.error('[purchase-notes/review] failed', cause);
    return error('Não foi possível salvar a revisão.', 500);
  }
}
