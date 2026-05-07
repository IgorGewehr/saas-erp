'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  doc,
  setDoc,
  getDoc,
  addDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import type { TeamChat, TeamChatMessage, TeamChatAttachment } from '@/lib/types';
import { getInitials } from '@/lib/utils/format';

/** Preview do lastMessage quando a msg só tem anexos. Hardcoded em PT — i18n
 *  no preview do chat ficaria pesado pra um label minúsculo. */
function buildAttachmentSummary(atts: TeamChatAttachment[]): string {
  if (atts.length === 1) return `📎 ${atts[0].name}`;
  const imgCount = atts.filter(a => a.type === 'image').length;
  if (imgCount === atts.length) return `🖼️ ${atts.length} imagens`;
  return `📎 ${atts.length} arquivos`;
}

// ─── IDs determinísticos ─────────────────────────────────────────────────────
// Ambos baseados no business/uids — evitam corrida que crie duplicatas se dois
// usuários abrem o mesmo DM ao mesmo tempo (Fase 2).

export function globalChatId(businessId: string): string {
  return `global_${businessId}`;
}

export function dmChatId(uidA: string, uidB: string): string {
  return `dm_${[uidA, uidB].sort().join('_')}`;
}

/** Computa se há mensagens não lidas em um chat para um usuário (sem override local). */
export function hasUnreadFor(chat: TeamChat, uid: string | undefined): boolean {
  if (!uid || !chat.lastMessageAt) return false;
  // Mensagem própria nunca conta como unread (sender já viu).
  if (chat.lastMessage?.senderId === uid) return false;
  const lastRead = chat.lastReadAt?.[uid];
  if (!lastRead) return true;
  return new Date(chat.lastMessageAt).getTime() > new Date(lastRead).getTime();
}

// ─── Hook principal ──────────────────────────────────────────────────────────

interface UseTeamChatResult {
  chats: TeamChat[];
  globalChat: TeamChat | null;
  loadingChats: boolean;
  /** Mensagem de erro user-facing — populada quando subscriptions falham (ex: rules
   *  não publicadas) ou ensureGlobalChat dá permission-denied. null = tudo ok. */
  error: string | null;
  totalUnread: number;
  /** hasUnread aplica também o override otimista local (markAsRead instantâneo). */
  hasUnread: (chatId: string) => boolean;
  ensureGlobalChat: () => Promise<string>;
  /** Cria (se não existir) um DM 1:1 com `otherUid` e retorna o chatId. */
  ensureDM: (otherUid: string) => Promise<string>;
  sendMessage: (chatId: string, text: string, attachments?: TeamChatAttachment[]) => Promise<void>;
  markAsRead: (chatId: string) => Promise<void>;
}

