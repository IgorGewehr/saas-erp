/**
 * Backfill: Service soft-delete pra contrato unificado.
 *
 * Razao: services ja tinha soft-delete parcial — writes gravavam ambos
 * isActive=false E deletedAt. Mas docs muito antigos podem ter so isActive=false
 * sem deletedAt (legado pre-introducao do campo, similar a clients).
 *
 * Tambem cobre docs onde operador manualmente setou isActive=false via outra
 * rota (ex: API publica /api/v1/services com body { isActive: false }) sem
 * passar pelo handleDeleteService.
 *
 * Idempotente — pode rodar multiplas vezes.
 *
 * Como rodar:
 *   npx tsx --env-file=.env.local scripts/backfill-services-soft-delete.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/backfill-services-soft-delete.ts
 *   npx tsx --env-file=.env.local scripts/backfill-services-soft-delete.ts --business=<id>
 */

import { adminDb } from '@/lib/config/firebaseAdmin';

const BATCH_SIZE = 400;

interface Stats {
  scanned: number;
  alreadyHaveDeletedAt: number;
  active: number;
  backfilled: number;
  skippedNoTimestamp: number;
}

interface CliOpts {
  dryRun: boolean;
  businessFilter: string | null;
}

function parseArgs(): CliOpts {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const bizArg = args.find((a) => a.startsWith('--business='));
  const businessFilter = bizArg ? bizArg.split('=')[1] : null;
  return { dryRun, businessFilter };
}

async function main() {
  const opts = parseArgs();
  console.log('[backfill-services-soft-delete] options:', opts);

  const stats: Stats = {
    scanned: 0,
    alreadyHaveDeletedAt: 0,
    active: 0,
    backfilled: 0,
    skippedNoTimestamp: 0,
  };

  let q: FirebaseFirestore.Query = adminDb.collection('services');
  if (opts.businessFilter) {
    q = q.where('businessId', '==', opts.businessFilter);
  }

  const snap = await q.get();
  console.log(`[backfill-services-soft-delete] varrendo ${snap.size} services...`);

  let batch = adminDb.batch();
  let batchCount = 0;
  const now = new Date().toISOString();

  const flushBatch = async () => {
    if (batchCount === 0) return;
    if (!opts.dryRun) await batch.commit();
    batch = adminDb.batch();
    batchCount = 0;
  };

  for (const doc of snap.docs) {
    stats.scanned++;
    const data = doc.data();

    if (data.deletedAt) {
      stats.alreadyHaveDeletedAt++;
      continue;
    }
    if (data.isActive !== false) {
      stats.active++;
      continue;
    }

    const inferredDeletedAt =
      (typeof data.updatedAt === 'string' && data.updatedAt) ||
      (typeof data.createdAt === 'string' && data.createdAt) ||
      null;

    if (!inferredDeletedAt) {
      stats.skippedNoTimestamp++;
      console.warn(`[backfill] doc ${doc.id} sem timestamps — pulando`);
      continue;
    }

    batch.update(doc.ref, {
      deletedAt: inferredDeletedAt,
      updatedAt: now,
    });
    batchCount++;
    stats.backfilled++;

    if (batchCount >= BATCH_SIZE) await flushBatch();
  }
  await flushBatch();

  console.log('\n=== RESUMO ===');
  console.log(`Modo: ${opts.dryRun ? 'DRY-RUN (nada escrito)' : 'WRITE'}`);
  if (opts.businessFilter) console.log(`Business filter: ${opts.businessFilter}`);
  console.log(`Total varridos:                ${stats.scanned}`);
  console.log(`Ja tinham deletedAt:           ${stats.alreadyHaveDeletedAt}`);
  console.log(`Ativos (isActive !== false):   ${stats.active}`);
  console.log(`Backfilled (legado):           ${stats.backfilled}`);
  console.log(`Sem timestamp pra inferir:     ${stats.skippedNoTimestamp}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill-services-soft-delete] fatal:', err);
    process.exit(1);
  });
