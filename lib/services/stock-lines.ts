/**
 * Fonte ÚNICA de reconstrução das linhas de estoque de um DeliveryOrder.
 *
 * `buildOrderStockLines` é PURA (sem SDK): recebe o pedido + um productIndex já
 * carregado e devolve as `StockDeductionLine[]` que representam o estoque tocado
 * pelo pedido — linha base de cada item (BOM expandido depois, pelo serviço de
 * estoque) + linhas dos insumos de modificadores (selectedModifiers →
 * option.linkedProductId × consumeQty × quantidade da opção × quantidade do item).
 *
 * É a garantia de SIMETRIA baixa↔restauro: tanto a dedução (criação do pedido,
 * client/admin SDK) quanto o restauro (estorno/PIX expirado, admin SDK)
 * reconstroem as MESMAS linhas a partir do documento persistido. A execução
 * (deduct/restore, transação) difere por SDK; o cálculo das linhas, não.
 *
 * Mantenha este módulo livre de imports de SDK (firebase / firebase-admin) para
 * que possa ser usado dos dois lados do divisor.
 */

import type { DeliveryOrder, Product } from '@/lib/types';
import type { StockDeductionLine } from '@/lib/services/stock-admin';

export type { StockDeductionLine } from '@/lib/services/stock-admin';

/**
 * Reconstrói as linhas de estoque de um pedido a partir do documento persistido.
 *
 * Para cada item: a linha base (`productId`/`quantity`) — a expansão de BOM de
 * produtos compostos é responsabilidade do serviço de estoque (deduct/restore),
 * não daqui. Para cada opção de modificador escolhida que aponte para um insumo
 * (`linkedProductId`), uma linha própria já multiplicada por:
 *   consumeQty (consumo por unidade da opção, default 1)
 *   × quantidade da opção (default 1)
 *   × quantidade do item.
 *
 * `productIndex` deve conter os produtos dos itens (para resolver os
 * `modifierGroups` e os `linkedProductId` das opções). Itens/opções ausentes do
 * índice são ignorados em silêncio — espelha o comportamento dos callers que
 * carregam o índice por businessId e descartam matches cross-tenant.
 */
export function buildOrderStockLines(
  order: DeliveryOrder,
  productIndex: Map<string, Product>,
): StockDeductionLine[] {
  const lines: StockDeductionLine[] = [];
  for (const item of order.items ?? []) {
    lines.push({ productId: item.productId, quantity: item.quantity });
    const product = productIndex.get(item.productId);
    if (!product?.modifierGroups?.length) continue;
    for (const sm of item.selectedModifiers ?? []) {
      const group = product.modifierGroups.find((g) => g.id === sm.groupId);
      if (!group) continue;
      for (const opt of sm.selectedOptions) {
        const srcOpt = group.options.find((o) => o.id === opt.optionId);
        if (srcOpt?.linkedProductId) {
          lines.push({
            productId: srcOpt.linkedProductId,
            quantity:
              (srcOpt.consumeQty ?? 1) * Math.max(1, opt.quantity || 1) * item.quantity,
          });
        }
      }
    }
  }
  // "Não controlar estoque" (trackStock===false): a linha do produto é ignorada
  // — não deduz nem restaura. Filtrar AQUI (fonte única) cobre TODOS os caminhos
  // (cardápio público, PDV, Pedidos, webhook/estorno, expire-pix) simetricamente.
  // Produto ausente do índice ou sem o flag (undefined/true) → mantém (padrão).
  return lines.filter((l) => productIndex.get(l.productId)?.trackStock !== false);
}
