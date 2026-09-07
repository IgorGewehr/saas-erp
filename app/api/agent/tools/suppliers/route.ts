/** Agent tool: Supplier CRUD backed by the same domain core used by UI/API. */

import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import { parseToolRequest, validateToolResponse, isContractError } from '@/contracts/_runtime/agentToolValidation';
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

  const rawBody = parseAgentBody<{ action: Action; params: Record<string, unknown> }>(ctx.rawBody);
  const actor = { uid: 'agent', name: 'Agente AEVO' };

  // R6/SDD: valida request com Zod no boundary (espelha a route de agenda/financial).
  // Shape inválido -> ContractError -> 400 com error envelope estruturado.
  let action: Action;
  let params: Record<string, unknown>;
  try {
    const parsed = parseToolRequest('suppliers', rawBody);
    action = parsed.action as Action;
    params = parsed.params as Record<string, unknown>;
  } catch (err) {
    if (isContractError(err)) {
      return NextResponse.json(err.toEnvelope(), { status: 400 });
    }
    throw err;
  }

  try {
    let data: unknown;
    switch (action) {
      case 'list': {
        const page = await listSuppliersAdmin({
          db: adminDb,
          businessId: ctx.businessId,
          includeInactive: Boolean(params.includeInactive),
          limit: Number(params.limit) || 100,
        });
        data = page.suppliers;
        break;
      }
      case 'get':
        data = await getSupplierAdmin(adminDb, ctx.businessId, String(params.id ?? ''));
        break;
      case 'create':
        data = await createSupplierAdmin({ db: adminDb, businessId: ctx.businessId, data: supplierData(params), actor });
        break;
      case 'update':
        data = await updateSupplierAdmin({
          db: adminDb,
          businessId: ctx.businessId,
          supplierId: String(params.id ?? ''),
          patch: supplierPatch(params.patch as Record<string, unknown>),
          actor,
        });
        break;
      case 'find_by_cnpj':
        data = await findSupplierByDocumentAdmin(adminDb, ctx.businessId, String(params.cnpj ?? params.document ?? ''));
        break;
      case 'search':
        data = await searchSuppliersAdmin({
          db: adminDb,
          businessId: ctx.businessId,
          query: String(params.query ?? ''),
          limit: Number(params.limit) || 10,
        });
        break;
      default: {
        const exhaustiveCheck: never = action;
        return NextResponse.json({ ok: false, error: `Unknown action: ${exhaustiveCheck}` }, { status: 400 });
      }
    }

    // SDD: valida shape do response em dev (lança); em prod loga e segue.
    const validated = validateToolResponse('suppliers', action, data);
    return NextResponse.json({ ok: true, data: validated });
  } catch (cause) {
    if (isContractError(cause)) {
      return NextResponse.json(cause.toEnvelope(), { status: cause.code === 'INTERNAL' ? 500 : 400 });
    }
    console.error('[agent.suppliers] error', cause);
    return NextResponse.json(
      { ok: false, error: (cause as Error).message },
      { status: cause instanceof SupplierDuplicateDocumentError ? 409 : 500 },
    );
  }
}
