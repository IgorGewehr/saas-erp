/**
 * Backfill: Conversation.visibleToUserIds (M07.3).
 *
 * Razão: a restrição de visibilidade por setor/privacidade de uma conversa
 * (sectorIds/isPrivate/assignedTo) agora é aplicada no SERVIDOR via um
 * campo denormalizado `visibleToUserIds` (ver
 * lib/services/conversationVisibility.ts + docs/conversas/
 * CONVERSAS_M07_3_VISIBILIDADE_SETOR.md pro porquê de precisar dessa
 * denormalização em vez de checar sectorIds direto em firestore.rules).
 * Conversas criadas antes deste fix não têm o campo — ficam invisíveis
 * pra não-admin na nova query de "sem restrição" (que casa por igualdade
 * exata contra `null`, não por campo ausente).
 *
 * Idempotente — pode rodar múltiplas vezes (skipa docs que já têm o campo).
 *
 * Como rodar:
 *   npx tsx scripts/backfill-conversation-visible-to.ts
 *   npx tsx scripts/backfill-conversation-visible-to.ts --dry-run
 *   npx tsx scripts/backfill-conversation-visible-to.ts --business=<id>
 *
 * Lógica: mesma de computeVisibleToUserIds — sem sectorIds e sem isPrivate
 * → null (sem restrição); senão → união de assignedTo + membros de cada
 * setor em sectorIds (setor apagado é ignorado, conservador).
 *
 * Output: resumo com total varrido, atualizado, já populado e por tipo de
 * resultado (null vs. restrito).
 */

import { adminDb } from '@/lib/config/firebaseAdmin';
import { computeVisibleToUserIds, type SectorMembersLookup } from '@/lib/services/conversationVisibility';
import type { Conversation, Sector } from '@/lib/types';

const BATCH_SIZE = 400;

interface Stats {
  scanned: number;
  alreadyHave: number;
  backfilledUnrestricted: number;
  backfilledRestricted: number;
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
  console.log('[backfill-visible-to] options:', opts);

  const stats: Stats = {
    scanned: 0,
    alreadyHave: 0,
    backfilledUnrestricted: 0,
    backfilledRestricted: 0,
  };

  // Carrega sectors em memória por business (read único, lookup local).
  const sectorsByBiz = new Map<string, Map<string, SectorMembersLookup>>();
  let sectorQuery = adminDb.collection('sectors');
  if (opts.businessFilter) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sectorQuery = sectorQuery.where('businessId', '==', opts.businessFilter) as any;
  }
  const sectorSnap = await sectorQuery.get();
  for (const d of sectorSnap.docs) {
    const data = d.data() as Sector;
    if (!sectorsByBiz.has(data.businessId)) sectorsByBiz.set(data.businessId, new Map());
    sectorsByBiz.get(data.businessId)!.set(d.id, { memberIds: data.memberIds ?? [] });
  }
  console.log(`[backfill-visible-to] loaded ${sectorSnap.size} sectors em ${sectorsByBiz.size} businesses`);

  let convQuery = adminDb.collection('conversations');
  if (opts.businessFilter) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    convQuery = convQuery.where('businessId', '==', opts.businessFilter) as any;
  }

  let batch = adminDb.batch();
  let batchCount = 0;

  const flushBatch = async () => {
    if (batchCount === 0) return;
    if (!opts.dryRun) await batch.commit();
    batch = adminDb.batch();
    batchCount = 0;
  };

  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let pageQuery = convQuery.orderBy('__name__').limit(1000);
    if (lastDoc) pageQuery = pageQuery.startAfter(lastDoc);
    const pageSnap = await pageQuery.get();
    if (pageSnap.empty) break;

    for (const doc of pageSnap.docs) {
      stats.scanned++;
      const conv = doc.data() as Conversation;

      if (conv.visibleToUserIds !== undefined) {
        stats.alreadyHave++;
        continue;
      }

      const sectorsById = sectorsByBiz.get(conv.businessId) ?? new Map<string, SectorMembersLookup>();
      const visibleToUserIds = computeVisibleToUserIds({
        sectorIds: conv.sectorIds,
        isPrivate: conv.isPrivate,
        assignedTo: conv.assignedTo,
        sectorsById,
      });

      batch.update(doc.ref, { visibleToUserIds, updatedAt: new Date().toISOString() });
      batchCount++;
      if (visibleToUserIds === null) stats.backfilledUnrestricted++;
      else stats.backfilledRestricted++;

      if (batchCount >= BATCH_SIZE) await flushBatch();
    }

    if (pageSnap.size < 1000) break;
    lastDoc = pageSnap.docs[pageSnap.docs.length - 1];
  }
  await flushBatch();

  console.log('\n=== RESUMO ===');
  console.log(`Modo: ${opts.dryRun ? 'DRY-RUN (nada escrito)' : 'WRITE'}`);
  if (opts.businessFilter) console.log(`Business filter: ${opts.businessFilter}`);
  console.log(`Conversas varridas:              ${stats.scanned}`);
  console.log(`Já tinham visibleToUserIds:      ${stats.alreadyHave}`);
  console.log(`Backfilled sem restrição (null): ${stats.backfilledUnrestricted}`);
  console.log(`Backfilled restritas:            ${stats.backfilledRestricted}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill-visible-to] fatal:', err);
    process.exit(1);
  });
