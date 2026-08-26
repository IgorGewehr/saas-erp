import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { LinkPurchaseFinancialRequest } from '@/lib/contracts/api/purchase-note-financial';
import { PurchaseNoteV2Schema } from '@/lib/contracts/domain/purchaseNoteV2';
import {
  preparedDocument,
  type PreparedPurchaseNote,
} from '@/lib/services/purchase-import-admin';
import type { SupplierActor } from '@/lib/services/supplier-admin';
import type { BankAccount, Transaction } from '@/lib/types';

export class PurchaseFinancialNotReadyError extends Error {
  constructor(message = 'A compra precisa estar importada antes do vínculo financeiro.') {
    super(message);
    this.name = 'PurchaseFinancialNotReadyError';
  }
}

export class PurchaseFinancialConflictError extends Error {
  constructor(message = 'Esta compra já possui um vínculo financeiro incompatível com a solicitação.') {
    super(message);
    this.name = 'PurchaseFinancialConflictError';
  }
}

export class PurchaseFinancialReferenceError extends Error {
  constructor(message = 'A conta financeira informada não está disponível para esta empresa.') {
    super(message);
    this.name = 'PurchaseFinancialReferenceError';
  }
}

export interface PurchaseFinancialResult {
  note: PreparedPurchaseNote;
  transaction: Transaction;
  replayed: boolean;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function deterministicTransactionId(businessId: string, noteId: string): string {
  const digest = createHash('sha256').update(`${businessId}:${noteId}:purchase-financial`).digest('hex');
  return `purchase_tx_${digest.slice(0, 40)}`;
}

function financialStatus(transaction: Transaction): 'payable_created' | 'paid' {
  return transaction.status === 'pago' ? 'paid' : 'payable_created';
}

function assertExistingTransaction(params: {
  transaction: Transaction;
  businessId: string;
  noteId: string;
  amount: number;
}): void {
  const transaction = params.transaction;
  if (
    transaction.businessId !== params.businessId || transaction.type !== 'despesa' ||
    transaction.purchaseNoteId !== params.noteId || transaction.sourceType !== 'purchase' ||
    Math.abs(transaction.amount - params.amount) > 0.001 || transaction.status === 'cancelado'
  ) {
    throw new PurchaseFinancialConflictError('O identificador financeiro da compra já está ocupado por um lançamento incompatível.');
  }
}

export async function linkPurchaseFinancialAdmin(params: {
  db: Firestore;
  businessId: string;
  noteId: string;
  intent: LinkPurchaseFinancialRequest;
  actor: SupplierActor;
}): Promise<PurchaseFinancialResult> {
  const noteRef = params.db.collection('purchaseNotes').doc(params.noteId);

  return params.db.runTransaction(async (tx) => {
    const noteSnapshot = await tx.get(noteRef);
    if (!noteSnapshot.exists || noteSnapshot.data()?.businessId !== params.businessId) {
      throw new PurchaseFinancialNotReadyError('Nota não encontrada.');
    }
    const note = PurchaseNoteV2Schema.parse({ ...noteSnapshot.data(), id: noteSnapshot.id });
    if (!['importada', 'parcial'].includes(note.status)) throw new PurchaseFinancialNotReadyError();
    if (note.reversalClaim) {
      throw new PurchaseFinancialNotReadyError('A compra possui uma reversão em andamento e não pode receber vínculo financeiro.');
    }
    if (note.financial?.status === 'reversed') {
      throw new PurchaseFinancialNotReadyError('Uma compra revertida não pode receber novo vínculo financeiro.');
    }

    const amount = roundMoney(note.totals.invoice);
    if (!(amount > 0)) throw new PurchaseFinancialNotReadyError('A NF-e não possui valor financeiro positivo.');
    const transactionId = note.financial?.transactionId ?? deterministicTransactionId(params.businessId, params.noteId);
    const transactionRef = params.db.collection('transactions').doc(transactionId);
    const transactionSnapshot = await tx.get(transactionRef);
    const bankAccountRef = params.intent.mode === 'paid'
      ? params.db.collection('bankAccounts').doc(params.intent.bankAccountId)
      : undefined;
    const bankAccountSnapshot = bankAccountRef ? await tx.get(bankAccountRef) : undefined;

    if (transactionSnapshot.exists) {
      const transaction = { ...transactionSnapshot.data(), id: transactionSnapshot.id } as Transaction;
      assertExistingTransaction({ transaction, businessId: params.businessId, noteId: params.noteId, amount });
      const status = financialStatus(transaction);
      if (params.intent.mode === 'paid' && status !== 'paid') {
        throw new PurchaseFinancialConflictError('A conta a pagar já existe. Faça a baixa pelo módulo Financeiro.');
      }
      if (params.intent.mode === 'paid' && transaction.bankAccountId !== params.intent.bankAccountId) {
        throw new PurchaseFinancialConflictError('A compra já foi paga por outra conta.');
      }
      const now = new Date().toISOString();
      const canonical = PurchaseNoteV2Schema.parse({
        ...note,
        financial: {
          transactionId: transaction.id,
          ...(transaction.bankAccountId ? { bankAccountId: transaction.bankAccountId } : {}),
          status,
        },
        updatedAt: now,
      });
      const document = preparedDocument(noteSnapshot.data() ?? {}, canonical, { updatedAt: now });
      tx.set(noteRef, document as unknown as Record<string, unknown>);
      return { note: document, transaction, replayed: true };
    }

    let bankAccount: BankAccount | undefined;
    if (params.intent.mode === 'paid') {
      if (!bankAccountSnapshot?.exists) throw new PurchaseFinancialReferenceError();
      bankAccount = { ...bankAccountSnapshot.data(), id: bankAccountSnapshot.id } as BankAccount;
      if (bankAccount.businessId !== params.businessId || bankAccount.isActive === false) {
        throw new PurchaseFinancialReferenceError();
      }
      if (!Number.isFinite(bankAccount.balance)) {
        throw new PurchaseFinancialReferenceError('A conta financeira não possui saldo confiável para realizar a baixa.');
      }
    }

    const now = new Date().toISOString();
    const paymentDate = params.intent.mode === 'paid'
      ? (params.intent.paymentDate ?? now.slice(0, 10))
      : undefined;
    const transaction: Transaction = {
      id: transactionId,
      businessId: params.businessId,
      type: 'despesa',
      category: 'Compras',
      description: `NF-e ${note.numero}/${note.serie} — ${note.supplier.name}`,
      amount,
      dueDate: params.intent.mode === 'payable' ? params.intent.dueDate : paymentDate,
      ...(paymentDate ? { paymentDate } : {}),
      status: params.intent.mode === 'paid' ? 'pago' : 'pendente',
      ...(params.intent.paymentMethod ? { paymentMethod: params.intent.paymentMethod } : {}),
      ...(bankAccount ? { bankAccountId: bankAccount.id } : {}),
      purchaseNoteId: params.noteId,
      ...(note.supplier.id ? { supplierId: note.supplier.id } : {}),
      supplierName: note.supplier.name,
      sourceType: 'purchase',
      idempotencyKey: `purchase:${params.noteId}:financial`,
      notes: `Gerado pela NF-e ${note.accessKey}.`,
      createdBy: params.actor.uid,
      createdByName: params.actor.name,
      createdAt: now,
      updatedAt: now,
    };
    tx.create(transactionRef, transaction as unknown as Record<string, unknown>);
    if (bankAccountRef && bankAccount) {
      tx.update(bankAccountRef, {
        balance: roundMoney(bankAccount.balance - amount),
        updatedAt: now,
      });
    }

    const canonical = PurchaseNoteV2Schema.parse({
      ...note,
      financial: {
        transactionId,
        ...(bankAccount ? { bankAccountId: bankAccount.id } : {}),
        status: params.intent.mode === 'paid' ? 'paid' : 'payable_created',
      },
      updatedAt: now,
    });
    const document = preparedDocument(noteSnapshot.data() ?? {}, canonical, {
      financialLinkedBy: params.actor.uid,
      financialLinkedByName: params.actor.name,
      financialLinkedAt: now,
      updatedAt: now,
    });
    tx.set(noteRef, document as unknown as Record<string, unknown>);
    return { note: document, transaction, replayed: false };
  });
}
