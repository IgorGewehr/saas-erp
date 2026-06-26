/**
 * POST /api/broadcasts/[id]/retry-failed
 *
 * Cria um novo broadcast contendo APENAS os recipientes que falharam no
 * broadcast original. O novo broadcast começa em status 'draft' (precisa
 * ser disparado depois via /api/broadcasts/send).
 *
 * Body opcional: { businessId } — usado para verificar autorização.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { checkRateLimit, checkBusinessRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { Broadcast, BroadcastMessage, BroadcastRecipient, UserRole } from '@/lib/types';

const MAX_FAILED_TO_RETRY = 1000;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Rate limit: 2 retries por minuto por IP
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`retry:${clientIp}`, 2, 60_000);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Aguarde antes de criar outro retry.' },
      { status: 429 },
    );
  }

  try {
    const { id: broadcastId } = await ctx.params;
    if (!broadcastId) {
      return NextResponse.json({ error: 'broadcastId is required' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const businessId = body.businessId as string | undefined;
    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required in body' }, { status: 400 });
    }

    const authResult = await verifyAuth(req, businessId);
    if (isAuthError(authResult)) return authResult;

    // Bloqueia viewer (somente leitura) — precisa operator+ para disparar retry
    const role = authResult.role as UserRole;
    if ((ROLE_HIERARCHY[role] || 0) < ROLE_HIERARCHY['operator']) {
      return NextResponse.json({ error: 'Forbidden — operator role required' }, { status: 403 });
    }

    // Rate limit por business (5.13): 10 retries/hora — anti-abuse
    const bizLimit = checkBusinessRateLimit('broadcast-retry', businessId, 10, 3_600_000);
    if (!bizLimit.allowed) {
      return NextResponse.json(
        { error: 'Limite de retries atingido para este negócio. Aguarde antes de tentar novamente.' },
        { status: 429 },
      );
    }

    // Busca broadcast original
    const broadcastSnap = await adminDb.collection('broadcasts').doc(broadcastId).get();
    if (!broadcastSnap.exists) {
      return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 });
    }
    const original = broadcastSnap.data() as Broadcast;
    if (original.businessId !== businessId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Busca BroadcastMessage com status 'failed' (limit defensivo)
    const failedSnap = await adminDb.collection('broadcastMessages')
      .where('broadcastId', '==', broadcastId)
      .where('status', '==', 'failed')
      .limit(MAX_FAILED_TO_RETRY)
      .get();

    if (failedSnap.empty) {
      return NextResponse.json({ error: 'No failed messages to retry' }, { status: 400 });
    }
    const truncated = failedSnap.size === MAX_FAILED_TO_RETRY;

    // Reconstrói recipients a partir das mensagens falhadas
    const recipients: BroadcastRecipient[] = failedSnap.docs.map(doc => {
      const m = doc.data() as BroadcastMessage;
      const r: BroadcastRecipient = {};
      if (m.contactId) r.contactId = m.contactId;
      if (m.contactName) r.name = m.contactName;
      if (m.email) r.email = m.email;
      else r.phoneNumber = m.recipientId;
      // 5.8: preserva customColumns para template params kind='csvColumn'
      if (m.customColumns && Object.keys(m.customColumns).length > 0) {
        r.customColumns = m.customColumns;
      }
      return r;
    });

    // Limite de tamanho (mesmo guard do create)
    const recipientsSizeEstimate = JSON.stringify(recipients).length;
    if (recipientsSizeEstimate > 800_000) {
      return NextResponse.json({
        error: `Lista de retry muito grande (${recipients.length} contatos). Limite: ~10.000.`
      }, { status: 400 });
    }

    // Cria novo broadcast em 'draft'
    const now = new Date().toISOString();
    const newBroadcastData: Record<string, unknown> = {
      businessId,
      name: `${original.name} (retry)`,
      channel: original.channel,
      audienceType: 'list',
      recipients,
      messageType: original.messageType,
      status: 'draft',
      stats: { total: recipients.length, sent: 0, delivered: 0, read: 0, failed: 0, replied: 0 },
      createdBy: authResult.uid,
      createdByName: original.createdByName || 'retry',
      retryOf: broadcastId,
      createdAt: now,
      updatedAt: now,
    };
    if (original.templateName) newBroadcastData.templateName = original.templateName;
    if (original.templateLanguage) newBroadcastData.templateLanguage = original.templateLanguage;
    if (original.templateParams) newBroadcastData.templateParams = original.templateParams;
    if (original.templateBody) newBroadcastData.templateBody = original.templateBody;
    // Header de mídia (IMAGE/VIDEO/DOCUMENT) reusa o mesmo mediaId do original
    // — TTL Meta ~30d cobre janela de retry; sem isso, retry de campanha com
    // vídeo perderia o header e Meta rejeitaria por param count mismatch (132000).
    if (original.headerMedia) newBroadcastData.headerMedia = original.headerMedia;
    if (original.messageContent) newBroadcastData.messageContent = original.messageContent;
    if (original.emailSubject) newBroadcastData.emailSubject = original.emailSubject;
    if (original.viaBaileys) newBroadcastData.viaBaileys = true;
    // 5.12 LGPD: copia base legal do original — sem isso, o /send rejeitaria
    // o retry com 400 "broadcast sem consentBasis". Atualiza ack para o
    // operador atual (auditoria de quem aprovou o retry, especificamente).
    if (original.consentBasis) {
      newBroadcastData.consentBasis = original.consentBasis;
      if (original.consentSource) newBroadcastData.consentSource = original.consentSource;
      newBroadcastData.consentAcknowledgedAt = now;
      newBroadcastData.consentAcknowledgedBy = authResult.uid;
    }

    const newRef = await adminDb.collection('broadcasts').add(newBroadcastData);

    return NextResponse.json({
      success: true,
      newBroadcastId: newRef.id,
      recipientsCount: recipients.length,
      truncated, // true se hit MAX_FAILED_TO_RETRY — usuário deve criar mais retries depois
    });
  } catch (err) {
    console.error('[Broadcast retry] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
