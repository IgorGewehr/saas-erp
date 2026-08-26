import { NextResponse, type NextRequest } from 'next/server';
import { adminDb, adminStorage } from '@/lib/config/firebaseAdmin';
import {
  findPurchaseNoteByAccessKeyAdmin,
  preparePurchaseNoteAdmin,
  PurchaseNoteDuplicateError,
} from '@/lib/services/purchase-import-admin';
import { parsePurchaseNFeXml, PurchaseXmlValidationError } from '@/lib/services/purchase-xml-parser';
import { ROLE_HIERARCHY, type Business, type UserRole } from '@/lib/types';
import { isAuthError, verifyAuth } from '@/lib/utils/verifyAuth';

export const runtime = 'nodejs';

const MAX_XML_BYTES = 5 * 1024 * 1024;

function error(message: string, status: number, code?: string, details?: unknown) {
  return NextResponse.json({ ok: false, error: message, ...(code ? { code } : {}), ...(details ? { details } : {}) }, { status });
}

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  if (!form) return error('Formulário inválido.', 400);
  const businessId = String(form.get('businessId') ?? '');
  const file = form.get('file');
  if (!businessId) return error('businessId é obrigatório.', 400);
  if (!(file instanceof File)) return error('Selecione um arquivo XML.', 400);
  if (file.size <= 0 || file.size > MAX_XML_BYTES) return error('O XML deve possuir até 5 MB.', 413, 'XML_TOO_LARGE');
  if (!file.name.toLowerCase().endsWith('.xml')) return error('O arquivo deve possuir extensão .xml.', 400, 'INVALID_FILE_TYPE');

  const auth = await verifyAuth(request, businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.manager) {
    return error('Sem permissão para importar compras.', 403);
  }

  const businessSnapshot = await adminDb.collection('businesses').doc(auth.businessId).get();
  if (!businessSnapshot.exists) return error('Empresa não encontrada.', 404);
  const business = { ...businessSnapshot.data(), id: businessSnapshot.id } as Business;

  let parsed;
  try {
    const xml = await file.text();
    parsed = parsePurchaseNFeXml({ xml, expectedRecipientDocument: business.cnpj || business.cpf || '' });
  } catch (cause) {
    if (cause instanceof PurchaseXmlValidationError) {
      return error('O XML não passou pela validação.', 400, 'INVALID_PURCHASE_XML', cause.issues);
    }
    console.error('[purchase-notes/prepare] parse failed', cause);
    return error('Não foi possível interpretar o XML.', 400, 'XML_PARSE_ERROR');
  }

  const existingNoteId = await findPurchaseNoteByAccessKeyAdmin(adminDb, auth.businessId, parsed.accessKey);
  if (existingNoteId) return error('Esta NF-e já foi adicionada.', 409, 'DUPLICATE_ACCESS_KEY', { existingNoteId });

  const noteId = adminDb.collection('purchaseNotes').doc().id;
  const storagePath = `businesses/${auth.businessId}/purchase-notes/${noteId}/original.xml`;
  const storageFile = adminStorage.bucket().file(storagePath);
  try {
    await storageFile.save(Buffer.from(await file.arrayBuffer()), {
      contentType: 'application/xml; charset=utf-8',
      resumable: false,
      metadata: {
        cacheControl: 'private, no-store',
        metadata: {
          businessId: auth.businessId,
          purchaseNoteId: noteId,
          sha256: parsed.xmlSha256,
          uploadedBy: auth.uid,
        },
      },
    });
    const note = await preparePurchaseNoteAdmin({
      db: adminDb,
      businessId: auth.businessId,
      noteId,
      parsed,
      xmlStoragePath: storagePath,
      originalFileName: file.name,
      actor: { uid: auth.uid, name: auth.name },
    });
    return NextResponse.json({ ok: true, data: note }, { status: 201 });
  } catch (cause) {
    await storageFile.delete({ ignoreNotFound: true }).catch(() => undefined);
    if (cause instanceof PurchaseNoteDuplicateError) {
      return error(cause.message, 409, 'DUPLICATE_ACCESS_KEY', { existingNoteId: cause.existingNoteId });
    }
    console.error('[purchase-notes/prepare] persistence failed', cause);
    return error('Não foi possível preparar a NF-e.', 500, 'PURCHASE_PREPARE_FAILED');
  }
}
