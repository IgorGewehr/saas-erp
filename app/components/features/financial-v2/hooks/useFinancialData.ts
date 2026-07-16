'use client';

/**
 * useFinancialData — TODAS as queries TanStack Query compartilhadas entre as
 * abas do financial-v2. Uma busca por coleção serve todas as abas (staleTime
 * 5min); nenhuma aba deve abrir sua própria query duplicada pras mesmas
 * coleções — importe os hooks daqui (arquitetura do plano §4).
 *
 * R1 em toda query: `where('businessId', '==', business.id)`.
 * `['bankAccounts', business?.id]` reusa a mesma queryKey do FinancialModule
 * clássico (lib/components/features/financial/FinancialModule.tsx) — os dois
 * módulos compartilham cache de leitura sem conflito (nenhum dos dois é dono
 * exclusivo de escrita nesse hook).
 */

import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import type { Transaction, BankAccount, Membership, ClientMembership, Project, DasRecord, ReconciliationItem, FinancialAuditLog } from '@/lib/types';
import type { CashSession } from '@/lib/contracts/domain/cashSession';

const STALE_TIME = 5 * 60 * 1000;

// ─── Transactions ─────────────────────────────────────────────────────────────
// Janela ampla ordenada por dueDate (previsto/competência) — cobre o extrato
// unificado (passado+futuro) que E&S e Recorrentes precisam. Usa o índice
// composto já existente (businessId asc, dueDate desc) — nenhum índice novo.
const TRANSACTIONS_FETCH_LIMIT = 2000;

export function useFinTransactions(): UseQueryResult<Transaction[]> {
  const { business } = useAuth();
  return useQuery({
    queryKey: ['fin2-transactions', business?.id],
    queryFn: async (): Promise<Transaction[]> => {
      if (!business?.id) return [];
      const q = query(
        collection(db, 'transactions'),
        where('businessId', '==', business.id),
        orderBy('dueDate', 'desc'),
        limit(TRANSACTIONS_FETCH_LIMIT),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as Transaction));
    },
    enabled: !!business?.id,
    staleTime: STALE_TIME,
  });
}

/**
 * Recorrências (templates) — derivadas client-side de useFinTransactions, não
 * é coleção própria: `Transaction.recurrence` já embute a série (§2.1 do plano).
 * Read-model puro; sem chamada extra ao Firestore.
 */
export function useFinRecurringTransactions(): { data: Transaction[]; isLoading: boolean } {
  const { data: transactions = [], isLoading } = useFinTransactions();
  const recurring = useMemo(
    () => transactions.filter(t => t.recurrence?.isActive === true),
    [transactions],
  );
  return { data: recurring, isLoading };
}

// ─── Bank accounts ────────────────────────────────────────────────────────────
export function useFinBankAccounts(): UseQueryResult<BankAccount[]> {
  const { business } = useAuth();
  return useQuery({
    queryKey: ['bankAccounts', business?.id],
    queryFn: async (): Promise<BankAccount[]> => {
      if (!business?.id) return [];
      const q = query(
        collection(db, 'bankAccounts'),
        where('businessId', '==', business.id),
        orderBy('createdAt', 'desc'),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as BankAccount));
    },
    enabled: !!business?.id,
    staleTime: STALE_TIME,
  });
}

// ─── Memberships (planos) ─────────────────────────────────────────────────────
export function useFinMemberships(): UseQueryResult<Membership[]> {
  const { business } = useAuth();
  return useQuery({
    queryKey: ['fin2-memberships', business?.id],
    queryFn: async (): Promise<Membership[]> => {
      if (!business?.id) return [];
      const q = query(collection(db, 'memberships'), where('businessId', '==', business.id));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as Membership));
    },
    enabled: !!business?.id,
    staleTime: STALE_TIME,
  });
}

// ─── Client memberships (assinaturas) ────────────────────────────────────────
export function useFinClientMemberships(): UseQueryResult<ClientMembership[]> {
  const { business } = useAuth();
  return useQuery({
    queryKey: ['fin2-clientMemberships', business?.id],
    queryFn: async (): Promise<ClientMembership[]> => {
      if (!business?.id) return [];
      const q = query(collection(db, 'clientMemberships'), where('businessId', '==', business.id));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as ClientMembership));
    },
    enabled: !!business?.id,
    staleTime: STALE_TIME,
  });
}

