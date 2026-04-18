import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { Appointment, AppointmentStatus, Service, User } from '@/lib/types';

type Action =
  | 'list_services'
  | 'check_availability'
  | 'book'
  | 'list_by_client'
  | 'get'
  | 'update'
  | 'cancel';

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function intervalsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
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

  const body = parseAgentBody<{ action: Action; params: Record<string, unknown> }>(ctx.rawBody);
  const { businessId } = ctx;

  try {
    switch (body.action) {
      case 'list_services':
        return NextResponse.json({ ok: true, data: await listServices(businessId) });
      case 'check_availability':
        return NextResponse.json({ ok: true, data: await checkAvailability(
          businessId,
          body.params.date as string,
          body.params.professionalId as string | undefined,
          (body.params.durationMinutes as number) || 60,
        ) });
      case 'book':
        return NextResponse.json({ ok: true, data: await bookAppointment(businessId, body.params as unknown as BookParams) });
      case 'list_by_client':
        return NextResponse.json({ ok: true, data: await listByClient(businessId, (body.params.clientId || body.params.phone) as string, (body.params.limit as number) || 10) });
      case 'get':
        return NextResponse.json({ ok: true, data: await getAppointment(businessId, body.params.id as string) });
      case 'update':
        return NextResponse.json({ ok: true, data: await updateAppointment(businessId, body.params.id as string, body.params.patch as Partial<Appointment>) });
      case 'cancel':
        return NextResponse.json({ ok: true, data: await cancelAppointment(businessId, body.params.id as string) });
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[agent/tools/agenda]', body.action, err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

// ─── Implementations ─────────────────────────────────────────────────────────

async function listServices(businessId: string) {
  const snap = await adminDb.collection('services')
    .where('businessId', '==', businessId)
    .where('isActive', '==', true)
    .orderBy('name')
    .get();
  return snap.docs.map(d => ({ ...(d.data() as Service), id: d.id }));
}

interface AvailabilitySlot {
  startTime: string;
  endTime: string;
  professionalId?: string;
  professionalName?: string;
}

async function checkAvailability(
  businessId: string,
  date: string,
  professionalId: string | undefined,
  durationMinutes: number,
): Promise<{ date: string; slots: AvailabilitySlot[] }> {
  // Load existing appointments for the day
  const apptsSnap = await adminDb.collection('appointments')
    .where('businessId', '==', businessId)
    .where('date', '==', date)
    .get();
  const appts = apptsSnap.docs
    .map(d => d.data() as Appointment)
    .filter(a => a.status !== 'cancelado');

  // Load professionals (optionally filter by one)
  const usersSnap = professionalId
    ? [await adminDb.collection('users').doc(professionalId).get()]
    : (await adminDb.collection('users').where('businessId', '==', businessId).get()).docs;

  const professionals: User[] = usersSnap
    .filter(d => d.exists)
    .map(d => ({ ...(d.data() as User), id: d.id }))
    .filter(u => u.businessId === businessId);

  // Generate candidate slots 08:00..18:00 every 30min
  const candidates: string[] = [];
  for (let h = 8; h < 18; h++) {
    candidates.push(`${String(h).padStart(2, '0')}:00`);
    candidates.push(`${String(h).padStart(2, '0')}:30`);
  }

  const slots: AvailabilitySlot[] = [];
  for (const prof of professionals) {
    for (const start of candidates) {
      const end = addMinutes(start, durationMinutes);
      if (end > '18:30') continue;

      const conflict = appts.some(a =>
        (professionalId ? a.professionalId === professionalId : a.professionalId === prof.id) &&
        intervalsOverlap(start, end, a.startTime, a.endTime),
      );
      if (!conflict) {
        slots.push({
          startTime: start,
          endTime: end,
          professionalId: prof.id,
          professionalName: prof.name,
        });
      }
    }
    if (slots.length >= 20) break;
  }

  return { date, slots: slots.slice(0, 20) };
}

interface BookParams {
  clientId?: string;
  clientName: string;
  clientPhone?: string;
  serviceId?: string;
  serviceName?: string;
  professionalId?: string;
  professionalName?: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  price?: number;
  notes?: string;
}

async function bookAppointment(businessId: string, p: BookParams) {
  if (!p.clientName || !p.date || !p.startTime) throw new Error('clientName, date, startTime required');

  const endTime = addMinutes(p.startTime, p.durationMinutes);

  // Conflict check (defense in depth — agent should have called check_availability)
  const conflictSnap = await adminDb.collection('appointments')
    .where('businessId', '==', businessId)
    .where('date', '==', p.date)
    .get();
  const conflicts = conflictSnap.docs
    .map(d => d.data() as Appointment)
    .filter(a => a.status !== 'cancelado')
    .filter(a => p.professionalId ? a.professionalId === p.professionalId : true)
    .filter(a => intervalsOverlap(p.startTime, endTime, a.startTime, a.endTime));
  if (conflicts.length > 0) {
    throw new Error(`Horário ${p.startTime} em ${p.date} já está ocupado`);
  }

  // If service provided, pull duration/price/color
  let price = p.price || 0;
  let color = '#3B82F6';
  let serviceName = p.serviceName || '';
  if (p.serviceId) {
    const svc = await adminDb.collection('services').doc(p.serviceId).get();
    if (svc.exists && (svc.data() as Service).businessId === businessId) {
      const s = svc.data() as Service;
      price = price || s.price;
      color = s.color;
      serviceName = serviceName || s.name;
    }
  }

  const now = new Date().toISOString();
  const doc: Omit<Appointment, 'id'> = {
    businessId,
    clientId: p.clientId || '',
    clientName: p.clientName,
    clientPhone: p.clientPhone,
    serviceId: p.serviceId,
    serviceName,
    professionalId: p.professionalId,
    professionalName: p.professionalName,
    date: p.date,
    startTime: p.startTime,
    endTime,
    duration: p.durationMinutes,
    status: 'agendado',
    price,
    notes: p.notes,
    color,
    createdAt: now,
    updatedAt: now,
  };
  const cleaned = Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined));
  const ref = await adminDb.collection('appointments').add(cleaned);
  return { id: ref.id, date: p.date, startTime: p.startTime, endTime, serviceName };
}

