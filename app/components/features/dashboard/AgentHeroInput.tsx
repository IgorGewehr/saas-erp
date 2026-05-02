'use client';

/**
 * Hero AI input — Canva/Perplexity-style centerpiece for the dashboard.
 *
 * The dashboard's primary interaction surface. Pill input with operator/
 * analyst modes (independent histories) and inline conversation panel that
 * expands when there are messages. Sem chips de sugestão — minimalismo.
 */

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { getAuth } from 'firebase/auth';
import {
  Sparkles, Loader2, ChevronDown, ChevronUp, Zap, Lock,
  BarChart3, Command, ArrowUp, MessageSquarePlus,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { RenderMarkdown } from './markdown';

// ─── Types ────────────────────────────────────────────────────────────────────
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

// ─── Subtitle with highlighted day number ────────────────────────────────────
function SubtitleWithDay({ text }: { text: string }) {
  const match = text.match(/\d+/);
  if (!match) return <>{text}</>;
  const idx = text.indexOf(match[0]);
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-red-500 dark:text-red-400 font-semibold">{match[0]}</span>
      {text.slice(idx + match[0].length)}
    </>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function AgentHeroInput({
  greeting,
  firstName,
  subtitle,
}: {
  greeting: string;
  firstName: string;
  subtitle: string;
}) {
  const { user, business } = useAuth();

  const [mode, setMode] = useState<Mode>('operator');
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
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
  const hasConversation = messages.length > 0;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isLoading]);

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || isLoading || !user) return;
    if (!canUse) return;

    const userMsg: ChatMessage = { role: 'user', content: message, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
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
          content: `⚠️ ${err instanceof Error ? err.message : String(err)}`,
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

  const clearConversation = () => {
    setMessages([]);
    setExpandedRunId(null);
    inputRef.current?.focus();
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="relative">
      <div className="relative max-w-4xl mx-auto">
        {/* ── Greeting ───────────────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {!hasConversation ? (
            <motion.div
              key="greeting"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="text-center mb-6"
            >
              <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-gray-900 dark:text-white">
                {greeting},{' '}
                <span className="bg-gradient-to-r from-red-500 via-rose-400 to-red-400 bg-clip-text text-transparent">
                  {firstName}
                </span>
              </h1>
              <p className="mt-1.5 text-sm sm:text-[15px] text-gray-500 dark:text-gray-500">
                <SubtitleWithDay text={subtitle} />
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="convo-header"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center justify-between mb-3 px-1"
            >
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                  <Sparkles className="w-3 h-3 text-gray-500 dark:text-gray-400" />
                </div>
                <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
                  Agente IA <span className="text-gray-400 dark:text-gray-500">· {mode === 'analyst' ? 'Analista' : 'Operador'}</span>
                </p>
              </div>
              <button
                onClick={clearConversation}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                Nova conversa
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Mode toggle (red theme, sidebar-style gradient) ─────────────── */}
        {!hasConversation && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.05 }}
            className="flex items-center justify-center mb-3"
          >
            <div className="inline-flex p-0.5 rounded-lg bg-gray-100 dark:bg-gray-800/60 border border-gray-200/60 dark:border-gray-700/40">
              {(['operator', 'analyst'] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    'relative px-3 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors z-0',
                    mode === m
                      ? 'text-white'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
                  )}
                >
                  {mode === m && (
                    <motion.span
                      layoutId="agent-mode-pill"
                      className="absolute inset-0 rounded-md -z-10 bg-gradient-to-r from-red-600 to-red-500 shadow-sm shadow-red-500/25"
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    />
                  )}
                  {m === 'analyst'
                    ? <BarChart3 className="w-3 h-3" />
                    : <Command className="w-3 h-3" />}
                  {m === 'analyst' ? 'Analista' : 'Operador'}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* ── Big AI input — minimal, neutral surface ─────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="relative"
        >
          <form
            onSubmit={(e) => { e.preventDefault(); void send(); }}
            className={cn(
              'relative flex items-end gap-2 rounded-2xl px-4 py-3',
              'bg-white dark:bg-gray-900/70 backdrop-blur-xl',
              'border border-red-200/70 dark:border-red-500/30',
              'shadow-sm transition-all duration-200',
              isFocused && 'border-red-400 dark:border-red-500/60 shadow shadow-red-500/10',
              !canUse && 'opacity-70',
            )}
          >
            {/* Sparkle decorator — red theme */}
            <div className="self-center w-9 h-9 rounded-lg bg-red-50 dark:bg-red-500/10 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-red-600 dark:text-red-400" strokeWidth={1.9} />
            </div>

            {/* Input */}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.currentTarget.style.height = 'auto';
                e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 200)}px`;
              }}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={keyDown}
              placeholder={canUse
                ? (mode === 'operator'
                    ? 'Pergunte, comande ou execute uma ação...'
                    : 'Pergunte sobre dados, métricas e tendências...')
                : 'Agente IA está desligado. Ative em Configurações.'}
              rows={1}
              disabled={isLoading || !canUse}
              spellCheck={false}
              autoComplete="off"
              className={cn(
                'flex-1 self-center min-h-[28px] max-h-[200px] py-1.5 bg-transparent resize-none',
                'text-base leading-6',
                'border-0 outline-none focus:outline-none focus:ring-0',
                'text-gray-900 dark:text-gray-100',
                'placeholder:text-gray-400 dark:placeholder:text-gray-500',
                'disabled:cursor-not-allowed',
              )}
            />

            {/* Send button — single accent (only red on the dashboard) */}
            <motion.button
              type="submit"
              disabled={!input.trim() || isLoading || !canUse}
              whileHover={input.trim() && !isLoading && canUse ? { scale: 1.04 } : undefined}
              whileTap={input.trim() && !isLoading && canUse ? { scale: 0.94 } : undefined}
              className={cn(
                'self-end w-9 h-9 rounded-lg flex items-center justify-center transition-colors flex-shrink-0',
                input.trim() && !isLoading && canUse
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed',
              )}
              aria-label="Enviar"
            >
              <AnimatePresence mode="wait" initial={false}>
                {isLoading ? (
                  <motion.span key="load" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </motion.span>
                ) : (
                  <motion.span key="send" initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }}>
                    <ArrowUp className="w-4 h-4" strokeWidth={2.25} />
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          </form>

          {/* Sub-row: status — neutral, single line */}
          <div className="mt-2 flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500 px-1">
            <div className="flex items-center gap-1.5">
              {!canUse ? (
                <span className="inline-flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Agente desligado
                </span>
              ) : mode === 'analyst' ? (
                <span className="inline-flex items-center gap-1">
                  <BarChart3 className="w-3 h-3" /> Modo análise · somente leitura
                </span>
              ) : autonomous ? (
                <span className="inline-flex items-center gap-1">
                  <Zap className="w-3 h-3" /> Autônomo
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Confirma escritas
                </span>
              )}
            </div>
            <span className="hidden sm:block">Enter envia · Shift+Enter quebra linha</span>
          </div>
        </motion.div>

        {/* ── Conversation panel — altura fixa, scroll apenas interno ──── */}
        <AnimatePresence>
          {hasConversation && (
            <motion.div
              key="conversation"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="mt-3"
            >
              <div className="rounded-2xl bg-white/80 dark:bg-gray-900/60 backdrop-blur-xl border border-gray-200/60 dark:border-gray-700/40 shadow-sm flex flex-col h-[280px] sm:h-[340px] lg:h-[380px]">
                <div
                  ref={scrollRef}
                  className="flex-1 min-h-0 px-4 py-3 space-y-2 overflow-y-auto"
                >
                  {messages.map((m, idx) => (
                    <MessageBubble
                      key={`${m.timestamp}_${idx}`}
                      msg={m}
                      isExpanded={expandedRunId === m.runId}
                      onToggleExpand={() => setExpandedRunId((prev) => (prev === m.runId ? null : m.runId || null))}
                    />
                  ))}

                  {isLoading && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-center gap-2 px-1 py-1"
                    >
                      <span className="text-xs text-gray-400 dark:text-gray-500 inline-flex items-center gap-1.5">
                        Pensando
                        <span className="inline-flex gap-0.5">
                          {[0, 1, 2].map(i => (
                            <motion.span
                              key={i}
                              className="w-1 h-1 rounded-full bg-gray-400 dark:bg-gray-500"
                              animate={{ opacity: [0.3, 1, 0.3] }}
                              transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
                            />
                          ))}
                        </span>
                      </span>
                    </motion.div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Disabled CTA when AI is off */}
        <AnimatePresence>
          {!canUse && !hasConversation && (
            <motion.div
              key="disabled-cta"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, delay: 0.2 }}
              className="mt-4 mx-auto max-w-md flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-500/10 border border-amber-200/60 dark:border-amber-500/20 rounded-xl px-3 py-2"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>
                Ative o Agente IA em <strong>Configurações → Enterprise</strong> para conversar com seu negócio em linguagem natural.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Message bubble ──────────────────────────────────────────────────────────
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
  const toolLabel = hasTools
    ? `${msg.toolCalls!.length} ${msg.toolCalls!.length > 1 ? 'ações' : 'ação'}${msg.durationMs ? ` · ${(msg.durationMs / 1000).toFixed(1)}s` : ''}${msg.costUsd && msg.costUsd > 0 ? ` · $${msg.costUsd.toFixed(4)}` : ''}`
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className={cn('flex flex-col', isUser ? 'items-end' : 'items-start')}
    >
      {/* Bubble */}
      <div
        className={cn(
          'max-w-[86%] rounded-2xl px-3.5 py-2 text-[13px] break-words',
          isUser
            ? 'bg-red-600 text-white rounded-tr-sm'
            : msg.isFallback
              ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border border-amber-200/60 dark:border-amber-900/40 rounded-tl-sm'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-tl-sm',
        )}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap leading-relaxed">{msg.content}</span>
        ) : msg.isFallback ? (
          <span className="whitespace-pre-wrap leading-relaxed">{msg.content}</span>
        ) : (
          <RenderMarkdown source={msg.content} />
        )}
      </div>

      {/* Tool calls footer — fora da bubble, bem discreto */}
      {hasTools && !isUser && (
        <div className="mt-1 px-1">
          <button
            onClick={onToggleExpand}
            className="inline-flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            {isExpanded ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
            {toolLabel}
          </button>
          <AnimatePresence>
            {isExpanded && (
              <motion.ul
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-0.5 space-y-0.5 overflow-hidden"
              >
                {msg.toolCalls!.map((t, i) => (
                  <li
                    key={i}
                    className={cn(
                      'text-[10px] font-mono px-1.5 py-0.5 rounded',
                      t.error
                        ? 'bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-300'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
                    )}
                  >
                    {t.name}{t.error && ` — ⚠ ${t.error}`}
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}
