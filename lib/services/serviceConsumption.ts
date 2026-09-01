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

import type { Firestore } from 'firebase-admin/firestore';
import type { Service } from '@/lib/types';
import type { StockOperationAdjustment } from '@/lib/services/stock-core-admin';
import { applyStockOperationAdmin } from '@/lib/services/stock-core-admin';
import { applyStockOperation } from '@/lib/services/stock-server-client';

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
}): Promise<StockOperationAdjustment[]> {
  const { service, businessId, operatorName, appointmentId } = params;

  const components = service?.consumedComponents;
  if (!components?.length) return [];

  const lines = components.map(c => ({
    productId: c.productId,
    quantity: c.quantity,
  }));

  const result = await applyStockOperation({
    businessId,
    type: 'saida',
    lines,
    operatorName,
    sourceType: 'service',
    sourceId: appointmentId,
    idempotencyKey: `appointment:${appointmentId}:consume-stock`,
    reason: `Insumos do serviço - ${service?.name ?? 'Atendimento'}`,
    expandBom: true,
    negativeStockPolicy: 'allow',
  });
  return result.adjustments;
}

/**
 * Admin SDK mirror de `consumeServiceComponents`. A versão client depende de
 * `applyStockOperation` (lib/services/stock-server-client.ts, `'use client'`),
 * que usa `auth.currentUser` do browser para chamar `/api/stock/operations` —
 * não funciona em contexto server (handlers de domain event, cron, etc).
 * Esta versão chama `applyStockOperationAdmin` direto, sem round-trip HTTP.
 */
export async function consumeServiceComponentsAdmin(
  db: Firestore,
  params: {
    service: Service | undefined;
    businessId: string;
    operatorId: string;
    operatorName: string;
    appointmentId: string;
  },
): Promise<StockOperationAdjustment[]> {
  const { service, businessId, operatorId, operatorName, appointmentId } = params;

  const components = service?.consumedComponents;
  if (!components?.length) return [];

  const lines = components.map(c => ({
    productId: c.productId,
    quantity: c.quantity,
  }));

  const result = await applyStockOperationAdmin(db, {
    businessId,
    type: 'saida',
    lines,
    operatorId,
    operatorName,
    sourceType: 'service',
    sourceId: appointmentId,
    idempotencyKey: `appointment:${appointmentId}:consume-stock`,
    reason: `Insumos do serviço - ${service?.name ?? 'Atendimento'}`,
    expandBom: true,
    negativeStockPolicy: 'allow',
  });
  return result.adjustments;
}
