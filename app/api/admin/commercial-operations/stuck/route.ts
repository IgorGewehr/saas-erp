import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { findStuckCommercialOperations } from '@/lib/services/m02-commercial-audit';
import { ROLE_HIERARCHY } from '@/lib/types';

/**
 * Painel de M02.9/M02.8 ("estado composto da operação e ações de retentativa
 * autorizadas") — lista `commercialOperations` do tenant chamador fora de
 * estado terminal e sem lease ativo (mesmo critério de "posso retomar?" do
 * coordenador). Read-only: retomada/compensação continuam manuais (ver
 * docs/paridade/M02_RUNBOOK_OPERACOES.md) — expor um botão de ação aqui
 * exigiria desenho próprio (qual efeito reexecutar, com que segurança) fora
 * do escopo deste painel.
 *
 * `commercialOperations` é Admin-SDK-only pra leitura E escrita
 * (firestore.rules: `allow read, write: if false`) — por isso esta rota
 * existe; não dá pra ler direto do client SDK como outras telas de auditoria.
 */

const ADMIN_MIN_ROLE = 'admin';

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (isAuthError(auth)) return auth;

  if (ROLE_HIERARCHY[auth.role as keyof typeof ROLE_HIERARCHY] < ROLE_HIERARCHY[ADMIN_MIN_ROLE]) {
    return NextResponse.json({ error: 'Forbidden — apenas admin/founder' }, { status: 403 });
  }

  try {
    // Mesmo padrão de scripts/audit-m02-commercial.ts: lê por businessId e
    // deixa a função pura filtrar terminal/não-terminal — evita depender de
    // `not-in` (limitações de índice/operador do Firestore) pra um volume
    // que, por tenant, nunca chega perto do teto.
    const snapshot = await adminDb
      .collection('commercialOperations')
      .where('businessId', '==', auth.businessId)
      .limit(500)
      .get();

    const operations = snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    const stuck = findStuckCommercialOperations(operations, auth.businessId, new Date().toISOString());

    return NextResponse.json({ ok: true, businessId: auth.businessId, operations: stuck });
  } catch (err) {
    console.error('[admin/commercial-operations/stuck] error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
