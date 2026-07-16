'use client';

/**
 * Financial Export Utilities
 * CSV via papaparse (zero-dependency string gen) — runs in browser only.
 * PDF via jspdf + jspdf-autotable — dynamically imported to avoid SSR issues.
 */

import type { Transaction } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils/format';

// ─── helpers ─────────────────────────────────────────────────────────────────

const fmtR = (v: number) => v.toFixed(2).replace('.', ',');

function triggerDownload(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// Plain decimal number (with optional minus sign and `,`/`.` decimal separator).
// e.g. "1392,00" / "-1392,00" / "1234.56" — NOT a formula, must not be escaped as text.
const PLAIN_NUMBER_RE = /^-?\d+([.,]\d+)?$/;

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  // OWASP formula-injection guard: prefix dangerous lead chars with `'` so
  // spreadsheets treat the cell as text. Skip for plain numbers (negatives
  // included) and bare placeholders ("-" / "—") — those aren't formulas, and
  // prefixing them breaks numeric parsing in Excel/Sheets.
  const isHarmless = s === '-' || s === '—' || PLAIN_NUMBER_RE.test(s);
  if (!isHarmless && /^[=+\-@\t\r]/.test(s)) {
    return `"'${s.replace(/"/g, '""')}"`;
  }
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(cells: unknown[]): string {
  return cells.map(csvEscape).join(',');
}

const BOM = '﻿'; // UTF-8 BOM so Excel opens with correct encoding

const STATUS_LABEL: Record<string, string> = {
  pago: 'Pago',
  pendente: 'Pendente',
  atrasado: 'Atrasado',
  cancelado: 'Cancelado',
};

const TYPE_LABEL: Record<string, string> = {
  receita: 'Receita',
  despesa: 'Despesa',
};

// ─── 1. TRANSACTIONS CSV ─────────────────────────────────────────────────────

export function exportTransactionsCSV(
  transactions: Transaction[],
  filename = `lancamentos_${new Date().toISOString().slice(0, 10)}.csv`,
) {
  const header = row([
    'Data Vencimento',
    'Data Pagamento',
    'Tipo',
    'Descrição',
    'Categoria',
    'Valor (R$)',
    'Status',
    'Forma Pagamento',
    'Conta Bancária',
    'Cliente',
    'Setor',
    'Observações',
  ]);

  const lines = transactions.map(t =>
    row([
      formatDate(t.dueDate),
      formatDate(t.paymentDate),
      TYPE_LABEL[t.type] ?? t.type,
      t.description,
      t.category ?? '',
      t.amount.toFixed(2).replace('.', ','),
      STATUS_LABEL[t.status] ?? t.status,
      t.paymentMethod ?? '',
      t.bankAccountId ?? '',
      t.clientName ?? '',
      t.sectorId ?? '',
      t.notes ?? '',
    ]),
  );

  triggerDownload([BOM, header, ...lines].join('\n'), filename, 'text/csv;charset=utf-8;');
}

// ─── 2. TRANSACTIONS PDF ─────────────────────────────────────────────────────

export async function exportTransactionsPDF(
  transactions: Transaction[],
  businessName: string,
  period: string,
  filename = `extrato_${new Date().toISOString().slice(0, 10)}.pdf`,
) {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc = new jsPDF({ orientation: 'landscape' });

  // Header
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(businessName, 14, 16);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`Extrato de Lançamentos — ${period}`, 14, 23);
  doc.setFontSize(8);
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, 14, 29);

  const totReceitas = transactions.filter(t => t.type === 'receita' && t.status === 'pago').reduce((s, t) => s + t.amount, 0);
  const totDespesas = transactions.filter(t => t.type === 'despesa' && t.status === 'pago').reduce((s, t) => s + t.amount, 0);

  autoTable(doc, {
    startY: 35,
    head: [['Vencimento', 'Pagamento', 'Tipo', 'Descrição', 'Categoria', 'Valor', 'Status']],
    body: transactions.map(t => [
      formatDate(t.dueDate),
      formatDate(t.paymentDate),
      TYPE_LABEL[t.type] ?? t.type,
      t.description,
      t.category ?? '—',
      (t.type === 'receita' ? '+' : '-') + formatCurrency(t.amount),
      STATUS_LABEL[t.status] ?? t.status,
    ]),
    foot: [[
      '', '', '', `Total: ${transactions.length} lançamentos`,
      '',
      `Receitas: ${formatCurrency(totReceitas)}  |  Despesas: ${formatCurrency(totDespesas)}  |  Resultado: ${formatCurrency(totReceitas - totDespesas)}`,
      '',
    ]],
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [240, 240, 240], fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 22 },
      2: { cellWidth: 18 },
      3: { cellWidth: 70 },
      4: { cellWidth: 32 },
      5: { cellWidth: 32, halign: 'right' },
      6: { cellWidth: 20 },
    },
    alternateRowStyles: { fillColor: [250, 250, 250] },
  });

  triggerBlobDownload(doc.output('blob'), filename);
}

