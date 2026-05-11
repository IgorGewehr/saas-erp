'use client';

/**
 * Typing-indicator interno entre operadores (NÃO o typing pro cliente final
 * via Meta API — esse fica em lib/channels/typing.ts).
 *
 * Quando 2+ operadores compartilham o mesmo canal de WhatsApp/FB/IG, há risco
 * de ambos responderem o mesmo contato em paralelo. Esse hook avisa quando
 * outro operador está digitando na conversa atualmente aberta — operador vê
 * "Gustavo está digitando..." e segura a resposta dele.
 *
 * Modelo:
 *   Coleção: `conversations/{conversationId}/typing/{userId}`
 *   Doc:     { userId, userName, updatedAt, businessId }
 *
 * Cada operador escreve no SEU próprio doc (key = userId), permitindo
 * múltiplos digitando simultaneamente sem race. TTL client-side de 5s
 * (sem cleanup server-side — docs órfãos ficam até próximo write).
 *
 * API:
 *   const { typingOthers, sendHeartbeat } = useOperatorTyping(conversationId, businessId);
 *   typingOthers: array de { userId, userName } digitando agora (exclui o user atual)
 *   sendHeartbeat: chame quando o user digitar — debounce + cooldown internos.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import type { Timestamp } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';

/** TTL: docs com updatedAt > now-TTL_MS são considerados ativos. */
const TYPING_TTL_MS = 5_000;
/** Cooldown entre heartbeats: enquanto digitando, atualiza updatedAt no doc
 *  apenas a cada COOLDOWN_MS — reduz writes de N por segundo (cada keystroke)
 *  pra N/3 por segundo (1 write a cada 3s). */
const HEARTBEAT_COOLDOWN_MS = 3_000;
/** Após STOP_TIMEOUT_MS sem chamada do sendHeartbeat, o doc local é deletado
 *  pra parar de mostrar "Fulano digitando..." pros outros. */
const STOP_TIMEOUT_MS = 6_000;

export interface TypingOperator {
  userId: string;
  userName: string;
}

interface TypingDoc {
  userId?: string;
  userName?: string;
  updatedAt?: Timestamp | { seconds: number; nanoseconds: number };
}

export function useOperatorTyping(conversationId: string | undefined, businessId: string | undefined) {
  const { user } = useAuth();
  const [typingOthers, setTypingOthers] = useState<TypingOperator[]>([]);
  // Re-render periódico pra que docs "envelheçam" pro filtro TTL sem precisar
  // de novo snapshot — Firestore não emite só porque o tempo passou.
  const [tick, setTick] = useState(0);

  // ── Subscribe na coleção de typing da conversa atual ─────────────────────
  // Listener mantém snapshot raw; o filtro TTL roda em memória a cada tick.
  const rawTypersRef = useRef<Array<TypingOperator & { updatedAtMs: number }>>([]);

  useEffect(() => {
    if (!conversationId || !businessId) return;
    const ref = collection(db, 'conversations', conversationId, 'typing');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        rawTypersRef.current = snap.docs.map(d => {
          const data = d.data() as TypingDoc;
          const updatedAtMs = data.updatedAt && 'seconds' in data.updatedAt
            ? data.updatedAt.seconds * 1000
            : 0;
          return {
            userId: data.userId || d.id,
            userName: data.userName || 'Alguém',
            updatedAtMs,
          };
        });
        setTick(t => t + 1);
      },
      (err) => {
        // Rules bloqueando ou index — não-fatal, typing é UX sugar.
        console.warn('[useOperatorTyping] snapshot error:', err);
      },
    );
    return () => unsub();
  }, [conversationId, businessId]);

  // ── Tick TTL: refresh do filtro a cada 1s ────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Filtra: apenas docs recentes E que não sejam do próprio user atual.
  useEffect(() => {
    const cutoff = Date.now() - TYPING_TTL_MS;
    const others = rawTypersRef.current
      .filter(t => t.updatedAtMs > cutoff)
      .filter(t => t.userId !== user?.uid)
      .map(t => ({ userId: t.userId, userName: t.userName }));
    setTypingOthers(others);
  }, [tick, user?.uid]);

  // ── Heartbeat outbound: escreve no SEU próprio doc ───────────────────────
  const lastWriteRef = useRef(0);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendHeartbeat = useCallback(() => {
    if (!conversationId || !user?.uid || !businessId) return;
    const now = Date.now();
    // Cooldown — não dispara write em todo keystroke.
    if (now - lastWriteRef.current < HEARTBEAT_COOLDOWN_MS) {
      // Agenda o stop ainda assim — operador pode parar de digitar agora.
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      stopTimerRef.current = setTimeout(() => stopTyping(), STOP_TIMEOUT_MS);
      return;
    }
    lastWriteRef.current = now;
    const ref = doc(db, 'conversations', conversationId, 'typing', user.uid);
    setDoc(ref, {
      userId: user.uid,
      userName: user.name || 'Operador',
      businessId,
      updatedAt: serverTimestamp(),
    }).catch(err => {
      // Best-effort — não bloqueia UI.
      console.warn('[useOperatorTyping] heartbeat write failed:', err);
    });
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = setTimeout(() => stopTyping(), STOP_TIMEOUT_MS);
  }, [conversationId, user?.uid, user?.name, businessId]);

  // Apaga o doc local — chamado em pause de digitação, envio de msg, ou
  // troca de conversa. Falhas silenciosas (doc já pode não existir).
  const stopTyping = useCallback(() => {
    if (!conversationId || !user?.uid) return;
    lastWriteRef.current = 0;
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    const ref = doc(db, 'conversations', conversationId, 'typing', user.uid);
    deleteDoc(ref).catch(() => {/* doc pode já não existir */});
  }, [conversationId, user?.uid]);

  // Cleanup: ao desmontar (fechou aba/trocou conv), tenta apagar o doc atual
  // pra não ficar mostrando "digitando" indefinidamente até expirar o TTL.
  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      // Disparo "fire-and-forget" — sem await pra unmount não pendurar.
      stopTyping();
    };
  }, [stopTyping]);

  return useMemo(() => ({ typingOthers, sendHeartbeat, stopTyping }), [typingOthers, sendHeartbeat, stopTyping]);
}
