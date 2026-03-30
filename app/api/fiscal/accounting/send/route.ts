import { NextRequest, NextResponse } from 'next/server';

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

interface AccountingSendBody {
  businessId: string;
  businessName: string;
  businessCnpj: string;
  month: number;
  year: number;
  accountingEmail: string;
  notificationServerUrl: string;
  notificationServerKey: string;
  documents: {
    type: string;
    number?: number;
    series?: string;
    accessKey?: string;
    totalValue: number;
    issueDate: string;
    clientName?: string;
    xml?: string;
  }[];
}

export async function POST(request: NextRequest) {
  try {
    const body: AccountingSendBody = await request.json();

    // Validate required fields
    if (!body.accountingEmail) {
      return NextResponse.json({ error: 'Email do contador e obrigatorio.' }, { status: 400 });
    }
    if (!body.notificationServerUrl) {
      return NextResponse.json({ error: 'URL do servidor de notificacao nao configurada.' }, { status: 400 });
    }
    if (!body.notificationServerKey) {
      return NextResponse.json({ error: 'API key do servidor de notificacao nao configurada.' }, { status: 400 });
    }
    if (!body.month || body.month < 1 || body.month > 12) {
      return NextResponse.json({ error: 'Mes invalido.' }, { status: 400 });
    }
    if (!body.year || body.year < 2020 || body.year > 2099) {
      return NextResponse.json({ error: 'Ano invalido.' }, { status: 400 });
    }

    const docs = body.documents || [];
    const monthName = MONTH_NAMES[body.month - 1];
    const period = `${monthName} ${body.year}`;

    // Separate by type
    const nfes = docs.filter(d => d.type === 'nfe');
    const nfces = docs.filter(d => d.type === 'nfce');
    const nfses = docs.filter(d => d.type === 'nfse');

    const totalNfe = nfes.reduce((s, d) => s + (d.totalValue || 0), 0);
    const totalNfce = nfces.reduce((s, d) => s + (d.totalValue || 0), 0);
    const totalNfse = nfses.reduce((s, d) => s + (d.totalValue || 0), 0);
    const totalGeral = totalNfe + totalNfce + totalNfse;

    // Build SPED summary text
    const spedLines: string[] = [
      `|0000|LECD|${String(body.month).padStart(2, '0')}${body.year}|${body.businessCnpj?.replace(/\D/g, '') || ''}|${body.businessName || ''}|`,
      `|0001|0|`,
      `|0005|${body.businessName || ''}||||||||`,
      `|0990|4|`,
      `|I001|0|`,
      '',
      `=== RESUMO FISCAL - ${period.toUpperCase()} ===`,
      '',
      `NF-e emitidas: ${nfes.length} | Total: R$ ${totalNfe.toFixed(2)}`,
      `NFC-e emitidas: ${nfces.length} | Total: R$ ${totalNfce.toFixed(2)}`,
      `NFSe emitidas: ${nfses.length} | Total: R$ ${totalNfse.toFixed(2)}`,
      `TOTAL GERAL: R$ ${totalGeral.toFixed(2)}`,
      '',
      '--- DETALHAMENTO ---',
      '',
    ];

    for (const d of docs) {
      spedLines.push(
        `${d.type.toUpperCase()} #${d.number || '-'} | Serie: ${d.series || '-'} | Chave: ${d.accessKey || '-'} | Valor: R$ ${(d.totalValue || 0).toFixed(2)} | Data: ${d.issueDate || '-'} | Cliente: ${d.clientName || '-'}`
      );
    }

    spedLines.push('', `|9999|${spedLines.length + 2}|`, '');

    const spedContent = spedLines.join('\n');
    const spedFilename = `SPED_EFD_${body.year}${String(body.month).padStart(2, '0')}_${(body.businessCnpj || '').replace(/\D/g, '')}.txt`;

    // Build attachments array
    const attachments: { filename: string; contentBase64: string }[] = [
      {
        filename: spedFilename,
        contentBase64: Buffer.from(spedContent, 'utf-8').toString('base64'),
      },
    ];

    // Add XML attachments
    for (const d of docs) {
      if (d.xml) {
        const xmlFilename = `${d.type.toUpperCase()}_${String(d.number || 0).padStart(9, '0')}.xml`;
        attachments.push({
          filename: xmlFilename,
          contentBase64: Buffer.from(d.xml, 'utf-8').toString('base64'),
        });
      }
    }

    // Build email HTML
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #DC2626, #991B1B); padding: 24px; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 20px;">Documentos Fiscais - ${period}</h1>
          <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 14px;">${body.businessName || 'Empresa'}</p>
        </div>
        <div style="background: #f9fafb; padding: 24px; border: 1px solid #e5e7eb; border-top: none;">
          <h2 style="font-size: 16px; color: #374151; margin: 0 0 16px;">Resumo do Periodo</h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 8px 0; color: #6b7280;">NF-e</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">${nfes.length} documentos</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">R$ ${totalNfe.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 8px 0; color: #6b7280;">NFC-e</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">${nfces.length} documentos</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">R$ ${totalNfce.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 8px 0; color: #6b7280;">NFSe</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">${nfses.length} documentos</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">R$ ${totalNfse.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; font-weight: 700; font-size: 15px;">Total</td>
              <td style="padding: 12px 0; text-align: right; font-weight: 700; font-size: 15px;">${docs.length} documentos</td>
              <td style="padding: 12px 0; text-align: right; font-weight: 700; font-size: 15px; color: #DC2626;">R$ ${totalGeral.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
            </tr>
          </table>
          <div style="margin-top: 20px; padding: 12px; background: #dbeafe; border-radius: 8px; font-size: 13px; color: #1e40af;">
            <strong>Anexos:</strong> ${attachments.length} arquivo(s) - SPED EFD + XMLs dos documentos fiscais
          </div>
        </div>
        <div style="padding: 16px; text-align: center; font-size: 12px; color: #9ca3af;">
          Enviado automaticamente pelo ServicePro
        </div>
      </div>
    `;

    const textBody = `Documentos Fiscais - ${period}\n${body.businessName}\n\nNF-e: ${nfes.length} docs (R$ ${totalNfe.toFixed(2)})\nNFC-e: ${nfces.length} docs (R$ ${totalNfce.toFixed(2)})\nNFSe: ${nfses.length} docs (R$ ${totalNfse.toFixed(2)})\nTotal: ${docs.length} docs (R$ ${totalGeral.toFixed(2)})\n\nAnexos: ${attachments.length} arquivo(s)`;

    // Send email via notification server
    const emailPayload = {
      to: body.accountingEmail,
      subject: `Documentos Fiscais - ${period} - ${body.businessName || 'Empresa'}`,
      html: htmlBody,
      text: textBody,
      attachments,
      industrial: true,
    };

    const emailResponse = await fetch(`${body.notificationServerUrl}/api/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': body.notificationServerKey,
      },
      body: JSON.stringify(emailPayload),
    });

    if (!emailResponse.ok) {
      const errorData = await emailResponse.json().catch(() => ({}));
      return NextResponse.json(
        { error: 'Erro ao enviar email para contabilidade.', details: errorData },
        { status: emailResponse.status },
      );
    }

    return NextResponse.json({
      success: true,
      sent: true,
      to: body.accountingEmail,
      subject: emailPayload.subject,
      attachmentsCount: attachments.length,
      summary: {
        nfe: { count: nfes.length, total: totalNfe },
        nfce: { count: nfces.length, total: totalNfce },
        nfse: { count: nfses.length, total: totalNfse },
        total: { count: docs.length, total: totalGeral },
      },
    });
  } catch (error) {
    console.error('[Accounting Send] Erro:', error);
    return NextResponse.json(
      { error: 'Erro interno ao enviar documentos para contabilidade.', details: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 },
    );
  }
}
