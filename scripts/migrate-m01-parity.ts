/**
 * Migração assistida M01 (catálogo, fornecedores, compras e estoque).
 *
 * O comando é dry-run por padrão e exige um único businessId. Escritas só são
 * liberadas com duas flags explícitas; cada alteração recebe backup reversível.
 *
 * Exemplos:
 *   npm run migrate:m01 -- --businessId=tenant_123
 *   npm run migrate:m01 -- --businessId=tenant_123 --apply --confirm=M01_PARITY_V2
 *   npm run migrate:m01 -- --businessId=tenant_123 --apply --confirm=M01_PARITY_V2 --run-id=<id> --resume
 *   npm run migrate:m01 -- --businessId=tenant_123 --rollback --run-id=<id> --confirm=ROLLBACK_M01_PARITY_V2
 */

import { randomUUID } from 'node:crypto';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  rollbackM01Migration,
  runM01Migration,
} from '@/lib/services/m01-migration-admin';

interface Options {
  businessId: string;
  runId: string;
  pageSize: number;
  apply: boolean;
  rollback: boolean;
  resume: boolean;
  confirm?: string;
}

function valueOf(args: string[], name: string): string | undefined {
  return args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
}

function parseOptions(): Options {
  const args = process.argv.slice(2);
  const businessId = valueOf(args, '--businessId')?.trim() ?? '';
  const runId = valueOf(args, '--run-id')?.trim() || `m01_${randomUUID()}`;
  const pageSize = Number(valueOf(args, '--page-size') ?? 100);
  const apply = args.includes('--apply');
  const rollback = args.includes('--rollback');
  if (!businessId) throw new Error('--businessId=<id> é obrigatório; varredura global não é permitida.');
  if (apply && rollback) throw new Error('Escolha --apply ou --rollback, nunca ambos.');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
    throw new Error('--page-size deve ser um inteiro entre 1 e 200.');
  }
  return {
    businessId,
    runId,
    pageSize,
    apply,
    rollback,
    resume: args.includes('--resume'),
    confirm: valueOf(args, '--confirm'),
  };
}

async function main() {
  const options = parseOptions();
  if (options.rollback) {
    if (options.confirm !== 'ROLLBACK_M01_PARITY_V2') {
      throw new Error('Rollback bloqueado: use --confirm=ROLLBACK_M01_PARITY_V2.');
    }
    const result = await rollbackM01Migration({
      db: adminDb,
      businessId: options.businessId,
      runId: options.runId,
      pageSize: options.pageSize,
    });
    console.log(JSON.stringify({ mode: 'rollback', ...options, confirm: undefined, result }, null, 2));
    return;
  }

  if (options.apply && options.confirm !== 'M01_PARITY_V2') {
    throw new Error('Escrita bloqueada: execute primeiro o dry-run e use --confirm=M01_PARITY_V2.');
  }
  const result = await runM01Migration({
    db: adminDb,
    businessId: options.businessId,
    runId: options.runId,
    pageSize: options.pageSize,
    dryRun: !options.apply,
    resume: options.resume,
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((cause) => {
    console.error('[migrate-m01-parity] fatal:', cause instanceof Error ? cause.message : cause);
    process.exit(1);
  });
