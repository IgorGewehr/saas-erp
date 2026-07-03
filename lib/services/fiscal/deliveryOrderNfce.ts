/**
 * lib/services/fiscal/deliveryOrderNfce.ts
 *
 * Mapeia um DeliveryOrder (módulo Pedidos) para o INPUT de emissão de NFC-e do
 * contrato existente (`NfceRequest` de `lib/contracts/api/fiscal/emit.ts`).
 *
 * Função PURA e determinística: recebe (order, business), devolve o mesmo shape
 * que o EmitirNotaDialog monta pro POST /api/fiscal/emit. Serve dois consumidores:
 *   1. Prefill do dialog manual (operador confere/edita antes de emitir).
 *   2. Auto-emissão best-effort na conclusão do pedido (opt-in via
 *      NFCeConfig.autoEmit — ver lib/types/index.ts).
 *
 * Por que reusar o MESMO shape: toda a lógica fiscal pesada (enrichment por
 * Product, alocação atômica de número, CSC, certificado, montagem do XML SEFAZ)
 * já vive no route de emit. Este mapper NÃO reimplementa nada disso — só traduz
 * os campos do pedido pros campos flat/inglês que o boundary consome.
 *
 * ─── Campos que o route resolve/enriquece (NÃO saem daqui) ───────────────────
 *   - CST/CSOSN, NCM, CFOP, alíquotas ICMS/PIS/COFINS/IPI: vêm do enrichment por
 *     `productId` no route (Product.fiscalTax) ou do default do regime. Por isso
 *     enviamos `productId` e deixamos os campos fiscais AUSENTES (undefined) —
 *     mandar default literal aqui atropelaria o cadastro do produto.
 *   - emitente, certificado, CSC, ambiente, inscrições, série/número: resolvidos
 *     server-side a partir de business.fiscal.
 *   - consumidorFinal='1', naturezaOperacao, presencaComprador: default do route.
 *
 * ─── Limitações conhecidas (documentadas de propósito) ───────────────────────
 *   - O DeliveryOrder NÃO tem CPF/CNPJ do cliente — só clientName/clientPhone.
 *     Logo NÃO há tomador identificado: `cpfConsumidor` fica ausente. Passamos
 *     `nomeConsumidor` (opcional na NFC-e) quando houver nome, apenas informativo.
 *   - `deliveryFee`/`discount` do pedido NÃO viram item nem entram no total da
 *     nota: a NFC-e é emitida sobre a MERCADORIA (soma dos itens). O route calcula
 *     `totalNF` a partir dos itens e a SEFAZ exige que o total dos pagamentos
 *     bata com ele — por isso o pagamento é montado sobre a soma dos itens, não
 *     sobre `order.total`. Frete/desconto de pedido como componente fiscal exige
 *     modelagem dedicada (item de serviço de entrega / vDesc por item) — fica
 *     como evolução futura.
 */

import type {
  DeliveryOrder,
  DeliveryOrderItem,
  DeliveryOrderPaymentMethod,
  Business,
} from '@/lib/types';
import type { NfceRequest } from '@/lib/contracts/api/fiscal/emit';

/**
 * Traduz o método de pagamento do pedido para o rótulo que `getPaymentCode`
 * (lib/fiscal/number-sequence.ts) reconhece — o route repassa `payment.method`
 * cru pra essa função. Mapear aqui evita cair silenciosamente em tPag '99'
 * (Outros) pros métodos cujo nome do pedido difere do esperado pelo mapa SEFAZ.
 *   - cartao_credito → 'credito' (03) | cartao_debito → 'debito' (04)
 *   - pix / pix_online → 'pix' (17)  | cartao_online → 'credito' (03)
 *   - voucher → 'voucher' (12) | dinheiro → 'dinheiro' (01) | outro → 'outros' (99)
 *   - undefined / método não mapeado → 'dinheiro' (01): fallback seguro, pois a
 *     NFC-e exige ao menos um pagamento e o cardápio anônimo é majoritariamente
 *     dinheiro-na-entrega. 'outro' explícito NÃO cai aqui — vira 'outros' (99).
 */
function mapPaymentMethod(method: DeliveryOrderPaymentMethod | undefined): string {
  switch (method) {
    case 'dinheiro':
      return 'dinheiro';
    case 'cartao_credito':
    case 'cartao_online':
      return 'credito';
    case 'cartao_debito':
      return 'debito';
    case 'pix':
    case 'pix_online':
      return 'pix';
    case 'voucher':
      return 'voucher';
    case 'outro':
      return 'outros';
    default:
      return 'dinheiro';
  }
}

/** Soma dos itens do pedido (mercadoria) — base fiscal da NFC-e. */
function itemsTotal(items: DeliveryOrderItem[]): number {
  return +items
    .reduce((sum, it) => sum + (Number(it.total) || Number(it.unitPrice) * Number(it.quantity) || 0), 0)
    .toFixed(2);
}

/**
 * Mapeia um DeliveryOrder → NfceRequest (input de emissão de NFC-e).
 *
 * PURA: não toca Firestore, rede, nem Date.now(). Idempotência/best-effort são
 * responsabilidade do chamador (o `orderId` + `sourceType: 'order'` fazem o route
 * ancorar a dedup por pedido: retry do mesmo pedido replaya a nota já emitida).
 *
 * @param order    Pedido de delivery a faturar.
 * @param business Empresa emitente (fornece `businessId`).
 * @returns Body pronto pro POST /api/fiscal/emit (type='nfce') e pro prefill do
 *          EmitirNotaDialog. Itens sem `productId`/qtd/preço válidos podem gerar
 *          400 no route (validação de boundary) — o mapper não os filtra.
 */
export function buildDeliveryOrderNfceInput(
  order: DeliveryOrder,
  business: Business,
): NfceRequest {
  const items = (order.items ?? []).map((it) => ({
    // productId reativa o enrichment fiscal server-side (CST/CSOSN/alíquotas/NCM
    // do Product). Campos fiscais AUSENTES de propósito — ver cabeçalho.
    productId: it.productId || undefined,
    description: it.productName,
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    // `total` é passthrough (EmitItemSchema.passthrough) — usado no prefill do
    // dialog pra exibir o valor da linha; o route recalcula vProd = qty*preço.
    total: Number(it.total) || +(Number(it.unitPrice) * Number(it.quantity)).toFixed(2),
  }));

  const total = itemsTotal(order.items ?? []);

  return {
    type: 'nfce',
    businessId: business.id,
    items,
    // Pagamento único com o método do pedido, sobre a soma dos itens (ver
    // limitações: frete/desconto de pedido não compõem o total fiscal).
    payments: [{ method: mapPaymentMethod(order.paymentMethod), amount: total }],
    // Sem CPF/CNPJ no pedido → sem tomador identificado. Nome só informativo.
    nomeConsumidor: order.clientName || undefined,
    // Vínculo com a origem: ancora idempotência por pedido no route e grava o
    // writeback (fiscalDocumentId/accessKey) de volta no DeliveryOrder.
    orderId: order.id,
    sourceType: 'order',
  };
}
