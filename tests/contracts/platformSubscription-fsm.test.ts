/**
 * Contrato FSM de PlatformSubscription (M12) — garante que a máquina de
 * estados modelada em lib/contracts/fsm/platformSubscription.ts continua
 * espelhando os write paths reais (createSubscriptionCheckout, webhook
 * settle, cron de overdue).
 */

import { describe, it, expect } from 'vitest';
import {
  PLATFORM_SUBSCRIPTION_STATUSES,
  PLATFORM_SUBSCRIPTION_TRANSITIONS,
  PLATFORM_SUBSCRIPTION_TERMINAL_STATUSES,
  PlatformSubscriptionStatusSchema,
  canTransitionPlatformSubscription,
  assertTransitionPlatformSubscription,
} from '@/lib/contracts/fsm/platformSubscription';

describe('PlatformSubscription FSM — transições válidas (write paths reais)', () => {
  it('pending_payment → active (webhook confirma primeiro pagamento)', () => {
    expect(canTransitionPlatformSubscription('pending_payment', 'active')).toBe(true);
  });

  it('pending_payment → cancelled (checkout abandonado)', () => {
    expect(canTransitionPlatformSubscription('pending_payment', 'cancelled')).toBe(true);
  });

  it('active → overdue (cron detecta atraso)', () => {
    expect(canTransitionPlatformSubscription('active', 'overdue')).toBe(true);
  });

  it('overdue → active (webhook confirma pagamento em atraso)', () => {
    expect(canTransitionPlatformSubscription('overdue', 'active')).toBe(true);
  });

  it('active → cancelled e overdue → cancelled (cancelamento em qualquer estado não-terminal)', () => {
    expect(canTransitionPlatformSubscription('active', 'cancelled')).toBe(true);
    expect(canTransitionPlatformSubscription('overdue', 'cancelled')).toBe(true);
  });
});

describe('PlatformSubscription FSM — transições inválidas rejeitadas', () => {
  it('cancelled é terminal — nenhuma transição sai dele', () => {
    for (const to of PLATFORM_SUBSCRIPTION_STATUSES) {
      expect(canTransitionPlatformSubscription('cancelled', to)).toBe(false);
    }
  });

  it('pending_payment não pula direto pra overdue (precisa passar por active primeiro)', () => {
    expect(canTransitionPlatformSubscription('pending_payment', 'overdue')).toBe(false);
  });

  it('active não volta pra pending_payment', () => {
    expect(canTransitionPlatformSubscription('active', 'pending_payment')).toBe(false);
  });

  it('overdue não volta pra pending_payment', () => {
    expect(canTransitionPlatformSubscription('overdue', 'pending_payment')).toBe(false);
  });

  it('nenhum estado transiciona pra si mesmo (sem self-loop declarado)', () => {
    for (const s of PLATFORM_SUBSCRIPTION_STATUSES) {
      expect(canTransitionPlatformSubscription(s, s)).toBe(false);
    }
  });
});

describe('assertTransitionPlatformSubscription', () => {
  it('não lança para transição válida', () => {
    expect(() => assertTransitionPlatformSubscription('pending_payment', 'active')).not.toThrow();
  });

  it('lança com mensagem descritiva para transição inválida', () => {
    expect(() => assertTransitionPlatformSubscription('cancelled', 'active'))
      .toThrow('PlatformSubscription FSM: transição inválida cancelled → active');
  });
});

describe('Consistência do mapa de transições', () => {
  it('todo status tem uma entrada no mapa (mesmo que vazia)', () => {
    for (const s of PLATFORM_SUBSCRIPTION_STATUSES) {
      expect(PLATFORM_SUBSCRIPTION_TRANSITIONS[s]).toBeDefined();
    }
  });

  it('PLATFORM_SUBSCRIPTION_TERMINAL_STATUSES bate com os status sem nenhuma transição de saída', () => {
    for (const s of PLATFORM_SUBSCRIPTION_STATUSES) {
      const hasNoOutgoing = PLATFORM_SUBSCRIPTION_TRANSITIONS[s].size === 0;
      expect(PLATFORM_SUBSCRIPTION_TERMINAL_STATUSES.has(s)).toBe(hasNoOutgoing);
    }
  });

  it('PlatformSubscriptionStatusSchema aceita exatamente os 4 status declarados', () => {
    for (const s of PLATFORM_SUBSCRIPTION_STATUSES) {
      expect(PlatformSubscriptionStatusSchema.safeParse(s).success).toBe(true);
    }
    expect(PlatformSubscriptionStatusSchema.safeParse('trial').success).toBe(false);
    expect(PlatformSubscriptionStatusSchema.safeParse('').success).toBe(false);
  });
});
