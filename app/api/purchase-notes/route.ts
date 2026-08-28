import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { listPurchaseNotesAdmin, publicPurchaseNote } from '@/lib/services/purchase-query-admin';
import { ROLE_HIERARCHY, type PurchaseNoteStatus, type UserRole } from '@/lib/types';
import { isAuthError, verifyAuth } from '@/lib/utils/verifyAuth';

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  const businessId = request.nextUrl.searchParams.get('businessId') ?? '';
  if (!businessId) return error('businessId é obrigatório.', 400);
  const auth = await verifyAuth(request, businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.manager) {
    return error('Sem permissão para consultar notas de compra.', 403);
  }

  const rawStatus = request.nextUrl.searchParams.get('status');
  const allowedStatuses = new Set<PurchaseNoteStatus>([
    'rascunho', 'pendente', 'processando', 'importada', 'parcial', 'falha', 'cancelada', 'revertida',
  ]);
  if (rawStatus && !allowedStatuses.has(rawStatus as PurchaseNoteStatus)) {
    return error('Status de nota inválido.', 400);
  }

  try {
    const page = await listPurchaseNotesAdmin({
      db: adminDb,
      businessId: auth.businessId,
      status: rawStatus as PurchaseNoteStatus | undefined,
      cursor: request.nextUrl.searchParams.get('cursor'),
      limit: Number(request.nextUrl.searchParams.get('limit')) || 50,
    });
    return NextResponse.json({
      ok: true,
      data: {
        notes: page.notes.map(publicPurchaseNote),
        hasMore: page.pagination.hasMore,
        nextCursor: page.pagination.nextCursor,
      },
    });
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('Cursor')) return error(cause.message, 400);
    console.error('[purchase-notes] list failed', cause);
    return error('Não foi possível carregar as notas de compra.', 500);
  }
}
