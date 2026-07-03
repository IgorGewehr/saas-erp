import { randomBytes } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { checkRateLimit, getClientIp, rateLimitHeaders } from '@/lib/utils/rateLimit';
import { withIdempotency, IdempotencyConflictError } from '@/contracts/_runtime/idempotency';
import {
  deductStockAdmin, loadProductIndex, checkStockAvailability, InsufficientStockError,
} from '@/lib/services/stock-admin';
import { allocateOrderNumberAdmin } from '@/lib/services/orderNumber';
import { buildOrderStockLines } from '@/lib/services/stock-lines';
import { resolveClientIdentityAdmin } from '@/lib/services/clients/resolveIdentity';
import { assertOrdersAcceptedNow, OrdersClosedError } from '@/lib/services/orders/acceptance';
import { validateAndCleanModifiers, computeModifierDelta, round2 } from '@/lib/services/orders/pricing';
import { resolveDeliveryZone } from '@/lib/services/orders/deliveryZones';
import { reserveCouponAdmin } from '@/lib/services/orders/couponRedeem';
import { COUPON_REJECT_MESSAGE } from '@/lib/services/orders/coupons';
import { redeemGiftCardAdmin, loadGiftCardByCode, checkGiftCardEligibility } from '@/lib/services/orders/checkoutRedemptions';
import type {
  Business,
  DeliveryOrder, DeliveryOrderItem, DeliveryOrderAddress,
  DeliveryOrderPaymentMethod, DeliveryType, SelectedModifier,
  Product,
} from '@/lib/types';

interface PublicOrderPayload {
  businessId: string;
  clientName: string;
  clientPhone?: string;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    basePrice?: number;
    total: number;
    notes?: string;
    imageUrl?: string;
    selectedModifiers?: SelectedModifier[];
  }>;
  deliveryType: DeliveryType;
  deliveryAddress?: DeliveryOrderAddress;
  deliveryFee?: number;
  paymentMethod?: DeliveryOrderPaymentMethod;
  changeFor?: number;
  customerNotes?: string;
  couponCode?: string;
  giftCardCode?: string;
}

const PRICE_TOLERANCE = 0.01;
const RATE_LIMIT = 10;        // 10 requests
const RATE_WINDOW_MS = 60_000; // per minute

/**
 * Erro de regra de negócio com status HTTP. Usado dentro do handler envolvido
 * por `withIdempotency` (que só pode retornar o payload de sucesso) para
 * sinalizar falhas de validação 4xx — convertidas em NextResponse no catch.
 * `withIdempotency` deleta a chave ao lançar, então um retry corrigido pode
 * reusar a mesma chave.
 */
class PublicOrderError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'PublicOrderError';
  }
}

