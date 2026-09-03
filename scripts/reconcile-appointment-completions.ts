/**
 * Reconciliação manual do bug "conclusão sem efeito" (M06.2) por tenant.
 *
 * Encontra appointments com `status === 'concluido'` e `completionAppliedAt`
 * ausente — atendimentos que ficaram concluídos sem comissão/fidelidade/
 * baixa de insumo/métricas aplicados (browser morreu entre o updateDoc de
 * status e o dispatch do evento, no caminho antigo pré-M06.2) — e redispara
 * `appointment.completed` pra cada um. Idempotente pelo próprio CAS do
 * handler (`completionAppliedAt`): rodar em cima de um já corrigido é no-op.
 *
 * Lê SÓ appointments por businessId (paginado), sem filtro de status na
 * query — evita depender de um índice composto novo pra um script manual de
 * baixa frequência; o filtro de status/completionAppliedAt é em memória.
 *
 * Sem --apply: lista os candidatos sem escrever nada (default seguro).
 * Com --apply: redispara appointment.completed pra cada candidato.
 *
 *   npm run reconcile:m06 -- --businessId=tenant_123
 *   npm run reconcile:m06 -- --businessId=tenant_123 --apply
 */

import { FieldPath, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { dispatchDomainEvent } from '@/lib/contracts/_runtime/dispatch';
import { ensureDomainEventHandlers } from '@/lib/contracts/_runtime/handlers';
import type { Appointment } from '@/lib/types';

interface Options {
  businessId: string;
  pageSize: number;
  apply: boolean;
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
  return { businessId, pageSize, apply: args.includes('--apply') };
}

async function findCandidates(businessId: string, pageSize: number): Promise<Appointment[]> {
  const candidates: Appointment[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  do {
    let query = adminDb.collection('appointments')
      .where('businessId', '==', businessId)
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs) {
      const data = { id: doc.id, ...doc.data() } as Appointment;
      if (data.status === 'concluido' && !data.completionAppliedAt) candidates.push(data);
    }
    cursor = page.docs.length === pageSize ? page.docs.at(-1) : undefined;
  } while (cursor);
  return candidates;
}

async function main(): Promise<void> {
  const options = parseOptions();
  const candidates = await findCandidates(options.businessId, options.pageSize);

  console.log(JSON.stringify({
    businessId: options.businessId,
    mode: options.apply ? 'apply' : 'dry-run',
    candidatesFound: candidates.length,
    candidates: candidates.map((a) => ({ id: a.id, date: a.date, startTime: a.startTime, clientName: a.clientName })),
  }, null, 2));

  if (!options.apply || candidates.length === 0) {
    if (!options.apply && candidates.length > 0) {
      console.log(`\n${candidates.length} candidato(s) encontrado(s). Rode novamente com --apply pra corrigir.`);
    }
    return;
  }

  ensureDomainEventHandlers();
  const now = new Date().toISOString();
  let applied = 0;
  for (const appointment of candidates) {
    try {
      await dispatchDomainEvent(adminDb, {
        type: 'appointment.completed',
        businessId: options.businessId,
        occurredAt: now,
        actorType: 'system',
        actorId: 'reconcile-appointment-completions',
        appointmentId: appointment.id,
        clientId: appointment.clientId,
        professionalId: appointment.professionalId,
        serviceId: appointment.serviceId,
        amount: appointment.price || 0,
      });
      applied += 1;
    } catch (cause) {
      console.error(`[reconcile-m06] falhou pra appointment ${appointment.id}:`, cause instanceof Error ? cause.message : cause);
    }
  }
  console.log(`\n${applied}/${candidates.length} corrigido(s).`);
  if (applied < candidates.length) process.exitCode = 2;
}

main().catch((cause) => {
  console.error('[reconcile-appointment-completions] fatal:', cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
