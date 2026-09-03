import { NextResponse, type NextRequest } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { CreateScheduleBlockBodySchema } from '@/contracts/api/agenda/scheduleBlocks';
import { createScheduleBlockAdmin } from '@/lib/services/scheduleBlock-admin';

/**
 * Criação de bloqueio de agenda (M06.3a) — férias, feriado, indisponibilidade.
 * `manager+` (decisão de agenda de outra pessoa não é ação de operador raso —
 * mesmo nível de NFSe/NFCe). `businessId` sempre de `verifyAuth`.
 */

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = CreateScheduleBlockBodySchema.safeParse(raw);
  if (!parsed.success) {
    return error(`Dados inválidos: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }

  const auth = await verifyAuth(request);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.manager) {
    return error('Sem permissão para bloquear agenda.', 403);
  }

  const { professionalName, ...input } = parsed.data;

  try {
    const { block, conflictingAppointments } = await createScheduleBlockAdmin({
      businessId: auth.businessId,
      input,
      professionalName,
      actor: { id: auth.uid, name: auth.name },
    });
    return NextResponse.json({
      ok: true,
      data: {
        id: block.id,
        conflictingAppointments: conflictingAppointments.map((a) => ({
          id: a.id, clientName: a.clientName, date: a.date, startTime: a.startTime, endTime: a.endTime,
        })),
      },
    }, { status: 201 });
  } catch (cause) {
    console.error('[schedule-blocks/create] failed', cause);
    return error('Não foi possível criar o bloqueio.', 500);
  }
}
