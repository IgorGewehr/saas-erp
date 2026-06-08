import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody, resolveClientId } from '@/lib/agent/auth';
import type { Appointment, AppointmentStatus, Service, User, WorkSchedule } from '@/lib/types';
import { parseToolRequest, validateToolResponse, isContractError } from '@/contracts/_runtime/agentToolValidation';
import type { AgendaToolAction } from '@/contracts/api/agent/agenda';
import { updateAppointmentSafeAdmin, AppointmentConflictError } from '@/lib/services/appointmentTxGuardAdmin';
import { effectiveServiceCapacity, isGroupService } from '@/lib/contracts/domain/service';
import { assertTransitionAppointment } from '@/lib/contracts/fsm/appointment';
import { buildSessionKey } from '@/lib/utils/sessionKey';
import { resolveSessionsForDay, countSeatsTaken, findBlockingAppointment, buildGroupSlots } from '@/lib/services/groupSession';

type Action = AgendaToolAction;

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

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Sinaliza conflito de horário dentro da transação de booking. Captura fora
// da transação para responder com alternativas em vez de 500.
class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

// Turma cheia: distinto de ConflictError (slot existe, mas sem vaga). Captura
// fora da tx pra responder status='full' + alternativas (outras sessões da
// grade com vaga) em vez de 500.
class SessionFullError extends Error {
  readonly capacity: number;
  readonly sessionKey: string;
  constructor(message: string, capacity: number, sessionKey: string) {
    super(message);
    this.name = 'SessionFullError';
    this.capacity = capacity;
    this.sessionKey = sessionKey;
  }
}

// P2.9: limite de aulas do ciclo de uma mensalidade estourado. Captura fora da
// tx pra responder status='conflict' (acionável) em vez de 500.
class MembershipLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MembershipLimitError';
  }
}

/**
 * P2.9: assinatura ativa do cliente que cobre este serviço E tem teto de usos
 * por ciclo. Retorna o doc (com ref) pra checar limite antes de reservar e
 * incrementar usesThisCycle dentro da tx. null = sem plano com teto aplicável
 * (booking segue normal, sem enforcement). R1: filtra businessId.
 */
async function loadActiveMembershipForBooking(
  businessId: string,
  clientId: string,
  serviceId: string,
): Promise<{ id: string; usesThisCycle: number; maxUsesPerCycle: number; membershipName: string } | null> {
  const cmSnap = await adminDb.collection('clientMemberships')
    .where('businessId', '==', businessId)
    .where('clientId', '==', clientId)
    .where('status', '==', 'active')
    .get();
  if (cmSnap.empty) return null;

  for (const doc of cmSnap.docs) {
    const cm = doc.data() as { membershipId?: string; membershipName?: string; usesThisCycle?: number };
    if (!cm.membershipId) continue;
    const planSnap = await adminDb.collection('memberships').doc(cm.membershipId).get();
    if (!planSnap.exists) continue;
    const plan = planSnap.data() as { businessId?: string; serviceIds?: string[]; maxUsesPerCycle?: number | null };
    if (plan.businessId !== businessId) continue;
    if (!plan.serviceIds?.includes(serviceId)) continue;
    // Só aplica enforcement quando há teto definido (>0). Ilimitado → ignora.
    if (plan.maxUsesPerCycle == null || plan.maxUsesPerCycle <= 0) continue;
    return {
      id: doc.id,
      usesThisCycle: cm.usesThisCycle ?? 0,
      maxUsesPerCycle: plan.maxUsesPerCycle,
      membershipName: cm.membershipName ?? 'plano',
    };
  }
  return null;
}

/**
 * Carrega um Service por id, validando tenant. Retorna null se ausente/cross-tenant.
 */
