'use client';

import React, { useState, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  IconButton,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Divider,
  Switch,
  FormControlLabel,
  CircularProgress,
} from '@mui/material';
import {
  Package,
  Search,
  Plus,
  Minus,
  LayoutGrid,
  List,
  AlertTriangle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Edit3,
  X,
  DollarSign,
  TrendingDown,
  Activity,
  ChevronDown,
  Download,
  Box,
  Beaker,
  Cpu,
  Trash2,
  ClipboardList,
  Image as ImageIcon,
  Upload,
  Camera,
} from 'lucide-react';
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Product, StockMovement } from '@/lib/types';
import { toast } from 'react-toastify';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDateTime } from '@/lib/utils/format';

// ==============================================
// TYPES
// ==============================================

type ViewMode = 'grid' | 'list';
type MovementType = 'entrada' | 'saida' | 'ajuste';
type SortField = 'name' | 'sku' | 'category' | 'currentStock' | 'costPrice' | 'salePrice';
type SortDirection = 'asc' | 'desc';
type StockStatusFilter = 'all' | 'em_estoque' | 'estoque_baixo' | 'sem_estoque';

interface LocalSortConfig {
  field: SortField;
  direction: SortDirection;
}

type ProductCategory = 'Material' | 'Produto' | 'Insumo' | 'Equipamento';
type ProductUnit = 'UN' | 'KG' | 'L' | 'M' | 'M2' | 'M3' | 'CX' | 'PCT';

interface ProductFormData {
  name: string;
  description: string;
  sku: string;
  barcode: string;
  category: string;
  unit: string;
  costPrice: string;
  salePrice: string;
  currentStock: string;
  minStock: string;
  maxStock: string;
  ncm: string;
  cfop: string;
  isActive: boolean;
  imageFile: File | null;
  imagePreview: string;
  existingImageUrl: string;
}

interface MovementFormData {
  type: MovementType;
  productId: string;
  quantity: string;
  reason: string;
  notes: string;
}

// ==============================================
// CONSTANTS
// ==============================================

const CATEGORIES: ProductCategory[] = ['Material', 'Produto', 'Insumo', 'Equipamento'];
const UNITS: ProductUnit[] = ['UN', 'KG', 'L', 'M', 'M2', 'M3', 'CX', 'PCT'];

const MOVEMENT_REASONS: Record<MovementType, string[]> = {
  entrada: ['Compra', 'Devolucao de Cliente', 'Transferencia', 'Ajuste Manual', 'Producao'],
  saida: ['Venda', 'Perda', 'Devolucao a Fornecedor', 'Transferencia', 'Consumo Interno'],
  ajuste: ['Inventario', 'Correcao', 'Ajuste Manual', 'Avaria'],
};

const CATEGORY_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  Material: { bg: 'bg-blue-50 dark:bg-blue-500/10', text: 'text-blue-700 dark:text-blue-400', icon: 'text-blue-500 dark:text-blue-400' },
  Produto: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', icon: 'text-emerald-500 dark:text-emerald-400' },
  Insumo: { bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400', icon: 'text-amber-500 dark:text-amber-400' },
  Equipamento: { bg: 'bg-violet-50 dark:bg-violet-500/10', text: 'text-violet-700 dark:text-violet-400', icon: 'text-violet-500 dark:text-violet-400' },
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  Material: <Box className="w-6 h-6" />,
  Produto: <Package className="w-6 h-6" />,
  Insumo: <Beaker className="w-6 h-6" />,
  Equipamento: <Cpu className="w-6 h-6" />,
};

const EMPTY_PRODUCT_FORM: ProductFormData = {
  name: '',
  description: '',
  sku: '',
  barcode: '',
  category: 'Produto',
  unit: 'UN',
  costPrice: '',
  salePrice: '',
  currentStock: '',
  minStock: '',
  maxStock: '',
  ncm: '',
  cfop: '',
  isActive: true,
  imageFile: null,
  imagePreview: '',
  existingImageUrl: '',
};

const EMPTY_MOVEMENT_FORM: MovementFormData = {
  type: 'entrada',
  productId: '',
  quantity: '',
  reason: '',
  notes: '',
};

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// ==============================================
// ANIMATION VARIANTS
// ==============================================

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] },
  },
};

const cardVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: { duration: 0.2 },
  },
};

const sectionVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number], delay: 0.3 },
  },
};

// ==============================================
// UTILITY FUNCTIONS
// ==============================================

function getStockPercentage(current: number, max?: number): number {
  if (!max || max === 0) return current > 0 ? 100 : 0;
  return Math.min(100, Math.round((current / max) * 100));
}

function getStockColor(current: number, max?: number): string {
  const pct = getStockPercentage(current, max);
  if (pct > 50) return 'bg-emerald-500';
  if (pct >= 20) return 'bg-amber-500';
  return 'bg-red-500';
}

function getStockTextColor(current: number, min: number): string {
  if (current <= 0) return 'text-red-600 dark:text-red-400';
  if (current <= min) return 'text-amber-600 dark:text-amber-400';
  return 'text-emerald-600 dark:text-emerald-400';
}

function isLowStock(product: Product): boolean {
  return product.currentStock <= product.minStock && product.isActive;
}

function getMargin(cost: number, sale: number): number {
  if (sale === 0) return 0;
  return ((sale - cost) / sale) * 100;
}

function generateSKU(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'PRD-';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function parseCurrencyInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const num = parseInt(digits, 10);
  const formatted = (num / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return formatted;
}

function currencyDisplayToNumber(display: string): number {
  if (!display) return 0;
  const cleaned = display.replace(/\./g, '').replace(',', '.');
  return parseFloat(cleaned) || 0;
}

// ==============================================
// SKELETON LOADING
// ==============================================

function InventorySkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="h-7 w-32 rounded-xl shimmer" />
          <div className="h-4 w-48 rounded-lg shimmer mt-2" />
        </div>
        <div className="h-10 w-36 rounded-lg shimmer" />
      </div>

      {/* Filter bar */}
      <div className="flex gap-3">
        <div className="h-10 flex-1 max-w-md rounded-lg shimmer" />
        <div className="h-10 w-40 rounded-lg shimmer" />
        <div className="h-10 w-20 rounded-lg shimmer" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: i * 0.07 }}
            className="h-[100px] rounded-2xl shimmer"
          />
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: i * 0.05 }}
            className="h-[320px] rounded-xl shimmer"
          />
        ))}
      </div>
    </motion.div>
  );
}

// ==============================================
// STAT CARD
// ==============================================

interface StatCardProps {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
  subtitle: string;
}

function StatCard({ icon, iconBg, label, value, subtitle }: StatCardProps) {
  return (
    <motion.div
      variants={itemVariants}
      className={cn(
        'group relative surface stat-card-accent hover-lift rounded-xl p-6 overflow-hidden',
        'cursor-default',
      )}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/50 dark:from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      <div className="relative flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-muted-foreground mb-1">{label}</p>
          <p className="text-2xl font-bold tracking-tight text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground mt-2">{subtitle}</p>
        </div>
        <div className={cn('flex items-center justify-center w-11 h-11 rounded-xl', iconBg)}>
          {icon}
        </div>
      </div>
    </motion.div>
  );
}

