/**
 * GET /api/integrations/mercadopago/callback
 *
 * Redirect de volta do OAuth do Mercado Pago. NÃO há header de auth aqui (é uma
 * navegação top-level do browser vinda do MP) — a confiança vem do `state`
 * assinado: HMAC válido + nonce de uso único persistido + janela ~10min.
 *
 * Fluxo: valida state → exchangeCodeForToken → saveMpAccount → HTML mínimo que
 * faz window.opener.postMessage({type:'mp_connected'}) e fecha o popup.
 */

import { NextRequest, NextResponse } from 'next/server';
import { MpCallbackQuerySchema } from '@/contracts/api/integrations/mercadopago';
import { exchangeCodeForToken, saveMpAccount } from '@/lib/services/mercadopago/auth';
import { verifyStateSignature, consumeOAuthNonce } from '../_oauthState';

function htmlResponse(body: string, status = 200): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function resultPage(opts: { ok: boolean; message: string }): NextResponse {
  const type = opts.ok ? 'mp_connected' : 'mp_error';
  const safeMessage = opts.message.replace(/</g, '&lt;').replace(/[`\\]/g, '');
  const page = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Mercado Pago</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0b0b0c;color:#e5e5e5}main{text-align:center;padding:24px}h1{font-size:18px;margin:0 0 8px}p{font-size:14px;color:#a3a3a3;margin:0}</style>
</head><body><main>
<h1>${opts.ok ? 'Conta conectada' : 'Falha ao conectar'}</h1>
<p>${safeMessage}</p>
</main>
<script>
(function(){
  try {
    if (window.opener) {
      window.opener.postMessage({ type: ${JSON.stringify(type)} }, '*');
      setTimeout(function(){ window.close(); }, 300);
    }
  } catch (e) { /* sem opener: mostra a mensagem de fallback acima */ }
})();
</script>
</body></html>`;
  return htmlResponse(page, opts.ok ? 200 : 400);
}

export async function GET(req: NextRequest) {
  // MP pode voltar com erro (usuário negou) — sem code/state válidos.
  const parsed = MpCallbackQuerySchema.safeParse({
    code: req.nextUrl.searchParams.get('code') ?? undefined,
    state: req.nextUrl.searchParams.get('state') ?? undefined,
  });
  if (!parsed.success) {
    return resultPage({ ok: false, message: 'Retorno inválido do Mercado Pago. Tente novamente.' });
  }

  const { code, state } = parsed.data;

  const decodedState = verifyStateSignature(state);
  if (!decodedState) {
    return resultPage({ ok: false, message: 'Estado de segurança inválido. Reinicie a conexão.' });
  }

  const nonceOk = await consumeOAuthNonce(decodedState.businessId, decodedState);
  if (!nonceOk) {
    return resultPage({ ok: false, message: 'Link de conexão expirado ou já usado. Reinicie a conexão.' });
  }

  const redirectUri = process.env.MP_REDIRECT_URI;
  if (!redirectUri) {
    console.error('[mp/callback] MP_REDIRECT_URI ausente');
    return resultPage({ ok: false, message: 'Integração Mercado Pago não configurada.' });
  }

  try {
    const tokenResp = await exchangeCodeForToken(code, redirectUri);
    await saveMpAccount(decodedState.businessId, tokenResp);
  } catch (err) {
    console.error('[mp/callback] troca/persistência falhou:', err instanceof Error ? err.message : err);
    return resultPage({ ok: false, message: 'Não foi possível concluir a conexão. Tente novamente.' });
  }

  return resultPage({ ok: true, message: 'Você já pode fechar esta janela.' });
}
