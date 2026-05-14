'use client';

/**
 * QuickRepliesTab — CRUD de respostas rápidas (snippets) usadas no composer
 * de Conversas. Operador digita "/" e o autocomplete sugere snippets pelo
 * shortcode.
 *
 * Estrutura: snippets/{id} com shortcode, content, category?, sectorId?.
 * Filtragem: busca por shortcode/conteúdo + filtro por setor.
 *
 * Permissões: manager+ pode criar/editar/excluir (operator/viewer apenas
 * leitura). Restrição imposta na UI; segurança real fica nas regras
 * Firestore (fora deste componente).
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { cn } from '@/lib/utils';
import {
  Zap, Plus, Search, Edit3, Trash2, Save, X, Loader2,
  AlertTriangle, Hash, FileText, Paperclip, Image as ImageIcon, Video, Headphones,
} from 'lucide-react';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { Snippet } from '@/lib/types';

const MAX_SHORTCODE_LEN = 32;
const MAX_CONTENT_LEN = 2000;
const MAX_CATEGORY_LEN = 40;

// Regex: shortcode permite a-z, 0-9, _, - (sem espaços, sem acentos pra
// evitar surpresas no autocomplete). Operador digita "/promocao" → match.
const SHORTCODE_RE = /^[a-z0-9_-]+$/;

interface FormState {
  id?: string;            // edição se preenchido
  shortcode: string;
  content: string;
  category: string;
  sectorId: string;
  /** Mídia atual gravada (vinda do doc original em edição). Pode ser substituída
   *  por `pendingMedia` (upload novo) ou marcada pra remoção (`removeMedia`). */
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'document';
  fileName?: string;
  mediaStoragePath?: string;
  /** Arquivo selecionado mas ainda não enviado pro Storage. Faz upload no save. */
  pendingMedia: File | null;
  /** Flag pra deletar a mídia atual no save sem substituir (operador clicou X
   *  num snippet em edição). Ignorado quando há `pendingMedia` (sobrescreve). */
  removeMedia: boolean;
}

const EMPTY_FORM: FormState = {
  shortcode: '', content: '', category: '', sectorId: '',
  pendingMedia: null, removeMedia: false,
};

