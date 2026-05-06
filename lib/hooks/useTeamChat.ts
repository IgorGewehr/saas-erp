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
import type { TeamChat, TeamChatMessage } from '@/lib/types';
import { getInitials } from '@/lib/utils/format';

// ─── IDs determinísticos ─────────────────────────────────────────────────────
// Ambos baseados no business/uids — evitam corrida que crie duplicatas se dois
// usuários abrem o mesmo DM ao mesmo tempo (Fase 2).

export function globalChatId(businessId: string): string {
  return `global_${businessId}`;
}

export function dmChatId(uidA: string, uidB: string): string {
  return `dm_${[uidA, uidB].sort().join('_')}`;
}

/** Computa se há mensagens não lidas em um chat para um usuário. */
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
  totalUnread: number;
  hasUnread: (chatId: string) => boolean;
  ensureGlobalChat: () => Promise<string>;
  sendMessage: (chatId: string, text: string) => Promise<void>;
  markAsRead: (chatId: string) => Promise<void>;
}

export function useTeamChat(): UseTeamChatResult {
  const { user, business } = useAuth();
  const [globalChats, setGlobalChats] = useState<TeamChat[]>([]);
  const [dmChats, setDmChats] = useState<TeamChat[]>([]);
  const [globalLoading, setGlobalLoading] = useState(true);
  const [dmLoading, setDmLoading] = useState(true);

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
    }, err => {
      console.error('[useTeamChat] global onSnapshot error:', err);
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
    }, err => {
      console.error('[useTeamChat] dm onSnapshot error:', err);
      setDmLoading(false);
    });
    return () => unsub();
  }, [businessId, uid]);

  const chats = useMemo(() => {
    const merged = [...globalChats, ...dmChats];
    // Ordena por última atividade (lastMessageAt) desc; sem mensagens vai pro fim.
    merged.sort((a, b) => {
      const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return tb - ta;
    });
    return merged;
  }, [globalChats, dmChats]);

  const globalChat = globalChats[0] ?? null;

  const totalUnread = useMemo(
    () => chats.reduce((acc, c) => acc + (hasUnreadFor(c, uid) ? 1 : 0), 0),
    [chats, uid],
  );

  const hasUnread = useCallback(
    (chatId: string) => {
      const c = chats.find(x => x.id === chatId);
      return c ? hasUnreadFor(c, uid) : false;
    },
    [chats, uid],
  );

  // Cria global chat lazy — chamado quando o painel abre. Idempotente.
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
        });
      }
      return id;
    })();
    ensuringRef.current = promise;
    try {
      return await promise;
    } finally {
      ensuringRef.current = null;
    }
  }, [businessId]);

  const sendMessage = useCallback(async (chatId: string, text: string) => {
    if (!user || !businessId) throw new Error('Sem auth/business');
    const trimmed = text.trim();
    if (!trimmed) return;
    const now = new Date().toISOString();

    // 1. Cria a mensagem. senderPhotoURL é incluído condicionalmente — Firestore
    // armazena nulls explicitamente, então omitimos quando não há foto.
    await addDoc(collection(db, 'teamChatMessages'), {
      businessId,
      chatId,
      senderId: user.uid,
      senderName: user.name,
      senderInitials: getInitials(user.name),
      text: trimmed,
      createdAt: now,
      ...(user.photoURL ? { senderPhotoURL: user.photoURL } : {}),
    });

    // 2. Atualiza o chat: lastMessage + lastReadAt do sender.
    await updateDoc(doc(db, 'teamChats', chatId), {
      lastMessage: {
        text: trimmed,
        senderId: user.uid,
        senderName: user.name,
        sentAt: now,
      },
      lastMessageAt: now,
      [`lastReadAt.${user.uid}`]: now,
      updatedAt: now,
    });
  }, [user, businessId]);

  const markAsRead = useCallback(async (chatId: string) => {
    if (!uid) return;
    const c = chats.find(x => x.id === chatId);
    if (!c) return;
    if (!hasUnreadFor(c, uid)) return; // nada a fazer
    await updateDoc(doc(db, 'teamChats', chatId), {
      [`lastReadAt.${uid}`]: new Date().toISOString(),
    });
  }, [uid, chats]);

  return {
    chats,
    globalChat,
    loadingChats: globalLoading || dmLoading,
    totalUnread,
    hasUnread,
    ensureGlobalChat,
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
