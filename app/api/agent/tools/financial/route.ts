/**
 * Agent tool: Financial (transactions, AR/AP, payments).
 *
 * Actions:
 *   - list                  list transactions (type/status/date filters)
 *   - get                   fetch single transaction
 *   - create_receivable     create a 'receita' (income to receive)
 *   - create_payable        create a 'despesa' (bill to pay)
 *   - mark_paid             mark pending transaction as paid, set paymentDate
 *   - cancel                soft-cancel a transaction (status='cancelado')
 *   - summary_today         financial snapshot for today (in/out/balance pending)
 *   - summary_month         month-to-date summary with status breakdown
 */

import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import { assertTransitionTransaction } from '@/lib/contracts/fsm/transaction';
import { parseToolRequest, validateToolResponse, isContractError } from '@/contracts/_runtime/agentToolValidation';
import type { Transaction, TransactionStatus, TransactionType, PaymentMethod } from '@/lib/types';

type Action =
  | 'list'
  | 'get'
  | 'create_receivable'
  | 'create_payable'
  | 'mark_paid'
  | 'cancel'
  | 'summary_today'
  | 'summary_month';

interface ListParams {
  type?: TransactionType;
  status?: TransactionStatus;
  fromDate?: string;        // YYYY-MM-DD
  toDate?: string;          // YYYY-MM-DD
  category?: string;
  limit?: number;
  orderBy?: 'dueDate' | 'createdAt';
}

interface CreateParams {
  description: string;
  amount: number;
  dueDate?: string;
  category?: string;
  clientId?: string;
  clientName?: string;
  paymentMethod?: PaymentMethod;
  notes?: string;
  installments?: number;    // creates multiple transactions with installmentGroupId
}

interface MarkPaidParams {
  id: string;
  paymentDate?: string;
  paymentMethod?: PaymentMethod;
}

