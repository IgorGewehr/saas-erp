import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { AppointmentStatusSchema } from '@/contracts/domain/appointment';
import { ensureDomainEventHandlers } from '@/contracts/_runtime/handlers';
import {
  transitionAppointmentAdmin,
  AppointmentTransitionError,
} from '@/lib/services/appointment-server';

/**
 * Transição de status autenticada de appointments (M06.2) — mirror de
 * app/api/orders/[id]/transition/route.ts. Substitui os writes diretos de
 * status que AgendaModule.tsx fazia pelo SDK cliente (updateDoc + dispatch
 * de evento separado). Aplica os efeitos de conclusão/cancelamento na MESMA
 * chamada — ver lib/services/appointment-server.ts pro porquê.
 */

// Garante handlers registrados antes do primeiro dispatch (idempotente) —
// mesmo padrão de app/api/events/dispatch/route.ts.
ensureDomainEventHandlers();

const BodySchema = z.object({
  businessId: z.string().min(1),
  status: AppointmentStatusSchema,
});

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: appointmentId } = await params;
  const raw = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return error(`Dados inválidos: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }

  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.operator) {
    return error('Sem permissão para alterar agendamentos.', 403);
  }

  try {
    const result = await transitionAppointmentAdmin({
      appointmentId,
      businessId: parsed.data.businessId,
      targetStatus: parsed.data.status,
      actor: { id: auth.uid, name: auth.name },
    });
    return NextResponse.json({
      ok: true,
      data: { status: result.appointment.status, dispatched: result.dispatched },
    });
  } catch (cause) {
    if (cause instanceof AppointmentTransitionError) {
      const status = cause.code === 'TENANT_MISMATCH' ? 403
        : cause.code === 'APPOINTMENT_NOT_FOUND' ? 404
          : 400;
      return error(cause.message, status);
    }
    if (cause instanceof Error && cause.message.startsWith('Appointment FSM:')) {
      return error(cause.message, 409);
    }
    console.error('[appointments/transition] failed', cause);
    return error('Não foi possível alterar o agendamento.', 500);
  }
}