// ─── DRE data shape (mirrors DREContent's computed `dre`) ────────────────────

export interface DREData {
  receitaBruta: number;
  receitaByCategory: Map<string, number>;
  totalDeducoes: number;
  deducaoByCategory: Map<string, number>;
  receitaLiquida: number;
  totalCPV: number;
  cpvByCategory: Map<string, number>;
  lucroBruto: number;
  totalOpex: number;
  opexByCategory: Map<string, number>;
  resultadoOperacional: number;
  receitaFinanceira: number;
  despesaFinanceira: number;
  resultadoFinanceiro: number;
  resultadoLiquido: number;
  margemBruta: number;
  margemLiquida: number;
}

// ─── 3. DRE CSV ──────────────────────────────────────────────────────────────

export function exportDRECSV(
  dre: DREData,
  period: string,
  businessName: string,
  filename = `dre_${period.replace(/\//g, '-')}.csv`,
) {
  const lines: string[] = [
    BOM,
    row([businessName]),
    row([`DRE — ${period}`]),
    row([`Gerado em ${new Date().toLocaleString('pt-BR')}`]),
    '',
    row(['Conta', 'Valor (R$)']),
    row(['RECEITA BRUTA', fmtR(dre.receitaBruta)]),
    ...[...dre.receitaByCategory.entries()].map(([k, v]) => row([`  ${k}`, fmtR(v)])),
    row(['(-) DEDUÇÕES', fmtR(-dre.totalDeducoes)]),
    ...[...dre.deducaoByCategory.entries()].map(([k, v]) => row([`  ${k}`, fmtR(-v)])),
    row(['(=) RECEITA LÍQUIDA', fmtR(dre.receitaLiquida)]),
    row(['(-) CPV/CSV', fmtR(-dre.totalCPV)]),
    ...[...dre.cpvByCategory.entries()].map(([k, v]) => row([`  ${k}`, fmtR(-v)])),
    row(['(=) LUCRO BRUTO', fmtR(dre.lucroBruto)]),
    row([`  Margem Bruta`, `${dre.margemBruta.toFixed(1).replace('.', ',')}%`]),
    row(['(-) DESPESAS OPERACIONAIS', fmtR(-dre.totalOpex)]),
    ...[...dre.opexByCategory.entries()].map(([k, v]) => row([`  ${k}`, fmtR(-v)])),
    row(['(=) RESULTADO OPERACIONAL', fmtR(dre.resultadoOperacional)]),
    row(['(+/-) RESULTADO FINANCEIRO', fmtR(dre.resultadoFinanceiro)]),
    row(['(=) RESULTADO LÍQUIDO', fmtR(dre.resultadoLiquido)]),
    row([`  Margem Líquida`, `${dre.margemLiquida.toFixed(1).replace('.', ',')}%`]),
  ];

  triggerDownload(lines.join('\n'), filename, 'text/csv;charset=utf-8;');
}

