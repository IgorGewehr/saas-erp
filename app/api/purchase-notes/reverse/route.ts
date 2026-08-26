import { NextResponse, type NextRequest } from 'next/server';
import { ReversePurchaseNoteRequestSchema } from '@/lib/contracts/api/purchase-note-reverse';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  PurchaseNoteNotReversibleError,
  PurchaseNoteReversalBlockedError,
  PurchaseNoteReversalConflictError,
  reversePurchaseNoteAdmin,
} from '@/lib/services/purchase-import-admin';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { isAuthError, verifyAuth } from '@/lib/utils/verifyAuth';

function error(message: string, status: number, code?: string) {
  return NextResponse.json({ ok: false, error: message, ...(code ? { code } : {}) }, { status });
}

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = ReversePurchaseNoteRequestSchema.safeParse(raw);
  if (!parsed.success) return error('Reversão inválida.', 400, 'INVALID_REVERSAL');
  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.manager) {
    return error('Sem permissão para reverter compras.', 403);
  }
  try {
    const result = await reversePurchaseNoteAdmin({
      db: adminDb,
      businessId: auth.businessId,
      noteId: parsed.data.noteId,
      reason: parsed.data.reason,
      actor: { uid: auth.uid, name: auth.name },
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (cause) {
    if (cause instanceof PurchaseNoteReversalConflictError) return error(cause.message, 409, 'REVERSAL_IN_PROGRESS');
    if (cause instanceof PurchaseNoteReversalBlockedError) return error(cause.message, 409, cause.code);
    if (cause instanceof PurchaseNoteNotReversibleError) return error(cause.message, 409, 'NOTE_NOT_REVERSIBLE');
    console.error('[purchase-notes/reverse] failed', cause);
    return error('Não foi possível reverter a entrada da compra.', 500);
  }
}
