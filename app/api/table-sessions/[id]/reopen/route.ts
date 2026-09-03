import { type NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { ReopenTableSessionBodySchema } from '@/lib/contracts/api/tableSession';
import { reopenTableSessionAdmin } from '@/lib/services/table-session-admin';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { jsonError, mapTableSessionError } from '../../_shared';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = await request.json().catch(() => null);
  const parsed = ReopenTableSessionBodySchema.safeParse(raw);
  if (!parsed.success) return jsonError(`Dados inválidos: ${JSON.stringify(parsed.error.flatten())}`, 400);

  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.operator) {
    return jsonError('Sem permissão para reabrir mesas.', 403);
  }

  try {
    const session = await reopenTableSessionAdmin({
      db: adminDb,
      sessionId: id,
      businessId: parsed.data.businessId,
      actor: { id: auth.uid, name: auth.name, type: 'user' },
    });
    return NextResponse.json({ ok: true, data: { session } });
  } catch (cause) {
    return mapTableSessionError(cause);
  }
}
