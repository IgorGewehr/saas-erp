/**
 * POST /api/fiscal/emit-order/[id] — emite NFC-e para um DeliveryOrder (Pedidos).
 *
 * É o mecanismo da AUTO-EMISSÃO (opt-in via fiscal.nfceConfig.autoEmit — o toggle
 * fica em Settings → Fiscal). Este route NÃO decide se deve emitir: o chamador
 * (conclusão do pedido) só o invoca quando o flag está ligado. Também serve como
 * ação explícita "emitir cupom deste pedido".
 *
 * Reuso, não duplicação: toda a lógica fiscal (certificado, CSC, alocação atômica
 * de número, enrichment por Product, montagem do XML e transmissão à SEFAZ) vive em
 * `POST /api/fiscal/emit`. Aqui apenas:
 *   1. autentica (Admin SDK) e valida tenant (R1) — o pedido tem que ser do mesmo
 *      businessId do usuário; caso contrário 404 (não vaza existência cross-tenant);
 *   2. verifica IDEMPOTÊNCIA por pedido — se o DeliveryOrder já tem
 *      `fiscalDocumentId`, é no-op 200 (não reemite). Segunda camada de dedup: o
 *      emit ancora a idempotência em `order_${id}` internamente;
 *   3. monta o body via `buildDeliveryOrderNfceInput` (mapper puro) e ENCAMINHA
 *      para o handler de `/api/fiscal/emit`, que persiste o fiscalDocument e grava
 *      `fiscalDocumentId`/`fiscalAccessKey` de volta no pedido (linkFiscalDocToSource).
 *
 * Best-effort na ORIGEM: quem chama trata a falha sem bloquear o pedido. Este route
 * devolve o status do emit tal qual (200/201/4xx/5xx) para o chamador logar.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { UserRole, DeliveryOrder, Business } from '@/lib/types';
import { buildDeliveryOrderNfceInput } from '@/lib/services/fiscal/deliveryOrderNfce';
import { POST as emitFiscal } from '@/app/api/fiscal/emit/route';

/** Campos de vínculo fiscal gravados no pedido pelo emit (não fazem parte do
 *  shape base do DeliveryOrder — writeback via merge). */
type OrderWithFiscal = DeliveryOrder & {
  fiscalDocumentId?: string;
  fiscalAccessKey?: string | null;
  fiscalStatus?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'ID do pedido ausente.' }, { status: 400 });
  }

  // Auth primeiro (sem businessId conhecido) — o tenant do pedido é validado
  // logo abaixo contra o businessId do usuário autenticado (R1).
  const auth = await verifyAuth(request);
  if (isAuthError(auth)) return auth;

  // NFC-e é fluxo pós-venda (cupom) — operator+, igual ao /api/fiscal/emit.
  if (ROLE_HIERARCHY[auth.role as UserRole] < ROLE_HIERARCHY['operator']) {
    return NextResponse.json({ error: 'Operator role required' }, { status: 403 });
  }

  const snap = await adminDb.collection('deliveryOrders').doc(id).get();
  // Cross-tenant guard: pedido inexistente OU de outro tenant → 404 (não
  // diferencia, pra não vazar existência). adminDb bypassa Firestore rules.
  if (!snap.exists || snap.data()?.businessId !== auth.businessId) {
    return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
  }

  const order = { ...(snap.data() as OrderWithFiscal), id: snap.id };

  // Idempotência por pedido: nota já emitida → no-op. Evita reemitir num retry
  // do chamador (a auto-emissão pode disparar em mais de uma transição de status).
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

  // Mapper puro → body do /api/fiscal/emit (type='nfce', orderId+sourceType
  // ancoram a idempotência e o writeback no pedido).
  const nfceInput = buildDeliveryOrderNfceInput(order, { id: auth.businessId } as Business);

  // Encaminha ao MESMO handler de emissão (não reimplementa SEFAZ). Repassa o
  // Authorization pra que o emit reautentique o mesmo usuário/tenant.
  const forwarded = new NextRequest(new URL('/api/fiscal/emit', request.url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: request.headers.get('authorization') ?? '',
    },
    body: JSON.stringify(nfceInput),
  });

  return emitFiscal(forwarded);
}
