/**
 * Backfill: ChannelConnection soft-delete pra contrato unificado.
 *
 * Razao: ate a Fase 4 do plano de soft-delete, deletes em `channelConnections`
 * gravavam `isActive: false + isConnected: false + disconnectedAt` em primary
 * connections e hard-deletavam non-primary. Apos o refactor, AMBOS branches
 * gravam tambem `deletedAt + audit fields`. Docs antigos podem estar em:
 *
 *   1. `isActive: false` + `deletedAt: ISO`         → ok, formato novo
 *   2. `isActive: false` SEM deletedAt              → backfill: gerar deletedAt
 *   3. `isActive: true` (ou ausente)                → ativo, skip
 *
 * Caso #2 sao primary connections desativadas antes da Fase 4. Sem o backfill,
 * elas nao aparecem na Lixeira (que filtra por `where('deletedAt','>=',cutoff)`).
 *
 * Non-primary hard-deletadas no passado nao podem ser recuperadas — o doc nao
 * existe mais no Firestore. Esse script so cobre primary soft-deletadas legadas.
 *
 * Idempotente — pode rodar multiplas vezes.
 *
 * Como rodar:
 *   npx tsx --env-file=.env.local scripts/backfill-channel-connections-soft-delete.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/backfill-channel-connections-soft-delete.ts
 *   npx tsx --env-file=.env.local scripts/backfill-channel-connections-soft-delete.ts --business=<id>
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
  console.log('[backfill-channel-connections-soft-delete] options:', opts);

  const stats: Stats = {
    scanned: 0,
    alreadyHaveDeletedAt: 0,
    active: 0,
    backfilled: 0,
    skippedNoTimestamp: 0,
  };

  let q: FirebaseFirestore.Query = adminDb.collection('channelConnections');
  if (opts.businessFilter) {
    q = q.where('businessId', '==', opts.businessFilter);
  }

  const snap = await q.get();
  console.log(`[backfill-channel-connections-soft-delete] varrendo ${snap.size} connections...`);

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

    // isActive nao e false (true ou undefined) — esta ativa.
    if (data.isActive !== false) {
      stats.active++;
      continue;
    }

    // Aqui: isActive === false E sem deletedAt → backfill.
    // Preferencia pra disconnectedAt (timestamp original do "delete"),
    // cai pra updatedAt, ultimo recurso createdAt.
    const inferredDeletedAt =
      (typeof data.disconnectedAt === 'string' && data.disconnectedAt) ||
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
      // Sem deletedBy/deletedByName — docs legados nao tem audit trail.
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
    console.error('[backfill-channel-connections-soft-delete] fatal:', err);
    process.exit(1);
  });