// ─── DAS (imposto do Simples Nacional) — bloco ① Visão Geral ────────────────
// Coleção ainda sem escritor no app (fiscal do Simples é fase futura), mas
// schema+regras já existem (firestore.rules) — a query só nunca acha nada até
// lá; zero trabalho extra quando o módulo fiscal passar a gravar aqui.
export function useFinDasRecords(): UseQueryResult<DasRecord[]> {
  const { business } = useAuth();
  return useQuery({
    queryKey: ['fin2-dasRecords', business?.id],
    queryFn: async (): Promise<DasRecord[]> => {
      if (!business?.id) return [];
      const q = query(collection(db, 'dasRecords'), where('businessId', '==', business.id));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as DasRecord));
    },
    enabled: !!business?.id,
    staleTime: STALE_TIME,
  });
}

// ─── Reconciliation items (Bancário › 3 baldes) ──────────────────────────────
// Sem `orderBy` de propósito: o índice composto existente em
// firestore.indexes.json é (businessId, importId, createdAt) — uma
// `where(businessId).orderBy(createdAt)` pediria índice novo. O read-model
// (`conciliacao-3-baldes.ts`) ordena/filtra client-side sobre o array, então
// não precisamos pagar esse custo de deploy pra Fase 4.
const RECONCILIATION_ITEMS_FETCH_LIMIT = 1000;

export function useFinReconciliationItems(): UseQueryResult<ReconciliationItem[]> {
  const { business } = useAuth();
  return useQuery({
    queryKey: ['fin2-reconciliationItems', business?.id],
    queryFn: async (): Promise<ReconciliationItem[]> => {
      if (!business?.id) return [];
      const q = query(
        collection(db, 'reconciliationItems'),
        where('businessId', '==', business.id),
        limit(RECONCILIATION_ITEMS_FETCH_LIMIT),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as ReconciliationItem));
    },
    enabled: !!business?.id,
    staleTime: STALE_TIME,
  });
}

// ─── Cash sessions (Fluxo de Caixa — abertura/fechamento/sangria) ────────────
// Índice composto (businessId asc, openedAt desc) — ver firestore.indexes.json.
// Limite generoso: mesmo um caixa físico com 2 sessões/dia não chega perto de
// 500 num ano de operação (não precisa paginar pra Fase 5).
const CASH_SESSIONS_FETCH_LIMIT = 500;

export function useFinCashSessions(): UseQueryResult<CashSession[]> {
  const { business } = useAuth();
  return useQuery({
    queryKey: ['fin2-cashSessions', business?.id],
    queryFn: async (): Promise<CashSession[]> => {
      if (!business?.id) return [];
      const q = query(
        collection(db, 'cashSessions'),
        where('businessId', '==', business.id),
        orderBy('openedAt', 'desc'),
        limit(CASH_SESSIONS_FETCH_LIMIT),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as CashSession));
    },
    enabled: !!business?.id,
    staleTime: STALE_TIME,
  });
}

// ─── Financial audit log (Relatórios › Histórico) ────────────────────────────
// Mesma coleção/query do `AuditLogView` clássico (`financialAuditLog`,
// singular) — plano §1.1: "Auditoria (aba antiga) → Relatórios › seção
// Histórico" é reuso de DADOS, não uma coleção nova. `limit(100)` reusa o
// índice composto (businessId, createdAt) que o clássico já exercita hoje.
const AUDIT_LOG_FETCH_LIMIT = 100;

export function useFinAuditLog(): UseQueryResult<FinancialAuditLog[]> {
  const { business } = useAuth();
  return useQuery({
    queryKey: ['fin2-auditLog', business?.id],
    queryFn: async (): Promise<FinancialAuditLog[]> => {
      if (!business?.id) return [];
      const q = query(
        collection(db, 'financialAuditLog'),
        where('businessId', '==', business.id),
        orderBy('createdAt', 'desc'),
        limit(AUDIT_LOG_FETCH_LIMIT),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as FinancialAuditLog));
    },
    enabled: !!business?.id,
    staleTime: STALE_TIME,
  });
}

// ─── Projects (lente Assinaturas — vertical software house) ─────────────────
export function useFinProjects(): UseQueryResult<Project[]> {
  const { business } = useAuth();
  return useQuery({
    queryKey: ['fin2-projects', business?.id],
    queryFn: async (): Promise<Project[]> => {
      if (!business?.id) return [];
      const q = query(
        collection(db, 'projects'),
        where('businessId', '==', business.id),
        orderBy('createdAt', 'desc'),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as Project));
    },
    enabled: !!business?.id,
    staleTime: STALE_TIME,
  });
}
