import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import { sessions } from '@/app/api/whatsapp/baileys-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface InteractiveRow {
  id: string;
  title: string;
  description?: string;
}

interface InteractiveSection {
  title: string;
  rows: InteractiveRow[];
}

interface SendInteractiveParams {
  conversation_id: string;
  title: string;
  body: string;
  footer?: string;
  button_text: string;
  sections: InteractiveSection[];
}

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await verifyAgentRequest(req);
  } catch (err) {
    const resp = agentAuthErrorResponse(err);
    if (resp) return resp;
    throw err;
  }

  const body = parseAgentBody<{ action: string; params: SendInteractiveParams }>(ctx.rawBody);
  const { businessId } = ctx;
  const p = body.params;

  if (!p.conversation_id || !p.title || !p.body || !p.button_text || !p.sections?.length) {
    return NextResponse.json({ ok: false, error: 'conversation_id, title, body, button_text, sections required' }, { status: 400 });
  }

  try {
    // Look up conversation to get channel + phone
    const convSnap = await adminDb.collection('conversations').doc(p.conversation_id).get();
    if (!convSnap.exists) {
      return NextResponse.json({ ok: false, error: 'Conversation not found' }, { status: 404 });
    }
    const conv = convSnap.data()!;

    if (conv.businessId !== businessId) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    // Only supported on Baileys channel — Cloud API não suporta interactive lists
    const isBaileys = conv.channel === 'whatsapp' && conv.connectedVia === 'baileys';
    // sessions são keyed por connectionId, não businessId
    const convConnectionId = conv.channelConnectionId as string | undefined;
    let session = null;
    if (isBaileys) {
      // Tenta a connection específica da conversa primeiro (Phase 2)
      if (convConnectionId) session = sessions.get(convConnectionId) ?? null;
      // Fallback para primary business connection
      if (!session) {
        const { ensurePrimaryBaileysBusinessConnection } = await import('@/lib/services/channels/channelConnections');
        const primary = await ensurePrimaryBaileysBusinessConnection(businessId);
        session = sessions.get(primary.id) ?? null;
      }
    }

    let externalMessageId = `interactive_${Date.now()}`;

    if (session?.sock && session.isConnected) {
      // Resolve phone → JID
      let phoneNumber: string | null = null;
      if (conv.contactPhone) {
        const stripped = (conv.contactPhone as string).replace(/[^0-9]/g, '');
        if (stripped.length >= 10 && stripped.length <= 13) phoneNumber = stripped;
      }
      if (!phoneNumber && conv.contactExternalId) {
        const ext = (conv.contactExternalId as string).replace(/[^0-9]/g, '');
        if (/^55\d{10,11}$/.test(ext)) phoneNumber = ext;
      }

      if (phoneNumber) {
        const candidateJid = `${phoneNumber}@s.whatsapp.net`;
        let targetJid = candidateJid;
        try {
          const [result] = await session.sock.onWhatsApp(candidateJid);
          if (result?.exists && result.jid) targetJid = result.jid;
        } catch { /* use candidateJid */ }

        // Try interactive list first; fall back to plain text if WhatsApp blocks it.
        let sent: { key?: { id?: string } } | null = null;
        try {
          sent = await session.sock.sendMessage(targetJid, {
            listMessage: {
              title: p.title,
              text: p.body,
              footerText: p.footer || '',
              buttonText: p.button_text,
              listType: 1, // SINGLE_SELECT
              sections: p.sections.map(s => ({
                title: s.title,
                rows: s.rows.map(r => ({
                  title: r.title,
                  description: r.description || '',
                  rowId: r.id,
                })),
              })),
            },
          });
        } catch (listErr) {
          console.warn('[send-interactive] listMessage blocked, falling back to plain text:', (listErr as Error).message);
          // Plain-text fallback: numbered times only — no redundant service/price per line.
          // The user types the number or the time string; agent picks it up from context.
          const lines: string[] = [p.body, ''];
          let rowIndex = 1;
          for (const section of p.sections) {
            lines.push(`*${section.title}*`);
            for (const row of section.rows) {
              lines.push(`${rowIndex}. ${row.title}`);
              rowIndex++;
            }
          }
          if (p.footer) lines.push('', p.footer);
          sent = await session.sock.sendMessage(targetJid, { text: lines.join('\n') });
        }
        externalMessageId = sent?.key?.id || externalMessageId;
      }
    }
    // else: non-Baileys or disconnected — silently skip send (message still saved to Firestore for UI)

    // Save to conversationMessages so it appears in the UI
    const now = new Date().toISOString();
    const displayContent = p.body; // show body text in conversation list
    await adminDb.collection('conversationMessages').add({
      conversationId: p.conversation_id,
      businessId,
      channel: conv.channel,
      direction: 'outbound',
      content: displayContent,
      status: 'sent',
      senderName: 'IA',
      externalMessageId,
      sentAt: now,
      createdAt: now,
    });
    await adminDb.collection('conversations').doc(p.conversation_id).update({
      lastMessage: displayContent,
      lastMessageAt: now,
      lastMessageDirection: 'outbound',
      updatedAt: now,
    });

    return NextResponse.json({ ok: true, data: { externalMessageId } });
  } catch (err) {
    console.error('[send-interactive]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
