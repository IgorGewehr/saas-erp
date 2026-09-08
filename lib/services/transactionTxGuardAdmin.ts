/**
 * lib/services/transactionTxGuardAdmin.ts
 *
 * Núcleo de criação/transição de Transaction (M03.2) — o que NUNCA existiu
 * pra nenhum dos caminhos manuais (clássico, V2, API v1, agente). Os 5
 * caminhos já hardenizados (venda PDV, contas a pagar de compra, delivery,
 * estorno, liquidação Mercado Pago — ver docs/paridade/M03_PLANO_IMPLEMENTACAO.md
 * §0) são efeitos colaterais de OUTROS módulos, com sua própria lógica
 * específica; este arquivo é o guard GENÉRICO que qualquer caller (rota
 * server-side, tool do agente) pode reaproveitar sem reimplementar
 * idempotência/FSM do zero.
 *
 * Duas garantias, nenhuma delas existia antes desta fatia:
 *
 *  1. IDEMPOTÊNCIA REAL na criação — mesmo padrão de
 *     `lib/services/purchase-financial-admin.ts` (o caminho já mais robusto
 *     do módulo): ID DETERMINÍSTICO (hash da chave de idempotência) +
 *     `tx.create()`, que o Firestore REJEITA atomicamente se o doc já
 *     existe. Sem lock separado, sem claim-doc — o próprio `create()` é o
 *     CAS. Fecha o achado `DUPLICATE_SOURCE_TRANSACTION` da auditoria M03.0
 *     (double-click já auto-documentado em `docs/agenda/AGENDA_COBRANCA.md`).
 *     A chave é derivada de `saleId`/`purchaseNoteId`/`appointmentId`/
 *     `deliveryOrderId` + `type` (+ `installmentNumber` quando presente, pra
 *     não colapsar parcelas distintas da MESMA origem na mesma chave) —
 *     MESMA combinação que `m03-financial-audit.ts` usa pra detectar
 *     duplicidade, então o guard previne exatamente o que a auditoria mede.
 *     Sem nenhuma dessas referências (lançamento manual puro), cai pra um
 *     `idempotencyKey` explícito do caller (R3) ou, na ausência de ambos,
 *     cria sem dedup possível (mesmo comportamento de hoje pra esse caso —
 *     não há identidade estável pra checar contra).
 *
 *  2. FSM APLICADO na transição — `assertTransitionTransaction` (já existia
 *     em `lib/contracts/fsm/transaction.ts`, nunca invocado por nenhum dos
 *     13 caminhos de escrita) agora é chamado ANTES de qualquer mudança de
 *     status. Fecha o achado "FSM declarado mas não aplicado" da
 *     investigação de abertura do M03.
 *
 * Client SDK guard (mirror de `appointmentTxGuard.ts`) DELIBERADAMENTE não
 * construído nesta fatia — diferente da Agenda (calendário em tempo real,
 * UI otimista com onSnapshot), não há hoje um caso de uso comprovado de
 * escrita direta browser→Firestore com pré-check local pra Transaction; os
 * caminhos já hardenizados do Financeiro (Sales/Purchases/Delivery) são
 * todos Admin SDK via rota server-side. Se a migração do clássico/V2 (M03.3)
 * revelar necessidade real de um guard client-side, ele é construído então,
 * informado pela experiência real da migração — não especulativamente aqui.
 */

import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { canTransitionTransaction } from '@/contracts/fsm/transaction';
import type { Transaction, TransactionStatus, TransactionType } from '@/lib/types';

export class TransactionNotFoundError extends Error {
  constructor(message = 'Transação não encontrada.') {
    super(message);
    this.name = 'TransactionNotFoundError';
  }
}

export class TransactionTenantMismatchError extends Error {
  constructor(message = 'Transação pertence a outro negócio.') {
    super(message);
    this.name = 'TransactionTenantMismatchError';
  }
}

/** Erro tipado pra que o caller (rota) diferencie violação de FSM de falha
 *  genérica — ex.: responder 409 em vez de 500. */
export class TransactionInvalidTransitionError extends Error {
  constructor(
    public readonly from: TransactionStatus,
    public readonly to: TransactionStatus,
  ) {
    super(`Transaction FSM: transição inválida ${from} → ${to}`);
    this.name = 'TransactionInvalidTransitionError';
  }
}

/** Payload de criação — mesmo espírito de `AdminAppointmentPayload`: shape
 *  mínimo que o guard precisa pra raciocinar (idempotência/tenant), resto
 *  passa direto. Validação de shape completo (Zod) é responsabilidade do
 *  BOUNDARY que chama este guard (R6) — o guard confia no tipo, não duplica. */
export interface AdminTransactionPayload {
  businessId: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: number;
  description: string;
  saleId?: string;
  purchaseNoteId?: string;
  appointmentId?: string;
  deliveryOrderId?: string;
  orderId?: string;
  installmentNumber?: number;
  /** Chave explícita (R3, ex.: X-Idempotency-Key do caller) — tem prioridade
   *  sobre a chave derivada de saleId/appointmentId/etc quando presente. */
  idempotencyKey?: string;
  [key: string]: unknown;
}

