'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, Send, MessageSquare, Inbox, Instagram, Facebook, Check, CheckCheck, Star, AlertCircle, Clock, Trash2, X, Loader2, RefreshCw, FileText, Headphones, Play, Paperclip, Mic, Square, Image as ImageIcon } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { motion } from 'framer-motion';
import { toast } from 'react-toastify';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/utils/format';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { db, storage } from '@/lib/config/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
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
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

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
        // Filter out soft-deleted conversations
        const docs = snap.docs
          .map((d) => ({ ...d.data(), id: d.id } as Conversation & { isDeleted?: boolean }))
          .filter((c) => !c.isDeleted);
        setConversations(docs);
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

  // ── File attachment helpers ──────────────────────────────────────────────────

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) {
      toast.warn('Arquivo muito grande. Máximo 16MB.');
      return;
    }
    setAttachment(file);
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setAttachmentPreview(url);
    } else {
      setAttachmentPreview(null);
    }
    e.target.value = '';
  }, []);

  const clearAttachment = useCallback(() => {
    if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
    setAttachment(null);
    setAttachmentPreview(null);
  }, [attachmentPreview]);

  const detectMediaType = (file: File): 'image' | 'video' | 'audio' | 'document' => {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    return 'document';
  };

  // ── Audio recording ────────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/ogg; codecs=opus' });
        const file = new File([blob], `audio_${Date.now()}.ogg`, { type: 'audio/ogg' });
        setAttachment(file);
        setAttachmentPreview(null);
        setIsRecording(false);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      toast.error('Não foi possível acessar o microfone.');
    }
  }, []);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  }, []);

  // ── Drag & Drop handlers ──────────────────────────────────────────────────

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) {
      toast.warn('Arquivo muito grande. Máximo 16MB.');
      return;
    }
    setAttachment(file);
    if (file.type.startsWith('image/')) {
      setAttachmentPreview(URL.createObjectURL(file));
    } else {
      setAttachmentPreview(null);
    }
  }, []);

  // ── Send message (text and/or media) ───────────────────────────────────────

  const handleSend = useCallback(async () => {
    const content = messageInput.trim();
    const hasText = content.length > 0;
    const hasFile = !!attachment;
    if ((!hasText && !hasFile) || !selectedConv || !businessId || !user || isSending) return;

    setMessageInput('');
    const currentFile = attachment;
    clearAttachment();
    setIsSending(true);
    const now = new Date().toISOString();

    try {
      // Determine media info
      let mediaUrl: string | undefined;
      let mediaType: 'image' | 'video' | 'audio' | 'document' | undefined;
      // For the chat bubble: show only real text from the user (empty string for media-only)
      const bubbleContent = hasText ? content : '';
      // For conversation sidebar preview: show media type label when no text
      const MEDIA_LABELS: Record<string, string> = { image: '[Imagem]', video: '[Video]', audio: '[Audio]', document: '[Documento]' };
      const previewContent = hasText ? content : (currentFile ? MEDIA_LABELS[detectMediaType(currentFile)] || '[Midia]' : '');

      // Upload file to Firebase Storage first
      if (currentFile) {
        mediaType = detectMediaType(currentFile);
        const storagePath = `conversations/${businessId}/${selectedConv.id}/${Date.now()}_${currentFile.name}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, currentFile, { contentType: currentFile.type });
        mediaUrl = await getDownloadURL(storageRef);
      }

      // 1. Persist message to Firestore
      const msgData: Record<string, unknown> = {
        conversationId: selectedConv.id,
        businessId,
        channel: selectedConv.channel,
        direction: 'outbound',
        content: bubbleContent,
        status: 'sending',
        senderName: user.name,
        sentAt: now,
      };
      if (mediaUrl) msgData.mediaUrl = mediaUrl;
      if (mediaType) msgData.mediaType = mediaType;
      const msgRef = await addDoc(collection(db, 'conversationMessages'), msgData);

      // 2. Update conversation metadata
      await updateDoc(doc(db, 'conversations', selectedConv.id), {
        lastMessage: previewContent,
        lastMessageAt: now,
        lastMessageDirection: 'outbound',
        updatedAt: now,
      });

      // 3. Send via backend API
      try {
        const { getAuth } = await import('firebase/auth');
        const auth = getAuth();
        const token = await auth.currentUser?.getIdToken();

        const sendBody: Record<string, unknown> = {
          businessId,
          conversationId: selectedConv.id,
          messageDocId: msgRef.id,
          channel: selectedConv.channel,
          recipientId: selectedConv.contactExternalId,
          content: hasText ? content : '',
        };
        if (mediaUrl && mediaType) {
          sendBody.type = 'media';
          sendBody.mediaUrl = mediaUrl;
          sendBody.mediaType = mediaType;
        }

        const res = await fetch('/api/conversations/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(sendBody),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({ code: 'unknown' }));
          if (errBody.code === 'disconnected' || errBody.code === 'token_expired') {
            const channelNames: Record<string, string> = { whatsapp: 'WhatsApp', facebook: 'Facebook Messenger', instagram: 'Instagram' };
            toast.warn(`${channelNames[selectedConv.channel] || 'Canal'} está desconectado. Reconecte nas Configurações para enviar mensagens.`);
          } else {
            console.error('[OmnichannelInbox] Send failed:', errBody);
          }
          await updateDoc(doc(db, 'conversationMessages', msgRef.id), { status: 'failed' }).catch(() => {});
        }
      } catch (apiErr) {
        console.error('[OmnichannelInbox] Network error:', apiErr);
        toast.error('Erro de conexão. Verifique sua internet e tente novamente.');
        await updateDoc(doc(db, 'conversationMessages', msgRef.id), { status: 'failed' }).catch(() => {});
      }
    } catch (err) {
      console.error('[OmnichannelInbox] Firestore write failed:', err);
      if (hasText) setMessageInput(content);
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  }, [messageInput, attachment, selectedConv, businessId, user, isSending, clearAttachment]);

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
    console.log(
      `%c[AUDITORIA] Conversa selecionada`,
      'color: #25D366; font-weight: bold; font-size: 13px;',
      '\n  Canal:', conv.channel,
      '\n  Conversa ID:', conv.id,
      '\n  Contato Nome:', conv.contactName,
      '\n  Contato Externo ID:', conv.contactExternalId ?? '(vazio)',
      '\n  Telefone:', conv.contactPhone ?? '(vazio)',
      '\n  Avatar URL:', conv.contactAvatarUrl ? '✓ presente' : '(vazio)',
      '\n  CRM Contact ID:', (conv as unknown as Record<string, unknown>).crmContactId ?? '(não vinculado)',
      '\n  Status:', conv.status,
      '\n  Unread:', conv.unreadCount,
    );
    setSelectedConv(conv);
    if (conv.unreadCount > 0) {
      updateDoc(doc(db, 'conversations', conv.id), { unreadCount: 0, updatedAt: new Date().toISOString() })
        .catch((err) => console.error('[OmnichannelInbox] Failed to mark as read:', err));
    }
  }, []);

  const handleDeleteConversation = useCallback(async () => {
    if (!selectedConv || isDeleting) return;
    setIsDeleting(true);
    try {
      const { getAuth } = await import('firebase/auth');
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch(
        `/api/conversations/${selectedConv.id}?businessId=${encodeURIComponent(businessId)}`,
        {
          method: 'DELETE',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erro ao excluir');
      }
      // Remove from local state immediately (optimistic update)
      const deletedId = selectedConv.id;
      setConversations((prev) => prev.filter((c) => c.id !== deletedId));
      setIsDeleteModalOpen(false);
      setSelectedConv(null);
      setMessages([]);
      toast.success('Conversa excluída com sucesso');
    } catch (err) {
      console.error('[OmnichannelInbox] Delete failed:', err);
      toast.error('Erro ao excluir conversa');
    } finally {
      setIsDeleting(false);
    }
  }, [selectedConv, businessId, isDeleting]);

  const handleSync = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const { getAuth } = await import('firebase/auth');
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch('/api/conversations/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ businessId }),
      });
      const data = await res.json();
      if (data.success) {
        const { stats } = data;
        toast.success(
          `Sincronizado: ${stats.messagesImported} mensagens novas, ${stats.conversationsSynced} conversas`,
        );
      } else {
        toast.error(data.error || 'Erro ao sincronizar');
      }
    } catch (err) {
      console.error('[OmnichannelInbox] Sync failed:', err);
      toast.error('Erro ao sincronizar com a Meta');
    } finally {
      setIsSyncing(false);
    }
  }, [businessId, isSyncing]);

  return (
    <div className="flex flex-1 min-h-0 h-0 bg-white dark:bg-[#0a0e17] rounded-2xl border border-gray-100 dark:border-gray-700/50 overflow-hidden">
      {/* Conversation list */}
      <div className="w-[320px] shrink-0 border-r border-gray-100 dark:border-white/[0.06] flex flex-col min-h-0">
        {/* Filter tabs */}
        <div className="px-3 pt-3 pb-2 shrink-0">
          <div className="flex flex-wrap gap-1">
            {([
              { id: 'all' as const, label: 'Todos' },
              { id: 'whatsapp' as const, label: 'WhatsApp' },
              { id: 'instagram' as const, label: 'Instagram' },
              { id: 'facebook' as const, label: 'Messenger' },
              { id: 'comments' as const, label: 'Comentários' },
            ] as const).map((tab) => (
              <button key={tab.id} onClick={() => setFilter(tab.id)}
                className={cn(
                  'px-2 py-1 rounded-lg text-[10px] font-semibold whitespace-nowrap transition-all',
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

        {/* Search + Sync */}
        <div className="px-3 pb-2 flex gap-1.5">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input type="text" placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-100 dark:bg-white/[0.04] border border-transparent dark:border-white/[0.06] rounded-lg text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-red-500/50 transition-colors"
            />
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleSync}
            disabled={isSyncing}
            className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors',
              'bg-gray-100 dark:bg-white/[0.06] text-gray-400 hover:text-red-500 dark:hover:text-red-400',
              isSyncing && 'opacity-60 cursor-not-allowed',
            )}
            title="Sincronizar mensagens da Meta"
          >
            <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
          </motion.button>
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
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
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
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setIsDeleteModalOpen(true)}
                className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors shrink-0"
                title="Excluir conversa"
              >
                <Trash2 size={14} />
              </motion.button>
            </div>

            {/* Messages (drop zone) */}
            <div
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className={cn(
                'flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-1 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-white/10 relative transition-colors duration-200',
                isDragging && 'bg-red-50/50 dark:bg-red-500/[0.04]',
              )}
            >
              {/* Drag overlay */}
              <AnimatePresence>
                {isDragging && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 dark:bg-[#0a0e17]/80 backdrop-blur-sm rounded-xl border-2 border-dashed border-red-400 dark:border-red-500/50 pointer-events-none"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
                        <Paperclip size={22} className="text-red-500" />
                      </div>
                      <p className="text-sm font-semibold text-red-600 dark:text-red-400">Solte o arquivo aqui</p>
                      <p className="text-[10px] text-gray-400">Imagem, vídeo, áudio ou documento (max 16MB)</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              {messages.map((msg) => {
                const isOut = msg.direction === 'outbound';
                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn('flex', isOut ? 'justify-end' : 'justify-start', 'mt-2')}
                  >
                    <div className={cn('max-w-[70%] flex flex-col', isOut ? 'items-end' : 'items-start')}>
                      {/* Media attachment */}
                      {msg.mediaUrl && msg.mediaType === 'image' && (
                        <div className="mb-1 rounded-xl overflow-hidden max-w-[240px]">
                          <img src={msg.mediaUrl} alt="Imagem" className="w-full h-auto object-cover rounded-xl" loading="lazy" />
                        </div>
                      )}
                      {msg.mediaUrl && msg.mediaType === 'video' && (
                        <div className="mb-1 rounded-xl overflow-hidden max-w-[240px] bg-black/10 dark:bg-white/5">
                          <video src={msg.mediaUrl} className="w-full h-auto rounded-xl max-h-[200px]" controls preload="metadata" />
                        </div>
                      )}
                      {msg.mediaUrl && msg.mediaType === 'audio' && (
                        <div className="mb-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-black/5 dark:bg-white/5 min-w-[200px]">
                          <Headphones className="w-4 h-4 text-gray-400 shrink-0" />
                          <audio src={msg.mediaUrl} controls className="h-8 flex-1" preload="metadata" style={{ maxWidth: '220px' }} />
                        </div>
                      )}
                      {msg.mediaUrl && msg.mediaType === 'document' && (
                        <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer"
                          className="mb-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors min-w-[160px]">
                          <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {msg.content?.replace(/^\[(Documento|Audio|Video|Imagem)\]\s?/, '') || 'Documento'}
                          </span>
                        </a>
                      )}

                      {/* Text content (skip placeholder texts for pure media messages) */}
                      {msg.content && !(/^\[(Imagem|Audio|Video|Sticker|Documento)\]$/.test(msg.content)) && (
                        <div className={cn(
                          'px-3 py-2 text-sm leading-relaxed shadow-sm',
                          isOut
                            ? 'bg-gradient-to-br from-red-600 to-red-500 text-white rounded-2xl rounded-tr-sm'
                            : 'bg-white dark:bg-[#1e293b] border border-gray-100 dark:border-gray-700/50 text-gray-800 dark:text-gray-100 rounded-2xl rounded-tl-sm',
                        )}>
                          {msg.content}
                        </div>
                      )}

                      {/* Timestamp + status */}
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
              {/* Attachment preview */}
              <AnimatePresence>
                {attachment && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mb-2 overflow-hidden"
                  >
                    <div className="flex items-center gap-3 p-2.5 rounded-xl bg-gray-50 dark:bg-white/[0.04] border border-gray-200/60 dark:border-white/[0.08]">
                      {attachmentPreview ? (
                        <img src={attachmentPreview} alt="Preview" className="w-12 h-12 rounded-lg object-cover shrink-0" />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center shrink-0">
                          {attachment.type.startsWith('audio/') ? <Headphones className="w-5 h-5 text-gray-400" /> :
                           attachment.type.startsWith('video/') ? <Play className="w-5 h-5 text-gray-400" /> :
                           <FileText className="w-5 h-5 text-gray-400" />}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{attachment.name}</p>
                        <p className="text-[10px] text-gray-400">{(attachment.size / 1024).toFixed(1)} KB</p>
                      </div>
                      <button onClick={clearAttachment} className="w-6 h-6 rounded-lg bg-gray-200 dark:bg-white/[0.08] flex items-center justify-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors shrink-0">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Input row */}
              <div className="flex items-end gap-2">
                {/* Left actions: clip + mic */}
                <div className="flex items-center gap-0.5 pb-1">
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => fileInputRef.current?.click()}
                    className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
                    title="Anexar arquivo"
                  >
                    <Paperclip className="w-4 h-4" />
                  </motion.button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={isRecording ? stopRecording : startRecording}
                    className={cn(
                      'w-8 h-8 rounded-xl flex items-center justify-center transition-colors',
                      isRecording
                        ? 'text-red-500 bg-red-50 dark:bg-red-500/10 animate-pulse'
                        : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06]',
                    )}
                    title={isRecording ? 'Parar gravação' : 'Gravar áudio'}
                  >
                    {isRecording ? <Square className="w-3.5 h-3.5" /> : <Mic className="w-4 h-4" />}
                  </motion.button>
                </div>

                {/* Textarea */}
                <textarea
                  ref={inputRef}
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  placeholder={isRecording ? 'Gravando áudio...' : 'Digite uma mensagem...'}
                  disabled={isSending || isRecording}
                  className="flex-1 resize-none bg-gray-100 dark:bg-white/[0.04] border border-transparent dark:border-white/[0.06] rounded-2xl px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-red-500/50 transition-colors max-h-28 overflow-y-auto disabled:opacity-50"
                  style={{ minHeight: '40px' }}
                />

                {/* Send button */}
                <motion.button
                  onClick={handleSend}
                  whileHover={(messageInput.trim() || attachment) ? { scale: 1.05 } : undefined}
                  whileTap={(messageInput.trim() || attachment) ? { scale: 0.95 } : undefined}
                  disabled={(!messageInput.trim() && !attachment) || isSending}
                  className={cn(
                    'w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 transition-all shadow-sm mb-0.5',
                    (messageInput.trim() || attachment) && !isSending
                      ? 'bg-gradient-to-br from-red-600 to-red-500 text-white shadow-red-500/30 shadow-md'
                      : 'bg-gray-100 dark:bg-white/[0.06] text-gray-400 cursor-not-allowed',
                  )}
                >
                  {isSending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className={cn('w-4 h-4', (messageInput.trim() || attachment) && 'translate-x-0.5 -translate-y-0.5')} />
                  )}
                </motion.button>
              </div>

              {/* Footer hints */}
              <div className="flex items-center gap-1 mt-1 px-1">
                <span className={cn('text-[9px] font-medium', CHANNEL_CFG[selectedConv.channel].textColor)}>
                  {CHANNEL_CFG[selectedConv.channel].label}
                </span>
                <span className="text-[9px] text-gray-400 dark:text-gray-600 ml-auto">
                  {isRecording ? 'Clique no quadrado para parar' : 'Enter para enviar'}
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {isDeleteModalOpen && selectedConv && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => !isDeleting && setIsDeleteModalOpen(false)}
          >
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="relative z-10 w-full max-w-sm bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-black/[0.06] dark:border-white/[0.08] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/[0.06]">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
                    <Trash2 size={18} className="text-red-500" />
                  </div>
                  <h3 className="font-display font-bold text-gray-900 dark:text-white text-sm">
                    Excluir Conversa?
                  </h3>
                </div>
                <button
                  onClick={() => !isDeleting && setIsDeleteModalOpen(false)}
                  disabled={isDeleting}
                  className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:opacity-50"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Body */}
              <div className="px-6 py-5">
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                  A conversa com <strong className="text-gray-900 dark:text-white">{selectedConv.contactName}</strong> e todas as suas mensagens serão excluídas permanentemente.
                </p>
                <div className="flex items-start gap-2 mt-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20">
                  <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                    Esta ação é irreversível. O histórico de mensagens não poderá ser recuperado.
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 px-6 pb-5">
                <button
                  onClick={() => setIsDeleteModalOpen(false)}
                  disabled={isDeleting}
                  className="px-4 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-white/[0.06] rounded-xl hover:bg-gray-200 dark:hover:bg-white/[0.1] transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleDeleteConversation}
                  disabled={isDeleting}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-gradient-to-br from-red-600 to-red-500 rounded-xl shadow-sm shadow-red-500/30 hover:shadow-md hover:shadow-red-500/40 transition-all disabled:opacity-50"
                >
                  {isDeleting ? (
                    <><Loader2 size={14} className="animate-spin" /> Excluindo...</>
                  ) : (
                    <><Trash2 size={14} /> Excluir</>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
