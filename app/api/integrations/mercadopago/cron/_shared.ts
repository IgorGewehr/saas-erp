/**
 * app/api/integrations/mercadopago/cron/_shared.ts
 *
 * Utilidades comuns aos crons de resiliência do Mercado Pago. SERVER-ONLY.
 *
 * AUTH: idêntica aos crons existentes (broadcasts/process-scheduled,
 * birthday-campaigns/run) — Authorization: Bearer ${CRON_SECRET}, timing-safe.
 *
 * VARREDURA POR TENANT: lista os businesses com a conta MP conectada lendo a
 * FLAG PÚBLICA espelhada (businesses/{id}.mpConnected). Equality em campo único
 * é auto-indexada pelo Firestore — NUNCA fazemos full-scan da coleção. Cada
 * cron processa tenant a tenant, isolando falhas (try/catch por tenant).
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { adminDb } from '@/lib/config/firebaseAdmin';

/** Teto de tenants varridos por execução — evita pile-up se algo travar. */
export const MAX_TENANTS_PER_RUN = 200;

export function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // sem secret configurado, endpoint fica fechado
  const auth = req.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) return false;
  const token = auth.slice(7);
  if (token.length !== secret.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/**
 * IDs dos businesses com conta MP conectada (flag pública mpConnected=true).
 * Single-field equality → auto-indexado. Limita a MAX_TENANTS_PER_RUN.
 */
export async function listConnectedBusinessIds(): Promise<string[]> {
  const snap = await adminDb
    .collection('businesses')
    .where('mpConnected', '==', true)
    .limit(MAX_TENANTS_PER_RUN)
    .get();
  return snap.docs.map((d) => d.id);
}
