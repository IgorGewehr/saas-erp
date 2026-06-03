import { describe, it, expect } from 'vitest';

// Núcleo PURO da feature de turmas (sem Firestore/contratos no grafo de import).
import {
  findBlockingAppointment,
  countSeatsTaken,
  resolveSessionsForDay,
  buildGroupSlots,
  resolveGroupBooking,
} from '@/lib/services/groupSession';
import { buildSessionKey } from '@/lib/utils/sessionKey';
import type { Appointment, Service } from '@/lib/types';

const businessId = 'biz-1';

const apt = (over: Partial<Appointment>): Appointment => ({
  id: 'a1',
  businessId,
  clientId: 'c1',
  clientName: 'Maria',
  serviceId: 'svc1',
  serviceName: 'Aula',
  professionalId: 'prof1',
  date: '2026-06-01',
  startTime: '19:00',
  endTime: '20:00',
  duration: 60,
  status: 'agendado',
  price: 100,
  createdAt: '',
  updatedAt: '',
  ...over,
} as Appointment);

const groupService = (over: Partial<Service> = {}): Service => ({
  id: 'svc1',
  businessId,
  name: 'Jiu-Jitsu',
  duration: 60,
  price: 100,
  color: '#f00',
  capacity: 3,
  isActive: true,
  createdAt: '',
  updatedAt: '',
  ...over,
});

// 2026-06-01 e uma segunda-feira -> weekday 1.
const MONDAY = '2026-06-01';
const monKey = (prof?: string) =>
  buildSessionKey({ serviceId: 'svc1', date: MONDAY, startTime: '19:00', professionalId: prof });

describe('regra de conflito — EXCLUSIVO continua bloqueando (REGRESSAO)', () => {
  it('(a) qualquer sobreposicao do mesmo profissional bloqueia quando NAO ha sessionKey', () => {
    const existing = [apt({ id: 'x1', startTime: '19:00', endTime: '20:00' })];
    // candidateSessionKey undefined => exclusivo: qualquer overlap bloqueia.
    const blocking = findBlockingAppointment(existing, '19:30', '20:30', undefined);
    expect(blocking?.id).toBe('x1');
  });

  it('(a) cancelado nao bloqueia (slot liberado) — exclusivo', () => {
    const existing = [apt({ id: 'x1', status: 'cancelado', startTime: '19:00', endTime: '20:00' })];
    expect(findBlockingAppointment(existing, '19:00', '20:00', undefined)).toBeUndefined();
  });

  it('(a) sem sobreposicao nao bloqueia — exclusivo', () => {
    const existing = [apt({ id: 'x1', startTime: '18:00', endTime: '19:00' })];
    expect(findBlockingAppointment(existing, '19:00', '20:00', undefined)).toBeUndefined();
  });
});

describe('regra de conflito — TURMA', () => {
  it('(b/d) mesma turma (mesmo sessionKey) NAO conflita consigo mesma', () => {
    const key = monKey('prof1');
    const colleagues = [
      apt({ id: 'm1', sessionKey: key, startTime: '19:00', endTime: '20:00' }),
      apt({ id: 'm2', sessionKey: key, startTime: '19:00', endTime: '20:00' }),
    ];
    expect(findBlockingAppointment(colleagues, '19:00', '20:00', key)).toBeUndefined();
  });

  it('(d) profissional ocupado por turma BLOQUEIA 1:1 sobreposto (sessionKey diferente)', () => {
    const turmaKey = monKey('prof1');
    const aula = [apt({ id: 'm1', sessionKey: turmaKey, startTime: '19:00', endTime: '20:00' })];
    // 1:1 (sem sessionKey) tentando 19:30-20:30 no mesmo profissional.
    const blocking = findBlockingAppointment(aula, '19:30', '20:30', undefined);
    expect(blocking?.id).toBe('m1');
  });

  it('turma diferente (sessionKey diferente) sobreposta BLOQUEIA', () => {
    const outraTurma = monKey('prof1');
    const existing = [apt({ id: 'm1', sessionKey: outraTurma, startTime: '19:00', endTime: '20:00' })];
    const minhaTurma = buildSessionKey({ serviceId: 'svc2', date: MONDAY, startTime: '19:00', professionalId: 'prof1' });
    const blocking = findBlockingAppointment(existing, '19:30', '20:00', minhaTurma);
    expect(blocking?.id).toBe('m1');
  });
});

describe('contagem de vagas (countSeatsTaken)', () => {
  it('(b) conta alunos nao-cancelados do mesmo sessionKey', () => {
    const key = monKey('prof1');
    const appts = [
      apt({ id: 'm1', sessionKey: key }),
      apt({ id: 'm2', sessionKey: key }),
      apt({ id: 'm3', sessionKey: key, status: 'cancelado' }),
      apt({ id: 'other', sessionKey: monKey('prof2') }),
    ];
    expect(countSeatsTaken(appts, key)).toBe(2);
  });
});

