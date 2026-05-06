'use client';

/**
 * Operator chat panel for the dashboard.
 *
 * A conversational interface to drive the entire system by natural language:
 *   - "quantas vendas hoje?"
 *   - "cria um cartão no kanban 'Pedidos' com título 'Ligar pro fornecedor'"
 *   - "importa a nota de compra mais recente"
 *   - "marca a transação 1234 como paga"
 *
 * The confirm flow (for destructive ops) is driven by the agent's prompt:
 * the agent responds with "Vou fazer X, confirma?" and the operator types
 * "sim"/"confirma" — there's no special UI state. Keeps things simple and
 * makes the conversation feel natural. When autonomousMode is ON, the agent
 * skips that step and shows preview + result directly.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { getAuth } from 'firebase/auth';
import { Sparkles, Send, Loader2, Activity, ChevronDown, ChevronUp, Zap } from 'lucide-react';
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
  'Como está o dia hoje?',
  'Tem nota de compra pra importar?',
  'Quais produtos estão com estoque baixo?',
  'Resumo financeiro da semana',
];

export default function OperatorChatPanel() {
  const { user, business } = useAuth();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [sessionId] = useState<string>(() => `${user?.uid || 'anon'}_${Date.now()}`);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Dashboard AI sempre disponível — `aiAgent.enabled` controla só o agente
  // autônomo de atendimento ao cliente. Ver AgentHeroInput pro contexto.
  const autonomous = !!business?.settings?.aiAgent?.operator?.autonomousMode;

  // Auto-scroll to bottom on new message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || isLoading || !user) return;

    const userMsg: ChatMessage = { role: 'user', content: message, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const token = await getAuth().currentUser?.getIdToken();
      if (!token) throw new Error('Autenticação expirada');

      // Build history from current messages (excluding the just-added user msg)
      const history = messages.slice(-12).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch('/api/agent/operator/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message, history, sessionId }),
      });

      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error('Resposta inválida do servidor');
      }

      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: data.response || '(sem resposta)',
        runId: data.runId,
        toolCalls: data.toolCalls || [],
        costUsd: data.costUsd,
        durationMs: data.durationMs,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ Erro: ${msg}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const keyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const statusPill = useMemo(() => {
    if (autonomous) return { label: 'Modo autônomo', color: 'bg-amber-500', icon: Zap };
    return { label: 'Modo confirm', color: 'bg-emerald-500', icon: Sparkles };
  }, [autonomous]);

  const StatusIcon = statusPill.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="surface rounded-2xl border border-violet-200/50 dark:border-violet-900/30 bg-gradient-to-br from-violet-50/40 via-white to-purple-50/30 dark:from-violet-950/30 dark:via-gray-900 dark:to-purple-950/20 overflow-hidden shadow-sm hover:shadow-md transition-shadow"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-violet-100 dark:border-violet-900/40">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display font-semibold text-[15px] text-gray-900 dark:text-white">
                Agente IA
              </h3>
              <div className={cn('flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-white', statusPill.color)}>
                <StatusIcon className="w-3 h-3" />
                {statusPill.label}
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Pergunte, comande, ou peça análises em linguagem natural
            </p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div>
          {/* Messages */}
          <div
            ref={scrollRef}
            className="px-5 py-4 max-h-[360px] overflow-y-auto space-y-4"
          >
            {messages.length === 0 && !isLoading && (
              <div className="py-4">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 font-medium">
                  Sugestões para começar:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => void send(prompt)}
                      disabled={isLoading}
                      className="text-left text-sm px-3 py-2 rounded-xl bg-white/60 dark:bg-gray-800/50 border border-violet-100 dark:border-violet-900/40 hover:border-violet-300 dark:hover:border-violet-700 hover:bg-violet-50/60 dark:hover:bg-violet-950/30 transition-colors text-gray-700 dark:text-gray-300"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <AnimatePresence initial={false}>
              {messages.map((m, idx) => (
                <MessageBubble
                  key={`${m.timestamp}_${idx}`}
                  msg={m}
                  isExpanded={expandedRunId === m.runId}
                  onToggleExpand={() =>
                    setExpandedRunId((prev) => (prev === m.runId ? null : m.runId || null))
                  }
                />
              ))}
            </AnimatePresence>

            {isLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-start gap-3"
              >
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-3.5 h-3.5 text-white animate-pulse" />
                </div>
                <div className="flex items-center gap-2 pt-1.5">
                  <Loader2 className="w-3.5 h-3.5 text-violet-500 animate-spin" />
                  <span className="text-xs text-gray-500 dark:text-gray-400">Pensando...</span>
                </div>
              </motion.div>
            )}
          </div>

          {/* Input */}
          <div className="px-4 pb-4">
            <div className="relative rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus-within:border-violet-400 dark:focus-within:border-violet-600 transition-colors">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={keyDown}
                placeholder="Fale com o sistema em linguagem natural..."
                rows={2}
                disabled={isLoading}
                className="w-full px-4 py-3 pr-12 bg-transparent resize-none text-sm outline-none text-gray-900 dark:text-gray-100 placeholder:text-gray-400 disabled:opacity-60 rounded-xl"
              />
              <button
                onClick={() => void send()}
                disabled={!input.trim() || isLoading}
                className={cn(
                  'absolute bottom-2 right-2 w-8 h-8 rounded-lg flex items-center justify-center transition-all',
                  input.trim() && !isLoading
                    ? 'bg-gradient-to-br from-violet-500 to-purple-600 text-white hover:scale-105 shadow-sm'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
                )}
                aria-label="Enviar"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
            <p className="mt-2 text-[10px] text-gray-400 flex items-center justify-between">
              <span>Enter para enviar · Shift+Enter para quebra de linha</span>
              <span className="flex items-center gap-1">
                <Activity className="w-3 h-3" />
                Runs auditados em <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-[9px]">agentRuns</code>
              </span>
            </p>
          </div>
        </div>
    </motion.div>
  );
}

