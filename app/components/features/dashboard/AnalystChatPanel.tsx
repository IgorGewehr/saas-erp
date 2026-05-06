'use client';

/**
 * AI Analyst chat panel — data-focused conversational interface.
 *
 * Uses the same agent API as OperatorChatPanel but with mode='analyst',
 * which instructs the agent to focus on queries, insights, and reports
 * rather than task execution.
 *
 * Examples:
 *   - "Quem são meus top 10 clientes por faturamento?"
 *   - "Qual serviço dá mais lucro?"
 *   - "Quantos no-shows tive este mês?"
 *   - "Compare receita deste mês com o anterior"
 *   - "Qual dia da semana tem mais agendamentos?"
 */

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { getAuth } from 'firebase/auth';
import {
  BarChart3, Send, Loader2, ChevronDown, ChevronUp,
  TrendingUp, Users, DollarSign, Calendar, X, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Role = 'user' | 'assistant';

interface ChatMessage {
  role: Role;
  content: string;
  runId?: string;
  toolCalls?: Array<{ name: string; args?: unknown; error?: string }>;
  costUsd?: number;
  durationMs?: number;
  timestamp: number;
}

const SUGGESTED_PROMPTS = [
  { icon: TrendingUp, text: 'Resumo de vendas da semana' },
  { icon: Users, text: 'Top 10 clientes por faturamento' },
  { icon: DollarSign, text: 'Qual serviço dá mais receita?' },
  { icon: Calendar, text: 'Taxa de no-show deste mês' },
];

export default function AnalystChatPanel() {
  const { user } = useAuth();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [sessionId] = useState<string>(() => `analyst_${user?.uid || 'anon'}_${Date.now()}`);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Dashboard AI (analista) sempre disponível — `aiAgent.enabled` controla só
  // o agente autônomo de atendimento ao cliente. Ver AgentHeroInput pro contexto.

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || isLoading || !user) return;

    const userMsg: ChatMessage = { role: 'user', content: message, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const token = await getAuth().currentUser?.getIdToken();
      if (!token) throw new Error('Autenticação expirada');

      const history = messages.slice(-12).map(m => ({ role: m.role, content: m.content }));

      const res = await fetch('/api/agent/operator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message, history, sessionId, mode: 'analyst' }),
      });

      let data;
      try { data = await res.json(); } catch { throw new Error('Resposta inválida do servidor'); }
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.response || '(sem resposta)',
        runId: data.runId,
        toolCalls: data.toolCalls || [],
        costUsd: data.costUsd,
        durationMs: data.durationMs,
        timestamp: Date.now(),
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Erro: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800/60 overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <BarChart3 size={16} className="text-white" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI Analyst</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Pergunte sobre seus dados</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10 px-2 py-0.5 rounded-full">
            Beta
          </span>
          {isOpen ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-gray-100 dark:border-gray-700/50">
              {/* Messages */}
              <div ref={scrollRef} className="h-72 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 && !isLoading && (
                  <div className="text-center py-6">
                    <Sparkles className="w-8 h-8 mx-auto text-violet-300 dark:text-violet-600 mb-2" />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                      Faça perguntas sobre vendas, clientes, finanças e agendamentos
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {SUGGESTED_PROMPTS.map((p, i) => (
                        <button
                          key={i}
                          onClick={() => send(p.text)}
                          className="flex items-center gap-2 px-3 py-2 text-xs text-left text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-violet-300 dark:hover:border-violet-500/40 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
                        >
                          <p.icon size={12} className="shrink-0" />
                          <span className="line-clamp-2">{p.text}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((m, i) => (
                  <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap',
                      m.role === 'user'
                        ? 'bg-violet-600 text-white rounded-br-md'
                        : 'bg-gray-100 dark:bg-gray-700/50 text-gray-800 dark:text-gray-200 rounded-bl-md'
                    )}>
                      {m.content}

                      {/* Tool calls detail */}
                      {m.toolCalls && m.toolCalls.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-white/20 dark:border-gray-600/30">
                          <button
                            onClick={() => setExpandedRunId(expandedRunId === m.runId ? null : m.runId || null)}
                            className="text-[10px] opacity-70 hover:opacity-100 flex items-center gap-1"
                          >
                            {m.toolCalls.length} tools
                            {m.durationMs && ` · ${(m.durationMs / 1000).toFixed(1)}s`}
                            {expandedRunId === m.runId ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                          </button>
                          {expandedRunId === m.runId && (
                            <div className="mt-1 space-y-0.5">
                              {m.toolCalls.map((tc, j) => (
                                <p key={j} className="text-[10px] opacity-60 font-mono truncate">
                                  {tc.error ? '✗' : '✓'} {tc.name}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {isLoading && (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 dark:bg-gray-700/50 rounded-2xl rounded-bl-md px-4 py-3">
                      <Loader2 size={16} className="animate-spin text-violet-500" />
                    </div>
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="p-3 border-t border-gray-100 dark:border-gray-700/50">
                <form
                  onSubmit={(e) => { e.preventDefault(); send(); }}
                  className="flex items-center gap-2"
                >
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Pergunte sobre seus dados..."
                    disabled={isLoading}
                    className="flex-1 px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 disabled:opacity-50 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400 transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={isLoading || !input.trim()}
                    className="p-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white transition-colors"
                  >
                    <Send size={14} />
                  </button>
                </form>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
