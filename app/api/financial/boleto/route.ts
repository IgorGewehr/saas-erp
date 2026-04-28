/**
 * Boleto bancário generation — STUB (3.6)
 *
 * Ready to implement once a payment provider is configured (Asaas / Gerencianet / Iugu).
 *
 * When active, this route will:
 *  POST /api/financial/boleto
 *  Body: { businessId, transactionId, clientId, amount, dueDate, description }
 *  Response: { boletoUrl: string, barCode: string, digitableLine: string, boletoId: string }
 *
 * Provider integration steps:
 *  1. Open account at Asaas (asaas.com) — also handles PIX, unified provider recommended
 *  2. Complete PJ registration + CNPJ validation (takes 1-3 business days)
 *  3. Register as cedente (boleto issuer)
 *  4. Store credentials in businesses/{id}.financial.boletoConfig (encrypted)
 *  5. Replace the stub body below with actual provider call
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { businessId } = body as { businessId?: string };

  if (!businessId) {
    return NextResponse.json({ ok: false, error: 'businessId required' }, { status: 400 });
  }

  // TODO: load boletoConfig from businesses/{businessId}.financial.boletoConfig
  // TODO: call provider API to generate boleto
  // TODO: return { boletoUrl, barCode, digitableLine, boletoId, expiresAt }

  return NextResponse.json(
    {
      ok: false,
      error: 'Boleto não configurado. Configure um provedor de pagamento nas configurações.',
      code: 'BOLETO_NOT_CONFIGURED',
      setupRequired: true,
      supportedProviders: ['asaas', 'gerencianet', 'iugu', 'pagseguro'],
    },
    { status: 501 },
  );
}
