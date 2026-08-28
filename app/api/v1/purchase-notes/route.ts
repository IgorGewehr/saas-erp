import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  PurchaseNoteExternalActionSchema,
  PurchaseNoteExternalListQuerySchema,
} from '@/lib/contracts/api/purchase-note-external';
import { apiError, apiSuccess, isApiKeyError, verifyApiKey } from '@/lib/middleware/apiKeyAuth';
import {
  confirmPurchaseNoteAdmin,
  PurchaseNoteClaimConflictError,
  PurchaseNoteNotReadyError,
  PurchaseNoteNotReversibleError,
  PurchaseNoteReversalBlockedError,
  PurchaseNoteReversalConflictError,
  reversePurchaseNoteAdmin,
} from '@/lib/services/purchase-import-admin';
import {
  linkPurchaseFinancialAdmin,
  PurchaseFinancialConflictError,
  PurchaseFinancialNotReadyError,
  PurchaseFinancialReferenceError,
} from '@/lib/services/purchase-financial-admin';
import {
  getPurchaseNoteAdmin,
  listPurchaseNotesAdmin,
  publicPurchaseNote,
} from '@/lib/services/purchase-query-admin';
import type { ApiKeyScope } from '@/lib/types';

export async function GET(request: NextRequest) {
  const auth = await verifyApiKey(request, ['read:purchases']);
  if (isApiKeyError(auth)) return auth;

  const raw = {
    ...(request.nextUrl.searchParams.get('id') ? { id: request.nextUrl.searchParams.get('id') } : {}),
    ...(request.nextUrl.searchParams.get('status') ? { status: request.nextUrl.searchParams.get('status') } : {}),
    ...(request.nextUrl.searchParams.get('supplierId') ? { supplierId: request.nextUrl.searchParams.get('supplierId') } : {}),
    ...(request.nextUrl.searchParams.get('limit') ? { limit: request.nextUrl.searchParams.get('limit') } : {}),
    ...(request.nextUrl.searchParams.get('offset') ? { offset: request.nextUrl.searchParams.get('offset') } : {}),
    ...(request.nextUrl.searchParams.get('cursor') ? { cursor: request.nextUrl.searchParams.get('cursor') } : {}),
  };
  const parsed = PurchaseNoteExternalListQuerySchema.safeParse(raw);
  if (!parsed.success) return apiError('Invalid purchase note query', 400, parsed.error.flatten());

  try {
    if (parsed.data.id) {
      const note = await getPurchaseNoteAdmin({
        db: adminDb,
        businessId: auth.businessId,
        noteId: parsed.data.id,
      });
      if (!note) return apiError('Purchase note not found', 404);
      return apiSuccess(publicPurchaseNote(note));
    }

    const result = await listPurchaseNotesAdmin({
      db: adminDb,
      businessId: auth.businessId,
      status: parsed.data.status,
      supplierId: parsed.data.supplierId,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      cursor: parsed.data.cursor,
    });
    return apiSuccess({
      notes: result.notes.map(publicPurchaseNote),
      pagination: result.pagination,
    });
  } catch (cause) {
    console.error('[API v1/purchase-notes GET]', cause);
    return apiError('Failed to fetch purchase notes', 500);
  }
}

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = PurchaseNoteExternalActionSchema.safeParse(raw);
  if (!parsed.success) return apiError('Invalid purchase note action', 400, parsed.error.flatten());

  const requiredScopes: ApiKeyScope[] = parsed.data.action === 'link_financial'
    ? ['write:purchases', 'write:financial']
    : parsed.data.action === 'reverse'
      ? ['write:purchases', 'write:products', 'write:financial']
      : ['write:purchases', 'write:products'];
  const auth = await verifyApiKey(request, requiredScopes);
  if (isApiKeyError(auth)) return auth;
  const actor = { uid: `api:${auth.keyId}`, name: 'API v1', type: 'api' as const };

  try {
    if (parsed.data.action === 'confirm') {
      const result = await confirmPurchaseNoteAdmin({
        db: adminDb,
        businessId: auth.businessId,
        noteId: parsed.data.noteId,
        retryFailed: parsed.data.retryFailed,
        actor,
      });
      return apiSuccess({ ...result, _idempotent: result.replayed });
    }
    if (parsed.data.action === 'link_financial') {
      const result = await linkPurchaseFinancialAdmin({
        db: adminDb,
        businessId: auth.businessId,
        noteId: parsed.data.noteId,
        intent: {
          businessId: auth.businessId,
          noteId: parsed.data.noteId,
          ...parsed.data.intent,
        },
        actor,
      });
      return apiSuccess({ ...result, _idempotent: result.replayed });
    }

    const result = await reversePurchaseNoteAdmin({
      db: adminDb,
      businessId: auth.businessId,
      noteId: parsed.data.noteId,
      reason: parsed.data.reason,
      actor,
    });
    return apiSuccess({ ...result, _idempotent: result.replayed });
  } catch (cause) {
    if (cause instanceof PurchaseNoteClaimConflictError || cause instanceof PurchaseNoteReversalConflictError) {
      return apiError(cause.message, 409);
    }
    if (cause instanceof PurchaseNoteNotReadyError || cause instanceof PurchaseNoteNotReversibleError) {
      return apiError(cause.message, 409);
    }
    if (cause instanceof PurchaseNoteReversalBlockedError) return apiError(cause.message, 409, { code: cause.code });
    if (cause instanceof PurchaseFinancialConflictError || cause instanceof PurchaseFinancialNotReadyError) {
      return apiError(cause.message, 409);
    }
    if (cause instanceof PurchaseFinancialReferenceError) return apiError(cause.message, 409, { code: 'INVALID_BANK_ACCOUNT' });
    console.error('[API v1/purchase-notes POST]', cause);
    return apiError('Failed to apply purchase note action', 500);
  }
}
