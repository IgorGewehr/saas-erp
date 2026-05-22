/**
 * GET/POST /api/data-retention/run
 *
 * Cron LGPD — purge real (hard-delete) de docs Tier 3 com `deletedAt` mais
 * antigo que a janela de retencao (default 30d). Chamado diariamente pelo
 * cron interno do docker-compose as 3 AM (baixo trafego).
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (mesmo padrao dos outros
 * endpoints cron — broadcasts/process-scheduled, agent/scheduled/run, etc).
 *
 * Query params opcionais:
 *   - dryRun=true        — conta o que seria purgado, n escreve nada
 *   - businessId=xxx     — limita a um tenant (debug/cleanup manual)
 *   - retentionDays=N    — override da janela (default 30)
 *
 * Resposta:
 *   { businessesProcessed: N, totalPurged: N, totalCascaded: N,
 *     totalErrors: N, runs: [PurgeRunResult] }
 *
 * Ver lib/services/dataRetention.ts + docs/soft-delete-strategy.md §4.4 §5 Fase 6.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  purgeAllBusinesses,
  purgeExpiredSoftDeletes,
  DEFAULT_RETENTION_DAYS,
  type PurgeOptions,
} from '@/lib/services/dataRetention';

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // sem env var, endpoint fechado
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

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const dryRun = searchParams.get('dryRun') === 'true';
  const businessId = searchParams.get('businessId');
  const retentionDaysParam = searchParams.get('retentionDays');
  const retentionDays = retentionDaysParam
    ? Math.max(1, Math.min(parseInt(retentionDaysParam, 10) || DEFAULT_RETENTION_DAYS, 365))
    : DEFAULT_RETENTION_DAYS;

  const opts: PurgeOptions = { dryRun, retentionDays };

  try {
    if (businessId) {
      const run = await purgeExpiredSoftDeletes(adminDb, businessId, opts);
      return NextResponse.json({
        businessesProcessed: 1,
        totalPurged: run.totalPurged,
        totalCascaded: run.totalCascaded,
        totalErrors: run.totalErrors,
        runs: [run],
      });
    }
    const result = await purgeAllBusinesses(adminDb, opts);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[data-retention/run] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

// GET pra simplificar caller (curl/cron sem body) ou POST.
export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
