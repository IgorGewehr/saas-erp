'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  StickyNote,
  Pin,
  PinOff,
  Pencil,
  Trash2,
  Plus,
  Users,
  Lock,
  Search,
  X,
  Check,
  Palette,
  ChevronDown,
  Maximize2,
  ImageIcon,
  Paperclip,
  Loader2,
  Download,
  ExternalLink,
} from 'lucide-react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/utils/format';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NoteAttachment {
  id: string;
  name: string;
  url: string;
  path: string;
  type: 'image' | 'file';
  size: number;
  createdAt: string;
}

interface Note {
  id: string;
  businessId: string;
  authorId: string;
  authorName: string;
  authorInitials: string;
  title: string;
  content: string;
  color: NoteColor;
  scope: 'personal' | 'team';
  isPinned: boolean;
  attachments?: NoteAttachment[];
  createdAt: string;
  updatedAt: string;
}

type NoteColor =
  | 'yellow'
  | 'green'
  | 'blue'
  | 'pink'
  | 'purple'
  | 'orange'
  | 'red'
  | 'neutral';

type ActiveTab = 'personal' | 'team';

// ─── Color palette ─────────────────────────────────────────────────────────────

const COLOR_OPTIONS: { key: NoteColor; label: string; bg: string; border: string; text: string; dot: string }[] = [
  { key: 'yellow',  label: 'Amarelo', bg: 'bg-yellow-50 dark:bg-yellow-800/70',   border: 'border-yellow-200 dark:border-yellow-600/50', text: 'text-yellow-900 dark:text-yellow-50',  dot: 'bg-yellow-400' },
  { key: 'green',   label: 'Verde',   bg: 'bg-green-50 dark:bg-green-800/70',     border: 'border-green-200 dark:border-green-600/50',   text: 'text-green-900 dark:text-green-50',    dot: 'bg-green-400' },
  { key: 'blue',    label: 'Azul',    bg: 'bg-blue-50 dark:bg-blue-800/70',       border: 'border-blue-200 dark:border-blue-600/50',     text: 'text-blue-900 dark:text-blue-50',      dot: 'bg-blue-400' },
  { key: 'pink',    label: 'Rosa',    bg: 'bg-pink-50 dark:bg-pink-800/70',       border: 'border-pink-200 dark:border-pink-600/50',     text: 'text-pink-900 dark:text-pink-50',      dot: 'bg-pink-400' },
  { key: 'purple',  label: 'Roxo',    bg: 'bg-purple-50 dark:bg-purple-800/70',   border: 'border-purple-200 dark:border-purple-600/50', text: 'text-purple-900 dark:text-purple-50',  dot: 'bg-purple-400' },
  { key: 'orange',  label: 'Laranja', bg: 'bg-orange-50 dark:bg-orange-800/70',   border: 'border-orange-200 dark:border-orange-600/50', text: 'text-orange-900 dark:text-orange-50',  dot: 'bg-orange-400' },
  { key: 'red',     label: 'Vermelho',bg: 'bg-red-50 dark:bg-red-800/70',         border: 'border-red-200 dark:border-red-600/50',       text: 'text-red-900 dark:text-red-50',        dot: 'bg-red-400' },
  { key: 'neutral', label: 'Neutro',  bg: 'bg-gray-50 dark:bg-gray-700/80',       border: 'border-gray-200 dark:border-gray-600/50',     text: 'text-gray-900 dark:text-gray-50',      dot: 'bg-gray-400' },
];