// ─── 4. DRE PDF ──────────────────────────────────────────────────────────────

export async function exportDREPDF(
  dre: DREData,
  period: string,
  businessName: string,
  filename = `dre_${period.replace(/\//g, '-')}.pdf`,
) {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(businessName, 14, 16);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(`Demonstrativo de Resultado — ${period}`, 14, 24);
  doc.setFontSize(8);
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, 14, 30);

  const green: [number, number, number] = [16, 185, 129];
  const red: [number, number, number] = [220, 38, 38];
  const gray: [number, number, number] = [100, 116, 139];

  interface DRESectionRow {
    label: string;
    value: number;
    bold: boolean;
    color?: [number, number, number];
  }

  const sections: DRESectionRow[] = [
    { label: 'Receita Bruta', value: dre.receitaBruta, bold: true },
    ...[...dre.receitaByCategory.entries()].map(([k, v]) => ({ label: `  ${k}`, value: v, bold: false, color: gray } as DRESectionRow)),
    { label: '(-) Deduções', value: -dre.totalDeducoes, bold: false, color: red },
    ...[...dre.deducaoByCategory.entries()].map(([k, v]) => ({ label: `  ${k}`, value: -v, bold: false, color: gray } as DRESectionRow)),
    { label: '(=) Receita Líquida', value: dre.receitaLiquida, bold: true },
    { label: '(-) CPV / CSV', value: -dre.totalCPV, bold: false, color: red },
    ...[...dre.cpvByCategory.entries()].map(([k, v]) => ({ label: `  ${k}`, value: -v, bold: false, color: gray } as DRESectionRow)),
    { label: '(=) Lucro Bruto', value: dre.lucroBruto, bold: true, color: dre.lucroBruto >= 0 ? green : red },
    { label: '(-) Despesas Operacionais', value: -dre.totalOpex, bold: false, color: red },
    ...[...dre.opexByCategory.entries()].map(([k, v]) => ({ label: `  ${k}`, value: -v, bold: false, color: gray } as DRESectionRow)),
    { label: '(=) Resultado Operacional', value: dre.resultadoOperacional, bold: true, color: dre.resultadoOperacional >= 0 ? green : red },
    { label: '(+/-) Resultado Financeiro', value: dre.resultadoFinanceiro, bold: false },
    { label: '(=) Resultado Líquido', value: dre.resultadoLiquido, bold: true, color: dre.resultadoLiquido >= 0 ? green : red },
  ];

  autoTable(doc, {
    startY: 36,
    head: [['Conta', 'Valor']],
    body: sections.map(({ label, value }) => {
      return [label, formatCurrency(Math.abs(value)) + (value < 0 ? ' (saída)' : '')];
    }),
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 120 },
      1: { cellWidth: 50, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const { bold, color } = sections[data.row.index];
        if (bold) data.cell.styles.fontStyle = 'bold';
        if (color) data.cell.styles.textColor = color;
      }
    },
    alternateRowStyles: { fillColor: [250, 250, 250] },
  });

  // Summary box at bottom
  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? 200;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(`Margem Bruta: ${dre.margemBruta.toFixed(1)}%`, 14, finalY + 10);
  doc.text(`Margem Líquida: ${dre.margemLiquida.toFixed(1)}%`, 80, finalY + 10);

  triggerBlobDownload(doc.output('blob'), filename);
}

// ─── 5. CASH FLOW CSV (TYPES) ────────────────────────────────────────────────

export interface CashFlowRow {
  date: string;
  receitas: number;
  despesas: number;
  saldo: number;
  acumulado: number;
}

// ─── 6. CASH FLOW CSV ────────────────────────────────────────────────────────

