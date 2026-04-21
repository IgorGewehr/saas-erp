import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type {
  DeliveryOrder, DeliveryOrderItem, DeliveryOrderAddress,
  DeliveryOrderPaymentMethod, DeliveryType, Client, SelectedModifier,
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

export async function POST(req: NextRequest) {
  let body: PublicOrderPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { businessId, clientName, clientPhone, items, deliveryType, deliveryAddress,
    deliveryFee, paymentMethod, changeFor, customerNotes } = body;

  if (!businessId || !clientName || !items?.length || !deliveryType) {
    return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 });
  }

  try {
    const now = new Date().toISOString();

    // ── 1. Validate business exists ──────────────────────────────────────────
    const bizSnap = await adminDb.collection('businesses').doc(businessId).get();
    if (!bizSnap.exists) {
      return NextResponse.json({ error: 'Negócio não encontrado' }, { status: 404 });
    }

    // ── 2. Upsert client by phone ────────────────────────────────────────────
    let clientId: string | undefined;
    if (clientPhone) {
      const phone = clientPhone.replace(/\D/g, '');
      const clientSnap = await adminDb
        .collection('clients')
        .where('businessId', '==', businessId)
        .where('phone', '==', phone)
        .limit(1)
        .get();

      if (!clientSnap.empty) {
        clientId = clientSnap.docs[0].id;
        // Update name if missing and visitCount
        await clientSnap.docs[0].ref.update({
          name: clientSnap.docs[0].data().name || clientName,
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

    // ── 3. Generate sequential order number ──────────────────────────────────
    const counterRef = adminDb.collection('businesses').doc(businessId);
    const counterSnap = await counterRef.get();
    const lastNumber = (counterSnap.data()?.lastOrderNumber as number) || 0;
    const orderNumber = lastNumber + 1;
    await counterRef.update({ lastOrderNumber: orderNumber, updatedAt: now });

    // ── 4. Build order items ─────────────────────────────────────────────────
    const orderItems: DeliveryOrderItem[] = items.map(i => {
      const item: DeliveryOrderItem = {
        productId: i.productId,
        productName: i.productName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        total: i.total,
      };
      if (i.notes) item.notes = i.notes;
      if (i.imageUrl) item.imageUrl = i.imageUrl;
      if (i.basePrice !== undefined) item.basePrice = i.basePrice;
      if (i.selectedModifiers?.length) item.selectedModifiers = i.selectedModifiers;
      return item;
    });

    const subtotal = orderItems.reduce((s, i) => s + i.total, 0);
    const fee = deliveryType === 'entrega' ? (deliveryFee ?? 0) : 0;
    const total = subtotal + fee;

    // ── 5. Create order ──────────────────────────────────────────────────────
    const order: Omit<DeliveryOrder, 'id'> = {
      businessId,
      number: orderNumber,
      status: 'recebido',
      clientId,
      clientName: clientName.trim(),
      clientPhone: clientPhone?.replace(/\D/g, ''),
      channel: 'site',
      items: orderItems,
      subtotal,
      deliveryFee: fee,
      total,
      deliveryType,
      deliveryAddress: deliveryType === 'entrega' ? deliveryAddress : undefined,
      paymentMethod: paymentMethod ?? 'pix',
      paymentStatus: 'pendente',
      changeFor: changeFor && changeFor > total ? changeFor : undefined,
      customerNotes: customerNotes || undefined,
      createdAt: now,
      updatedAt: now,
    };

    const orderRef = await adminDb.collection('deliveryOrders').add(order);

    // ── 6. WhatsApp notification to business (best-effort) ───────────────────
    notifyBusiness(businessId, orderNumber, clientName, total, deliveryType, orderItems).catch(() => {});

    return NextResponse.json({ orderId: orderRef.id, orderNumber }, { status: 201 });

  } catch (err) {
    console.error('[PublicOrder] Error:', err);
    return NextResponse.json({ error: 'Erro interno ao processar pedido' }, { status: 500 });
  }
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

    // Build items summary (up to 8 items to keep WA message readable)
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

    // Try Baileys if connected
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