const ALLOWED_METHODS: PaymentMethod[] = ['dinheiro', 'pix', 'credito', 'debito', 'boleto', 'pontos', 'gift_card', 'outros'];

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await verifyAgentRequest(req);
  } catch (err) {
    const resp = agentAuthErrorResponse(err);
    if (resp) return resp;
    throw err;
  }

  const rawBody = parseAgentBody<{ action: Action; params: Record<string, unknown> }>(ctx.rawBody);
  const { businessId } = ctx;

  // R6/SDD: valida request com Zod no boundary (espelha a route de agenda).
  // Shape inválido -> ContractError -> 400 com error envelope estruturado.
  let action: Action;
  let params: Record<string, unknown>;
  try {
    const parsed = parseToolRequest('financial', rawBody);
    action = parsed.action as Action;
    params = parsed.params as Record<string, unknown>;
  } catch (err) {
    if (isContractError(err)) {
      return NextResponse.json(err.toEnvelope(), { status: 400 });
    }
    throw err;
  }

  try {
    let data: unknown;
    switch (action) {
      case 'list':
        data = await listTransactions(businessId, params as unknown as ListParams);
        break;
      case 'get':
        data = await getTransaction(businessId, params.id as string);
        break;
      case 'create_receivable':
        data = await createTx(businessId, 'receita', params as unknown as CreateParams);
        break;
      case 'create_payable':
        data = await createTx(businessId, 'despesa', params as unknown as CreateParams);
        break;
      case 'mark_paid':
        data = await markPaid(businessId, params as unknown as MarkPaidParams);
        break;
      case 'cancel':
        data = await cancelTx(businessId, params.id as string, params.reason as string | undefined);
        break;
      case 'summary_today':
        data = await summaryToday(businessId);
        break;
      case 'summary_month':
        data = await summaryMonth(businessId, params.month as string | undefined);
        break;
      default: {
        const exhaustiveCheck: never = action;
        return NextResponse.json({ ok: false, error: `Unknown action: ${exhaustiveCheck}` }, { status: 400 });
      }
    }

    // SDD: valida shape do response em dev (lança); em prod loga e segue.
    const validated = validateToolResponse('financial', action, data);
    return NextResponse.json({ ok: true, data: validated });
  } catch (err) {
    if (isContractError(err)) {
      return NextResponse.json(err.toEnvelope(), { status: err.code === 'INTERNAL' ? 500 : 400 });
    }
    console.error('[agent.financial] error', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function listTransactions(businessId: string, p: ListParams): Promise<Transaction[]> {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
  let q: FirebaseFirestore.Query = adminDb.collection('transactions').where('businessId', '==', businessId);
  if (p.type) q = q.where('type', '==', p.type);
  if (p.status) q = q.where('status', '==', p.status);
  if (p.category) q = q.where('category', '==', p.category);
  if (p.fromDate) q = q.where('dueDate', '>=', p.fromDate);
  if (p.toDate) q = q.where('dueDate', '<=', p.toDate);

  const orderField = p.orderBy === 'createdAt' ? 'createdAt' : 'dueDate';
  const snap = await q.orderBy(orderField, 'desc').limit(limit).get();
  return snap.docs.map((d) => ({ ...(d.data() as Transaction), id: d.id }));
}

async function getTransaction(businessId: string, id: string): Promise<Transaction | null> {
  if (!id) throw new Error('Missing id');
  const doc = await adminDb.collection('transactions').doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() as Transaction;
  if (data.businessId !== businessId) throw new Error('Cross-tenant access denied');
  return { ...data, id: doc.id };
}

async function createTx(businessId: string, type: TransactionType, p: CreateParams): Promise<Transaction | Transaction[]> {
  if (!p.description || typeof p.description !== 'string') throw new Error('description required');
  if (typeof p.amount !== 'number' || p.amount <= 0) throw new Error('amount must be > 0');

  const now = new Date().toISOString();
  const installments = Math.max(1, Math.min(p.installments ?? 1, 48));

  if (installments === 1) {
    const ref = adminDb.collection('transactions').doc();
    const tx: Transaction = {
      id: ref.id,
      businessId,
      type,
      description: p.description.slice(0, 500),
      amount: Math.round(p.amount * 100) / 100,
      dueDate: p.dueDate,
      status: 'pendente',
      category: p.category,
      clientId: p.clientId,
      clientName: p.clientName,
      paymentMethod: p.paymentMethod && ALLOWED_METHODS.includes(p.paymentMethod) ? p.paymentMethod : undefined,
      notes: p.notes?.slice(0, 500),
      createdAt: now,
      updatedAt: now,
      createdBy: 'agent',
      createdByName: 'Agente IA',
    };
    await ref.set(tx);
    return tx;
  }

  // Installments — split amount evenly, shift dueDate by month each
  const groupId = adminDb.collection('transactions').doc().id;
  const perInstallment = Math.round((p.amount / installments) * 100) / 100;
  const baseDate = p.dueDate ? new Date(p.dueDate) : new Date();
  const batch = adminDb.batch();
  const created: Transaction[] = [];

  for (let i = 0; i < installments; i++) {
    const ref = adminDb.collection('transactions').doc();
    const dueDate = new Date(baseDate);
    dueDate.setMonth(dueDate.getMonth() + i);
    const tx: Transaction = {
      id: ref.id,
      businessId,
      type,
      description: `${p.description} (${i + 1}/${installments})`.slice(0, 500),
      amount: perInstallment,
      dueDate: dueDate.toISOString().slice(0, 10),
      status: 'pendente',
      category: p.category,
      clientId: p.clientId,
      clientName: p.clientName,
      paymentMethod: p.paymentMethod && ALLOWED_METHODS.includes(p.paymentMethod) ? p.paymentMethod : undefined,
      notes: p.notes?.slice(0, 500),
      installmentGroupId: groupId,
      installmentNumber: i + 1,
      installmentTotal: installments,
      createdAt: now,
      updatedAt: now,
      createdBy: 'agent',
      createdByName: 'Agente IA',
    };
    batch.set(ref, tx);
    created.push(tx);
  }

  await batch.commit();
  return created;
}

async function markPaid(businessId: string, p: MarkPaidParams): Promise<Transaction> {
  if (!p.id) throw new Error('id required');
  const ref = adminDb.collection('transactions').doc(p.id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Transaction not found');
  const tx = snap.data() as Transaction;
  if (tx.businessId !== businessId) throw new Error('Cross-tenant access denied');
  // R4/P1.9: valida a transição de status pela FSM (cobre os antigos guards
  // "já paga" / "cancelada não pode pagar" + bloqueia origens inválidas).
  assertTransitionTransaction(tx.status, 'pago');

  const now = new Date().toISOString();
  const paymentDate = p.paymentDate || now.slice(0, 10);
  const patch: Partial<Transaction> = {
    status: 'pago',
    paymentDate,
    updatedAt: now,
    updatedBy: 'agent',
    updatedByName: 'Agente IA',
  };
  if (p.paymentMethod && ALLOWED_METHODS.includes(p.paymentMethod)) {
    patch.paymentMethod = p.paymentMethod;
  }
  await ref.update(patch);
  return { ...tx, ...patch, id: snap.id };
}

async function cancelTx(businessId: string, id: string, reason?: string): Promise<Transaction> {
  if (!id) throw new Error('id required');
  const ref = adminDb.collection('transactions').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Transaction not found');
  const tx = snap.data() as Transaction;
  if (tx.businessId !== businessId) throw new Error('Cross-tenant access denied');
  // R4/P1.9: FSM cobre o antigo guard "já cancelada" (cancelado é terminal).
  assertTransitionTransaction(tx.status, 'cancelado');

  const now = new Date().toISOString();
  const notes = reason
    ? `${tx.notes ? `${tx.notes}\n---\n` : ''}[Cancelado ${now.slice(0, 10)}] ${reason.slice(0, 200)}`
    : tx.notes;

  const patch: Partial<Transaction> = {
    status: 'cancelado',
    notes,
    updatedAt: now,
    updatedBy: 'agent',
    updatedByName: 'Agente IA',
  };
  await ref.update(patch);
  return { ...tx, ...patch, id: snap.id };
}

async function summaryToday(businessId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const pending = await adminDb
    .collection('transactions')
    .where('businessId', '==', businessId)
    .where('status', '==', 'pendente')
    .where('dueDate', '<=', today)
    .get();

  const paid = await adminDb
    .collection('transactions')
    .where('businessId', '==', businessId)
    .where('status', '==', 'pago')
    .where('paymentDate', '==', today)
    .get();

  let pendingIn = 0, pendingOut = 0, paidIn = 0, paidOut = 0;
  let overdue = 0;

  for (const d of pending.docs) {
    const t = d.data() as Transaction;
    if (t.type === 'receita') pendingIn += t.amount;
    else pendingOut += t.amount;
    if (t.dueDate && t.dueDate < today) overdue += 1;
  }
  for (const d of paid.docs) {
    const t = d.data() as Transaction;
    if (t.type === 'receita') paidIn += t.amount;
    else paidOut += t.amount;
  }

  return {
    date: today,
    pendingIn: round(pendingIn),
    pendingOut: round(pendingOut),
    paidInToday: round(paidIn),
    paidOutToday: round(paidOut),
    netPendingBalance: round(pendingIn - pendingOut),
    netPaidToday: round(paidIn - paidOut),
    overdueCount: overdue,
    pendingCount: pending.size,
  };
}

async function summaryMonth(businessId: string, monthYYYY_MM?: string) {
  const month = monthYYYY_MM || new Date().toISOString().slice(0, 7);
  const start = `${month}-01`;
  const end = `${month}-31`;

  const snap = await adminDb
    .collection('transactions')
    .where('businessId', '==', businessId)
    .where('dueDate', '>=', start)
    .where('dueDate', '<=', end)
    .get();

  const counts: Record<TransactionStatus, number> = { pendente: 0, pago: 0, atrasado: 0, cancelado: 0 };
  let receita = 0, despesa = 0;
  const byCategory: Record<string, { amount: number; count: number }> = {};

  const today = new Date().toISOString().slice(0, 10);
  for (const d of snap.docs) {
    const t = d.data() as Transaction;
    const status: TransactionStatus = t.status === 'pendente' && t.dueDate && t.dueDate < today ? 'atrasado' : t.status;
    counts[status] = (counts[status] || 0) + 1;
    if (t.type === 'receita') receita += t.amount;
    else despesa += t.amount;
    const cat = t.category || '(sem categoria)';
    byCategory[cat] ||= { amount: 0, count: 0 };
    byCategory[cat].amount += t.amount;
    byCategory[cat].count += 1;
  }

  return {
    month,
    totalReceita: round(receita),
    totalDespesa: round(despesa),
    netBalance: round(receita - despesa),
    counts,
    byCategory: Object.entries(byCategory)
      .map(([category, v]) => ({ category, amount: round(v.amount), count: v.count }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 20),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
