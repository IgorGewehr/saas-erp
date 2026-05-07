'use client';

/**
 * AIAgentProvider — estado compartilhado e PERSISTENTE do agente IA.
 *
 * Histórico vive em `aiChatMessages` (per-user, per-mode). Reload da página
 * mantém a conversa. Consumers (`useAIAgent()`) recebem o estado via two
 * onSnapshot subscriptions (operator + analyst), single source of truth.
 *
 * Send escreve no Firestore — UI atualiza quando o snapshot retorna.
 * Firestore SDK tem offline support, então o write é instantaneo da
 * perspectiva do listener (pending=true).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  limit as fbLimit,
  onSnapshot,
  addDoc,
  getDocs,
  writeBatch,
  doc,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import type { AIChatMessageDoc } from '@/lib/types';

// ─── Types compartilhados (re-exportados pra consumers) ─────────────────────

export type AIRole = 'user' | 'assistant';
export type AIMode = 'operator' | 'analyst';

/** Shape consumido pela UI — derivado de AIChatMessageDoc. */
export interface AIChatMessage {
  role: AIRole;
  content: string;
  runId?: string;
  toolCalls?: Array<{ name: string; args?: unknown; error?: string }>;
  costUsd?: number;
  durationMs?: number;
  /** ms epoch — derivado de createdAt do doc. */
  timestamp: number;
  isFallback?: boolean;
}

interface AIAgentContextValue {
  operatorMsgs: AIChatMessage[];
  analystMsgs: AIChatMessage[];
  loadingByMode: Record<AIMode, boolean>;
  isLoading: boolean;
  /** Loading inicial da primeira fetch do snapshot (UI mostra skeleton). */
  hydrating: boolean;
  sessionId: string;
  send: (mode: AIMode, text: string) => Promise<void>;
  /** Apaga TODO o histórico do modo no Firestore. **Não pergunta confirmação**
   *  — consumer é responsável por confirmar com o usuário antes. */
  clear: (mode: AIMode) => Promise<void>;
}

// ─── Conversão Doc → Message ────────────────────────────────────────────────

function docToMessage(d: AIChatMessageDoc): AIChatMessage {
  return {
    role: d.role,
    content: d.content,
    runId: d.runId,
    toolCalls: d.toolCalls,
    costUsd: d.costUsd,
    durationMs: d.durationMs,
    timestamp: new Date(d.createdAt).getTime(),
    isFallback: d.isFallback,
  };
}

/** Merge persistidas + transientes ordenado por timestamp ascendente.
 *  Persistidas já chegam ordenadas; transientes são few — sort estável. */
