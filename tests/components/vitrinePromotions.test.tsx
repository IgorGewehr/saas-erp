import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/config/firebase', () => ({ db: {}, auth: {} }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), updateDoc: vi.fn() }));
vi.mock('react-toastify', () => ({ toast: { warning: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

import { PromotionsBar } from '@/app/components/features/vitrine/PromotionsBar';
import { PromotionsManager } from '@/app/components/features/vitrine/PromotionsManager';
import type { BusinessPromotion } from '@/lib/types';

const launch: BusinessPromotion = {
  id: 'p1', name: 'Lançamento', type: 'percentage', value: 10, isActive: true, minOrderValue: 1500, validUntil: '2026-09-30',
};
const fixed: BusinessPromotion = { id: 'p2', name: 'Cliente antigo', type: 'fixed', value: 200, isActive: true };
const off: BusinessPromotion = { id: 'p3', name: 'Black Friday', type: 'percentage', value: 30, isActive: false };
const expired: BusinessPromotion = { id: 'p4', name: 'Verão', type: 'percentage', value: 5, isActive: true, validUntil: '2020-01-31' };

describe('PromotionsBar', () => {
  it('sem promoções e sem permissão de gerenciar: não ocupa espaço', () => {
    expect(renderToStaticMarkup(<PromotionsBar promotions={[]} canManage={false} onManage={() => undefined} />)).toBe('');
  });

  it('lista as promoções vigentes com valor e condições', () => {
    const html = renderToStaticMarkup(<PromotionsBar promotions={[launch, fixed]} canManage={false} onManage={() => undefined} />);
    expect(html).toContain('Lançamento');
    expect(html).toContain('10% de desconto');
    expect(html).toContain('pedido mínimo');
    expect(html).toContain('até 30/09/2026');
    expect(html).toContain('Cliente antigo');
    expect(html).toMatch(/R\$\s?200,00 de desconto/);
  });

  it('quem não é admin não vê o botão de gerenciar', () => {
    const html = renderToStaticMarkup(<PromotionsBar promotions={[launch]} canManage={false} onManage={() => undefined} />);
    expect(html).not.toContain('Gerenciar');
    expect(html).not.toContain('Criar promoção');
  });

  it('admin: "Gerenciar" quando há promoções e "Criar promoção" quando não há', () => {
    expect(renderToStaticMarkup(<PromotionsBar promotions={[launch]} canManage onManage={() => undefined} />)).toContain('Gerenciar');
    const empty = renderToStaticMarkup(<PromotionsBar promotions={[]} canManage onManage={() => undefined} />);
    expect(empty).toContain('Nenhuma promoção ativa');
    expect(empty).toContain('Criar promoção');
  });
});

describe('PromotionsManager', () => {
  const render = (promotions: BusinessPromotion[]) =>
    renderToStaticMarkup(<PromotionsManager businessId="biz_1" promotions={promotions} onClose={() => undefined} />);

  it('mostra o status de cada promoção: ativa, desativada e vencida', () => {
    const html = render([launch, off, expired]);
    expect(html).toContain('Ativa');
    expect(html).toContain('Desativada');
    expect(html).toContain('Vencida');
  });

  it('oferece Desativar pra ativa e Ativar pra desativada', () => {
    const html = render([launch, off]);
    expect(html).toContain('Desativar');
    expect(html).toContain('>Ativar<');
  });

  it('lista vazia avisa e o formulário de nova promoção está lá', () => {
    const html = render([]);
    expect(html).toContain('Nenhuma promoção cadastrada.');
    expect(html).toContain('Nova promoção');
    expect(html).toContain('Percentual (%)');
    expect(html).toContain('Valor fixo (R$)');
    expect(html).toContain('Criar promoção');
  });

  it('campos de texto usam 16px (senão o iPad dá zoom no foco)', () => {
    const html = render([]);
    const inputs = html.match(/<input\b[^>]*>/g) ?? [];
    expect(inputs.length).toBeGreaterThanOrEqual(4);
    expect(inputs.every((input) => input.includes('text-[16px]'))).toBe(true);
  });
});