export function useTeamChat(): UseTeamChatResult {
  const { user, business } = useAuth();
  const [globalChats, setGlobalChats] = useState<TeamChat[]>([]);
  const [dmChats, setDmChats] = useState<TeamChat[]>([]);
  const [globalLoading, setGlobalLoading] = useState(true);
  const [dmLoading, setDmLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Override otimista pra markAsRead. Mapeia chatId → epoch ms da marcação local.
  // Se chat.lastMessageAt <= localReadTimes[chatId], tratamos como lido mesmo
  // antes do Firestore confirmar. Mensagens novas (chegando via onSnapshot com
  // lastMessageAt > localRead) voltam a contar como unread.
  const [localReadTimes, setLocalReadTimes] = useState<Record<string, number>>({});

  const businessId = business?.id;
  const uid = user?.uid;

  // Subscription 1: global chat do business (no máximo 1 doc).
  useEffect(() => {
    if (!businessId) { setGlobalLoading(false); return; }
    const q = query(
      collection(db, 'teamChats'),
      where('businessId', '==', businessId),
      where('type', '==', 'global'),
    );
    const unsub = onSnapshot(q, snap => {
      setGlobalChats(snap.docs.map(d => ({ ...d.data(), id: d.id } as TeamChat)));
      setGlobalLoading(false);
      // Limpa erro se subscription voltou a funcionar.
      setError(prev => (prev?.startsWith('[global]') ? null : prev));
    }, err => {
      console.error('[useTeamChat] global onSnapshot error:', err);
      setError(`[global] ${err.message ?? 'permission-denied'}`);
      setGlobalLoading(false);
    });
    return () => unsub();
  }, [businessId]);

  // Subscription 2: DMs onde sou membro. Firestore não tem OR nativo, então
  // mantemos as duas queries separadas e mergeamos no client.
  useEffect(() => {
    if (!businessId || !uid) { setDmLoading(false); return; }
    const q = query(
      collection(db, 'teamChats'),
      where('businessId', '==', businessId),
      where('type', '==', 'dm'),
      where('memberIds', 'array-contains', uid),
    );
    const unsub = onSnapshot(q, snap => {
      setDmChats(snap.docs.map(d => ({ ...d.data(), id: d.id } as TeamChat)));
      setDmLoading(false);
      setError(prev => (prev?.startsWith('[dm]') ? null : prev));
    }, err => {
      console.error('[useTeamChat] dm onSnapshot error:', err);
      setError(`[dm] ${err.message ?? 'permission-denied'}`);
      setDmLoading(false);
    });
    return () => unsub();
  }, [businessId, uid]);

  const chats = useMemo(() => {
    const merged = [...globalChats, ...dmChats];
    // Ordena por atividade desc. Fallback pra updatedAt/createdAt: DM acabada
    // de criar (sem lastMessageAt) deve ir pro topo, não pro fim.
    const ts = (c: TeamChat): number =>
      new Date(c.lastMessageAt ?? c.updatedAt ?? c.createdAt).getTime();
    merged.sort((a, b) => ts(b) - ts(a));
    return merged;
  }, [globalChats, dmChats]);

  const globalChat = globalChats[0] ?? null;

  // Wrapper que aplica o override otimista local.
  const isUnread = useCallback((c: TeamChat): boolean => {
    if (!hasUnreadFor(c, uid)) return false;
    const localRead = localReadTimes[c.id];
    if (localRead && c.lastMessageAt && new Date(c.lastMessageAt).getTime() <= localRead) {
      return false;
    }
    return true;
  }, [uid, localReadTimes]);

  const totalUnread = useMemo(
    () => chats.reduce((acc, c) => acc + (isUnread(c) ? 1 : 0), 0),
    [chats, isUnread],
  );

  const hasUnread = useCallback(
    (chatId: string) => {
      const c = chats.find(x => x.id === chatId);
      return c ? isUnread(c) : false;
    },
    [chats, isUnread],
  );

  // Cria global chat lazy — chamado quando o painel abre. Idempotente e race-safe
  // graças ao `merge: true`: se dois clientes caírem no mesmo branch ao mesmo
  // tempo (ou se um terceiro escrever lastMessage entre o getDoc e o setDoc),
  // os campos pré-existentes são preservados.
  const ensuringRef = useRef<Promise<string> | null>(null);
  const ensureGlobalChat = useCallback(async (): Promise<string> => {
    if (!businessId) throw new Error('Sem business');
    const id = globalChatId(businessId);
    if (ensuringRef.current) return ensuringRef.current;
    const promise = (async () => {
      const ref = doc(db, 'teamChats', id);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        const now = new Date().toISOString();
        await setDoc(ref, {
          businessId,
          type: 'global',
          memberIds: [],
          lastReadAt: {},
          createdAt: now,
          updatedAt: now,
        }, { merge: true });
      }
      return id;
    })();
    ensuringRef.current = promise;
    try {
      const result = await promise;
      // Se ensure voltou ok, limpa erro residual.
      setError(prev => (prev?.includes('global') ? null : prev));
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'falha ao criar chat geral';
      setError(`[ensureGlobal] ${msg}`);
      throw err;
    } finally {
      ensuringRef.current = null;
    }
  }, [businessId]);

  // Cria DM 1:1 lazy. ID determinístico — se dois usuários clicarem um no outro
  // ao mesmo tempo, ambos resolvem pro mesmo chatId e o setDoc(merge:true)
  // garante idempotência. memberIds sorted pra match com o ID. Erros (típico:
  // permission-denied) populam o `error` state pra UI mostrar feedback.
  // De-dup por otherUid: clicks rápidos no mesmo membro reusam a mesma
  // promise, evitando 2× write faturável.
  const ensuringDMRef = useRef<Map<string, Promise<string>>>(new Map());
  const ensureDM = useCallback(async (otherUid: string): Promise<string> => {
    if (!businessId || !user) throw new Error('Sem business/auth');
    if (otherUid === user.uid) throw new Error('Não pode iniciar DM consigo mesmo');

    const id = dmChatId(user.uid, otherUid);
    const inflight = ensuringDMRef.current.get(otherUid);
    if (inflight) return inflight;

    const promise = (async () => {
      const ref = doc(db, 'teamChats', id);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        const now = new Date().toISOString();
        const sortedMembers = [user.uid, otherUid].sort();
        await setDoc(ref, {
          businessId,
          type: 'dm',
          memberIds: sortedMembers,
          lastReadAt: {},
          createdAt: now,
          updatedAt: now,
        }, { merge: true });
      }
      return id;
    })();

    ensuringDMRef.current.set(otherUid, promise);
    try {
      const result = await promise;
      // Se ensure voltou ok, limpa erro residual de DM.
      setError(prev => (prev?.startsWith('[ensureDM]') ? null : prev));
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'falha ao criar DM';
      setError(`[ensureDM] ${msg}`);
      throw err;
    } finally {
      ensuringDMRef.current.delete(otherUid);
    }
  }, [businessId, user]);

  const sendMessage = useCallback(async (
    chatId: string,
    text: string,
    attachments?: TeamChatAttachment[],
  ) => {
    if (!user || !businessId) throw new Error('Sem auth/business');
    const trimmed = text.trim();
    const hasAttachments = (attachments?.length ?? 0) > 0;
    // Mensagem vazia (sem texto E sem anexos) não envia nada.
    if (!trimmed && !hasAttachments) return;

    // Garante que o chat global exista antes de updateDoc — evita falha se o
    // ensureGlobalChat do mount ainda não rodou ou foi rejeitado por rules.
    if (chatId === globalChatId(businessId)) {
      await ensureGlobalChat();
    }

    const now = new Date().toISOString();

    // 1. Cria a mensagem. senderPhotoURL e attachments incluídos condicionalmente
    // — Firestore armazena nulls/undefined explicitamente, omitimos quando vazio.
    await addDoc(collection(db, 'teamChatMessages'), {
      businessId,
      chatId,
      senderId: user.uid,
      senderName: user.name,
      senderInitials: getInitials(user.name),
      text: trimmed,
      createdAt: now,
      ...(user.photoURL ? { senderPhotoURL: user.photoURL } : {}),
      ...(hasAttachments ? { attachments } : {}),
    });

    // 2. Atualiza o chat: lastMessage + lastReadAt do sender. Quando a mensagem
    // só tem anexos (sem texto), preview do lastMessage usa um label resumido.
    const lastMessageText = trimmed || buildAttachmentSummary(attachments!);

    await updateDoc(doc(db, 'teamChats', chatId), {
      lastMessage: {
        text: lastMessageText,
        senderId: user.uid,
        senderName: user.name,
        sentAt: now,
      },
      lastMessageAt: now,
      [`lastReadAt.${user.uid}`]: now,
      updatedAt: now,
    });
  }, [user, businessId, ensureGlobalChat]);

  const markAsRead = useCallback(async (chatId: string) => {
    if (!uid) return;
    const c = chats.find(x => x.id === chatId);
    if (!c) return;
    if (!hasUnreadFor(c, uid)) return; // nada a fazer

    // Optimistic: marca como lido localmente AGORA — UI atualiza instantâneo.
    // O Firestore eventualmente confirma via onSnapshot, mas o usuário não
    // precisa esperar o round-trip pra ver o badge sumir.
    const nowMs = Date.now();
    setLocalReadTimes(prev => ({ ...prev, [chatId]: nowMs }));

    try {
      await updateDoc(doc(db, 'teamChats', chatId), {
        [`lastReadAt.${uid}`]: new Date(nowMs).toISOString(),
      });
    } catch (err) {
      // Rollback do override local — se falhar, badge volta a aparecer.
      setLocalReadTimes(prev => {
        const next = { ...prev };
        delete next[chatId];
        return next;
      });
      console.error('[useTeamChat] markAsRead failed:', err);
      throw err;
    }
  }, [uid, chats]);

  return {
    chats,
    globalChat,
    loadingChats: globalLoading || dmLoading,
    error,
    totalUnread,
    hasUnread,
    ensureGlobalChat,
    ensureDM,
    sendMessage,
    markAsRead,
  };
}

// ─── Hook auxiliar: mensagens de UM chat ────────────────────────────────────

export function useTeamChatMessages(chatId: string | null, max = 50) {
  const [messages, setMessages] = useState<TeamChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!chatId) { setMessages([]); return; }
    setLoading(true);
    const q = query(
      collection(db, 'teamChatMessages'),
      where('chatId', '==', chatId),
      orderBy('createdAt', 'asc'),
      limit(max),
    );
    const unsub = onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ ...d.data(), id: d.id } as TeamChatMessage)));
      setLoading(false);
    }, err => {
      console.error('[useTeamChatMessages] error:', err);
      setLoading(false);
    });
    return () => unsub();
  }, [chatId, max]);

  return { messages, loading };
}
