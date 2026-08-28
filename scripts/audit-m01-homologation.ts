/**
 * Auditoria read-only da M01 para homologação.
 *
 * 1) Antes do deploy/migração:
 *    npm run audit:m01 -- --businessId=tenant_123 --output=m01-before.json
 * 2) Depois:
 *    npm run audit:m01 -- --businessId=tenant_123 --baseline=m01-before.json --output=m01-after.json
 *
 * O banco nunca é alterado. Com baseline, o processo retorna código 2 quando
 * encontra divergência de saldo/custo ou problema de integridade em lotes.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FieldPath, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  buildM01HomologationSnapshot,
  compareM01HomologationSnapshots,
  type M01AuditDocument,
  type M01HomologationSnapshot,
} from '@/lib/services/m01-homologation-audit';

interface Options {
  businessId: string;
  pageSize: number;
  output?: string;
  baseline?: string;
}

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
  collectionName: 'products' | 'stockLots',
  businessId: string,
  pageSize: number,
): Promise<M01AuditDocument[]> {
  const documents: M01AuditDocument[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  do {
    let query = adminDb.collection(collectionName)
      .where('businessId', '==', businessId)
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const document of page.docs) {
      documents.push({ id: document.id, data: document.data() });
    }
    cursor = page.docs.length === pageSize ? page.docs.at(-1) : undefined;
  } while (cursor);
  return documents;
}

async function main(): Promise<void> {
  const options = parseOptions();
  const [products, stockLots] = await Promise.all([
    readTenantCollection('products', options.businessId, options.pageSize),
    readTenantCollection('stockLots', options.businessId, options.pageSize),
  ]);
  const snapshot = buildM01HomologationSnapshot({
    businessId: options.businessId,
    products,
    stockLots,
  });

  if (options.output) {
    await writeFile(resolve(options.output), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  }

  if (!options.baseline) {
    console.log(JSON.stringify({ mode: 'snapshot', output: options.output, snapshot }, null, 2));
    if (snapshot.issues.length) process.exitCode = 2;
    return;
  }

  const rawBaseline = await readFile(resolve(options.baseline), 'utf8');
  const baseline = JSON.parse(rawBaseline) as M01HomologationSnapshot;
  const comparison = compareM01HomologationSnapshots(baseline, snapshot);
  console.log(JSON.stringify({ mode: 'comparison', output: options.output, comparison }, null, 2));
  if (!comparison.preserved) process.exitCode = 2;
}

main().catch((cause) => {
  console.error('[audit-m01-homologation] fatal:', cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