// ==============================================
// PRODUCT CARD (Grid View)
// ==============================================

interface ProductCardProps {
  product: Product;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
  onMovement: (product: Product, type: MovementType) => void;
}

function ProductCard({ product, onEdit, onDelete, onMovement }: ProductCardProps) {
  const catColor = CATEGORY_COLORS[product.category] || CATEGORY_COLORS.Produto;
  const catIcon = CATEGORY_ICONS[product.category] || CATEGORY_ICONS.Produto;
  const stockPct = getStockPercentage(product.currentStock, product.maxStock);
  const stockColor = getStockColor(product.currentStock, product.maxStock);
  const low = isLowStock(product);

  return (
    <motion.div
      variants={cardVariants}
      layout
      className={cn(
        'group relative surface rounded-xl overflow-hidden',
        'hover:shadow-md hover:-translate-y-0.5 transition-all duration-200',
        low ? 'border-amber-200' : '',
        !product.isActive && 'opacity-60',
      )}
    >
      {/* Low stock warning badge */}
      {low && (
        <div className="absolute top-3 right-3 z-10">
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
            <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
            <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">Estoque Baixo</span>
          </div>
        </div>
      )}

      {/* Product Image / Placeholder */}
      {product.imageUrl ? (
        <div className="relative h-32 overflow-hidden bg-gray-100 dark:bg-gray-800">
          <img
            src={product.imageUrl}
            alt={product.name}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className={cn('flex items-center justify-center h-32', catColor.bg)}>
          <div className={catColor.icon}>{catIcon}</div>
        </div>
      )}

      <div className="p-4 space-y-3">
        {/* Name & SKU */}
        <div>
          <h3 className="text-sm font-semibold text-foreground truncate">{product.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">SKU: {product.sku || '--'}</p>
        </div>

        {/* Stock Level */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Estoque</span>
            <span className={cn('text-sm font-bold', getStockTextColor(product.currentStock, product.minStock))}>
              {product.currentStock} {product.unit}
            </span>
          </div>
          <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
            <motion.div
              className={cn('h-full rounded-full', stockColor)}
              initial={{ width: 0 }}
              animate={{ width: `${stockPct}%` }}
              transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number], delay: 0.3 }}
            />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-muted-foreground">Min: {product.minStock}</span>
            {product.maxStock && (
              <span className="text-[10px] text-muted-foreground">Max: {product.maxStock}</span>
            )}
          </div>
        </div>

        {/* Prices */}
        <div className="flex items-center justify-between pt-2 border-t border-border/40">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Custo</p>
            <p className="text-xs font-medium text-foreground">{formatCurrency(product.costPrice)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Venda</p>
            <p className="text-xs font-semibold text-foreground">{formatCurrency(product.salePrice)}</p>
          </div>
        </div>

        {/* Category Badge */}
        <div className="flex items-center justify-between">
          <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold', catColor.bg, catColor.text)}>
            {product.category}
          </span>
          {!product.isActive && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              Inativo
            </span>
          )}
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-1.5 pt-2 border-t border-border/40">
          <button
            onClick={() => onMovement(product, 'entrada')}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Entrada
          </button>
          <button
            onClick={() => onMovement(product, 'saida')}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors"
          >
            <Minus className="w-3.5 h-3.5" />
            Saida
          </button>
          <button
            onClick={() => onEdit(product)}
            className="flex items-center justify-center p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title="Editar"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDelete(product)}
            className="flex items-center justify-center p-1.5 rounded-lg text-muted-foreground hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            title="Excluir"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ==============================================
// SORTABLE COLUMN HEADER
// ==============================================

interface SortableHeaderProps {
  label: string;
  field: SortField;
  sortConfig: LocalSortConfig;
  onSort: (field: SortField) => void;
  className?: string;
}

function SortableHeader({ label, field, sortConfig, onSort, className }: SortableHeaderProps) {
  const isActive = sortConfig.field === field;
  return (
    <button
      onClick={() => onSort(field)}
      className={cn(
        'flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors',
        isActive && 'text-foreground',
        className,
      )}
    >
      {label}
      {isActive ? (
        sortConfig.direction === 'asc' ? (
          <ArrowUp className="w-3 h-3" />
        ) : (
          <ArrowDown className="w-3 h-3" />
        )
      ) : (
        <ArrowUpDown className="w-3 h-3 opacity-40" />
      )}
    </button>
  );
}

// ==============================================
// PRODUCT TABLE ROW (List View)
// ==============================================

interface ProductRowProps {
  product: Product;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
  onMovement: (product: Product, type: MovementType) => void;
}

function ProductRow({ product, onEdit, onDelete, onMovement }: ProductRowProps) {
  const catColor = CATEGORY_COLORS[product.category] || CATEGORY_COLORS.Produto;
  const low = isLowStock(product);
  const stockPct = getStockPercentage(product.currentStock, product.maxStock);
  const stockBarColor = getStockColor(product.currentStock, product.maxStock);

  return (
    <tr className={cn(
      'border-b border-border/40 hover:bg-muted/30 transition-colors',
      low && 'bg-amber-50/40 dark:bg-amber-500/5',
    )}>
      {/* Image */}
      <td className="py-3 px-4">
        {product.imageUrl ? (
          <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0">
            <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className={cn('flex items-center justify-center w-9 h-9 rounded-lg shrink-0', catColor.bg, catColor.icon)}>
            {React.cloneElement((CATEGORY_ICONS[product.category] || CATEGORY_ICONS.Produto) as React.ReactElement<{ className?: string }>, { className: 'w-4 h-4' })}
          </div>
        )}
      </td>
      {/* Produto */}
      <td className="py-3 px-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{product.name}</p>
          {low && (
            <div className="flex items-center gap-1 mt-0.5">
              <AlertTriangle className="w-3 h-3 text-amber-500" />
              <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Abaixo do minimo</span>
            </div>
          )}
        </div>
      </td>
      {/* SKU */}
      <td className="py-3 px-4">
        <span className="text-sm text-muted-foreground font-mono">{product.sku || '--'}</span>
      </td>
      {/* Categoria */}
      <td className="py-3 px-4">
        <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold', catColor.bg, catColor.text)}>
          {product.category}
        </span>
      </td>
      {/* Estoque Atual */}
      <td className="py-3 px-4">
        <div className="space-y-1">
          <span className={cn('text-sm font-bold', getStockTextColor(product.currentStock, product.minStock))}>
            {product.currentStock} {product.unit}
          </span>
          <div className="w-20 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full', stockBarColor)} style={{ width: `${stockPct}%` }} />
          </div>
        </div>
      </td>
      {/* Preco Venda */}
      <td className="py-3 px-4">
        <span className="text-sm font-medium text-foreground">{formatCurrency(product.salePrice)}</span>
      </td>
      {/* Status */}
      <td className="py-3 px-4">
        <span className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold',
          product.isActive
            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
        )}>
          <span className={cn('w-1.5 h-1.5 rounded-full', product.isActive ? 'bg-emerald-500' : 'bg-gray-400')} />
          {product.isActive ? 'Ativo' : 'Inativo'}
        </span>
      </td>
      {/* Actions */}
      <td className="py-3 px-4">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onMovement(product, 'entrada')}
            className="p-1.5 rounded-md text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors"
            title="Entrada"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={() => onMovement(product, 'saida')}
            className="p-1.5 rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            title="Saida"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={() => onEdit(product)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title="Editar"
          >
            <Edit3 className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(product)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            title="Excluir"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ==============================================
