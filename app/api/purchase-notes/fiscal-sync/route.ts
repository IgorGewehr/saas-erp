import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { PurchaseFiscalSyncRequestSchema } from '@/lib/contracts/api/purchase-fiscal-sync';
import {
  getPurchaseFiscalSnapshotAdmin,
  hydratePurchaseFiscalInboxAdmin,
  preparePurchaseFromFiscalInboxAdmin,
  PurchaseFiscalConfigurationError,
  PurchaseFiscalInboxError,
  PurchaseFiscalSyncBusyError,
  syncPurchaseFiscalInboxAdmin,
} from '@/lib/services/purchase-fiscal-sync-admin';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { isAuthError, verifyAuth } from '@/lib/utils/verifyAuth';

export const runtime = 'nodejs';

function error(message: string, status: number, code?: string, details?: unknown) {
  return NextResponse.json({ ok: false, error: message, ...(code ? { code } : {}), ...(details ? { details } : {}) }, { status });
}
async function authorized(request: NextRequest, businessId: string) {
  const auth = await verifyAuth(request, businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.manager) {
    return error('Sem permissão para sincronizar documentos fiscais de compra.', 403);
  }
  return auth;
}

export async function GET(request: NextRequest) {
  const businessId = request.nextUrl.searchParams.get('businessId')?.trim() ?? '';
  if (!businessId) return error('businessId é obrigatório.', 400);
  const auth = await authorized(request, businessId);
  if (auth instanceof NextResponse) return auth;
  try {
    const snapshot = await getPurchaseFiscalSnapshotAdmin({ db: adminDb, businessId: auth.businessId });
    return NextResponse.json({ ok: true, data: snapshot });
  } catch (cause) {
    console.error('[purchase-notes/fiscal-sync] snapshot failed', cause);
    return error(cause instanceof Error ? cause.message : 'Não foi possível carregar o diagnóstico fiscal.', 500);
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = PurchaseFiscalSyncRequestSchema.safeParse(body);
  if (!parsed.success) return error('Ação fiscal inválida.', 400, 'INVALID_FISCAL_ACTION', parsed.error.issues.map((issue) => issue.message));
  const auth = await authorized(request, parsed.data.businessId);
  if (auth instanceof NextResponse) return auth;

  try {
    let operation: unknown;
    let note: unknown;
    if (parsed.data.action === 'sync') {
      operation = await syncPurchaseFiscalInboxAdmin({
        db: adminDb,
        businessId: auth.businessId,
        maxPages: parsed.data.maxPages,
      });
    } else if (parsed.data.action === 'hydrate') {
      operation = await hydratePurchaseFiscalInboxAdmin({
        db: adminDb,
        businessId: auth.businessId,
        inboxId: parsed.data.inboxId,
      });
    } else {
      note = await preparePurchaseFromFiscalInboxAdmin({
        db: adminDb,
        businessId: auth.businessId,
        inboxId: parsed.data.inboxId,
        actor: { uid: auth.uid, name: auth.name },
      });
    }
    const snapshot = await getPurchaseFiscalSnapshotAdmin({ db: adminDb, businessId: auth.businessId });
    return NextResponse.json({ ok: true, data: { snapshot, ...(operation ? { operation } : {}), ...(note ? { note } : {}) } });
  } catch (cause) {
    if (cause instanceof PurchaseFiscalSyncBusyError) return error(cause.message, 409, 'FISCAL_SYNC_BUSY');
    if (cause instanceof PurchaseFiscalConfigurationError) return error(cause.message, 409, 'FISCAL_CONFIGURATION', cause.issues);
    if (cause instanceof PurchaseFiscalInboxError) return error(cause.message, 409, 'FISCAL_INBOX_ERROR');
    console.error('[purchase-notes/fiscal-sync] action failed', cause);
    return error(cause instanceof Error ? cause.message : 'Não foi possível concluir a ação fiscal.', 502, 'FISCAL_PROVIDER_ERROR');
  }
}
