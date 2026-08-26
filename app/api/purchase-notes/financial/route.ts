import { NextResponse, type NextRequest } from 'next/server';
import { LinkPurchaseFinancialRequestSchema } from '@/lib/contracts/api/purchase-note-financial';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  linkPurchaseFinancialAdmin,
  PurchaseFinancialConflictError,
  PurchaseFinancialNotReadyError,
  PurchaseFinancialReferenceError,
} from '@/lib/services/purchase-financial-admin';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { isAuthError, verifyAuth } from '@/lib/utils/verifyAuth';

function error(message: string, status: number, code?: string) {
  return NextResponse.json({ ok: false, error: message, ...(code ? { code } : {}) }, { status });
}

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = LinkPurchaseFinancialRequestSchema.safeParse(raw);
  if (!parsed.success) return error('Vínculo financeiro inválido.', 400, 'INVALID_FINANCIAL_LINK');
  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.manager) {
    return error('Sem permissão para vincular compras ao financeiro.', 403);
  }
  try {
    const result = await linkPurchaseFinancialAdmin({
      db: adminDb,
      businessId: auth.businessId,
      noteId: parsed.data.noteId,
      intent: parsed.data,
      actor: { uid: auth.uid, name: auth.name },
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (cause) {
    if (cause instanceof PurchaseFinancialConflictError) return error(cause.message, 409, 'FINANCIAL_CONFLICT');
    if (cause instanceof PurchaseFinancialNotReadyError) return error(cause.message, 409, 'NOTE_NOT_READY');
    if (cause instanceof PurchaseFinancialReferenceError) return error(cause.message, 409, 'INVALID_BANK_ACCOUNT');
    console.error('[purchase-notes/financial] failed', cause);
    return error('Não foi possível vincular a compra ao financeiro.', 500);
  }
}
