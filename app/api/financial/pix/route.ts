/**
 * PIX QR Code generation — STUB (3.5)
 *
 * Ready to implement once a payment provider is configured (Asaas / Gerencianet / Pagar.me).
 *
 * When active, this route will:
 *  POST /api/financial/pix
 *  Body: { businessId, transactionId?, amount, description, expiresInHours }
 *  Response: { qrCode: string (base64 image), payload: string (copia-e-cola), txid: string }
 *
 * Provider integration steps:
 *  1. Open account at Asaas (asaas.com) or Gerencianet (gerencianet.com.br)
 *  2. Obtain API key (sandbox first, then production)
 *  3. Register your PIX key in the provider dashboard
 *  4. Store credentials in businesses/{id}.financial.pixConfig (encrypted)
 *  5. Replace the stub body below with actual provider call
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { businessId } = body as { businessId?: string };

  if (!businessId) {
    return NextResponse.json({ ok: false, error: 'businessId required' }, { status: 400 });
  }

  // TODO: load pixConfig from businesses/{businessId}.financial.pixConfig
  // TODO: call provider API to generate QR code
  // TODO: return { qrCode, payload, txid, expiresAt }

  return NextResponse.json(
    {
      ok: false,
      error: 'PIX não configurado. Configure um provedor de pagamento nas configurações.',
      code: 'PIX_NOT_CONFIGURED',
      setupRequired: true,
      supportedProviders: ['asaas', 'gerencianet', 'pagseguro', 'mercadopago'],
    },
    { status: 501 },
  );
}
