/**
 * Scheduled automation runner — fires reminders, confirmation asks, and
 * follow-ups for appointments across ALL businesses.
 *
 * Intended to run hourly via Vercel Cron or Cloud Scheduler:
 *   vercel.json: { "crons": [{ "path": "/api/agent/scheduled/run", "schedule": "0 * * * *" }] }
 *
 * Auth: Bearer CRON_SECRET. Vercel adds its own header on internal cron calls,
 * but we require explicit secret so manual triggers from other environments
 * are also safe.
 *
 * Idempotency: each appointment stores *SentAt timestamps; we never re-send.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { adminDb } from '@/lib/config/firebaseAdmin';
import type { Appointment, Business, Conversation } from '@/lib/types';

function requireAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // not configured = refuse all
  const header = req.headers.get('authorization');
  if (header === `Bearer ${secret}`) return true;
  // Vercel's built-in cron adds x-vercel-cron; accept if secret matches & header present
  if (req.headers.get('x-vercel-cron') && header === `Bearer ${secret}`) return true;
  return false;
}

interface RunStats {
  remindersSent: number;
  confirmationsAsked: number;
  followUpsSent: number;
  errors: Array<{ appointmentId: string; phase: string; error: string }>;
}

export async function GET(req: NextRequest) {
  if (!requireAuth(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const stats: RunStats = { remindersSent: 0, confirmationsAsked: 0, followUpsSent: 0, errors: [] };

  try {
    // Fetch all businesses with agent enabled — skip everyone else to save work
    const bizSnap = await adminDb.collection('businesses').get();
    const activeBusinesses = bizSnap.docs.filter(d => {
      const b = d.data() as Business;
      if (b.settings?.useCase !== 'servicos') return false;
      // Include businesses that have any reminder configured (even without AI agent enabled)
      const agenda = b.settings?.aiAgent?.agenda;
      const hasReminders = agenda?.sendReminder || agenda?.confirmationBeforeAppointment || agenda?.followUpAfter;
      // Also include businesses with AI agent fully enabled (they handle their own agenda settings)
      const hasAgent = b.settings?.aiAgent?.enabled;
      return hasReminders || hasAgent;
    });

    // Process each business in sequence (parallel would hammer Firestore)
    for (const bDoc of activeBusinesses) {
      const business = { ...(bDoc.data() as Business), id: bDoc.id };
      await processBusiness(business, stats);
    }

    // ── Kanban due-date notifications (all businesses) ──
    let kanbanNotifs = 0;
    try {
      kanbanNotifs = await checkKanbanDueDates();
    } catch (err) {
      console.warn('[scheduled] kanban check failed:', err);
    }

    // ── Recurring transactions ──
    let recurringGenerated = 0;
    try {
      recurringGenerated = await generateRecurringTransactions();
    } catch (err) {
      console.warn('[scheduled] recurring transactions failed:', err);
    }

    return NextResponse.json({ ok: true, data: { ...stats, kanbanNotifs, recurringGenerated } });
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

async function processBusiness(business: Business, stats: RunStats): Promise<void> {
  const agenda = business.settings?.aiAgent?.agenda;
  if (!agenda) return;

  const now = new Date();
  const nowMs = now.getTime();

  // Fetch active (non-cancelled, non-completed) appointments in the relevant windows
  // Widest window we need: -48h (for follow-ups) to +7 days (for long-horizon reminders)
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
    // Absolute time of the appointment
    const apptAt = new Date(`${appt.date}T${appt.startTime}:00`);
    const diffMs = apptAt.getTime() - nowMs;
    const diffHours = diffMs / (60 * 60 * 1000);

    // ── Reminder ──
    if (agenda.sendReminder && !appt.reminderSentAt && diffHours > 0) {
      const target = agenda.reminderHoursBefore || 24;
      // Fire if we're within 30 minutes of the target window
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

/**
 * Find the client's most recent conversation and dispatch a message via
 * /api/conversations/send using HMAC auth (same scheme as the agent).
 *
 * If no conversation exists, silently skip — we don't open a new thread out of
 * the blue (would violate WhatsApp 24h window rules without templates).
 */
async function sendToContact(business: Business, appt: Appointment, content: string): Promise<void> {
  const phoneDigits = (appt.clientPhone || '').replace(/\D/g, '');
  if (!phoneDigits) throw new Error('no phone');

  // Find most recent conversation by phone match
  const convSnap = await adminDb.collection('conversations')
    .where('businessId', '==', business.id)
    .where('contactExternalId', '==', phoneDigits)
    .orderBy('lastMessageAt', 'desc')
    .limit(1)
    .get();

  if (convSnap.empty) throw new Error('no conversation found for phone');
  const conv = { ...(convSnap.docs[0].data() as Conversation), id: convSnap.docs[0].id };

  // Build HMAC-signed send request (same scheme as lib/agent/auth.ts)
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

  // Internal URL — we're running inside the same Next.js deployment
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

function advanceDate(dateStr: string, frequency: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  switch (frequency) {
    case 'weekly':    d.setDate(d.getDate() + 7); break;
    case 'biweekly':  d.setDate(d.getDate() + 14); break;
    case 'monthly':   d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'yearly':    d.setFullYear(d.getFullYear() + 1); break;
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

    const now = new Date().toISOString();
    const newNextDue = advanceDate(rec.nextDueDate, rec.frequency);

    // Create new transaction copy
    const { recurrence: _r, ...baseTx } = tx;
    await adminDb.collection('transactions').add({
      ...baseTx,
      dueDate: rec.nextDueDate,
      paymentDate: null,
      status: 'pendente',
      recurrenceId: txDoc.id, // link back to parent
      recurrence: null,       // child is not recurring itself
      createdAt: now,
      updatedAt: now,
    });

    // Update parent's nextDueDate (or deactivate if past endDate)
    const shouldDeactivate = rec.endDate && newNextDue > rec.endDate;
    await txDoc.ref.update({
      'recurrence.nextDueDate': shouldDeactivate ? rec.nextDueDate : newNextDue,
      'recurrence.isActive': !shouldDeactivate,
    });

    count++;
  }

  return count;
}
