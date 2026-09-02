/**
 * lib/services/printing/comandaEscpos.ts
 *
 * Monta a comanda de um DeliveryOrder como bytes ESC/POS (impressão direta em
 * térmica via WebUSB). PURA: (order, businessName, paperWidth) → Uint8Array.
 * Espelha o conteúdo do preview HTML (ComandaTermica.tsx), mas em layout de
 * colunas fixas — 80mm = 48 cols, 58mm = 32 cols.
 *
 * O fallback de impressão (diálogo do navegador) continua usando o HTML de
 * ComandaTermica; este módulo é só para o caminho WebUSB silencioso.
 */

import { formatCurrency } from '@/lib/utils/format';
import type { DeliveryOrder, DeliveryOrderPaymentMethod } from '@/lib/types';
import { EscPosBuilder, padLineLR, wrap } from './escpos';

export type PaperWidth = 58 | 80;

/** Colunas (Fonte A) por largura de papel. */
export function colsForWidth(width: PaperWidth): number {
  return width === 58 ? 32 : 48;
}

const PAYMENT_METHOD_LABELS: Record<DeliveryOrderPaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  cartao_credito: 'Cartao de Credito',
  cartao_debito: 'Cartao de Debito',
  pix: 'Pix',
  voucher: 'Voucher',
  outro: 'Outro',
  pix_online: 'Pix (online)',
  cartao_online: 'Cartao (online)',
};

