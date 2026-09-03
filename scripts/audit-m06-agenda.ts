/**
 * Auditoria read-only da Agenda por tenant (M06.0).
 *
 * Antes:
 *   npm run audit:m06 -- --businessId=tenant_123 --output=m06-before.json
 * Depois:
 *   npm run audit:m06 -- --businessId=tenant_123 --baseline=m06-before.json --output=m06-after.json
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FieldPath, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  buildM06AgendaSnapshot,
  compareM06AgendaSnapshots,
  type M06AgendaAuditInput,
  type M06AgendaSnapshot,
  type M06AuditDocument,
} from '@/lib/services/m06-agenda-audit';

type AuditedCollection = Exclude<keyof M06AgendaAuditInput, 'businessId' | 'capturedAt'>;

interface Options {
  businessId: string;
  pageSize: number;
  output?: string;
  baseline?: string;
}

const COLLECTIONS: Record<AuditedCollection, string> = {
  appointments: 'appointments',
  services: 'services',
  users: 'users',
  transactions: 'transactions',
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
): Promise<M06AuditDocument[]> {
  const documents: M06AuditDocument[] = [];
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
  const documents = Object.fromEntries(collectionEntries) as Record<AuditedCollection, M06AuditDocument[]>;
  const snapshot = buildM06AgendaSnapshot({ businessId: options.businessId, ...documents });

  if (options.output) {
    await writeFile(resolve(options.output), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  }

  if (!options.baseline) {
    console.log(JSON.stringify({ mode: 'snapshot', output: options.output, snapshot }, null, 2));
    if (snapshot.issues.length) process.exitCode = 2;
    return;
  }

  const baseline = JSON.parse(await readFile(resolve(options.baseline), 'utf8')) as M06AgendaSnapshot;
  const comparison = compareM06AgendaSnapshots(baseline, snapshot);
  console.log(JSON.stringify({ mode: 'comparison', output: options.output, comparison }, null, 2));
  if (!comparison.preserved || !comparison.healthy) process.exitCode = 2;
}

main().catch((cause) => {
  console.error('[audit-m06-agenda] fatal:', cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
