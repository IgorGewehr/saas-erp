/**
 * subscriptionPalette.ts — paleta categórica (não-semântica) pra distinguir
 * serviços/planos nas barras de "MRR por serviço" e nos dots da tabela de
 * assinaturas. Espelha o mockup (`--primary` no maior, `--fg` esmaecendo pros
 * demais) via classes Tailwind com variante `dark:` — sem token HSL novo
 * porque isto é ranking categórico, não estado semântico (pos/warn/crit já
 * são os tokens semânticos do módulo, não se aplicam aqui).
 */

const RANK_DOT_CLASSES = [
  'bg-red-600 dark:bg-red-500',
  'bg-gray-700 dark:bg-gray-400',
  'bg-gray-500 dark:bg-gray-500',
  'bg-gray-400 dark:bg-gray-600',
  'bg-gray-300 dark:bg-gray-700',
];

const RANK_FILL_CLASSES = [
  'bg-red-600 dark:bg-red-500',
  'bg-gray-600 dark:bg-gray-400',
  'bg-gray-500 dark:bg-gray-500',
  'bg-gray-400 dark:bg-gray-600',
  'bg-gray-300 dark:bg-gray-700',
];

export function subscriptionDotClass(rank: number): string {
  return RANK_DOT_CLASSES[Math.min(rank, RANK_DOT_CLASSES.length - 1)];
}

export function subscriptionFillClass(rank: number): string {
  return RANK_FILL_CLASSES[Math.min(rank, RANK_FILL_CLASSES.length - 1)];
}
