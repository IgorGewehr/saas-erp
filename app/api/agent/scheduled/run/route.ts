/**
 * Scheduled automation runner — fires reminders, confirmation asks, and
 * follow-ups for appointments.
 *
 * Two ways to trigger:
 *
 *  1. Vercel Cron (cross-tenant sweep, hourly)
 *     Headers: `Authorization: Bearer ${CRON_SECRET}` + `x-vercel-cron: 1`
 *     No `?businessId` — processes every active tenant.
 *
 *  2. Per-tenant HMAC (manual / per-business trigger)
 *     Standard agent HMAC headers (x-agent-signature, x-agent-timestamp,
 *     x-business-id); body can be empty. Processes only the caller's tenant.
 *
 * Rate-limited per IP to avoid accidental floods on manual triggers.
 * Per-appointment idempotency guaranteed by *SentAt timestamps on the doc.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, AgentAuthError } from '@/lib/agent/auth';
import { checkRateLimit, getClientIp, rateLimitHeaders } from '@/lib/utils/rateLimit';
import { sendFinancialNotifications } from '@/app/api/financial/notify/service';
import type { Appointment, Business, Conversation } from '@/lib/types';

const RATE_LIMIT = 4;              // max 4 manual triggers
const RATE_WINDOW_MS = 60 * 60_000; // per hour per IP

type AuthResult =
  | { kind: 'cron' }
  | { kind: 'tenant'; businessId: string }
  | { kind: 'deny'; reason: string; status: number };

async function authorize(req: NextRequest): Promise<AuthResult> {
  // ── Path A: Vercel cron (cross-tenant) ──────────────────────────────────────
  const secret = process.env.CRON_SECRET;
  const bearer = req.headers.get('authorization');
  const hasVercelCronHeader = !!req.headers.get('x-vercel-cron');
  if (secret && hasVercelCronHeader && bearer === `Bearer ${secret}`) {
    return { kind: 'cron' };
  }

  // ── Path B: Per-tenant HMAC (manual trigger) ────────────────────────────────
  // Only attempt HMAC if the agent headers are present; otherwise we fall through
  // to deny so we don't consume the request body prematurely.
  if (req.headers.get('x-agent-signature')) {
    try {
      const ctx = await verifyAgentRequest(req);
      return { kind: 'tenant', businessId: ctx.businessId };
    } catch (err) {
      if (err instanceof AgentAuthError) {
        return { kind: 'deny', reason: err.message, status: err.status };
      }
      return { kind: 'deny', reason: 'auth error', status: 401 };
    }
  }

  return { kind: 'deny', reason: 'unauthorized', status: 401 };
}

function isRelevantForScheduling(b: Business): boolean {
  const agenda = b.settings?.aiAgent?.agenda;
  const hasReminders = agenda?.sendReminder || agenda?.confirmationBeforeAppointment || agenda?.followUpAfter;
  const hasAgent = b.settings?.aiAgent?.enabled;
  return !!(hasReminders || hasAgent);
}

interface RunStats {
  remindersSent: number;
  confirmationsAsked: number;
  followUpsSent: number;
  businessesProcessed: number;
  financialNotifsSent: number;
  errors: Array<{ appointmentId: string; phase: string; error: string }>;
}

async function runSweep(req: NextRequest): Promise<NextResponse> {
  const auth = await authorize(req);
  if (auth.kind === 'deny') {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: auth.status });
  }

  // Per-IP rate limit for manual triggers. Cron runs inside Vercel's infra and
  // isn't limited — the schedule itself gates frequency.
  if (auth.kind === 'tenant') {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`scheduled-run:${ip}:${auth.businessId}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: 'Rate limit exceeded' },
        { status: 429, headers: rateLimitHeaders(rl, RATE_LIMIT) },
      );
    }
  }

  const stats: RunStats = {
    remindersSent: 0,
    confirmationsAsked: 0,
    followUpsSent: 0,
    businessesProcessed: 0,
    financialNotifsSent: 0,
    errors: [],
  };

  try {
    let targets: Array<Business & { id: string }> = [];

    if (auth.kind === 'cron') {
      const bizSnap = await adminDb.collection('businesses').get();
      targets = bizSnap.docs
        .map(d => ({ ...(d.data() as Business), id: d.id }))
        .filter(isRelevantForScheduling);
    } else {
      const bizDoc = await adminDb.collection('businesses').doc(auth.businessId).get();
      if (!bizDoc.exists) {
        return NextResponse.json({ ok: false, error: 'business not found' }, { status: 404 });
      }
      const b = { ...(bizDoc.data() as Business), id: bizDoc.id };
      if (isRelevantForScheduling(b)) targets = [b];
    }

    for (const business of targets) {
      await processBusiness(business, stats);
      stats.businessesProcessed++;
    }

    // Cross-tenant sweeps run only on cron invocations — gating by auth.kind
    // prevents a single tenant's HMAC trigger from scanning every business.
    let kanbanNotifs = 0;
    let recurringGenerated = 0;
    let automationsRun = 0;
    if (auth.kind === 'cron') {
      try {
        kanbanNotifs = await checkKanbanDueDates();
      } catch (err) {
        console.warn('[scheduled] kanban check failed:', err);
      }
      try {
        recurringGenerated = await generateRecurringTransactions();
      } catch (err) {
        console.warn('[scheduled] recurring transactions failed:', err);
      }
      try {
        automationsRun = await processCRMAutomations();
      } catch (err) {
        console.warn('[scheduled] CRM automations failed:', err);
      }
      // Financial due-date notifications — run per business (cron already has targets)
      try {
        for (const biz of targets) {
          const n = await sendFinancialNotifications(biz);
          stats.financialNotifsSent += n;
        }
      } catch (err) {
        console.warn('[scheduled] financial notifications failed:', err);
      }
    }

    return NextResponse.json({ ok: true, data: { ...stats, kanbanNotifs, recurringGenerated, automationsRun } });
  } catch (err) {
    console.error('[scheduled] fatal:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal error', partialStats: stats },
      { status: 500 },
    );
  }
}

// ─── Kanban due-date notification sweep ─────────────────────────────────────

async function checkKanbanDueDates(): Promise<number> {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Fetch cards due today or tomorrow that haven't been notified yet
  const cardsSnap = await adminDb.collection('kanbanCards')
    .where('dueDate', '>=', todayStr)
    .where('dueDate', '<=', in24h)
    .get();

  // Fetch overdue cards (due before today)
  const overdueSnap = await adminDb.collection('kanbanCards')
    .where('dueDate', '<', todayStr)
    .where('dueDate', '>', '2020-01-01')
    .get();

  let count = 0;
  const batch = adminDb.batch();
  const notifBatch = adminDb.batch();

  // Due soon notifications
  for (const cardDoc of cardsSnap.docs) {
    const card = cardDoc.data();
    if (card.dueSoonNotifiedAt) continue; // already notified
    const assignees: string[] = card.assigneeIds || [];
    if (assignees.length === 0) continue;

    for (const uid of assignees) {
      const notifRef = adminDb.collection('notifications').doc();
      notifBatch.set(notifRef, {
        businessId: card.businessId,
        userId: uid,
        type: 'task_due_soon',
        title: 'Tarefa vencendo',
        body: `"${card.title}" vence ${card.dueDate === todayStr ? 'hoje' : 'amanhã'}`,
        isRead: false,
        link: 'Kanban',
        relatedId: cardDoc.id,
        createdAt: now.toISOString(),
      });
      count++;
    }
    batch.update(cardDoc.ref, { dueSoonNotifiedAt: now.toISOString() });
  }

  // Overdue notifications
  for (const cardDoc of overdueSnap.docs) {
    const card = cardDoc.data();
    if (card.overdueNotifiedAt) continue; // already notified
    const assignees: string[] = card.assigneeIds || [];
    if (assignees.length === 0) continue;

    for (const uid of assignees) {
      const notifRef = adminDb.collection('notifications').doc();
      notifBatch.set(notifRef, {
        businessId: card.businessId,
        userId: uid,
        type: 'task_overdue',
        title: 'Tarefa atrasada',
        body: `"${card.title}" venceu em ${card.dueDate}`,
        isRead: false,
        link: 'Kanban',
        relatedId: cardDoc.id,
        createdAt: now.toISOString(),
      });
      count++;
    }
    batch.update(cardDoc.ref, { overdueNotifiedAt: now.toISOString() });
  }

  if (count > 0) {
    await notifBatch.commit();
    await batch.commit();
  }

  return count;
}

// ─── Per-business sweep ──────────────────────────────────────────────────────

async function processBusiness(business: Business & { id: string }, stats: RunStats): Promise<void> {
  const agenda = business.settings?.aiAgent?.agenda;
  if (!agenda) return;

  const now = new Date();
  const nowMs = now.getTime();

  const startOfWindow = new Date(nowMs - 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const endOfWindow = new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const snap = await adminDb.collection('appointments')
    .where('businessId', '==', business.id)
    .where('date', '>=', startOfWindow)
    .where('date', '<=', endOfWindow)
    .get();

  for (const doc of snap.docs) {
    const appt = { ...(doc.data() as Appointment), id: doc.id };
    if (appt.status === 'cancelado') continue;
    const apptAt = new Date(`${appt.date}T${appt.startTime}:00`);
    const diffMs = apptAt.getTime() - nowMs;
    const diffHours = diffMs / (60 * 60 * 1000);

    // ── Reminder ──
    if (agenda.sendReminder && !appt.reminderSentAt && diffHours > 0) {
      const target = agenda.reminderHoursBefore || 24;
      if (diffHours <= target && diffHours > target - 1) {
        try {
          const msg = `Olá ${firstName(appt.clientName)}! Lembrete: você tem ${appt.serviceName} marcado ${diffHours < 2 ? 'em breve' : 'amanhã'} às ${appt.startTime}. Até lá! 📅`;
          await sendToContact(business, appt, msg);
          await doc.ref.update({ reminderSentAt: new Date().toISOString() });
          stats.remindersSent++;
        } catch (err) {
          stats.errors.push({ appointmentId: appt.id, phase: 'reminder', error: String(err) });
        }
      }
    }

    // ── Confirmation request (24–26h before) ──
    if (agenda.confirmationBeforeAppointment && !appt.confirmationRequestedAt && diffHours > 0) {
      if (diffHours <= 26 && diffHours >= 24 && appt.status !== 'confirmado') {
        try {
          const msg = `Oi ${firstName(appt.clientName)}, posso confirmar seu horário de ${appt.serviceName} amanhã às ${appt.startTime}? Responda "confirmo" para reservar ou "cancelar" caso precise desmarcar.`;
          await sendToContact(business, appt, msg);
          await doc.ref.update({ confirmationRequestedAt: new Date().toISOString() });
          stats.confirmationsAsked++;
        } catch (err) {
          stats.errors.push({ appointmentId: appt.id, phase: 'confirmation', error: String(err) });
        }
      }
    }

    // ── Follow-up (12–24h after appointment ended, only if completed) ──
    if (agenda.followUpAfter && !appt.followUpSentAt && appt.status === 'concluido') {
      const apptEndAt = new Date(`${appt.date}T${appt.endTime}:00`);
      const hoursAfter = (nowMs - apptEndAt.getTime()) / (60 * 60 * 1000);
      if (hoursAfter >= 12 && hoursAfter <= 36) {
        try {
          const msg = `Oi ${firstName(appt.clientName)}! Como foi seu ${appt.serviceName}? Ficamos à disposição para qualquer coisa. 🙏`;
          await sendToContact(business, appt, msg);
          await doc.ref.update({ followUpSentAt: new Date().toISOString() });
          stats.followUpsSent++;
        } catch (err) {
          stats.errors.push({ appointmentId: appt.id, phase: 'follow-up', error: String(err) });
        }
      }
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function firstName(full: string): string {
  return (full || '').trim().split(/\s+/)[0] || '';
}

async function sendToContact(business: Business & { id: string }, appt: Appointment, content: string): Promise<void> {
  const phoneDigits = (appt.clientPhone || '').replace(/\D/g, '');
  if (!phoneDigits) throw new Error('no phone');

  const convSnap = await adminDb.collection('conversations')
    .where('businessId', '==', business.id)
    .where('contactExternalId', '==', phoneDigits)
    .orderBy('lastMessageAt', 'desc')
    .limit(1)
    .get();

  if (convSnap.empty) throw new Error('no conversation found for phone');
  const conv = { ...(convSnap.docs[0].data() as Conversation), id: convSnap.docs[0].id };

  const secret = process.env.AGENT_SHARED_SECRET;
  if (!secret) throw new Error('AGENT_SHARED_SECRET not configured');

  const body = JSON.stringify({
    businessId: business.id,
    conversationId: conv.id,
    channel: conv.channel,
    recipientId: phoneDigits,
    content,
    type: 'text',
  });
  const ts = Date.now();
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${business.id}.${body}`).digest('hex');

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL || process.env.NEXT_PUBLIC_APP_URL?.replace(/^https?:\/\//, '')}`
    : 'http://localhost:3000';

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
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`send failed ${resp.status}: ${text}`);
  }
}

// ─── Recurring transaction generation ───────────────────────────────────────

function advanceDate(dateStr: string, frequency: string, dayOfMonth?: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  switch (frequency) {
    case 'weekly':    d.setDate(d.getDate() + 7); break;
    case 'biweekly':  d.setDate(d.getDate() + 14); break;
    case 'monthly':   
      d.setMonth(d.getMonth() + 1); 
      if (dayOfMonth) d.setDate(dayOfMonth);
      break;
    case 'quarterly': 
      d.setMonth(d.getMonth() + 3); 
      if (dayOfMonth) d.setDate(dayOfMonth);
      break;
    case 'yearly':    
      d.setFullYear(d.getFullYear() + 1); 
      if (dayOfMonth) d.setDate(dayOfMonth);
      break;
  }
  return d.toISOString().slice(0, 10);
}

async function generateRecurringTransactions(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);

  // Find all transactions with active recurrence whose nextDueDate <= today
  const snap = await adminDb.collection('transactions')
    .where('recurrence.isActive', '==', true)
    .where('recurrence.nextDueDate', '<=', today)
    .get();

  let count = 0;
  for (const txDoc of snap.docs) {
    const tx = txDoc.data();
    const rec = tx.recurrence;
    if (!rec || !rec.isActive) continue;

    // Check end date
    if (rec.endDate && rec.nextDueDate > rec.endDate) {
      await txDoc.ref.update({ 'recurrence.isActive': false });
      continue;
    }

    try {
      const now = new Date().toISOString();
      const newNextDue = advanceDate(rec.nextDueDate, rec.frequency, rec.dayOfMonth);

      // Create new transaction copy
      const { recurrence: _r, ...baseTx } = tx;
      await adminDb.collection('transactions').add({
        ...baseTx,
        dueDate: rec.nextDueDate,
        paymentDate: null,
        status: 'pendente',
        recurrenceId: txDoc.id,
        recurrence: null,
        createdAt: now,
        updatedAt: now,
      });

      const shouldDeactivate = rec.endDate && newNextDue > rec.endDate;
      await txDoc.ref.update({
        'recurrence.nextDueDate': shouldDeactivate ? rec.nextDueDate : newNextDue,
        'recurrence.isActive': !shouldDeactivate,
      });

      count++;
    } catch (err) {
      console.warn(`[recurring] failed for tx ${txDoc.id}:`, err);
    }
  }

  return count;
}

// ─── CRM Automation Rules Engine ────────────────────────────────────────────

function matchesCondition(client: Record<string, unknown>, cond: { field: string; operator: string; value: string | number }): boolean {
  const fieldValue = client[cond.field];
  switch (cond.operator) {
    case 'gt': return typeof fieldValue === 'number' && fieldValue > Number(cond.value);
    case 'lt': return typeof fieldValue === 'number' && fieldValue < Number(cond.value);
    case 'eq': return String(fieldValue) === String(cond.value);
    case 'contains': return Array.isArray(fieldValue) && fieldValue.includes(String(cond.value));
    case 'not_contains': return Array.isArray(fieldValue) && !fieldValue.includes(String(cond.value));
    default: return false;
  }
}

function daysSince(isoDate: string | undefined | null): number {
  if (!isoDate) return 9999;
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / (24 * 60 * 60 * 1000));
}

async function processCRMAutomations(): Promise<number> {
  const rulesSnap = await adminDb.collection('automationRules')
    .where('isActive', '==', true)
    .get();

  if (rulesSnap.empty) return 0;

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  let totalActions = 0;

  // Group rules by business to batch-fetch clients
  const rulesByBiz = new Map<string, Array<{ id: string; data: Record<string, unknown> }>>();
  for (const rDoc of rulesSnap.docs) {
    const r = rDoc.data();
    const biz = r.businessId as string;
    if (!rulesByBiz.has(biz)) rulesByBiz.set(biz, []);
    rulesByBiz.get(biz)!.push({ id: rDoc.id, data: r });
  }

  for (const [businessId, rules] of rulesByBiz.entries()) {
    // Fetch all clients for this business
    const clientsSnap = await adminDb.collection('clients')
      .where('businessId', '==', businessId)
      .get();

    const clients = clientsSnap.docs.map(d => ({ ...d.data(), id: d.id } as Record<string, unknown> & { id: string }));

    for (const rule of rules) {
      const r = rule.data;
      const trigger = r.trigger as string;
      const triggerConfig = (r.triggerConfig || {}) as Record<string, unknown>;
      const conditions = (r.conditions || []) as Array<{ field: string; operator: string; value: string | number }>;
      const actions = (r.actions || []) as Array<{ type: string; value: string }>;

      // Idempotency: skip if already ran today
      const lastRun = (r.lastRunAt as string) || '';
      if (lastRun.startsWith(today)) continue;

      let matchedClients: Array<Record<string, unknown>> = [];

      switch (trigger) {
        case 'client_inactive': {
          const inactiveDays = Number(triggerConfig.inactiveDays || 30);
          matchedClients = clients.filter(c =>
            daysSince(c.lastVisit as string) >= inactiveDays &&
            daysSince(c.lastContactAt as string) >= inactiveDays
          );
          break;
        }
        case 'client_birthday': {
          matchedClients = clients.filter(c => {
            const bday = c.birthday as string;
            if (!bday) return false;
            return bday.slice(5) === today.slice(5); // MM-DD match
          });
          break;
        }
        case 'high_churn_risk': {
          const threshold = Number(triggerConfig.threshold || 70);
          matchedClients = clients.filter(c => {
            const scores = c.scores as Record<string, number> | undefined;
            return scores && (scores.churnRisk || 0) >= threshold;
          });
          break;
        }
        case 'new_lead': {
          // New leads created today
          matchedClients = clients.filter(c => {
            const created = c.createdAt as string;
            return created && created.startsWith(today);
          });
          break;
        }
        case 'post_appointment': {
          // Clients with completed appointments in the last X hours
          const hoursAfter = Number(triggerConfig.hoursAfter || 24);
          const cutoff = new Date(now.getTime() - hoursAfter * 60 * 60 * 1000).toISOString();
          const recentAppts = await adminDb.collection('appointments')
            .where('businessId', '==', businessId)
            .where('status', '==', 'concluido')
            .where('updatedAt', '>=', cutoff)
            .get();
          const clientIds = new Set(recentAppts.docs.map(d => d.data().clientId as string).filter(Boolean));
          matchedClients = clients.filter(c => clientIds.has(c.id));
          break;
        }
        case 'lifecycle_change': {
          // Clients whose lifecycleStage matches the configured stage
          const targetStage = triggerConfig.stage as string;
          if (!targetStage) break;
          matchedClients = clients.filter(c => c.lifecycleStage === targetStage);
          break;
        }
        default:
          continue;
      }

      // Apply AND conditions
      matchedClients = matchedClients.filter(c =>
        conditions.every(cond => matchesCondition(c, cond))
      );

      if (matchedClients.length === 0) {
        // Still mark as ran to avoid re-checking
        await adminDb.collection('automationRules').doc(rule.id).update({
          lastRunAt: now.toISOString(),
        });
        continue;
      }

      // Execute actions for each matched client
      for (const client of matchedClients) {
        for (const action of actions) {
          try {
            switch (action.type) {
              case 'add_tag': {
                const tags = (client.tags as string[]) || [];
                if (!tags.includes(action.value)) {
                  await adminDb.collection('clients').doc(client.id as string).update({
                    tags: [...tags, action.value],
                    updatedAt: now.toISOString(),
                  });
                }
                break;
              }
              case 'change_lifecycle': {
                await adminDb.collection('clients').doc(client.id as string).update({
                  lifecycleStage: action.value,
                  updatedAt: now.toISOString(),
                });
                break;
              }
              case 'notify_team': {
                // Notify all admins of the business
                const usersSnap = await adminDb.collection('users')
                  .where('businessId', '==', businessId)
                  .get();
                const batch = adminDb.batch();
                for (const u of usersSnap.docs) {
                  const notifRef = adminDb.collection('notifications').doc();
                  batch.set(notifRef, {
                    businessId,
                    userId: u.id,
                    type: 'task_assigned',
                    title: action.value || 'Automação CRM',
                    body: `${(client.name as string) || 'Contato'} — ${r.name || 'regra'}`,
                    isRead: false,
                    link: 'CRM',
                    relatedId: client.id,
                    createdAt: now.toISOString(),
                  });
                }
                await batch.commit();
                break;
              }
              case 'send_whatsapp': {
                // Find conversation for this client
                const phone = ((client.phone as string) || '').replace(/\D/g, '');
                if (!phone) break;
                const convSnap = await adminDb.collection('conversations')
                  .where('businessId', '==', businessId)
                  .where('contactExternalId', '==', phone)
                  .limit(1)
                  .get();
                if (convSnap.empty) break;
                const conv = convSnap.docs[0].data();

                // Replace template variables
                let msg = action.value;
                msg = msg.replace(/\{\{nome\}\}/g, (client.name as string) || '');
                msg = msg.replace(/\{\{primeiro_nome\}\}/g, ((client.name as string) || '').split(' ')[0]);

                const secret = process.env.AGENT_SHARED_SECRET;
                if (!secret) break;

                const ts = Date.now().toString();
                const bodyStr = JSON.stringify({
                  businessId,
                  conversationId: convSnap.docs[0].id,
                  channel: conv.channel || 'whatsapp',
                  recipientId: phone,
                  content: msg,
                  type: 'text',
                });
                const sig = crypto.createHmac('sha256', secret).update(`${ts}.${businessId}.${bodyStr}`).digest('hex');

                const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL || 'localhost:3000'}`;
                await fetch(`${baseUrl}/api/conversations/send`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-agent-signature': sig,
                    'x-agent-timestamp': ts,
                    'x-business-id': businessId,
                  },
                  body: bodyStr,
                });
                break;
              }
              // create_task could be added here
            }
            totalActions++;
          } catch (err) {
            console.warn(`[CRM automation] action ${action.type} failed for client ${client.id}:`, err);
          }
        }
      }

      // Mark rule as ran + increment counter
      await adminDb.collection('automationRules').doc(rule.id).update({
        lastRunAt: now.toISOString(),
        totalExecutions: (r.totalExecutions as number || 0) + matchedClients.length,
      });
    }
  }

  return totalActions;
}
