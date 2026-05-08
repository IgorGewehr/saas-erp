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
  getDocs,
  addDoc,
  updateDoc,
  deleteField,
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

/** Extrai UIDs de marcadores `<@uid>` no texto. Dedup. */
export function parseMentionedUserIds(text: string): string[] {
  const re = /<@([A-Za-z0-9_-]+)>/g;
  const ids = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) ids.add(m[1]);
  return Array.from(ids);
}

/** Versão "limpa" do texto pra preview de lastMessage — substitui `<@uid>`
 *  por `@nome` ou `@usuário` se uid não for resolvível. */
function strippedMentions(text: string, resolveName: (uid: string) => string): string {
  return text.replace(/<@([A-Za-z0-9_-]+)>/g, (_, uid) => `@${resolveName(uid)}`);
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
  /** Sinaliza que o usuário está digitando (true) ou parou (false). Writes
   *  são debounced internamente (1 write a cada ~2s enquanto ativo) — chamar
   *  toda vez que o composer mudar é seguro. Ao parar/enviar/desmontar, chame
   *  com `false` pra limpar a entrada do Firestore. */
  setTyping: (chatId: string, isTyping: boolean) => Promise<void>;
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
      // Tenta detectar se já existe via getDoc. Pode falhar com
      // "permission-denied" em docs INEXISTENTES — Firestore avalia rules
      // sobre `resource.data` que é null nesse caso, e a regra
      // `resource.data.type == 'global'` retorna falsy → deny.
      // Tratamos esse erro como "não existe" e seguimos pra criação.
      let exists = false;
      try {
        const snap = await getDoc(ref);
        exists = snap.exists();
      } catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : '';
        if (!msg.includes('permission') && !msg.includes('insufficient')) {
          throw err; // erro genuíno (network, etc.) — propaga
        }
        exists = false;
      }
      if (!exists) {
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
      // Mesmo tratamento do ensureGlobalChat: getDoc em doc inexistente pode
      // retornar permission-denied porque a rule depende de resource.data.
      let exists = false;
      try {
        const snap = await getDoc(ref);
        exists = snap.exists();
      } catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : '';
        if (!msg.includes('permission') && !msg.includes('insufficient')) throw err;
        exists = false;
      }
      if (!exists) {
        const now = new Date().toISOString();
        const sortedMembers = [user.uid, otherUid].sort();
        await setDoc(ref, {
          businessId,
          type: 'dm',
          memberIds: sortedMembers,
          lastReadAt: {},
          createdAt: now,
          updatedAt: now,
        });
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

    // Extrai UIDs mencionados via `<@uid>` no texto. Notificações disparadas
    // pra cada destinatário (exceto o próprio sender — não notifica self).
    const mentionedUserIds = parseMentionedUserIds(trimmed);
    const notifyTargets = mentionedUserIds.filter(uid => uid !== user.uid);

    // 1. Cria a mensagem. Campos opcionais incluídos condicionalmente —
    // Firestore armazena undefined como null se passados; evitamos por clareza.
    try {
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
        ...(mentionedUserIds.length > 0 ? { mentionedUserIds } : {}),
      });
    } catch (err) {
      console.error('[sendMessage] step 1 (addDoc teamChatMessages) failed:', err, {
        chatId, businessId, senderId: user.uid, hasText: !!trimmed, hasAttachments,
      });
      throw err;
    }

    // 2. Atualiza o chat: lastMessage + lastReadAt do sender. Preview do
    // lastMessage usa texto "limpo" (sem `<@uid>` markers) — fallback @uid se
    // o nome não estiver no `chats` ainda (raro: snapshot lag).
    const previewText = trimmed
      ? strippedMentions(trimmed, () => 'usuário')
      : buildAttachmentSummary(attachments!);

    try {
      await updateDoc(doc(db, 'teamChats', chatId), {
        lastMessage: {
          text: previewText,
          senderId: user.uid,
          senderName: user.name,
          sentAt: now,
        },
        lastMessageAt: now,
        [`lastReadAt.${user.uid}`]: now,
        updatedAt: now,
      });
    } catch (err) {
      console.error('[sendMessage] step 2 (updateDoc teamChats) failed:', err, {
        chatId, businessId, senderId: user.uid,
      });
      // NÃO throw — mensagem já foi criada (step 1 passou). UI vai mostrar a msg
      // via onSnapshot, só que o preview no header da lista pode ficar
      // desatualizado. Bug visual mas não data loss.
    }

    // 3. Cria notificação pra cada mencionado. Filtra antes pra apenas membros
    // do business — defesa contra mention manual `<@uid_de_outro_tenant>` que
    // criaria notification ruidosa (rules de notifications/ não validam o
    // userId é membro). Custo: 1 read por send (cacheado pelo Firestore).
    if (notifyTargets.length > 0) {
      const cleanText = strippedMentions(trimmed, () => 'usuário');
      const body = cleanText.length > 80 ? cleanText.slice(0, 77) + '…' : cleanText;

      let safeTargets = notifyTargets;
      try {
        const usersSnap = await getDocs(query(
          collection(db, 'users'),
          where('businessId', '==', businessId),
        ));
        const validUids = new Set(usersSnap.docs.map(d => d.id));
        safeTargets = notifyTargets.filter(uid => validUids.has(uid));
      } catch (err) {
        // Se falhar a validação, melhor não enviar nada do que enviar pra alvos
        // não validados — evita propagar lixo cross-tenant.
        console.warn('[useTeamChat] mention validation failed, skipping notifs:', err);
        safeTargets = [];
      }

      await Promise.all(safeTargets.map(targetUid =>
        addDoc(collection(db, 'notifications'), {
          businessId,
          userId: targetUid,
          type: 'chat_mentioned',
          title: `${user.name} te mencionou`,
          body,
          isRead: false,
          createdAt: now,
        }).catch(err => console.error('[useTeamChat] mention notif failed:', err))
      ));
    }
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

  // Typing indicator: debounce de writes pra evitar spam (1 a cada 2s).
  // Set false escreve `deleteField()` pra limpar a entrada — Firestore não
  // mantém garbage do user.
  const lastTypingWriteRef = useRef<Record<string, number>>({});
  const TYPING_DEBOUNCE_MS = 2000;
  const setTyping = useCallback(async (chatId: string, isTyping: boolean) => {
    if (!user || !businessId) return;
    const ref = doc(db, 'teamChats', chatId);
    if (!isTyping) {
      // Limpa imediatamente — writes de "parei de digitar" não são frequentes.
      try {
        await updateDoc(ref, { [`typing.${user.uid}`]: deleteField() });
      } catch {
        // Erros silenciosos — typing é cosmético, não vale alarme.
      }
      delete lastTypingWriteRef.current[chatId];
      return;
    }
    // Debounce: só escreve se passou >= TYPING_DEBOUNCE_MS desde o último.
    const now = Date.now();
    const last = lastTypingWriteRef.current[chatId] ?? 0;
    if (now - last < TYPING_DEBOUNCE_MS) return;
    lastTypingWriteRef.current[chatId] = now;
    try {
      await updateDoc(ref, { [`typing.${user.uid}`]: new Date(now).toISOString() });
    } catch {
      // Pode falhar se chat doc ainda não existir (ex: DM nova antes de send).
      // OK — typing aparece a partir da primeira mensagem.
      delete lastTypingWriteRef.current[chatId];
    }
  }, [user, businessId]);

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
    setTyping,
  };
}