async function listByClient(businessId: string, lookupKey: string, limit: number) {
  // Try clientId first, fallback to phone
  let q = adminDb.collection('appointments')
    .where('businessId', '==', businessId)
    .where('clientId', '==', lookupKey)
    .orderBy('date', 'desc')
    .limit(limit);
  let snap = await q.get();

  if (snap.empty) {
    q = adminDb.collection('appointments')
      .where('businessId', '==', businessId)
      .where('clientPhone', '==', lookupKey)
      .orderBy('date', 'desc')
      .limit(limit);
    snap = await q.get();
  }
  return snap.docs.map(d => ({ ...(d.data() as Appointment), id: d.id }));
}

async function getAppointment(businessId: string, id: string) {
  const snap = await adminDb.collection('appointments').doc(id).get();
  if (!snap.exists) throw new Error('Appointment not found');
  const data = snap.data() as Appointment;
  if (data.businessId !== businessId) throw new Error('Cross-tenant access denied');
  return { ...data, id: snap.id };
}

async function updateAppointment(businessId: string, id: string, patch: Partial<Appointment>) {
  const ref = adminDb.collection('appointments').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Appointment not found');
  const data = snap.data() as Appointment;
  if (data.businessId !== businessId) throw new Error('Cross-tenant access denied');

  const cleanPatch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  const allowed: (keyof Appointment)[] = ['date', 'startTime', 'endTime', 'duration', 'status', 'notes'];
  for (const key of allowed) {
    if (patch[key] !== undefined) cleanPatch[key] = patch[key];
  }
  // Recompute endTime if startTime or duration changed
  if (cleanPatch.startTime || cleanPatch.duration) {
    const startTime = (cleanPatch.startTime as string | undefined) || data.startTime;
    const duration = (cleanPatch.duration as number | undefined) || data.duration;
    cleanPatch.endTime = addMinutes(startTime, duration);
  }

  await ref.update(cleanPatch);
  return { id, ...cleanPatch };
}

async function cancelAppointment(businessId: string, id: string) {
  return updateAppointment(businessId, id, { status: 'cancelado' as AppointmentStatus });
}
