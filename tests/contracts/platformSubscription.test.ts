/**
 * Contrato de PlatformSubscription (M12) — trava as invariantes do schema
 * (lib/contracts/domain/platformSubscription.ts) que os write paths reais
 * (createSubscriptionCheckout, webhook settle, cron de overdue) dependem.
 */

import { describe, it, expect } from 'vitest';
import { PlatformSubscriptionSchema, type PlatformSubscription } from '@/lib/contracts/domain/platformSubscription';

/** Assinatura válida mínima (pending_payment, único status sem preapproval). */
function makePendingSubscription(overrides: Partial<PlatformSubscription> = {}): PlatformSubscription {
  return {
    businessId: 'biz_1',
    status: 'pending_payment',
    payerEmail: 'dono@negocio.com',
    amount: 199,
    currency: 'BRL',
    frequency: 1,
    frequencyType: 'months',
    checkoutUrl: 'https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=abc',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('PlatformSubscriptionSchema — casos válidos', () => {
  it('aceita pending_payment sem mpPreapprovalId nem nextBillingDate', () => {
    expect(PlatformSubscriptionSchema.safeParse(makePendingSubscription()).success).toBe(true);
  });

  it('aceita active com mpPreapprovalId e nextBillingDate', () => {
    const result = PlatformSubscriptionSchema.safeParse(makePendingSubscription({
      status: 'active',
      mpPreapprovalId: 'preapproval_123',
      nextBillingDate: '2026-02-01T00:00:00.000Z',
      lastPaymentAt: '2026-01-01T00:00:00.000Z',
      lastPaymentStatus: 'approved',
    }));
    expect(result.success).toBe(true);
  });

  it('aceita cancelled com mpPreapprovalId mas sem nextBillingDate', () => {
    const result = PlatformSubscriptionSchema.safeParse(makePendingSubscription({
      status: 'cancelled',
      mpPreapprovalId: 'preapproval_123',
    }));
    expect(result.success).toBe(true);
  });
});

describe('PlatformSubscriptionSchema — invariantes rejeitam estado inconsistente', () => {
  it('rejeita active sem mpPreapprovalId', () => {
    const result = PlatformSubscriptionSchema.safeParse(makePendingSubscription({
      status: 'active',
      nextBillingDate: '2026-02-01T00:00:00.000Z',
    }));
    expect(result.success).toBe(false);
  });

  it('rejeita overdue sem mpPreapprovalId', () => {
    const result = PlatformSubscriptionSchema.safeParse(makePendingSubscription({
      status: 'overdue',
      nextBillingDate: '2026-02-01T00:00:00.000Z',
    }));
    expect(result.success).toBe(false);
  });

  it('rejeita active sem nextBillingDate', () => {
    const result = PlatformSubscriptionSchema.safeParse(makePendingSubscription({
      status: 'active',
      mpPreapprovalId: 'preapproval_123',
    }));
    expect(result.success).toBe(false);
  });

  it('rejeita overdue sem nextBillingDate', () => {
    const result = PlatformSubscriptionSchema.safeParse(makePendingSubscription({
      status: 'overdue',
      mpPreapprovalId: 'preapproval_123',
    }));
    expect(result.success).toBe(false);
  });

  it('rejeita amount não-positivo', () => {
    expect(PlatformSubscriptionSchema.safeParse(makePendingSubscription({ amount: 0 })).success).toBe(false);
    expect(PlatformSubscriptionSchema.safeParse(makePendingSubscription({ amount: -10 })).success).toBe(false);
  });

  it('rejeita payerEmail inválido', () => {
    expect(PlatformSubscriptionSchema.safeParse(makePendingSubscription({ payerEmail: 'not-an-email' })).success).toBe(false);
  });

  it('rejeita currency diferente de BRL', () => {
    const result = PlatformSubscriptionSchema.safeParse({ ...makePendingSubscription(), currency: 'USD' });
    expect(result.success).toBe(false);
  });

  it('rejeita status fora do enum da FSM', () => {
    const result = PlatformSubscriptionSchema.safeParse({ ...makePendingSubscription(), status: 'trial' });
    expect(result.success).toBe(false);
  });
});
