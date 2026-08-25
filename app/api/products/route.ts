import { NextResponse, type NextRequest } from 'next/server';
import {
  ArchiveProductCatalogRequestSchema,
  CreateProductCatalogRequestSchema,
  UpdateProductCatalogRequestSchema,
} from '@/lib/contracts/api/product-catalog';
import { withIdempotency, IdempotencyConflictError } from '@/lib/contracts/_runtime/idempotency';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  archiveProductCatalogAdmin,
  createProductCatalogAdmin,
  ProductCatalogDuplicateIdentifierError,
  ProductCatalogNotFoundError,
  updateProductCatalogAdmin,
} from '@/lib/services/product-catalog-admin';
import {
  applyStockOperationAdmin,
  InvalidStockOperationError,
  StockIdempotencyConflictError,
  StockReferenceError,
} from '@/lib/services/stock-core-admin';
import { ROLE_HIERARCHY, type Product, type UserRole } from '@/lib/types';
import { isAuthError, verifyAuth } from '@/lib/utils/verifyAuth';

function error(message: string, status: number, code?: string) {
  return NextResponse.json({ ok: false, error: message, ...(code ? { code } : {}) }, { status });
}

function canManageProducts(role: string): boolean {
  return (ROLE_HIERARCHY[role as UserRole] ?? 0) >= ROLE_HIERARCHY.manager;
}

function catalogError(cause: unknown) {
  if (cause instanceof ProductCatalogDuplicateIdentifierError) {
    return error(cause.message, 409, 'DUPLICATE_IDENTIFIER');
  }
  if (cause instanceof ProductCatalogNotFoundError || cause instanceof StockReferenceError) {
    return error(cause.message, 404, 'PRODUCT_NOT_FOUND');
  }
  if (
    cause instanceof IdempotencyConflictError
    || cause instanceof StockIdempotencyConflictError
  ) {
    return error(cause.message, 409, 'IDEMPOTENCY_CONFLICT');
  }
  if (cause instanceof InvalidStockOperationError) {
    return error(cause.message, 400, 'INVALID_STOCK_OPERATION');
  }
  if (cause instanceof Error && cause.name === 'ZodError') {
    return error(`Produto inválido: ${cause.message}`, 400, 'INVALID_PRODUCT');
  }
  console.error('[products] failed', cause);
  return error('Não foi possível salvar o produto.', 500);
}

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = CreateProductCatalogRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return error(`Dados inválidos: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }

  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if (!canManageProducts(auth.role)) return error('Sem permissão para cadastrar produtos.', 403);
  const headerKey = request.headers.get('x-idempotency-key');
  if (headerKey && headerKey !== parsed.data.idempotencyKey) {
    return error('A chave de idempotência do header diverge do corpo.', 400);
  }

  try {
    const creation = await withIdempotency(
      adminDb,
      {
        businessId: auth.businessId,
        key: parsed.data.idempotencyKey,
        endpoint: 'POST /api/products',
      },
      () => createProductCatalogAdmin({
        db: adminDb,
        businessId: auth.businessId,
        data: parsed.data.data,
      }),
    );

    let product = creation.result as Product;
    if (parsed.data.initialStock > 0) {
      const stock = await applyStockOperationAdmin(adminDb, {
        businessId: auth.businessId,
        type: 'entrada',
        lines: [{ productId: product.id, quantity: parsed.data.initialStock }],
        operatorId: auth.uid,
        operatorName: auth.name,
        reason: 'Estoque inicial do produto',
        sourceType: 'manual',
        sourceId: product.id,
        idempotencyKey: `${parsed.data.idempotencyKey}:initial-stock`,
        expandBom: false,
        negativeStockPolicy: 'prevent',
      });
      const adjustment = stock.adjustments[0];
      product = { ...product, currentStock: adjustment?.newStock ?? product.currentStock };
    }

    return NextResponse.json({
      ok: true,
      data: product,
      replayed: creation.replayed,
    }, { status: creation.replayed ? 200 : 201 });
  } catch (cause) {
    return catalogError(cause);
  }
}

export async function PATCH(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = UpdateProductCatalogRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return error(`Dados inválidos: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }

  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if (!canManageProducts(auth.role)) return error('Sem permissão para editar produtos.', 403);
  const headerKey = request.headers.get('x-idempotency-key');
  if (headerKey && headerKey !== parsed.data.idempotencyKey) {
    return error('A chave de idempotência do header diverge do corpo.', 400);
  }

  try {
    let product = await updateProductCatalogAdmin({
      db: adminDb,
      businessId: auth.businessId,
      productId: parsed.data.productId,
      patch: parsed.data.data,
    });

    if (
      parsed.data.targetStock !== undefined
      && parsed.data.targetStock !== product.currentStock
    ) {
      const stock = await applyStockOperationAdmin(adminDb, {
        businessId: auth.businessId,
        type: 'ajuste',
        lines: [{ productId: product.id, quantity: parsed.data.targetStock }],
        adjustmentMode: 'absolute',
        operatorId: auth.uid,
        operatorName: auth.name,
        reason: 'Ajuste ao editar produto',
        sourceType: 'manual',
        sourceId: product.id,
        idempotencyKey: `${parsed.data.idempotencyKey}:edit-stock`,
        expandBom: false,
        negativeStockPolicy: 'prevent',
      });
      const adjustment = stock.adjustments[0];
      product = { ...product, currentStock: adjustment?.newStock ?? product.currentStock };
    }

    return NextResponse.json({ ok: true, data: product });
  } catch (cause) {
    return catalogError(cause);
  }
}

export async function DELETE(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = ArchiveProductCatalogRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return error(`Dados inválidos: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }

  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if (!canManageProducts(auth.role)) return error('Sem permissão para arquivar produtos.', 403);

  try {
    const product = await archiveProductCatalogAdmin({
      db: adminDb,
      businessId: auth.businessId,
      productId: parsed.data.productId,
      actor: { uid: auth.uid, name: auth.name },
    });
    return NextResponse.json({ ok: true, data: product });
  } catch (cause) {
    return catalogError(cause);
  }
}
