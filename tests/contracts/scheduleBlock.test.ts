import { describe, expect, it } from 'vitest';
import { ScheduleBlockSchema, CreateScheduleBlockInputSchema } from '@/contracts/domain/scheduleBlock';
import { canTransitionScheduleBlock, assertTransitionScheduleBlock } from '@/contracts/fsm/scheduleBlock';

function block(overrides: Record<string, unknown> = {}) {
  return {
    id: 'block-1',
    businessId: 'biz-1',
    startDate: '2026-09-10',
    endDate: '2026-09-20',
    status: 'ativo',
    createdBy: 'user-1',
    createdByName: 'Recepção',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ScheduleBlockSchema', () => {
  it('aceita bloqueio de dia inteiro sem professionalId (negócio inteiro)', () => {
    expect(ScheduleBlockSchema.safeParse(block()).success).toBe(true);
  });

  it('aceita bloqueio de um profissional específico com janela de horário', () => {
    const result = ScheduleBlockSchema.safeParse(block({
      professionalId: 'prof-1',
      professionalName: 'Dr. Silva',
      startDate: '2026-09-10',
      endDate: '2026-09-10',
      startTime: '12:00',
      endTime: '13:00',
      reason: 'Almoço estendido',
    }));
    expect(result.success).toBe(true);
  });

  it('rejeita endDate anterior a startDate', () => {
    const result = ScheduleBlockSchema.safeParse(block({ startDate: '2026-09-20', endDate: '2026-09-10' }));
    expect(result.success).toBe(false);
  });

  it('rejeita startTime sem endTime', () => {
    const result = ScheduleBlockSchema.safeParse(block({ startTime: '12:00' }));
    expect(result.success).toBe(false);
  });

  it('rejeita endTime sem startTime', () => {
    const result = ScheduleBlockSchema.safeParse(block({ endTime: '13:00' }));
    expect(result.success).toBe(false);
  });

  it('rejeita endTime não posterior a startTime', () => {
    const result = ScheduleBlockSchema.safeParse(block({ startTime: '13:00', endTime: '13:00' }));
    expect(result.success).toBe(false);
  });
});

describe('CreateScheduleBlockInputSchema', () => {
  it('aceita input mínimo (só datas, sem profissional/horário/motivo)', () => {
    const result = CreateScheduleBlockInputSchema.safeParse({ startDate: '2026-09-10', endDate: '2026-09-10' });
    expect(result.success).toBe(true);
  });

  it('rejeita as mesmas invariantes de data/horário do schema persistido', () => {
    expect(CreateScheduleBlockInputSchema.safeParse({ startDate: '2026-09-20', endDate: '2026-09-10' }).success).toBe(false);
    expect(CreateScheduleBlockInputSchema.safeParse({ startDate: '2026-09-10', endDate: '2026-09-10', startTime: '12:00' }).success).toBe(false);
  });
});

describe('ScheduleBlock FSM', () => {
  it('permite ativo -> cancelado', () => {
    expect(canTransitionScheduleBlock('ativo', 'cancelado')).toBe(true);
  });

  it('cancelado é terminal — nenhuma transição de saída', () => {
    expect(canTransitionScheduleBlock('cancelado', 'ativo')).toBe(false);
  });

  it('assertTransitionScheduleBlock lança em transição inválida', () => {
    expect(() => assertTransitionScheduleBlock('cancelado', 'ativo')).toThrow(/ScheduleBlock FSM/);
  });

  it('assertTransitionScheduleBlock não lança em transição válida', () => {
    expect(() => assertTransitionScheduleBlock('ativo', 'cancelado')).not.toThrow();
  });
});
