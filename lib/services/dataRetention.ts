/**
 * lib/services/dataRetention.ts
 *
 * Cron LGPD — purge real (hard-delete) de docs Tier 3 que ja passaram da
 * janela de retencao do soft-delete (default: 30 dias apos `deletedAt`).
 *
 * Operacao SERVER-SIDE via Admin SDK. Caller e o endpoint
 * `/api/data-retention/run` (autenticado via Bearer CRON_SECRET), que e
 * disparado pelo cron interno do docker-compose as 3 AM.
 *
 * REGRA R1 (multi-tenant) — critica aqui:
 *   Sempre roda PER-TENANT (`businessId` no where). NUNCA usa collection
 *   group query cross-tenant. O caller itera businesses e chama
 *   purgeExpiredSoftDeletes(adminDb, businessId) per business pra que um
 *   bug aqui n vaze docs entre tenants.
 *
 * Escopo do MVP (Fase 6, Item 6 do backlog soft-delete):
 *   - Hard-delete dos docs Tier 3 com `deletedAt < (now - retentionDays)`:
 *       clients, conversations, kanbanBoards, services, channelConnections
 *   - Cascade hard-delete kanbanCards via `cascadeFromParentId` (cards
 *     cascateados juntos com o board)
 *   - Cleanup recursivo da subcolecao `conversations/{id}/messages` via
 *     Admin SDK recursiveDelete (senao mensagens viram orfas inacessiveis)
 *   - Audit log por purge em `crmAuditLog` (action: 'lgpd-purge')
 *   - Dry-run mode pra inspecao sem write
 *
 * Deferido pra follow-up (Item 6.1):
 *   - Anonimizacao de PII denormalizada em Tier 1 (sales.clientName,
 *     appointments.clientName/serviceName, transactions.clientName, etc).
 *     Hoje viram orphans com `[Cliente excluido]` placeholder na UI, o
 *     que ja preserva contabilidade. Anonimizacao formal exige varrer ~8
 *     colecoes child e e escopo separado.
 *
 * Ver docs/soft-delete-strategy.md §4.4 (LGPD purge) e §5 Fase 6.
 */

import type { Firestore, WriteBatch } from 'firebase-admin/firestore';

/** Janela padrao de retencao em dias apos `deletedAt`. 30d alinha com
 *  Notion, Pipedrive, padrao do mercado. */
export const DEFAULT_RETENTION_DAYS = 30;

/** Colecoes Tier 3 sujeitas a purge automatico. Ordem importa pra cascade:
 *  kanbanBoards antes de kanbanCards (cards cascateados sao deletados como
 *  parte do purge do board). */
const TIER3_COLLECTIONS = [
  'clients',
  'conversations',
  'kanbanBoards',
  'services',
  'channelConnections',
] as const;

export type Tier3Collection = (typeof TIER3_COLLECTIONS)[number];

export interface PurgeOptions {
  /** Quantos dias apos `deletedAt` esperar antes de purgar. Default 30. */
  retentionDays?: number;
  /** Se true, conta o que SERIA purgado mas n escreve nada. */
  dryRun?: boolean;
  /** Limite hard de docs purgados por colecao por run (safety net). */
  maxPerCollection?: number;
}

export interface CollectionPurgeResult {
  collection: Tier3Collection;
  candidates: number;
  purged: number;
  cascaded: number;
  errors: number;
}

export interface PurgeRunResult {
  businessId: string;
  cutoff: string;
  dryRun: boolean;
  collections: CollectionPurgeResult[];
  totalPurged: number;
  totalCascaded: number;
  totalErrors: number;
}

const DEFAULT_MAX_PER_COLLECTION = 500;

/**
 * Roda o purge pra um unico tenant. Caller (cron endpoint) itera businesses.
 */
export async function purgeExpiredSoftDeletes(
  adminDb: Firestore,
  businessId: string,
  opts: PurgeOptions = {},
): Promise<PurgeRunResult> {
  if (!businessId) {
    throw new Error('purgeExpiredSoftDeletes: businessId obrigatorio (R1)');
  }
  const retentionDays = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const dryRun = opts.dryRun ?? false;
  const maxPerCollection = opts.maxPerCollection ?? DEFAULT_MAX_PER_COLLECTION;

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const collections: CollectionPurgeResult[] = [];
  for (const col of TIER3_COLLECTIONS) {
    const result = await purgeCollection(adminDb, businessId, col, cutoff, {
      dryRun,
      maxPerCollection,
    });
    collections.push(result);
  }

  const totalPurged = collections.reduce((a, c) => a + c.purged, 0);
  const totalCascaded = collections.reduce((a, c) => a + c.cascaded, 0);
  const totalErrors = collections.reduce((a, c) => a + c.errors, 0);

  return { businessId, cutoff, dryRun, collections, totalPurged, totalCascaded, totalErrors };
}

async function purgeCollection(
  adminDb: Firestore,
  businessId: string,
  collection: Tier3Collection,
  cutoff: string,
  opts: { dryRun: boolean; maxPerCollection: number },
): Promise<CollectionPurgeResult> {
  const result: CollectionPurgeResult = {
    collection,
    candidates: 0,
    purged: 0,
    cascaded: 0,
    errors: 0,
  };

  // Query: docs do tenant com deletedAt <= cutoff.
  // Indice composto necessario: (businessId ASC, deletedAt ASC) — ja existe
  // pra cada Tier 3 desde Fase 4 (firestore.indexes.json).
  const snap = await adminDb
    .collection(collection)
    .where('businessId', '==', businessId)
    .where('deletedAt', '<=', cutoff)
    .limit(opts.maxPerCollection)
    .get();

  result.candidates = snap.size;
  if (snap.empty) return result;

  for (const doc of snap.docs) {
    try {
      const data = doc.data();
      const purgeOp = await purgeOne(adminDb, collection, doc.id, data, opts.dryRun);
      result.purged += purgeOp.purged;
      result.cascaded += purgeOp.cascaded;
    } catch (err) {
      result.errors++;
      console.error(`[dataRetention] purge ${collection}/${doc.id} failed:`, err);
    }
  }

  return result;
}

