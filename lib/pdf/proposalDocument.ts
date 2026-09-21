/**
 * lib/pdf/proposalDocument.ts
 *
 * Modelo do PDF da proposta comercial (e da confirmação do negócio fechado): tudo já formatado em
 * texto pt-BR, sem depender de jsPDF nem do DOM — testável e reaproveitável por outro renderizador.
 * O desenho vive em `renderProposalPdf.ts`.
 *
 * Proposta ainda não fechada mostra vencimentos RELATIVOS ("30 dias após o fechamento"): a data real
 * só existe no faturamento. Negócio fechado mostra as datas de cada parcela.
 */

import type { Business } from '@/lib/types';
import { formatCNPJ, formatCurrency, formatPhone } from '@/lib/utils/format';
import type { InstallmentScheduleEntry } from '@/lib/utils/installments';
import { INSTALLMENT_INTERVAL_DAYS } from '@/lib/utils/installments';
import { formatDateOnly, toLocalDateString } from '@/lib/utils/localDate';
import { normalizeSearchText } from '@/lib/utils/vitrineCatalog';
import {
  centsToMoney,
  describePaymentTerms,
  lineTotalCents,
  type ProposalLine,
} from '@/lib/utils/vitrineProposal';

export type ProposalDocumentKind = 'proposal' | 'deal';

export interface LetterheadInput {
  name: string;
  document?: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface ProposalDocumentInput {
  kind: ProposalDocumentKind;
  business: LetterheadInput;
  client: { name: string; company?: string; phone?: string; email?: string };
  lines: ProposalLine[];
  subtotalCents: number;
  discountCents: number;
  discountReason?: string;
  totalCents: number;
  installments: number;
  schedule: InstallmentScheduleEntry[];
  issuedAt: Date;
  /** Só proposta: dias de validade a partir da emissão. */
  validityDays?: number;
  notes?: string;
  /** Só negócio fechado: últimos caracteres do id do pedido (igual à tela de Vendas). */
  orderNumber?: string;
}

export interface ProposalDocumentModel {
  title: string;
  reference: string[];
  business: { name: string; lines: string[] };
  client: { name: string; lines: string[] };
  items: Array<{ description: string; quantity: string; unitPrice: string; total: string }>;
  summary: Array<{ label: string; value: string; emphasis?: boolean }>;
  payment: { description: string; head: [string, string, string]; rows: string[][] };
  notes?: string;
  footer: string;
  fileName: string;
}

const MAX_NOTES_LENGTH = 600;

export function moneyText(cents: number): string {
  return formatCurrency(centsToMoney(cents)).replace(/[  ]/g, ' ');
}

/** "Rua X, 12 - Bairro - Cidade/UF" com o que existir. */
export function formatAddressLine(address: Partial<Business['endereco']> | undefined): string {
  if (!address) return '';
  const street = [address.logradouro, address.numero].filter(Boolean).join(', ');
  const place = [address.municipio, address.uf].filter(Boolean).join('/');
  return [street, address.bairro, place].filter(Boolean).join(' - ');
}

export function buildLetterhead(business: Partial<Pick<Business, 'nomeFantasia' | 'razaoSocial' | 'cnpj' | 'phone' | 'email' | 'endereco'>>): LetterheadInput {
  const digits = (business.cnpj ?? '').replace(/\D/g, '');
  return {
    name: business.nomeFantasia?.trim() || business.razaoSocial?.trim() || 'Empresa',
    ...(digits.length === 14 ? { document: `CNPJ ${formatCNPJ(digits)}` } : {}),
    ...(business.phone?.trim() ? { phone: formatPhone(business.phone) } : {}),
    ...(business.email?.trim() ? { email: business.email.trim() } : {}),
    ...(formatAddressLine(business.endereco) ? { address: formatAddressLine(business.endereco) } : {}),
  };
}

/** Fim do dia (fuso local) daqui a `days` dias, como AAAA-MM-DD. */
export function addDaysLocal(date: Date, days: number): string {
  return toLocalDateString(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

function slug(text: string): string {
  return normalizeSearchText(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'cliente';
}

function timingLabel(kind: ProposalDocumentKind, entry: InstallmentScheduleEntry, index: number): string {
  if (kind === 'deal') return formatDateOnly(entry.dueDate);
  return index === 0 ? 'No fechamento' : `${index * INSTALLMENT_INTERVAL_DAYS} dias após o fechamento`;
}

export function buildProposalDocument(input: ProposalDocumentInput): ProposalDocumentModel {
  const issued = toLocalDateString(input.issuedAt);
  const isDeal = input.kind === 'deal';

  const reference = isDeal
    ? [`Pedido #${input.orderNumber ?? '—'}`, `Fechado em ${formatDateOnly(issued)}`]
    : [
        `Emitida em ${formatDateOnly(issued)}`,
        ...(input.validityDays && input.validityDays > 0
          ? [`Válida até ${formatDateOnly(addDaysLocal(input.issuedAt, input.validityDays))}`]
          : []),
      ];

  const clientLines = [
    input.client.company,
    [input.client.phone, input.client.email].filter(Boolean).join(' · '),
  ].filter((line): line is string => Boolean(line && line.trim()));

  const summary: ProposalDocumentModel['summary'] = [];
  if (input.discountCents > 0) {
    summary.push({ label: 'Subtotal', value: moneyText(input.subtotalCents) });
    summary.push({
      label: input.discountReason ? `Desconto (${input.discountReason})` : 'Desconto',
      value: `- ${moneyText(input.discountCents)}`,
    });
  }
  summary.push({ label: 'Total', value: moneyText(input.totalCents), emphasis: true });

  const notes = input.notes?.trim().slice(0, MAX_NOTES_LENGTH);

  return {
    title: isDeal ? 'Confirmação de negócio' : 'Proposta comercial',
    reference,
    business: {
      name: input.business.name,
      lines: [input.business.document, input.business.address, [input.business.phone, input.business.email].filter(Boolean).join(' · ')]
        .filter((line): line is string => Boolean(line && line.trim())),
    },
    client: { name: input.client.name, lines: clientLines },
    items: input.lines.map((line) => ({
      description: line.variantName ? `${line.name} — ${line.variantName}` : line.name,
      quantity: String(line.quantity),
      unitPrice: moneyText(line.unitPriceCents),
      total: moneyText(lineTotalCents(line)),
    })),
    summary,
    payment: {
      description: describePaymentTerms(input.installments),
      head: [input.schedule.length > 1 ? 'Parcela' : 'Pagamento', 'Vencimento', 'Valor'],
      rows: input.schedule.map((entry, index) => [
        input.schedule.length > 1 ? `${entry.number}/${input.schedule.length}` : 'À vista',
        timingLabel(input.kind, entry, index),
        formatCurrency(entry.amount).replace(/[  ]/g, ' '),
      ]),
    },
    ...(notes ? { notes } : {}),
    footer: isDeal
      ? 'Documento gerado pelo sistema Aevo.'
      : 'Valores em reais (R$). Proposta gerada pelo sistema Aevo.',
    fileName: `${isDeal ? 'negocio' : 'proposta'}-${slug(input.client.name)}-${issued.replace(/-/g, '')}.pdf`,
  };
}
