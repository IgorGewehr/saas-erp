import { NextResponse, type NextRequest } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { CreateAppointmentBodySchema } from '@/contracts/api/agenda/create';
import { createAppointmentAdmin } from '@/lib/services/appointment-server';
import { AppointmentConflictError } from '@/lib/services/appointmentTxGuardAdmin';

/**
 * Criação autoritativa de appointments (M06.1) — substitui os `addDoc`
 * diretos de ScheduleActionDialog.tsx (CRM) e PDVModule.tsx (retorno/
 * pré-agendamento). `businessId` sempre vem de `verifyAuth`, nunca do body
 * (mesmo princípio de /api/events/dispatch). Ver contrato em
 * lib/contracts/api/agenda/create.ts pro porquê `professionalId` é opcional
 * sem ser regressão.
 */

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = CreateAppointmentBodySchema.safeParse(raw);
  if (!parsed.success) {
    return error(`Dados inválidos: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }

  const auth = await verifyAuth(request);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.operator) {
    return error('Sem permissão para criar agendamentos.', 403);
  }

  const now = new Date().toISOString();
  const body = parsed.data;

  try {
    const { id } = await createAppointmentAdmin({
      payload: {
        businessId: auth.businessId,
        clientId: body.clientId || '',
        clientName: body.clientName,
        ...(body.clientPhone ? { clientPhone: body.clientPhone } : {}),
        ...(body.serviceId ? { serviceId: body.serviceId } : {}),
        serviceName: body.serviceName,
        ...(body.professionalId ? { professionalId: body.professionalId } : {}),
        date: body.date,
        startTime: body.startTime,
        endTime: body.endTime,
        duration: body.duration,
        price: body.price,
        status: 'agendado',
        ...(body.notes ? { notes: body.notes } : {}),
        createdAt: now,
        updatedAt: now,
      },
    });
    return NextResponse.json({ ok: true, data: { id } }, { status: 201 });
  } catch (cause) {
    if (cause instanceof AppointmentConflictError) {
      return error(`Conflito de horário: ${cause.message}`, 409);
    }
    console.error('[appointments/create] failed', cause);
    return error('Não foi possível criar o agendamento.', 500);
  }
}
