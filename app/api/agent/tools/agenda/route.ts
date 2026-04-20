import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { Appointment, AppointmentStatus, Service, User, WorkSchedule } from '@/lib/types';

type Action =
  | 'list_services'
  | 'list_professionals'
  | 'check_availability'
  | 'get_next_available'
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
      case 'list_professionals':
        return NextResponse.json({ ok: true, data: await listProfessionals(businessId, body.params.serviceId as string | undefined) });
      case 'get_next_available':
        return NextResponse.json({ ok: true, data: await getNextAvailable(
          businessId,
          body.params.serviceId as string | undefined,
          body.params.professionalId as string | undefined,
          (body.params.durationMinutes as number) || 60,
          (body.params.daysAhead as number) || 7,
          body.params.fromDate as string | undefined,
        ) });
      case 'check_availability':
        return NextResponse.json({ ok: true, data: await checkAvailability(
          businessId,
          body.params.date as string,
          body.params.professionalId as string | undefined,
          (body.params.durationMinutes as number) || 60,
          body.params.serviceId as string | undefined,
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

async function listProfessionals(businessId: string, serviceId?: string) {
  const snap = await adminDb.collection('users')
    .where('businessId', '==', businessId)
    .get();
  const users = snap.docs
    .map(d => ({ ...(d.data() as User), id: d.id }))
    .filter(u => u.isActive !== false);

  const filtered = serviceId
    ? users.filter(u => !u.serviceIds || u.serviceIds.length === 0 || u.serviceIds.includes(serviceId))
    : users;

  // Return only what the agent needs — strip auth/session sensitive fields
  return filtered.map(u => ({
    id: u.id,
    name: u.name,
    role: u.role,
    serviceIds: u.serviceIds || [],
  }));
}

async function getNextAvailable(
  businessId: string,
  serviceId: string | undefined,
  professionalId: string | undefined,
  durationMinutes: number,
  daysAhead: number,
  fromDate?: string,
) {
  const start = fromDate ? new Date(fromDate + 'T12:00:00') : new Date();
  const cap = Math.min(30, daysAhead);

  for (let i = 0; i < cap; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const result = await checkAvailability(businessId, dateStr, professionalId, durationMinutes, serviceId);
    if (result.slots.length > 0) {
      // Return up to 5 slots from the first day that has any
      return { date: dateStr, slots: result.slots.slice(0, 5), searchedDays: i + 1 };
    }
  }
  return { date: null, slots: [], searchedDays: cap };
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
  serviceId?: string,
): Promise<{ date: string; slots: AvailabilitySlot[] }> {
  // Load business openingHours for fallback when professional has none
  const bizSnap = await adminDb.collection('businesses').doc(businessId).get();
  const bizHours = bizSnap.exists ? (bizSnap.data()?.settings?.openingHours as Array<{ isOpen: boolean; openTime: string; closeTime: string }> | undefined) : undefined;
  const dayOfWeek = new Date(date + 'T12:00:00').getDay(); // 0=Sun..6=Sat

  // If business is explicitly closed that day, short-circuit
  if (bizHours && bizHours[dayOfWeek] && bizHours[dayOfWeek].isOpen === false) {
    return { date, slots: [] };
  }

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

  let professionals: User[] = usersSnap
    .filter(d => d.exists)
    .map(d => ({ ...(d.data() as User), id: d.id }))
    .filter(u => u.businessId === businessId);

  // Filter by serviceId — the professional must offer it (or have no restriction configured)
  if (serviceId) {
    professionals = professionals.filter(u => {
      const ids = u.serviceIds;
      if (!ids || ids.length === 0) return true; // sem lista = faz tudo
      return ids.includes(serviceId);
    });
  }

  const slots: AvailabilitySlot[] = [];
  for (const prof of professionals) {
    // Determine working window for this professional on this day of week
    const profSchedule = (prof.workingHours as unknown as Record<string, WorkSchedule[]> | undefined);
    let windowStart = '08:00';
    let windowEnd = '18:30';

    if (profSchedule && Array.isArray(profSchedule[String(dayOfWeek)])) {
      const entries = profSchedule[String(dayOfWeek)].filter(w => w.isActive !== false);
      if (entries.length === 0) continue; // professional não trabalha nesse dia
      // Use the widest window across their entries (we don't respect breaks here — kept simple)
      windowStart = entries.reduce((min, e) => e.startTime < min ? e.startTime : min, '23:59');
      windowEnd = entries.reduce((max, e) => e.endTime > max ? e.endTime : max, '00:00');
    } else if (bizHours && bizHours[dayOfWeek]?.isOpen) {
      windowStart = bizHours[dayOfWeek].openTime || windowStart;
      windowEnd = bizHours[dayOfWeek].closeTime || windowEnd;
    }

    // Generate 30-min candidate slots within the working window
    const candidates: string[] = [];
    const startMins = parseInt(windowStart.slice(0, 2)) * 60 + parseInt(windowStart.slice(3, 5));
    const endMins = parseInt(windowEnd.slice(0, 2)) * 60 + parseInt(windowEnd.slice(3, 5));
    for (let m = startMins; m + durationMinutes <= endMins; m += 30) {
      candidates.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    }

    for (const start of candidates) {
      const end = addMinutes(start, durationMinutes);
      const conflict = appts.some(a =>
        a.professionalId === prof.id &&
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

  // Validate professional offers this service (when both are provided)
  if (p.professionalId && p.serviceId) {
    const profSnap = await adminDb.collection('users').doc(p.professionalId).get();
    if (!profSnap.exists) throw new Error('Profissional não encontrado');
    const prof = profSnap.data() as User;
    if (prof.businessId !== businessId) throw new Error('Profissional não pertence a esta empresa');
    const ids = prof.serviceIds;
    if (ids && ids.length > 0 && !ids.includes(p.serviceId)) {
      throw new Error('Este profissional não oferece o serviço solicitado');
    }
  }

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

  const now = new Date().toISOString();
  const cleanPatch: Record<string, unknown> = { updatedAt: now };
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

  // ── Commission handling on status change ──
  const wasDone = data.status === 'concluido';
  const isDone = cleanPatch.status === 'concluido';
  if (!wasDone && isDone) {
    await maybeCreateCommissionServer({ ...data, id }, businessId).catch(err =>
      console.warn('[agent/agenda] commission creation failed:', err),
    );
  } else if (wasDone && !isDone && cleanPatch.status) {
    await maybeCancelCommissionServer(data.commissionTransactionId).catch(err =>
      console.warn('[agent/agenda] commission cancel failed:', err),
    );
  }

  return { id, ...cleanPatch };
}

async function cancelAppointment(businessId: string, id: string) {
  return updateAppointment(businessId, id, { status: 'cancelado' as AppointmentStatus });
}

// ── Server-side commission helpers (mirror of lib/services/commission.ts for adminDb) ──

async function maybeCreateCommissionServer(appointment: Appointment, businessId: string): Promise<string | null> {
  if (appointment.commissionTransactionId) return appointment.commissionTransactionId;
  if (!appointment.professionalId) return null;

  // Load professional
  const profSnap = await adminDb.collection('users').doc(appointment.professionalId).get();
  if (!profSnap.exists) return null;
  const professional = profSnap.data() as User;

  // Load service (if linked)
  let serviceRate: number | undefined;
  if (appointment.serviceId) {
    const svcSnap = await adminDb.collection('services').doc(appointment.serviceId).get();
    if (svcSnap.exists) {
      serviceRate = (svcSnap.data() as Service).commissionRate;
    }
  }

  const rate = (serviceRate != null && serviceRate > 0) ? serviceRate : (professional.commissionRate ?? 0);
  if (rate <= 0) return null;
  if (!appointment.price || appointment.price <= 0) return null;

  const commissionAmount = Math.round((appointment.price * rate) / 100 * 100) / 100;
  const now = new Date().toISOString();

  const txRef = await adminDb.collection('transactions').add({
    businessId,
    type: 'despesa',
    category: 'Comissoes',
    description: `Comissão — ${appointment.professionalName || professional.name} — ${appointment.serviceName}`,
    amount: commissionAmount,
    dueDate: appointment.date,
    status: 'pendente',
    clientId: professional.uid || appointment.professionalId,
    clientName: appointment.professionalName || professional.name,
    appointmentId: appointment.id,
    notes: `Taxa: ${rate}% sobre R$ ${appointment.price.toFixed(2)}`,
    createdAt: now,
    updatedAt: now,
  });

  await adminDb.collection('appointments').doc(appointment.id).update({
    commissionTransactionId: txRef.id,
    updatedAt: now,
  });

  return txRef.id;
}

async function maybeCancelCommissionServer(commissionTransactionId: string | undefined): Promise<void> {
  if (!commissionTransactionId) return;
  await adminDb.collection('transactions').doc(commissionTransactionId).update({
    status: 'cancelado',
    updatedAt: new Date().toISOString(),
  });
}
