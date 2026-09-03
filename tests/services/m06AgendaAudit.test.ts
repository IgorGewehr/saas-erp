import { describe, expect, it } from 'vitest';
import {
  buildM06AgendaSnapshot,
  compareM06AgendaSnapshots,
  type M06AgendaAuditInput,
  type M06AuditDocument,
} from '@/lib/services/m06-agenda-audit';

const BUSINESS_ID = 'biz-m06';
const APPT_DATE = '2026-09-07';
// Mesma convenção de `checkAppointmentConflict`/`workingDayOf`: midday local
// evita o bug clássico de TZ jogando pro dia anterior em fusos negativos.
const APPT_WEEKDAY = new Date(`${APPT_DATE}T12:00:00`).getDay();
const NOW = '2026-09-07T18:00:00.000Z';

function document(id: string, data: Record<string, unknown>): M06AuditDocument {
  return { id, data };
}

/** Dataset mínimo, sem nenhuma issue — base para o teste de "caminho feliz". */
function cleanInput(): M06AgendaAuditInput {
  return {
    businessId: BUSINESS_ID,
    capturedAt: NOW,
    users: [
      document('prof-a', {
        businessId: BUSINESS_ID,
        workingHours: { [APPT_WEEKDAY]: { enabled: true, start: '08:00', end: '18:00' } },
      }),
    ],
    services: [],
    appointments: [
      document('appt-valid', {
        businessId: BUSINESS_ID,
        professionalId: 'prof-a',
        professionalIds: ['prof-a'],
        date: APPT_DATE,
        startTime: '09:00',
        endTime: '09:30',
        status: 'agendado',
        commissionTransactionId: 'tx-commission-good',
      }),
    ],
    transactions: [
      document('tx-commission-good', { businessId: BUSINESS_ID, type: 'despesa', amount: 20 }),
    ],
    fiscalDocuments: [],
  };
}

/** Estende o dataset limpo com um exemplo de CADA lacuna do diagnóstico M06.0. */
function messyInput(): M06AgendaAuditInput {
  const input = cleanInput();
  input.users.push(
    document('prof-b', {
      businessId: BUSINESS_ID,
      workingHours: { [APPT_WEEKDAY]: { enabled: false } },
    }),
  );
  input.services.push(document('svc-capacity', { businessId: BUSINESS_ID, capacity: 2 }));
  input.appointments.push(
    // Sobreposição real: mesmo profissional, mesmo dia, horários que se cruzam.
    document('appt-overlap-a', {
      businessId: BUSINESS_ID, professionalIds: ['prof-a'], date: APPT_DATE,
      startTime: '10:00', endTime: '10:30', status: 'agendado',
    }),
    document('appt-overlap-b', {
      businessId: BUSINESS_ID, professionalIds: ['prof-a'], date: APPT_DATE,
      startTime: '10:15', endTime: '10:45', status: 'confirmado',
    }),
    // Cancelado libera o slot — não deve contar como sobreposição mesmo
    // colidindo em horário com o par acima.
    document('appt-cancelled-would-overlap', {
      businessId: BUSINESS_ID, professionalIds: ['prof-a'], date: APPT_DATE,
      startTime: '10:20', endTime: '10:40', status: 'cancelado',
    }),
    // Fora do expediente do profissional.
    document('appt-outside-hours', {
      businessId: BUSINESS_ID, professionalIds: ['prof-b'], date: APPT_DATE,
      startTime: '09:00', endTime: '09:30', status: 'agendado',
    }),
    // Schema legado: só professionalId, sem professionalIds[].
    document('appt-legacy', {
      businessId: BUSINESS_ID, professionalId: 'prof-c', date: APPT_DATE,
      startTime: '11:00', endTime: '11:30', status: 'agendado',
    }),
    // Sem nenhum profissional atribuído.
    document('appt-missing-professional', {
      businessId: BUSINESS_ID, date: APPT_DATE,
      startTime: '12:00', endTime: '12:30', status: 'agendado',
    }),
    // Concluído sem completionAppliedAt — efeito órfão real.
    document('appt-completed-no-effect', {
      businessId: BUSINESS_ID, professionalIds: ['prof-d'], date: APPT_DATE,
      startTime: '13:00', endTime: '13:30', status: 'concluido',
    }),
    // Concluído COM completionAppliedAt — não deve ser flagueado.
    document('appt-completed-with-effect', {
      businessId: BUSINESS_ID, professionalIds: ['prof-d'], date: APPT_DATE,
      startTime: '14:00', endTime: '14:30', status: 'concluido',
      completionAppliedAt: NOW,
    }),
    // Turma com 3 reservas ativas pra capacidade 2 — colegas de turma NÃO
    // devem contar como sobreposição entre si (mesmo sessionKey).
    document('appt-group-1', {
      businessId: BUSINESS_ID, professionalIds: ['prof-f'], serviceId: 'svc-capacity',
      sessionKey: 'session-x', date: APPT_DATE, startTime: '15:00', endTime: '15:45', status: 'agendado',
    }),
    document('appt-group-2', {
      businessId: BUSINESS_ID, professionalIds: ['prof-f'], serviceId: 'svc-capacity',
      sessionKey: 'session-x', date: APPT_DATE, startTime: '15:00', endTime: '15:45', status: 'agendado',
    }),
    document('appt-group-3', {
      businessId: BUSINESS_ID, professionalIds: ['prof-f'], serviceId: 'svc-capacity',
      sessionKey: 'session-x', date: APPT_DATE, startTime: '15:00', endTime: '15:45', status: 'confirmado',
    }),
    // Referências financeiras/fiscais quebradas.
    document('appt-broken-refs', {
      businessId: BUSINESS_ID, professionalIds: ['prof-g'], date: APPT_DATE,
      startTime: '16:00', endTime: '16:30', status: 'concluido', completionAppliedAt: NOW,
      billingTransactionId: 'tx-missing',
      billingInstallmentGroupId: 'group-missing',
      fiscalDocumentId: 'fiscal-missing',
    }),
    // Data/horário inválidos — não deve derrubar a auditoria nem entrar nos
    // índices de sobreposição/expediente.
    document('appt-invalid-schedule', {
      businessId: BUSINESS_ID, professionalIds: ['prof-a'], date: 'not-a-date',
      startTime: '25:99', endTime: '26:00', status: 'agendado',
    }),
  );
  return input;
}