// IMAGE UPLOAD DROP ZONE
// ==============================================

interface ImageDropZoneProps {
  preview: string;
  existingUrl: string;
  onFileSelect: (file: File) => void;
  onRemove: () => void;
  error?: string;
}

function ImageDropZone({ preview, existingUrl, onFileSelect, onRemove, error }: ImageDropZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const displayUrl = preview || existingUrl;

  function handleFile(file: File) {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      return;
    }
    onFileSelect(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  if (displayUrl) {
    return (
      <div className="relative">
        <div className="relative w-full h-40 rounded-xl overflow-hidden border border-border/60 bg-gray-50 dark:bg-gray-800">
          <img src={displayUrl} alt="Preview" className="w-full h-full object-contain" />
          <div className="absolute inset-0 bg-black/0 hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 rounded-lg bg-white/90 text-sm font-medium text-gray-700 hover:bg-white transition-colors"
              >
                <Camera className="w-4 h-4 inline mr-1" />
                Trocar
              </button>
              <button
                type="button"
                onClick={onRemove}
                className="px-3 py-1.5 rounded-lg bg-red-500/90 text-sm font-medium text-white hover:bg-red-500 transition-colors"
              >
                <Trash2 className="w-4 h-4 inline mr-1" />
                Remover
              </button>
            </div>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          onChange={handleInputChange}
          className="hidden"
        />
      </div>
    );
  }

  return (
    <div>
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'flex flex-col items-center justify-center h-40 rounded-xl border-2 border-dashed cursor-pointer transition-all',
          isDragging
            ? 'border-red-400 bg-red-50/50 dark:bg-red-500/5'
            : 'border-border/60 hover:border-red-300 dark:hover:border-red-500/40 bg-gray-50/50 dark:bg-gray-800/50 hover:bg-red-50/30 dark:hover:bg-red-500/5',
          error && 'border-red-400',
        )}
      >
        <Upload className="w-8 h-8 text-muted-foreground/60 mb-2" />
        <p className="text-sm font-medium text-muted-foreground">
          Arraste uma imagem ou clique para selecionar
        </p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          JPG, PNG ou WebP - Max 5MB
        </p>
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        onChange={handleInputChange}
        className="hidden"
      />
    </div>
  );
}

// ==============================================
// CURRENCY INPUT
// ==============================================

interface CurrencyInputProps {
  label: string;
  value: string;
  onChange: (formatted: string) => void;
  error?: string;
  helperText?: string;
  required?: boolean;
}

function CurrencyInput({ label, value, onChange, error, helperText, required }: CurrencyInputProps) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const formatted = parseCurrencyInput(raw);
    onChange(formatted);
  }

  return (
    <TextField
      label={label}
      value={value ? `R$ ${value}` : ''}
      onChange={handleChange}
      error={!!error}
      helperText={helperText || error}
      fullWidth
      required={required}
      size="small"
      placeholder="R$ 0,00"
      slotProps={{
        input: {
          inputMode: 'numeric',
        },
      }}
    />
  );
}

// ==============================================
// DELETE CONFIRMATION DIALOG
// ==============================================

interface DeleteDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  productName: string;
  isDeleting: boolean;
}

function DeleteDialog({ open, onClose, onConfirm, productName, isDeleting }: DeleteDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={isDeleting ? undefined : onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{ sx: { borderRadius: '16px' } }}
    >
      <DialogTitle
        sx={{
          fontFamily: '"Plus Jakarta Sans", sans-serif',
          fontWeight: 700,
          pb: 1,
        }}
      >
        Excluir Produto
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ pt: 3 }}>
        <div className="flex flex-col items-center text-center py-4">
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-red-50 dark:bg-red-500/10 mb-4">
            <Trash2 className="w-7 h-7 text-red-600 dark:text-red-400" />
          </div>
          <p className="text-sm text-foreground">
            Tem certeza que deseja excluir o produto{' '}
            <span className="font-semibold">{productName}</span>?
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Esta acao nao pode ser desfeita.
          </p>
        </div>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={isDeleting} sx={{ color: '#64748B' }}>
          Cancelar
        </Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          disabled={isDeleting}
          sx={{
            backgroundColor: '#DC2626',
            '&:hover': { backgroundColor: '#B91C1C' },
            minWidth: 100,
          }}
        >
          {isDeleting ? (
            <CircularProgress size={20} sx={{ color: 'white' }} />
          ) : (
            'Excluir'
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ==============================================
// STOCK MOVEMENT DIALOG
// ==============================================

interface StockMovementDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: MovementFormData) => Promise<void>;
  products: Product[];
  initialProduct?: Product | null;
  initialType?: MovementType;
}

