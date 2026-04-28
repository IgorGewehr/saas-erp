/**
 * Open Banking / automatic bank statement import — STUB (3.8)
 *
 * Ready to implement once Pluggy or Belvo is configured.
 *
 * When active, this route will:
 *  GET  /api/financial/open-banking?businessId=X  → list connected banks + sync status
 *  POST /api/financial/open-banking               → trigger sync for a connected bank
 *  Response: { entries: BankStatementEntry[], lastSyncAt: string }
 *
 * Provider integration steps:
 *  1. Sign up at Pluggy (pluggy.ai) — Brazilian Open Finance aggregator
 *  2. Create application, obtain clientId + clientSecret
 *  3. Use Pluggy Connect Widget (iframe) to let user authenticate their bank
 *  4. Store itemId (connection ID) per bank account in businesses/{id}.financial.openBankingConfig
 *  5. Fetch transactions via GET /items/{itemId}/transactions
 *  6. Auto-feed into reconciliation flow
 *
 * Alternative: Belvo (belvo.com) — similar API, also covers MX/CO
 * Note: Requires CNPJ registration and contract with provider.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get('businessId');

  if (!businessId) {
    return NextResponse.json({ ok: false, error: 'businessId required' }, { status: 400 });
  }

  return NextResponse.json(
    {
      ok: false,
      error: 'Open Banking não configurado. Configure o Pluggy ou Belvo nas integrações.',
      code: 'OPEN_BANKING_NOT_CONFIGURED',
      setupRequired: true,
      supportedProviders: ['pluggy', 'belvo', 'quanto'],
    },
    { status: 501 },
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { businessId } = body as { businessId?: string };

  if (!businessId) {
    return NextResponse.json({ ok: false, error: 'businessId required' }, { status: 400 });
  }

  // TODO: load openBankingConfig from businesses/{businessId}.financial.openBankingConfig
  // TODO: call Pluggy/Belvo API to fetch latest transactions
  // TODO: convert to BankStatementEntry[] format
  // TODO: auto-run autoMatch and save to bankStatementImports

  return NextResponse.json(
    {
      ok: false,
      error: 'Open Banking não configurado.',
      code: 'OPEN_BANKING_NOT_CONFIGURED',
      setupRequired: true,
    },
    { status: 501 },
  );
}
