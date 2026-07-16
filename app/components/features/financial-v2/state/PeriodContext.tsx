'use client';

/**
 * PeriodContext — o mês global do financial-v2 (a única "configuração" da
 * Visão Geral, compartilhada por todas as abas via useFinancialData).
 *
 * period é sempre 'YYYY-MM' (mesmo formato aceito pelo contrato do consultor).
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export interface PeriodContextValue {
  /** 'YYYY-MM' */
  period: string;
  year: number;
  month: number; // 1-12
  /** Rótulo pt-BR, ex: "Julho 2026" */
  label: string;
  goToPreviousMonth: () => void;
  goToNextMonth: () => void;
  goToCurrentMonth: () => void;
  setPeriod: (period: string) => void;
}

const MONTH_LABELS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function parsePeriod(period: string): { year: number; month: number } {
  const [y, m] = period.split('-').map(Number);
  return { year: y, month: m };
}

function shiftPeriod(period: string, delta: number): string {
  const { year, month } = parsePeriod(period);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const PeriodContext = createContext<PeriodContextValue | null>(null);

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [period, setPeriod] = useState<string>(currentPeriod);

  const value = useMemo<PeriodContextValue>(() => {
    const { year, month } = parsePeriod(period);
    return {
      period,
      year,
      month,
      label: `${MONTH_LABELS[month - 1]} ${year}`,
      goToPreviousMonth: () => setPeriod(p => shiftPeriod(p, -1)),
      goToNextMonth: () => setPeriod(p => shiftPeriod(p, 1)),
      goToCurrentMonth: () => setPeriod(currentPeriod()),
      setPeriod,
    };
  }, [period]);

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function usePeriod(): PeriodContextValue {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error('usePeriod must be used within a PeriodProvider');
  return ctx;
}
