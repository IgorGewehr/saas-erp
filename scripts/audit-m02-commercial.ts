/**
 * Auditoria read-only da M02 por tenant.
 *
 * Antes:
 *   npm run audit:m02 -- --businessId=tenant_123 --output=m02-before.json
 * Depois:
 *   npm run audit:m02 -- --businessId=tenant_123 --baseline=m02-before.json --output=m02-after.json
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FieldPath, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  buildM02CommercialSnapshot,
  compareM02CommercialSnapshots,
  type M02AuditDocument,
  type M02CommercialAuditInput,
  type M02CommercialSnapshot,
} from '@/lib/services/m02-commercial-audit';

type AuditedCollection = Exclude<keyof M02CommercialAuditInput, 'businessId' | 'capturedAt'>;

interface Options {
  businessId: string;
  pageSize: number;
  output?: string;
  baseline?: string;
}

const COLLECTIONS: Record<AuditedCollection, string> = {
  sales: 'sales',
  deliveryOrders: 'deliveryOrders',
  orders: 'orders',
  transactions: 'transactions',
  stockMovements: 'stockMovements',
  couponRedemptions: 'couponRedemptions',
  giftCardRedemptions: 'giftCardRedemptions',
  loyaltyTransactions: 'loyaltyTransactions',
  fiscalDocuments: 'fiscalDocuments',
};

function valueOf(args: string[], name: string): string | undefined {
  return args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
}

function parseOptions(): Options {
  const args = process.argv.slice(2);
  const businessId = valueOf(args, '--businessId')?.trim() ?? '';
  const pageSize = Number(valueOf(args, '--page-size') ?? 200);
  if (!businessId) throw new Error('--businessId=<id> é obrigatório; varredura global não é permitida.');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
    throw new Error('--page-size deve ser um inteiro entre 1 e 500.');
  }
  return {
    businessId,
    pageSize,
    output: valueOf(args, '--output')?.trim() || undefined,
    baseline: valueOf(args, '--baseline')?.trim() || undefined,
  };
}

async function readTenantCollection(
  collectionName: string,
  businessId: string,
  pageSize: number,
): Promise<M02AuditDocument[]> {
  const documents: M02AuditDocument[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  do {
    let query = adminDb.collection(collectionName)
      .where('businessId', '==', businessId)
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const document of page.docs) documents.push({ id: document.id, data: document.data() });
    cursor = page.docs.length === pageSize ? page.docs.at(-1) : undefined;
  } while (cursor);
  return documents;
}

async function main(): Promise<void> {
  const options = parseOptions();
  const collectionEntries = await Promise.all(
    (Object.entries(COLLECTIONS) as Array<[AuditedCollection, string]>).map(async ([key, name]) => [
      key,
      await readTenantCollection(name, options.businessId, options.pageSize),
    ] as const),
  );
  const documents = Object.fromEntries(collectionEntries) as Record<AuditedCollection, M02AuditDocument[]>;
  const snapshot = buildM02CommercialSnapshot({ businessId: options.businessId, ...documents });

  if (options.output) {
    await writeFile(resolve(options.output), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  }

  if (!options.baseline) {
    console.log(JSON.stringify({ mode: 'snapshot', output: options.output, snapshot }, null, 2));
    if (snapshot.issues.length) process.exitCode = 2;
    return;
  }

  const baseline = JSON.parse(await readFile(resolve(options.baseline), 'utf8')) as M02CommercialSnapshot;
  const comparison = compareM02CommercialSnapshots(baseline, snapshot);
  console.log(JSON.stringify({ mode: 'comparison', output: options.output, comparison }, null, 2));
  if (!comparison.preserved || !comparison.healthy) process.exitCode = 2;
}

main().catch((cause) => {
  console.error('[audit-m02-commercial] fatal:', cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
