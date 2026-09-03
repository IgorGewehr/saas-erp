import { NextResponse, type NextRequest } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { CancelScheduleBlockBodySchema } from '@/contracts/api/agenda/scheduleBlocks';
import { cancelScheduleBlockAdmin, ScheduleBlockError } from '@/lib/services/scheduleBlock-admin';

/** Cancelamento de bloqueio de agenda (M06.3a) — `manager+`, mesmo nível da criação. */

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: blockId } = await params;
  const raw = await request.json().catch(() => null);
  const parsed = CancelScheduleBlockBodySchema.safeParse(raw);
  if (!parsed.success) {
    return error(`Dados inválidos: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }

  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.manager) {
    return error('Sem permissão para cancelar bloqueio de agenda.', 403);
  }

  try {
    const { block } = await cancelScheduleBlockAdmin({
      blockId,
      businessId: parsed.data.businessId,
      actor: { id: auth.uid, name: auth.name },
    });
    return NextResponse.json({ ok: true, data: { status: block.status } });
  } catch (cause) {
    if (cause instanceof ScheduleBlockError) {
      const status = cause.code === 'TENANT_MISMATCH' ? 403 : cause.code === 'BLOCK_NOT_FOUND' ? 404 : 400;
      return error(cause.message, status);
    }
    if (cause instanceof Error && cause.message.startsWith('ScheduleBlock FSM:')) {
      return error(cause.message, 409);
    }
    console.error('[schedule-blocks/cancel] failed', cause);
    return error('Não foi possível cancelar o bloqueio.', 500);
  }
}
