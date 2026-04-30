'use client';

/**
 * /unsubscribe?token=xxx — página pública de descadastro de marketing.
 *
 * Fluxo:
 *  1. Mount: GET /api/unsubscribe?token=xxx → valida token e retorna preview
 *     (channel + identifier mascarado). Sem grava ainda.
 *  2. Usuário clica "Confirmar descadastro" → POST grava opt-out
 *  3. Estado de sucesso ou erro
 *
 * Sem deps de Auth/Firebase — funciona em browsers de qualquer pessoa que
 * tenha recebido o link no email. Estilo standalone (não usa o shell do app).
 */

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Phase = 'loading' | 'preview' | 'submitting' | 'done' | 'error';

export default function UnsubscribePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gray-50"><p className="text-sm text-gray-500">Carregando…</p></div>}>
      <UnsubscribeContent />
    </Suspense>
  );
}

function UnsubscribeContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [phase, setPhase] = useState<Phase>('loading');
  const [identifier, setIdentifier] = useState<string>('');
  const [channel, setChannel] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (!token) {
      setPhase('error');
      setErrorMsg('Link inválido. Token ausente.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/unsubscribe?token=${encodeURIComponent(token)}`, {
          method: 'GET',
          cache: 'no-store',
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.valid) {
          setPhase('error');
          setErrorMsg(data.error || 'Link inválido ou expirado.');
          return;
        }
        setIdentifier(data.identifierPreview || '');
        setChannel(data.channel || '');
        setPhase('preview');
      } catch (err) {
        if (cancelled) return;
        setPhase('error');
        setErrorMsg('Erro ao validar link. Tente recarregar a página.');
        console.error('[unsubscribe] validate error', err);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const handleConfirm = async () => {
    setPhase('submitting');
    try {
      const res = await fetch(`/api/unsubscribe?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok) {
        setPhase('error');
        setErrorMsg(data.error || 'Erro ao processar descadastro.');
        return;
      }
      setPhase('done');
    } catch (err) {
      setPhase('error');
      setErrorMsg('Erro de rede. Tente novamente.');
      console.error('[unsubscribe] submit error', err);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10 font-sans">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2 font-display">
          Cancelar inscrição
        </h1>

        {phase === 'loading' && (
          <p className="text-sm text-gray-500 mt-4">Validando link…</p>
        )}

        {phase === 'preview' && (
          <>
            <p className="text-sm text-gray-600 mt-2 leading-relaxed">
              Você está prestes a se descadastrar de comunicações de marketing
              {channel === 'email' ? ' por email' : channel === 'whatsapp' ? ' por WhatsApp' : ''}
              {identifier ? ` enviadas para ${identifier}` : ''}.
            </p>
            <p className="text-sm text-gray-500 mt-3 leading-relaxed">
              Após confirmar, você não receberá mais campanhas neste canal.
              Comunicações transacionais (pedidos, faturas) podem continuar
              quando aplicável.
            </p>
            <button
              onClick={handleConfirm}
              className="mt-6 w-full px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition-colors"
            >
              Confirmar descadastro
            </button>
          </>
        )}

        {phase === 'submitting' && (
          <p className="text-sm text-gray-500 mt-4">Processando…</p>
        )}

        {phase === 'done' && (
          <div className="mt-4">
            <div className="flex items-center gap-2 text-emerald-700 font-semibold mb-3">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100">✓</span>
              Descadastrado com sucesso
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">
              Sua solicitação foi registrada. Você não receberá mais campanhas
              neste canal a partir de agora. Pode levar alguns minutos para
              propagar em campanhas em andamento.
            </p>
          </div>
        )}

        {phase === 'error' && (
          <div className="mt-4">
            <div className="flex items-center gap-2 text-red-700 font-semibold mb-3">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100">!</span>
              Não foi possível processar
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">
              {errorMsg || 'Erro desconhecido.'}
            </p>
            <p className="text-xs text-gray-400 mt-4">
              Se o problema persistir, entre em contato com o remetente da
              mensagem.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