function getColorConfig(color: NoteColor) {
  return COLOR_OPTIONS.find(c => c.key === color) ?? COLOR_OPTIONS[COLOR_OPTIONS.length - 1];
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ─── Color Picker ─────────────────────────────────────────────────────────────

function ColorPicker({
  value,
  onChange,
}: {
  value: NoteColor;
  onChange: (c: NoteColor) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = getColorConfig(value);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/60 dark:bg-gray-700/60 border border-gray-200 dark:border-gray-600 hover:bg-white dark:hover:bg-gray-700 transition-colors text-xs text-gray-600 dark:text-gray-300"
      >
        <span className={cn('w-3 h-3 rounded-full', current.dot)} />
        <Palette className="w-3.5 h-3.5" />
        <ChevronDown className="w-3 h-3" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-0 mb-1.5 z-[200] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-2 grid grid-cols-4 gap-1.5 w-[120px]"
          >
            {COLOR_OPTIONS.map(c => (
              <button
                key={c.key}
                type="button"
                title={c.label}
                onClick={() => { onChange(c.key); setOpen(false); }}
                className={cn(
                  'w-7 h-7 rounded-lg border-2 transition-all',
                  c.dot,
                  value === c.key ? 'border-gray-700 dark:border-white scale-110' : 'border-transparent hover:scale-110',
                )}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Note Card ────────────────────────────────────────────────────────────────

function NoteCard({
  note,
  onPin,
  onEdit,
  onDelete,
  onPreview,
  isTeam,
}: {
  note: Note;
  onPin: (note: Note) => void;
  onEdit: (note: Note) => void;
  onDelete: (note: Note) => void;
  onPreview: (note: Note) => void;
  isTeam: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const color = getColorConfig(note.color);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.94, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92, y: -6 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => onPreview(note)}
      className={cn(
        'group relative rounded-2xl border p-4 cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5',
        'flex flex-col h-52',
        color.bg,
        color.border,
      )}
    >
      {/* Pin indicator */}
      {note.isPinned && (
        <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center shadow-sm">
          <Pin className="w-3 h-3 text-red-500" />
        </div>
      )}

      {/* Actions — z-10 garante que ficam acima do stacking context do conteúdo;
           onPointerDown para o Framer Motion não detectar tap no card */}
      <div
        className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
      >
        <button
          onClick={(e) => { e.stopPropagation(); onPin(note); }}
          title={note.isPinned ? 'Desafixar' : 'Fixar no topo'}
          className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/20 transition-colors"
        >
          {note.isPinned
            ? <PinOff className="w-3.5 h-3.5 text-black/55 dark:text-white/75" />
            : <Pin className="w-3.5 h-3.5 text-black/55 dark:text-white/75" />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(note); }}
          title="Editar"
          className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/20 transition-colors"
        >
          <Pencil className="w-3.5 h-3.5 text-black/55 dark:text-white/75" />
        </button>
        {!confirmDelete ? (
          <button
            onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
            title="Excluir"
            className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5 text-black/55 dark:text-white/75 hover:text-red-500 dark:hover:text-red-400" />
          </button>
        ) : (
          <div className="flex items-center gap-0.5 bg-black/10 dark:bg-white/10 rounded-lg px-1">
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(note); }}
              title="Confirmar exclusão"
              className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-800/50 transition-colors"
            >
              <Check className="w-3.5 h-3.5 text-red-500 dark:text-red-400" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
              title="Cancelar"
              className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            >
              <X className="w-3.5 h-3.5 text-black/55 dark:text-white/75" />
            </button>
          </div>
        )}
      </div>

      {/* Expand hint — appears on hover bottom-right */}
      <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-50 transition-opacity duration-150 pointer-events-none">
        <Maximize2 className="w-3 h-3 text-black dark:text-white" />
      </div>

      {/* Image thumbnails — shown when note has images */}
      {(() => {
        const imgs = note.attachments?.filter(a => a.type === 'image') ?? [];
        if (!imgs.length) return null;
        return (
          <div className="flex gap-1 mb-2 shrink-0 overflow-hidden rounded-lg">
            {imgs.slice(0, 3).map((img, i) => (
              <div key={img.id} className="relative flex-1 min-w-0">
                <img src={img.url} alt={img.name} className="w-full h-12 object-cover" style={{ borderRadius: i === 0 ? '8px 0 0 8px' : i === imgs.length - 1 || i === 2 ? '0 8px 8px 0' : '0' }} />
              </div>
            ))}
            {imgs.length > 3 && (
              <div className="w-8 h-12 bg-black/20 dark:bg-white/20 flex items-center justify-center text-[10px] font-bold text-white dark:text-black rounded-r-lg flex-shrink-0">
                +{imgs.length - 3}
              </div>
            )}
          </div>
        );
      })()}

      {/* Title */}
      {note.title && (
        <h3 className={cn('font-semibold text-sm mb-1.5 pr-16 leading-snug break-words line-clamp-2 shrink-0', color.text)}>
          {note.title}
        </h3>
      )}

      {/* Content — grows to fill card, fades out at the bottom when overflowing.
           mask-image fica no <p> e não no container, para não criar stacking
           context que competiria com os botões absolutos irmãos. */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <p
          className={cn(
            'text-sm leading-relaxed whitespace-pre-wrap break-words h-full',
            note.title ? 'text-black/70 dark:text-white/80' : cn('font-medium', color.text),
            !note.title && 'pr-14',
          )}
          style={{
            maskImage: 'linear-gradient(to bottom, black 55%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black 55%, transparent 100%)',
          }}
        >
          {note.content}
        </p>
      </div>

      {/* Footer */}
      <div className="mt-2 pt-2 border-t border-black/10 dark:border-white/20 flex items-center justify-between gap-2 shrink-0">
        <span className="text-[11px] font-medium text-black/50 dark:text-white/60">
          {formatDateTime(note.updatedAt)}
        </span>
        {isTeam && (
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-full bg-black/15 dark:bg-white/20 flex items-center justify-center text-[9px] font-bold text-black/70 dark:text-white/90">
              {note.authorInitials}
            </div>
            <span className="text-[11px] font-medium text-black/50 dark:text-white/60 max-w-[100px] truncate">
              {note.authorName}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Create / Edit Modal ───────────────────────────────────────────────────────

interface NoteFormData {
  title: string;
  content: string;
  color: NoteColor;
  scope: 'personal' | 'team';
  attachments: NoteAttachment[];
}

const NOTE_MODAL_SIZE_KEY = 'notas_modal_size';
const DEFAULT_MODAL_W = 560;
const DEFAULT_MODAL_H = 440;

function getSavedModalSize(): { w: number; h: number } {
  try {
    const raw = localStorage.getItem(NOTE_MODAL_SIZE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.w > 300 && parsed.h > 200) return parsed;
    }
  } catch { /* ignore */ }
  return { w: DEFAULT_MODAL_W, h: DEFAULT_MODAL_H };
}

function NoteModal({
  initial,
  noteId,
  businessId,
  tab,
  onClose,
  onSave,
}: {
  initial?: Note;
  noteId: string;
  businessId: string;
  tab: ActiveTab;
  onClose: () => void;
  onSave: (data: NoteFormData) => Promise<void>;
}) {
  const [form, setForm] = useState<NoteFormData>({
    title: initial?.title ?? '',
    content: initial?.content ?? '',
    color: initial?.color ?? 'yellow',
    scope: initial?.scope ?? tab,
    attachments: initial?.attachments ?? [],
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backdropMouseDown = useRef<{ x: number; y: number } | null>(null);
  const savedSize = getSavedModalSize();

  const MAX_ATTACHMENTS = 10;

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // always clear so same file can be re-selected
    if (!files.length) return;

    // Guard: businessId must be present before uploading to Storage
    if (!businessId || !noteId) {
      alert('Erro: sessão inválida. Recarregue a página e tente novamente.');
      return;
    }

    // Enforce max attachment count
    const remaining = MAX_ATTACHMENTS - form.attachments.length;
    if (remaining <= 0) {
      alert(`Máximo de ${MAX_ATTACHMENTS} arquivos por nota.`);
      return;
    }

    const MAX_MB = 10;
    const valid = files.slice(0, remaining).filter(f => {
      if (f.size > MAX_MB * 1024 * 1024) { alert(`"${f.name}" excede ${MAX_MB}MB.`); return false; }
      return true;
    });
    if (!valid.length) return;

    setUploading(true);
    try {
      const newAtts: NoteAttachment[] = [];
      for (const file of valid) {
        const fileId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `businesses/${businessId}/notes/${noteId}/${fileId}_${safeName}`;
        const sRef = storageRef(storage, path);
        // Detecta content-type para extensões que o navegador às vezes deixa em branco (XML, etc.)
        const ext = file.name.toLowerCase().split('.').pop() || '';
        const inferredType = file.type
          || (ext === 'xml' ? 'application/xml'
            : ext === 'json' ? 'application/json'
            : ext === 'csv' ? 'text/csv'
            : ext === 'txt' ? 'text/plain'
            : 'application/octet-stream');
        await uploadBytes(sRef, file, { contentType: inferredType });
        const url = await getDownloadURL(sRef);
        newAtts.push({
          id: fileId,
          name: file.name,
          url,
          path,
          type: file.type.startsWith('image/') ? 'image' : 'file',
          size: file.size,
          createdAt: new Date().toISOString(),
        });
      }
      setForm(f => ({ ...f, attachments: [...f.attachments, ...newAtts] }));
    } catch (err) {
      console.error('[notas] upload failed:', err);
      const code = (err as { code?: string })?.code;
      const msg = code === 'storage/unauthorized'
        ? 'Tipo de arquivo não permitido pelo servidor.'
        : 'Erro ao enviar arquivo. Tente novamente.';
      alert(msg);
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveAttachment = async (att: NoteAttachment) => {
    setForm(f => ({ ...f, attachments: f.attachments.filter(a => a.id !== att.id) }));
    try { await deleteObject(storageRef(storage, att.path)); } catch { /* ignore — may already be gone */ }
  };

  // Cleanup uploads that were added this session but never saved
  const handleClose = useCallback(async () => {
    if (!saving) {
      const originalIds = new Set((initial?.attachments ?? []).map(a => a.id));
      const unsaved = form.attachments.filter(a => !originalIds.has(a.id));
      for (const att of unsaved) {
        try { await deleteObject(storageRef(storage, att.path)); } catch { /* ignore */ }
      }
    }
    onClose();
  }, [form.attachments, initial?.attachments, saving, onClose]);

  // Focus textarea on open
  useEffect(() => {
    contentRef.current?.focus();
  }, []);

  // Save modal size on unmount via ResizeObserver
  useEffect(() => {
    const el = modalRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      if (width > 300 && height > 200) {
        localStorage.setItem(NOTE_MODAL_SIZE_KEY, JSON.stringify({ w: width, h: height }));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleSubmit = async () => {
    if (!form.content.trim()) return;
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const color = getColorConfig(form.color);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onMouseDown={e => {
        if (e.target === e.currentTarget)
          backdropMouseDown.current = { x: e.clientX, y: e.clientY };
        else
          backdropMouseDown.current = null;
      }}
      onClick={e => {
        if (e.target !== e.currentTarget) return;
        const origin = backdropMouseDown.current;
        backdropMouseDown.current = null;
        if (!origin) return;
        // Only close if mouse didn't move (true click, not a resize drag release)
        const dist = Math.abs(e.clientX - origin.x) + Math.abs(e.clientY - origin.y);
        if (dist < 6) handleClose();
      }}
    >
      <motion.div
        ref={modalRef}
        initial={{ opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 12 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className={cn('rounded-2xl border shadow-2xl flex flex-col', color.bg, color.border)}
        style={{
          width: savedSize.w,
          height: savedSize.h,
          minWidth: 340,
          minHeight: 280,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 32px)',
          resize: 'both',
          overflow: 'hidden',
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 flex-shrink-0 border-b border-black/[0.06] dark:border-white/[0.06]">
          <h2 className={cn('font-semibold text-sm', color.text)}>
            {initial ? 'Editar nota' : 'Nova nota'}
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-black/30 dark:text-white/30">
              Ctrl+Enter para salvar
            </span>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4 text-black/40 dark:text-white/40" />
            </button>
          </div>
        </div>

        {/* Body — takes all available vertical space, scrolls internally */}
        <div className="flex flex-col min-h-0 flex-1 px-5 py-3 gap-2">
          {/* Title — no browser outline */}
          <input
            type="text"
            placeholder="Título (opcional)"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            style={{ outline: 'none', boxShadow: 'none' }}
            className={cn(
              'w-full bg-transparent border-0 font-semibold placeholder-black/30 dark:placeholder-white/30 text-base leading-snug flex-shrink-0',
              color.text,
            )}
          />

          {form.title && (
            <div className="h-px bg-black/[0.06] dark:bg-white/[0.06] flex-shrink-0" />
          )}

          {/* Content — fills remaining space, scrolls when needed */}
          <textarea
            ref={contentRef}
            placeholder="Escreva sua nota..."
            value={form.content}
            onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
            style={{ outline: 'none', boxShadow: 'none' }}
            className="flex-1 w-full bg-transparent border-0 resize-none text-sm text-black/80 dark:text-white/80 placeholder-black/30 dark:placeholder-white/30 leading-relaxed min-h-0 overflow-y-auto"
          />

          {/* Attachments preview */}
          {form.attachments.length > 0 && (
            <div className="flex-shrink-0 border-t border-black/[0.06] dark:border-white/[0.06] pt-2 space-y-1.5">
              <p className="text-[10px] font-semibold text-black/40 dark:text-white/40 uppercase tracking-wide">
                {form.attachments.length} anexo{form.attachments.length !== 1 ? 's' : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                {form.attachments.map(att => (
                  <div key={att.id} className="group/att relative">
                    {att.type === 'image' ? (
                      <img
                        src={att.url}
                        alt={att.name}
                        className="h-14 w-20 object-cover rounded-xl border border-black/10 dark:border-white/10"
                      />
                    ) : (
                      <div className="h-14 w-20 rounded-xl border border-black/10 dark:border-white/10 bg-black/10 dark:bg-white/10 flex flex-col items-center justify-center gap-1 px-1">
                        <Paperclip className="w-4 h-4 text-black/40 dark:text-white/40" />
                        <span className="text-[9px] text-black/40 dark:text-white/40 truncate w-full text-center px-1">{att.name}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(att)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-opacity shadow-sm"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                ))}
                {uploading && (
                  <div className="h-14 w-20 rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 flex items-center justify-center">
                    <Loader2 className="w-4 h-4 text-black/40 dark:text-white/40 animate-spin" />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0 border-t border-black/[0.06] dark:border-white/[0.06]">
          <div className="flex items-center gap-2">
            <ColorPicker value={form.color} onChange={c => setForm(f => ({ ...f, color: c }))} />

            {/* Attach files */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="Adicionar imagem ou arquivo"
              className="flex items-center gap-1 p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              {uploading
                ? <Loader2 className="w-3.5 h-3.5 text-black/50 dark:text-white/50 animate-spin" />
                : <ImageIcon className="w-3.5 h-3.5 text-black/50 dark:text-white/50" />}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,audio/*,.pdf,.xml,.json,.csv,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.zip,.rar,.7z"
              onChange={handleFilePick}
              className="hidden"
            />

            <div className="flex items-center gap-0.5 bg-black/10 dark:bg-white/10 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, scope: 'personal' }))}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all',
                  form.scope === 'personal'
                    ? 'bg-white/80 dark:bg-white/20 shadow-sm text-black dark:text-white'
                    : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white',
                )}
              >
                <Lock className="w-3 h-3" />
                Pessoal
              </button>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, scope: 'team' }))}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all',
                  form.scope === 'team'
                    ? 'bg-white/80 dark:bg-white/20 shadow-sm text-black dark:text-white'
                    : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white',
                )}
              >
                <Users className="w-3 h-3" />
                Equipe
              </button>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!form.content.trim() || saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-black/70 dark:bg-white/90 text-white dark:text-gray-900 rounded-xl text-xs font-semibold hover:opacity-90 disabled:opacity-30 transition-opacity"
          >
            {saving ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}
                className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full"
              />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            {initial ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Inline Create Bar ─────────────────────────────────────────────────────────

function CreateBar({
  tab,
  onExpand,
}: {
  tab: ActiveTab;
  onExpand: () => void;
}) {
  return (
    <motion.button
      initial={false}
      whileHover={{ scale: 1.005 }}
      whileTap={{ scale: 0.998 }}
      onClick={onExpand}
      className="w-full flex items-center gap-3 px-4 py-3.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm hover:shadow-md transition-all duration-200 text-left group"
    >
      <div className="w-8 h-8 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center flex-shrink-0">
        <Plus className="w-4 h-4 text-red-500" />
      </div>
      <div className="flex-1">
        <p className="text-sm text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-400 transition-colors">
          {tab === 'personal' ? 'Criar nota pessoal...' : 'Criar nota para a equipe...'}
        </p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <div className="flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700/60 rounded-lg">
          {tab === 'personal'
            ? <><Lock className="w-3 h-3 text-gray-400" /><span className="text-[11px] text-gray-400">Pessoal</span></>
            : <><Users className="w-3 h-3 text-gray-400" /><span className="text-[11px] text-gray-400">Equipe</span></>}
        </div>
      </div>
    </motion.button>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ tab, onCreate }: { tab: ActiveTab; onCreate: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center justify-center py-20 gap-4"
    >
      <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
        <StickyNote className="w-8 h-8 text-gray-300 dark:text-gray-600" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
          {tab === 'personal' ? 'Nenhuma nota pessoal ainda' : 'Nenhuma nota da equipe ainda'}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          {tab === 'personal' ? 'Suas notas são visíveis apenas para você' : 'Notas visíveis para toda a equipe'}
        </p>
      </div>
      <button
        onClick={onCreate}
        className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-medium transition-colors"
      >
        <Plus className="w-4 h-4" />
        Criar primeira nota
      </button>
    </motion.div>
  );
}

// ─── Main Module ──────────────────────────────────────────────────────────────

// ─── Read-only Preview Modal ──────────────────────────────────────────────────

function NotePreviewModal({
  note,
  isTeam,
  onClose,
  onEdit,
}: {
  note: Note;
  isTeam: boolean;
  onClose: () => void;
  onEdit: (note: Note) => void;
}) {
  const color = getColorConfig(note.color);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Lock the tab's scroll container while the modal is open.
  // The app scroll host is an inner div (overflow-y-auto), not document.body.
  const backdropRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let el: HTMLElement | null = backdropRef.current?.parentElement ?? null;
    while (el) {
      const { overflowY } = window.getComputedStyle(el);
      if (overflowY === 'auto' || overflowY === 'scroll') break;
      el = el.parentElement;
    }
    if (!el) return;
    const prev = el.style.overflowY;
    el.style.overflowY = 'hidden';
    return () => { el!.style.overflowY = prev; };
  }, []);

  return (
    <motion.div
      ref={backdropRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.93, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        onClick={e => e.stopPropagation()}
        className={cn(
          'relative rounded-2xl border shadow-2xl flex flex-col w-full max-w-2xl',
          color.bg, color.border,
        )}
        style={{ maxHeight: 'calc(100vh - 64px)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-3 shrink-0">
          <div className="flex-1 min-w-0">
            {note.isPinned && (
              <div className="flex items-center gap-1 mb-1.5">
                <Pin className="w-3 h-3 text-red-500" />
                <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest">Fixada</span>
              </div>
            )}
            {note.title && (
              <h2 className={cn('font-bold text-xl leading-snug break-words select-text', color.text)}>
                {note.title}
              </h2>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => { onEdit(note); onClose(); }}
              title="Editar nota"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black/10 hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/20 transition-colors text-xs font-semibold text-gray-700 dark:text-gray-200"
            >
              <Pencil className="w-3.5 h-3.5" />
              Editar
            </button>
            <button
              onClick={onClose}
              title="Fechar (Esc)"
              className="p-1.5 rounded-xl hover:bg-black/10 dark:hover:bg-white/20 transition-colors"
            >
              <X className="w-4 h-4 text-black/55 dark:text-white/75" />
            </button>
          </div>
        </div>

        {/* Content + attachments — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 pb-2 space-y-4">
          {/* Image gallery */}
          {(note.attachments?.filter(a => a.type === 'image') ?? []).length > 0 && (
            <div className="space-y-2">
              {(note.attachments ?? []).filter(a => a.type === 'image').map(img => (
                <div key={img.id} className="relative group/img rounded-xl overflow-hidden">
                  <img
                    src={img.url}
                    alt={img.name}
                    className="w-full max-h-72 object-cover"
                  />
                  <a
                    href={img.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="absolute top-2 right-2 p-1.5 bg-black/50 rounded-lg opacity-0 group-hover/img:opacity-100 transition-opacity"
                    title="Abrir em nova aba"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-white" />
                  </a>
                </div>
              ))}
            </div>
          )}

          {/* File attachments (non-image) */}
          {(note.attachments?.filter(a => a.type === 'file') ?? []).length > 0 && (
            <div className="space-y-1">
              {(note.attachments ?? []).filter(a => a.type === 'file').map(f => (
                <a
                  key={f.id}
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="flex items-center gap-2 p-2.5 rounded-xl bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 transition-colors"
                >
                  <Paperclip className="w-4 h-4 text-black/50 dark:text-white/60 shrink-0" />
                  <span className="text-sm text-black/70 dark:text-white/80 truncate flex-1">{f.name}</span>
                  <Download className="w-3.5 h-3.5 text-black/40 dark:text-white/50 shrink-0" />
                </a>
              ))}
            </div>
          )}

          <p className={cn(
            'text-sm leading-relaxed whitespace-pre-wrap break-words select-text',
            note.title ? 'text-black/70 dark:text-white/85' : cn('font-medium text-[15px]', color.text),
          )}>
            {note.content}
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-black/10 dark:border-white/20 flex items-center gap-3 shrink-0">
          <span className="text-[11px] font-medium text-black/50 dark:text-white/65">
            {formatDateTime(note.updatedAt)}
          </span>
          {isTeam && (
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full bg-black/15 dark:bg-white/20 flex items-center justify-center text-[9px] font-bold text-black/70 dark:text-white/90">
                {note.authorInitials}
              </div>
              <span className="text-[11px] font-medium text-black/50 dark:text-white/65">{note.authorName}</span>
            </div>
          )}
          <span className="text-[10px] text-black/35 dark:text-white/40 italic ml-auto">
            Esc para fechar
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Main Module ──────────────────────────────────────────────────────────────

export default function NotasModule() {
  const { user, business } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>('personal');
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [previewNote, setPreviewNote] = useState<Note | null>(null);
  // Pre-generated Firestore ID for the next note — enables uploads before saving
  const pendingNoteId = useRef<string>(doc(collection(db, 'notes')).id);

  // ── Firestore subscription ─────────────────────────────────────────────────
  // Single query by businessId only — avoids composite index requirement.
  // Tab filtering (personal/team) and author filtering happen client-side.

  useEffect(() => {
    if (!business?.id || !user?.uid) return;
    setLoading(true);

    const q = query(
      collection(db, 'notes'),
      where('businessId', '==', business.id),
    );

    const unsub = onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ ...d.data(), id: d.id } as Note));
      setNotes(all);
      setLoading(false);
    }, (err) => {
      console.error('[Notas] onSnapshot error:', err);
      setLoading(false);
    });

    return () => unsub();
  }, [business?.id, user?.uid]);

  // ── Sorted notes (tab filter + pinned first) ──────────────────────────────

  const displayed = useMemo(() => {
    let filtered = notes.filter(n =>
      activeTab === 'personal'
        ? n.scope === 'personal' && n.authorId === user?.uid
        : n.scope === 'team',
    );
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(n =>
        n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q),
      );
    }
    return [
      ...filtered.filter(n => n.isPinned).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      ...filtered.filter(n => !n.isPinned).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    ];
  }, [notes, search, activeTab, user?.uid]);

  // ── CRUD handlers ──────────────────────────────────────────────────────────

  const handleCreate = async (data: NoteFormData) => {
    if (!business?.id || !user?.uid) return;
    const now = new Date().toISOString();
    const id = pendingNoteId.current;
    await setDoc(doc(db, 'notes', id), {
      businessId: business.id,
      authorId: user.uid,
      authorName: user.name,
      authorInitials: getInitials(user.name),
      title: data.title.trim(),
      content: data.content.trim(),
      color: data.color,
      scope: data.scope,
      attachments: data.attachments,
      isPinned: false,
      createdAt: now,
      updatedAt: now,
    });
    // Reset pending ID for the next note
    pendingNoteId.current = doc(collection(db, 'notes')).id;
    if (data.scope !== activeTab) setActiveTab(data.scope);
  };

  const handleEdit = async (data: NoteFormData) => {
    if (!editingNote) return;
    // Delete attachments that were removed during edit
    const removed = (editingNote.attachments ?? []).filter(
      a => !data.attachments.find(da => da.id === a.id)
    );
    for (const att of removed) {
      try { await deleteObject(storageRef(storage, att.path)); } catch { /* already gone */ }
    }
    await updateDoc(doc(db, 'notes', editingNote.id), {
      title: data.title.trim(),
      content: data.content.trim(),
      color: data.color,
      scope: data.scope,
      attachments: data.attachments,
      updatedAt: new Date().toISOString(),
    });
    setEditingNote(null);
  };

  const handlePin = async (note: Note) => {
    await updateDoc(doc(db, 'notes', note.id), {
      isPinned: !note.isPinned,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleDelete = async (note: Note) => {
    // Delete Storage attachments first
    for (const att of note.attachments ?? []) {
      try { await deleteObject(storageRef(storage, att.path)); } catch { /* ignore */ }
    }
    await deleteDoc(doc(db, 'notes', note.id));
  };

  const openEdit = (note: Note) => {
    setEditingNote(note);
    setShowModal(false);
  };

  const openCreate = () => {
    setEditingNote(null);
    setShowModal(true);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="flex items-start justify-between gap-4 flex-wrap"
      >
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm">
              <StickyNote className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold font-display text-gray-900 dark:text-white leading-none">
                Mural de Notas
              </h1>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                {notes.length} {notes.length === 1 ? 'nota' : 'notas'} · {activeTab === 'personal' ? 'Pessoal' : 'Equipe'}
              </p>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar notas..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-9 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-700 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-red-400/30 focus:border-red-300 dark:focus:border-red-700 w-56 transition-all"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <X className="w-3.5 h-3.5 text-gray-400" />
            </button>
          )}
        </div>
      </motion.div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800/60 rounded-xl p-1 w-fit">
        {([
          { key: 'personal' as ActiveTab, label: 'Pessoal', icon: Lock },
          { key: 'team'     as ActiveTab, label: 'Equipe',  icon: Users },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
              activeTab === tab.key
                ? 'text-gray-900 dark:text-white'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
            )}
          >
            {activeTab === tab.key && (
              <motion.div
                layoutId="notes-tab-pill"
                className="absolute inset-0 bg-white dark:bg-gray-700 rounded-lg shadow-sm"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            )}
            <tab.icon className="relative w-3.5 h-3.5" />
            <span className="relative">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Create bar */}
      <CreateBar tab={activeTab} onExpand={openCreate} />

      {/* Notes grid */}
      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
          >
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} className="shimmer rounded-2xl h-52" />
            ))}
          </motion.div>
        ) : displayed.length === 0 ? (
          <motion.div key="empty">
            {search ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Search className="w-10 h-10 text-gray-300 dark:text-gray-600" />
                <p className="text-sm text-gray-400 dark:text-gray-500">Nenhuma nota encontrada para "{search}"</p>
                <button onClick={() => setSearch('')} className="text-xs text-red-500 hover:underline">Limpar busca</button>
              </div>
            ) : (
              <EmptyState tab={activeTab} onCreate={openCreate} />
            )}
          </motion.div>
        ) : (
          <motion.div
            key={activeTab}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
          >
            {displayed.map(note => (
              <NoteCard
                key={note.id}
                note={note}
                isTeam={activeTab === 'team'}
                onPin={handlePin}
                onEdit={openEdit}
                onDelete={handleDelete}
                onPreview={setPreviewNote}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Modal */}
      <AnimatePresence>
        {showModal && (
          <NoteModal
            key="create"
            noteId={pendingNoteId.current}
            businessId={business?.id ?? ''}
            tab={activeTab}
            onClose={() => { setShowModal(false); }}
            onSave={handleCreate}
          />
        )}
      </AnimatePresence>

      {/* Edit Modal */}
      <AnimatePresence>
        {editingNote && (
          <NoteModal
            key="edit"
            initial={editingNote}
            noteId={editingNote.id}
            businessId={business?.id ?? ''}
            tab={activeTab}
            onClose={() => setEditingNote(null)}
            onSave={handleEdit}
          />
        )}
      </AnimatePresence>

      {/* Read-only Preview Modal */}
      <AnimatePresence>
        {previewNote && (
          <NotePreviewModal
            key={previewNote.id}
            note={previewNote}
            isTeam={activeTab === 'team'}
            onClose={() => setPreviewNote(null)}
            onEdit={(note) => {
              setPreviewNote(null);
              openEdit(note);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
