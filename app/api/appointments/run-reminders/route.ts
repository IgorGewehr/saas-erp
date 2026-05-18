/**
 * GET/POST /api/appointments/run-reminders
 *
 * Cron handler — dispara notificações in-app pros profissionais de
 * agendamentos que vão começar em ~60min ou ~30min.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET} (mesmo segredo das birthday
 * campaigns — não precisa de var separada).
 *
 * Cadência recomendada: a cada 5 minutos (`* /5 * * * *` no cron). Cada
 * execução varre apontamentos do dia + dia seguinte, identifica os que
 * entram nas janelas alvo (com ±5min de tolerância), e cria 1 notif por
 * profissional. Idempotência via log `appointmentReminderLogs/{aptId}_{minutesBefore}` —
 * runs duplicados não duplicam notifs.
 *
 * Setup no Render/Vercel/etc:
 *   schedule: '*\/5 * * * *'
 *   command/url: POST /api/appointments/run-reminders
 *   header: Authorization: Bearer ${CRON_SECRET}
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { runAppointmentReminders } from '@/lib/services/appointmentReminderRunner';

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) return false;
  const token = auth.slice(7);
  if (token.length !== secret.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const summary = await runAppointmentReminders(new Date());
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    console.error('[AppointmentReminders /run] failed:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest)  { return handle(req); }
