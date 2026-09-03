import { type NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { OpenTableSessionBodySchema } from '@/lib/contracts/api/tableSession';
import { openTableSessionAdmin } from '@/lib/services/table-session-admin';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { jsonError, mapTableSessionError } from './_shared';

/** Abre (ou reusa, se já existir) a comanda `aberta` de uma mesa. Idempotente. */
export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = OpenTableSessionBodySchema.safeParse(raw);
  if (!parsed.success) return jsonError(`Dados inválidos: ${JSON.stringify(parsed.error.flatten())}`, 400);

  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.operator) {
    return jsonError('Sem permissão para abrir mesas.', 403);
  }

  try {
    const { session, created } = await openTableSessionAdmin({
      db: adminDb,
      businessId: parsed.data.businessId,
      tableLabel: parsed.data.tableLabel,
      tableId: parsed.data.tableId,
      sectorId: parsed.data.sectorId,
      guestName: parsed.data.guestName,
      guestCount: parsed.data.guestCount,
      actor: { id: auth.uid, name: auth.name, type: 'user' },
    });
    return NextResponse.json({ ok: true, data: { session, created } });
  } catch (cause) {
    return mapTableSessionError(cause);
  }
}
