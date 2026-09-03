import { describe, expect, it } from 'vitest';
import {
  isRelevantForScheduling,
  resolveAgendaSchedulingConfig,
} from '@/lib/services/agenda/schedulingEligibility';
import type { Business } from '@/lib/types';

function business(overrides: Record<string, unknown> = {}): Business {
  return {
    id: 'biz1',
    razaoSocial: 'Clinica Teste',
    nomeFantasia: 'Clinica Teste',
    cnpj: '12345678000199',
    crt: '1',
    endereco: {} as Business['endereco'],
    phone: '5199999999',
    email: 'a@b.com',
    ownerUserId: 'user-1',
    memberIds: ['user-1'],
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Business;
}

describe('resolveAgendaSchedulingConfig / isRelevantForScheduling', () => {
  it('usa os defaults da UI (lembrete + confirmação ON) quando servicos nunca salvou a aba, mesmo com Agente IA desligado', () => {
    const biz = business({ settings: { useCase: 'servicos', aiAgent: { enabled: false } } });

    const config = resolveAgendaSchedulingConfig(biz);
    expect(config).toMatchObject({ sendReminder: true, reminderHoursBefore: 24, confirmationBeforeAppointment: true, followUpAfter: false });
    expect(isRelevantForScheduling(biz)).toBe(true);
  });

  it('não aplica default pra useCase diferente de servicos', () => {
    const biz = business({ settings: { useCase: 'pedidos' } });

    expect(resolveAgendaSchedulingConfig(biz)).toBeUndefined();
    expect(isRelevantForScheduling(biz)).toBe(false);
  });

  it('respeita configuração explicitamente salva (tudo desligado), não reaplica o default', () => {
    const biz = business({
      settings: {
        useCase: 'servicos',
        aiAgent: { agenda: { sendReminder: false, confirmationBeforeAppointment: false, followUpAfter: false } },
      },
    });

    expect(resolveAgendaSchedulingConfig(biz)).toMatchObject({ sendReminder: false, confirmationBeforeAppointment: false, followUpAfter: false });
    expect(isRelevantForScheduling(biz)).toBe(false);
  });

  it('respeita configuração explicitamente salva com apenas um toggle ligado', () => {
    const biz = business({
      settings: {
        useCase: 'servicos',
        aiAgent: { agenda: { sendReminder: false, confirmationBeforeAppointment: true, followUpAfter: false } },
      },
    });

    expect(isRelevantForScheduling(biz)).toBe(true);
  });

  it('negócio sem settings.useCase nenhum (não-servicos) não é elegível mesmo com aiAgent.enabled ausente', () => {
    const biz = business({});
    expect(isRelevantForScheduling(biz)).toBe(false);
  });

  it('agente completo ligado por si só torna o negócio elegível (reengajamento etc.), mesmo fora de servicos', () => {
    const biz = business({ settings: { useCase: 'pedidos', aiAgent: { enabled: true } } });
    expect(isRelevantForScheduling(biz)).toBe(true);
  });
});
