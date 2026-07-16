/**
 * Financial due-date notification sender.
 *
 * Called by the hourly cron (app/api/agent/scheduled/run) for every active tenant.
 * Can also be triggered manually via per-tenant HMAC for testing.
 *
 * Sends:
 *  - WhatsApp reminder N days before dueDate (contas a pagar/receber, configured)
 *  - WhatsApp collection message for overdue receivables
 *  - Email via Resend for same events (if enterprise + Resend key configured)
 *
 * Idempotency:
 *  - dueSoonNotifiedAt: set on transaction after "due soon" notification sent
 *  - overdueNotifiedAt: set after overdue notification sent; re-sent if > 7 days old
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { adminDb } from '@/lib/config/firebaseAdmin';
import type { Business, FinancialNotificationSettings } from '@/lib/types';
import { formatCurrency } from '@/lib/utils/format';

const DEFAULT_SETTINGS: FinancialNotificationSettings = {
  enabled: true,
  dueSoonDays: 3,
  sendEmail: false,
  sendWhatsApp: true,
  notifyPayable: true,
  notifyReceivable: true,
};

// ─── Auth ────────────────────────────────────────────────────────────────────

type AuthResult =
  | { kind: 'cron'; businessId: string }
  | { kind: 'hmac'; businessId: string }
  | { kind: 'deny'; reason: string; status: number };

async function authorize(req: NextRequest): Promise<AuthResult> {
  const secret = process.env.CRON_SECRET;
  const bearer = req.headers.get('authorization');
  const isCron = !!req.headers.get('x-vercel-cron');

  if (secret && isCron && bearer === `Bearer ${secret}`) {
    const url = new URL(req.url);
    const businessId = url.searchParams.get('businessId') || '';
    if (!businessId) return { kind: 'deny', reason: 'businessId required for cron call', status: 400 };
    return { kind: 'cron', businessId };
  }

  if (req.headers.get('x-agent-signature')) {
    const { verifyAgentRequest, AgentAuthError } = await import('@/lib/agent/auth');
    try {
      const ctx = await verifyAgentRequest(req);
      return { kind: 'hmac', businessId: ctx.businessId };
    } catch (err) {
      if (err instanceof AgentAuthError) return { kind: 'deny', reason: err.message, status: err.status };
      return { kind: 'deny', reason: 'auth error', status: 401 };
    }
  }

  return { kind: 'deny', reason: 'unauthorized', status: 401 };
}

// ─── WhatsApp helper (same pattern as scheduled/run) ─────────────────────────

async function sendWhatsApp(
  business: Business & { id: string },
  phone: string,
  conversationId: string,
  channel: string,
  content: string,
): Promise<void> {
  const secret = process.env.AGENT_SHARED_SECRET;
  if (!secret) throw new Error('AGENT_SHARED_SECRET not configured');

  const body = JSON.stringify({ businessId: business.id, conversationId, channel, recipientId: phone, content, type: 'text' });
  const ts = Date.now();
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${business.id}.${body}`).digest('hex');

  const vercelUrl = process.env.VERCEL_URL;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const baseUrl = vercelUrl
    ? `https://${vercelUrl}`
    : appUrl || 'http://localhost:3000';

  const resp = await fetch(`${baseUrl}/api/conversations/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-agent-signature': sig,
      'x-agent-timestamp': String(ts),
      'x-business-id': business.id,
    },
    body,
  });
  if (!resp.ok) throw new Error(`WA send failed ${resp.status}`);
}

// ─── Email helper (Resend) ────────────────────────────────────────────────────

function emailDomain(email: string | undefined): string {
  if (!email || !email.includes('@')) return 'servicepro.app';
  const domain = email.split('@').pop();
  return domain && domain.includes('.') ? domain : 'servicepro.app';
}

async function sendEmail(
  business: Business & { id: string },
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const intConfig = business.enterprise?.integrations?.find(
    i => i.provider === 'resend' && i.isActive,
  );
  if (!intConfig?.apiKey) throw new Error('Resend not configured');

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${intConfig.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${business.nomeFantasia || business.razaoSocial} <noreply@${emailDomain(business.email)}>`,
      to,
      subject,
      html,
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Resend failed ${resp.status}: ${err}`);
  }
}

// ─── Notification processor ──────────────────────────────────────────────────

export async function sendFinancialNotifications(
  business: Business & { id: string },
): Promise<number> {
  const settings: FinancialNotificationSettings = {
    ...DEFAULT_SETTINGS,
    ...(business.financial?.notificationSettings ?? {}),
  };
  if (!settings.enabled) return 0;

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const dueSoonStr = new Date(now.getTime() + settings.dueSoonDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const sevenDaysAgoMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;

  let count = 0;

  // ── Pending transactions due soon ────────────────────────────────────────
  const dueSoonSnap = await adminDb.collection('transactions')
    .where('businessId', '==', business.id)
    .where('status', '==', 'pendente')
    .where('dueDate', '>', todayStr)
    .where('dueDate', '<=', dueSoonStr)
    .get();

  for (const txDoc of dueSoonSnap.docs) {
    const tx = txDoc.data();
    if (tx.dueSoonNotifiedAt) continue; // already sent

    const isPayable = tx.type === 'despesa';
    const isReceivable = tx.type === 'receita';
    if (isPayable && !settings.notifyPayable) continue;
    if (isReceivable && !settings.notifyReceivable) continue;

    const daysUntil = Math.round(
      (new Date(tx.dueDate + 'T00:00:00').getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
    );
    const daysLabel = daysUntil <= 1 ? 'amanhã' : `em ${daysUntil} dias`;
    const amount = formatCurrency(tx.amount);

    let sent = false;

    if (settings.sendWhatsApp && isReceivable && tx.clientId) {
      try {
        // Look up conversation for this client. Conversation salva o vínculo
        // como `crmContactId` (não `contactId` — esse era bug antigo: query
        // nunca achava nada). Filtra channel=whatsapp pra não pegar FB/IG.
        // Cobrança não sabe Meta vs Baileys; ordena client-side e pega a conv
        // mais recente — reflete o canal onde o cliente está ativo.
        const convSnap = await adminDb.collection('conversations')
          .where('businessId', '==', business.id)
          .where('channel', '==', 'whatsapp')
          .where('crmContactId', '==', tx.clientId)
          .limit(20)
          .get();

        if (!convSnap.empty) {
          const sortedDocs = convSnap.docs.slice().sort((a, b) => {
            const ta = (a.data().lastMessageAt as string | undefined) ?? '';
            const tb = (b.data().lastMessageAt as string | undefined) ?? '';
            return tb.localeCompare(ta);
          });
          const conv = sortedDocs[0];
          const convData = conv.data();
          const phone = (convData.contactExternalId || convData.recipientId || '').replace(/\D/g, '');
          if (phone) {
            const msg =
              `Olá ${tx.clientName?.split(' ')[0] || 'cliente'}! 😊\n` +
              `Lembramos que o pagamento de *${tx.description}* no valor de *${amount}* vence ${daysLabel}.\n` +
              `Qualquer dúvida, estamos à disposição! 🙏`;
            await sendWhatsApp(business, phone, conv.id, convData.channel, msg);
            sent = true;
          }
        }
      } catch (err) {
        console.warn(`[financial-notify] WA due-soon for tx ${txDoc.id}:`, err);
      }
    }

    if (settings.sendEmail) {
      // Fetch client email
      try {
        let clientEmail = '';
        if (tx.clientId) {
          const clientDoc = await adminDb.collection('clients').doc(tx.clientId).get();
          clientEmail = (clientDoc.data()?.email || '') as string;
        }
        if (clientEmail) {
          const subject = isReceivable
            ? `Lembrete de pagamento — ${tx.description}`
            : `Conta a pagar vence ${daysLabel} — ${tx.description}`;
          const html = `
            <p>Olá${tx.clientName ? ` ${tx.clientName.split(' ')[0]}` : ''}!</p>
            <p>${isReceivable ? 'Lembramos que o pagamento de' : 'Sua conta'} <strong>${tx.description}</strong>
            no valor de <strong>${amount}</strong> vence <strong>${daysLabel}</strong> (${tx.dueDate}).</p>
            <p>Qualquer dúvida entre em contato.</p>
            <p>— ${business.nomeFantasia || business.razaoSocial}</p>
          `;
          await sendEmail(business, clientEmail, subject, html);
          sent = true;
        }
      } catch (err) {
        console.warn(`[financial-notify] email due-soon for tx ${txDoc.id}:`, err);
      }
    }

    if (sent) {
      await txDoc.ref.update({ dueSoonNotifiedAt: now.toISOString() });
      count++;
    }
  }

  // ── Overdue receivables (cobrança) ────────────────────────────────────────
  if (settings.notifyReceivable) {
    const overdueSnap = await adminDb.collection('transactions')
      .where('businessId', '==', business.id)
      .where('type', '==', 'receita')
      .where('status', '==', 'pendente')
      .where('dueDate', '<', todayStr)
      .where('dueDate', '>', '2020-01-01')
      .get();

    for (const txDoc of overdueSnap.docs) {
      const tx = txDoc.data();
      // Re-notify only if never notified or notified > 7 days ago
      if (tx.overdueNotifiedAt && new Date(tx.overdueNotifiedAt).getTime() > sevenDaysAgoMs) continue;
      if (!tx.clientId) continue;

      const daysOverdue = Math.floor(
        (now.getTime() - new Date(tx.dueDate + 'T00:00:00').getTime()) / (24 * 60 * 60 * 1000),
      );
      const amount = formatCurrency(tx.amount);
      let sent = false;

      if (settings.sendWhatsApp) {
        try {
          // Same isolamento de canal que due-soon — vide comentário acima.
          const convSnap = await adminDb.collection('conversations')
            .where('businessId', '==', business.id)
            .where('channel', '==', 'whatsapp')
            .where('crmContactId', '==', tx.clientId)
            .limit(20)
            .get();

          if (!convSnap.empty) {
            const sortedDocs = convSnap.docs.slice().sort((a, b) => {
              const ta = (a.data().lastMessageAt as string | undefined) ?? '';
              const tb = (b.data().lastMessageAt as string | undefined) ?? '';
              return tb.localeCompare(ta);
            });
            const conv = sortedDocs[0];
            const convData = conv.data();
            const phone = (convData.contactExternalId || convData.recipientId || '').replace(/\D/g, '');
            if (phone) {
              const msg =
                `Olá ${tx.clientName?.split(' ')[0] || 'cliente'}! 👋\n` +
                `Identificamos um pagamento em aberto de *${tx.description}* no valor de *${amount}*, ` +
                `vencido há ${daysOverdue} ${daysOverdue === 1 ? 'dia' : 'dias'}.\n` +
                `Por favor, entre em contato para regularizar. Estamos à disposição! 🙏`;
              await sendWhatsApp(business, phone, conv.id, convData.channel, msg);
              sent = true;
            }
          }
        } catch (err) {
          console.warn(`[financial-notify] WA overdue for tx ${txDoc.id}:`, err);
        }
      }

      if (settings.sendEmail) {
        try {
          const clientDoc = await adminDb.collection('clients').doc(tx.clientId).get();
          const clientEmail = (clientDoc.data()?.email || '') as string;
          if (clientEmail) {
            const html = `
              <p>Olá${tx.clientName ? ` ${tx.clientName.split(' ')[0]}` : ''}!</p>
              <p>Identificamos um pagamento em aberto de <strong>${tx.description}</strong>
              no valor de <strong>${amount}</strong>, com vencimento em <strong>${tx.dueDate}</strong>
              (${daysOverdue} ${daysOverdue === 1 ? 'dia' : 'dias'} em atraso).</p>
              <p>Por favor, entre em contato para regularizar.</p>
              <p>— ${business.nomeFantasia || business.razaoSocial}</p>
            `;
            await sendEmail(business, clientEmail, `Aviso de pagamento em atraso — ${tx.description}`, html);
            sent = true;
          }
        } catch (err) {
          console.warn(`[financial-notify] email overdue for tx ${txDoc.id}:`, err);
        }
      }

      if (sent) {
        await txDoc.ref.update({ overdueNotifiedAt: now.toISOString() });
        count++;
      }
    }
  }

  return count;
}

// ─── Route handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await authorize(req);
  if (auth.kind === 'deny') {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: auth.status });
  }

  const bizDoc = await adminDb.collection('businesses').doc(auth.businessId).get();
  if (!bizDoc.exists) {
    return NextResponse.json({ ok: false, error: 'business not found' }, { status: 404 });
  }
  const business = { ...(bizDoc.data() as Business), id: bizDoc.id };

  try {
    const sent = await sendFinancialNotifications(business);
    return NextResponse.json({ ok: true, sent });
  } catch (err) {
    console.error('[financial-notify]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
