/**
 * POST /api/fiscal/emit-b2b-order/[id] — emite NF-e para um Order B2B/condicional.
 *
 * Mirror de app/api/fiscal/emit-order/[id]/route.ts (DeliveryOrder → NFC-e),
 * adaptado pra Order B2B → NF-e. Mesma filosofia: NÃO reimplementa a lógica
 * fiscal (certificado, numeração, XML, transmissão) — vive inteira em
 * POST /api/fiscal/emit. Aqui só:
 *   1. autentica e valida tenant (R1) — pedido inexistente ou de outro
 *      businessId → 404 (não vaza existência cross-tenant);
 *   2. idempotência por pedido — já tem fiscalDocId → no-op 200;
 *   3. monta o body via buildOrderNfeInput (mapper puro) e encaminha pro
 *      handler de /api/fiscal/emit (type='nfe', b2bOrderId ancora dedup e
 *      writeback em `orders`, NÃO em `deliveryOrders` — ver
 *      lib/contracts/api/fiscal/emit.ts pra o porquê do nome distinto).
 *
 * NF-e (diferente de NFC-e) exige admin+ — mesmo gate que /api/fiscal/emit
 * já aplica pra type='nfe' (dados cadastrais/tributários sensíveis, sem
 * urgência de balcão).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { UserRole, Order, Business } from '@/lib/types';
import { buildOrderNfeInput } from '@/lib/services/fiscal/orderNfe';
import { POST as emitFiscal } from '@/app/api/fiscal/emit/route';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'ID do pedido ausente.' }, { status: 400 });
  }

  const auth = await verifyAuth(request);
  if (isAuthError(auth)) return auth;

  if (ROLE_HIERARCHY[auth.role as UserRole] < ROLE_HIERARCHY['admin']) {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }

  const snap = await adminDb.collection('orders').doc(id).get();
  if (!snap.exists || snap.data()?.businessId !== auth.businessId) {
    return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
  }

  const order = { ...(snap.data() as Order), id: snap.id };

  if (order.fiscalDocumentId) {
    return NextResponse.json(
      {
        skipped: true,
        reason: 'already-emitted',
        fiscalDocumentId: order.fiscalDocumentId,
        accessKey: order.fiscalAccessKey ?? null,
        status: order.fiscalStatus ?? null,
      },
      { status: 200 },
    );
  }

  const nfeInput = buildOrderNfeInput(order, { id: auth.businessId } as Business);

  const forwarded = new NextRequest(new URL('/api/fiscal/emit', request.url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: request.headers.get('authorization') ?? '',
    },
    body: JSON.stringify(nfeInput),
  });

  return emitFiscal(forwarded);
}
