'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, Send, MessageSquare, Inbox, Instagram, Facebook, Check, CheckCheck, Star, AlertCircle, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/utils/format';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { db } from '@/lib/config/firebase';
import { collection, query, where, orderBy, addDoc, updateDoc, doc, onSnapshot } from 'firebase/firestore';
import { relativeTime, fullTime } from './shared';
import { WhatsAppIcon } from './SourceIcon';
import type { CRMContact, Conversation, ConversationMessage, ConversationChannel } from '@/lib/types';

const CHANNEL_CFG: Record<ConversationChannel, { label: string; color: string; textColor: string; bgColor: string }> = {
  whatsapp: { label: 'WhatsApp', color: '#25D366', textColor: 'text-[#25D366]', bgColor: 'bg-[#25D366]/10' },
  facebook: { label: 'Messenger', color: '#0866FF', textColor: 'text-[#0866FF]', bgColor: 'bg-[#0866FF]/10' },
  instagram: { label: 'Instagram', color: '#E1306C', textColor: 'text-[#E1306C]', bgColor: 'bg-[#E1306C]/10' },
};

export function OmnichannelInbox({ businessId, contacts }: { businessId: string; contacts: CRMContact[] }) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | ConversationChannel | 'comments'>('all');
  const [search, setSearch] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch conversations with error handling
  useEffect(() => {
    if (!businessId) return;
    setIsLoading(true);
    const q = query(
      collection(db, 'conversations'),
      where('businessId', '==', businessId),
      orderBy('lastMessageAt', 'desc'),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setConversations(snap.docs.map((d) => ({ ...d.data(), id: d.id } as Conversation)));
        setIsLoading(false);
      },
      (err) => {
        console.error('[OmnichannelInbox] Error fetching conversations:', err);
        setIsLoading(false);
      },
    );
    return () => unsub();
  }, [businessId]);

  // Fetch messages for selected conversation
  useEffect(() => {
    if (!selectedConv?.id || !businessId) return;
    const q = query(
      collection(db, 'conversationMessages'),
      where('businessId', '==', businessId),
      where('conversationId', '==', selectedConv.id),
      orderBy('sentAt', 'asc'),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setMessages(snap.docs.map((d) => ({ ...d.data(), id: d.id } as ConversationMessage)));
      },
      (err) => {
        console.error('[OmnichannelInbox] Error fetching messages for conversation:', selectedConv.id, err);
      },
    );
    return () => unsub();
  }, [selectedConv?.id, businessId]);

  // Auto scroll
  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  // Filtered conversations
  const filtered = useMemo(() => {
    let result = [...conversations];
    if (filter !== 'all' && filter !== 'comments') {
      result = result.filter((c) => c.channel === filter);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((c) => c.contactName.toLowerCase().includes(q) || c.lastMessage.toLowerCase().includes(q));
    }
    return result;
  }, [conversations, filter, search]);

  // Send message with robust error handling
  const handleSend = useCallback(async () => {
    const content = messageInput.trim();
    if (!content || !selectedConv || !businessId || !user || isSending) return;
    setMessageInput('');
    setIsSending(true);
    const now = new Date().toISOString();
    try {
      // 1. Persist message to Firestore — capture the doc ID
      const msgRef = await addDoc(collection(db, 'conversationMessages'), {
        conversationId: selectedConv.id,
        businessId,
        channel: selectedConv.channel,
        direction: 'outbound' as const,
        content,
        status: 'sending' as const,
        senderName: user.name,
        sentAt: now,
      });

      // 2. Update conversation metadata
      await updateDoc(doc(db, 'conversations', selectedConv.id), {
        lastMessage: content,
        lastMessageAt: now,
        lastMessageDirection: 'outbound',
        updatedAt: now,
      });

      // 3. Send via Meta API — pass messageDocId so backend updates sending → sent
      try {
        const { getAuth } = await import('firebase/auth');
        const auth = getAuth();
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch('/api/conversations/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            businessId,
            conversationId: selectedConv.id,
            messageDocId: msgRef.id,
            channel: selectedConv.channel,
            recipientId: selectedConv.contactExternalId,
            content,
          }),
        });
        if (!res.ok) {
          console.error('[OmnichannelInbox] API /api/conversations/send returned', res.status, await res.text().catch(() => ''));
          // API falhou — marcar como failed no Firestore
          await updateDoc(doc(db, 'conversationMessages', msgRef.id), { status: 'failed' }).catch(() => {});
        }
      } catch (apiErr) {
        console.error('[OmnichannelInbox] Network error calling /api/conversations/send:', apiErr);
        // Rede falhou — marcar como failed
        await updateDoc(doc(db, 'conversationMessages', msgRef.id), { status: 'failed' }).catch(() => {});
      }
    } catch (err) {
      console.error('[OmnichannelInbox] Firestore write failed:', err);
      setMessageInput(content);
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  }, [messageInput, selectedConv, businessId, user, isSending]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // Find linked CRM contact
  const linkedContact = useMemo(() => {
    if (!selectedConv) return null;
    return contacts.find((c) =>
      c.channelIdentities?.whatsapp === selectedConv.contactExternalId ||
      c.channelIdentities?.instagram === selectedConv.contactExternalId ||
      c.channelIdentities?.facebook === selectedConv.contactExternalId ||
      c.name.toLowerCase() === selectedConv.contactName.toLowerCase()
    ) || null;
  }, [selectedConv, contacts]);

  // Mark conversation as read
  const handleSelectConversation = useCallback((conv: Conversation) => {
    setSelectedConv(conv);
    if (conv.unreadCount > 0) {
      updateDoc(doc(db, 'conversations', conv.id), { unreadCount: 0, updatedAt: new Date().toISOString() })
        .catch((err) => console.error('[OmnichannelInbox] Failed to mark as read:', err));
    }
  }, []);

  return (
    <div className="flex h-[calc(100vh-280px)] min-h-[500px] bg-white dark:bg-[#0a0e17] rounded-2xl border border-gray-100 dark:border-gray-700/50 overflow-hidden">
      {/* Conversation list */}
      <div className="w-[320px] shrink-0 border-r border-gray-100 dark:border-white/[0.06] flex flex-col">
        {/* Filter tabs */}
        <div className="px-3 pt-3 pb-2 shrink-0">
          <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {([
              { id: 'all' as const, label: 'Todos' },
              { id: 'whatsapp' as const, label: 'WhatsApp' },
              { id: 'instagram' as const, label: 'Instagram' },
              { id: 'facebook' as const, label: 'Messenger' },
              { id: 'comments' as const, label: 'Comentários' },
            ] as const).map((tab) => (
              <button key={tab.id} onClick={() => setFilter(tab.id)}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-[10px] font-semibold whitespace-nowrap transition-all',
                  filter === tab.id
                    ? 'bg-gray-900 dark:bg-white/[0.12] text-white'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input type="text" placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-100 dark:bg-white/[0.04] border border-transparent dark:border-white/[0.06] rounded-lg text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-red-500/50 transition-colors"
            />
          </div>
        </div>

        {/* Conversations */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-2.5 p-2">
                  <div className="w-9 h-9 rounded-full shimmer shrink-0" />
                  <div className="flex-1 space-y-1.5"><div className="h-3 w-24 rounded shimmer" /><div className="h-2.5 w-full rounded shimmer" /></div>
                </div>
              ))}
            </div>
          ) : filter === 'comments' ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="w-10 h-10 rounded-2xl bg-purple-50 dark:bg-purple-500/10 flex items-center justify-center mb-3">
                <MessageSquare size={20} className="text-purple-500/60" />
              </div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Gestão de Comentários</p>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
                Comentários do Instagram e Facebook aparecerão aqui quando o webhook estiver configurado.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <MessageSquare size={24} className="text-gray-300 dark:text-gray-600 mb-2" />
              <p className="text-xs text-gray-400 dark:text-gray-500">{conversations.length === 0 ? 'Nenhuma conversa' : 'Nenhum resultado'}</p>
            </div>
          ) : (
            filtered.map((conv) => {
              const cfg = CHANNEL_CFG[conv.channel];
              const isActive = selectedConv?.id === conv.id;
              return (
                <button
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv)}
                  className={cn(
                    'w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors border-l-2',
                    isActive ? 'bg-red-50 dark:bg-red-500/[0.06] border-red-500' : 'border-transparent hover:bg-gray-50 dark:hover:bg-white/[0.02]',
                  )}
                >
                  <div className="relative shrink-0">
                    {conv.contactAvatarUrl ? (
                      <img
                        src={conv.contactAvatarUrl}
                        alt={conv.contactName}
                        className="w-9 h-9 rounded-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-[10px] font-bold', cfg.bgColor, cfg.textColor)}>
                        {getInitials(conv.contactName)}
                      </div>
                    )}
                    <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-white dark:bg-[#0a0e17] flex items-center justify-center">
                      {conv.channel === 'whatsapp' && <WhatsAppIcon className="w-2.5 h-2.5 text-[#25D366]" />}
                      {conv.channel === 'instagram' && <Instagram className="w-2.5 h-2.5 text-[#E1306C]" />}
                      {conv.channel === 'facebook' && <Facebook className="w-2.5 h-2.5 text-[#0866FF]" />}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className={cn('text-xs font-semibold truncate', isActive ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100')}>
                        {conv.contactName}
                      </span>
                      <span className="text-[9px] text-gray-400 dark:text-gray-500 shrink-0">{relativeTime(conv.lastMessageAt)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                        {conv.lastMessageDirection === 'outbound' && <span className="text-gray-400 mr-1">Você:</span>}
                        {conv.lastMessage}
                      </p>
                      {conv.unreadCount > 0 && (
                        <span className="shrink-0 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-1">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedConv ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-red-600/15 to-red-500/10 flex items-center justify-center border border-red-500/20">
              <Inbox size={24} className="text-red-500/60" />
            </div>
            <div className="text-center">
              <h3 className="font-display font-bold text-gray-700 dark:text-gray-200 text-sm mb-1">Caixa de Entrada</h3>
              <p className="text-xs text-gray-400 dark:text-gray-500">Selecione uma conversa para visualizar as mensagens</p>
            </div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-[#111827] border-b border-gray-100 dark:border-white/[0.06] shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                {selectedConv.contactAvatarUrl ? (
                  <img
                    src={selectedConv.contactAvatarUrl}
                    alt={selectedConv.contactName}
                    className="w-8 h-8 rounded-full object-cover shrink-0"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold', CHANNEL_CFG[selectedConv.channel].bgColor, CHANNEL_CFG[selectedConv.channel].textColor)}>
                    {getInitials(selectedConv.contactName)}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">{selectedConv.contactName}</span>
                    <span className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded-full', CHANNEL_CFG[selectedConv.channel].bgColor, CHANNEL_CFG[selectedConv.channel].textColor)}>
                      {CHANNEL_CFG[selectedConv.channel].label}
                    </span>
                  </div>
                  {linkedContact && (
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                      <Star size={8} className="text-amber-400" /> Lead vinculado: {linkedContact.name}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-white/10">
              {messages.map((msg) => {
                const isOut = msg.direction === 'outbound';
                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn('flex', isOut ? 'justify-end' : 'justify-start', 'mt-2')}
                  >
                    <div className="max-w-[70%]">
                      {msg.content && (
                        <div className={cn(
                          'px-3 py-2 text-sm leading-relaxed shadow-sm',
                          isOut
                            ? 'bg-gradient-to-br from-red-600 to-red-500 text-white rounded-2xl rounded-tr-sm'
                            : 'bg-white dark:bg-[#1e293b] border border-gray-100 dark:border-gray-700/50 text-gray-800 dark:text-gray-100 rounded-2xl rounded-tl-sm',
                        )}>
                          {msg.content}
                        </div>
                      )}
                      <div className={cn('flex items-center gap-1 mt-0.5 px-1', isOut ? 'flex-row-reverse' : 'flex-row')}>
                        <span className="text-[9px] text-gray-400 dark:text-gray-500">{fullTime(msg.sentAt)}</span>
                        {isOut && msg.status === 'sending' && <Clock className="w-3 h-3 text-white/50" />}
                        {isOut && msg.status === 'sent' && <Check className="w-3 h-3 text-white/70" />}
                        {isOut && msg.status === 'delivered' && <CheckCheck className="w-3 h-3 text-white/70" />}
                        {isOut && msg.status === 'read' && <CheckCheck className="w-3 h-3 text-sky-300" />}
                        {isOut && msg.status === 'failed' && <AlertCircle className="w-3 h-3 text-red-300" />}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Composer */}
            <div className="px-4 py-3 bg-white dark:bg-[#111827] border-t border-gray-100 dark:border-white/[0.06] shrink-0">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  placeholder="Digite uma mensagem..."
                  disabled={isSending}
                  className="flex-1 resize-none bg-gray-100 dark:bg-white/[0.04] border border-transparent dark:border-white/[0.06] rounded-2xl px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-red-500/50 transition-colors max-h-28 overflow-y-auto disabled:opacity-50"
                  style={{ minHeight: '40px' }}
                />
                <motion.button
                  onClick={handleSend}
                  whileHover={messageInput.trim() ? { scale: 1.05 } : undefined}
                  whileTap={messageInput.trim() ? { scale: 0.95 } : undefined}
                  disabled={!messageInput.trim() || isSending}
                  className={cn(
                    'w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 transition-all shadow-sm mb-0.5',
                    messageInput.trim() && !isSending
                      ? 'bg-gradient-to-br from-red-600 to-red-500 text-white shadow-red-500/30 shadow-md'
                      : 'bg-gray-100 dark:bg-white/[0.06] text-gray-400 cursor-not-allowed',
                  )}
                >
                  <Send className={cn('w-4 h-4', messageInput.trim() && 'translate-x-0.5 -translate-y-0.5')} />
                </motion.button>
              </div>
              <div className="flex items-center gap-1 mt-1 px-1">
                <span className={cn('text-[9px] font-medium', CHANNEL_CFG[selectedConv.channel].textColor)}>
                  {CHANNEL_CFG[selectedConv.channel].label}
                </span>
                <span className="text-[9px] text-gray-400 dark:text-gray-600 ml-auto">Enter para enviar</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