describe('resolveSessionsForDay / buildGroupSlots', () => {
  it('servico SEM sessions[] -> resolveSessionsForDay vazio (cai no continuo)', () => {
    expect(resolveSessionsForDay(groupService(), 1)).toEqual([]);
  });

  it('enumera SO as sessoes do dia da semana, herdando duration/capacity', () => {
    const svc = groupService({
      capacity: 4,
      sessions: [
        { weekday: 1, startTime: '19:00' },                      // herda duration=60, capacity=4
        { weekday: 1, startTime: '20:00', duration: 90, capacity: 2 },
        { weekday: 3, startTime: '19:00' },                      // quarta — fora
      ],
    });
    const mon = resolveSessionsForDay(svc, 1);
    expect(mon.map(s => s.startTime)).toEqual(['19:00', '20:00']);
    expect(mon[0]).toMatchObject({ startTime: '19:00', endTime: '20:00', duration: 60, capacity: 4 });
    expect(mon[1]).toMatchObject({ startTime: '20:00', endTime: '21:30', duration: 90, capacity: 2 });
  });

  it('(b) buildGroupSlots emite vagas = capacity - alunos do sessionKey', () => {
    const svc = groupService({
      capacity: 3,
      sessions: [{ weekday: 1, startTime: '19:00' }],
    });
    const key = monKey(undefined); // sessao sem professionalId -> 'any'
    const appts = [
      apt({ id: 'm1', sessionKey: key, professionalId: undefined }),
      apt({ id: 'm2', sessionKey: key, professionalId: undefined }),
    ];
    const slots = buildGroupSlots(svc, MONDAY, 1, undefined, appts);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ startTime: '19:00', capacity: 3, seatsAvailable: 1, sessionKey: key });
  });

  it('(c) buildGroupSlots NAO emite sessao cheia', () => {
    const svc = groupService({
      capacity: 2,
      sessions: [{ weekday: 1, startTime: '19:00' }],
    });
    const key = monKey(undefined);
    const appts = [
      apt({ id: 'm1', sessionKey: key, professionalId: undefined }),
      apt({ id: 'm2', sessionKey: key, professionalId: undefined }),
    ];
    expect(buildGroupSlots(svc, MONDAY, 1, undefined, appts)).toHaveLength(0);
  });

  it('filtra sessao por professionalId fixo quando pedido', () => {
    const svc = groupService({
      capacity: 3,
      sessions: [
        { weekday: 1, startTime: '19:00', professionalId: 'profA', professionalName: 'A' },
        { weekday: 1, startTime: '20:00', professionalId: 'profB', professionalName: 'B' },
      ],
    });
    const slots = buildGroupSlots(svc, MONDAY, 1, 'profA', []);
    expect(slots.map(s => s.professionalId)).toEqual(['profA']);
  });
});

// FONTE ÚNICA manual↔agente — garante que os dois caminhos resolvem a MESMA
// turma (sessionKey/capacity/profissional idênticos). Cobre M1 e M2 da auditoria.
describe('resolveGroupBooking — paridade manual/agente', () => {
  it('M1: sessao ABERTA normaliza pra _any MESMO com profissional pedido', () => {
    const svc = groupService({
      capacity: 5,
      sessions: [{ weekday: 1, startTime: '19:00' }], // sem professionalId = aberta
    });
    // Pedido traz profX, mas a sessao e aberta → key deve ser _any (igual ao
    // slot que buildGroupSlots exibe), nao _profX.
    const r = resolveGroupBooking(svc, MONDAY, '19:00', 'profX');
    expect(r.professionalId).toBeUndefined();
    expect(r.sessionKey).toBe(monKey()); // _any
    // E bate com o slot exibido:
    const [slot] = buildGroupSlots(svc, MONDAY, 1, undefined, []);
    expect(r.sessionKey).toBe(slot.sessionKey);
  });

  it('M1: sessao com profissional FIXO usa o prof da sessao (nao o pedido)', () => {
    const svc = groupService({
      capacity: 5,
      sessions: [{ weekday: 1, startTime: '19:00', professionalId: 'profFixo', professionalName: 'Fixo' }],
    });
    const r = resolveGroupBooking(svc, MONDAY, '19:00', 'profOutro');
    expect(r.professionalId).toBe('profFixo');
    expect(r.professionalName).toBe('Fixo');
    expect(r.sessionKey).toBe(monKey('profFixo'));
  });

  it('M2: capacity da SESSAO tem precedencia sobre a do servico', () => {
    const svc = groupService({
      capacity: 10, // capacity do servico
      sessions: [{ weekday: 1, startTime: '19:00', capacity: 4 }], // override da sessao
    });
    const r = resolveGroupBooking(svc, MONDAY, '19:00', undefined);
    expect(r.capacity).toBe(4); // nao 10
  });

  it('turma ad-hoc (capacity>1 sem grade): usa capacity do servico e prof pedido', () => {
    const svc = groupService({ capacity: 8, sessions: undefined });
    const r = resolveGroupBooking(svc, MONDAY, '15:30', 'profY');
    expect(r.capacity).toBe(8);
    expect(r.professionalId).toBe('profY');
    expect(r.sessionKey).toBe(buildSessionKey({ serviceId: 'svc1', date: MONDAY, startTime: '15:30', professionalId: 'profY' }));
  });
});
