/**
 * Testes do parser de grade de horários (texto livre → WeeklySession[]).
 * Usa a grade real da Valhalla Fight Center como fixture principal.
 */

import { describe, it, expect } from 'vitest';
import { parseGradeText } from '../../lib/services/gradeParser';

describe('parseGradeText', () => {
  it('extrai dias e horários de uma linha simples', () => {
    const out = parseGradeText('Boxe: Seg 18h30 · Ter 19h · Qua 18h30 · Qui 19h');
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Boxe');
    expect(out[0].sessions).toEqual([
      { weekday: 1, startTime: '18:30' },
      { weekday: 2, startTime: '19:00' },
      { weekday: 3, startTime: '18:30' },
      { weekday: 4, startTime: '19:00' },
    ]);
  });

  it('normaliza formatos de hora variados (11h, 19h30, 06h30, 11:30)', () => {
    const out = parseGradeText('MMA: Seg 08h / 10h / 11h · Sáb 12h30');
    expect(out[0].sessions).toEqual([
      { weekday: 1, startTime: '08:00' },
      { weekday: 1, startTime: '10:00' },
      { weekday: 1, startTime: '11:00' },
      { weekday: 6, startTime: '12:30' },
    ]);
  });

  it('mantém o nome com parênteses e ignora rótulos sem horário', () => {
    const out = parseGradeText('Jiu Jitsu (Adulto): Seg 11h / 19h30 · Ter 21h30 (Corujão)');
    expect(out[0].name).toBe('Jiu Jitsu (Adulto)');
    expect(out[0].sessions).toEqual([
      { weekday: 1, startTime: '11:00' },
      { weekday: 1, startTime: '19:30' },
      { weekday: 2, startTime: '21:30' },
    ]);
  });

  it('anexa linhas de continuação (sem Nome:) à modalidade anterior', () => {
    const text = ['Muay Thai: Ter 20h / Qui 20h', 'Sexta 20h', 'Sábado 11:30'].join('\n');
    const out = parseGradeText(text);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Muay Thai');
    expect(out[0].sessions).toEqual([
      { weekday: 2, startTime: '20:00' },
      { weekday: 4, startTime: '20:00' },
      { weekday: 5, startTime: '20:00' },
      { weekday: 6, startTime: '11:30' },
    ]);
  });

  it('deduplica horários repetidos no mesmo dia', () => {
    const out = parseGradeText('X: Seg 10h / 10h · Seg 10h');
    expect(out[0].sessions).toEqual([{ weekday: 1, startTime: '10:00' }]);
  });

  it('descarta modalidades sem nenhum horário reconhecível', () => {
    const out = parseGradeText('Observação: confirme sempre pela recepção');
    expect(out).toHaveLength(0);
  });

  it('parseia a grade completa da Valhalla sem quebrar', () => {
    const grade = [
      'Jiu Jitsu (Adulto): Seg 11h / 14h / 15h / 19h30 / 21h · Ter 09h / 18h30 / 21h30 (Corujão) · Qua 06h30 / 14h / 15h / 19h30 / 21h · Qui 09h / 18h30 / 21h30 (Corujão) · Sex 06h30 / 18h30',
      'Jiu Jitsu (Kids): Seg 08h / 17h · Qua 08h / 17h · Ter 20h · Qui 20h',
      'Jiu Jitsu (Feminino): Ter 20h · Qui 20h',
      'MMA: Seg 08h / 10h / 11h · Ter 08h / 10h / 11h / 21h · Qua 08h / 10h · Qui 08h / 10h / 11h / 21h · Sex 10h (Sparring MMA) · Sáb 12h30',
      'MMA Kids: Ter 09h / 16h30 · Qui 09h / 16h30',
      'No Gi / Grappling: Seg 08h / 18h30 / 19h30 · Ter 08h / 10h / 11h / 15h / 20h · Qua 08h / 18h30 / 19h30 · Qui 08h / 10h / 11h / 15h / 20h · Sex 18h30 · Sáb 10h (Sparring/Grappling)',
      'Boxe: Seg 18h30 · Ter 19h · Qua 18h30 · Qui 19h',
    ].join('\n');
    const out = parseGradeText(grade);
    const names = out.map((m) => m.name);
    expect(names).toContain('Jiu Jitsu (Adulto)');
    expect(names).toContain('No Gi / Grappling');
    expect(names).toContain('Boxe');
    // Jiu Adulto: 5+3+5+3+2 = 18 horários (todos distintos por dia)
    const jiu = out.find((m) => m.name === 'Jiu Jitsu (Adulto)')!;
    expect(jiu.sessions).toHaveLength(18);
    // Todas as sessões têm weekday válido e HH:MM
    for (const m of out) {
      for (const s of m.sessions) {
        expect(s.weekday).toBeGreaterThanOrEqual(0);
        expect(s.weekday).toBeLessThanOrEqual(6);
        expect(s.startTime).toMatch(/^\d{2}:\d{2}$/);
      }
    }
  });

  it('trata "No Gi / Grappling" — a barra do nome não vira dia/hora', () => {
    const out = parseGradeText('No Gi / Grappling: Sex 18h30');
    expect(out[0].name).toBe('No Gi / Grappling');
    expect(out[0].sessions).toEqual([{ weekday: 5, startTime: '18:30' }]);
  });
});
