'use client';

/**
 * AIAgentProvider — estado compartilhado do agente IA do Dashboard.
 *
 * Antes da Fase 3, todo estado vivia dentro do AgentConsole (useState).
 * Foi liftado pra cá pra permitir que o widget de chat interno (TopBar)
 * abra a mesma conversa em andamento — qualquer consumidor de
 * `useAIAgent()` vê os mesmos messages, isLoading, sessionId.
 *
 * Importante: histórico ainda é só em memória — recarregar a página zera.
 * Se quisermos persistência de verdade depois, troca pra Firestore aqui
 * sem mexer nos consumidores.
 */

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { getAuth } from 'firebase/auth';
import { useAuth } from '@/app/components/providers/AuthProvider';

// ─── Types compartilhados ────────────────────────────────────────────────────

export type AIRole = 'user' | 'assistant';
export type AIMode = 'operator' | 'analyst';

export interface AIChatMessage {
  role: AIRole;
  content: string;
  runId?: string;
  toolCalls?: Array<{ name: string; args?: unknown; error?: string }>;
  costUsd?: number;
  durationMs?: number;
  timestamp: number;
  isFallback?: boolean;
}

interface AIAgentContextValue {
  operatorMsgs: AIChatMessage[];
  analystMsgs: AIChatMessage[];
  isLoading: boolean;
  sessionId: string;
  /** Envia uma mensagem no modo escolhido. Atualiza estado e dispara API. */
  send: (mode: AIMode, text: string) => Promise<void>;
  /** Limpa o histórico de um modo (UX nice-to-have, opcional consumir). */
  clear: (mode: AIMode) => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const AIAgentContext = createContext<AIAgentContextValue | null>(null);

export function useAIAgent(): AIAgentContextValue {
  const ctx = useContext(AIAgentContext);
  if (!ctx) {
    throw new Error('useAIAgent precisa estar dentro de <AIAgentProvider>');
  }
  return ctx;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function AIAgentProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [operatorMsgs, setOperatorMsgs] = useState<AIChatMessage[]>([]);
  const [analystMsgs, setAnalystMsgs] = useState<AIChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // sessionId fixo por sessão de browser — o backend agrupa runs com mesmo
  // prefixo. Mode é concatenado dentro de send() pra separar operator/analyst.
  const [sessionId] = useState<string>(() => `${user?.uid || 'anon'}_${Date.now()}`);

  const send = useCallback(async (mode: AIMode, text: string) => {
    const message = text.trim();
    if (!message || isLoading || !user) return;

    const setMessages = mode === 'operator' ? setOperatorMsgs : setAnalystMsgs;
    const userMsg: AIChatMessage = { role: 'user', content: message, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const token = await getAuth().currentUser?.getIdToken();
      if (!token) throw new Error('Autenticação expirada');

      // Buscar histórico atual (do mesmo modo) sem incluir a mensagem que
      // acabou de ser adicionada. Pegamos do estado ANTES do setMessages
      // assíncrono — usar functional update pra ler o estado mais novo.
      const prevHistory = mode === 'operator' ? operatorMsgs : analystMsgs;
      const history = prevHistory.slice(-12).map(m => ({ role: m.role, content: m.content }));

      const res = await fetch('/api/agent/operator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message, history, sessionId: `${mode}_${sessionId}`, mode }),
      });

      let data;
      try { data = await res.json(); }
      catch { throw new Error('Resposta inválida do servidor'); }
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

      // Detect empty response — agente sem texto final. Mostra diagnóstico.
      const hasText = typeof data.response === 'string' && data.response.trim().length > 0;
      const toolCount = (data.toolCalls || []).length;
      const fallbackContent = toolCount > 0
        ? `Tentei ${toolCount} ação${toolCount > 1 ? 'ões' : ''} mas não consegui formular uma resposta. Pode reformular ou tentar algo mais específico?`
        : 'Não consegui processar agora. Tenta reformular com mais detalhes (ex: "tenho agendamentos essa semana?").';

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: hasText ? data.response : fallbackContent,
        runId: data.runId,
        toolCalls: data.toolCalls || [],
        costUsd: data.costUsd,
        durationMs: data.durationMs,
        timestamp: Date.now(),
        isFallback: !hasText,
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ Erro: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [user, sessionId, isLoading, operatorMsgs, analystMsgs]);

  const clear = useCallback((mode: AIMode) => {
    if (mode === 'operator') setOperatorMsgs([]);
    else setAnalystMsgs([]);
  }, []);

  return (
    <AIAgentContext.Provider value={{ operatorMsgs, analystMsgs, isLoading, sessionId, send, clear }}>
      {children}
    </AIAgentContext.Provider>
  );
}