// ─── Hook auxiliar: mensagens de UM chat ────────────────────────────────────

export function useTeamChatMessages(businessId: string | null, chatId: string | null, max = 50) {
  const [messages, setMessages] = useState<TeamChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!businessId || !chatId) { setMessages([]); return; }
    setLoading(true);
    // IMPORTANTE: o where('businessId') aqui é OBRIGATÓRIO mesmo que chatId já
    // restrinja o resultado. A rule de list em /teamChatMessages é
    //   allow list: if isOwnBusiness();          // resource.data.businessId == userBiz
    // O Firestore tem análise estática de constraints — quando a rule depende
    // de um campo que a query não filtra, ele rejeita o LIST inteiro com
    // permission-denied (não só docs individuais). Sem esse where, o listener
    // dispara erro mesmo se a rule estaria correta no run-time.
    //
    // ORDER: 'desc' + limit pega as N mensagens MAIS RECENTES — invertemos
    // client-side pra renderizar em ordem cronológica. Bug anterior usava
    // 'asc' + limit, o que pegava as N mais ANTIGAS — quando o chat passava
    // de N msgs, novas ficavam fora do limit e nunca apareciam na UI mesmo
    // sendo criadas no Firestore (sintoma: lastMessage da lista atualiza
    // mas o thread fica congelado nas primeiras N msgs).
    const q = query(
      collection(db, 'teamChatMessages'),
      where('businessId', '==', businessId),
      where('chatId', '==', chatId),
      orderBy('createdAt', 'desc'),
      limit(max),
    );
    const unsub = onSnapshot(q, snap => {
      // .reverse() pra exibir cronológico (asc) na UI sem mudar a query.
      const list = snap.docs
        .map(d => ({ ...d.data(), id: d.id } as TeamChatMessage))
        .reverse();
      setMessages(list);
      setLoading(false);
    }, err => {
      console.warn('[useTeamChatMessages] error:', err);
      setLoading(false);
    });
    return () => unsub();
  }, [businessId, chatId, max]);

  return { messages, loading };
}
