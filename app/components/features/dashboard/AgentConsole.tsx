'use client';

/**
 * Unified AI console for the dashboard.
 *
 * Merges the previous OperatorChatPanel + AnalystChatPanel into a single
 * collapsible card with tab switching between modes:
 *   - Operador  → drives CRUD across all modules
 *   - Analista  → read-only data insights (no destructive tools visible)
 *
 * Design: closed by default (just a compact header strip) to keep the
 * dashboard clean. One click expands to a reasonable 340px-tall chat area.
 * Per-mode history preserved independently while the console stays open.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { getAuth } from 'firebase/auth';
import {
  Sparkles, Send, Loader2, ChevronDown, ChevronUp, Zap, Lock,
  BarChart3, Command, TrendingUp, Users, DollarSign, Calendar,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Role = 'user' | 'assistant';
type Mode = 'operator' | 'analyst';

interface ChatMessage {
  role: Role;
  content: string;
  runId?: string;
  toolCalls?: Array<{ name: string; args?: unknown; error?: string }>;
  costUsd?: number;
  durationMs?: number;
  timestamp: number;
  isFallback?: boolean;
}

const SUGGESTIONS: Record<Mode, Array<{ icon: typeof Command; text: string }>> = {
  operator: [
    { icon: Command, text: 'Como está o dia hoje?' },
    { icon: Command, text: 'Tem nota de compra pra importar?' },
    { icon: Command, text: 'Produtos com estoque baixo' },
    { icon: Command, text: 'Marcar transação 1234 como paga' },
  ],
  analyst: [
    { icon: TrendingUp, text: 'Resumo de vendas da semana' },
    { icon: Users, text: 'Top 10 clientes por faturamento' },
    { icon: DollarSign, text: 'Qual serviço dá mais receita?' },
    { icon: Calendar, text: 'Taxa de no-show deste mês' },
  ],
};

const MODE_META: Record<Mode, { label: string; color: string; accent: string }> = {
  operator: {
    label: 'Operador',
    color: 'from-violet-500 to-purple-600',
    accent: 'violet',
  },
  analyst: {
    label: 'Analista',
    color: 'from-violet-500 to-indigo-600',
    accent: 'indigo',
  },
};

export default function AgentConsole() {
  const { user, business } = useAuth();
  const [mode, setMode] = useState<Mode>('operator');
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  // Independent message history per mode — switching tabs preserves each chat.
  const [operatorMsgs, setOperatorMsgs] = useState<ChatMessage[]>([]);
  const [analystMsgs, setAnalystMsgs] = useState<ChatMessage[]>([]);
  const messages = mode === 'operator' ? operatorMsgs : analystMsgs;
  const setMessages = mode === 'operator' ? setOperatorMsgs : setAnalystMsgs;

  const [sessionId] = useState<string>(() => `${user?.uid || 'anon'}_${Date.now()}`);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const autonomous = !!business?.settings?.aiAgent?.operator?.autonomousMode;
  const canUse = !!business?.settings?.aiAgent?.enabled;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen, mode]);

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

      const history = messages.slice(-12).map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch('/api/agent/operator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message, history, sessionId: `${mode}_${sessionId}`, mode }),
      });

      let data;
      try { data = await res.json(); } catch { throw new Error('Resposta inválida do servidor'); }
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

      // Detect empty response — server succeeded but agent couldn't produce text.
      // Happens when: iteration cap hit, all planner turns emitted tool_calls,
      // or tool errors prevented a final draft. Show a helpful diagnostic.
      const hasText = typeof data.response === 'string' && data.response.trim().length > 0;
      const toolCount = (data.toolCalls || []).length;
      const fallbackContent = toolCount > 0
        ? `Tentei ${toolCount} ação${toolCount > 1 ? 'ões' : ''} mas não consegui formular uma resposta. Pode reformular ou tentar algo mais específico?`
        : 'Não consegui processar agora. Tenta reformular com mais detalhes (ex: "tenho agendamentos essa semana?").';

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: hasText ? data.response : fallbackContent,
          runId: data.runId,
          toolCalls: data.toolCalls || [],
          costUsd: data.costUsd,
          durationMs: data.durationMs,
          timestamp: Date.now(),
          isFallback: !hasText,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ Erro: ${err instanceof Error ? err.message : String(err)}`,
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

  const statusLabel = useMemo(() => {
    if (!canUse) return 'Desligado';
    if (mode === 'analyst') return 'Read-only';
    if (autonomous) return 'Autônomo';
    return 'Confirm';
  }, [autonomous, canUse, mode]);

  const meta = MODE_META[mode];
  const totalMessages = operatorMsgs.length + analystMsgs.length;

  return (
    <div className={cn(
      'rounded-2xl border overflow-hidden transition-all',
      isOpen
        ? 'border-violet-300/50 dark:border-violet-800/40 shadow-md'
        : 'border-gray-200 dark:border-gray-700/60 hover:border-violet-300/50 hover:shadow-sm',
      'bg-white dark:bg-gray-800/40',
    )}>
      {/* Header strip — always visible */}
      <button
        onClick={() => canUse && setIsOpen(!isOpen)}
        disabled={!canUse}
        className={cn(
          'w-full flex items-center justify-between px-4 py-3 transition-colors',
          canUse ? 'hover:bg-gray-50 dark:hover:bg-gray-800/60 cursor-pointer' : 'cursor-not-allowed opacity-70',
        )}
      >
        <div className="flex items-center gap-3">
          <div className={cn('w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center', meta.color)}>
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Agente IA</p>
              {!isOpen && canUse && (
                <span className="text-[10px] text-gray-400 font-medium">Clique para expandir</span>
              )}
            </div>
            {!isOpen && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                Pergunte, comande ou analise seu negócio em linguagem natural
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canUse ? (
            <span className={cn(
              'text-[10px] font-semibold px-2 py-0.5 rounded-full',
              mode === 'analyst'
                ? 'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/10'
                : autonomous
                  ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10'
                  : 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10',
            )}>
              {statusLabel}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
              <Lock className="w-2.5 h-2.5" /> Desligado
            </span>
          )}
          {totalMessages > 0 && (
            <span className="text-[10px] text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full">
              {totalMessages}
            </span>
          )}
          {canUse && (isOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />)}
        </div>
      </button>

      {/* Expanded body */}
      <AnimatePresence>
        {isOpen && canUse && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="overflow-hidden"
          >
            {/* Tab switcher */}
            <div className="flex items-center gap-1 px-4 pt-2 border-t border-gray-100 dark:border-gray-700/40">
              {(['operator', 'analyst'] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    'px-3 py-1.5 rounded-t-lg text-xs font-medium inline-flex items-center gap-1.5 border-b-2 transition-colors',
                    mode === m
                      ? (m === 'analyst'
                          ? 'text-indigo-700 dark:text-indigo-300 border-indigo-500'
                          : 'text-violet-700 dark:text-violet-300 border-violet-500')
                      : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300',
                  )}
                >
                  {m === 'analyst' ? <BarChart3 className="w-3.5 h-3.5" /> : <Command className="w-3.5 h-3.5" />}
                  {MODE_META[m].label}
                  {m === 'operator' && operatorMsgs.length > 0 && (
                    <span className="text-[9px] bg-gray-100 dark:bg-gray-700 px-1 rounded">{operatorMsgs.length}</span>
                  )}
                  {m === 'analyst' && analystMsgs.length > 0 && (
                    <span className="text-[9px] bg-gray-100 dark:bg-gray-700 px-1 rounded">{analystMsgs.length}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Messages area — shrinks when there's little content, expands up to 380px */}
            <div
              ref={scrollRef}
              className={cn(
                'overflow-y-auto px-4 py-3 space-y-3 border-t border-gray-100 dark:border-gray-700/40 transition-[height]',
                messages.length === 0 ? 'min-h-[120px]' : 'h-[340px] max-h-[420px]',
              )}
            >
              {messages.length === 0 && !isLoading && (
                <div className="py-4">
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2 font-medium">
                    {mode === 'operator' ? 'Sugestões rápidas:' : 'Perguntas analíticas:'}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {SUGGESTIONS[mode].map((s, i) => (
                      <button
                        key={i}
                        onClick={() => void send(s.text)}
                        disabled={isLoading}
                        className="flex items-center gap-2 text-left text-xs px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 hover:border-violet-300 dark:hover:border-violet-700 hover:bg-violet-50/40 dark:hover:bg-violet-950/20 transition-colors text-gray-700 dark:text-gray-300"
                      >
                        <s.icon className="w-3 h-3 shrink-0 text-violet-500" />
                        <span className="line-clamp-1">{s.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, idx) => (
                <MessageBubble
                  key={`${m.timestamp}_${idx}`}
                  msg={m}
                  mode={mode}
                  isExpanded={expandedRunId === m.runId}
                  onToggleExpand={() => setExpandedRunId((prev) => (prev === m.runId ? null : m.runId || null))}
                />
              ))}

              {isLoading && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 px-1">
                  <div className={cn('w-6 h-6 rounded-md bg-gradient-to-br flex items-center justify-center', meta.color)}>
                    <Loader2 className="w-3 h-3 text-white animate-spin" />
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Pensando...</span>
                </motion.div>
              )}
            </div>

            {/* Input — wrapper is the visual pill; textarea is transparent inside */}
            <div className="px-3 pb-3 pt-2 border-t border-gray-100 dark:border-gray-700/40">
              <form
                onSubmit={(e) => { e.preventDefault(); void send(); }}
                className={cn(
                  'group flex items-end gap-2 rounded-xl bg-gray-50 dark:bg-gray-900/60 px-3 py-2 transition-all',
                  'ring-1 ring-gray-200 dark:ring-gray-700/60',
                  mode === 'analyst'
                    ? 'focus-within:ring-2 focus-within:ring-indigo-400/60 dark:focus-within:ring-indigo-500/50'
                    : 'focus-within:ring-2 focus-within:ring-violet-400/60 dark:focus-within:ring-violet-500/50',
                )}
              >
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    // autosize
                    e.currentTarget.style.height = 'auto';
                    e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 160)}px`;
                  }}
                  onKeyDown={keyDown}
                  placeholder={mode === 'operator' ? 'Comande ou pergunte em linguagem natural...' : 'Pergunte sobre dados, métricas, padrões...'}
                  rows={1}
                  disabled={isLoading}
                  spellCheck={false}
                  autoComplete="off"
                  className={cn(
                    'flex-1 min-h-[22px] max-h-40 px-1 py-0.5 bg-transparent resize-none text-sm leading-6',
                    'border-0 outline-none focus:outline-none focus:ring-0 focus:border-transparent',
                    'text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
                    'disabled:opacity-60',
                  )}
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  className={cn(
                    'self-end w-8 h-8 rounded-lg flex items-center justify-center transition-all flex-shrink-0',
                    input.trim() && !isLoading
                      ? cn('text-white shadow-sm hover:scale-[1.03] active:scale-95 bg-gradient-to-br', meta.color)
                      : 'bg-gray-200 dark:bg-gray-800 text-gray-400 dark:text-gray-500',
                  )}
                  aria-label="Enviar"
                >
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </form>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-gray-400 dark:text-gray-500 px-0.5">
                <span>Enter envia · Shift+Enter quebra linha</span>
                {mode === 'operator' && !autonomous && (
                  <span className="flex items-center gap-1"><Lock className="w-2.5 h-2.5" /> escritas pedem confirmação</span>
                )}
                {mode === 'operator' && autonomous && (
                  <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400"><Zap className="w-2.5 h-2.5" /> autônomo</span>
                )}
                {mode === 'analyst' && (
                  <span className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400"><BarChart3 className="w-2.5 h-2.5" /> read-only</span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Message bubble ──────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  mode,
  isExpanded,
  onToggleExpand,
}: {
  msg: ChatMessage;
  mode: Mode;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const isUser = msg.role === 'user';
  const hasTools = (msg.toolCalls?.length || 0) > 0;
  const accent = mode === 'analyst' ? 'indigo' : 'violet';

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
    >
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words',
          isUser
            ? cn('text-white rounded-br-md', accent === 'indigo' ? 'bg-indigo-600' : 'bg-violet-600')
            : msg.isFallback
              ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 border border-amber-200/60 dark:border-amber-900/40 rounded-bl-md'
              : 'bg-gray-100 dark:bg-gray-800/80 text-gray-800 dark:text-gray-200 rounded-bl-md',
        )}
      >
        {msg.content}
        {hasTools && !isUser && (
          <div className="mt-1.5 pt-1.5 border-t border-gray-200 dark:border-gray-700/40">
            <button
              onClick={onToggleExpand}
              className={cn(
                'text-[10px] opacity-70 hover:opacity-100 flex items-center gap-1',
                accent === 'indigo' ? 'text-indigo-700 dark:text-indigo-300' : 'text-violet-700 dark:text-violet-300',
              )}
            >
              {msg.toolCalls!.length} {msg.toolCalls!.length > 1 ? 'ações' : 'ação'}
              {msg.durationMs && ` · ${(msg.durationMs / 1000).toFixed(1)}s`}
              {msg.costUsd !== undefined && msg.costUsd > 0 && ` · $${msg.costUsd.toFixed(4)}`}
              {isExpanded ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
            </button>
            {isExpanded && (
              <motion.ul
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-1 space-y-0.5"
              >
                {msg.toolCalls!.map((t, i) => (
                  <li
                    key={i}
                    className={cn(
                      'text-[10px] font-mono px-1.5 py-0.5 rounded',
                      t.error
                        ? 'bg-red-100 dark:bg-red-500/10 text-red-800 dark:text-red-300'
                        : 'bg-white dark:bg-gray-700/40 text-gray-600 dark:text-gray-300',
                    )}
                  >
                    {t.name}
                    {t.error && ` — ⚠ ${t.error}`}
                  </li>
                ))}
              </motion.ul>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
