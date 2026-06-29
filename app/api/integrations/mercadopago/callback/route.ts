/**
 * GET /api/integrations/mercadopago/callback
 *
 * Redirect de volta do OAuth do Mercado Pago. NÃO há header de auth aqui (é uma
 * navegação top-level do browser vinda do MP) — a confiança vem do `state`
 * assinado: HMAC válido + nonce de uso único persistido + janela ~10min.
 *
 * Fluxo: valida state → exchangeCodeForToken → saveMpAccount → HTML mínimo que
 * faz window.opener.postMessage({type:'mp_connected'}) e fecha o popup.
 *
 * Fallback (M10): se o OAuth abriu na MESMA aba (popup bloqueado) ou o opener
 * sumiu, não há janela pra fechar — o dono ficaria preso nesta página. Por isso
 * a página sempre renderiza um botão "Voltar ao painel" e, no sucesso sem
 * opener, redireciona sozinha pra `returnTo` (default `/app`).
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

/**
 * Sanitiza `returnTo` pra um caminho interno (evita open redirect): só aceita
 * path absoluto-relativo (`/algo`) e nunca `//` (que viraria URL externa).
 */
function safeReturnTo(raw: string | undefined): string {
  const fallback = '/app';
  if (!raw) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  return raw;
}

function resultPage(opts: { ok: boolean; message: string; returnTo?: string }): NextResponse {
  const type = opts.ok ? 'mp_connected' : 'mp_error';
  const safeMessage = opts.message.replace(/</g, '&lt;').replace(/[`\\]/g, '');
  const target = safeReturnTo(opts.returnTo);
  const page = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Mercado Pago</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0b0b0c;color:#e5e5e5}main{text-align:center;padding:24px}h1{font-size:18px;margin:0 0 8px}p{font-size:14px;color:#a3a3a3;margin:0}a.btn{display:none;margin-top:20px;padding:10px 18px;border-radius:12px;background:#2563eb;color:#fff;font-size:14px;font-weight:600;text-decoration:none}</style>
</head><body><main>
<h1>${opts.ok ? 'Conta conectada' : 'Falha ao conectar'}</h1>
<p>${safeMessage}</p>
<a id="back" class="btn" href="${target}">Voltar ao painel</a>
</main>
<script>
(function(){
  var hasOpener = false;
  try { hasOpener = !!window.opener; } catch (e) { hasOpener = false; }
  if (hasOpener) {
    try {
      window.opener.postMessage({ type: ${JSON.stringify(type)} }, '*');
      setTimeout(function(){ window.close(); }, 300);
      return;
    } catch (e) { /* cai no fallback abaixo */ }
  }
  // Sem opener (popup bloqueado / mesma aba): o usuário ficaria preso aqui.
  // Mostra o botão de retorno e, no sucesso, redireciona sozinho.
  var back = document.getElementById('back');
  if (back) back.style.display = 'inline-block';
  if (${opts.ok ? 'true' : 'false'}) {
    setTimeout(function(){ window.location.replace(${JSON.stringify(target)}); }, 2500);
  }
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
