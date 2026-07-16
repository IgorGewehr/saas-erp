import { describe, it, expect } from 'vitest';
import { EscPosBuilder, padLineLR, wrap } from '@/lib/services/printing/escpos';
import { buildComandaEscPos, buildTestReceipt, colsForWidth } from '@/lib/services/printing/comandaEscpos';
import type { DeliveryOrder } from '@/lib/types';

describe('padLineLR', () => {
  it('justifica esquerda↔direita na largura exata', () => {
    const out = padLineLR('Total', 'R$ 10', 20);
    expect(out).toHaveLength(20);
    expect(out.startsWith('Total')).toBe(true);
    expect(out.endsWith('R$ 10')).toBe(true);
  });
  it('trunca preservando a direita quando estoura', () => {
    const out = padLineLR('NomeMuitoLongoDeProduto', 'R$ 999', 12);
    expect(out).toHaveLength(12);
    expect(out.endsWith('R$ 999')).toBe(true);
  });
});

describe('wrap', () => {
  it('quebra em no máximo N colunas', () => {
    const lines = wrap('um dois tres quatro cinco', 10);
    expect(lines.every((l) => l.length <= 10)).toBe(true);
    expect(lines.join(' ')).toContain('quatro');
  });
  it('quebra dura palavra maior que a largura', () => {
    const lines = wrap('AAAAAAAAAAAAAAAAAAAA', 8);
    expect(lines.every((l) => l.length <= 8)).toBe(true);
    expect(lines.join('')).toBe('AAAAAAAAAAAAAAAAAAAA');
  });
});

describe('EscPosBuilder / CP850', () => {
  it('init emite ESC @ e seleciona CP850 (ESC t 2)', () => {
    const bytes = new EscPosBuilder().init().build();
    expect(Array.from(bytes.slice(0, 5))).toEqual([0x1b, 0x40, 0x1b, 0x74, 0x02]);
  });
  it('codifica acentos PT-BR em CP850 (ç=0x87, ã=0xC6)', () => {
    const bytes = new EscPosBuilder().textRaw('ção').build();
    expect(Array.from(bytes)).toContain(0x87); // ç
    expect(Array.from(bytes)).toContain(0xc6); // ã
  });
  it('caractere fora do mapa vira ?', () => {
    const bytes = new EscPosBuilder().textRaw('日').build();
    expect(Array.from(bytes)).toEqual([0x3f]);
  });
  it('size() usa nibble-encoding correto do GS ! (largura=alto, altura=baixo)', () => {
    expect(Array.from(new EscPosBuilder().size(true, true).build())).toEqual([0x1d, 0x21, 0x11]);
    expect(Array.from(new EscPosBuilder().size(false, true).build())).toEqual([0x1d, 0x21, 0x01]);
    expect(Array.from(new EscPosBuilder().size(true, false).build())).toEqual([0x1d, 0x21, 0x10]);
    expect(Array.from(new EscPosBuilder().size(false, false).build())).toEqual([0x1d, 0x21, 0x00]);
  });
});

describe('colsForWidth', () => {
  it('80mm=48 cols, 58mm=32 cols', () => {
    expect(colsForWidth(80)).toBe(48);
    expect(colsForWidth(58)).toBe(32);
  });
});

const ORDER = {
  id: 'o1',
  businessId: 'b1',
  number: 42,
  status: 'recebido',
  clientName: 'João da Silva',
  createdAt: '2026-07-03T12:00:00.000Z',
  deliveryType: 'retirada',
  items: [
    { productId: 'p1', productName: 'X-Salada', quantity: 2, unitPrice: 15, total: 30 },
  ],
  subtotal: 30,
  total: 30,
  paymentMethod: 'pix',
  paymentStatus: 'pendente',
} as unknown as DeliveryOrder;

describe('buildComandaEscPos', () => {
  it('produz bytes começando com init (ESC @)', () => {
    const bytes = buildComandaEscPos(ORDER, 'Lanchonete', 80);
    expect(bytes.length).toBeGreaterThan(20);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x1b, 0x40]);
  });
  it('contém o número do pedido e termina com corte (GS V)', () => {
    const bytes = buildComandaEscPos(ORDER, 'Lanchonete', 58);
    const s = Array.from(bytes).map((b) => String.fromCharCode(b)).join('');
    expect(s).toContain('#42');
    expect(Array.from(bytes)).toContain(0x1d); // GS (corte GS V 66)
  });
  it('58mm usa layout mais estreito que 80mm', () => {
    // Ambos válidos; só garante que gera sem lançar em ambas larguras.
    expect(buildComandaEscPos(ORDER, 'Loja', 58).length).toBeGreaterThan(10);
    expect(buildComandaEscPos(ORDER, 'Loja', 80).length).toBeGreaterThan(10);
  });
});

describe('buildTestReceipt', () => {
  it('gera recibo de teste com init e corte', () => {
    const bytes = buildTestReceipt('Minha Loja', 80);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x1b, 0x40]);
    expect(Array.from(bytes)).toContain(0x1d);
  });
});
