/**
 * POST /api/conversations/[id]/transfer-channel
 *
 * Transfere uma conversa de uma channelConnection pra outra. Útil quando:
 *  - Admin quer mover conversa do canal-empresa pro pessoal de um operador
 *    (ex: lead VIP que deve ser atendido só por uma pessoa)
 *  - Operador A quer passar a conversa pra operador B continuar pelo
 *    canal pessoal dele
 *  - Empresa decide consolidar conversas num único número
 *
 * Body:
 *   - businessId (required)
 *   - targetConnectionId (required) — id da channelConnection destino
 *   - sendNotice (optional) — se true, envia mensagem de aviso ao contato
 *   - noticeText (optional) — texto do aviso (default genérico)
 *
 * Permissões:
 *   - Operador autenticado + role >= operator
 *   - Deve poder ACESSAR a connection alvo (business OU própria 'user' OU admin)
 *   - Conexão alvo deve estar isConnected=true
 *
 * Side effects:
 *   - Atualiza conversation.channelConnectionId
 *   - Adiciona entry em assignmentHistory pra auditoria
 *   - Se sendNotice=true, envia mensagem aviso pelo canal NOVO
 *   - Atualiza assignedTo pro owner do canal pessoal (se for 'user')
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { ROLE_HIERARCHY } from '@/lib/types';
import { canUserAccessConnection } from '@/lib/services/channels/channelConnections';
import type { ChannelConnection, Conversation, UserRole } from '@/lib/types';

const DEFAULT_NOTICE = 'Olá! A partir de agora vou te atender por este número.';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`transfer-channel:${clientIp}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Aguarde antes de transferir outra conversa.' }, { status: 429 });
  }

  try {
    const { id: conversationId } = await ctx.params;
    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId required' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const businessId = body.businessId as string | undefined;
    const targetConnectionId = body.targetConnectionId as string | undefined;
    const sendNotice = !!body.sendNotice;
    const noticeText = (body.noticeText as string | undefined)?.trim() || DEFAULT_NOTICE;

    if (!businessId || !targetConnectionId) {
      return NextResponse.json({ error: 'businessId and targetConnectionId required' }, { status: 400 });
    }

    const authResult = await verifyAuth(req, businessId);
    if (isAuthError(authResult)) return authResult;
    const role = (authResult.role || 'viewer') as UserRole;
    const uid = authResult.uid;
    if ((ROLE_HIERARCHY[role] || 0) < ROLE_HIERARCHY['operator']) {
      return NextResponse.json({ error: 'Forbidden — operator role required' }, { status: 403 });
    }

    // Carrega conversation
    const convRef = adminDb.collection('conversations').doc(conversationId);
    const convSnap = await convRef.get();
    if (!convSnap.exists) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    const conv = { ...(convSnap.data() as Conversation), id: convSnap.id };
    if (conv.businessId !== businessId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // No-op: já está nesse canal
    if (conv.channelConnectionId === targetConnectionId) {
      return NextResponse.json({
        success: true,
        message: 'Conversa já está neste canal — sem mudanças.',
        noChange: true,
      });
    }

    // Carrega connection alvo
    const targetSnap = await adminDb.collection('channelConnections').doc(targetConnectionId).get();
    if (!targetSnap.exists) {
      return NextResponse.json({ error: 'Canal destino não encontrado' }, { status: 404 });
    }
    const target = { ...(targetSnap.data() as ChannelConnection), id: targetSnap.id };
    if (target.businessId !== businessId) {
      return NextResponse.json({ error: 'Canal destino pertence a outro negócio' }, { status: 403 });
    }
    if (!canUserAccessConnection(target, { uid, role: role as string })) {
      return NextResponse.json({
        error: 'Você não tem acesso ao canal destino.',
      }, { status: 403 });
    }
    if (!target.isActive || !target.isConnected) {
      return NextResponse.json({
        error: 'Canal destino está desconectado. Conecte-o antes de transferir conversas pra ele.',
      }, { status: 400 });
    }
    // Cross-channel-type não permitido (transferir Cloud→Baileys ou vice versa
    // muda o transporte completamente; cliente perde contexto de número).
    // Tem que permitir entre Cloud e Baileys do mesmo número? Por enquanto não.
    const convCurrentType = conv.connectedVia === 'baileys' ? 'whatsapp_baileys' : 'whatsapp_cloud';
    if (target.type !== convCurrentType) {
      // Permite só se mantém o mesmo tipo (Baileys → Baileys ou Cloud → Cloud)
      return NextResponse.json({
        error: `Não é possível transferir entre tipos diferentes (${convCurrentType} → ${target.type}). O contato vê números/identidades distintas.`,
      }, { status: 400 });
    }

    const now = new Date().toISOString();
    const userSnap = await adminDb.collection('users').doc(uid).get();
    const userName = (userSnap.data()?.name as string) || '';

    // Atualiza conversation
    const updates: Record<string, unknown> = {
      channelConnectionId: targetConnectionId,
      updatedAt: now,
    };

    // Se canal destino é 'user', auto-assign pro owner (consistência com auto-
    // assign do handleInboundMessage)
    if (target.ownerType === 'user' && target.ownerId) {
      updates.assignedTo = target.ownerId;
      try {
        const ownerSnap = await adminDb.collection('users').doc(target.ownerId).get();
        const ownerName = ownerSnap.data()?.name as string | undefined;
        if (ownerName) updates.assignedToName = ownerName;
      } catch { /* opcional */ }
    }

    // assignmentHistory (campo já existente)
    const newHistoryEntry = {
      assignedTo: updates.assignedTo as string | undefined,
      assignedToName: updates.assignedToName as string | undefined,
      transferredFromConnectionId: conv.channelConnectionId || null,
      transferredToConnectionId: targetConnectionId,
      transferredBy: uid,
      transferredByName: userName,
      transferredAt: now,
      method: 'channel_transfer' as const,
    };
    const existingHistory = (conv.assignmentHistory || []) as unknown[];
    updates.assignmentHistory = [...existingHistory, newHistoryEntry];

    await convRef.update(updates);

    // Opcionalmente envia aviso pelo canal NOVO. Não-bloqueante: se falhar,
    // a transferência ainda foi efetuada.
    let noticeResult: { sent: boolean; error?: string } = { sent: false };
    if (sendNotice) {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${process.env.PORT || 3000}`;
        const token = req.headers.get('authorization');
        const sendRes = await fetch(`${baseUrl}/api/conversations/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: token } : {}),
          },
          body: JSON.stringify({
            businessId,
            conversationId,
            channel: 'whatsapp',
            recipientId: conv.contactExternalId,
            content: noticeText,
            type: 'text',
          }),
        });
        if (sendRes.ok) {
          noticeResult = { sent: true };
        } else {
          const data = await sendRes.json().catch(() => ({}));
          noticeResult = { sent: false, error: data.error || `HTTP ${sendRes.status}` };
        }
      } catch (err) {
        noticeResult = { sent: false, error: err instanceof Error ? err.message : 'Erro de envio' };
      }
    }

    return NextResponse.json({
      success: true,
      conversationId,
      newConnectionId: targetConnectionId,
      newAssignedTo: updates.assignedTo || null,
      notice: noticeResult,
      message: noticeResult.sent
        ? 'Conversa transferida e aviso enviado ao contato.'
        : sendNotice
          ? `Conversa transferida (aviso falhou: ${noticeResult.error || 'desconhecido'}).`
          : 'Conversa transferida.',
    });
  } catch (err) {
    console.error('[transfer-channel] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
