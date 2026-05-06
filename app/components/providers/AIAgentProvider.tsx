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
 *
 * Polish da Fase 3:
 *  - Histórico zera ao trocar de business (evita misturar dados entre tenants).
 *  - isLoading split por modo (operator/analyst rodam em paralelo).
 *  - sendingRef síncrono previne reentrancy em janelas <1ms.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
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
  /** Loading por modo — usar pra desabilitar UI só do modo ativo. */
  loadingByMode: Record<AIMode, boolean>;
  /** True quando QUALQUER modo está carregando (atalho pra previews tipo
   *  "Pensando..." em rows que não conhecem o modo atual do consumidor). */
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
  const { user, business } = useAuth();
  const businessId = business?.id;

  const [operatorMsgs, setOperatorMsgs] = useState<AIChatMessage[]>([]);
  const [analystMsgs, setAnalystMsgs] = useState<AIChatMessage[]>([]);
  const [loadingByMode, setLoadingByMode] = useState<Record<AIMode, boolean>>({
    operator: false,
    analyst: false,
  });
  // sessionId fixo por sessão de browser — o backend agrupa runs com mesmo
  // prefixo. Mode é concatenado dentro de send() pra separar operator/analyst.
  const [sessionId] = useState<string>(() => `${user?.uid || 'anon'}_${Date.now()}`);

  // Refs pra leitura síncrona em send() — evitam closures stale e reentrancy.
  const operatorMsgsRef = useRef(operatorMsgs);
  const analystMsgsRef = useRef(analystMsgs);
  operatorMsgsRef.current = operatorMsgs;
  analystMsgsRef.current = analystMsgs;
  const sendingRef = useRef<Set<AIMode>>(new Set());

  // Reset ao trocar de business — histórico de outro tenant não pode vazar.
  // Skipping primeiro render (prev === undefined) pra não zerar no mount inicial.
  const prevBusinessIdRef = useRef<string | undefined>(businessId);
  useEffect(() => {
    if (prevBusinessIdRef.current !== undefined && prevBusinessIdRef.current !== businessId) {
      setOperatorMsgs([]);
      setAnalystMsgs([]);
    }
    prevBusinessIdRef.current = businessId;
  }, [businessId]);

  const send = useCallback(async (mode: AIMode, text: string) => {
    const message = text.trim();
    if (!message || !user) return;

    // Reentrancy guard síncrono — se já tem send do mesmo modo in-flight,
    // ignora. Mais robusto que ler isLoading do closure (que pode estar stale).
    if (sendingRef.current.has(mode)) return;
    sendingRef.current.add(mode);

    const setMessages = mode === 'operator' ? setOperatorMsgs : setAnalystMsgs;
    const userMsg: AIChatMessage = { role: 'user', content: message, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setLoadingByMode(prev => ({ ...prev, [mode]: true }));

    try {
      const token = await getAuth().currentUser?.getIdToken();
      if (!token) throw new Error('Autenticação expirada');

      // Lê do ref pra pegar o estado atual (sem incluir userMsg recém-adicionada
      // — ref ainda aponta pro array anterior porque setMessages é assíncrono).
      const prevHistory = mode === 'operator' ? operatorMsgsRef.current : analystMsgsRef.current;
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
      setLoadingByMode(prev => ({ ...prev, [mode]: false }));
      sendingRef.current.delete(mode);
    }
  }, [user, sessionId]);

  const clear = useCallback((mode: AIMode) => {
    if (mode === 'operator') setOperatorMsgs([]);
    else setAnalystMsgs([]);
  }, []);

  const isLoading = loadingByMode.operator || loadingByMode.analyst;

  return (
    <AIAgentContext.Provider value={{
      operatorMsgs,
      analystMsgs,
      loadingByMode,
      isLoading,
      sessionId,
      send,
      clear,
    }}>
      {children}
    </AIAgentContext.Provider>
  );
}
