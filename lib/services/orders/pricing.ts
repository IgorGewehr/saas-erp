/**
 * Fonte ÚNICA da lógica de MODIFICADORES de pedido (preço + validação).
 *
 * Puras (sem SDK Firebase, sem `window`) → reutilizáveis por web, cardápio
 * público (app/p/[slug]) e PDV, tanto no client quanto no server.
 *
 * Extraído INLINE de app/api/orders/public/route.ts (referência de correção).
 * Comportamento IDÊNTICO — apenas centralizado. Não altere a lógica aqui sem
 * revisar o caminho público, que é a fonte de verdade de precificação.
 *
 * As linhas de estoque dos modificadores (linkedProductId) NÃO são montadas
 * aqui: a reconstrução é centralizada em buildOrderStockLines (lib/services/
 * stock-lines) a partir dos itens validados, garantindo simetria baixa↔restauro.
 */
import type {
  Product,
  SelectedModifier,
  ModifierPriceStrategy,
} from '@/lib/types';

/** Arredonda a 2 casas (moeda). Evita erro de ponto flutuante em somas. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Delta de preço agregado de todos os grupos de modificadores selecionados.
 * Cada grupo aplica sua estratégia (`sum` | `max` | `avg`) sobre os preços
 * das opções escolhidas (já multiplicados pela quantidade da opção).
 */
export function computeModifierDelta(selected: SelectedModifier[]): number {
  let delta = 0;
  for (const group of selected) {
    const prices = group.selectedOptions.map(o => o.additionalPrice * Math.max(1, o.quantity || 1));
    if (!prices.length) continue;
    delta += applyStrategy(group.priceStrategy, prices);
  }
  return delta;
}

/** Reduz os preços de um grupo conforme a estratégia de precificação. */
export function applyStrategy(strategy: ModifierPriceStrategy, prices: number[]): number {
  if (!prices.length) return 0;
  if (strategy === 'max') return Math.max(...prices);
  if (strategy === 'avg') return prices.reduce((s, p) => s + p, 0) / prices.length;
  return prices.reduce((s, p) => s + p, 0); // sum (default)
}

export type ModifierValidation =
  | { clean: SelectedModifier[] }
  | { error: string };

/**
 * Valida as seleções de modificadores enviadas pelo cliente contra a definição
 * `modifierGroups` do produto, reconstruindo cada SelectedModifier a partir da
 * fonte de verdade server-side (nome do grupo, estratégia, preço das opções).
 *
 * As linhas de estoque dos modificadores (linkedProductId) NÃO são montadas
 * aqui: a reconstrução é centralizada em buildOrderStockLines a partir dos itens
 * validados, garantindo simetria baixa↔restauro.
 */
export function validateAndCleanModifiers(
  product: Product,
  incoming: SelectedModifier[] | undefined,
): ModifierValidation {
  const groups = product.modifierGroups || [];
  const sel = incoming || [];

  // Required groups must be present with valid selection counts
  for (const group of groups) {
    const chosen = sel.find(s => s.groupId === group.id);
    const count = chosen?.selectedOptions.reduce((s, o) => s + Math.max(1, o.quantity || 1), 0) || 0;
    if (group.required && count < Math.max(1, group.minSelections)) {
      return { error: `Selecione ${group.name}` };
    }
    if (count > group.maxSelections && group.maxSelections > 0) {
      return { error: `Máximo ${group.maxSelections} em ${group.name}` };
    }
  }

  const clean: SelectedModifier[] = [];
  for (const chosen of sel) {
    const group = groups.find(g => g.id === chosen.groupId);
    if (!group) continue; // silently drop unknown groups
    const cleanedOptions = [];
    for (const opt of chosen.selectedOptions) {
      const srcOpt = group.options.find(o => o.id === opt.optionId);
      if (!srcOpt || srcOpt.available === false) continue;
      const qty = Math.max(1, Math.min(opt.quantity || 1, srcOpt.maxQuantity ?? 99));
      cleanedOptions.push({
        optionId: srcOpt.id,
        optionName: srcOpt.name,
        additionalPrice: srcOpt.additionalPrice,
        quantity: qty,
      });
    }
    if (cleanedOptions.length === 0) continue;
    clean.push({
      groupId: group.id,
      groupName: group.name,
      priceStrategy: group.priceStrategy,
      selectedOptions: cleanedOptions,
    });
  }

  return { clean };
}
