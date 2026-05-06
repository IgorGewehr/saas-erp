/**
 * Lógica de saúde/risco de churn do cliente.
 *
 * Convertendo o score numérico (0-100) em níveis discretos pra UI conseguir
 * mostrar badge colorido + label sem cada call site re-implementar a régua.
 * Compartilhado entre HealthBadge (card da lista), ScoresSection (detalhe) e
 * filtros do ClientsModule.
 */

export type ChurnRiskLevel = 'minimal' | 'low' | 'moderate' | 'high' | 'critical';

export const CHURN_CFG: Record<ChurnRiskLevel, { label: string; color: string; dot: string; bg: string; bar: string; min: number }> = {
  minimal:  { label: 'Saudável',   color: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10', bar: 'bg-emerald-500', min: 0  },
  low:      { label: 'Baixo risco',color: 'text-green-600 dark:text-green-400',     dot: 'bg-green-500',   bg: 'bg-green-50 dark:bg-green-500/10',     bar: 'bg-green-500',   min: 20 },
  moderate: { label: 'Moderado',   color: 'text-amber-600 dark:text-amber-400',     dot: 'bg-amber-500',   bg: 'bg-amber-50 dark:bg-amber-500/10',     bar: 'bg-amber-500',   min: 40 },
  high:     { label: 'Alto risco', color: 'text-orange-600 dark:text-orange-400',   dot: 'bg-orange-500',  bg: 'bg-orange-50 dark:bg-orange-500/10',   bar: 'bg-orange-500',  min: 60 },
  critical: { label: 'Crítico',    color: 'text-red-600 dark:text-red-400',         dot: 'bg-red-500',     bg: 'bg-red-50 dark:bg-red-500/10',         bar: 'bg-red-500',     min: 80 },
};

export function getChurnLevel(risk: number): ChurnRiskLevel {
  if (risk >= 80) return 'critical';
  if (risk >= 60) return 'high';
  if (risk >= 40) return 'moderate';
  if (risk >= 20) return 'low';
  return 'minimal';
}

export function getOverallColor(score: number): string {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-green-500';
  if (score >= 40) return 'bg-amber-500';
  if (score >= 20) return 'bg-orange-500';
  return 'bg-red-500';
}
