import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { checkRateLimit, getClientIp, rateLimitHeaders } from '@/lib/utils/rateLimit';
import type {
  DeliveryOrder, DeliveryOrderItem, DeliveryOrderAddress,
  DeliveryOrderPaymentMethod, DeliveryType, Client, SelectedModifier,
  Product, ProductModifierGroup, ModifierPriceStrategy,
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
}

const PRICE_TOLERANCE = 0.01;
const RATE_LIMIT = 10;        // 10 requests
const RATE_WINDOW_MS = 60_000; // per minute

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

  const { businessId, clientName, clientPhone, items, deliveryType, deliveryAddress,
    deliveryFee, paymentMethod, changeFor, customerNotes } = body;

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

  try {
    const now = new Date().toISOString();

    // ── 1. Validate business exists ──────────────────────────────────────────
    const bizRef = adminDb.collection('businesses').doc(businessId);
    const bizSnap = await bizRef.get();
    if (!bizSnap.exists) {
      return NextResponse.json({ error: 'Negócio não encontrado' }, { status: 404 });
    }

    // ── 2. Validate items + recompute prices server-side ─────────────────────
    const productIds = [...new Set(items.map(i => i.productId))];
    if (productIds.length === 0) {
      return NextResponse.json({ error: 'Itens inválidos' }, { status: 400 });
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
    for (const raw of items) {
      if (!raw.productId || typeof raw.quantity !== 'number' || raw.quantity <= 0) {
        return NextResponse.json({ error: 'Item inválido' }, { status: 400 });
      }
      const product = productMap.get(raw.productId);
      if (!product) {
        return NextResponse.json(
          { error: `Produto indisponível: ${raw.productName || raw.productId}` },
          { status: 400 },
        );
      }
      if (product.isActive === false || product.isDeliverable === false) {
        return NextResponse.json(
          { error: `Produto indisponível: ${product.name}` },
          { status: 400 },
        );
      }

      // Validate + recompute modifier pricing
      const mods = validateAndCleanModifiers(product, raw.selectedModifiers);
      if ('error' in mods) {
        return NextResponse.json({ error: mods.error }, { status: 400 });
      }

      const basePrice = product.salePrice;
      const modifierDelta = computeModifierDelta(mods.clean);
      const unitPrice = round2(basePrice + modifierDelta);
      const total = round2(unitPrice * raw.quantity);

      // Reject if client-sent total diverges beyond tolerance (front-end bug or tampering)
      if (Math.abs(raw.total - total) > PRICE_TOLERANCE * raw.quantity) {
        return NextResponse.json(
          { error: `Preço inválido para ${product.name}` },
          { status: 400 },
        );
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
    }

    // ── 3. Upsert client by phone ────────────────────────────────────────────
    let clientId: string | undefined;
    if (clientPhone) {
      const phone = clientPhone.replace(/\D/g, '');
      if (phone.length < 8) {
        return NextResponse.json({ error: 'Telefone inválido' }, { status: 400 });
      }
      const clientSnap = await adminDb
        .collection('clients')
        .where('businessId', '==', businessId)
        .where('phone', '==', phone)
        .limit(1)
        .get();

      if (!clientSnap.empty) {
        clientId = clientSnap.docs[0].id;
        await clientSnap.docs[0].ref.update({
          name: clientSnap.docs[0].data().name || clientName.trim(),
          visitCount: FieldValue.increment(1),
          lastVisit: now,
          updatedAt: now,
        });
      } else {
        const newClient: Omit<Client, 'id'> = {
          businessId,
          name: clientName.trim(),
          phone,
          whatsapp: phone,
          source: 'outro',
          status: 'novo',
          score: 0,
          isActive: true,
          visitCount: 1,
          lastVisit: now,
          createdAt: now,
          updatedAt: now,
        };
        const clientRef = await adminDb.collection('clients').add(newClient);
        clientId = clientRef.id;
      }
    }

    // ── 4. Compute totals server-side ────────────────────────────────────────
    const subtotal = round2(validatedItems.reduce((s, i) => s + i.total, 0));
    const fee = deliveryType === 'entrega' ? round2(Math.max(0, deliveryFee ?? 0)) : 0;
    const total = round2(subtotal + fee);

    // ── 5. Sequential order number (transaction-safe) ────────────────────────
    const orderNumber = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(bizRef);
      const last = (snap.data()?.lastOrderNumber as number) || 0;
      const next = last + 1;
      tx.update(bizRef, { lastOrderNumber: next, updatedAt: now });
      return next;
    });

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
      total,
      deliveryType,
      deliveryAddress: deliveryType === 'entrega' ? deliveryAddress : undefined,
      paymentMethod: paymentMethod ?? 'pix',
      paymentStatus: 'pendente',
      changeFor: changeFor && changeFor > total ? changeFor : undefined,
      customerNotes: customerNotes?.slice(0, 1000) || undefined,
      createdAt: now,
      updatedAt: now,
    };

    const orderRef = await adminDb.collection('deliveryOrders').add(order);

    // ── 7. WhatsApp notification to business (best-effort) ───────────────────
    notifyBusiness(businessId, orderNumber, clientName.trim(), total, deliveryType, validatedItems).catch(() => {});

    return NextResponse.json(
      { orderId: orderRef.id, orderNumber },
      { status: 201, headers: rateLimitHeaders(rl, RATE_LIMIT) },
    );

  } catch (err) {
    console.error('[PublicOrder] Error:', err);
    return NextResponse.json({ error: 'Erro interno ao processar pedido' }, { status: 500 });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeModifierDelta(selected: SelectedModifier[]): number {
  let delta = 0;
  for (const group of selected) {
    const prices = group.selectedOptions.map(o => o.additionalPrice * Math.max(1, o.quantity || 1));
    if (!prices.length) continue;
    delta += applyStrategy(group.priceStrategy, prices);
  }
  return delta;
}

function applyStrategy(strategy: ModifierPriceStrategy, prices: number[]): number {
  if (!prices.length) return 0;
  if (strategy === 'max') return Math.max(...prices);
  if (strategy === 'avg') return prices.reduce((s, p) => s + p, 0) / prices.length;
  return prices.reduce((s, p) => s + p, 0); // sum (default)
}

type ModifierValidation = { clean: SelectedModifier[] } | { error: string };

/**
 * Validates client-provided modifier selections against the product's
 * modifierGroups definition, rebuilding each SelectedModifier from the
 * server-side source of truth (group name, strategy, option prices).
 */
function validateAndCleanModifiers(
  product: Product,
  incoming: SelectedModifier[] | undefined,
): ModifierValidation {
  const groups = product.modifierGroups || [];
  const sel = incoming || [];

  // Required groups must be present with valid selection counts
  for (const group of groups) {
    const chosen = sel.find(s => s.groupId === group.id);
    const count = chosen?.selectedOptions.reduce((s, o) => s + Math.max(1, o.quantity || 1), 0) || 0;
    if (group.required && count < Math.max(1, group.minSelections)) {
      return { error: `Selecione ${group.name}` };
    }
    if (count > group.maxSelections && group.maxSelections > 0) {
      return { error: `Máximo ${group.maxSelections} em ${group.name}` };
    }
  }

  const clean: SelectedModifier[] = [];
  for (const chosen of sel) {
    const group = groups.find(g => g.id === chosen.groupId);
    if (!group) continue; // silently drop unknown groups
    const cleanedOptions = [];
    for (const opt of chosen.selectedOptions) {
      const srcOpt = group.options.find(o => o.id === opt.optionId);
      if (!srcOpt || srcOpt.available === false) continue;
      const qty = Math.max(1, Math.min(opt.quantity || 1, srcOpt.maxQuantity ?? 99));
      cleanedOptions.push({
        optionId: srcOpt.id,
        optionName: srcOpt.name,
        additionalPrice: srcOpt.additionalPrice,
        quantity: qty,
      });
    }
    if (cleanedOptions.length === 0) continue;
    clean.push({
      groupId: group.id,
      groupName: group.name,
      priceStrategy: group.priceStrategy,
      selectedOptions: cleanedOptions,
    });
  }

  return { clean };
}

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
