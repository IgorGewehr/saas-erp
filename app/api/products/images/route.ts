import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { ProductImagesMutationSchema } from '@/lib/contracts/api/product-catalog';
import { ProductImageV2Schema } from '@/lib/contracts/domain/productV2';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  getProductCatalogAdmin,
  mergeProductImagesAdmin,
  ProductCatalogNotFoundError,
} from '@/lib/services/product-catalog-admin';
import { uploadServerMedia } from '@/lib/services/storage/adminUpload';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { isAuthError, verifyAuth } from '@/lib/utils/verifyAuth';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.manager) {
    return error('Sem permissão para alterar imagens de produtos.', 403);
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) return error('Formulário de upload inválido.', 400);
  const parsed = ProductImagesMutationSchema.safeParse({
    businessId: formData.get('businessId'),
    productId: formData.get('productId'),
    mode: formData.get('mode') || undefined,
  });
  if (!parsed.success) return error('Identificação do produto inválida.', 400);
  if (parsed.data.businessId !== auth.businessId) return error('Empresa inválida.', 403);

  const files = formData.getAll('files').filter((entry): entry is File => entry instanceof File);
  if (files.length === 0 || files.length > 8) {
    return error('Envie entre 1 e 8 imagens.', 400);
  }
  for (const file of files) {
    if (!CONTENT_TYPES[file.type]) return error('Use apenas imagens JPG, PNG ou WebP.', 400);
    if (file.size <= 0 || file.size > MAX_IMAGE_SIZE) return error('Cada imagem deve ter no máximo 5MB.', 400);
  }
  const existingRaw = formData.get('existingImages');
  let existingValue: unknown = [];
  if (existingRaw) {
    try {
      existingValue = JSON.parse(String(existingRaw));
    } catch {
      return error('Lista de imagens existentes inválida.', 400);
    }
  }
  const existingParsed = existingRaw
    ? ProductImageV2Schema.array().max(8).safeParse(existingValue)
    : { success: true as const, data: [] };
  if (!existingParsed.success) return error('Lista de imagens existentes inválida.', 400);
  if (existingParsed.data.length + files.length > 8) {
    return error('Cada produto aceita no máximo 8 imagens.', 400);
  }

  try {
    await getProductCatalogAdmin(adminDb, auth.businessId, parsed.data.productId);
    const images = await Promise.all(files.map(async (file, index) => {
      const id = randomUUID();
      const extension = CONTENT_TYPES[file.type];
      const storagePath = `products/${auth.businessId}/${parsed.data.productId}/${id}.${extension}`;
      const url = await uploadServerMedia({
        storagePath,
        buffer: Buffer.from(await file.arrayBuffer()),
        contentType: file.type,
      });
      return {
        id,
        url,
        alt: file.name.slice(0, 300),
        sortOrder: index,
        isPrimary: index === 0,
      };
    }));
    const product = await mergeProductImagesAdmin({
      db: adminDb,
      businessId: auth.businessId,
      productId: parsed.data.productId,
      images: parsed.data.mode === 'replace' ? [...existingParsed.data, ...images] : images,
      mode: parsed.data.mode,
    });
    return NextResponse.json({ ok: true, data: product });
  } catch (cause) {
    if (cause instanceof ProductCatalogNotFoundError) return error(cause.message, 404);
    console.error('[products/images] failed', cause);
    return error(cause instanceof Error ? cause.message : 'Não foi possível enviar as imagens.', 500);
  }
}
