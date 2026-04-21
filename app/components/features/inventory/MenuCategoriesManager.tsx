'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import {
  collection, query, where, onSnapshot, doc, setDoc,
  deleteDoc, writeBatch, orderBy,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import type { MenuCategory } from '@/lib/types';
import {
  Plus, X, Pencil, Trash2, GripVertical, Tag, Check,
  Loader2, Eye, EyeOff, Palette, ImagePlus,
} from 'lucide-react';

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function MenuCategoriesManager({ open, onClose }: Props) {
  const { business } = useAuth();
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MenuCategory | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  // Subscribe to categories
  useEffect(() => {
    if (!business?.id || !open) return;
    setLoading(true);
    const q = query(
      collection(db, 'menuCategories'),
      where('businessId', '==', business.id),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs
        .map((d) => ({ ...d.data(), id: d.id }) as MenuCategory)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      setCategories(list);
      setLoading(false);
    });
    return () => unsub();
  }, [business?.id, open]);

  const handleCreate = useCallback(() => {
    setEditing(null);
    setFormOpen(true);
  }, []);

  const handleEdit = useCallback((cat: MenuCategory) => {
    setEditing(cat);
    setFormOpen(true);
  }, []);

  const handleDelete = useCallback(async (cat: MenuCategory) => {
    if (!confirm(`Remover a categoria "${cat.name}"? Os produtos vinculados ficarão sem categoria.`)) return;
    await deleteDoc(doc(db, 'menuCategories', cat.id));
  }, []);

  const handleToggleActive = useCallback(async (cat: MenuCategory) => {
    await setDoc(doc(db, 'menuCategories', cat.id), {
      ...cat,
      isActive: !cat.isActive,
      updatedAt: new Date().toISOString(),
    });
  }, []);

  const handleReorder = useCallback(async (newOrder: MenuCategory[]) => {
    setCategories(newOrder);
    if (!business?.id) return;
    const batch = writeBatch(db);
    newOrder.forEach((cat, idx) => {
      batch.update(doc(db, 'menuCategories', cat.id), {
        sortOrder: idx,
        updatedAt: new Date().toISOString(),
      });
    });
    await batch.commit();
  }, [business?.id]);

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.96, y: 20, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.96, y: 20, opacity: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 280 }}
          className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-red-100 dark:bg-red-500/20 flex items-center justify-center">
                <Tag className="w-4 h-4 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">Categorias do Cardápio</h2>
                <p className="text-xs text-gray-500">Organize seus produtos em grupos visíveis no cardápio público</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 text-red-500 animate-spin" />
              </div>
            ) : categories.length === 0 ? (
              <EmptyState onCreate={handleCreate} />
            ) : (
              <Reorder.Group axis="y" values={categories} onReorder={handleReorder} className="space-y-2">
                {categories.map((cat) => (
                  <Reorder.Item key={cat.id} value={cat}>
                    <CategoryRow
                      category={cat}
                      onEdit={() => handleEdit(cat)}
                      onDelete={() => handleDelete(cat)}
                      onToggleActive={() => handleToggleActive(cat)}
                    />
                  </Reorder.Item>
                ))}
              </Reorder.Group>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
            <p className="text-xs text-gray-500">
              {categories.length} categoria{categories.length !== 1 ? 's' : ''} · Arraste para reordenar
            </p>
            <button
              onClick={handleCreate}
              className="inline-flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-semibold transition-colors"
            >
              <Plus className="w-4 h-4" />
              Nova Categoria
            </button>
          </div>
        </motion.div>

        {/* Form modal */}
        <CategoryFormDialog
          open={formOpen}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          editing={editing}
          categories={categories}
        />
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Category Row ──────────────────────────────────────────────────────────

function CategoryRow({
  category, onEdit, onDelete, onToggleActive,
}: {
  category: MenuCategory;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
}) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
      category.isActive
        ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40'
        : 'border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40 opacity-60'
    }`}>
      <div className="cursor-grab active:cursor-grabbing p-1 text-gray-300 hover:text-gray-500">
        <GripVertical className="w-4 h-4" />
      </div>
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: (category.color || '#ef4444') + '20' }}
      >
        {category.imageUrl ? (
          <img src={category.imageUrl} alt={category.name} className="w-full h-full object-cover rounded-xl" />
        ) : (
          <Tag className="w-4 h-4" style={{ color: category.color || '#ef4444' }} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-gray-900 dark:text-white truncate">{category.name}</p>
        {category.description && (
          <p className="text-xs text-gray-500 truncate">{category.description}</p>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onToggleActive}
          title={category.isActive ? 'Desativar' : 'Ativar'}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          {category.isActive
            ? <Eye className="w-4 h-4 text-emerald-500" />
            : <EyeOff className="w-4 h-4 text-gray-400" />}
        </button>
        <button onClick={onEdit} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <Pencil className="w-4 h-4 text-gray-500" />
        </button>
        <button onClick={onDelete} className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
          <Trash2 className="w-4 h-4 text-red-500" />
        </button>
      </div>
    </div>
  );
}

// ─── Empty State ───────────────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
        <Tag className="w-7 h-7 text-gray-300" />
      </div>
      <p className="font-semibold text-gray-700 dark:text-gray-300 mb-1">Nenhuma categoria criada</p>
      <p className="text-sm text-gray-500 mb-5 max-w-xs">
        Crie categorias como "Pizzas", "Bebidas", "Sobremesas" para organizar seu cardápio.
      </p>
      <button
        onClick={onCreate}
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-semibold transition-colors"
      >
        <Plus className="w-4 h-4" />
        Criar Primeira Categoria
      </button>
    </div>
  );
}

// ─── Form Dialog ───────────────────────────────────────────────────────────

function CategoryFormDialog({
  open, onClose, editing, categories,
}: {
  open: boolean;
  onClose: () => void;
  editing: MenuCategory | null;
  categories: MenuCategory[];
}) {
  const { business } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [imageUrl, setImageUrl] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(editing?.name || '');
      setDescription(editing?.description || '');
      setColor(editing?.color || PRESET_COLORS[0]);
      setImageUrl(editing?.imageUrl || '');
      setIsActive(editing?.isActive ?? true);
    }
  }, [open, editing]);

  async function handleImageUpload(file: File) {
    if (!business?.id) return;
    if (file.size > 3 * 1024 * 1024) {
      alert('Imagem muito grande (máx 3MB)');
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const catId = editing?.id || `new_${Date.now()}`;
      const storageRef = ref(storage, `businesses/${business.id}/menuCategories/${catId}_${Date.now()}.${ext}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      setImageUrl(url);
    } catch (err) {
      console.error('[CategoryImage] Upload error:', err);
      alert('Falha ao enviar imagem');
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!business?.id || !name.trim()) return;
    setSaving(true);
    try {
      const id = editing?.id || doc(collection(db, 'menuCategories')).id;
      const now = new Date().toISOString();
      const data: MenuCategory = {
        id,
        businessId: business.id,
        name: name.trim(),
        description: description.trim() || undefined,
        color,
        imageUrl: imageUrl || undefined,
        isActive,
        sortOrder: editing?.sortOrder ?? categories.length,
        createdAt: editing?.createdAt || now,
        updatedAt: now,
      };
      await setDoc(doc(db, 'menuCategories', id), data);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.96, y: 20, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.96, y: 20, opacity: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 280 }}
          className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <h3 className="font-bold text-gray-900 dark:text-white">
              {editing ? 'Editar Categoria' : 'Nova Categoria'}
            </h3>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>

          <div className="p-6 space-y-4">
            {/* Image */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Imagem (opcional)
              </label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className={`relative w-full aspect-[3/1] rounded-xl overflow-hidden border-2 transition-all ${
                  imageUrl
                    ? 'border-gray-200 dark:border-gray-700'
                    : 'border-dashed border-gray-300 dark:border-gray-600 hover:border-red-300 dark:hover:border-red-700 bg-gray-50 dark:bg-gray-800/50'
                }`}
              >
                {uploading ? (
                  <div className="w-full h-full flex items-center justify-center">
                    <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
                  </div>
                ) : imageUrl ? (
                  <>
                    <img src={imageUrl} alt={name} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/0 hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 hover:opacity-100">
                      <ImagePlus className="w-5 h-5 text-white" />
                      <span className="text-xs font-semibold text-white">Trocar</span>
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                    <ImagePlus className="w-5 h-5 text-gray-400" />
                    <span className="text-xs font-medium text-gray-500">Clique para enviar</span>
                  </div>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageUpload(file);
                  e.target.value = '';
                }}
              />
              {imageUrl && (
                <button
                  type="button"
                  onClick={() => setImageUrl('')}
                  className="mt-1 text-[11px] text-red-500 hover:text-red-600 font-semibold"
                >
                  Remover imagem
                </button>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Nome *
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Pizzas, Bebidas, Sobremesas"
                autoFocus
                className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Descrição (opcional)
              </label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Nossas deliciosas pizzas artesanais"
                className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Palette className="w-3 h-3" /> Cor
              </label>
              <div className="grid grid-cols-8 gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`relative w-full aspect-square rounded-lg transition-all ${
                      color === c ? 'ring-2 ring-offset-2 ring-gray-900 dark:ring-white scale-110' : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: c }}
                  >
                    {color === c && <Check className="w-3 h-3 text-white absolute inset-0 m-auto" />}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <button
                onClick={() => setIsActive(!isActive)}
                className={`w-10 h-6 rounded-full transition-colors relative ${isActive ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-700'}`}
              >
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${isActive ? 'left-4' : 'left-0.5'}`} />
              </button>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Categoria ativa (visível no cardápio)
              </span>
            </label>
          </div>

          <div className="flex gap-2 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || saving}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white transition-colors inline-flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {editing ? 'Salvar' : 'Criar'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