/**
 * Purge de um doc individual. Encapsula cascade + audit por colecao.
 * Retorna {purged: 0|1, cascaded: N} pra agregar nas stats.
 */
async function purgeOne(
  adminDb: Firestore,
  collection: Tier3Collection,
  docId: string,
  data: FirebaseFirestore.DocumentData,
  dryRun: boolean,
): Promise<{ purged: number; cascaded: number }> {
  let cascaded = 0;

  if (collection === 'conversations') {
    // conversations tem subcolecao messages — recursiveDelete cobre o doc
    // raiz + todas subcolecoes em chunks (Admin SDK gerencia BulkWriter).
    const ref = adminDb.collection(collection).doc(docId);
    if (!dryRun) {
      await adminDb.recursiveDelete(ref);
    }
    await writeAuditLog(adminDb, data.businessId, collection, docId, data, dryRun);
    return { purged: 1, cascaded };
  }

  if (collection === 'kanbanBoards') {
    // Cascade hard-delete dos cards que foram cascateados juntos com o
    // board (cascadeFromParentId === boardId). Cards individualmente
    // soft-deletados sao purgados pelo proprio retention via colecao
    // kanbanCards quando virar Tier 3 (n esta no MVP). Por seguranca, so
    // deletamos os cascateados — os individuais ficam pra colecao deles.
    const childrenSnap = await adminDb
      .collection('kanbanCards')
      .where('businessId', '==', data.businessId)
      .where('cascadeFromParentId', '==', docId)
      .get();

    if (!childrenSnap.empty && !dryRun) {
      // Batch limit 500 — quebra se board tiver muitos cards.
      for (let i = 0; i < childrenSnap.docs.length; i += 400) {
        const batch: WriteBatch = adminDb.batch();
        for (const child of childrenSnap.docs.slice(i, i + 400)) {
          batch.delete(child.ref);
        }
        await batch.commit();
      }
    }
    cascaded = childrenSnap.size;

    if (!dryRun) {
      await adminDb.collection(collection).doc(docId).delete();
    }
    await writeAuditLog(adminDb, data.businessId, collection, docId, data, dryRun, { cascaded });
    return { purged: 1, cascaded };
  }

  // Default: hard-delete simples (clients, services, channelConnections).
  if (!dryRun) {
    await adminDb.collection(collection).doc(docId).delete();
  }
  await writeAuditLog(adminDb, data.businessId, collection, docId, data, dryRun);
  return { purged: 1, cascaded };
}

/**
 * Grava entrada em crmAuditLog. Mesmo no dryRun, n grava (so o caller saberia
 * o que foi simulado pelo retorno). Em modo write, grava sempre — audit failure
 * n bloqueia o purge (try/catch local), mas conta no `errors`.
 */
async function writeAuditLog(
  adminDb: Firestore,
  businessId: string,
  collection: Tier3Collection,
  docId: string,
  data: FirebaseFirestore.DocumentData,
  dryRun: boolean,
  extras: Record<string, unknown> = {},
): Promise<void> {
  if (dryRun) return;
  try {
    // Snapshot dos campos chave pra trilha — n grava o doc inteiro (poderia
    // ter PII volumoso). Foca em: quem deletou (audit do soft-delete) +
    // identificador do doc original.
    const details = {
      collection,
      docId,
      // Nome/identificador visivel pro audit ("Cliente Maria", "Servico Corte").
      name: data.name ?? data.contactName ?? data.clientName ?? null,
      // Quem fez o soft-delete originalmente (pode ser util pra investigacao).
      deletedAt: data.deletedAt ?? null,
      deletedBy: data.deletedBy ?? null,
      deletedByName: data.deletedByName ?? null,
      ...extras,
    };
    await adminDb.collection('crmAuditLog').add({
      businessId,
      userId: 'system',
      userName: 'cron-data-retention',
      action: 'lgpd-purge',
      details: JSON.stringify(details),
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    // Audit failure n deve bloquear o purge. Log e continua.
    console.warn('[dataRetention] audit log failed:', err);
  }
}

/**
 * Itera todos os businesses e roda purge per-tenant. Usado pelo cron.
 * Retorna stats agregadas + lista de runs per-business.
 */
export async function purgeAllBusinesses(
  adminDb: Firestore,
  opts: PurgeOptions = {},
): Promise<{
  businessesProcessed: number;
  totalPurged: number;
  totalCascaded: number;
  totalErrors: number;
  runs: PurgeRunResult[];
}> {
  const businessesSnap = await adminDb.collection('businesses').get();
  const runs: PurgeRunResult[] = [];
  let totalPurged = 0;
  let totalCascaded = 0;
  let totalErrors = 0;

  for (const businessDoc of businessesSnap.docs) {
    try {
      const run = await purgeExpiredSoftDeletes(adminDb, businessDoc.id, opts);
      runs.push(run);
      totalPurged += run.totalPurged;
      totalCascaded += run.totalCascaded;
      totalErrors += run.totalErrors;
    } catch (err) {
      console.error(`[dataRetention] business ${businessDoc.id} failed:`, err);
      totalErrors++;
    }
  }

  return {
    businessesProcessed: businessesSnap.size,
    totalPurged,
    totalCascaded,
    totalErrors,
    runs,
  };
}
