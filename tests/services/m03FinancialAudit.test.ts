import { describe, expect, it } from 'vitest';
import {
  buildM03FinancialSnapshot,
  compareM03FinancialSnapshots,
  type M03FinancialAuditInput,
  type M03AuditDocument,
} from '@/lib/services/m03-financial-audit';

const BUSINESS_ID = 'biz-m03';
const NOW = '2026-09-07T18:00:00.000Z';

function document(id: string, data: Record<string, unknown>): M03AuditDocument {
  return { id, data };
}

/** Dataset mínimo, sem nenhuma issue — base para o teste de "caminho feliz". */
function cleanInput(): M03FinancialAuditInput {
  return {
    businessId: BUSINESS_ID,
    capturedAt: NOW,
    sales: [document('sale-good', { businessId: BUSINESS_ID })],
    purchaseNotes: [],
    appointments: [],
    deliveryOrders: [],
    transactions: [
      document('tx-good', {
        businessId: BUSINESS_ID,
        type: 'receita',
        status: 'pago',
        amount: 100,
        saleId: 'sale-good',
      }),
    ],
  };
}

/** Estende o dataset limpo com um exemplo de CADA lacuna do diagnóstico M03.0. */
function messyInput(): M03FinancialAuditInput {
  const input = cleanInput();

  input.transactions.push(
    document('tx-bad-type', { businessId: BUSINESS_ID, type: 'lucro', status: 'pago', amount: 10 }),
    document('tx-bad-status', { businessId: BUSINESS_ID, type: 'despesa', status: 'quitado', amount: 10 }),
    document('tx-zero-amount', { businessId: BUSINESS_ID, type: 'despesa', status: 'pendente', amount: 0 }),
    document('tx-negative-amount', { businessId: BUSINESS_ID, type: 'despesa', status: 'pendente', amount: -50 }),
    // Parcelamento: installmentTotal diz 3, só 2 parcelas existem de fato.
    document('tx-installment-1', {
      businessId: BUSINESS_ID, type: 'receita', status: 'pago', amount: 50,
      installmentGroupId: 'grp-1', installmentTotal: 3,
    }),
    document('tx-installment-2', {
      businessId: BUSINESS_ID, type: 'receita', status: 'pendente', amount: 50,
      installmentGroupId: 'grp-1', installmentTotal: 3,
    }),
    // Recorrência órfã: recurrenceId não aponta pra nenhuma transação real.
    document('tx-orphan-recurrence', {
      businessId: BUSINESS_ID, type: 'despesa', status: 'pendente', amount: 30,
      recurrenceId: 'tx-nao-existe',
    }),
    // Referência de origem quebrada: appointmentId de um atendimento que não existe.
    document('tx-broken-ref', {
      businessId: BUSINESS_ID, type: 'receita', status: 'pago', amount: 40,
      appointmentId: 'appt-nao-existe',
    }),
    // Duplicidade: 2 transações ATIVAS com a mesma origem (sale-good) + tipo.
    document('tx-dup-1', { businessId: BUSINESS_ID, type: 'receita', status: 'pago', amount: 20, saleId: 'sale-good' }),
    document('tx-dup-2', { businessId: BUSINESS_ID, type: 'receita', status: 'pendente', amount: 20, saleId: 'sale-good' }),
    // Mesma origem+tipo, mas CANCELADA — não deve contar como duplicidade.
    document('tx-dup-cancelled', { businessId: BUSINESS_ID, type: 'receita', status: 'cancelado', amount: 20, saleId: 'sale-good' }),
    // Outro tenant — deve virar TENANT_MISMATCH, nunca entrar no snapshot.
    document('tx-other-tenant', { businessId: 'outro-biz', type: 'receita', status: 'pago', amount: 10 }),
  );

  return input;
}