describe('M06.0 — auditoria read-only da Agenda', () => {
  it('caminho feliz: dataset mínimo não produz nenhuma issue', () => {
    const snapshot = buildM06AgendaSnapshot(cleanInput());

    expect(snapshot.issues).toEqual([]);
    expect(snapshot.summary).toEqual({
      appointments: 1,
      byStatus: { agendado: 1 },
      overlaps: 0,
      completionsWithoutEffect: 0,
      legacySchema: 0,
      withoutProfessional: 0,
      outsideWorkingHours: 0,
      sessionsOverCapacity: 0,
      brokenReferences: 0,
      issues: 0,
    });
  });

  it('detecta sobreposição real e ignora agendamento cancelado que colidiria', () => {
    const snapshot = buildM06AgendaSnapshot(messyInput());
    const overlapIssues = snapshot.issues.filter((issue) => issue.code === 'OVERLAP');

    expect(overlapIssues).toHaveLength(1);
    expect(overlapIssues[0].entityKey).toBe('appointment:appt-overlap-a|appointment:appt-overlap-b');
    expect(snapshot.summary.overlaps).toBe(1);
  });

  it('não conta colegas da mesma turma como sobreposição entre si', () => {
    const snapshot = buildM06AgendaSnapshot(messyInput());
    const groupOverlap = snapshot.issues.filter(
      (issue) => issue.code === 'OVERLAP' && issue.entityKey.includes('appt-group'),
    );
    expect(groupOverlap).toEqual([]);
  });

  it('detecta atendimento concluído sem efeito aplicado, mas não o que já tem completionAppliedAt', () => {
    const snapshot = buildM06AgendaSnapshot(messyInput());
    const codes = snapshot.issues
      .filter((issue) => issue.code === 'COMPLETION_WITHOUT_EFFECT')
      .map((issue) => issue.entityKey);

    expect(codes).toEqual(['appointment:appt-completed-no-effect']);
    expect(snapshot.summary.completionsWithoutEffect).toBe(1);
  });

  it('distingue schema legado (só professionalId) de ausência total de profissional', () => {
    const snapshot = buildM06AgendaSnapshot(messyInput());
    const legacy = snapshot.issues.filter((issue) => issue.code === 'LEGACY_PROFESSIONALS');
    const missing = snapshot.issues.filter((issue) => issue.code === 'MISSING_PROFESSIONAL');

    expect(legacy.map((i) => i.entityKey)).toEqual(['appointment:appt-legacy']);
    expect(missing.map((i) => i.entityKey)).toEqual(['appointment:appt-missing-professional']);
    expect(snapshot.summary.legacySchema).toBe(1);
    expect(snapshot.summary.withoutProfessional).toBe(1);
  });

  it('detecta agendamento fora do horário de trabalho do profissional', () => {
    const snapshot = buildM06AgendaSnapshot(messyInput());
    const codes = snapshot.issues
      .filter((issue) => issue.code === 'OUTSIDE_WORKING_HOURS')
      .map((issue) => issue.entityKey);

    expect(codes).toEqual(['appointment:appt-outside-hours']);
    expect(snapshot.summary.outsideWorkingHours).toBe(1);
  });

  it('detecta turma acima da capacidade declarada do serviço', () => {
    const snapshot = buildM06AgendaSnapshot(messyInput());
    const overCapacity = snapshot.issues.filter((issue) => issue.code === 'SESSION_OVER_CAPACITY');

    expect(overCapacity).toHaveLength(1);
    expect(overCapacity[0].entityKey).toBe('session:session-x');
    expect(overCapacity[0].message).toContain('3 reservas ativas para capacidade 2');
    expect(snapshot.summary.sessionsOverCapacity).toBe(1);
  });

  it('detecta referências financeiras e fiscais quebradas', () => {
    const snapshot = buildM06AgendaSnapshot(messyInput());
    const financial = snapshot.issues.filter((issue) => issue.code === 'MISSING_FINANCIAL_REFERENCE');
    const fiscal = snapshot.issues.filter((issue) => issue.code === 'MISSING_FISCAL_REFERENCE');

    // billingTransactionId E billingInstallmentGroupId quebrados no mesmo doc → 2 issues financeiras.
    expect(financial.filter((i) => i.entityKey === 'appointment:appt-broken-refs')).toHaveLength(2);
    expect(fiscal.map((i) => i.entityKey)).toEqual(['appointment:appt-broken-refs']);
    expect(snapshot.summary.brokenReferences).toBeGreaterThanOrEqual(3);
  });

  it('não derruba a auditoria com data/horário inválidos — reporta e segue', () => {
    const snapshot = buildM06AgendaSnapshot(messyInput());
    const invalid = snapshot.issues.filter((issue) => issue.code === 'INVALID_SCHEDULE');

    expect(invalid.map((i) => i.entityKey)).toEqual(['appointment:appt-invalid-schedule']);
    // Não deve ter contaminado sobreposição/expediente de prof-a.
    expect(snapshot.issues.some((i) => i.code === 'OUTSIDE_WORKING_HOURS' && i.entityKey.includes('appt-invalid-schedule'))).toBe(false);
  });

  it('exclui documento de outro tenant e denuncia o vazamento', () => {
    const input = cleanInput();
    input.appointments.push(document('appt-foreign', {
      businessId: 'biz-other', professionalIds: ['prof-x'], date: APPT_DATE,
      startTime: '17:00', endTime: '17:30', status: 'agendado',
    }));

    const snapshot = buildM06AgendaSnapshot(input);

    expect(snapshot.summary.appointments).toBe(1); // documento estranho não entra na contagem
    expect(snapshot.issues.some((issue) => issue.code === 'TENANT_MISMATCH')).toBe(true);
  });

  it('preserva snapshot idêntico mesmo com ordem de leitura diferente', () => {
    const before = buildM06AgendaSnapshot(cleanInput());
    const afterInput = cleanInput();
    afterInput.capturedAt = '2026-09-07T20:00:00.000Z';
    afterInput.transactions.reverse();
    const after = buildM06AgendaSnapshot(afterInput);

    expect(compareM06AgendaSnapshots(before, after)).toMatchObject({
      preserved: true,
      healthy: true,
      comparedEntries: 1,
      unchangedEntries: 1,
      differences: [],
      newIssues: [],
    });
  });

  it('expõe issue nova e resolvida sem esconder problema anterior', () => {
    const before = buildM06AgendaSnapshot(messyInput());
    const afterInput = messyInput();
    // Resolve o efeito órfão...
    afterInput.appointments = afterInput.appointments.map((doc) =>
      doc.id === 'appt-completed-no-effect' ? document(doc.id, { ...doc.data, completionAppliedAt: NOW }) : doc,
    );
    // ...e introduz uma sobreposição nova.
    afterInput.appointments.push(document('appt-new-overlap', {
      businessId: BUSINESS_ID, professionalIds: ['prof-a'], date: APPT_DATE,
      startTime: '09:10', endTime: '09:40', status: 'agendado',
    }));
    afterInput.capturedAt = '2026-09-07T21:00:00.000Z';
    const after = buildM06AgendaSnapshot(afterInput);

    const comparison = compareM06AgendaSnapshots(before, after);
    expect(comparison.preserved).toBe(false);
    expect(comparison.resolvedIssues.some((issue) => issue.code === 'COMPLETION_WITHOUT_EFFECT')).toBe(true);
    expect(comparison.newIssues.some((issue) => issue.code === 'OVERLAP')).toBe(true);
  });

  it('recusa comparação entre tenants diferentes', () => {
    const before = buildM06AgendaSnapshot(cleanInput());
    const otherInput = cleanInput();
    otherInput.businessId = 'biz-other';
    otherInput.appointments = [];
    otherInput.users = [];
    otherInput.transactions = [];
    const after = buildM06AgendaSnapshot(otherInput);

    expect(() => compareM06AgendaSnapshots(before, after)).toThrow(/businessId diferentes/);
  });
});
