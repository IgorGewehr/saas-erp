import { describe, it, expect } from 'vitest';
import { zonedDateTimeToUtc, DEFAULT_BUSINESS_TIMEZONE } from '@/lib/utils/timezone';

describe('zonedDateTimeToUtc', () => {
  it('converte horário de Brasília (UTC-3, sem horário de verão) corretamente', () => {
    const utc = zonedDateTimeToUtc('2026-09-10', '14:00', 'America/Sao_Paulo');
    expect(utc.toISOString()).toBe('2026-09-10T17:00:00.000Z');
  });

  it('DEFAULT_BUSINESS_TIMEZONE é America/Sao_Paulo (mesmo default já usado em outros lugares do repo)', () => {
    expect(DEFAULT_BUSINESS_TIMEZONE).toBe('America/Sao_Paulo');
  });

  it('é de fato timezone-aware (respeita horário de verão), não um offset fixo tipo -03:00', () => {
    // New York: EST (UTC-5) no inverno, EDT (UTC-4) no verão americano.
    const winter = zonedDateTimeToUtc('2026-01-10', '14:00', 'America/New_York');
    const summer = zonedDateTimeToUtc('2026-07-10', '14:00', 'America/New_York');
    expect(winter.toISOString()).toBe('2026-01-10T19:00:00.000Z');
    expect(summer.toISOString()).toBe('2026-07-10T18:00:00.000Z');
  });

  it('funciona pra fuso não-brasileiro qualquer (prova que não é hardcoded pra BR)', () => {
    const tokyo = zonedDateTimeToUtc('2026-09-10', '09:00', 'Asia/Tokyo'); // UTC+9, sem DST
    expect(tokyo.toISOString()).toBe('2026-09-10T00:00:00.000Z');
  });

  it('lança em timezone inválido (não mascara dado ruim silenciosamente)', () => {
    expect(() => zonedDateTimeToUtc('2026-09-10', '14:00', 'Nao/Existe')).toThrow();
  });
});