describe('buildM03FinancialSnapshot', () => {
  it('dataset limpo não produz nenhuma issue', () => {
    const snapshot = buildM03FinancialSnapshot(cleanInput());
    expect(snapshot.issues).toEqual([]);
    expect(snapshot.summary.transactions).toBe(1);
    expect(snapshot.summary.issues).toBe(0);
  });

  it('exige businessId', () => {
    expect(() => buildM03FinancialSnapshot({ ...cleanInput(), businessId: '' })).toThrow(/businessId/);
  });

  it('rejeita capturedAt inválido', () => {
    expect(() => buildM03FinancialSnapshot({ ...cleanInput(), capturedAt: 'não-é-data' })).toThrow(/capturedAt/);
  });

  it('detecta TENANT_MISMATCH e não inclui o doc de outro tenant no snapshot', () => {
    const snapshot = buildM03FinancialSnapshot(messyInput());
    const issue = snapshot.issues.find((i) => i.code === 'TENANT_MISMATCH');
    expect(issue).toBeDefined();
    expect(snapshot.entries.some((e) => e.transactionId === 'tx-other-tenant')).toBe(false);
  });

  it('detecta INVALID_TYPE', () => {
    const snapshot = buildM03FinancialSnapshot(messyInput());
    expect(snapshot.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_TYPE', entityKey: 'transaction:tx-bad-type' }));
    expect(snapshot.summary.invalidType).toBe(1);
  });

  it('detecta INVALID_STATUS', () => {
    const snapshot = buildM03FinancialSnapshot(messyInput());
    expect(snapshot.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_STATUS', entityKey: 'transaction:tx-bad-status' }));
    expect(snapshot.summary.invalidStatus).toBe(1);
  });

  it('detecta NON_POSITIVE_AMOUNT pra valor zero e negativo', () => {
    const snapshot = buildM03FinancialSnapshot(messyInput());
    const flagged = snapshot.issues.filter((i) => i.code === 'NON_POSITIVE_AMOUNT').map((i) => i.entityKey);
    expect(flagged).toContain('transaction:tx-zero-amount');
    expect(flagged).toContain('transaction:tx-negative-amount');
    expect(snapshot.summary.nonPositiveAmount).toBe(2);
  });

  it('detecta INSTALLMENT_COUNT_MISMATCH quando a contagem real diverge do installmentTotal', () => {
    const snapshot = buildM03FinancialSnapshot(messyInput());
    expect(snapshot.issues).toContainEqual(expect.objectContaining({
      code: 'INSTALLMENT_COUNT_MISMATCH',
      entityKey: 'installmentGroup:grp-1',
    }));
    expect(snapshot.summary.installmentMismatches).toBe(1);
  });

  it('detecta ORPHAN_RECURRENCE quando recurrenceId não existe', () => {
    const snapshot = buildM03FinancialSnapshot(messyInput());
    expect(snapshot.issues).toContainEqual(expect.objectContaining({ code: 'ORPHAN_RECURRENCE', entityKey: 'transaction:tx-orphan-recurrence' }));
    expect(snapshot.summary.orphanRecurrences).toBe(1);
  });

  it('detecta BROKEN_SOURCE_REFERENCE quando appointmentId não existe', () => {
    const snapshot = buildM03FinancialSnapshot(messyInput());
    expect(snapshot.issues).toContainEqual(expect.objectContaining({ code: 'BROKEN_SOURCE_REFERENCE', entityKey: 'transaction:tx-broken-ref' }));
    expect(snapshot.summary.brokenReferences).toBe(1);
  });

  it('detecta DUPLICATE_SOURCE_TRANSACTION só entre transações ATIVAS da mesma origem+tipo', () => {
    const snapshot = buildM03FinancialSnapshot(messyInput());
    const dup = snapshot.issues.find((i) => i.code === 'DUPLICATE_SOURCE_TRANSACTION');
    expect(dup).toBeDefined();
    // messyInput() estende cleanInput() — tx-good (já ativa, saleId=sale-good) MAIS
    // tx-dup-1/tx-dup-2 formam um grupo de 3 transações ativas pra mesma origem+tipo.
    expect(dup!.entityKey).toContain('tx-good');
    expect(dup!.entityKey).toContain('tx-dup-1');
    expect(dup!.entityKey).toContain('tx-dup-2');
    // tx-dup-cancelled compartilha a mesma origem+tipo mas está cancelada — não
    // libera... ao contrário, cancelada É o status que EXCLUI da contagem de duplicidade.
    expect(dup!.entityKey).not.toContain('tx-dup-cancelled');
    expect(snapshot.summary.duplicateSourceTransactions).toBe(1);
  });

  it('não sinaliza duplicidade quando só existe UMA transação ativa pra mesma origem+tipo (caminho feliz)', () => {
    const snapshot = buildM03FinancialSnapshot(cleanInput());
    expect(snapshot.issues.filter((i) => i.code === 'DUPLICATE_SOURCE_TRANSACTION')).toHaveLength(0);
  });
});

describe('compareM03FinancialSnapshots', () => {
  it('marca preserved=true e healthy=true quando nada mudou e não há issues', () => {
    const before = buildM03FinancialSnapshot(cleanInput());
    const after = buildM03FinancialSnapshot(cleanInput());
    const comparison = compareM03FinancialSnapshots(before, after);
    expect(comparison.preserved).toBe(true);
    expect(comparison.healthy).toBe(true);
    expect(comparison.differences).toEqual([]);
  });

  it('detecta issue nova entre dois snapshots', () => {
    const before = buildM03FinancialSnapshot(cleanInput());
    const after = buildM03FinancialSnapshot(messyInput());
    const comparison = compareM03FinancialSnapshots(before, after);
    expect(comparison.healthy).toBe(false);
    expect(comparison.newIssues.length).toBeGreaterThan(0);
    expect(comparison.resolvedIssues).toEqual([]);
  });

  it('detecta issue resolvida entre dois snapshots', () => {
    const before = buildM03FinancialSnapshot(messyInput());
    const after = buildM03FinancialSnapshot(cleanInput());
    const comparison = compareM03FinancialSnapshots(before, after);
    expect(comparison.resolvedIssues.length).toBeGreaterThan(0);
    expect(comparison.healthy).toBe(true);
  });

  it('rejeita comparação entre snapshots de businessId diferentes', () => {
    const before = buildM03FinancialSnapshot(cleanInput());
    const after = buildM03FinancialSnapshot({ ...cleanInput(), businessId: 'outro-biz' });
    expect(() => compareM03FinancialSnapshots(before, after)).toThrow(/businessId diferentes/);
  });
});
