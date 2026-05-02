/**
 * GET  /api/agent/circuit?businessId=xxx  — lê estado do circuit breaker
 * POST /api/agent/circuit?businessId=xxx  — reseta o circuit breaker (admin)
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { getCircuitStatus, resetCircuit } from '@/lib/agent/circuit-breaker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const businessId = new URL(req.url).searchParams.get('businessId');
  if (!businessId) return NextResponse.json({ error: 'businessId required' }, { status: 400 });
  const authResult = await verifyAuth(req, businessId);
  if (isAuthError(authResult)) return authResult;
  const status = await getCircuitStatus(businessId);
  return NextResponse.json(status);
}

export async function POST(req: NextRequest) {
  const businessId = new URL(req.url).searchParams.get('businessId');
  if (!businessId) return NextResponse.json({ error: 'businessId required' }, { status: 400 });
  const authResult = await verifyAuth(req, businessId);
  if (isAuthError(authResult)) return authResult;
  await resetCircuit(businessId);
  return NextResponse.json({ ok: true, message: 'Circuit breaker resetado.' });
}