export interface CreateTransactionResult {
  id: string;
  /** false = replay idempotente, o doc já existia e nada foi escrito de novo. */
  created: boolean;
}

/** `${field}:${id}:${type}[:${installmentNumber}]` — MESMA combinação que
 *  `m03-financial-audit.ts` usa como chave de duplicidade (`sourceCombos`),
 *  de propósito: o que o guard previne é exatamente o que a auditoria mede.
 *  `installmentNumber` entra quando presente pra não colapsar parcelas
 *  distintas da mesma origem (mesmo saleId+type) numa única chave. */
function deriveSourceIdempotencyKey(payload: AdminTransactionPayload): string | undefined {
  const source = payload.saleId ? (['sale', payload.saleId] as const)
    : payload.purchaseNoteId ? (['purchaseNote', payload.purchaseNoteId] as const)
      : payload.appointmentId ? (['appointment', payload.appointmentId] as const)
        : payload.deliveryOrderId ? (['deliveryOrder', payload.deliveryOrderId] as const)
          : payload.orderId ? (['order', payload.orderId] as const)
            : undefined;
  if (!source) return undefined;
  const [field, id] = source;
  const installmentSuffix = payload.installmentNumber !== undefined ? `:${payload.installmentNumber}` : '';
  return `${field}:${id}:${payload.type}${installmentSuffix}`;
}

function deterministicTransactionId(businessId: string, idempotencyKey: string): string {
  const digest = createHash('sha256').update(`${businessId}:${idempotencyKey}`).digest('hex');
  return `tx_${digest.slice(0, 40)}`;
}

/**
 * Cria uma Transaction com idempotência real. Chamado por qualquer caller
 * que precise de criação manual/server-side (rotas API v1, agente, e
 * futuramente o `POST /api/transactions` que substituirá os `addDoc`
 * diretos do clássico/V2 em M03.3).
 */
export async function createTransactionSafeAdmin(
  adminDb: Firestore,
  payload: AdminTransactionPayload,
): Promise<CreateTransactionResult> {
  if (!payload.businessId) throw new Error('createTransactionSafeAdmin: businessId obrigatório (R1)');

  const idempotencyKey = payload.idempotencyKey ?? deriveSourceIdempotencyKey(payload);
  const now = new Date().toISOString();

  // Sem NENHUMA chave possível (lançamento manual puro, sem origem e sem
  // X-Idempotency-Key do caller): não há identidade estável pra checar
  // duplicidade contra — cria direto, mesmo comportamento de hoje pra esse
  // caso específico (não é uma regressão; não existia dedup nenhum antes).
  if (!idempotencyKey) {
    const ref = adminDb.collection('transactions').doc();
    await ref.set({ ...payload, createdAt: now, updatedAt: now });
    return { id: ref.id, created: true };
  }

  const id = deterministicTransactionId(payload.businessId, idempotencyKey);
  const ref = adminDb.collection('transactions').doc(id);

  return adminDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (snapshot.exists) {
      // Replay idempotente — mesmo doc, mesma origem (ID é hash de
      // businessId+chave, então uma colisão cross-tenant é criptograficamente
      // inviável; não há necessidade de checar tenant aqui de novo).
      return { id: ref.id, created: false };
    }
    tx.create(ref, { ...payload, idempotencyKey, createdAt: now, updatedAt: now });
    return { id: ref.id, created: true };
  });
}

/**
 * Transição de status com FSM aplicado — fecha o achado "FSM declarado mas
 * nunca invocado" (nenhum dos 13 caminhos de escrita chama
 * `assertTransitionTransaction` hoje). Re-lê o doc fresco dentro da tx
 * (mesmo padrão de `transitionAppointmentAdmin`) — nunca confia em status
 * que o caller acha que é o atual.
 */
export async function transitionTransactionSafeAdmin(params: {
  db: Firestore;
  transactionId: string;
  businessId: string;
  /** Ausente = não muda status, só aplica `patch` (ex.: editar `description`/
   *  `category` sem mexer no FSM) — ainda dentro da MESMA garantia atômica
   *  de existência/tenant que a transição de status já oferece. Evita o
   *  caller precisar de um pré-fetch só pra saber o status atual quando não
   *  vai mudá-lo. */
  targetStatus?: TransactionStatus;
  /** Campos adicionais a gravar junto (ex.: paymentDate ao marcar 'pago'). */
  patch?: Record<string, unknown>;
}): Promise<Transaction> {
  const ref = params.db.collection('transactions').doc(params.transactionId);

  return params.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new TransactionNotFoundError();
    const current = { id: snapshot.id, ...snapshot.data() } as Transaction;
    if (current.businessId !== params.businessId) throw new TransactionTenantMismatchError();

    const fromStatus = current.status;
    const toStatus = params.targetStatus ?? fromStatus;
    if (fromStatus !== toStatus && !canTransitionTransaction(fromStatus, toStatus)) {
      throw new TransactionInvalidTransitionError(fromStatus, toStatus);
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { ...params.patch, status: toStatus, updatedAt: now };
    tx.update(ref, patch);
    return { ...current, ...patch } as Transaction;
  });
}
