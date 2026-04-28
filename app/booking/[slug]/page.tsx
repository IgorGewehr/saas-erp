'use client';

/**
 * Public booking page — /booking/[slug]
 *
 * No Firebase Auth required. The visitor types messages and the AI agent
 * handles service info, availability checks and appointment booking.
 *
 * History is kept in component state (session only).
 * sessionId is stored in localStorage for continuity across refreshes.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

interface BusinessInfo {
  id: string;
  slug: string;
  nomeFantasia: string;
  phone: string;
  email: string;
  logo: string | null;
  aiAgentEnabled: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return 'ssr';
  const key = 'booking_session_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function BookingPage() {
  const params = useParams();
  const slug = Array.isArray(params.slug) ? params.slug[0] : (params.slug as string);

  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId] = useState<string>(() => getOrCreateSessionId());

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Load business info ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!slug) return;
    fetch(`/api/booking/info?slug=${encodeURIComponent(slug)}`)
      .then(r => r.json())
      .then(data => {
        if (!data.ok) { setLoadError('Página de agendamento não encontrada.'); return; }
        setBusiness(data.data.business);
        // Greet the visitor
        const greeting = data.data.business.aiAgentEnabled
          ? `Olá! Sou o assistente virtual de **${data.data.business.nomeFantasia}**. Como posso te ajudar hoje? Posso verificar disponibilidade e fazer agendamentos para você. 😊`
          : `Olá! Bem-vindo(a) a **${data.data.business.nomeFantasia}**. Para agendar, entre em contato pelo telefone **${data.data.business.phone}**.`;
        setMessages([{ role: 'assistant', content: greeting, ts: Date.now() }]);
      })
      .catch(() => setLoadError('Erro ao carregar. Tente novamente.'));
  }, [slug]);

  // ── Scroll to bottom on new messages ───────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Send message ────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || !business) return;

    const userMsg: Message = { role: 'user', content: text, ts: Date.now() };
    const updatedHistory = [...messages, userMsg];

    setMessages(updatedHistory);
    setInput('');
    setSending(true);

    // Build history for agent (last 10 turns, excluding the greeting)
    const historyForAgent = updatedHistory
      .slice(-11, -1) // up to 10 previous messages, not the one we just added
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch('/api/booking/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          message: text,
          sessionId,
          history: historyForAgent,
        }),
      });
      const data = await res.json() as { ok: boolean; response?: string; error?: string };
      const reply = data.ok
        ? (data.response ?? 'Não entendi, pode repetir?')
        : 'Desculpe, ocorreu um erro. Tente novamente em instantes.';
      setMessages(prev => [...prev, { role: 'assistant', content: reply, ts: Date.now() }]);
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Sem conexão. Verifique sua internet e tente novamente.', ts: Date.now() },
      ]);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, sending, business, messages, slug, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Render: error state ─────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">😕</div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">Página não encontrada</h1>
          <p className="text-gray-500 text-sm">{loadError}</p>
        </div>
      </div>
    );
  }

  // ── Render: loading ─────────────────────────────────────────────────────────
  if (!business) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-400">Carregando...</p>
        </div>
      </div>
    );
  }

  // ── Render: chat ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50 to-white flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur-sm border-b border-gray-100 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          {business.logo ? (
            <img src={business.logo} alt={business.nomeFantasia} className="w-10 h-10 rounded-xl object-contain border border-gray-100" />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-red-600 flex items-center justify-center text-white font-bold text-lg select-none">
              {business.nomeFantasia.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-gray-900 truncate">{business.nomeFantasia}</h1>
            <p className="text-xs text-green-600 font-medium flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
              Assistente online
            </p>
          </div>
          {business.phone && (
            <a
              href={`tel:${business.phone}`}
              className="text-xs text-gray-500 hover:text-red-600 transition-colors"
              title="Ligar"
            >
              📞 {business.phone}
            </a>
          )}
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-red-600 flex items-center justify-center text-white text-xs font-bold mr-2 mt-0.5 flex-shrink-0 self-end">
                  {business.nomeFantasia.charAt(0).toUpperCase()}
                </div>
              )}
              <div className={`max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                <div
                  className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-red-600 text-white rounded-br-sm'
                      : 'bg-white text-gray-800 shadow-sm border border-gray-100 rounded-bl-sm'
                  }`}
                >
                  {/* Render **bold** markdown */}
                  {msg.content.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
                    part.startsWith('**') && part.endsWith('**')
                      ? <strong key={j}>{part.slice(2, -2)}</strong>
                      : <span key={j}>{part}</span>
                  )}
                </div>
                <span className="text-[10px] text-gray-400 px-1">{formatTime(msg.ts)}</span>
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {sending && (
            <div className="flex justify-start items-end gap-2">
              <div className="w-7 h-7 rounded-full bg-red-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {business.nomeFantasia.charAt(0).toUpperCase()}
              </div>
              <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-bl-sm px-4 py-3">
                <div className="flex gap-1 items-center h-4">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </main>

      {/* Input */}
      <footer className="sticky bottom-0 bg-white/90 backdrop-blur-sm border-t border-gray-100 px-4 py-3">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-end gap-2 bg-gray-50 border border-gray-200 rounded-2xl px-3 py-2 focus-within:border-red-400 focus-within:ring-1 focus-within:ring-red-400 transition-all">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digite sua mensagem..."
              rows={1}
              className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 resize-none outline-none max-h-32 leading-relaxed py-1"
              style={{ scrollbarWidth: 'none' }}
              disabled={sending}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || sending}
              className="w-8 h-8 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-200 disabled:cursor-not-allowed flex items-center justify-center transition-colors flex-shrink-0 mb-0.5"
              aria-label="Enviar"
            >
              <svg className="w-4 h-4 text-white disabled:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
              </svg>
            </button>
          </div>
          <p className="text-[10px] text-center text-gray-300 mt-1.5">
            Agendamento por IA • {business.nomeFantasia}
          </p>
        </div>
      </footer>
    </div>
  );
}
