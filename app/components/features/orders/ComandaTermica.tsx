'use client';

/**
 * Comanda térmica 80mm de um DeliveryOrder — preview em tela + impressão.
 *
 * - <ComandaTermica order businessName /> renderiza o layout monoespaçado
 *   (útil pra um preview inline num Dialog/Drawer).
 * - printComanda(order, businessName) imprime via <iframe> oculto com
 *   `@page { size: 80mm auto; margin: 0 }`, sem tocar no DOM visível da tela.
 *
 * O helper é auto-contido (gera HTML string próprio) pra não depender do
 * React montado — assim funciona chamado de qualquer handler.
 */

import { formatCurrency } from '@/lib/utils/format';
import type {
  DeliveryOrder,
  DeliveryOrderItem,
  DeliveryOrderPaymentMethod,
} from '@/lib/types';

const PAYMENT_METHOD_LABELS: Record<DeliveryOrderPaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  cartao_credito: 'Cartão de Crédito',
  cartao_debito: 'Cartão de Débito',
  pix: 'Pix',
  voucher: 'Voucher',
  outro: 'Outro',
  pix_online: 'Pix (online)',
  cartao_online: 'Cartão (online)',
};

// ── helpers puros (compartilhados por preview e impressão) ─────────────

function orderTime(order: DeliveryOrder): string {
  const raw = order.createdAt ?? order.estimatedDeliveryAt;
  const d = raw ? new Date(raw) : new Date();
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function orderDate(order: DeliveryOrder): string {
  const raw = order.createdAt;
  const d = raw ? new Date(raw) : new Date();
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

interface ModifierLine {
  label: string;
}

function itemModifierLines(item: DeliveryOrderItem): ModifierLine[] {
  const out: ModifierLine[] = [];
  for (const group of item.selectedModifiers ?? []) {
    for (const opt of group.selectedOptions ?? []) {
      const qtyPrefix = opt.quantity > 1 ? `${opt.quantity}x ` : '';
      const price =
        opt.additionalPrice > 0 ? ` (+${formatCurrency(opt.additionalPrice)})` : '';
      out.push({ label: `+ ${qtyPrefix}${opt.optionName}${price}` });
    }
  }
  return out;
}

function paymentLabel(order: DeliveryOrder): string {
  if (!order.paymentMethod) return 'A combinar';
  const base = PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod;
  const paid = order.paymentStatus === 'pago' ? ' [PAGO]' : '';
  return `${base}${paid}`;
}

// ── componente de preview (mesma estética da impressão) ────────────────

export function ComandaTermica({
  order,
  businessName,
}: {
  order: DeliveryOrder;
  businessName: string;
}) {
  const isEntrega = order.deliveryType === 'entrega';
  const addr = addressLines(order);

  return (
    <div
      className="mx-auto bg-white text-black font-mono text-[11px] leading-tight"
      style={{ width: '80mm', padding: '4mm', boxSizing: 'border-box' }}
    >
      <div className="text-center font-bold text-[13px] uppercase">{businessName}</div>
      <div className="text-center">
        Pedido #{order.number} · {orderTime(order)}
      </div>
      {orderDate(order) && <div className="text-center">{orderDate(order)}</div>}

      <Divider />
      <div className="text-center font-bold text-[13px]">
        {isEntrega ? 'ENTREGA' : 'RETIRADA'}
      </div>
      <Divider />

      <div className="font-bold">{order.clientName || 'Cliente'}</div>
      {order.clientPhone && <div>Tel: {order.clientPhone}</div>}
      {isEntrega && addr.length > 0 && (
        <div className="mt-1">
          {addr.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}

      <Divider label="ITENS" />
      {order.items.map((item, i) => (
        <div key={i} className="mb-1">
          <div className="flex justify-between gap-2">
            <span className="font-bold">
              {item.quantity}x {item.productName}
            </span>
            <span>{formatCurrency(item.total)}</span>
          </div>
          {itemModifierLines(item).map((m, j) => (
            <div key={j} className="pl-3">
              {m.label}
            </div>
          ))}
          {item.notes && <div className="pl-3 italic">obs: {item.notes}</div>}
        </div>
      ))}

      <Divider />
      {order.subtotal !== order.total && (
        <Row label="Subtotal" value={formatCurrency(order.subtotal)} />
      )}
      {!!order.deliveryFee && (
        <Row label="Taxa entrega" value={formatCurrency(order.deliveryFee)} />
      )}
      {!!order.discount && (
        <Row label="Desconto" value={`-${formatCurrency(order.discount)}`} />
      )}
      <div className="flex justify-between font-bold text-[13px]">
        <span>TOTAL</span>
        <span>{formatCurrency(order.total)}</span>
      </div>

      <Divider />
      <Row label="Pagamento" value={paymentLabel(order)} />
      {order.paymentMethod === 'dinheiro' && !!order.changeFor && (
        <Row
          label="Troco para"
          value={`${formatCurrency(order.changeFor)} (${formatCurrency(
            Math.max(0, order.changeFor - order.total),
          )})`}
        />
      )}

      <Divider />
      <div className="text-center">* Comanda de cozinha *</div>
    </div>
  );
}

function Divider({ label }: { label?: string }) {
  if (label) {
    return (
      <div className="my-1 text-center font-bold">
        {`—— ${label} ——`}
      </div>
    );
  }
  return <div className="my-1">{'------------------------------'}</div>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

// ── impressão (iframe oculto, auto-contido) ────────────────────────────

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildComandaHTML(order: DeliveryOrder, businessName: string): string {
  const isEntrega = order.deliveryType === 'entrega';
  const addr = addressLines(order);

  const rows: string[] = [];
  rows.push(`<div class="c b big up">${esc(businessName)}</div>`);
  rows.push(`<div class="c">Pedido #${order.number} · ${esc(orderTime(order))}</div>`);
  if (orderDate(order)) rows.push(`<div class="c">${esc(orderDate(order))}</div>`);
  rows.push(divider());
  rows.push(`<div class="c b big">${isEntrega ? 'ENTREGA' : 'RETIRADA'}</div>`);
  rows.push(divider());
  rows.push(`<div class="b">${esc(order.clientName || 'Cliente')}</div>`);
  if (order.clientPhone) rows.push(`<div>Tel: ${esc(order.clientPhone)}</div>`);
  if (isEntrega && addr.length) {
    rows.push(`<div class="mt">${addr.map((l) => `<div>${esc(l)}</div>`).join('')}</div>`);
  }
  rows.push(divider('ITENS'));
  for (const item of order.items) {
    rows.push(
      `<div class="item"><div class="line"><span class="b">${item.quantity}x ${esc(
        item.productName,
      )}</span><span>${esc(formatCurrency(item.total))}</span></div>` +
        itemModifierLines(item)
          .map((m) => `<div class="ind">${esc(m.label)}</div>`)
          .join('') +
        (item.notes ? `<div class="ind it">obs: ${esc(item.notes)}</div>` : '') +
        `</div>`,
    );
  }
  rows.push(divider());
  if (order.subtotal !== order.total) {
    rows.push(row('Subtotal', formatCurrency(order.subtotal)));
  }
  if (order.deliveryFee) rows.push(row('Taxa entrega', formatCurrency(order.deliveryFee)));
  if (order.discount) rows.push(row('Desconto', `-${formatCurrency(order.discount)}`));
  rows.push(
    `<div class="line b big"><span>TOTAL</span><span>${esc(
      formatCurrency(order.total),
    )}</span></div>`,
  );
  rows.push(divider());
  rows.push(row('Pagamento', paymentLabel(order)));
  if (order.paymentMethod === 'dinheiro' && order.changeFor) {
    rows.push(
      row(
        'Troco para',
        `${formatCurrency(order.changeFor)} (${formatCurrency(
          Math.max(0, order.changeFor - order.total),
        )})`,
      ),
    );
  }
  rows.push(divider());
  rows.push('<div class="c">* Comanda de cozinha *</div>');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Comanda #${order.number}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    width: 80mm; padding: 4mm;
    font-family: 'Courier New', ui-monospace, monospace;
    font-size: 11px; line-height: 1.25; color: #000;
  }
  .c { text-align: center; }
  .b { font-weight: 700; }
  .big { font-size: 13px; }
  .up { text-transform: uppercase; }
  .mt { margin-top: 3px; }
  .it { font-style: italic; }
  .ind { padding-left: 10px; }
  .item { margin-bottom: 3px; }
  .line { display: flex; justify-content: space-between; gap: 6px; }
  .div { margin: 3px 0; }
</style></head><body>${rows.join('')}</body></html>`;

  function divider(label?: string): string {
    return label
      ? `<div class="div c b">—— ${esc(label)} ——</div>`
      : `<div class="div">------------------------------</div>`;
  }
  function row(label: string, value: string): string {
    return `<div class="line"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;
  }
}

/**
 * Imprime a comanda térmica de um pedido. Cria um <iframe> oculto,
 * escreve o HTML auto-contido, chama print() e remove tudo depois —
 * não altera nada da tela atual.
 */
export function printComanda(order: DeliveryOrder, businessName: string): void {
  if (typeof window === 'undefined') return;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const cleanup = () => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  };

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    cleanup();
    return;
  }

  doc.open();
  doc.write(buildComandaHTML(order, businessName));
  doc.close();

  const trigger = () => {
    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      return;
    }
    win.addEventListener('afterprint', () => {
      // dá tempo do diálogo fechar antes de remover o iframe
      window.setTimeout(cleanup, 100);
    });
    try {
      win.focus();
      win.print();
    } catch {
      cleanup();
      return;
    }
    // fallback: navegadores que não emitem afterprint
    window.setTimeout(cleanup, 60_000);
  };

  // espera o layout do iframe estabilizar
  if (iframe.contentWindow?.document.readyState === 'complete') {
    window.setTimeout(trigger, 50);
  } else {
    iframe.onload = () => window.setTimeout(trigger, 50);
  }
}

export default ComandaTermica;
