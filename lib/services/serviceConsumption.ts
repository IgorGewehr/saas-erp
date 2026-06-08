/**
 * Service consumption — deduz insumos (BOM de serviço) ao concluir um Appointment.
 *
 * P2.5: Service.consumedComponents[] declara os produtos consumidos por um
 * atendimento (ex: tintura no salão, material de aula na academia). Quando o
 * Appointment vira 'concluido', cada componente é deduzido do estoque reusando
 * o mesmo caminho de BOM do PDV/Pedidos (expandBomLines via deductStock).
 *
 * Aditivo e opcional: serviços SEM consumedComponents não chamam nada e seguem
 * com o comportamento atual (BIT-A-BIT).
 *
 * Idempotência: a dedução deve ser disparada APENAS na transição
 * (não-concluido → concluido), espelhando o guard de comissão em AgendaModule.
 * Re-conclusão de um appointment já concluído não re-deduz.
 */

import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import type { Product, Service } from '@/lib/types';
import { deductStock, type StockDeductionLine, type StockAdjustment } from '@/lib/services/stock';

/**
 * Carrega os Products referenciados por uma lista de IDs, filtrando por
 * businessId (R1). Produtos ausentes ou de outro tenant são silenciosamente
 * ignorados — o caller decide o que fazer com o índice resultante.
 */
async function loadProductIndex(
  productIds: string[],
  businessId: string,
): Promise<Map<string, Product>> {
  const unique = [...new Set(productIds)].filter(Boolean);
  const index = new Map<string, Product>();
  if (unique.length === 0) return index;
  const snaps = await Promise.all(unique.map(id => getDoc(doc(db, 'products', id))));
  for (const snap of snaps) {
    if (!snap.exists()) continue;
    const data = snap.data() as Product;
    if (data.businessId !== businessId) continue;
    index.set(snap.id, { ...data, id: snap.id });
  }
  return index;
}

/**
 * Deduz do estoque os insumos declarados em `service.consumedComponents`.
 * No-op (retorna []) quando o serviço não declara insumos.
 *
 * Reusa deductStock → expandBomLines: se um insumo for ele mesmo um produto
 * composto (components[]), a expansão de 1 nível do BOM ainda se aplica.
 */
export async function consumeServiceComponents(params: {
  service: Service | undefined;
  businessId: string;
  operatorId: string;
  operatorName: string;
  /** Appointment id — gravado em cada StockMovement para auditoria. */
  appointmentId: string;
}): Promise<StockAdjustment[]> {
  const { service, businessId, operatorId, operatorName, appointmentId } = params;

  const components = service?.consumedComponents;
  if (!components?.length) return [];

  const lines: StockDeductionLine[] = components.map(c => ({
    productId: c.productId,
    quantity: c.quantity,
  }));

  const productIndex = await loadProductIndex(lines.map(l => l.productId), businessId);
  if (productIndex.size === 0) return [];

  return deductStock(db, lines, {
    businessId,
    operatorId,
    operatorName,
    sourceId: appointmentId,
    reason: `Insumos do serviço - ${service?.name ?? 'Atendimento'}`,
    productIndex,
  });
}