function StockMovementDialog({
  open,
  onClose,
  onSave,
  products,
  initialProduct,
  initialType,
}: StockMovementDialogProps) {
  const [form, setForm] = useState<MovementFormData>({
    ...EMPTY_MOVEMENT_FORM,
    type: initialType || 'entrada',
    productId: initialProduct?.id || '',
  });
  const [isSaving, setIsSaving] = useState(false);

  React.useEffect(() => {
    if (open) {
      setForm({
        ...EMPTY_MOVEMENT_FORM,
        type: initialType || 'entrada',
        productId: initialProduct?.id || '',
      });
    }
  }, [open, initialProduct, initialType]);

  const selectedProduct = products.find((p) => p.id === form.productId);
  const qty = parseInt(form.quantity) || 0;
  const newStock = selectedProduct
    ? form.type === 'entrada'
      ? selectedProduct.currentStock + qty
      : form.type === 'saida'
        ? Math.max(0, selectedProduct.currentStock - qty)
        : qty
    : 0;

  async function handleSubmit() {
    if (!form.productId || !form.quantity || !form.reason) return;
    setIsSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (err) {
      console.error('Error saving movement:', err);
      toast.error('Erro ao registrar movimentacao');
    } finally {
      setIsSaving(false);
    }
  }

  const typeStyles: Record<MovementType, { bg: string; text: string; activeBg: string }> = {
    entrada: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', activeBg: 'bg-emerald-100 dark:bg-emerald-500/20 border-emerald-300 dark:border-emerald-500/40' },
    saida: { bg: 'bg-red-50 dark:bg-red-500/10', text: 'text-red-700 dark:text-red-400', activeBg: 'bg-red-100 dark:bg-red-500/20 border-red-300 dark:border-red-500/40' },
    ajuste: { bg: 'bg-blue-50 dark:bg-blue-500/10', text: 'text-blue-700 dark:text-blue-400', activeBg: 'bg-blue-100 dark:bg-blue-500/20 border-blue-300 dark:border-blue-500/40' },
  };

  return (
    <Dialog
      open={open}
      onClose={isSaving ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { borderRadius: '16px', maxHeight: '90vh' } }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pb: 1,
          fontFamily: '"Plus Jakarta Sans", sans-serif',
          fontWeight: 700,
        }}
      >
        <span>Movimentacao de Estoque</span>
        <IconButton onClick={onClose} disabled={isSaving} size="small">
          <X size={20} />
        </IconButton>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ pt: 3 }}>
        <div className="space-y-5">
          {/* Movement Type */}
          <div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Tipo de Movimentacao</p>
            <div className="grid grid-cols-3 gap-2">
              {(['entrada', 'saida', 'ajuste'] as MovementType[]).map((type) => {
                const style = typeStyles[type];
                const isSelected = form.type === type;
                return (
                  <button
                    key={type}
                    onClick={() => setForm((f) => ({ ...f, type, reason: '' }))}
                    className={cn(
                      'px-3 py-2.5 rounded-lg text-sm font-medium border transition-all',
                      isSelected
                        ? cn(style.activeBg, style.text, 'border')
                        : 'bg-white dark:bg-gray-800 border-border/60 text-muted-foreground hover:bg-muted/30',
                    )}
                  >
                    {type === 'entrada' ? 'Entrada' : type === 'saida' ? 'Saida' : 'Ajuste'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Product */}
          <FormControl fullWidth size="small">
            <InputLabel>Produto</InputLabel>
            <Select
              value={form.productId}
              onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
              label="Produto"
            >
              {products.filter((p) => p.isActive).map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name} ({p.currentStock} {p.unit})
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Current Stock Display */}
          {selectedProduct && (
            <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/40 border border-border/40">
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">Estoque Atual</p>
                <p className={cn('text-lg font-bold', getStockTextColor(selectedProduct.currentStock, selectedProduct.minStock))}>
                  {selectedProduct.currentStock} {selectedProduct.unit}
                </p>
              </div>
              {form.quantity && (
                <>
                  <div className="text-muted-foreground">
                    {form.type === 'entrada' ? <Plus className="w-5 h-5 text-emerald-500" /> : form.type === 'saida' ? <Minus className="w-5 h-5 text-red-500" /> : <ArrowUpDown className="w-5 h-5 text-blue-500" />}
                  </div>
                  <div className="flex-1 text-right">
                    <p className="text-xs text-muted-foreground">Novo Estoque</p>
                    <p className="text-lg font-bold text-foreground">
                      {form.type === 'ajuste' ? qty : newStock} {selectedProduct.unit}
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Quantity */}
          <TextField
            label={form.type === 'ajuste' ? 'Novo Estoque' : 'Quantidade'}
            type="number"
            value={form.quantity}
            onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
            fullWidth
            size="small"
            slotProps={{ htmlInput: { min: 0 } }}
          />

          {/* Reason */}
          <FormControl fullWidth size="small">
            <InputLabel>Motivo</InputLabel>
            <Select
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              label="Motivo"
            >
              {MOVEMENT_REASONS[form.type].map((reason) => (
                <MenuItem key={reason} value={reason}>
                  {reason}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Notes */}
          <TextField
            label="Observacoes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            fullWidth
            multiline
            rows={2}
            size="small"
          />
        </div>
      </DialogContent>

      <Divider />

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={isSaving} sx={{ color: '#64748B' }}>
          Cancelar
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={isSaving || !form.productId || !form.quantity || !form.reason}
          sx={{
            backgroundColor: '#DC2626',
            '&:hover': { backgroundColor: '#B91C1C' },
            '&.Mui-disabled': { backgroundColor: '#FCA5A5', color: '#fff' },
            minWidth: 120,
          }}
        >
          {isSaving ? (
            <CircularProgress size={20} sx={{ color: 'white' }} />
          ) : (
            'Confirmar'
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ==============================================
// NEW/EDIT PRODUCT DIALOG
// ==============================================

interface ProductDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: ProductFormData) => Promise<void>;
  product?: Product | null;
}

function ProductDialog({ open, onClose, onSave, product }: ProductDialogProps) {
  const [form, setForm] = useState<ProductFormData>(EMPTY_PRODUCT_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [imageError, setImageError] = useState('');

  const isEditing = !!product;

  React.useEffect(() => {
    if (open) {
      if (product) {
        const costFormatted = product.costPrice
          ? (product.costPrice).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : '';
        const saleFormatted = product.salePrice
          ? (product.salePrice).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : '';
        setForm({
          name: product.name,
          description: product.description || '',
          sku: product.sku || '',
          barcode: product.barcode || '',
          category: product.category,
          unit: product.unit,
          costPrice: costFormatted,
          salePrice: saleFormatted,
          currentStock: String(product.currentStock),
          minStock: String(product.minStock),
          maxStock: product.maxStock ? String(product.maxStock) : '',
          ncm: product.ncm || '',
          cfop: product.cfop || '',
          isActive: product.isActive,
          imageFile: null,
          imagePreview: '',
          existingImageUrl: product.imageUrl || '',
        });
      } else {
        setForm(EMPTY_PRODUCT_FORM);
      }
      setErrors({});
      setImageError('');
    }
  }, [product, open]);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!form.name.trim()) newErrors.name = 'Nome obrigatorio';
    const costNum = currencyDisplayToNumber(form.costPrice);
    const saleNum = currencyDisplayToNumber(form.salePrice);
    if (costNum < 0) newErrors.costPrice = 'Preco de custo invalido';
    if (saleNum < 0) newErrors.salePrice = 'Preco de venda invalido';
    if (form.currentStock === '' || parseInt(form.currentStock) < 0) newErrors.currentStock = 'Estoque invalido';
    if (form.minStock === '' || parseInt(form.minStock) < 0) newErrors.minStock = 'Estoque minimo invalido';
    if (form.ncm && form.ncm.replace(/\D/g, '').length !== 0 && form.ncm.replace(/\D/g, '').length !== 8) {
      newErrors.ncm = 'NCM deve ter 8 digitos';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setIsSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (err) {
      console.error('Error saving product:', err);
      toast.error('Erro ao salvar produto');
    } finally {
      setIsSaving(false);
    }
  }

  const costVal = currencyDisplayToNumber(form.costPrice);
  const saleVal = currencyDisplayToNumber(form.salePrice);
  const margin = getMargin(costVal, saleVal);

  function updateField(field: keyof ProductFormData, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: '' }));
  }

  function handleFileSelect(file: File) {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setImageError('Formato invalido. Use JPG, PNG ou WebP.');
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setImageError('Imagem muito grande. Maximo 5MB.');
      return;
    }
    setImageError('');
    const preview = URL.createObjectURL(file);
    setForm((f) => ({ ...f, imageFile: file, imagePreview: preview, existingImageUrl: '' }));
  }

  function handleImageRemove() {
    if (form.imagePreview) {
      URL.revokeObjectURL(form.imagePreview);
    }
    setForm((f) => ({ ...f, imageFile: null, imagePreview: '', existingImageUrl: '' }));
  }

  return (
    <Dialog
      open={open}
      onClose={isSaving ? undefined : onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { borderRadius: '16px', maxHeight: '90vh' } }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pb: 1,
          fontFamily: '"Plus Jakarta Sans", sans-serif',
          fontWeight: 700,
        }}
      >
        <span>{isEditing ? 'Editar Produto' : 'Novo Produto'}</span>
        <IconButton onClick={onClose} disabled={isSaving} size="small">
          <X size={20} />
        </IconButton>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ pt: 3 }}>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="space-y-5">
            {/* Image Upload */}
            <div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
                <ImageIcon className="w-4 h-4" />
                Imagem do Produto
              </p>
              <ImageDropZone
                preview={form.imagePreview}
                existingUrl={form.existingImageUrl}
                onFileSelect={handleFileSelect}
                onRemove={handleImageRemove}
                error={imageError}
              />
            </div>

            {/* Nome + SKU */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TextField
                label="Nome do Produto"
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                error={!!errors.name}
                helperText={errors.name}
                fullWidth
                required
                size="small"
              />
              <TextField
                label="SKU"
                value={form.sku}
                onChange={(e) => updateField('sku', e.target.value)}
                fullWidth
                size="small"
                placeholder="Auto-gerado se vazio"
              />
            </div>

            {/* Descricao */}
            <TextField
              label="Descricao"
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
              fullWidth
              multiline
              rows={2}
              size="small"
            />

            {/* Codigo de Barras + Categoria + Unidade */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <TextField
                label="Codigo de Barras"
                value={form.barcode}
                onChange={(e) => updateField('barcode', e.target.value)}
                fullWidth
                size="small"
              />
              <FormControl fullWidth size="small">
                <InputLabel>Categoria</InputLabel>
                <Select
                  value={form.category}
                  onChange={(e) => updateField('category', e.target.value)}
                  label="Categoria"
                >
                  {CATEGORIES.map((cat) => (
                    <MenuItem key={cat} value={cat}>{cat}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>Unidade</InputLabel>
                <Select
                  value={form.unit}
                  onChange={(e) => updateField('unit', e.target.value)}
                  label="Unidade"
                >
                  {UNITS.map((u) => (
                    <MenuItem key={u} value={u}>{u}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </div>

            {/* Prices */}
            <div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Precos</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <CurrencyInput
                  label="Preco de Custo"
                  value={form.costPrice}
                  onChange={(v) => updateField('costPrice', v)}
                  error={errors.costPrice}
                  required
                />
                <CurrencyInput
                  label="Preco de Venda"
                  value={form.salePrice}
                  onChange={(v) => updateField('salePrice', v)}
                  error={errors.salePrice}
                  required
                />
                <div className="flex items-center px-3 rounded-lg bg-muted/40 border border-border/40">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Margem</p>
                    <p className={cn(
                      'text-lg font-bold',
                      margin > 0 ? 'text-emerald-600' : margin < 0 ? 'text-red-600' : 'text-muted-foreground',
                    )}>
                      {margin.toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Stock Levels */}
            <div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Estoque</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <TextField
                  label="Estoque Atual"
                  type="number"
                  value={form.currentStock}
                  onChange={(e) => updateField('currentStock', e.target.value)}
                  error={!!errors.currentStock}
                  helperText={errors.currentStock}
                  fullWidth
                  required
                  size="small"
                  slotProps={{ htmlInput: { min: 0 } }}
                />
                <TextField
                  label="Estoque Minimo"
                  type="number"
                  value={form.minStock}
                  onChange={(e) => updateField('minStock', e.target.value)}
                  error={!!errors.minStock}
                  helperText={errors.minStock}
                  fullWidth
                  required
                  size="small"
                  slotProps={{ htmlInput: { min: 0 } }}
                />
                <TextField
                  label="Estoque Maximo"
                  type="number"
                  value={form.maxStock}
                  onChange={(e) => updateField('maxStock', e.target.value)}
                  fullWidth
                  size="small"
                  slotProps={{ htmlInput: { min: 0 } }}
                />
              </div>
            </div>

            {/* Fiscal */}
            <div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Fiscal (Opcional)</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TextField
                  label="NCM"
                  value={form.ncm}
                  onChange={(e) => updateField('ncm', e.target.value)}
                  error={!!errors.ncm}
                  helperText={errors.ncm}
                  fullWidth
                  size="small"
                  placeholder="00000000"
                  slotProps={{ htmlInput: { maxLength: 8 } }}
                />
                <TextField
                  label="CFOP"
                  value={form.cfop}
                  onChange={(e) => updateField('cfop', e.target.value)}
                  fullWidth
                  size="small"
                  placeholder="0000"
                  slotProps={{ htmlInput: { maxLength: 4 } }}
                />
              </div>
            </div>

            {/* Active Toggle */}
            <FormControlLabel
              control={
                <Switch
                  checked={form.isActive}
                  onChange={(e) => updateField('isActive', e.target.checked)}
                  sx={{
                    '& .MuiSwitch-switchBase.Mui-checked': { color: '#DC2626' },
                    '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#DC2626' },
                  }}
                />
              }
              label={
                <span className="text-sm font-medium text-foreground">
                  Produto Ativo
                </span>
              }
            />
          </div>
        </motion.div>
      </DialogContent>

      <Divider />

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={isSaving} sx={{ color: '#64748B' }}>
          Cancelar
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={isSaving}
          sx={{
            backgroundColor: '#DC2626',
            '&:hover': { backgroundColor: '#B91C1C' },
            minWidth: 120,
          }}
        >
          {isSaving ? (
            <CircularProgress size={20} sx={{ color: 'white' }} />
          ) : isEditing ? (
            'Salvar'
          ) : (
            'Cadastrar'
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ==============================================
// MOVEMENT HISTORY TABLE
// ==============================================

interface MovementHistoryProps {
  movements: StockMovement[];
  isLoading: boolean;
}

function MovementHistory({ movements, isLoading }: MovementHistoryProps) {
  const typeConfig: Record<string, { label: string; bg: string; text: string }> = {
    entrada: { label: 'Entrada', bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400' },
    saida: { label: 'Saida', bg: 'bg-red-50 dark:bg-red-500/10', text: 'text-red-700 dark:text-red-400' },
    ajuste: { label: 'Ajuste', bg: 'bg-blue-50 dark:bg-blue-500/10', text: 'text-blue-700 dark:text-blue-400' },
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 rounded-lg shimmer" />
        ))}
      </div>
    );
  }

  if (movements.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <ClipboardList className="w-10 h-10 text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium text-muted-foreground">Nenhuma movimentacao registrada</p>
        <p className="text-xs text-muted-foreground mt-1">As movimentacoes de estoque aparecerao aqui</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border/60">
            <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Data</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Produto</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tipo</th>
            <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Qtd</th>
            <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Anterior</th>
            <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Novo</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Motivo</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Operador</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((mov) => {
            const tc = typeConfig[mov.type] || typeConfig.ajuste;
            return (
              <tr key={mov.id} className="border-b border-border/40 hover:bg-muted/30 transition-colors">
                <td className="py-2.5 px-4 text-sm text-muted-foreground whitespace-nowrap">
                  {formatDateTime(mov.createdAt)}
                </td>
                <td className="py-2.5 px-4 text-sm font-medium text-foreground truncate max-w-[200px]">
                  {mov.productName}
                </td>
                <td className="py-2.5 px-4">
                  <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold', tc.bg, tc.text)}>
                    {tc.label}
                  </span>
                </td>
                <td className="py-2.5 px-4 text-sm font-semibold text-right">
                  {mov.type === 'entrada' ? '+' : mov.type === 'saida' ? '-' : ''}{mov.quantity}
                </td>
                <td className="py-2.5 px-4 text-sm text-muted-foreground text-right hidden sm:table-cell">
                  {mov.previousStock}
                </td>
                <td className="py-2.5 px-4 text-sm text-foreground text-right font-medium hidden sm:table-cell">
                  {mov.newStock}
                </td>
                <td className="py-2.5 px-4 text-sm text-muted-foreground hidden md:table-cell">
                  {mov.reason}
                </td>
                <td className="py-2.5 px-4 text-sm text-muted-foreground hidden lg:table-cell">
                  {mov.operatorName}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ==============================================
// EMPTY STATE
// ==============================================

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center justify-center py-20 text-center"
    >
      <div className="flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-red-50 to-red-100 dark:from-red-500/10 dark:to-red-500/5 mb-6">
        <Package className="w-10 h-10 text-red-500/60" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">
        Nenhum produto cadastrado
      </h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">
        Comece adicionando seus produtos e materiais para controlar o estoque da sua empresa.
      </p>
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-red-600 to-red-500 text-white text-sm font-medium hover:from-red-700 hover:to-red-600 transition-all shadow-sm"
      >
        <Plus className="w-4 h-4" />
        Cadastrar Primeiro Produto
      </button>
    </motion.div>
  );
}

// ==============================================
// MAIN COMPONENT
// ==============================================

export default function InventoryModule() {
  const { user, business } = useAuth();
  const queryClient = useQueryClient();

  // UI State
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [stockFilter, setStockFilter] = useState<StockStatusFilter>('all');
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [sortConfig, setSortConfig] = useState<LocalSortConfig>({ field: 'name', direction: 'asc' });

  // Dialog state
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [movementDialogOpen, setMovementDialogOpen] = useState(false);
  const [movementProduct, setMovementProduct] = useState<Product | null>(null);
  const [movementType, setMovementType] = useState<MovementType>('entrada');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ==========================================
  // FIRESTORE QUERIES
  // ==========================================

  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ['products', business?.id],
    queryFn: async () => {
      if (!business?.id) return [];
      const q = query(
        collection(db, 'products'),
        where('businessId', '==', business.id),
        orderBy('name', 'asc'),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Product));
    },
    enabled: !!business?.id,
    staleTime: 5 * 60 * 1000,
  });

  const { data: movements = [], isLoading: movementsLoading } = useQuery({
    queryKey: ['stockMovements', business?.id],
    queryFn: async () => {
      if (!business?.id) return [];
      const q = query(
        collection(db, 'stockMovements'),
        where('businessId', '==', business.id),
        orderBy('createdAt', 'desc'),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as StockMovement));
    },
    enabled: !!business?.id,
    staleTime: 2 * 60 * 1000,
  });

  // ==========================================
  // IMAGE UPLOAD
  // ==========================================

  async function uploadProductImage(file: File, productId: string): Promise<string> {
    if (!business?.id) throw new Error('Business not found');
    const ext = file.name.split('.').pop() || 'jpg';
    const fileName = `${productId}_${Date.now()}.${ext}`;
    const storageRef = ref(storage, `products/${business.id}/${productId}/${fileName}`);
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
  }

  // ==========================================
  // CRUD HANDLERS
  // ==========================================

  const handleSaveProduct = useCallback(async (data: ProductFormData) => {
    if (!business?.id || !user) return;

    const costPrice = currencyDisplayToNumber(data.costPrice);
    const salePrice = currencyDisplayToNumber(data.salePrice);
    const currentStock = parseInt(data.currentStock) || 0;
    const minStock = parseInt(data.minStock) || 0;
    const maxStock = data.maxStock ? parseInt(data.maxStock) : undefined;
    const sku = data.sku.trim() || generateSKU();

    if (editingProduct) {
      // UPDATE
      let imageUrl = data.existingImageUrl || editingProduct.imageUrl || '';

      if (data.imageFile) {
        imageUrl = await uploadProductImage(data.imageFile, editingProduct.id);
      } else if (!data.existingImageUrl && !data.imagePreview) {
        imageUrl = '';
      }

      const updateData: Record<string, unknown> = {
        name: data.name.trim(),
        description: data.description.trim() || undefined,
        sku,
        barcode: data.barcode.trim() || undefined,
        category: data.category,
        unit: data.unit,
        costPrice,
        salePrice,
        currentStock,
        minStock,
        maxStock: maxStock ?? null,
        ncm: data.ncm.trim() || undefined,
        cfop: data.cfop.trim() || undefined,
        isActive: data.isActive,
        imageUrl: imageUrl || null,
        updatedAt: new Date().toISOString(),
      };

      // Remove undefined values
      const cleanedData = Object.fromEntries(
        Object.entries(updateData).filter(([, v]) => v !== undefined)
      );

      await updateDoc(doc(db, 'products', editingProduct.id), cleanedData);
      toast.success('Produto atualizado com sucesso!');
    } else {
      // CREATE
      const productData = {
        businessId: business.id,
        name: data.name.trim(),
        description: data.description.trim() || '',
        sku,
        barcode: data.barcode.trim() || '',
        category: data.category,
        unit: data.unit,
        costPrice,
        salePrice,
        currentStock,
        minStock,
        maxStock: maxStock ?? null,
        ncm: data.ncm.trim() || '',
        cfop: data.cfop.trim() || '',
        isActive: data.isActive,
        imageUrl: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const docRef = await addDoc(collection(db, 'products'), productData);

      // Upload image if provided
      if (data.imageFile) {
        const imageUrl = await uploadProductImage(data.imageFile, docRef.id);
        await updateDoc(doc(db, 'products', docRef.id), { imageUrl });
      }
      toast.success('Produto cadastrado com sucesso!');
    }

    queryClient.invalidateQueries({ queryKey: ['products', business.id] });
  }, [business?.id, user, editingProduct, queryClient]);

  const handleSaveMovement = useCallback(async (data: MovementFormData) => {
    if (!business?.id || !user) return;

    const product = products.find((p) => p.id === data.productId);
    if (!product) return;

    const qty = parseInt(data.quantity) || 0;
    const previousStock = product.currentStock;
    let newStock: number;

    if (data.type === 'entrada') {
      newStock = previousStock + qty;
    } else if (data.type === 'saida') {
      newStock = Math.max(0, previousStock - qty);
    } else {
      // ajuste - set to exact value
      newStock = qty;
    }

    // Create stock movement record
    const movementData = {
      businessId: business.id,
      productId: product.id,
      productName: product.name,
      type: data.type,
      quantity: qty,
      previousStock,
      newStock,
      reason: data.reason,
      operatorId: user.uid,
      operatorName: user.name,
      createdAt: new Date().toISOString(),
    };

    await addDoc(collection(db, 'stockMovements'), movementData);

    // Update product stock
    await updateDoc(doc(db, 'products', product.id), {
      currentStock: newStock,
      updatedAt: new Date().toISOString(),
    });

    toast.success('Movimentacao registrada com sucesso!');
    queryClient.invalidateQueries({ queryKey: ['products', business.id] });
    queryClient.invalidateQueries({ queryKey: ['stockMovements', business.id] });
  }, [business?.id, user, products, queryClient]);

  const handleDeleteProduct = useCallback(async () => {
    if (!business?.id || !deletingProduct) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'products', deletingProduct.id));
      toast.success('Produto excluido com sucesso');
      queryClient.invalidateQueries({ queryKey: ['products', business.id] });
      setDeleteDialogOpen(false);
      setDeletingProduct(null);
    } catch (err) {
      console.error('Error deleting product:', err);
      toast.error('Erro ao excluir produto');
    } finally {
      setIsDeleting(false);
    }
  }, [business?.id, deletingProduct, queryClient]);

  // ==========================================
  // COMPUTED VALUES
  // ==========================================

  const activeProducts = useMemo(() => products.filter((p) => p.isActive), [products]);

  const filteredProducts = useMemo(() => {
    let result = [...products];

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku && p.sku.toLowerCase().includes(q)) ||
          (p.barcode && p.barcode.includes(q)) ||
          p.category.toLowerCase().includes(q),
      );
    }

    // Category filter
    if (categoryFilter !== 'all') {
      result = result.filter((p) => p.category === categoryFilter);
    }

    // Stock status filter
    if (stockFilter !== 'all') {
      if (stockFilter === 'sem_estoque') {
        result = result.filter((p) => p.currentStock <= 0);
      } else if (stockFilter === 'estoque_baixo') {
        result = result.filter((p) => p.currentStock > 0 && p.currentStock <= p.minStock);
      } else if (stockFilter === 'em_estoque') {
        result = result.filter((p) => p.currentStock > p.minStock);
      }
    }

    // Active filter
    if (activeFilter !== 'all') {
      result = result.filter((p) => activeFilter === 'ativo' ? p.isActive : !p.isActive);
    }

    // Sort
    result.sort((a, b) => {
      const dir = sortConfig.direction === 'asc' ? 1 : -1;
      const field = sortConfig.field;

      if (field === 'name') return a.name.localeCompare(b.name) * dir;
      if (field === 'sku') return (a.sku || '').localeCompare(b.sku || '') * dir;
      if (field === 'category') return a.category.localeCompare(b.category) * dir;
      if (field === 'currentStock') return (a.currentStock - b.currentStock) * dir;
      if (field === 'costPrice') return (a.costPrice - b.costPrice) * dir;
      if (field === 'salePrice') return (a.salePrice - b.salePrice) * dir;
      return 0;
    });

    return result;
  }, [products, searchQuery, categoryFilter, stockFilter, activeFilter, sortConfig]);

  const stats = useMemo(() => {
    const totalProducts = activeProducts.length;
    const totalValue = activeProducts.reduce((sum, p) => sum + p.costPrice * p.currentStock, 0);
    const lowStockCount = activeProducts.filter((p) => isLowStock(p)).length;
    const todayMovements = movements.filter((m) => {
      const today = new Date().toISOString().slice(0, 10);
      return m.createdAt.slice(0, 10) === today;
    }).length;
    return { totalProducts, totalValue, lowStockCount, todayMovements };
  }, [activeProducts, movements]);

  // ==========================================
  // UI HANDLERS
  // ==========================================

  const handleSort = useCallback((field: SortField) => {
    setSortConfig((prev) => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  }, []);

  const handleNewProduct = useCallback(() => {
    setEditingProduct(null);
    setProductDialogOpen(true);
  }, []);

  const handleEditProduct = useCallback((product: Product) => {
    setEditingProduct(product);
    setProductDialogOpen(true);
  }, []);

  const handleMovement = useCallback((product: Product, type: MovementType) => {
    setMovementProduct(product);
    setMovementType(type);
    setMovementDialogOpen(true);
  }, []);

  const handleRequestDelete = useCallback((product: Product) => {
    setDeletingProduct(product);
    setDeleteDialogOpen(true);
  }, []);

  // ==========================================
  // LOADING STATE
  // ==========================================

  if (productsLoading) {
    return <InventorySkeleton />;
  }

  // ==========================================
  // EMPTY STATE (no products at all)
  // ==========================================

  if (products.length === 0 && !productsLoading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground font-display">
              Estoque
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Gerencie seus produtos e materiais
            </p>
          </div>
        </div>
        <EmptyState onAdd={handleNewProduct} />
        <ProductDialog
          open={productDialogOpen}
          onClose={() => {
            setProductDialogOpen(false);
            setEditingProduct(null);
          }}
          onSave={handleSaveProduct}
          product={editingProduct}
        />
      </div>
    );
  }

  // ==========================================
  // MAIN RENDER
  // ==========================================

  return (
    <div className="space-y-6">
      {/* ============ HEADER ============ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-display">
            Estoque
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {stats.totalProducts} produtos cadastrados
          </p>
        </div>
        <button
          onClick={handleNewProduct}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-red-600 to-red-500 text-white text-sm font-medium hover:from-red-700 hover:to-red-600 transition-all shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Novo Produto
        </button>
      </div>

      {/* ============ FILTERS BAR ============ */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por nome, SKU ou codigo..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border/60 bg-white/70 dark:bg-gray-900/70 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-300 transition-all"
          />
        </div>

        {/* Category Filter */}
        <div className="relative">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="appearance-none pl-3 pr-9 py-2.5 rounded-lg border border-border/60 bg-white/70 dark:bg-gray-900/70 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-300 transition-all cursor-pointer"
          >
            <option value="all">Todas Categorias</option>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        </div>

        {/* Stock Status Filter */}
        <div className="relative">
          <select
            value={stockFilter}
            onChange={(e) => setStockFilter(e.target.value as StockStatusFilter)}
            className="appearance-none pl-3 pr-9 py-2.5 rounded-lg border border-border/60 bg-white/70 dark:bg-gray-900/70 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-300 transition-all cursor-pointer"
          >
            <option value="all">Todo Estoque</option>
            <option value="em_estoque">Em Estoque</option>
            <option value="estoque_baixo">Estoque Baixo</option>
            <option value="sem_estoque">Sem Estoque</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        </div>

        {/* Active Filter */}
        <div className="relative">
          <select
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value)}
            className="appearance-none pl-3 pr-9 py-2.5 rounded-lg border border-border/60 bg-white/70 dark:bg-gray-900/70 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-300 transition-all cursor-pointer"
          >
            <option value="all">Todos</option>
            <option value="ativo">Ativos</option>
            <option value="inativo">Inativos</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-1 bg-muted/60 rounded-lg p-1">
          <button
            onClick={() => setViewMode('grid')}
            className={cn(
              'p-2 rounded-md transition-all duration-200',
              viewMode === 'grid'
                ? 'bg-white dark:bg-gray-700 text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title="Visualizacao em grade"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={cn(
              'p-2 rounded-md transition-all duration-200',
              viewMode === 'list'
                ? 'bg-white dark:bg-gray-700 text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title="Visualizacao em lista"
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ============ STATS CARDS ============ */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <StatCard
          icon={<Package className="w-5 h-5 text-blue-600" />}
          iconBg="bg-blue-50 dark:bg-blue-500/10"
          label="Total de Produtos"
          value={String(stats.totalProducts)}
          subtitle={`${filteredProducts.length} exibidos`}
        />
        <StatCard
          icon={<DollarSign className="w-5 h-5 text-emerald-600" />}
          iconBg="bg-emerald-50 dark:bg-emerald-500/10"
          label="Valor em Estoque"
          value={formatCurrency(stats.totalValue)}
          subtitle="Custo total em estoque"
        />
        <StatCard
          icon={<TrendingDown className="w-5 h-5 text-amber-600" />}
          iconBg="bg-amber-50 dark:bg-amber-500/10"
          label="Itens Abaixo do Minimo"
          value={String(stats.lowStockCount)}
          subtitle={stats.lowStockCount > 0 ? 'Necessita reposicao' : 'Tudo em ordem'}
        />
        <StatCard
          icon={<Activity className="w-5 h-5 text-violet-600" />}
          iconBg="bg-violet-50 dark:bg-violet-500/10"
          label="Movimentacoes Hoje"
          value={String(stats.todayMovements)}
          subtitle="Entradas e saidas"
        />
      </motion.div>

      {/* ============ PRODUCT LIST/GRID ============ */}
      <motion.div
        variants={sectionVariants}
        initial="hidden"
        animate="visible"
      >
        <AnimatePresence mode="wait">
          {viewMode === 'grid' ? (
            <motion.div
              key="grid"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {filteredProducts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Package className="w-12 h-12 text-muted-foreground/40 mb-4" />
                  <p className="text-sm font-medium text-muted-foreground">Nenhum produto encontrado</p>
                  <p className="text-xs text-muted-foreground mt-1">Tente ajustar os filtros de busca</p>
                </div>
              ) : (
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                >
                  {filteredProducts.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      onEdit={handleEditProduct}
                      onDelete={handleRequestDelete}
                      onMovement={handleMovement}
                    />
                  ))}
                </motion.div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="surface rounded-xl overflow-hidden"
            >
              {filteredProducts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Package className="w-12 h-12 text-muted-foreground/40 mb-4" />
                  <p className="text-sm font-medium text-muted-foreground">Nenhum produto encontrado</p>
                  <p className="text-xs text-muted-foreground mt-1">Tente ajustar os filtros de busca</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border/60 bg-muted/20">
                        <th className="text-left py-3 px-4">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Img</span>
                        </th>
                        <th className="text-left py-3 px-4">
                          <SortableHeader label="Produto" field="name" sortConfig={sortConfig} onSort={handleSort} />
                        </th>
                        <th className="text-left py-3 px-4">
                          <SortableHeader label="SKU" field="sku" sortConfig={sortConfig} onSort={handleSort} />
                        </th>
                        <th className="text-left py-3 px-4">
                          <SortableHeader label="Categoria" field="category" sortConfig={sortConfig} onSort={handleSort} />
                        </th>
                        <th className="text-left py-3 px-4">
                          <SortableHeader label="Estoque" field="currentStock" sortConfig={sortConfig} onSort={handleSort} />
                        </th>
                        <th className="text-left py-3 px-4">
                          <SortableHeader label="P. Venda" field="salePrice" sortConfig={sortConfig} onSort={handleSort} />
                        </th>
                        <th className="text-left py-3 px-4">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</span>
                        </th>
                        <th className="text-left py-3 px-4">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Acoes</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProducts.map((product) => (
                        <ProductRow
                          key={product.id}
                          product={product}
                          onEdit={handleEditProduct}
                          onDelete={handleRequestDelete}
                          onMovement={handleMovement}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ============ MOVEMENT HISTORY ============ */}
      <motion.div
        variants={sectionVariants}
        initial="hidden"
        animate="visible"
        className="surface rounded-xl overflow-hidden"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-6 pb-4">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground">
              Historico de Movimentacoes
            </h2>
          </div>
          <button
            onClick={() => {
              setMovementProduct(null);
              setMovementType('entrada');
              setMovementDialogOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors border border-red-200 dark:border-red-500/20"
          >
            <Plus className="w-3.5 h-3.5" />
            Nova Movimentacao
          </button>
        </div>
        <MovementHistory movements={movements} isLoading={movementsLoading} />
      </motion.div>

      {/* ============ DIALOGS ============ */}
      <ProductDialog
        open={productDialogOpen}
        onClose={() => {
          setProductDialogOpen(false);
          setEditingProduct(null);
        }}
        onSave={handleSaveProduct}
        product={editingProduct}
      />

      <StockMovementDialog
        open={movementDialogOpen}
        onClose={() => {
          setMovementDialogOpen(false);
          setMovementProduct(null);
        }}
        onSave={handleSaveMovement}
        products={activeProducts}
        initialProduct={movementProduct}
        initialType={movementType}
      />

      <DeleteDialog
        open={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
          setDeletingProduct(null);
        }}
        onConfirm={handleDeleteProduct}
        productName={deletingProduct?.name || ''}
        isDeleting={isDeleting}
      />
    </div>
  );
}