export function exportCashFlowCSV(
  data: CashFlowRow[],
  horizon: number,
  businessName: string,
  unit: 'dias' | 'semanas' = 'dias',
  filename = `fluxo_caixa_${new Date().toISOString().slice(0, 10)}.csv`,
) {
  const lines: string[] = [
    BOM,
    row([businessName]),
    row([`Projeção de Fluxo de Caixa — ${unit === 'semanas' ? 'próximas' : 'próximos'} ${horizon} ${unit}`]),
    row([`Gerado em ${new Date().toLocaleString('pt-BR')}`]),
    '',
    row(['Data', 'Entradas (R$)', 'Saídas (R$)', 'Saldo do Dia (R$)', 'Saldo Acumulado (R$)']),
    ...data.map(d => row([
      formatDate(d.date),
      fmtR(d.receitas),
      fmtR(d.despesas),
      fmtR(d.saldo),
      fmtR(d.acumulado),
    ])),
    '',
    row(['TOTAL', fmtR(data.reduce((s, d) => s + d.receitas, 0)), fmtR(data.reduce((s, d) => s + d.despesas, 0)), '', '']),
  ];

  triggerDownload(lines.join('\n'), filename, 'text/csv;charset=utf-8;');
}

// ─── 7. COMMISSIONS CSV ───────────────────────────────────────────────────────

export interface CommissionRow {
  professionalName: string;
  description: string;
  date: string;
  amount: number;
  status: string;
  notes?: string;
}

export function exportCommissionsCSV(
  rows: CommissionRow[],
  period: string,
  businessName: string,
  filename = `comissoes_${new Date().toISOString().slice(0, 10)}.csv`,
) {
  const statusLabel: Record<string, string> = { pendente: 'Pendente', pago: 'Pago', cancelado: 'Cancelado', atrasado: 'Atrasado' };
  const lines: string[] = [
    BOM,
    row([businessName]),
    row([`Folha de Comissões — ${period}`]),
    row([`Gerado em ${new Date().toLocaleString('pt-BR')}`]),
    '',
    row(['Profissional', 'Descrição', 'Data', 'Valor (R$)', 'Status', 'Observações']),
    ...rows.map(r => row([
      r.professionalName,
      r.description,
      formatDate(r.date),
      fmtR(r.amount),
      statusLabel[r.status] ?? r.status,
      r.notes ?? '',
    ])),
    '',
    row(['TOTAL PENDENTE', fmtR(rows.filter(r => r.status === 'pendente').reduce((s, r) => s + r.amount, 0))]),
    row(['TOTAL PAGO',     fmtR(rows.filter(r => r.status === 'pago').reduce((s, r) => s + r.amount, 0))]),
  ];
  triggerDownload(lines.join('\n'), filename, 'text/csv;charset=utf-8;');
}

// ─── 8. RECURRING TRANSACTIONS CSV ───────────────────────────────────────────

export function exportRecurrencesCSV(
  transactions: Transaction[],
  businessName: string,
  filename = `recorrentes_${new Date().toISOString().slice(0, 10)}.csv`,
) {
  const FREQ_LABEL: Record<string, string> = {
    weekly: 'Semanal', biweekly: 'Quinzenal', biweekly_fixed: 'Quinzenal (dias fixos)',
    monthly: 'Mensal', quarterly: 'Trimestral', semiannual: 'Semestral', yearly: 'Anual',
  };
  const recs = transactions.filter(t => t.recurrence != null);
  const lines: string[] = [
    BOM,
    row([businessName]),
    row(['Recorrências — Relatório']),
    row([`Gerado em ${new Date().toLocaleString('pt-BR')}`]),
    '',
    row(['Nome', 'Tipo', 'Status', 'Frequência', 'Valor (R$)', 'Próximo Vencimento', 'Data Encerramento', 'Total Pago (R$)', 'Nº Ocorrências Pagas']),
    ...recs.map(t => {
      const rec = t.recurrence!;
      const totalPago = (rec.history ?? []).reduce((s, e) => s + e.amount, 0);
      return row([
        rec.label || t.description,
        t.type === 'receita' ? 'Receita' : 'Despesa',
        rec.isActive ? 'Ativa' : 'Pausada',
        FREQ_LABEL[rec.frequency] ?? rec.frequency,
        fmtR(t.amount),
        formatDate(rec.nextDueDate),
        rec.endDate ? formatDate(rec.endDate) : '',
        fmtR(totalPago),
        rec.history?.length ?? 0,
      ]);
    }),
    '',
    row(['TOTAL REGISTROS', recs.length]),
    row(['ATIVAS', recs.filter(t => t.recurrence!.isActive).length]),
    row(['PAUSADAS', recs.filter(t => !t.recurrence!.isActive).length]),
  ];
  triggerDownload(lines.join('\n'), filename, 'text/csv;charset=utf-8;');
}

