/**
 * lib/pdf/renderProposalPdf.ts
 *
 * Desenha o `ProposalDocumentModel` em PDF A4 (jsPDF + autoTable, importados sob demanda pra não
 * pesar o bundle da Vitrine). Só navegador. Tudo que chega aqui já está formatado; o desenho passa
 * o texto por `toPdfText` porque as fontes padrão do PDF só cobrem Latin-1.
 */

import type { ProposalDocumentModel } from './proposalDocument';
import { toPdfText } from './pdfText';

export interface RenderProposalPdfOptions {
  /** PNG/JPEG em data URL. Ausente ou inválido = timbre só com o nome da empresa. */
  logoDataUrl?: string | null;
}

type Rgb = [number, number, number];

const MARGIN = 15;
const BOTTOM_LIMIT = 22;
const BRAND: Rgb = [220, 38, 38];
const TEXT: Rgb = [30, 30, 30];
const MUTED: Rgb = [110, 110, 110];
const RULE: Rgb = [225, 225, 225];

interface DocWithAutoTable {
  lastAutoTable?: { finalY: number };
}

export async function renderProposalPdf(
  model: ProposalDocumentModel,
  options: RenderProposalPdfOptions = {},
): Promise<Blob> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const right = pageWidth - MARGIN;
  const contentWidth = pageWidth - MARGIN * 2;
  const t = toPdfText;
  let y = MARGIN;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - BOTTOM_LIMIT) {
      doc.addPage();
      y = MARGIN;
    }
  };
  const rule = () => {
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, right, y);
  };
  const finalY = () => (doc as unknown as DocWithAutoTable).lastAutoTable?.finalY ?? y;
  /** Quebra o texto na largura dada (com a fonte/tamanho já definidos). */
  const wrap = (text: string, width: number): string[] => doc.splitTextToSize(t(text), width) as string[];
  /** Cabeçalho segue o alinhamento da coluna (o autoTable só aplica `columnStyles` ao corpo). */
  const alignHead = (columns: Record<number, 'left' | 'center' | 'right'>) => (data: { section: string; column: { index: number }; cell: { styles: { halign: string } } }) => {
    const align = columns[data.column.index];
    if (data.section === 'head' && align) data.cell.styles.halign = align;
  };

  // ── Timbre ────────────────────────────────────────────────────────────────
  let textX = MARGIN;
  if (options.logoDataUrl) {
    try {
      const props = doc.getImageProperties(options.logoDataUrl);
      const scale = Math.min(38 / props.width, 18 / props.height);
      const width = props.width * scale;
      const height = props.height * scale;
      doc.addImage(options.logoDataUrl, props.fileType, MARGIN, y, width, height);
      textX = MARGIN + width + 5;
    } catch {
      // Logo inválido: segue sem ele.
    }
  }

  // Bloco da direita primeiro (largura real), depois o da esquerda ocupa o que sobrar.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  const titleWidth = doc.getTextWidth(t(model.title));
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const referenceWidth = Math.max(0, ...model.reference.map((line) => doc.getTextWidth(t(line))));
  const rightBlockLeft = right - Math.max(titleWidth, referenceWidth);
  const leftWidth = Math.max(50, rightBlockLeft - textX - 6);

  let leftY = y + 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...TEXT);
  for (const line of wrap(model.business.name, leftWidth)) {
    doc.text(line, textX, leftY);
    leftY += 6;
  }
  leftY -= 1;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  for (const entry of model.business.lines) {
    for (const line of wrap(entry, leftWidth)) {
      doc.text(line, textX, leftY);
      leftY += 4;
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...BRAND);
  doc.text(t(model.title), right, y + 5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  let rightY = y + 11;
  for (const line of model.reference) {
    doc.text(t(line), right, rightY, { align: 'right' });
    rightY += 4.5;
  }

  y = Math.max(y + 20, leftY, rightY) + 3;
  rule();
  y += 7;

  // ── Cliente ───────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text('CLIENTE', MARGIN, y);
  y += 5.5;
  doc.setFontSize(12);
  doc.setTextColor(...TEXT);
  for (const line of wrap(model.client.name, contentWidth)) {
    doc.text(line, MARGIN, y);
    y += 5.5;
  }
  y -= 1;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  for (const entry of model.client.lines) {
    for (const line of wrap(entry, contentWidth)) {
      doc.text(line, MARGIN, y);
      y += 4.5;
    }
  }
  y += 4;

  // ── Itens ─────────────────────────────────────────────────────────────────
  autoTable(doc, {
    startY: y,
    head: [['Item', 'Qtd', 'Valor unit.', 'Total']],
    body: model.items.map((item) => [t(item.description), item.quantity, item.unitPrice, item.total]),
    theme: 'striped',
    margin: { left: MARGIN, right: MARGIN, bottom: BOTTOM_LIMIT },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold', fontSize: 9 },
    styles: { fontSize: 9.5, cellPadding: 2.5, textColor: TEXT },
    columnStyles: {
      1: { halign: 'center', cellWidth: 16 },
      2: { halign: 'right', cellWidth: 34 },
      3: { halign: 'right', cellWidth: 34 },
    },
    didParseCell: alignHead({ 1: 'center', 2: 'right', 3: 'right' }),
  });
  y = finalY() + 7;

  // ── Resumo (alinhado à direita) ───────────────────────────────────────────
  const summaryLeft = right - 85;
  for (const row of model.summary) {
    doc.setFont('helvetica', row.emphasis ? 'bold' : 'normal');
    doc.setFontSize(row.emphasis ? 12.5 : 10);
    const valueWidth = doc.getTextWidth(t(row.value));
    const labelLines = wrap(row.label, 85 - valueWidth - 6);
    const rowHeight = labelLines.length * 4.8 + (row.emphasis ? 4 : 1.4);

    ensureSpace(rowHeight + 2);
    if (row.emphasis) {
      doc.setDrawColor(...RULE);
      doc.line(summaryLeft, y - 4.5, right, y - 4.5);
    }
    doc.setTextColor(...(row.emphasis ? BRAND : TEXT));
    labelLines.forEach((line, index) => doc.text(line, summaryLeft, y + index * 4.8));
    doc.text(t(row.value), right, y, { align: 'right' });
    y += rowHeight;
  }
  y += 4;

  // ── Pagamento ─────────────────────────────────────────────────────────────
  ensureSpace(30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...TEXT);
  doc.text('Condições de pagamento', MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(t(model.payment.description), right, y, { align: 'right' });
  y += 3;
  autoTable(doc, {
    startY: y,
    head: [model.payment.head.map(t)],
    body: model.payment.rows.map((row) => row.map(t)),
    theme: 'grid',
    margin: { left: MARGIN, right: MARGIN, bottom: BOTTOM_LIMIT },
    headStyles: { fillColor: [245, 245, 245], textColor: TEXT, fontStyle: 'bold', fontSize: 9 },
    styles: { fontSize: 9.5, cellPadding: 2.2, textColor: TEXT, lineColor: RULE },
    columnStyles: { 2: { halign: 'right' } },
    didParseCell: alignHead({ 2: 'right' }),
  });
  y = finalY() + 8;

  // ── Observações ───────────────────────────────────────────────────────────
  if (model.notes) {
    const noteLines = doc.splitTextToSize(t(model.notes), contentWidth) as string[];
    ensureSpace(10 + noteLines.length * 4.6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...TEXT);
    doc.text('Observações', MARGIN, y);
    y += 5.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...MUTED);
    noteLines.forEach((line) => {
      doc.text(line, MARGIN, y);
      y += 4.6;
    });
  }

  // ── Rodapé em todas as páginas ────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setDrawColor(...RULE);
    doc.line(MARGIN, pageHeight - 14, right, pageHeight - 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(t(model.footer), MARGIN, pageHeight - 9);
    doc.text(`Página ${page} de ${pageCount}`, right, pageHeight - 9, { align: 'right' });
  }

  return doc.output('blob');
}
