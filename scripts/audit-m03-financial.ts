/**
 * Auditoria read-only do Financeiro por tenant (M03.0).
 *
 * Antes:
 *   npm run audit:m03 -- --businessId=tenant_123 --output=m03-before.json
 * Depois:
 *   npm run audit:m03 -- --businessId=tenant_123 --baseline=m03-before.json --output=m03-after.json
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FieldPath, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  buildM03FinancialSnapshot,
  compareM03FinancialSnapshots,
  type M03FinancialAuditInput,
  type M03FinancialSnapshot,
  type M03AuditDocument,
} from '@/lib/services/m03-financial-audit';

type AuditedCollection = Exclude<keyof M03FinancialAuditInput, 'businessId' | 'capturedAt'>;

interface Options {
  businessId: string;
  pageSize: number;
  output?: string;
  baseline?: string;
}

const COLLECTIONS: Record<AuditedCollection, string> = {
  transactions: 'transactions',
  sales: 'sales',
  purchaseNotes: 'purchaseNotes',
  appointments: 'appointments',
  deliveryOrders: 'deliveryOrders',
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
): Promise<M03AuditDocument[]> {
  const documents: M03AuditDocument[] = [];
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
  const documents = Object.fromEntries(collectionEntries) as Record<AuditedCollection, M03AuditDocument[]>;
  const snapshot = buildM03FinancialSnapshot({ businessId: options.businessId, ...documents });

  if (options.output) {
    await writeFile(resolve(options.output), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  }

  if (!options.baseline) {
    console.log(JSON.stringify({ mode: 'snapshot', output: options.output, snapshot }, null, 2));
    if (snapshot.issues.length) process.exitCode = 2;
    return;
  }

  const baseline = JSON.parse(await readFile(resolve(options.baseline), 'utf8')) as M03FinancialSnapshot;
  const comparison = compareM03FinancialSnapshots(baseline, snapshot);
  console.log(JSON.stringify({ mode: 'comparison', output: options.output, comparison }, null, 2));
  if (!comparison.preserved || !comparison.healthy) process.exitCode = 2;
}

main().catch((cause) => {
  console.error('[audit-m03-financial] fatal:', cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