function orderTime(order: DeliveryOrder): string {
  const raw = order.createdAt ?? order.estimatedDeliveryAt;
  const d = raw ? new Date(raw) : new Date();
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function orderDate(order: DeliveryOrder): string {
  const d = order.createdAt ? new Date(order.createdAt) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR');
}

function addressLines(order: DeliveryOrder): string[] {
  const a = order.deliveryAddress;
  if (!a) return [];
  const l1 = [a.logradouro, a.numero].filter(Boolean).join(', ');
  const l2 = [a.bairro, a.complemento].filter(Boolean).join(' - ');
  const l3 = [a.municipio, a.uf].filter(Boolean).join('/');
  const lines = [l1, l2, l3].filter((s) => s.trim().length > 0);
  if (a.reference) lines.push(`Ref: ${a.reference}`);
  if (a.cep) lines.push(`CEP: ${a.cep}`);
  return lines;
}

function paymentLabel(order: DeliveryOrder): string {
  if (!order.paymentMethod) return 'A combinar';
  const base = PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod;
  return order.paymentStatus === 'pago' ? `${base} [PAGO]` : base;
}

/**
 * Comanda pronta pra `transferOut`. `cut=true` avança e corta o papel no fim.
 */
export function buildComandaEscPos(
  order: DeliveryOrder,
  businessName: string,
  paperWidth: PaperWidth = 80,
  opts: { cut?: boolean } = {},
): Uint8Array {
  const cols = colsForWidth(paperWidth);
  const b = new EscPosBuilder().init();

  // Cabeçalho: nome do negócio (centralizado, dobrado, negrito).
  b.align('center').bold(true).size(true, true);
  for (const l of wrap((businessName || 'Pedido').toUpperCase(), Math.floor(cols / 2))) b.line(l);
  b.size(false, false).bold(false);
  b.line(`Pedido #${order.number} - ${orderTime(order)}`);
  const date = orderDate(order);
  if (date) b.line(date);

  // Tipo de pedido (destaque).
  b.rule(cols).bold(true).size(false, true);
  b.line(order.deliveryType === 'entrega' ? 'ENTREGA'
    : order.deliveryType === 'mesa' ? `MESA ${order.tableNumber || '?'}`
      : 'RETIRADA');
  b.size(false, false).bold(false).rule(cols);

  // Cliente + endereço.
  b.align('left').bold(true).line(order.clientName || 'Cliente').bold(false);
  if (order.clientPhone) b.line(`Tel: ${order.clientPhone}`);
  if (order.deliveryType === 'entrega') {
    for (const l of addressLines(order)) {
      for (const wl of wrap(l, cols)) b.line(wl);
    }
  }

  // Itens.
  b.align('center').bold(true).line('---- ITENS ----').bold(false).align('left');
  for (const item of order.items ?? []) {
    const name = `${item.quantity}x ${item.productName}`;
    const price = formatCurrency(item.total);
    // Nome pode quebrar; o preço fica na 1ª linha à direita.
    const nameLines = wrap(name, cols - price.length - 1);
    b.bold(true).line(padLineLR(nameLines[0] ?? name, price, cols)).bold(false);
    for (const extra of nameLines.slice(1)) b.line(extra);
    for (const g of item.selectedModifiers ?? []) {
      for (const o of g.selectedOptions ?? []) {
        const qty = o.quantity > 1 ? `${o.quantity}x ` : '';
        const add = o.additionalPrice > 0 ? ` (+${formatCurrency(o.additionalPrice)})` : '';
        for (const wl of wrap(`+ ${qty}${o.optionName}${add}`, cols - 2)) b.line('  ' + wl);
      }
    }
    if (item.notes) for (const wl of wrap(`obs: ${item.notes}`, cols - 2)) b.line('  ' + wl);
  }

  // Totais.
  b.rule(cols);
  if (order.subtotal !== order.total) b.line(padLineLR('Subtotal', formatCurrency(order.subtotal), cols));
  if (order.deliveryFee) b.line(padLineLR('Taxa entrega', formatCurrency(order.deliveryFee), cols));
  if (order.couponDiscount) {
    b.line(padLineLR(`Cupom ${order.couponCode ?? ''}`.trim(), `-${formatCurrency(order.couponDiscount)}`, cols));
  } else if (order.discount) {
    b.line(padLineLR('Desconto', `-${formatCurrency(order.discount)}`, cols));
  }
  if (order.giftCardAmount) b.line(padLineLR('Gift card', `-${formatCurrency(order.giftCardAmount)}`, cols));
  b.bold(true).size(false, true).line(padLineLR('TOTAL', formatCurrency(order.total), cols)).size(false, false).bold(false);

  // Pagamento.
  b.rule(cols);
  b.line(padLineLR('Pagamento', paymentLabel(order), cols));
  if (order.paymentMethod === 'dinheiro' && order.changeFor) {
    const troco = Math.max(0, order.changeFor - order.total);
    b.line(padLineLR('Troco p/', `${formatCurrency(order.changeFor)} (${formatCurrency(troco)})`, cols));
  }
  if (order.customerNotes) {
    b.rule(cols).bold(true).line('Observacoes:').bold(false);
    for (const wl of wrap(order.customerNotes, cols)) b.line(wl);
  }

  b.rule(cols).align('center').line('* Comanda de cozinha *').align('left');
  b.feed(3);
  if (opts.cut !== false) b.cut();
  return b.build();
}

/**
 * Recibo curto de TESTE de impressão (usado no setup da impressora). Exercita
 * acentos PT-BR, alinhamento, negrito, tamanho e corte.
 */
export function buildTestReceipt(businessName: string, paperWidth: PaperWidth = 80): Uint8Array {
  const cols = colsForWidth(paperWidth);
  const now = new Date();
  const stamp = Number.isNaN(now.getTime()) ? '' : now.toLocaleString('pt-BR');
  const b = new EscPosBuilder().init();
  b.align('center').bold(true).size(true, true);
  b.line('TESTE');
  b.size(false, false);
  for (const l of wrap((businessName || 'ServicePro').toUpperCase(), Math.floor(cols / 2))) b.line(l);
  b.bold(false).rule(cols);
  b.align('left');
  b.line('Impressora configurada com sucesso.');
  b.line(`Largura: ${paperWidth}mm (${cols} colunas)`);
  b.line('Acentuacao: acao, pao, cafe, R$ 9,90');
  b.line(padLineLR('Item exemplo', 'R$ 12,00', cols));
  if (stamp) b.line(stamp);
  b.rule(cols).align('center').line('* Fim do teste *').feed(3).cut();
  return b.build();
}