export async function POST(req: NextRequest) {
  // ── Rate limit by IP ────────────────────────────────────────────────────────
  const ip = getClientIp(req);
  const rl = checkRateLimit(`orders-public:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Muitos pedidos. Aguarde um instante e tente novamente.' },
      { status: 429, headers: rateLimitHeaders(rl, RATE_LIMIT) },
    );
  }

  let body: PublicOrderPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // `deliveryFee` do payload é IGNORADO de propósito: a taxa é recomputada
  // server-side contra a zona de entrega resolvida (não se confia no client).
  const { businessId, clientName, clientPhone, items, deliveryType, deliveryAddress,
    paymentMethod, changeFor, customerNotes, couponCode, giftCardCode } = body;

  if (!businessId || !clientName?.trim() || !items?.length || !deliveryType) {
    return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 });
  }

  if (deliveryType === 'entrega') {
    const addr = deliveryAddress;
    const missing = !addr
      || !addr.logradouro?.trim()
      || !addr.numero?.trim()
      || !addr.bairro?.trim()
      || !addr.municipio?.trim()
      || !addr.uf?.trim();
    if (missing) {
      return NextResponse.json({ error: 'Endereço de entrega incompleto' }, { status: 400 });
    }
  }

  // ── Idempotência (R3/P2.17) ─────────────────────────────────────────────────
  // Retry/double-tap em rede móvel reentregaria o mesmo carrinho → pedido
  // duplicado, cozinha 2x, dupla dedução de estoque. O front envia um uuid por
  // carrinho no header X-Idempotency-Key; replays devolvem o pedido já criado
  // (mesmo orderId/orderNumber) sem reexecutar criação de cliente, número
  // sequencial nem dedução de estoque. Sem header, comporta-se como antes.
  const idempotencyKey = req.headers.get('x-idempotency-key');

  try {
    const { result } = await withIdempotency(
      adminDb,
      { businessId, key: idempotencyKey, endpoint: 'POST /api/orders/public' },
      async (): Promise<{ orderId: string; orderNumber: number; trackingToken: string; total: number; discount: number; giftCardAmount: number }> => {
    const now = new Date().toISOString();
    // Token OPACO de acompanhamento: capability URL pro cliente anônimo pagar e
    // acompanhar SÓ o próprio pedido, sem abrir leitura pública de deliveryOrders.
    const trackingToken = randomBytes(32).toString('base64url');

    // ── 1. Validate business exists ──────────────────────────────────────────
    const bizRef = adminDb.collection('businesses').doc(businessId);
    const bizSnap = await bizRef.get();
    if (!bizSnap.exists) {
      throw new PublicOrderError(404, 'Negócio não encontrado');
    }
    const biz = bizSnap.data() as Business;

    // ── 1b. Guard de horário (COER-01) ───────────────────────────────────────
    // A regra de "aceita pedido fora do horário?" vivia só no prompt do agente;
    // um POST forjado aqui criava pedido com a loja FECHADA. Impomos server-side
    // ANTES de queimar número sequencial / debitar estoque. Reusa o MESMO
    // algoritmo (isBusinessOpenNow) do tool de status do agente.
    assertOrdersAcceptedNow(biz, new Date(now));

    // ── 2. Validate items + recompute prices server-side ─────────────────────
    const productIds = [...new Set(items.map(i => i.productId))];
    if (productIds.length === 0) {
      throw new PublicOrderError(400, 'Itens inválidos');
    }
    const productRefs = productIds.map(id => adminDb.collection('products').doc(id));
    const productSnaps = await adminDb.getAll(...productRefs);
    const productMap = new Map<string, Product>();
    for (const snap of productSnaps) {
      if (!snap.exists) continue;
      const data = snap.data() as Product;
      if (data.businessId !== businessId) continue; // silently skip cross-tenant
      productMap.set(snap.id, { ...data, id: snap.id });
    }

    const validatedItems: DeliveryOrderItem[] = [];
    // P2.7: IDs que NÃO podem ficar negativos. Espelha a regra "Esgotado" da UI
    // (CatalogClient): só item simples (sem BOM, sem modificadores) com estoque
    // definido é bloqueado. Combos/insumos seguem o comportamento legado (debitam
    // mesmo indo negativo) — operador acompanha por stockMovements/alertas.
    const guardedStockIds = new Set<string>();
    for (const raw of items) {
      if (!raw.productId || typeof raw.quantity !== 'number' || raw.quantity <= 0) {
        throw new PublicOrderError(400, 'Item inválido');
      }
      const product = productMap.get(raw.productId);
      if (!product) {
        throw new PublicOrderError(400, `Produto indisponível: ${raw.productName || raw.productId}`);
      }
      if (product.isActive === false || product.isDeliverable === false) {
        throw new PublicOrderError(400, `Produto indisponível: ${product.name}`);
      }
      // "Esgotado hoje" manual (menuAvailable === false): espelha a regra da UI/helper
      // — rejeita independentemente do estoque. Ausente/true mantém comportamento atual.
      if (product.menuAvailable === false) {
        throw new PublicOrderError(400, `Produto indisponível: ${product.name}`);
      }

      // Validate + recompute modifier pricing
      const mods = validateAndCleanModifiers(product, raw.selectedModifiers);
      if ('error' in mods) {
        throw new PublicOrderError(400, mods.error);
      }

      const basePrice = product.salePrice;
      const modifierDelta = computeModifierDelta(mods.clean);
      const unitPrice = round2(basePrice + modifierDelta);
      const total = round2(unitPrice * raw.quantity);

      // Reject if client-sent total diverges beyond tolerance (front-end bug or tampering)
      if (Math.abs(raw.total - total) > PRICE_TOLERANCE * raw.quantity) {
        throw new PublicOrderError(400, `Preço inválido para ${product.name}`);
      }

      const item: DeliveryOrderItem = {
        productId: product.id,
        productName: product.name,
        quantity: raw.quantity,
        unitPrice,
        total,
      };
      if (raw.notes) item.notes = raw.notes.slice(0, 500);
      if (product.imageUrl) item.imageUrl = product.imageUrl;
      if (modifierDelta > 0 || mods.clean.length === 0) item.basePrice = basePrice;
      if (mods.clean.length) item.selectedModifiers = mods.clean;
      validatedItems.push(item);

      // "Não controlar estoque" (trackStock === false): fora do guard — nunca bloqueia
      // por estoque (é debitado tolerando negativo, sem barrar o pedido). Ausente/true
      // mantém o comportamento atual.
      if (
        product.trackStock !== false
        && !product.components?.length && !product.hasModifiers
        && product.currentStock !== undefined
      ) {
        guardedStockIds.add(product.id);
      }
    }

    // ── Linhas de estoque (fonte ÚNICA, simétrica ao restauro) ───────────────
    // buildOrderStockLines reconstrói AS MESMAS linhas que o estorno (admin SDK)
    // a partir dos itens validados: linha base por item (BOM expandido depois
    // pelo serviço de estoque) + insumos de modificadores com linkedProductId já
    // multiplicados por consumeQty × qty da opção × qty do item.
    const stockLines = buildOrderStockLines(
      { items: validatedItems } as unknown as DeliveryOrder,
      productMap,
    );

    // ── 3. Resolve client identity by phone (dedup/canonical/merge) ──────────
    // Ponto ÚNICO de "achar ou criar" Client por telefone: segue os candidatos
    // BR, canonicalização, a cadeia de mergedInto e ignora soft-deleted. Antes
    // este caminho fazia match por phone exato (digitsOnly), criando uma
    // duplicata a cada pedido quando o número fora gravado em outra forma.
    let clientId: string | undefined;
    // Primeiro pedido do cliente? (para cupons firstOrderOnly). Cliente sem
    // telefone é sempre tratado como anônimo → primeiro pedido.
    let isFirstOrder = true;
    if (clientPhone) {
      const phone = clientPhone.replace(/\D/g, '');
      if (phone.length < 8) {
        throw new PublicOrderError(400, 'Telefone inválido');
      }
      const { clientId: resolvedId } = await resolveClientIdentityAdmin({
        db: adminDb,
        businessId,
        phone: clientPhone,
        name: clientName,
      });
      clientId = resolvedId ?? undefined; // default createIfMissing=true → sempre string
      // Conta a visita no cliente primário (resolveClientIdentity não conta) e
      // preenche o nome só se ainda estiver vazio — não sobrescreve nome real.
      const clientRef = adminDb.collection('clients').doc(clientId!);
      const clientSnap = await clientRef.get();
      // visitCount ANTES deste pedido: 0 ⇒ primeiro pedido (cliente novo ou sem
      // compras). O INCREMENTO é adiado para DEPOIS da persistência do pedido
      // (ver abaixo) — contar aqui envelheceria o cliente mesmo em pedido que
      // falha adiante (estoque 409), invalidando cupom firstOrderOnly numa
      // retentativa que é, de fato, a primeira compra concluída.
      isFirstOrder = ((clientSnap.data()?.visitCount as number | undefined) ?? 0) === 0;
      await clientRef.update({
        name: clientSnap.data()?.name || clientName.trim(),
        lastVisit: now,
        updatedAt: now,
      });
    }

    // ── 4. Compute totals server-side ────────────────────────────────────────
    // Taxa de entrega AUTORITATIVA: resolvida contra as zonas configuradas
    // (settings.aiAgent.deliveryZones) a partir do endereço — nunca do valor
    // enviado pelo client (SOTA-05/COE). Sem zonas → cai na taxa plana
    // (settings.aiAgent.pedidos.deliveryFee). Endereço fora de área → rejeita.
    const subtotal = round2(validatedItems.reduce((s, i) => s + i.total, 0));
    let fee = 0;
    if (deliveryType === 'entrega') {
      const resolution = resolveDeliveryZone(biz.settings?.aiAgent?.deliveryZones, {
        cep: deliveryAddress?.cep,
        bairro: deliveryAddress?.bairro,
      });
      if (resolution.status === 'out-of-area') {
        throw new PublicOrderError(400, 'Endereço fora da área de entrega desta loja.');
      }
      fee = resolution.status === 'matched'
        ? round2(resolution.fee)
        : round2(Math.max(0, biz.settings?.aiAgent?.pedidos?.deliveryFee ?? 0));
    }
    // Cupom + gift card (aplicados abaixo, após o pre-check de estoque). `total`
    // é computado só depois de resolver desconto/frete-grátis/gift card.
    let discount = 0;
    let couponId: string | undefined;
    let appliedCouponCode: string | undefined;
    let giftCardId: string | undefined;
    let appliedGiftCardCode: string | undefined;
    let giftCardAmount = 0;

    // ── 4b. Pré-check de estoque (evita queimar número sequencial) ───────────
    // Checa os itens guardados (simples + estoque definido) contra o productMap
    // já carregado, ANTES de consumir o número do pedido. Fecha o caso comum
    // (página velha / item esgotado) sem buraco na numeração. O guard ATÔMICO no
    // deductStockAdmin continua sendo a autoridade contra corrida concorrente.
    if (guardedStockIds.size > 0) {
      const guardedLines = stockLines.filter(l => guardedStockIds.has(l.productId));
      const shortages = checkStockAvailability(guardedLines, productMap);
      if (shortages.length > 0) {
        const names = [...new Set(shortages.map(s => s.productName))].join(', ');
        throw new PublicOrderError(409, `Sem estoque para: ${names}. Atualize o carrinho e tente novamente.`);
      }
    }

    // ── 4c. Cupom (reserva ATÔMICA antes de queimar número/estoque) ──────────
    // Reservado ANTES da alocação de número e da dedução de estoque: uma rejeição
    // (400) ou falha de limite não deixa buraco na numeração nem toca o estoque.
    // O resgate é idempotente pela chave do carrinho (X-Idempotency-Key) — retry
    // do mesmo carrinho não re-consome. orderRef é pré-gerado só para ancorar o
    // resgate/pedido; a persistência do pedido é o último passo (orderRef.set).
    const orderRef = adminDb.collection('deliveryOrders').doc();
    if (couponCode?.trim()) {
      const reserve = await reserveCouponAdmin(adminDb, {
        businessId,
        code: couponCode,
        redemptionKey: idempotencyKey || orderRef.id,
        orderId: orderRef.id,
        clientId,
        channel: 'site',
        ctx: {
          subtotal,
          deliveryFee: fee,
          deliveryType,
          now: new Date(now),
          isFirstOrder,
        },
      });
      if (!reserve.ok) {
        const msg = reserve.reason === 'not_found'
          ? 'Cupom inválido.'
          : COUPON_REJECT_MESSAGE[reserve.reason];
        throw new PublicOrderError(400, msg);
      }
      discount = reserve.discount;
      if (reserve.freeDelivery) fee = reserve.finalFee; // frete grátis → 0
      couponId = reserve.couponId;
      appliedCouponCode = reserve.code;
    }

    // Valor a pagar após cupom — base sobre a qual o gift card (dinheiro) incide.
    const payableBeforeCash = round2(Math.max(0, subtotal + fee - discount));

    // ── 4d. Gift card — PRÉ-CHECK de elegibilidade (SEM debitar) ─────────────
    // Débito de saldo (dinheiro) é irreversível sem estorno; por isso só o
    // COMMITAMOS DEPOIS que o estoque foi deduzido (passo 5c) — fecha a janela em
    // que um 409 de estoque deixaria o saldo consumido num pedido inexistente.
    // Aqui apenas rejeitamos cedo um cartão claramente inválido, sem side-effect.
    // Exigimos X-Idempotency-Key para pedidos com gift card (o front sempre envia):
    // sem ela um retry re-debitaria o saldo, pois o ledger é ancorado nessa chave.
    if (giftCardCode?.trim()) {
      if (!idempotencyKey) {
        throw new PublicOrderError(400, 'Recarregue a página e tente novamente.');
      }
      const preGc = await loadGiftCardByCode(adminDb, businessId, giftCardCode);
      const reason = preGc ? checkGiftCardEligibility(preGc, now) : 'not_found';
      if (reason) {
        // Mensagem GENÉRICA (anti-oráculo p/ instrumento ao portador): não
        // distingue inexistente/inativo/expirado/sem-saldo na resposta pública.
        console.warn('[PublicOrder] gift card inelegível (pré-check):', reason);
        throw new PublicOrderError(400, 'Gift card inválido ou sem saldo disponível.');
      }
    }

    // ── 5. Sequential order number (fonte ÚNICA, transaction-safe) ───────────
    const orderNumber = await allocateOrderNumberAdmin(adminDb, businessId);

    // ── 5b. Dedução atômica de estoque (P2.6) ────────────────────────────────
    // Antes este caminho público não debitava estoque algum. Agora reusa o
    // serviço admin: linhas base (BOM expandido 1 nível internamente) + linhas
    // de modificadores com linkedProductId. Roda em runTransaction única (lê o
    // estoque real dentro da tx → sem oversell por concorrência, P1.6/P1.7) e
    // grava um stockMovements por SKU. Se falhar, a exceção propaga e o pedido
    // NÃO é persistido. P2.7 (BOM recursivo p/ combos) fica fora do escopo.
    let stockDeductedAt: string | undefined;
    if (stockLines.length > 0) {
      // Index precisa cobrir produtos base, insumos de modifier e folhas de BOM
      // (para nome/minStock e expansão), todos filtrados por businessId.
      const baseIds = stockLines.map(l => l.productId);
      // baseIds já inclui os insumos LINKADOS de modificadores (linkedProductId),
      // mas `productMap` só carregou os produtos dos ITENS — não os linkados. Se um
      // insumo linkado for ele próprio COMPOSTO (tem components), coletar seus
      // components a partir de productMap perderia as folhas e elas nunca seriam
      // debitadas (assimetria com o restauro). Por isso, espelhando
      // order-stock-restore, carregamos um índice base sobre baseIds (itens +
      // linkados) ANTES de coletar componentIds, garantindo simetria baixa↔restauro.
      const baseIndex = await loadProductIndex(adminDb, baseIds, businessId);
      const componentIds = baseIds.flatMap(id =>
        (baseIndex.get(id)?.components || []).map(c => c.productId),
      );
      const stockIndex = componentIds.length
        ? await loadProductIndex(adminDb, [...baseIds, ...componentIds], businessId)
        : baseIndex;
      try {
        await deductStockAdmin(adminDb, stockLines, {
          businessId,
          operatorId: 'public',
          operatorName: 'Cardápio online',
          reason: `Pedido #${orderNumber}`,
          productIndex: stockIndex,
          failOnInsufficientFor: guardedStockIds,
        });
      } catch (e) {
        if (e instanceof InsufficientStockError) {
          // Detalhe (qtd disponível por SKU) só no log server-side. A resposta
          // pública lista apenas os nomes — espelha o "Esgotado" boolean da UI e
          // evita sondagem de inventário exato por visitante anônimo.
          console.warn('[PublicOrder] estoque insuficiente:', e.message);
          const names = [...new Set(e.shortages.map((s) => s.productName))].join(', ');
          throw new PublicOrderError(409, `Sem estoque para: ${names}. Atualize o carrinho e tente novamente.`);
        }
        throw e;
      }
      stockDeductedAt = now;
    }

    // ── 5c. Gift card — DÉBITO autoritativo (estoque já garantido) ───────────
    // Só agora, com o estoque deduzido, debitamos o saldo. Idempotente pela chave
    // do carrinho (ledger giftCardRedemptions/{id}_{key}): se o order.set falhar e
    // houver retry com a mesma chave, o replay devolve o valor sem re-debitar.
    if (giftCardCode?.trim()) {
      const gc = await redeemGiftCardAdmin(adminDb, {
        businessId,
        code: giftCardCode,
        amountToRedeem: payableBeforeCash,
        redemptionKey: idempotencyKey!, // garantido não-nulo pelo pré-check (4d)
        orderId: orderRef.id,
        nowIso: now,
      });
      if (gc.ok && gc.amountRedeemed > 0) {
        giftCardAmount = gc.amountRedeemed;
        giftCardId = gc.giftCardId;
        appliedGiftCardCode = gc.code;
      } else if (!gc.ok) {
        // Concorrência: cartão drenado/expirado entre o pré-check e aqui. NÃO
        // derruba o pedido (estoque já foi deduzido) — segue sem desconto do gift.
        console.warn('[PublicOrder] gift card inelegível no débito:', gc.reason);
      }
    }

    // Total AUTORITATIVO: (mercadoria + frete − cupom) − gift card, nunca negativo.
    const total = round2(Math.max(0, payableBeforeCash - giftCardAmount));

    // ── 6. Create order ──────────────────────────────────────────────────────
    const order: Omit<DeliveryOrder, 'id'> = {
      businessId,
      number: orderNumber,
      status: 'recebido',
      clientId,
      clientName: clientName.trim(),
      clientPhone: clientPhone?.replace(/\D/g, ''),
      channel: 'site',
      items: validatedItems,
      subtotal,
      deliveryFee: fee,
      ...(discount > 0 ? { discount } : {}),
      ...(couponId ? { couponId, couponCode: appliedCouponCode, couponDiscount: discount } : {}),
      ...(giftCardId && giftCardAmount > 0
        ? { giftCardId, giftCardCode: appliedGiftCardCode, giftCardAmount }
        : {}),
      total,
      deliveryType,
      deliveryAddress: deliveryType === 'entrega' ? deliveryAddress : undefined,
      paymentMethod: paymentMethod ?? 'pix',
      paymentStatus: 'pendente',
      changeFor: changeFor && changeFor > total ? changeFor : undefined,
      customerNotes: customerNotes?.slice(0, 1000) || undefined,
      trackingToken,
      ...(stockDeductedAt ? { stockDeductedAt } : {}),
      createdAt: now,
      updatedAt: now,
    };

    await orderRef.set(order);

    // ── 6b. Conta a visita só agora (pedido persistido) ──────────────────────
    // Movido para depois do set: um pedido que falhe antes daqui NÃO envelhece o
    // cliente (preserva isFirstOrder p/ cupons de 1ª compra numa retentativa).
    if (clientId) {
      await adminDb.collection('clients').doc(clientId)
        .update({ visitCount: FieldValue.increment(1) })
        .catch(() => {}); // best-effort: pedido já existe, não derruba por isso
    }

    // ── 7. WhatsApp notification to business (best-effort) ───────────────────
    notifyBusiness(businessId, orderNumber, clientName.trim(), total, deliveryType, validatedItems).catch(() => {});

        // `total` AUTORITATIVO (recomputado server-side, = subtotal + fee) devolvido
        // ao cliente: é exatamente o valor que será cobrado, fechando a janela em
        // que o front exibia o total local em vez do efetivamente persistido.
        return { orderId: orderRef.id, orderNumber, trackingToken, total, discount, giftCardAmount };
      },
    );

    return NextResponse.json(
      result,
      { status: 201, headers: rateLimitHeaders(rl, RATE_LIMIT) },
    );

  } catch (err) {
    if (err instanceof PublicOrderError || err instanceof OrdersClosedError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof IdempotencyConflictError) {
      // Mesmo carrinho ainda sendo processado (double-tap quase simultâneo).
      return NextResponse.json(
        { error: 'Pedido em processamento. Aguarde um instante.' },
        { status: 409 },
      );
    }
    console.error('[PublicOrder] Error:', err);
    return NextResponse.json({ error: 'Erro interno ao processar pedido' }, { status: 500 });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

async function notifyBusiness(
  businessId: string,
  orderNumber: number,
  clientName: string,
  total: number,
  deliveryType: DeliveryType,
  items: DeliveryOrderItem[],
) {
  try {
    const bizSnap = await adminDb.collection('businesses').doc(businessId).get();
    const biz = bizSnap.data();
    if (!biz) return;

    const totalStr = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(total);
    const modeStr = deliveryType === 'entrega' ? '🛵 Entrega' : '🏠 Retirada';

    const itemLines = items.slice(0, 8).map(i => {
      let line = `• ${i.quantity}× ${i.productName}`;
      if (i.selectedModifiers?.length) {
        const mods = i.selectedModifiers.map(m =>
          `${m.groupName}: ${m.selectedOptions.map(o => o.quantity > 1 ? `${o.quantity}× ${o.optionName}` : o.optionName).join(', ')}`
        ).join(' | ');
        line += `\n   _${mods}_`;
      }
      if (i.notes) line += `\n   📝 ${i.notes}`;
      return line;
    });
    if (items.length > 8) itemLines.push(`_...e mais ${items.length - 8} itens_`);

    const msg = `🛒 *Novo Pedido #${String(orderNumber).padStart(4, '0')}*\n👤 ${clientName}\n${modeStr}\n\n${itemLines.join('\n')}\n\n💰 *Total:* ${totalStr}\n\nPedido recebido pelo cardápio online.`;

    const baileysPhone: string | undefined = biz.channels?.baileys?.phoneNumber || biz.phone;
    if (baileysPhone) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      await fetch(`${baseUrl}/api/conversations/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId,
          channel: 'whatsapp',
          recipientPhone: baileysPhone,
          content: msg,
          isInternal: true,
        }),
      });
    }
  } catch {
    // non-critical
  }
}
