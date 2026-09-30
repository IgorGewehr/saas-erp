import { type NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { OpenTableSessionBodySchema } from '@/lib/contracts/api/tableSession';
import { openTableSessionAdmin } from '@/lib/services/table-session-admin';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { jsonError, mapTableSessionError } from './_shared';

/**
 * Lista as comandas ativas (aberta + fechada) do negócio. Usada pelo módulo
 * Mesas por polling — evita depender do deploy das regras do Firestore pra
 * `tableSessions` (o client não lê a coleção direto). `?businessId=` obrigatório.
 */
export async function GET(request: NextRequest) {
  const businessId = new URL(request.url).searchParams.get('businessId');
  if (!businessId) return jsonError('businessId obrigatório.', 400);

  const auth = await verifyAuth(request, businessId);
  if (isAuthError(auth)) return auth;

  try {
    const snap = await adminDb.collection('tableSessions')
      .where('businessId', '==', businessId)
      .where('status', 'in', ['aberta', 'fechada'])
      .get();
    const sessions = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String((b as { openedAt?: string }).openedAt ?? '').localeCompare(String((a as { openedAt?: string }).openedAt ?? '')));
    return NextResponse.json({ ok: true, data: { sessions } });
  } catch (cause) {
    console.error('[table-sessions] list failed', cause);
    return jsonError('Não foi possível carregar as comandas.', 500);
  }
}

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
