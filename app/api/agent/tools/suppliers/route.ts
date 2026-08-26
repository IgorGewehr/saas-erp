/** Agent tool: Supplier CRUD backed by the same domain core used by UI/API. */

import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { SupplierCatalogData, SupplierCatalogPatch } from '@/lib/contracts/api/supplier-catalog';
import {
  createSupplierAdmin,
  findSupplierByDocumentAdmin,
  getSupplierAdmin,
  listSuppliersAdmin,
  searchSuppliersAdmin,
  SupplierDuplicateDocumentError,
  updateSupplierAdmin,
} from '@/lib/services/supplier-admin';

type Action = 'list' | 'get' | 'search' | 'create' | 'update' | 'find_by_cnpj';

function supplierData(input: Record<string, unknown>): SupplierCatalogData {
  const document = String(input.document ?? input.cnpj ?? '');
  return {
    documentType: input.documentType === 'cpf' || document.replace(/\D/g, '').length === 11 ? 'cpf' : 'cnpj',
    document,
    razaoSocial: String(input.razaoSocial ?? ''),
    nomeFantasia: input.nomeFantasia as string | undefined,
    inscricaoEstadual: input.inscricaoEstadual as string | undefined,
    phone: input.phone as string | undefined,
    email: input.email as string | undefined,
    endereco: input.endereco as SupplierCatalogData['endereco'],
    notes: input.notes as string | undefined,
    paymentTerms: input.paymentTerms as string | undefined,
    leadTimeDays: input.leadTimeDays as number | undefined,
    minimumOrderValue: input.minimumOrderValue as number | undefined,
    minimumOrderQuantity: input.minimumOrderQuantity as number | undefined,
    orderMultiple: input.orderMultiple as number | undefined,
    isActive: input.isActive !== false,
  };
}

function supplierPatch(input: Record<string, unknown>): SupplierCatalogPatch {
  const clean = { ...input } as Record<string, unknown>;
  if (typeof clean.cnpj === 'string' && clean.document === undefined) clean.document = clean.cnpj;
  delete clean.cnpj;
  if (typeof clean.document === 'string' && clean.documentType === undefined) {
    clean.documentType = clean.document.replace(/\D/g, '').length === 11 ? 'cpf' : 'cnpj';
  }
  return clean as SupplierCatalogPatch;
}

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await verifyAgentRequest(req);
  } catch (cause) {
    const response = agentAuthErrorResponse(cause);
    if (response) return response;
    throw cause;
  }

  const body = parseAgentBody<{ action: Action; params: Record<string, unknown> }>(ctx.rawBody);
  const actor = { uid: 'agent', name: 'Agente AEVO' };
  try {
    switch (body.action) {
      case 'list': {
        const page = await listSuppliersAdmin({
          db: adminDb,
          businessId: ctx.businessId,
          includeInactive: Boolean(body.params.includeInactive),
          limit: Number(body.params.limit) || 100,
        });
        return NextResponse.json({ ok: true, data: page.suppliers });
      }
      case 'get':
        return NextResponse.json({ ok: true, data: await getSupplierAdmin(adminDb, ctx.businessId, String(body.params.id ?? '')) });
      case 'create':
        return NextResponse.json({
          ok: true,
          data: await createSupplierAdmin({ db: adminDb, businessId: ctx.businessId, data: supplierData(body.params), actor }),
        });
      case 'update':
        return NextResponse.json({
          ok: true,
          data: await updateSupplierAdmin({
            db: adminDb,
            businessId: ctx.businessId,
            supplierId: String(body.params.id ?? ''),
            patch: supplierPatch(body.params.patch as Record<string, unknown>),
            actor,
          }),
        });
      case 'find_by_cnpj':
        return NextResponse.json({
          ok: true,
          data: await findSupplierByDocumentAdmin(adminDb, ctx.businessId, String(body.params.cnpj ?? body.params.document ?? '')),
        });
      case 'search':
        return NextResponse.json({
          ok: true,
          data: await searchSuppliersAdmin({
            db: adminDb,
            businessId: ctx.businessId,
            query: String(body.params.query ?? ''),
            limit: Number(body.params.limit) || 10,
          }),
        });
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (cause) {
    console.error('[agent.suppliers] error', cause);
    return NextResponse.json(
      { ok: false, error: (cause as Error).message },
      { status: cause instanceof SupplierDuplicateDocumentError ? 409 : 500 },
    );
  }
}
