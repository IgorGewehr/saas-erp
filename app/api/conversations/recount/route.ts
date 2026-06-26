/**
 * Conversation unread counter — RECONCILE / RECOUNT
 *
 * POST /api/conversations/recount  { businessId }
 *
 * Recomputa o doc denormalizado `unreadCounters/{businessId}` a partir da VERDADE
 * (soma de `unreadCount` das conversas ATIVAS — não soft-deletadas). Usado como
 * "limpar/recontar manualmente" no painel de notificações: corrige drift do
 * agregado (badge fantasma) quando ele divergiu do real — ex: conversas com
 * não-lidas que foram soft-deletadas antes do fix de decremento no DELETE, ou
 * incrementos de webhook que falharam silenciosamente.
 *
 * Idempotente: roda quantas vezes quiser; sempre escreve o valor verdadeiro.
 * R1: query filtra businessId; verifyAuth garante que o user pertence ao tenant.
 *
 * Custo: varre as conversas do tenant (mesma lógica do scripts/backfill-unread-
 * counters.ts). É uma ação MANUAL e pouco frequente — aceitável.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { isActiveRecord } from '@/lib/utils/recordFilters';

export async function POST(req: NextRequest) {
  let body: { businessId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  const businessId = body.businessId;
  if (!businessId) {
    return NextResponse.json({ error: 'businessId é obrigatório' }, { status: 400 });
  }

  const authResult = await verifyAuth(req, businessId);
  if (isAuthError(authResult)) return authResult;

  try {
    const snap = await adminDb
      .collection('conversations')
      .where('businessId', '==', businessId)
      .get();

    let business = 0;
    let total = 0;
    const byUser: Record<string, number> = {};

    for (const d of snap.docs) {
      const data = d.data();
      if (!isActiveRecord(data)) continue; // pula soft-deletadas (causa do drift)

      const unread = Number(data.unreadCount ?? 0);
      if (!Number.isFinite(unread) || unread <= 0) continue;

      const channelOwnerType = data.channelOwnerType;
      const channelOwnerId = typeof data.channelOwnerId === 'string' ? data.channelOwnerId : '';

      if (channelOwnerType === 'user') {
        if (!channelOwnerId) continue; // espelha scopeField → null
        byUser[channelOwnerId] = (byUser[channelOwnerId] ?? 0) + unread;
      } else {
        business += unread;
      }
      total += unread;
    }

    await adminDb.doc(`unreadCounters/${businessId}`).set({
      businessId,
      business,
      byUser,
      total,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, business, total, byUser });
  } catch (err) {
    console.error('[Conversations] Erro ao recontar não-lidas:', err);
    return NextResponse.json({ error: 'Erro interno ao recontar' }, { status: 500 });
  }
}