// ─── 9. SUBSCRIPTIONS / MRR (financial-v2 Relatórios) ────────────────────────
// Shape local (não importa tipos de `financial-v2/`) — `lib/utils` é infra
// compartilhada, não deve depender de uma feature; quem chama mapeia
// `SubscriptionTableRow` (financial-v2/read-models/assinaturas) pra este shape.

export interface SubscriptionExportRow {
  serviceName: string;
  clientLabel: string;
  monthlyValue: number;
  cycleLabel: string;
  nextBillingLabel?: string;
  statusLabel: string;
}

export interface SubscriptionExportSummary {
  mrr: number;
  arr: number;
  churnMonthValue: number;
}

export function exportSubscriptionsCSV(
  rows: SubscriptionExportRow[],
  summary: SubscriptionExportSummary,
  period: string,
  businessName: string,
  filename = `assinaturas_mrr_${period.replace(/\//g, '-')}.csv`,
) {
  const lines: string[] = [
    BOM,
    row([businessName]),
    row([`Assinaturas / MRR — ${period}`]),
    row([`Gerado em ${new Date().toLocaleString('pt-BR')}`]),
    '',
    row(['MRR (R$)', fmtR(summary.mrr)]),
    row(['ARR estimado (R$)', fmtR(summary.arr)]),
    row(['Churn do mês (R$)', fmtR(summary.churnMonthValue)]),
    '',
    row(['Serviço', 'Cliente', 'Valor/mês (R$)', 'Ciclo', 'Próx. cobrança', 'Status']),
    ...rows.map(r => row([
      r.serviceName,
      r.clientLabel,
      fmtR(r.monthlyValue),
      r.cycleLabel,
      r.nextBillingLabel ? formatDate(r.nextBillingLabel) : '—',
      r.statusLabel,
    ])),
  ];
  triggerDownload(lines.join('\n'), filename, 'text/csv;charset=utf-8;');
}

export async function exportSubscriptionsPDF(
  rows: SubscriptionExportRow[],
  summary: SubscriptionExportSummary,
  period: string,
  businessName: string,
  filename = `assinaturas_mrr_${period.replace(/\//g, '-')}.pdf`,
) {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(businessName, 14, 16);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(`Assinaturas / MRR — ${period}`, 14, 24);
  doc.setFontSize(8);
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, 14, 30);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(`MRR: ${formatCurrency(summary.mrr)}`, 14, 40);
  doc.text(`ARR estimado: ${formatCurrency(summary.arr)}`, 80, 40);
  doc.text(`Churn do mês: ${formatCurrency(summary.churnMonthValue)}`, 146, 40);

  autoTable(doc, {
    startY: 46,
    head: [['Serviço', 'Cliente', 'Valor/mês', 'Ciclo', 'Próx. cobrança', 'Status']],
    body: rows.map(r => [
      r.serviceName,
      r.clientLabel,
      formatCurrency(r.monthlyValue),
      r.cycleLabel,
      r.nextBillingLabel ? formatDate(r.nextBillingLabel) : '—',
      r.statusLabel,
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 250, 250] },
  });

  triggerBlobDownload(doc.output('blob'), filename);
}
