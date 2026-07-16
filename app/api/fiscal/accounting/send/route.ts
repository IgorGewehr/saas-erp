/**
 * POST /api/fiscal/accounting/send
 *
 * Envia documentos fiscais (NFe/NFCe/NFSe) do mês selecionado para o email
 * do contador via notification-server.
 *
 * Arquitetura (alinhada à refatoração de broadcasts):
 *  - URL e API key do notification-server vêm de env vars globais:
 *    NOTIFICATION_SERVER_URL + NOTIFICATION_SERVER_API_KEY
 *  - SMTP per-business em `business.settings.notificationServer.smtp`
 *    (host/port/user/pass criptografada/from). Mesma config usada por
 *    /api/broadcasts/send (channel=email).
 *  - Auth: Firebase Bearer token + ownership do business.
 *
 * Body:
 *   { businessId, businessName, businessCnpj, month, year,
 *     accountingEmail, documents[] }
 *
 * Sem URL/key vindas do client (eram aceitas antes — falha de segurança).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { decryptToken } from '@/lib/utils/encryption';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { UserRole } from '@/lib/types';
import { AccountingSendRequestSchema } from '@/lib/contracts/api/fiscal/accounting-send';

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export async function POST(request: NextRequest) {
  // Rate limit defensivo: 5 envios/min por IP (operação cara — vários XMLs)
  const clientIp = getClientIp(request);
  const { allowed } = checkRateLimit(`fiscal-accounting:${clientIp}`, 5, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Aguarde antes de enviar novamente.' }, { status: 429 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const parsed = AccountingSendRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Payload inválido para envio à contabilidade.', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // Auth + ownership — sem isso, qualquer um chamando o endpoint conseguia
  // enviar emails arbitrários (a antiga versão do endpoint nem checava auth).
  // Admin+ porque despeja TODOS os XMLs do mês (dados fiscais sensíveis) num
  // email arbitrário escolhido pelo caller.
  const authResult = await verifyAuth(request, body.businessId);
  if (isAuthError(authResult)) return authResult;
  if (ROLE_HIERARCHY[authResult.role as UserRole] < ROLE_HIERARCHY['admin']) {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }

  // Configuração GLOBAL do notification-server (mesma para todos os tenants)
  const nsUrl = (process.env.NOTIFICATION_SERVER_URL || '').replace(/\/+$/, '');
  const nsApiKey = process.env.NOTIFICATION_SERVER_API_KEY || '';
  if (!nsUrl || !nsApiKey) {
    console.error('[Accounting Send] NOTIFICATION_SERVER_URL/API_KEY ausentes no .env');
    return NextResponse.json({
      error: 'Servidor de notificação não configurado no servidor (.env). Contate o administrador.',
    }, { status: 500 });
  }
  if (!/^https?:\/\//i.test(nsUrl)) {
    return NextResponse.json({
      error: 'NOTIFICATION_SERVER_URL inválida (precisa iniciar com http:// ou https://).',
    }, { status: 500 });
  }

  try {
    // SMTP per-business — obrigatório (cada cliente tem seu próprio remetente)
    const bizSnap = await adminDb.collection('businesses').doc(body.businessId).get();
    if (!bizSnap.exists) {
      return NextResponse.json({ error: 'Business não encontrado.' }, { status: 404 });
    }
    const bizData = bizSnap.data()!;
    const nsConfig = bizData?.settings?.notificationServer;
    if (!nsConfig?.isConfigured || !nsConfig?.smtp?.host || !nsConfig?.smtp?.user || !nsConfig?.smtp?.pass) {
      return NextResponse.json({
        error: 'SMTP do business não configurado. Acesse Configurações → Enterprise → SMTP de Email.',
      }, { status: 400 });
    }

    let smtpPass: string;
    try {
      smtpPass = await decryptToken(nsConfig.smtp.pass);
    } catch {
      return NextResponse.json({
        error: 'Erro ao descriptografar senha SMTP — refaça a configuração do business.',
      }, { status: 500 });
    }

    // Identificação da empresa vem do Firestore, NÃO do body — antes o caller
    // controlava businessName/businessCnpj e podia se passar por outra empresa
    // no email/SPED enviado ao contador.
    const businessName: string = bizData.razaoSocial || bizData.nomeFantasia || bizData.name || 'Empresa';
    const businessCnpj: string = String(bizData.cnpj || '').replace(/\D/g, '');

    const docs = body.documents || [];
    const monthName = MONTH_NAMES[body.month - 1];
    const period = `${monthName} ${body.year}`;

    // Separa por tipo
    const nfes = docs.filter(d => d.type === 'nfe');
    const nfces = docs.filter(d => d.type === 'nfce');
    const nfses = docs.filter(d => d.type === 'nfse');

    const totalNfe = nfes.reduce((s, d) => s + (d.totalValue || 0), 0);
    const totalNfce = nfces.reduce((s, d) => s + (d.totalValue || 0), 0);
    const totalNfse = nfses.reduce((s, d) => s + (d.totalValue || 0), 0);
    const totalGeral = totalNfe + totalNfce + totalNfse;

    // SPED summary
    const spedLines: string[] = [
      `|0000|LECD|${String(body.month).padStart(2, '0')}${body.year}|${businessCnpj}|${businessName}|`,
      `|0001|0|`,
      `|0005|${businessName}||||||||`,
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
        `${d.type.toUpperCase()} #${d.number || '-'} | Serie: ${d.series || '-'} | Chave: ${d.accessKey || '-'} | Valor: R$ ${(d.totalValue || 0).toFixed(2)} | Data: ${d.issueDate || '-'} | Cliente: ${d.clientName || '-'}`,
      );
    }

    spedLines.push('', `|9999|${spedLines.length + 2}|`, '');

    const spedContent = spedLines.join('\n');
    const spedFilename = `SPED_EFD_${body.year}${String(body.month).padStart(2, '0')}_${businessCnpj}.txt`;

    // Anexos: SPED + XMLs
    const attachments: { filename: string; contentBase64: string }[] = [
      {
        filename: spedFilename,
        contentBase64: Buffer.from(spedContent, 'utf-8').toString('base64'),
      },
    ];
    for (const d of docs) {
      if (d.xml) {
        const xmlFilename = `${d.type.toUpperCase()}_${String(d.number || 0).padStart(9, '0')}.xml`;
        attachments.push({
          filename: xmlFilename,
          contentBase64: Buffer.from(d.xml, 'utf-8').toString('base64'),
        });
      }
    }

    // HTML do email
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #DC2626, #991B1B); padding: 24px; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 20px;">Documentos Fiscais - ${period}</h1>
          <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 14px;">${businessName}</p>
        </div>
        <div style="background: #f9fafb; padding: 24px; border: 1px solid #e5e7eb; border-top: none;">
          <h2 style="font-size: 16px; color: #374151; margin: 0 0 16px;">Resumo do Período</h2>
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
          Enviado automaticamente pelo Aevo
        </div>
      </div>
    `;

    const textBody = `Documentos Fiscais - ${period}\n${businessName}\n\nNF-e: ${nfes.length} docs (R$ ${totalNfe.toFixed(2)})\nNFC-e: ${nfces.length} docs (R$ ${totalNfce.toFixed(2)})\nNFSe: ${nfses.length} docs (R$ ${totalNfse.toFixed(2)})\nTotal: ${docs.length} docs (R$ ${totalGeral.toFixed(2)})\n\nAnexos: ${attachments.length} arquivo(s)`;

    // Envia via notification-server — formato alinhado ao endpoint atual:
    // { appId, email, subject, message, html, attachments, smtp }
    const emailResponse = await fetch(`${nsUrl}/api/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': nsApiKey,
      },
      body: JSON.stringify({
        appId: body.businessId,
        email: body.accountingEmail,
        subject: `Documentos Fiscais - ${period} - ${businessName}`,
        message: textBody,
        html: htmlBody,
        attachments,
        // SMTP do business — NS prioriza esse sobre Firestore/env globais
        smtp: {
          host: nsConfig.smtp.host,
          port: nsConfig.smtp.port,
          secure: !!nsConfig.smtp.secure,
          user: nsConfig.smtp.user,
          pass: smtpPass,
          from: nsConfig.smtp.from || nsConfig.smtp.user,
        },
      }),
    });

    if (!emailResponse.ok) {
      const errorData = await emailResponse.json().catch(() => ({}));
      console.error('[Accounting Send] NS retornou erro:', emailResponse.status, errorData);
      return NextResponse.json(
        { error: errorData.error || 'Erro ao enviar email para contabilidade.', details: errorData },
        { status: emailResponse.status },
      );
    }

    const responseData = await emailResponse.json().catch(() => ({}));
    return NextResponse.json({
      success: true,
      sent: true,
      to: body.accountingEmail,
      subject: `Documentos Fiscais - ${period} - ${body.businessName || 'Empresa'}`,
      attachmentsCount: attachments.length,
      jobId: responseData.jobId, // útil pra rastrear bounces
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
