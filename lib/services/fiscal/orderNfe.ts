/**
 * lib/services/fiscal/orderNfe.ts
 *
 * Mapeia um Order B2B/condicional (módulo Vendas, M02.6) para o INPUT de
 * emissão de NF-e do contrato existente (`NfeRequest` de
 * `lib/contracts/api/fiscal/emit.ts`). Mesmo racional de
 * `deliveryOrderNfce.ts` — função PURA, não reimplementa a lógica fiscal
 * pesada (enrichment por Product, alocação de número, XML, transmissão),
 * só traduz os campos do pedido.
 *
 * ─── `b2bOrderId`, não `orderId` ──────────────────────────────────────────
 * O contrato de emissão já tinha um campo `orderId` — mas ele significa
 * DeliveryOrder (módulo Pedidos), nome histórico. Order B2B usa o campo
 * distinto `b2bOrderId` pra `linkFiscalDocToSource` resolver a coleção
 * certa (`orders`, não `deliveryOrders`).
 *
 * ─── Limitações conhecidas (mesma classe da NFC-e de DeliveryOrder) ───────
 *   - Desconto GERAL do pedido (`order.discount`) NÃO compõe a nota: a NF-e
 *     é emitida sobre a soma dos itens (sem desconto), e o pagamento é
 *     montado sobre esse mesmo total — não sobre `order.total` (que já tem
 *     o desconto líquido). Modelar desconto geral como vDesc por item fica
 *     como evolução futura (mesmo adiamento já registrado na NFC-e).
 *   - Parcelamento (`order.installments`) não vira múltiplos `payments[]` —
 *     a nota reflete o valor total, o parcelamento é só do lançamento
 *     financeiro (Transaction), não do documento fiscal.
 */

import type { Order, OrderItem, PaymentMethod, Business } from '@/lib/types';
import type { NfeRequest } from '@/lib/contracts/api/fiscal/emit';

/** Soma dos itens do pedido (mercadoria) — base fiscal da NF-e. */
function itemsTotal(items: OrderItem[]): number {
  return +items
    .reduce((sum, it) => sum + (Number(it.total) || Number(it.unitPrice) * Number(it.quantity) || 0), 0)
    .toFixed(2);
}

/** `PaymentMethod` (Sale/Order) já usa os mesmos rótulos que `getPaymentCode`
 *  (lib/fiscal/number-sequence.ts) reconhece — sem tradução necessária, ao
 *  contrário do DeliveryOrderPaymentMethod (que tem rótulos próprios). */
function mapPaymentMethod(method: PaymentMethod | undefined): string {
  return method || 'boleto';
}

/**
 * Mapeia um Order B2B/condicional → NfeRequest (input de emissão de NF-e).
 *
 * PURA: não toca Firestore, rede, nem Date.now(). `b2bOrderId` + `sourceType:
 * 'b2bOrder'` fazem o route ancorar a dedup por pedido (retry do mesmo
 * pedido replaya a nota já emitida) e gravar o writeback em `orders`.
 *
 * @param order    Pedido B2B/condicional a faturar (normalmente status
 *                 'confirmado' — mesmo gate que a UI usa pra mostrar o botão).
 * @param business Empresa emitente (fornece `businessId`).
 */
export function buildOrderNfeInput(order: Order, business: Business): NfeRequest {
  const items = (order.items ?? []).map((it) => ({
    // productId reativa o enrichment fiscal server-side (CST/CSOSN/alíquotas/
    // NCM do Product). Campos fiscais AUSENTES de propósito — igual NFC-e.
    productId: it.productId || undefined,
    description: it.productName,
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    unit: it.unit || undefined,
    ncm: it.ncm || undefined,
    cfop: it.cfop || undefined,
    total: Number(it.total) || +(Number(it.unitPrice) * Number(it.quantity)).toFixed(2),
  }));

  const total = itemsTotal(order.items ?? []);
  const document = (order.clientCpfCnpj || '').replace(/\D/g, '') || undefined;

  return {
    type: 'nfe',
    businessId: business.id,
    items,
    payments: [{ method: mapPaymentMethod(order.paymentMethod), amount: total }],
    recipient: order.clientName || document
      ? {
          name: order.clientName || undefined,
          document,
          address: order.deliveryAddress
            ? {
                logradouro: order.deliveryAddress.logradouro,
                numero: order.deliveryAddress.numero,
                complemento: order.deliveryAddress.complemento,
                bairro: order.deliveryAddress.bairro,
                municipio: order.deliveryAddress.municipio,
                codigoMunicipio: order.deliveryAddress.codigoMunicipio,
                uf: order.deliveryAddress.uf,
                cep: order.deliveryAddress.cep,
              }
            : undefined,
        }
      : undefined,
    naturezaOperacao: 'VENDA DE MERCADORIA',
    // Vínculo com a origem: ancora idempotência por pedido no route e grava o
    // writeback (fiscalDocumentId/accessKey) de volta no Order.
    b2bOrderId: order.id,
    sourceType: 'b2bOrder',
  };
}
