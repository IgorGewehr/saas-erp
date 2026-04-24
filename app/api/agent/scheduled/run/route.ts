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
import crypto from 'crypto';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, AgentAuthError } from '@/lib/agent/auth';
import { checkRateLimit, getClientIp, rateLimitHeaders } from '@/lib/utils/rateLimit';
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

interface RunStats {
  remindersSent: number;
  confirmationsAsked: number;
  followUpsSent: number;
  businessesProcessed: number;
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

    return NextResponse.json({ ok: true, data: stats });
  } catch (err) {
    console.error('[scheduled] fatal:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal error', partialStats: stats },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return runSweep(req);
}

// POST accepts the same auth, convenient for HMAC-signed manual triggers (the
// HMAC scheme signs the raw body, so POST with an empty body works cleanly).
export async function POST(req: NextRequest): Promise<NextResponse> {
  return runSweep(req);
}

// ─── Scheduling relevance check ──────────────────────────────────────────────

function isRelevantForScheduling(b: Business): boolean {
  if (b.settings?.useCase !== 'servicos') return false;
  const agenda = b.settings?.aiAgent?.agenda;
  const hasReminders = !!(agenda?.sendReminder || agenda?.confirmationBeforeAppointment || agenda?.followUpAfter);
  const hasAgent = !!b.settings?.aiAgent?.enabled;
  return hasReminders || hasAgent;
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