async function loadService(businessId: string, serviceId: string): Promise<Service | null> {
  const snap = await adminDb.collection('services').doc(serviceId).get();
  if (!snap.exists) return null;
  const s = { ...(snap.data() as Service), id: snap.id };
  if (s.businessId !== businessId) return null;
  return s;
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

  const rawBody = parseAgentBody<{ action: Action; params: Record<string, unknown> }>(ctx.rawBody);
  const { businessId } = ctx;

  // SDD: validar request com Zod (Fase 1 piloto). Em caso de shape inválido,
  // ContractError -> 400 com error envelope estruturado.
  let action: Action;
  let params: Record<string, unknown>;
  try {
    const parsed = parseToolRequest('agenda', rawBody);
    action = parsed.action as Action;
    params = parsed.params as Record<string, unknown>;
  } catch (err) {
    if (isContractError(err)) {
      return NextResponse.json(err.toEnvelope(), { status: 400 });
    }
    throw err;
  }

  try {
    let data: unknown;
    switch (action) {
      case 'list_services':
        data = await listServices(businessId);
        break;
      case 'list_professionals':
        data = await listProfessionals(businessId, params.serviceId as string | undefined);
        break;
      case 'get_next_available':
        data = await getNextAvailable(
          businessId,
          params.serviceId as string | undefined,
          params.professionalId as string | undefined,
          (params.durationMinutes as number) || 60,
          (params.daysAhead as number) || 7,
          params.fromDate as string | undefined,
        );
        break;
      case 'check_availability':
        data = await checkAvailability(
          businessId,
          params.date as string,
          params.professionalId as string | undefined,
          (params.durationMinutes as number) || 60,
          params.serviceId as string | undefined,
        );
        break;
      case 'book':
        data = await bookAppointment(businessId, params as unknown as BookParams);
        break;
      case 'list_by_client':
        data = await listByClient(businessId, (params.clientId || params.phone) as string, (params.limit as number) || 10);
        break;
      case 'list_today':
        data = await listToday(businessId);
        break;
      case 'list_upcoming':
        data = await listUpcoming(
          businessId,
          (params.limit as number) || 20,
          (params.daysAhead as number) || 7,
          params.professionalId as string | undefined,
        );
        break;
      case 'get':
        data = await getAppointment(businessId, params.id as string);
        break;
      case 'update':
        try {
          data = await updateAppointment(businessId, params.id as string, params.patch as Partial<Appointment>);
        } catch (updateErr) {
          // Conflict struturado pra que a IA reconheca e proponha outro
          // horario em vez de ficar tentando o mesmo slot. Mesma forma
          // de resposta do bookAppointment em conflito (sem alternatives
          // pq update n busca slots livres — IA decide o proximo passo).
          if (updateErr instanceof AppointmentConflictError) {
            data = {
              status: 'conflict' as const,
              id: params.id as string,
              conflictReason: updateErr.message,
            };
            break;
          }
          throw updateErr;
        }
        break;
      case 'cancel':
        data = await cancelAppointment(businessId, params.id as string);
        break;
      default: {
        const exhaustiveCheck: never = action;
        return NextResponse.json({ ok: false, error: `Unknown action: ${exhaustiveCheck}` }, { status: 400 });
      }
    }

    // SDD: valida shape do response em dev (lança); em prod loga e segue.
    const validated = validateToolResponse('agenda', action, data);
    return NextResponse.json({ ok: true, data: validated });
  } catch (err) {
    if (isContractError(err)) {
      return NextResponse.json(err.toEnvelope(), { status: err.code === 'INTERNAL' ? 500 : 400 });
    }
    console.error('[agent/tools/agenda]', action, err);
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
    .filter(u => u.isActive !== false && u.isProfessional !== false);

  const byService = serviceId
    ? users.filter(u => {
        const ids = u.serviceIds;
        if (!ids || ids.length === 0) return false;
        return ids.includes(serviceId);
      })
    : users;
  // If no professional has explicit serviceIds configured, all active professionals can do any service
  const filtered = serviceId && byService.length === 0 ? users : byService;

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

export interface AvailabilitySlot {
  startTime: string;
  endTime: string;
  professionalId?: string;
  professionalName?: string;
  // ── Turmas (sessões fixas) — presentes só quando o slot vem de um serviço
  //    com sessions[]. Ausentes = slot exclusivo (comportamento atual). ──
  capacity?: number;
  seatsAvailable?: number;
  sessionKey?: string;
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

  // Load ALL appointments for the day — no professionalId filter so that
  // unassigned appointments (no professionalId) are included in conflict detection.
  const apptsSnap = await adminDb.collection('appointments')
    .where('businessId', '==', businessId)
    .where('date', '==', date)
    .get();
  const appts = apptsSnap.docs
    .map(d => d.data() as Appointment)
    .filter(a => a.status !== 'cancelado');

  // ── Turmas: serviço com sessions[] enumera SÓ as sessões fixas da grade ──
  // Caminho contínuo (abaixo) permanece INTACTO para serviços sem sessions[].
  if (serviceId) {
    const service = await loadService(businessId, serviceId);
    if (service && service.sessions && service.sessions.length > 0) {
      const groupSlots = buildGroupSlots(service, date, dayOfWeek, professionalId, appts);
      console.info('[agent/tools/agenda] check_availability (group)', JSON.stringify({
        businessId, date, serviceId, professionalId: professionalId ?? null,
        sessionsOnDay: groupSlots.length,
        slots: groupSlots.map(s => ({ startTime: s.startTime, seatsAvailable: s.seatsAvailable, capacity: s.capacity })),
      }));
      return { date, slots: groupSlots };
    }
  }

  // Load professionals (optionally filter by one)
  const usersSnap = professionalId
    ? [await adminDb.collection('users').doc(professionalId).get()]
    : (await adminDb.collection('users').where('businessId', '==', businessId).get()).docs;

  let professionals: User[] = usersSnap
    .filter(d => d.exists)
    .map(d => ({ ...(d.data() as User), id: d.id }))
    .filter(u => u.businessId === businessId && u.isProfessional !== false);

  // Filter by serviceId — if professionals have explicit serviceIds, enforce; otherwise allow all
  if (serviceId) {
    const withService = professionals.filter(u => {
      const ids = u.serviceIds;
      if (!ids || ids.length === 0) return false;
      return ids.includes(serviceId);
    });
    if (withService.length > 0) professionals = withService;
    // else: no-one has serviceIds configured → all professionals can perform any service
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
      // Unassigned appointments (no professionalId) block all professionals.
      const conflict = appts.some(a =>
        (!a.professionalId || a.professionalId === prof.id) &&
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

  slots.sort((a, b) => a.startTime.localeCompare(b.startTime));
  const out = slots.slice(0, 20);

  // Observability: se um cliente ligar reclamando que reservamos slot ocupado,
  // o log abaixo permite reconstruir o estado consultado nesse instante.
  // Mantém o output enxuto: contagem + IDs/horários dos appts considerados.
  console.info('[agent/tools/agenda] check_availability', JSON.stringify({
    businessId,
    date,
    professionalId: professionalId ?? null,
    serviceId: serviceId ?? null,
    durationMinutes,
    apptsLoaded: appts.length,
    apptsSummary: appts.map(a => ({
      startTime: a.startTime,
      endTime: a.endTime,
      professionalId: a.professionalId ?? null,
      status: a.status,
    })),
    professionalsConsidered: professionals.map(p => p.id),
    slotsEmitted: out.length,
  }));

  return { date, slots: out };
}

interface BookParams {
  clientId?: string;
  // Aliases aceitos no boundary (P2.10) — normalizados pra clientId via resolveClientId.
  contactId?: string;
  crmContactId?: string;
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
  channelType?: Appointment['channelType'];
  conversationId?: string;
  // FK de resultado (P2.10) — CRMDeal que originou este agendamento.
  dealId?: string;
}

async function bookAppointment(businessId: string, p: BookParams) {
  if (!p.clientName || !p.date || !p.startTime) throw new Error('clientName, date, startTime required');

  // P2.10: normaliza a FK do cliente (clientId/contactId/crmContactId → clientId).
  p.clientId = resolveClientId(p) ?? p.clientId;

  // ── Input sanitization ────────────────────────────────────────────────────
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) {
    throw new Error('Formato de data inválido — esperado YYYY-MM-DD');
  }
  if (!/^\d{2}:\d{2}$/.test(p.startTime)) {
    throw new Error('Formato de startTime inválido — esperado HH:MM');
  }
  if (p.durationMinutes < 5 || p.durationMinutes > 480) {
    throw new Error('durationMinutes deve estar entre 5 e 480');
  }

  // ── Professional validation (hard-fail on bad ID) ─────────────────────────
  if (p.professionalId) {
    const profSnap = await adminDb.collection('users').doc(p.professionalId).get();
    if (!profSnap.exists || (profSnap.data() as User).businessId !== businessId) {
      throw new Error('Profissional inválido: ID não corresponde a nenhum profissional ativo. Não é possível agendar.');
    }
  }

  // ── Auto-lookup clientId via phone ────────────────────────────────────────
  if (!p.clientId && p.clientPhone) {
    const clientSnap = await adminDb.collection('clients')
      .where('businessId', '==', businessId)
      .where('phone', '==', p.clientPhone)
      .limit(1)
      .get();
    if (!clientSnap.empty) {
      p.clientId = clientSnap.docs[0].id;
    }
  }

  // ── Idempotency key ────────────────────────────────────────────────────────
  const idempotencyKey = createHash('sha256')
    .update(`${businessId}:${p.clientPhone || p.clientId || ''}:${p.date}:${p.startTime}:${p.professionalId || 'any'}`)
    .digest('hex')
    .slice(0, 32);

  // ── Pre-transaction idempotency check ─────────────────────────────────────
  const existingSnap = await adminDb.collection('appointments')
    .where('businessId', '==', businessId)
    .where('idempotencyKey', '==', idempotencyKey)
    .limit(1)
    .get();
  if (!existingSnap.empty) {
    const existing = existingSnap.docs[0];
    const existingData = existing.data() as Appointment;
    if (existingData.status !== 'cancelado') {
      return {
        id: existing.id,
        status: 'exists',
        date: existingData.date,
        startTime: existingData.startTime,
        endTime: existingData.endTime,
        serviceName: existingData.serviceName,
      };
    }
  }

  // ── Service lookup (outside transaction — read-only, no contention) ───────
  let price = p.price || 0;
  let color = '#3B82F6';
  let serviceName = p.serviceName || '';
  let service: Service | null = null;
  if (p.serviceId) {
    service = await loadService(businessId, p.serviceId);
    if (service) {
      price = price || service.price;
      color = service.color;
      serviceName = serviceName || service.name;
    }
  }

  const endTime = addMinutes(p.startTime, p.durationMinutes);
  const now = new Date().toISOString();

  // ── Turma (capacity>1): caminho de vagas compartilhadas ───────────────────
  // Serviço exclusivo (capacity ausente/1) NÃO entra aqui — segue bit-a-bit.
  if (service && p.serviceId && isGroupService(service.capacity)) {
    return bookGroupAppointment(businessId, p, {
      service,
      serviceId: p.serviceId,
      serviceName,
      price,
      color,
      endTime,
      idempotencyKey,
      now,
    });
  }

  // ── Atomic transaction: conflict check + write ────────────────────────────
  // ALL reads must happen before writes inside Firestore transactions.
  const newRef = adminDb.collection('appointments').doc();

  const result = await adminDb.runTransaction(async (tx) => {
    // Read: ALL appointments for the day — unassigned ones block all professionals.
    const txQuery: FirebaseFirestore.Query = adminDb.collection('appointments')
      .where('businessId', '==', businessId)
      .where('date', '==', p.date);
    const daySnap = await tx.get(txQuery);

    // Evaluate conflicts: unassigned appointments block everyone;
    // assigned appointments only block the same professional.
    const conflicts = daySnap.docs
      .map(d => d.data() as Appointment)
      .filter(a => a.status !== 'cancelado')
      .filter(a => !a.professionalId || !p.professionalId || a.professionalId === p.professionalId)
      .filter(a => intervalsOverlap(p.startTime, endTime, a.startTime, a.endTime));

    if (conflicts.length > 0) {
      // Signal the conflict so we can build a structured response with
      // alternatives *outside* the transaction (transactions can't issue
      // unrelated reads cleanly). The marker is recognized below.
      throw new ConflictError(`Horário ${p.startTime} em ${p.date} já está ocupado para este profissional`);
    }

    // Write
    const docData: Record<string, unknown> = {
      businessId,
      clientId: p.clientId || '',
      clientName: p.clientName,
      serviceId: p.serviceId,
      serviceName,
      date: p.date,
      startTime: p.startTime,
      endTime,
      duration: p.durationMinutes,
      status: 'agendado',
      price,
      color,
      idempotencyKey,
      createdAt: now,
      updatedAt: now,
    };
    // Optional fields — only set if provided (Firestore rejects undefined)
    if (p.professionalId !== undefined) docData.professionalId = p.professionalId;
    if (p.professionalName !== undefined) docData.professionalName = p.professionalName;
    if (p.clientPhone !== undefined) docData.clientPhone = p.clientPhone;
    if (p.notes !== undefined) docData.notes = p.notes;
    if (p.channelType !== undefined) docData.channelType = p.channelType;
    if (p.conversationId !== undefined) docData.conversationId = p.conversationId;
    if (p.dealId !== undefined) docData.dealId = p.dealId;

    tx.create(newRef, docData);
    return { id: newRef.id, status: 'created' as const, date: p.date, startTime: p.startTime, endTime, serviceName };
  }).catch(async (err: unknown) => {
    if (!(err instanceof ConflictError)) throw err;

    // Carrega slots livres do mesmo dia/profissional e ranqueia pelos
    // mais próximos do horário pedido. Limita a 3 alternativas — agente
    // só vai propor uma por vez.
    const requestedMin = timeToMinutes(p.startTime);
    let alternatives: AvailabilitySlot[] = [];
    try {
      const avail = await checkAvailability(businessId, p.date, p.professionalId, p.durationMinutes, p.serviceId);
      alternatives = avail.slots
        .slice()
        .sort((a, b) => Math.abs(timeToMinutes(a.startTime) - requestedMin) - Math.abs(timeToMinutes(b.startTime) - requestedMin))
        .slice(0, 3);
    } catch (alternativeErr) {
      console.warn('[agent/tools/agenda] book: failed to load alternatives', alternativeErr);
    }

    return {
      status: 'conflict' as const,
      date: p.date,
      startTime: p.startTime,
      endTime,
      serviceName,
      professionalName: p.professionalName,
      conflictReason: err.message,
      alternatives,
    };
  });

  return result;
}

interface GroupBookContext {
  service: Service;
  serviceId: string;
  serviceName: string;
  price: number;
  color: string;
  endTime: string;
  idempotencyKey: string;
  now: string;
}

/**
 * Reserva numa turma (Service.capacity>1). Cada aluno = UM Appointment próprio
 * compartilhando o sessionKey canônico. Regra (design item 3):
 *
 *  - Vagas = capacity - count(appts não-cancelados com o mesmo sessionKey).
 *  - Sobreposição com appointment de OUTRO sessionKey (1:1 ou outra turma) do
 *    mesmo profissional/não-atribuído → BLOQUEIA (ConflictError).
 *  - Turma com vaga → cria Appointment do aluno (status='joined' se já havia
 *    alunos; 'created' se é o primeiro).
 *  - Turma cheia → SessionFullError → status='full' + alternativas.
 */
async function bookGroupAppointment(businessId: string, p: BookParams, c: GroupBookContext) {
  const dayOfWeek = new Date(p.date + 'T12:00:00').getDay();

  // Capacidade efetiva: se o serviço tem sessions[], usa a capacity da sessão
  // que bate startTime/professional; senão usa a capacity do serviço.
  const resolved = resolveSessionsForDay(c.service, dayOfWeek);
  const matched = resolved.find(s =>
    s.startTime === p.startTime &&
    (s.professionalId ?? undefined) === (p.professionalId ?? undefined),
  ) ?? resolved.find(s => s.startTime === p.startTime);

  const capacity = matched ? matched.capacity : effectiveServiceCapacity(c.service.capacity);

  // professionalId da sessão fixa (se houver) tem precedência sobre o pedido —
  // a turma é "dona" do horário. Quando a sessão fixa não define professor,
  // usa o pedido (que pode ser undefined → 'any').
  const effectiveProfessionalId = matched?.professionalId ?? p.professionalId;
  const sessionKey = buildSessionKey({
    serviceId: c.serviceId,
    date: p.date,
    startTime: p.startTime,
    professionalId: effectiveProfessionalId,
  });

  // P2.9: se o cliente tem mensalidade ativa com teto de usos por ciclo que
  // cobre este serviço, recusa quando o limite já foi atingido. Carregado fora
  // da tx (read-only); o incremento de usesThisCycle acontece dentro da tx.
  const membership = p.clientId
    ? await loadActiveMembershipForBooking(businessId, p.clientId, c.serviceId)
    : null;

  const newRef = adminDb.collection('appointments').doc();

  const result = await adminDb.runTransaction(async (tx) => {
    const txQuery: FirebaseFirestore.Query = adminDb.collection('appointments')
      .where('businessId', '==', businessId)
      .where('date', '==', p.date);
    const daySnap = await tx.get(txQuery);

    // P2.9: re-lê a assinatura DENTRO da tx pra contagem consistente sob
    // concorrência (usesThisCycle pode ter mudado entre o pre-check e aqui).
    let membershipUses = 0;
    if (membership) {
      const cmRef = adminDb.collection('clientMemberships').doc(membership.id);
      const cmSnap = await tx.get(cmRef);
      membershipUses = (cmSnap.data()?.usesThisCycle as number | undefined) ?? membership.usesThisCycle;
      if (membershipUses >= membership.maxUsesPerCycle) {
        throw new MembershipLimitError(
          `Limite do plano ${membership.membershipName} atingido: ${membershipUses}/${membership.maxUsesPerCycle} aulas neste ciclo.`,
        );
      }
    }

    const dayAppts = daySnap.docs.map(d => ({ ...(d.data() as Appointment), id: d.id }));

    // Appointments do MESMO profissional efetivo (ou não-atribuídos, que
    // bloqueiam todos) candidatos a conflito/contagem.
    const relevant = dayAppts.filter(a =>
      !a.professionalId || !effectiveProfessionalId || a.professionalId === effectiveProfessionalId,
    );

    // Conflito: qualquer appointment de OUTRO sessionKey que sobreponha →
    // bloqueia (1:1 sobre a turma, ou turma diferente no mesmo horário).
    const blocking = findBlockingAppointment(relevant, p.startTime, c.endTime, sessionKey);
    if (blocking) {
      throw new ConflictError(
        `Horário ${p.startTime} em ${p.date} indisponível: o profissional já tem outro compromisso (${blocking.startTime}-${blocking.endTime}).`,
      );
    }

    // Vagas: conta alunos não-cancelados já nesta turma (mesmo sessionKey).
    const taken = countSeatsTaken(dayAppts, sessionKey);
    if (taken >= capacity) {
      throw new SessionFullError(
        `Turma de ${c.serviceName} às ${p.startTime} (${p.date}) está cheia (${capacity}/${capacity}).`,
        capacity,
        sessionKey,
      );
    }

    const isFirst = taken === 0;
    const docData: Record<string, unknown> = {
      businessId,
      clientId: p.clientId || '',
      clientName: p.clientName,
      serviceId: c.serviceId,
      serviceName: c.serviceName,
      date: p.date,
      startTime: p.startTime,
      endTime: c.endTime,
      duration: p.durationMinutes,
      status: 'agendado',
      price: c.price,
      color: c.color,
      idempotencyKey: c.idempotencyKey,
      sessionKey,
      isGroupSession: true,
      capacitySnapshot: capacity,
      createdAt: c.now,
      updatedAt: c.now,
    };
    if (effectiveProfessionalId !== undefined) docData.professionalId = effectiveProfessionalId;
    const profName = matched?.professionalName ?? p.professionalName;
    if (profName !== undefined) docData.professionalName = profName;
    if (p.clientPhone !== undefined) docData.clientPhone = p.clientPhone;
    if (p.notes !== undefined) docData.notes = p.notes;
    if (p.channelType !== undefined) docData.channelType = p.channelType;
    if (p.conversationId !== undefined) docData.conversationId = p.conversationId;
    if (p.dealId !== undefined) docData.dealId = p.dealId;

    tx.create(newRef, docData);

    // P2.9: consome 1 uso do ciclo da mensalidade (atômico com a criação do
    // appointment — só conta se a reserva foi efetivada).
    if (membership) {
      tx.update(adminDb.collection('clientMemberships').doc(membership.id), {
        usesThisCycle: membershipUses + 1,
        updatedAt: c.now,
      });
    }

    const seatsRemaining = capacity - (taken + 1);
    return {
      id: newRef.id,
      status: (isFirst ? 'created' : 'joined') as 'created' | 'joined',
      date: p.date,
      startTime: p.startTime,
      endTime: c.endTime,
      serviceName: c.serviceName,
      professionalName: profName,
      sessionKey,
      seatsRemaining,
      capacity,
    };
  }).catch(async (err: unknown) => {
    if (err instanceof SessionFullError) {
      const alternatives = await loadGroupAlternatives(businessId, p, c.serviceId, sessionKey);
      return {
        status: 'full' as const,
        date: p.date,
        startTime: p.startTime,
        endTime: c.endTime,
        serviceName: c.serviceName,
        professionalName: p.professionalName,
        conflictReason: err.message,
        alternatives,
        sessionKey: err.sessionKey,
        capacity: err.capacity,
      };
    }
    if (err instanceof ConflictError) {
      const alternatives = await loadGroupAlternatives(businessId, p, c.serviceId, sessionKey);
      return {
        status: 'conflict' as const,
        date: p.date,
        startTime: p.startTime,
        endTime: c.endTime,
        serviceName: c.serviceName,
        professionalName: p.professionalName,
        conflictReason: err.message,
        alternatives,
      };
    }
    // P2.9: limite do plano atingido → 'conflict' acionável (sem alternativas
    // de horário: o bloqueio é de cota, não de slot).
    if (err instanceof MembershipLimitError) {
      return {
        status: 'conflict' as const,
        date: p.date,
        startTime: p.startTime,
        endTime: c.endTime,
        serviceName: c.serviceName,
        professionalName: p.professionalName,
        conflictReason: err.message,
      };
    }
    throw err;
  });

  return result;
}

/**
 * Outras sessões da grade (mesmo dia) com vaga, ranqueadas pela proximidade
 * do horário pedido. Exclui a sessão pedida (sessionKey igual).
 */
async function loadGroupAlternatives(
  businessId: string,
  p: BookParams,
  serviceId: string,
  requestedSessionKey: string,
): Promise<AvailabilitySlot[]> {
  try {
    const avail = await checkAvailability(businessId, p.date, p.professionalId, p.durationMinutes, serviceId);
    const requestedMin = timeToMinutes(p.startTime);
    return avail.slots
      .filter(s => s.sessionKey !== requestedSessionKey)
      .sort((a, b) => Math.abs(timeToMinutes(a.startTime) - requestedMin) - Math.abs(timeToMinutes(b.startTime) - requestedMin))
      .slice(0, 3);
  } catch (err) {
    console.warn('[agent/tools/agenda] book(group): failed to load alternatives', err);
    return [];
  }
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

async function listToday(businessId: string): Promise<Appointment[]> {
  const today = new Date().toISOString().slice(0, 10);
  const snap = await adminDb
    .collection('appointments')
    .where('businessId', '==', businessId)
    .where('date', '==', today)
    .orderBy('startTime', 'asc')
    .get();
  return snap.docs.map((d) => ({ ...(d.data() as Appointment), id: d.id }));
}

async function listUpcoming(
  businessId: string,
  limit: number,
  daysAhead: number,
  professionalId?: string,
): Promise<Appointment[]> {
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date();
  end.setDate(end.getDate() + Math.min(Math.max(daysAhead, 1), 60));
  const endIso = end.toISOString().slice(0, 10);
  const cap = Math.min(limit, 50);

  const buildBase = () => adminDb
    .collection('appointments')
    .where('businessId', '==', businessId)
    .where('date', '>=', today)
    .where('date', '<=', endIso) as FirebaseFirestore.Query;

  if (professionalId) {
    // Multi-prof: 2 queries paralelas (legado + array-contains) e merge.
    // Sort em-memória pq merge perde ordem global do Firestore.
    const { fetchAppointmentsForProfessional } = await import('@/lib/services/appointments-server');
    const docs = await fetchAppointmentsForProfessional(buildBase, professionalId);
    return docs
      .map((d) => ({ ...(d.data() as Appointment), id: d.id }))
      .filter((a) => a.status !== 'cancelado' && a.status !== 'concluido')
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
      .slice(0, cap);
  }

  const snap = await buildBase().orderBy('date', 'asc').orderBy('startTime', 'asc').limit(cap).get();
  return snap.docs
    .map((d) => ({ ...(d.data() as Appointment), id: d.id }))
    .filter((a) => a.status !== 'cancelado' && a.status !== 'concluido');
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

  // R4/P1.9/P2.16: valida a transição de status pela FSM ANTES do write. Bloqueia,
  // entre outros, agendado→concluido (que geraria comissão sem atendimento). Só
  // checa quando o status realmente muda (no-op se o patch repete o status atual).
  if (cleanPatch.status !== undefined && cleanPatch.status !== data.status) {
    assertTransitionAppointment(data.status, cleanPatch.status as AppointmentStatus);
  }

  // Tx atomica: helper re-checa conflito DENTRO da tx (Admin SDK suporta
  // query reads), herdando date/startTime/professionalId do existente
  // quando o patch n inclui. Sem isso, IA podia mover apt pra slot ja
  // ocupado por outro apt e ambos ficavam validos.
  await updateAppointmentSafeAdmin(adminDb, id, {
    businessId,
    ...cleanPatch,
  });

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