// Limites Cloud (paridade com Composer): image 5, video 16, audio 16, doc 25.
// A storage.rule é 25MB no path snippets/ — usamos esses limites mais finos
// no client pra dar erro cedo (sem subir e tomar deny).
const MEDIA_LIMITS_MB = { image: 5, video: 16, audio: 16, document: 25 } as const;
function detectMediaType(file: File): 'image' | 'video' | 'audio' | 'document' {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'document';
}
function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export default function QuickRepliesTab() {
  const { user, business, sectors } = useAuth();
  const canEdit = ROLE_HIERARCHY[user?.role ?? 'viewer'] >= ROLE_HIERARCHY['manager'];

  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterSectorId, setFilterSectorId] = useState<string>(''); // '' = todos
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Snippet | null>(null);

  // Mount-check pra createPortal: document.body só existe no browser. Evita
  // hydration mismatch no SSR. Mesmo padrão do RecurrenceDetailDialog.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Lê + valida o arquivo selecionado. Limites por tipo (igual Composer):
  // image 5MB, video/audio 16MB, document 25MB.
  const handleSelectMedia = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const mediaType = detectMediaType(file);
    const limitMb = MEDIA_LIMITS_MB[mediaType];
    if (file.size > limitMb * 1024 * 1024) {
      toast.error(`Arquivo excede limite (${limitMb}MB)`);
      e.target.value = '';
      return;
    }
    setForm(f => ({ ...f, pendingMedia: file, removeMedia: false }));
    e.target.value = ''; // permite re-selecionar o mesmo arquivo
  }, []);

  const handleRemoveMedia = useCallback(() => {
    setForm(f => ({
      ...f,
      pendingMedia: null,
      // Se há mídia salva (edição), marca pra delete no save. Pra "nova
      // resposta" não precisa flag — basta limpar pendingMedia.
      removeMedia: !!f.mediaUrl,
    }));
  }, []);

  // ── Subscribe Firestore ────────────────────────────────────────────────
  useEffect(() => {
    if (!business?.id) return;
    const q = query(collection(db, 'snippets'), where('businessId', '==', business.id));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map(d => ({ ...(d.data() as Snippet), id: d.id }));
        // Ordena por shortcode pra leitura previsível
        list.sort((a, b) => a.shortcode.localeCompare(b.shortcode));
        setSnippets(list);
        setLoading(false);
      },
      (err) => {
        console.error('[QuickReplies] snapshot error:', err);
        setLoading(false);
        toast.error('Erro ao carregar respostas rápidas');
      },
    );
    return () => unsub();
  }, [business?.id]);

  // ── Filtered list ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return snippets.filter(snip => {
      if (filterSectorId && snip.sectorId !== filterSectorId) {
        // 'global' se filterSectorId é especificamente 'global', mostra só globais (sem sectorId)
        if (filterSectorId === 'global') return !snip.sectorId;
        return false;
      }
      if (!s) return true;
      return snip.shortcode.toLowerCase().includes(s)
        || snip.content.toLowerCase().includes(s)
        || (snip.category || '').toLowerCase().includes(s);
    });
  }, [snippets, search, filterSectorId]);

  // ── Handlers ───────────────────────────────────────────────────────────
  const openCreate = useCallback(() => {
    if (!canEdit) return;
    setForm(EMPTY_FORM);
    setShowForm(true);
  }, [canEdit]);

  const openEdit = useCallback((snip: Snippet) => {
    if (!canEdit) return;
    setForm({
      id: snip.id,
      shortcode: snip.shortcode,
      content: snip.content,
      category: snip.category || '',
      sectorId: snip.sectorId || '',
      mediaUrl: snip.mediaUrl,
      mediaType: snip.mediaType,
      fileName: snip.fileName,
      mediaStoragePath: snip.mediaStoragePath,
      pendingMedia: null,
      removeMedia: false,
    });
    setShowForm(true);
  }, [canEdit]);

  const closeForm = useCallback(() => {
    setShowForm(false);
    setForm(EMPTY_FORM);
  }, []);

  const handleSave = useCallback(async () => {
    if (!business?.id || !user) return;
    const shortcode = form.shortcode.trim().toLowerCase();
    const content = form.content.trim();
    const category = form.category.trim();
    const hasMedia = !!form.pendingMedia || (!!form.mediaUrl && !form.removeMedia);

    if (!shortcode) { toast.error('Atalho é obrigatório'); return; }
    if (!SHORTCODE_RE.test(shortcode)) {
      toast.error('Atalho aceita apenas letras minúsculas, números, hífen e underline (ex: ola, fim_dia, promo-bf)');
      return;
    }
    if (shortcode.length > MAX_SHORTCODE_LEN) {
      toast.error(`Atalho excede ${MAX_SHORTCODE_LEN} caracteres`);
      return;
    }
    // Mensagem é obrigatória SÓ se não houver mídia. Snippet apenas-mídia
    // (PDF de orçamento, foto de cardápio) é caso de uso válido.
    if (!content && !hasMedia) { toast.error('Mensagem ou mídia obrigatória'); return; }
    if (content.length > MAX_CONTENT_LEN) {
      toast.error(`Mensagem excede ${MAX_CONTENT_LEN} caracteres`);
      return;
    }
    if (category.length > MAX_CATEGORY_LEN) {
      toast.error(`Categoria excede ${MAX_CATEGORY_LEN} caracteres`);
      return;
    }

    // Detecta duplicidade de shortcode (excluindo o próprio em edição)
    const dup = snippets.find(s =>
      s.shortcode.toLowerCase() === shortcode && s.id !== form.id,
    );
    if (dup) {
      toast.error(`Já existe uma resposta com atalho "/${shortcode}"`);
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();

      // Resolução da mídia: 3 caminhos
      //  (a) novo upload (pendingMedia) → sobe + grava + deleta antigo se existia
      //  (b) removeMedia=true sem novo upload → limpa campos + deleta antigo
      //  (c) sem mudança → mantém os campos atuais (edit form.mediaUrl)
      let newMediaUrl: string | undefined = form.mediaUrl;
      let newMediaType = form.mediaType;
      let newFileName = form.fileName;
      let newMediaPath: string | undefined = form.mediaStoragePath;
      let oldPathToDelete: string | null = null;

      if (form.pendingMedia) {
        const file = form.pendingMedia;
        const mediaType = detectMediaType(file);
        // Sanitiza nome — evita problemas de URL/encoding no Storage
        const safeName = file.name.replace(/[^\w.\-]/g, '_');
        const path = `snippets/${business.id}/${Date.now()}_${safeName}`;
        const sref = storageRef(storage, path);
        await uploadBytes(sref, file, { contentType: file.type || 'application/octet-stream' });
        newMediaUrl = await getDownloadURL(sref);
        newMediaType = mediaType;
        newFileName = file.name;
        // Schedule delete do antigo APÓS o save do doc — se delete falhar, doc
        // já está consistente (vazamento Storage é menor mal que doc inválido).
        if (form.mediaStoragePath) oldPathToDelete = form.mediaStoragePath;
        newMediaPath = path;
      } else if (form.removeMedia && form.mediaStoragePath) {
        oldPathToDelete = form.mediaStoragePath;
        newMediaUrl = undefined;
        newMediaType = undefined;
        newFileName = undefined;
        newMediaPath = undefined;
      }

      const data: Partial<Snippet> & { businessId: string } = {
        businessId: business.id,
        shortcode,
        content,
        ...(category ? { category } : {}),
        ...(form.sectorId ? { sectorId: form.sectorId } : {}),
        ...(newMediaUrl ? {
          mediaUrl: newMediaUrl,
          mediaType: newMediaType,
          ...(newFileName ? { fileName: newFileName } : {}),
          ...(newMediaPath ? { mediaStoragePath: newMediaPath } : {}),
        } : {}),
        updatedAt: now,
      };
      if (form.id) {
        // Update — quando remove mídia, preciso explicitamente sobrescrever os
        // 4 campos com null pra Firestore apagar (Object spread acima omite
        // quando newMediaUrl é undefined, então updateDoc não tocaria nesses
        // campos). Usar deleteField() seria mais limpo, mas null é suficiente
        // e dispensa import extra.
        const updatePayload: Record<string, unknown> = { ...data };
        if (!newMediaUrl) {
          updatePayload.mediaUrl = null;
          updatePayload.mediaType = null;
          updatePayload.fileName = null;
          updatePayload.mediaStoragePath = null;
        }
        await updateDoc(doc(db, 'snippets', form.id), updatePayload);
        toast.success('Resposta atualizada');
      } else {
        // Create
        await addDoc(collection(db, 'snippets'), {
          ...data,
          createdBy: user.uid,
          createdAt: now,
        });
        toast.success('Resposta criada');
      }

      // Best-effort delete da mídia antiga. Falha não bloqueia — admin pode
      // limpar via console depois se aparecer no relatório.
      if (oldPathToDelete) {
        await deleteObject(storageRef(storage, oldPathToDelete)).catch(err => {
          console.warn('[QuickReplies] failed to delete old media:', err);
        });
      }

      closeForm();
    } catch (err) {
      console.error('[QuickReplies] save error:', err);
      toast.error('Erro ao salvar resposta');
    } finally {
      setSaving(false);
    }
  }, [business?.id, user, form, snippets, closeForm]);

  const handleDelete = useCallback(async (snip: Snippet) => {
    try {
      // Doc primeiro — sem ele, o snippet some da UI/autocomplete imediato.
      // Mídia órfã é cosmética; se delete do Storage falhar, é limpável depois.
      await deleteDoc(doc(db, 'snippets', snip.id));
      if (snip.mediaStoragePath) {
        await deleteObject(storageRef(storage, snip.mediaStoragePath)).catch(err => {
          console.warn('[QuickReplies] failed to delete media on snippet delete:', err);
        });
      }
      toast.success('Resposta excluída');
    } catch (err) {
      console.error('[QuickReplies] delete error:', err);
      toast.error('Erro ao excluir');
    } finally {
      setDeleteConfirm(null);
    }
  }, []);

  // ── UI ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-12 rounded-xl shimmer" />
        <div className="h-32 rounded-xl shimmer" />
      </div>
    );
  }

  return (
    <motion.div
      key="respostas"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      className="space-y-4"
    >
      {/* Header */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700/50 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 font-display">Respostas Rápidas</h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                Atalhos digitando <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-mono text-[10px]">/</kbd> no composer das conversas.
              </p>
            </div>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-700 text-white transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Nova resposta
            </button>
          )}
        </div>

        {/* Filtros */}
        <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por atalho, mensagem ou categoria…"
              className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400"
            />
          </div>
          {sectors.length > 0 && (
            <select
              value={filterSectorId}
              onChange={(e) => setFilterSectorId(e.target.value)}
              className="px-3 py-2 text-sm bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400"
            >
              <option value="">Todos os setores</option>
              <option value="global">Apenas globais</option>
              {sectors.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Lista */}
        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <FileText className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm font-semibold text-gray-600 dark:text-gray-400">
              {search || filterSectorId ? 'Nenhuma resposta encontrada' : 'Nenhuma resposta cadastrada'}
            </p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
              {search || filterSectorId
                ? 'Tente outros filtros ou limpe a busca.'
                : canEdit
                  ? 'Crie a primeira para usar atalhos no atendimento.'
                  : 'Peça pra um manager criar respostas rápidas.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {filtered.map(snip => {
              const sector = snip.sectorId ? sectors.find(s => s.id === snip.sectorId) : null;
              return (
                <div key={snip.id} className="p-4 hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors group">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="inline-flex items-center gap-1 text-[11px] font-mono font-bold px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400">
                          <Hash className="w-2.5 h-2.5" />
                          /{snip.shortcode}
                        </span>
                        {snip.category && (
                          <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            {snip.category}
                          </span>
                        )}
                        {sector && (
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white"
                            style={{ backgroundColor: sector.color }}
                          >
                            {sector.name}
                          </span>
                        )}
                        {snip.mediaUrl && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400">
                            <Paperclip className="w-2.5 h-2.5" />
                            {snip.mediaType === 'image' ? 'Imagem'
                              : snip.mediaType === 'video' ? 'Vídeo'
                              : snip.mediaType === 'audio' ? 'Áudio'
                              : 'Documento'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-2 whitespace-pre-wrap">
                        {snip.content}
                      </p>
                    </div>
                    {canEdit && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => openEdit(snip)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                          title="Editar"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirm(snip)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
                          title="Excluir"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Form Modal — renderizado via portal pra evitar bug de containing
          block: motion components ancestrais (shell da app, AnimatePresence
          de página) criam transform context que captura position:fixed,
          fazendo o modal aparecer descentralizado/fora do viewport. Portal
          monta direto no document.body, fora da árvore. */}
      {portalReady && createPortal(
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) closeForm(); }}
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="w-full max-w-lg bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 font-display">
                  {form.id ? 'Editar resposta' : 'Nova resposta rápida'}
                </h3>
                <button onClick={closeForm} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">
                    Atalho * <span className="font-normal text-gray-400 normal-case">(o que o operador digita após /)</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-mono text-sm">/</span>
                    <input
                      type="text"
                      value={form.shortcode}
                      onChange={(e) => setForm(f => ({ ...f, shortcode: e.target.value.toLowerCase().replace(/\s+/g, '_') }))}
                      placeholder="ex: ola, promo, fim_dia"
                      maxLength={MAX_SHORTCODE_LEN}
                      className="w-full pl-7 pr-3 py-2 text-sm font-mono bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400"
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">Apenas letras minúsculas, números, hífen e underline.</p>
                </div>

                <div>
                  {/* Asterisco condicional: mensagem é obrigatória só sem mídia.
                      Quando há mídia anexa, o texto vira caption opcional —
                      operador pode enviar só PDF/imagem sem texto. */}
                  {(() => {
                    const hasMedia = !!form.pendingMedia || (!!form.mediaUrl && !form.removeMedia);
                    return (
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">
                        {hasMedia ? 'Mensagem (caption)' : 'Mensagem *'}{' '}
                        <span className="font-normal text-gray-400 normal-case">({form.content.length}/{MAX_CONTENT_LEN})</span>
                      </label>
                    );
                  })()}
                  <textarea
                    value={form.content}
                    onChange={(e) => setForm(f => ({ ...f, content: e.target.value.slice(0, MAX_CONTENT_LEN) }))}
                    placeholder="Olá, tudo bem? Como posso ajudar?"
                    rows={5}
                    className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 resize-none"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    Pode usar variáveis como <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-mono text-[10px]">{'{{nome}}'}</code> — substituídas pelo nome do contato no envio.
                  </p>
                </div>

                {/* Anexo de mídia — opcional. Quando presente, vira o "corpo" do
                    snippet e o texto acima vira caption. Suporta image/video/
                    audio/document, mesmos limites do Composer. */}
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">
                    Mídia <span className="font-normal text-gray-400 normal-case">(opcional — imagem, vídeo, áudio ou documento)</span>
                  </label>
                  {(() => {
                    const hasPending = !!form.pendingMedia;
                    const hasExisting = !!form.mediaUrl && !form.removeMedia && !hasPending;
                    if (hasPending || hasExisting) {
                      const file = form.pendingMedia;
                      const mt = file ? detectMediaType(file) : (form.mediaType ?? 'document');
                      const name = file?.name ?? form.fileName ?? 'arquivo';
                      const size = file ? formatBytes(file.size) : null;
                      const Icon = mt === 'image' ? ImageIcon : mt === 'video' ? Video : mt === 'audio' ? Headphones : FileText;
                      return (
                        <div className="flex items-center gap-3 p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-white/[0.04]">
                          <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center flex-shrink-0">
                            <Icon className="w-4 h-4 text-gray-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{name}</p>
                            <p className="text-[10px] text-gray-400">
                              {hasPending ? `${size} · pendente upload` : `${mt} · salvo`}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={handleRemoveMedia}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                            title="Remover mídia"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    }
                    return (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 text-xs font-medium text-gray-500 dark:text-gray-400 hover:border-red-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                        Anexar arquivo
                      </button>
                    );
                  })()}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={handleSelectMedia}
                    className="hidden"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">
                      Categoria <span className="font-normal text-gray-400 normal-case">(opcional)</span>
                    </label>
                    <input
                      type="text"
                      value={form.category}
                      onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
                      placeholder="Saudações, Vendas…"
                      maxLength={MAX_CATEGORY_LEN}
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">
                      Setor <span className="font-normal text-gray-400 normal-case">(opcional)</span>
                    </label>
                    <select
                      value={form.sectorId}
                      onChange={(e) => setForm(f => ({ ...f, sectorId: e.target.value }))}
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400"
                    >
                      <option value="">Global (todos os setores)</option>
                      {sectors.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.02] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={(() => {
                    if (saving || !form.shortcode.trim()) return true;
                    // Aceita save com texto OU com mídia (pending novo OU já salvo).
                    const hasMedia = !!form.pendingMedia || (!!form.mediaUrl && !form.removeMedia);
                    return !form.content.trim() && !hasMedia;
                  })()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {form.id ? 'Atualizar' : 'Criar'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
      )}

      {/* Delete confirm — também via portal pelo mesmo motivo. */}
      {portalReady && createPortal(
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setDeleteConfirm(null); }}
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="w-full max-w-sm bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
              <div className="p-5 flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">Excluir resposta?</h4>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    O atalho <code className="font-mono text-amber-600 dark:text-amber-400">/{deleteConfirm.shortcode}</code> deixará de aparecer no autocomplete. Esta ação não pode ser desfeita.
                  </p>
                </div>
              </div>
              <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.02] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(deleteConfirm)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-700 text-white"
                >
                  Excluir
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
      )}
    </motion.div>
  );
}

// Compatibilidade: alguns lugares importam como named ou default
export { QuickRepliesTab };