// ─── Message bubble ─────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  isExpanded,
  onToggleExpand,
}: {
  msg: ChatMessage;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const isUser = msg.role === 'user';
  const hasTools = (msg.toolCalls?.length || 0) > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn('flex items-start gap-3', isUser && 'flex-row-reverse')}
    >
      <div
        className={cn(
          'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-[10px] font-semibold',
          isUser
            ? 'bg-gradient-to-br from-gray-600 to-gray-800 text-white dark:from-gray-400 dark:to-gray-600 dark:text-gray-900'
            : 'bg-gradient-to-br from-violet-500 to-purple-600 text-white'
        )}
      >
        {isUser ? 'Eu' : <Sparkles className="w-3.5 h-3.5" />}
      </div>
      <div className={cn('flex-1 max-w-[85%]', isUser && 'flex flex-col items-end')}>
        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words',
            isUser
              ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
              : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200/60 dark:border-gray-700/60'
          )}
        >
          {msg.content}
        </div>

        {/* Tool calls expansion */}
        {hasTools && (
          <div className="mt-1.5">
            <button
              onClick={onToggleExpand}
              className="text-[11px] text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1"
            >
              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {msg.toolCalls!.length} ação{msg.toolCalls!.length > 1 ? 'ões' : ''} executada{msg.toolCalls!.length > 1 ? 's' : ''}
              {msg.durationMs && ` · ${(msg.durationMs / 1000).toFixed(1)}s`}
              {msg.costUsd !== undefined && msg.costUsd > 0 && ` · $${msg.costUsd.toFixed(4)}`}
            </button>
            {isExpanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 space-y-1 text-[11px]"
              >
                {msg.toolCalls!.map((t, i) => (
                  <div
                    key={i}
                    className={cn(
                      'rounded-lg px-2.5 py-1.5 border',
                      t.error
                        ? 'border-red-200 dark:border-red-900/40 bg-red-50/60 dark:bg-red-950/20 text-red-800 dark:text-red-300'
                        : 'border-violet-200/50 dark:border-violet-900/40 bg-violet-50/40 dark:bg-violet-950/20 text-violet-800 dark:text-violet-300'
                    )}
                  >
                    <div className="font-mono font-semibold text-[10px]">{t.name}</div>
                    {t.error && <div className="mt-0.5 text-[10px]">⚠ {t.error}</div>}
                  </div>
                ))}
              </motion.div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