function mergeChronological(
  persisted: AIChatMessage[],
  transient: AIChatMessage[],
): AIChatMessage[] {
  if (transient.length === 0) return persisted;
  return [...persisted, ...transient].sort((a, b) => a.timestamp - b.timestamp);
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

const HISTORY_LIMIT = 50;

export function AIAgentProvider({ children }: { children: ReactNode }) {
  const { user, business } = useAuth();
  const businessId = business?.id;
  const uid = user?.uid;

  // Mensagens vindas do Firestore (snapshot).
  const [operatorPersisted, setOperatorPersisted] = useState<AIChatMessage[]>([]);
  const [analystPersisted, setAnalystPersisted] = useState<AIChatMessage[]>([]);
  // Erros transientes (network blip, agente sobrecarregado) — NÃO vão pro
  // Firestore pra não poluir histórico permanente. Somem no reload.
  const [transientErrors, setTransientErrors] = useState<Record<AIMode, AIChatMessage[]>>({
    operator: [],
    analyst: [],
  });
  const [operatorHydrating, setOperatorHydrating] = useState(true);
  const [analystHydrating, setAnalystHydrating] = useState(true);
  const [loadingByMode, setLoadingByMode] = useState<Record<AIMode, boolean>>({
    operator: false,
    analyst: false,
  });
  // sessionId fixo por sessão de browser — backend agrupa runs com mesmo
  // prefixo. Persistência não muda isso (sessão != histórico).
  const [sessionId] = useState<string>(() => `${uid || 'anon'}_${Date.now()}`);

  // Reentrancy guard síncrono — janela <1ms entre 2 calls do mesmo modo.
  const sendingRef = useRef<Set<AIMode>>(new Set());
  // Refs com snapshot atual — usadas em send() pra ler o estado mais novo
  // sem depender de closures (evita race quando user envia rápido em sequência).
  const operatorMsgsRef = useRef<AIChatMessage[]>([]);
  const analystMsgsRef = useRef<AIChatMessage[]>([]);

  // ── Mensagens visíveis = persistidas + erros transientes (ordenados). ─────
  const operatorMsgs = useMemo(
    () => mergeChronological(operatorPersisted, transientErrors.operator),
    [operatorPersisted, transientErrors.operator],
  );
  const analystMsgs = useMemo(
    () => mergeChronological(analystPersisted, transientErrors.analyst),
    [analystPersisted, transientErrors.analyst],
  );

  // Atualiza refs quando msgs mudam — read síncrona em send().
  operatorMsgsRef.current = operatorMsgs;
  analystMsgsRef.current = analystMsgs;

  // ── Subscriptions inline — claridade > DRY pra 2 modos. ───────────────────
  // Migration note: deploy desta mudança troca histórico em-memória do reload
  // anterior por histórico Firestore. Conversa em curso no momento do deploy
  // é perdida (igual ao reload normal — comportamento idêntico ao status quo).
  useEffect(() => {
    if (!businessId || !uid) {
      setOperatorPersisted([]);
      setOperatorHydrating(false);
      return;
    }
    setOperatorHydrating(true);
    const q = query(
      collection(db, 'aiChatMessages'),
      where('businessId', '==', businessId),
      where('userId', '==', uid),
      where('mode', '==', 'operator'),
      orderBy('createdAt', 'desc'),
      fbLimit(HISTORY_LIMIT),
    );
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ ...d.data(), id: d.id }) as AIChatMessageDoc);
      docs.reverse();
      setOperatorPersisted(docs.map(docToMessage));
      setOperatorHydrating(false);
    }, err => {
      console.error('[AIAgentProvider] operator subscription error:', err);
      setOperatorHydrating(false);
    });
    return () => unsub();
  }, [businessId, uid]);

  useEffect(() => {
    if (!businessId || !uid) {
      setAnalystPersisted([]);
      setAnalystHydrating(false);
      return;
    }
    setAnalystHydrating(true);
    const q = query(
      collection(db, 'aiChatMessages'),
      where('businessId', '==', businessId),
      where('userId', '==', uid),
      where('mode', '==', 'analyst'),
      orderBy('createdAt', 'desc'),
      fbLimit(HISTORY_LIMIT),
    );
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ ...d.data(), id: d.id }) as AIChatMessageDoc);
      docs.reverse();
      setAnalystPersisted(docs.map(docToMessage));
      setAnalystHydrating(false);
    }, err => {
      console.error('[AIAgentProvider] analyst subscription error:', err);
      setAnalystHydrating(false);
    });
    return () => unsub();
  }, [businessId, uid]);

  // ── Send: write user msg → call API → write assistant msg ─────────────────
  // Erros transientes ficam só no estado local (não persistem) — usuário pode
  // continuar sem o histórico ficar poluído de "⚠️ Erro" no Firestore.
  const send = useCallback(async (mode: AIMode, text: string) => {
    const message = text.trim();
    if (!message || !user || !businessId) return;

    if (sendingRef.current.has(mode)) return;
    sendingRef.current.add(mode);

    setLoadingByMode(prev => ({ ...prev, [mode]: true }));

    try {
      const userCreatedAt = new Date().toISOString();
      // 1. Escreve mensagem do usuário. Snapshot listener vai propagar pra UI.
      await addDoc(collection(db, 'aiChatMessages'), {
        businessId,
        userId: user.uid,
        mode,
        role: 'user',
        content: message,
        createdAt: userCreatedAt,
      });

      const token = await getAuth().currentUser?.getIdToken();
      if (!token) throw new Error('Autenticação expirada');

      // Histórico pro contexto da API: lê do REF (não do closure) pra garantir
      // que sends rápidos em sequência vejam o estado mais novo. Adicionamos
      // a userMsg manualmente porque o snapshot pode não ter retornado ainda.
      const refMsgs = mode === 'operator' ? operatorMsgsRef.current : analystMsgsRef.current;
      const fullHistory = [...refMsgs, { role: 'user' as const, content: message }];
      const history = fullHistory.slice(-12).map(m => ({ role: m.role, content: m.content }));

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

      // 2. Escreve resposta do assistant. Constrói o doc condicionalmente
      // — Firestore armazena null pra undefined explícito; evitamos por clareza.
      const assistantDoc: Record<string, unknown> = {
        businessId,
        userId: user.uid,
        mode,
        role: 'assistant',
        content: hasText ? data.response : fallbackContent,
        createdAt: new Date().toISOString(),
        isFallback: !hasText,
      };
      if (data.runId) assistantDoc.runId = data.runId;
      if (data.toolCalls?.length) assistantDoc.toolCalls = data.toolCalls;
      if (typeof data.costUsd === 'number') assistantDoc.costUsd = data.costUsd;
      if (typeof data.durationMs === 'number') assistantDoc.durationMs = data.durationMs;

      await addDoc(collection(db, 'aiChatMessages'), assistantDoc);
    } catch (err) {
      // Erro transiente — só estado local, não persiste no Firestore.
      const errorMsg: AIChatMessage = {
        role: 'assistant',
        content: `⚠️ Erro: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      };
      setTransientErrors(prev => ({ ...prev, [mode]: [...prev[mode], errorMsg] }));
    } finally {
      setLoadingByMode(prev => ({ ...prev, [mode]: false }));
      sendingRef.current.delete(mode);
    }
  }, [user, businessId, sessionId]);

  // Clear: deleta histórico persistido + zera erros transientes do modo.
  const clear = useCallback(async (mode: AIMode) => {
    setTransientErrors(prev => ({ ...prev, [mode]: [] }));
    if (!businessId || !uid) return;
    const q = query(
      collection(db, 'aiChatMessages'),
      where('businessId', '==', businessId),
      where('userId', '==', uid),
      where('mode', '==', mode),
    );
    const snap = await getDocs(q);
    if (snap.empty) return;
    // Firestore batch limit é 500 — chat raramente passa, mas segurança.
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 500) {
      const batch = writeBatch(db);
      for (const d of docs.slice(i, i + 500)) {
        batch.delete(doc(db, 'aiChatMessages', d.id));
      }
      await batch.commit();
    }
  }, [businessId, uid]);

  const isLoading = loadingByMode.operator || loadingByMode.analyst;
  const hydrating = operatorHydrating || analystHydrating;

  const value = useMemo<AIAgentContextValue>(() => ({
    operatorMsgs,
    analystMsgs,
    loadingByMode,
    isLoading,
    hydrating,
    sessionId,
    send,
    clear,
  }), [operatorMsgs, analystMsgs, loadingByMode, isLoading, hydrating, sessionId, send, clear]);

  return <AIAgentContext.Provider value={value}>{children}</AIAgentContext.Provider>;
}
