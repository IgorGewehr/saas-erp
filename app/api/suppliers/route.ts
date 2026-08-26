import { NextResponse, type NextRequest } from 'next/server';
import {
  ArchiveSupplierCatalogRequestSchema,
  CreateSupplierCatalogRequestSchema,
  UpdateSupplierCatalogRequestSchema,
} from '@/lib/contracts/api/supplier-catalog';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  archiveSupplierAdmin,
  createSupplierAdmin,
  getSupplierAdmin,
  getSupplierRelationsAdmin,
  listSuppliersAdmin,
  SupplierDuplicateDocumentError,
  SupplierInvalidDocumentError,
  SupplierNotFoundError,
  updateSupplierAdmin,
} from '@/lib/services/supplier-admin';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { isAuthError, verifyAuth } from '@/lib/utils/verifyAuth';

function error(message: string, status: number, code?: string) {
  return NextResponse.json({ ok: false, error: message, ...(code ? { code } : {}) }, { status });
}

function canManage(role: string): boolean {
  return (ROLE_HIERARCHY[role as UserRole] ?? 0) >= ROLE_HIERARCHY.manager;
}

function supplierError(cause: unknown) {
  if (cause instanceof SupplierDuplicateDocumentError) return error(cause.message, 409, 'DUPLICATE_DOCUMENT');
  if (cause instanceof SupplierNotFoundError) return error(cause.message, 404, 'SUPPLIER_NOT_FOUND');
  if (cause instanceof SupplierInvalidDocumentError) return error(cause.message, 400, 'INVALID_DOCUMENT');
  if (cause instanceof Error && cause.name === 'ZodError') return error(`Fornecedor inválido: ${cause.message}`, 400, 'INVALID_SUPPLIER');
  console.error('[suppliers] failed', cause);
  return error('Não foi possível processar o fornecedor.', 500);
}

export async function GET(request: NextRequest) {
  const businessId = request.nextUrl.searchParams.get('businessId') ?? '';
  if (!businessId) return error('businessId é obrigatório.', 400);
  const auth = await verifyAuth(request, businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.operator) {
    return error('Sem permissão para consultar fornecedores.', 403);
  }

  try {
    const supplierId = request.nextUrl.searchParams.get('supplierId');
    if (supplierId) {
      const supplier = await getSupplierAdmin(adminDb, auth.businessId, supplierId);
      if (!supplier) throw new SupplierNotFoundError();
      const relations = request.nextUrl.searchParams.get('relations') === 'true'
        ? await getSupplierRelationsAdmin({ db: adminDb, businessId: auth.businessId, supplierId })
        : undefined;
      return NextResponse.json({ ok: true, data: { supplier, relations } });
    }
    const page = await listSuppliersAdmin({
      db: adminDb,
      businessId: auth.businessId,
      includeInactive: request.nextUrl.searchParams.get('includeInactive') === 'true',
      cursor: request.nextUrl.searchParams.get('cursor'),
      limit: Number(request.nextUrl.searchParams.get('limit')) || 100,
    });
    return NextResponse.json({ ok: true, data: page });
  } catch (cause) {
    return supplierError(cause);
  }
}

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = CreateSupplierCatalogRequestSchema.safeParse(raw);
  if (!parsed.success) return error(`Dados inválidos: ${JSON.stringify(parsed.error.flatten())}`, 400);
  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if (!canManage(auth.role)) return error('Sem permissão para cadastrar fornecedores.', 403);
  try {
    const supplier = await createSupplierAdmin({
      db: adminDb,
      businessId: auth.businessId,
      data: parsed.data.data,
      actor: { uid: auth.uid, name: auth.name },
    });
    return NextResponse.json({ ok: true, data: supplier }, { status: 201 });
  } catch (cause) {
    return supplierError(cause);
  }
}

export async function PATCH(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = UpdateSupplierCatalogRequestSchema.safeParse(raw);
  if (!parsed.success) return error(`Dados inválidos: ${JSON.stringify(parsed.error.flatten())}`, 400);
  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if (!canManage(auth.role)) return error('Sem permissão para editar fornecedores.', 403);
  try {
    const supplier = await updateSupplierAdmin({
      db: adminDb,
      businessId: auth.businessId,
      supplierId: parsed.data.supplierId,
      patch: parsed.data.data,
      actor: { uid: auth.uid, name: auth.name },
    });
    return NextResponse.json({ ok: true, data: supplier });
  } catch (cause) {
    return supplierError(cause);
  }
}

export async function DELETE(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = ArchiveSupplierCatalogRequestSchema.safeParse(raw);
  if (!parsed.success) return error(`Dados inválidos: ${JSON.stringify(parsed.error.flatten())}`, 400);
  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if (!canManage(auth.role)) return error('Sem permissão para inativar fornecedores.', 403);
  try {
    const supplier = await archiveSupplierAdmin({
      db: adminDb,
      businessId: auth.businessId,
      supplierId: parsed.data.supplierId,
      actor: { uid: auth.uid, name: auth.name },
    });
    return NextResponse.json({ ok: true, data: supplier });
  } catch (cause) {
    return supplierError(cause);
  }
}
