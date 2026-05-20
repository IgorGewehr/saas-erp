/**
 * Backfill: Conversation soft-delete pra contrato unificado.
 *
 * Razao: ate a Fase 2 do plano de soft-delete, deletes em `conversations`
 * gravavam ambos `isDeleted: true` E `deletedAt`. Apos o refactor, deletes
 * gravam SO `deletedAt` (+ audit). Docs antigos podem estar em qualquer
 * combinacao:
 *
 *   1. `isDeleted: true` + `deletedAt: ISO`  → ok, ja tem deletedAt
 *   2. `isDeleted: true` SEM deletedAt        → backfill: gerar deletedAt
 *   3. SEM isDeleted + SEM deletedAt          → ativo, skip
 *   4. SEM isDeleted + `deletedAt: ISO`       → ok (formato novo)
 *
 * Caso #2 e o alvo do backfill. Sem o backfill, `isActiveRecord` filtra eles
 * via compat embutida, mas o cron de purge LGPD (Fase 6) nao vai encontra-los
 * pela query `where('deletedAt', '<', cutoff)`.
 *
 * Idempotente — pode rodar multiplas vezes.
 *
 * Como rodar:
 *   npx tsx --env-file=.env.local scripts/backfill-conversations-soft-delete.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/backfill-conversations-soft-delete.ts
 *   npx tsx --env-file=.env.local scripts/backfill-conversations-soft-delete.ts --business=<id>
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
  console.log('[backfill-conversations-soft-delete] options:', opts);

  const stats: Stats = {
    scanned: 0,
    alreadyHaveDeletedAt: 0,
    active: 0,
    backfilled: 0,
    skippedNoTimestamp: 0,
  };

  let q: FirebaseFirestore.Query = adminDb.collection('conversations');
  if (opts.businessFilter) {
    q = q.where('businessId', '==', opts.businessFilter);
  }

  const snap = await q.get();
  console.log(`[backfill-conversations-soft-delete] varrendo ${snap.size} conversas...`);

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

    // Ja tem deletedAt — formato novo OK.
    if (data.deletedAt) {
      stats.alreadyHaveDeletedAt++;
      continue;
    }

    // isDeleted nao e true (false, undefined, ou nem existe) — esta ativo.
    if (data.isDeleted !== true) {
      stats.active++;
      continue;
    }

    // Aqui: isDeleted === true E sem deletedAt → backfill.
    // Tenta usar updatedAt como aproximacao do momento do delete; cai pra
    // createdAt se ausente.
    const inferredDeletedAt =
      (typeof data.updatedAt === 'string' && data.updatedAt) ||
      (typeof data.createdAt === 'string' && data.createdAt) ||
      null;

    if (!inferredDeletedAt) {
      stats.skippedNoTimestamp++;
      console.warn(`[backfill] doc ${doc.id} sem updatedAt nem createdAt — pulando`);
      continue;
    }

    batch.update(doc.ref, {
      deletedAt: inferredDeletedAt,
      updatedAt: now,
      // Nao setamos deletedBy/deletedByName — docs legados nao tem audit trail.
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
  console.log(`Ativos (isDeleted !== true):   ${stats.active}`);
  console.log(`Backfilled (legado):           ${stats.backfilled}`);
  console.log(`Sem timestamp pra inferir:     ${stats.skippedNoTimestamp}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill-conversations-soft-delete] fatal:', err);
    process.exit(1);
  });
