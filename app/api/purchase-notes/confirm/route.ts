import { NextResponse, type NextRequest } from 'next/server';
import { ConfirmPurchaseNoteRequestSchema } from '@/lib/contracts/api/purchase-note-confirm';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  confirmPurchaseNoteAdmin,
  PurchaseNoteClaimConflictError,
  PurchaseNoteNotReadyError,
} from '@/lib/services/purchase-import-admin';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { isAuthError, verifyAuth } from '@/lib/utils/verifyAuth';

function error(message: string, status: number, code?: string) {
  return NextResponse.json({ ok: false, error: message, ...(code ? { code } : {}) }, { status });
}

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = ConfirmPurchaseNoteRequestSchema.safeParse(raw);
  if (!parsed.success) return error('Confirmação inválida.', 400, 'INVALID_CONFIRMATION');
  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.manager) {
    return error('Sem permissão para confirmar compras.', 403);
  }
  try {
    const result = await confirmPurchaseNoteAdmin({
      db: adminDb,
      businessId: auth.businessId,
      noteId: parsed.data.noteId,
      actor: { uid: auth.uid, name: auth.name },
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (cause) {
    if (cause instanceof PurchaseNoteClaimConflictError) return error(cause.message, 409, 'CONFIRMATION_IN_PROGRESS');
    if (cause instanceof PurchaseNoteNotReadyError) return error(cause.message, 409, 'NOTE_NOT_READY');
    console.error('[purchase-notes/confirm] failed', cause);
    return error('Não foi possível confirmar a entrada da compra.', 500);
  }
}
