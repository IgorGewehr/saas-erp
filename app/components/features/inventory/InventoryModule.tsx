'use client';

import React, { useState, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import dynamicImport from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';

const SpreadsheetView = dynamicImport(() => import('@/app/components/features/spreadsheets/SpreadsheetView'), { ssr: false });
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
  FileSpreadsheet,
  Tag,
  FileText,
  Boxes,
  Truck,
  Send,
} from 'lucide-react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
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
import type { Product, StockMovement, ProductComponent, ProductModifierGroup, MenuCategory } from '@/lib/types';
import { notifyLowStock } from '@/lib/services/notifications';
import { addStock, deductStock, restoreStock, type StockAdjustment } from '@/lib/services/stock';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDateTime } from '@/lib/utils/format';
import ModifierGroupsEditor from './ModifierGroupsEditor';
import {
  ModernDialog, ModernDialogActions, ModernCancelButton, ModernPrimaryButton,
  ModernSection, ModernPill,
} from '@/app/components/ui/dialog';
import MenuCategoriesManager from './MenuCategoriesManager';
import NcmSelector from '@/app/components/features/fiscal/NcmSelector';
import { onSnapshot } from 'firebase/firestore';
import { Sparkles } from 'lucide-react';

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
  cest: string;
  icmsOrigem: string;
  gtin: string;
  // Campos fiscais auxiliares — usados em casos específicos da NF-e:
  // unidadeTrib quando a unidade tributável difere da comercial (ex: vendido
  // em "caixa" mas tributado em "unidade"); gtinTrib similar (EAN do item
  // tributável vs EAN da embalagem).
  unidadeTrib: string;
  gtinTrib: string;
  isActive: boolean;
  imageFile: File | null;
  imagePreview: string;
  existingImageUrl: string;
  // Delivery / Cardápio
  isDeliverable: boolean;
  menuCategory: string;
  menuCategoryId: string;
  menuDescription: string;
  preparationTime: string;
  components: ProductComponent[];
  dietary: string[];
  modifierGroups: ProductModifierGroup[];
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
  cest: '',
  icmsOrigem: '0',
  gtin: '',
  unidadeTrib: '',
  gtinTrib: '',
  isActive: true,
  imageFile: null,
  imagePreview: '',
  existingImageUrl: '',
  isDeliverable: false,
  menuCategory: '',
  menuCategoryId: '',
  menuDescription: '',
  preparationTime: '',
  components: [],
  dietary: [],
  modifierGroups: [],
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

const DIETARY_OPTIONS: { id: string; label: string; emoji: string }[] = [
  { id: 'vegan', label: 'Vegano', emoji: '🌱' },
  { id: 'vegetarian', label: 'Vegetariano', emoji: '🥦' },
  { id: 'glutenfree', label: 'Sem Glúten', emoji: '🌾' },
  { id: 'lactosefree', label: 'Sem Lactose', emoji: '🥛' },
  { id: 'organic', label: 'Orgânico', emoji: '♻️' },
  { id: 'picante', label: 'Picante', emoji: '🌶️' },
  { id: 'alcool', label: 'Contém Álcool', emoji: '🍺' },
  { id: 'kids', label: 'Kids', emoji: '👶' },
];

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
  const { t } = useTranslation();
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
            <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">{t('inventory.lowStock', 'Estoque Baixo')}</span>
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
            <span className="text-xs text-muted-foreground">{t('inventory.stock', 'Estoque')}</span>
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
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('inventory.cost', 'Custo')}</p>
            <p className="text-xs font-medium text-foreground">{formatCurrency(product.costPrice)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('inventory.salePrice', 'Venda')}</p>
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
              {t('inventory.inactive', 'Inativo')}
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
            {t('inventory.movement.entry', 'Entrada')}
          </button>
          <button
            onClick={() => onMovement(product, 'saida')}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors"
          >
            <Minus className="w-3.5 h-3.5" />
            {t('inventory.movement.exit', 'Saída')}
          </button>
          <button
            onClick={() => onEdit(product)}
            className="flex items-center justify-center p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title={t('inventory.edit', 'Editar')}
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDelete(product)}
            className="flex items-center justify-center p-1.5 rounded-lg text-muted-foreground hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            title={t('inventory.delete', 'Excluir')}
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
  const { t } = useTranslation();
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
              <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">{t('inventory.belowMinimum', 'Abaixo do mínimo')}</span>
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
          {product.isActive ? t('inventory.active', 'Ativo') : t('inventory.inactive', 'Inativo')}
        </span>
      </td>
      {/* Actions */}
      <td className="py-3 px-4">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onMovement(product, 'entrada')}
            className="p-1.5 rounded-md text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors"
            title={t('inventory.movement.entry', 'Entrada')}
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={() => onMovement(product, 'saida')}
            className="p-1.5 rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            title={t('inventory.movement.exit', 'Saída')}
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={() => onEdit(product)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title={t('inventory.edit', 'Editar')}
          >
            <Edit3 className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(product)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            title={t('inventory.delete', 'Excluir')}
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
  const { t } = useTranslation();
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
                {t('inventory.image.change', 'Trocar')}
              </button>
              <button
                type="button"
                onClick={onRemove}
                className="px-3 py-1.5 rounded-lg bg-red-500/90 text-sm font-medium text-white hover:bg-red-500 transition-colors"
              >
                <Trash2 className="w-4 h-4 inline mr-1" />
                {t('inventory.image.remove', 'Remover')}
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
          {t('inventory.image.dragOrClick', 'Arraste uma imagem ou clique para selecionar')}
        </p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          {t('inventory.image.formats', 'JPG, PNG ou WebP - Max 5MB')}
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
  const { t } = useTranslation();
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
        {t('inventory.deleteDialog.title', 'Excluir Produto')}
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ pt: 3 }}>
        <div className="flex flex-col items-center text-center py-4">
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-red-50 dark:bg-red-500/10 mb-4">
            <Trash2 className="w-7 h-7 text-red-600 dark:text-red-400" />
          </div>
          <p className="text-sm text-foreground">
            {t('inventory.deleteDialog.confirm', 'Tem certeza que deseja excluir o produto')}{' '}
            <span className="font-semibold">{productName}</span>?
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {t('inventory.deleteDialog.irreversible', 'Esta ação não pode ser desfeita.')}
          </p>
        </div>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={isDeleting} sx={{ color: '#64748B' }}>
          {t('inventory.cancel', 'Cancelar')}
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
            t('inventory.delete', 'Excluir')
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
  const { t } = useTranslation();
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
      toast.error(t('inventory.toast.movementError', 'Erro ao registrar movimentação'));
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
        <span>{t('inventory.movement.title', 'Movimentação de Estoque')}</span>
        <IconButton onClick={onClose} disabled={isSaving} size="small">
          <X size={20} />
        </IconButton>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ pt: 3 }}>
        <div className="space-y-5">
          {/* Movement Type */}
          <div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">{t('inventory.movement.typeLabel', 'Tipo de Movimentação')}</p>
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
                    {type === 'entrada' ? t('inventory.movement.entry', 'Entrada') : type === 'saida' ? t('inventory.movement.exit', 'Saída') : t('inventory.movement.adjustment', 'Ajuste')}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Product */}
          <FormControl fullWidth size="small">
            <InputLabel>{t('inventory.movement.product', 'Produto')}</InputLabel>
            <Select
              value={form.productId}
              onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
              label={t('inventory.movement.product', 'Produto')}
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
                <p className="text-xs text-muted-foreground">{t('inventory.movement.currentStock', 'Estoque Atual')}</p>
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
                    <p className="text-xs text-muted-foreground">{t('inventory.movement.newStock', 'Novo Estoque')}</p>
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
            label={form.type === 'ajuste' ? t('inventory.movement.newStock', 'Novo Estoque') : t('inventory.movement.quantity', 'Quantidade')}
            type="number"
            value={form.quantity}
            onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
            fullWidth
            size="small"
            slotProps={{ htmlInput: { min: 0 } }}
          />

          {/* Reason */}
          <FormControl fullWidth size="small">
            <InputLabel>{t('inventory.movement.reason', 'Motivo')}</InputLabel>
            <Select
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              label={t('inventory.movement.reason', 'Motivo')}
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
            label={t('inventory.movement.notes', 'Observações')}
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
          {t('inventory.cancel', 'Cancelar')}
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
            t('inventory.movement.confirm', 'Confirmar')
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
  allProducts?: Product[];
  deliveryEnabled?: boolean;
  menuCategories?: MenuCategory[];
  onOpenCategoriesManager?: () => void;
}

function ProductDialog({ open, onClose, onSave, product, allProducts = [], deliveryEnabled = false, menuCategories = [], onOpenCategoriesManager }: ProductDialogProps) {
  const { t } = useTranslation();
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
          cest: product.cest || '',
          icmsOrigem: product.icmsOrigem || '0',
          gtin: product.gtin || '',
          unidadeTrib: product.unidadeTrib || '',
          gtinTrib: product.gtinTrib || '',
          isActive: product.isActive,
          imageFile: null,
          imagePreview: '',
          existingImageUrl: product.imageUrl || '',
          isDeliverable: product.isDeliverable ?? false,
          menuCategory: product.menuCategory || '',
          menuCategoryId: product.menuCategoryId || '',
          menuDescription: product.menuDescription || '',
          preparationTime: product.preparationTime ? String(product.preparationTime) : '',
          components: product.components ? [...product.components] : [],
          dietary: product.dietary ? [...product.dietary] : [],
          modifierGroups: product.modifierGroups ? JSON.parse(JSON.stringify(product.modifierGroups)) : [],
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
    if (!form.name.trim()) newErrors.name = t('inventory.productForm.errors.nameRequired', 'Nome obrigatório');
    const costNum = currencyDisplayToNumber(form.costPrice);
    const saleNum = currencyDisplayToNumber(form.salePrice);
    if (costNum < 0) newErrors.costPrice = t('inventory.productForm.errors.invalidCostPrice', 'Preço de custo inválido');
    if (saleNum < 0) newErrors.salePrice = t('inventory.productForm.errors.invalidSalePrice', 'Preço de venda inválido');
    if (form.currentStock === '' || parseInt(form.currentStock) < 0) newErrors.currentStock = t('inventory.productForm.errors.invalidStock', 'Estoque inválido');
    if (form.minStock === '' || parseInt(form.minStock) < 0) newErrors.minStock = t('inventory.productForm.errors.invalidMinStock', 'Estoque mínimo inválido');
    if (form.ncm && form.ncm.replace(/\D/g, '').length !== 0 && form.ncm.replace(/\D/g, '').length !== 8) {
      newErrors.ncm = t('inventory.productForm.errors.ncmLength', 'NCM deve ter 8 dígitos');
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
      toast.error(t('inventory.toast.saveProductError', 'Erro ao salvar produto'));
    } finally {
      setIsSaving(false);
    }
  }

  const costVal = currencyDisplayToNumber(form.costPrice);
  const saleVal = currencyDisplayToNumber(form.salePrice);
  const margin = getMargin(costVal, saleVal);

  function updateField(field: keyof ProductFormData, value: string | boolean | string[]) {
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: '' }));
  }

  function handleFileSelect(file: File) {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setImageError(t('inventory.image.invalidFormat', 'Formato inválido. Use JPG, PNG ou WebP.'));
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setImageError(t('inventory.image.tooLarge', 'Imagem muito grande. Máximo 5MB.'));
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
    <ModernDialog
      open={open}
      onClose={isSaving ? () => {} : onClose}
      icon={Package}
      title={isEditing ? t('inventory.productForm.editProduct', 'Editar Produto') : t('inventory.productForm.newProduct', 'Novo Produto')}
      badges={
        <ModernPill tone={form.isActive ? 'emerald' : 'slate'}>
          {form.isActive ? 'Ativo' : 'Inativo'}
        </ModernPill>
      }
      footer={
        <ModernDialogActions>
          <ModernCancelButton onClick={onClose}>
            {t('inventory.cancel', 'Cancelar')}
          </ModernCancelButton>
          <ModernPrimaryButton
            onClick={handleSubmit}
            disabled={isSaving}
            startIcon={!isSaving ? <Package size={16} /> : undefined}
          >
            {isSaving
              ? t('inventory.productForm.saving', 'Salvando…')
              : isEditing
                ? t('inventory.productForm.save', 'Salvar')
                : t('inventory.productForm.register', 'Cadastrar')}
          </ModernPrimaryButton>
        </ModernDialogActions>
      }
    >
          <ModernSection icon={ImageIcon} title={t('inventory.productForm.productImage', 'Imagem do Produto')}>
            <ImageDropZone
              preview={form.imagePreview}
              existingUrl={form.existingImageUrl}
              onFileSelect={handleFileSelect}
              onRemove={handleImageRemove}
              error={imageError}
            />
          </ModernSection>

          <ModernSection icon={Package} title="Identificação">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TextField
                label={t('inventory.productForm.productName', 'Nome do Produto')}
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                error={!!errors.name}
                helperText={errors.name}
                fullWidth
                required
                size="small"
              />
              <TextField
                label={t('inventory.productForm.sku', 'SKU')}
                value={form.sku}
                onChange={(e) => updateField('sku', e.target.value)}
                fullWidth
                size="small"
                placeholder={t('inventory.productForm.skuPlaceholder', 'Auto-gerado se vazio')}
              />
            </div>

            <TextField
              label={t('inventory.productForm.description', 'Descrição')}
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
              fullWidth
              multiline
              rows={2}
              size="small"
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <TextField
                label={t('inventory.productForm.barcode', 'Código de Barras')}
                value={form.barcode}
                onChange={(e) => updateField('barcode', e.target.value)}
                fullWidth
                size="small"
              />
              <FormControl fullWidth size="small">
                <InputLabel>{t('inventory.productForm.category', 'Categoria')}</InputLabel>
                <Select
                  value={form.category}
                  onChange={(e) => updateField('category', e.target.value)}
                  label={t('inventory.productForm.category', 'Categoria')}
                >
                  {CATEGORIES.map((cat) => (
                    <MenuItem key={cat} value={cat}>{cat}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>{t('inventory.productForm.unit', 'Unidade')}</InputLabel>
                <Select
                  value={form.unit}
                  onChange={(e) => updateField('unit', e.target.value)}
                  label={t('inventory.productForm.unit', 'Unidade')}
                >
                  {UNITS.map((u) => (
                    <MenuItem key={u} value={u}>{u}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </div>
          </ModernSection>

          <ModernSection
            icon={DollarSign}
            title={t('inventory.productForm.prices', 'Preços')}
            meta={<ModernPill tone={margin > 0 ? 'emerald' : margin < 0 ? 'red' : 'slate'}>{margin.toFixed(1)}% margem</ModernPill>}
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <CurrencyInput
                label={t('inventory.productForm.costPrice', 'Preço de Custo')}
                value={form.costPrice}
                onChange={(v) => updateField('costPrice', v)}
                error={errors.costPrice}
                required
              />
              <CurrencyInput
                label={t('inventory.productForm.salePrice', 'Preço de Venda')}
                value={form.salePrice}
                onChange={(v) => updateField('salePrice', v)}
                error={errors.salePrice}
                required
              />
              <div className="flex items-center px-3 rounded-xl bg-slate-50 dark:bg-slate-950/35 border border-slate-200 dark:border-slate-700">
                <div>
                  <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('inventory.productForm.margin', 'Margem')}</p>
                  <p className={cn(
                    'text-lg font-bold',
                    margin > 0 ? 'text-emerald-600' : margin < 0 ? 'text-red-600' : 'text-slate-500',
                  )}>
                    {margin.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          </ModernSection>

          <ModernSection icon={Boxes} title={t('inventory.productForm.stockSection', 'Estoque')}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <TextField
                label={t('inventory.productForm.currentStock', 'Estoque Atual')}
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
                label={t('inventory.productForm.minStock', 'Estoque Mínimo')}
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
                label={t('inventory.productForm.maxStock', 'Estoque Máximo')}
                type="number"
                value={form.maxStock}
                onChange={(e) => updateField('maxStock', e.target.value)}
                fullWidth
                size="small"
                slotProps={{ htmlInput: { min: 0 } }}
              />
            </div>
          </ModernSection>

          <ModernSection
            icon={FileText}
            title={t('inventory.productForm.fiscalSection', 'Fiscal')}
            meta={<ModernPill tone="slate">opcional</ModernPill>}
          >
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('inventory.productForm.fiscalDesc', 'Campos opcionais. Obrigatórios para emissão de NF-e/NFC-e.')}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* NCM com combobox de busca — usuário pode buscar por código,
                    descrição ou categoria. Se NCM não estiver no catálogo,
                    digitar 8 dígitos cria entrada custom. Mesmo componente
                    usado na emissão de NF-e/NFC-e (NcmSelector). Wrapper
                    aplica label/helper estilo MUI pra ficar alinhado com os
                    TextFields ao lado. */}
                <div className="flex flex-col">
                  <label
                    className={cn(
                      'text-xs font-medium mb-1.5 px-0.5',
                      errors.ncm
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-slate-600 dark:text-slate-400',
                    )}
                  >
                    NCM
                  </label>
                  <NcmSelector
                    value={form.ncm}
                    onChange={(code) => updateField('ncm', code)}
                    onClear={() => updateField('ncm', '')}
                    placeholder="Buscar ou digitar 8 dígitos…"
                  />
                  <span
                    className={cn(
                      'text-xs mt-1 px-0.5',
                      errors.ncm
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-slate-500 dark:text-slate-400',
                    )}
                  >
                    {errors.ncm || t('inventory.productForm.ncmHelper', 'Nomenclatura Comum do Mercosul')}
                  </span>
                </div>
                <TextField
                  label="CFOP"
                  value={form.cfop}
                  onChange={(e) => updateField('cfop', e.target.value)}
                  fullWidth
                  size="small"
                  placeholder="5102"
                  helperText={t('inventory.productForm.cfopHelper', 'Cód. Fiscal de Operações')}
                  slotProps={{ htmlInput: { maxLength: 4 } }}
                />
                <TextField
                  label="CEST"
                  value={form.cest}
                  onChange={(e) => updateField('cest', e.target.value)}
                  fullWidth
                  size="small"
                  placeholder="0000000"
                  helperText={t('inventory.productForm.cestHelper', 'Substituição Tributária')}
                  slotProps={{ htmlInput: { maxLength: 7 } }}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                <TextField
                  label="GTIN/EAN"
                  value={form.gtin}
                  onChange={(e) => updateField('gtin', e.target.value)}
                  fullWidth
                  size="small"
                  placeholder="7891234567890"
                  helperText={t('inventory.productForm.gtinHelper', 'Código de barras fiscal')}
                  slotProps={{ htmlInput: { maxLength: 14 } }}
                />
                <TextField
                  label="Origem ICMS"
                  value={form.icmsOrigem}
                  onChange={(e) => updateField('icmsOrigem', e.target.value)}
                  fullWidth
                  size="small"
                  select
                  SelectProps={{ native: true }}
                  helperText={t('inventory.productForm.icmsOrigemHelper', 'Origem da mercadoria')}
                >
                  <option value="0">0 - Nacional</option>
                  <option value="1">1 - Estrangeira (importacao direta)</option>
                  <option value="2">2 - Estrangeira (adq. mercado interno)</option>
                  <option value="3">3 - Nacional (40-70% conteudo import.)</option>
                  <option value="4">4 - Nacional (proc. basicos)</option>
                  <option value="5">5 - Nacional (conteudo import. &lt;= 40%)</option>
                  <option value="6">6 - Estrangeira (import. direta, sem similar)</option>
                  <option value="7">7 - Estrangeira (adq. interno, sem similar)</option>
                </TextField>
              </div>
              {/* Unidade e GTIN tributáveis — auxiliares, só preencher quando
                  diferem dos comerciais (raro mas obrigatório nesses casos). */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <TextField
                  label={t('inventory.productForm.unidadeTrib', 'Unidade tributável')}
                  value={form.unidadeTrib}
                  onChange={(e) => updateField('unidadeTrib', e.target.value)}
                  fullWidth
                  size="small"
                  placeholder="UN"
                  helperText={t('inventory.productForm.unidadeTribHelper', 'Só preencher se diferente da unidade comercial')}
                />
                <TextField
                  label={t('inventory.productForm.gtinTrib', 'GTIN tributável')}
                  value={form.gtinTrib}
                  onChange={(e) => updateField('gtinTrib', e.target.value)}
                  fullWidth
                  size="small"
                  placeholder="7891234567890"
                  helperText={t('inventory.productForm.gtinTribHelper', 'EAN do item tributável (se diferente do GTIN principal)')}
                  slotProps={{ htmlInput: { maxLength: 14 } }}
                />
              </div>
          </ModernSection>

          {/* ======= Entrega / Cardápio ======= */}
          {deliveryEnabled && (
            <ModernSection
              icon={Truck}
              title="Entrega & Cardápio"
              meta={
                <FormControlLabel
                  control={
                    <Switch
                      checked={form.isDeliverable}
                      onChange={(e) => updateField('isDeliverable', e.target.checked)}
                      size="small"
                      sx={{
                        '& .MuiSwitch-switchBase.Mui-checked': { color: '#DC2626' },
                        '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#DC2626' },
                      }}
                    />
                  }
                  label={<span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{form.isDeliverable ? 'No cardápio' : 'Não exibir'}</span>}
                  sx={{ marginRight: 0 }}
                />
              }
            >
              <p className="text-xs text-slate-500 dark:text-slate-400 -mt-1">
                Marque para exibir este produto no cardápio e permitir pedidos de entrega.
              </p>

                <AnimatePresence initial={false}>
                  {form.isDeliverable && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.22 }}
                      className="space-y-3 overflow-hidden"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                            Categoria no cardápio
                          </label>
                          {menuCategories.length > 0 ? (
                            <div className="flex gap-2">
                              <select
                                value={form.menuCategoryId}
                                onChange={(e) => {
                                  const cat = menuCategories.find(c => c.id === e.target.value);
                                  updateField('menuCategoryId', e.target.value);
                                  updateField('menuCategory', cat?.name || '');
                                }}
                                className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                              >
                                <option value="">— Sem categoria —</option>
                                {menuCategories.filter(c => c.isActive).map(cat => (
                                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                                ))}
                              </select>
                              {onOpenCategoriesManager && (
                                <button
                                  type="button"
                                  onClick={onOpenCategoriesManager}
                                  title="Gerenciar categorias"
                                  className="px-2.5 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                >
                                  <Tag className="w-4 h-4 text-gray-500" />
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="flex gap-2 items-start">
                              <input
                                value={form.menuCategory}
                                onChange={(e) => updateField('menuCategory', e.target.value)}
                                placeholder="Pizzas, Bebidas, Sobremesas..."
                                className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                              />
                              {onOpenCategoriesManager && (
                                <button
                                  type="button"
                                  onClick={onOpenCategoriesManager}
                                  className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800 transition-colors whitespace-nowrap"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  Criar
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        <TextField
                          label="Tempo de preparo (min)"
                          type="number"
                          value={form.preparationTime}
                          onChange={(e) => updateField('preparationTime', e.target.value)}
                          inputProps={{ min: 0, max: 240 }}
                          size="small"
                          fullWidth
                        />
                      </div>
                      <TextField
                        label="Descrição para o cardápio"
                        placeholder="Massa fininha, molho de tomate fresco, mozzarella..."
                        value={form.menuDescription}
                        onChange={(e) => updateField('menuDescription', e.target.value)}
                        multiline
                        rows={2}
                        size="small"
                        fullWidth
                      />

                      {/* Dietary tags */}
                      <div>
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                          Informações dietéticas
                          <span className="ml-1.5 text-gray-400 font-normal">(visíveis no cardápio e filtros do agente)</span>
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {DIETARY_OPTIONS.map(opt => {
                            const active = form.dietary.includes(opt.id);
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => {
                                  const next = active
                                    ? form.dietary.filter(d => d !== opt.id)
                                    : [...form.dietary, opt.id];
                                  updateField('dietary', next);
                                }}
                                className={cn(
                                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border',
                                  active
                                    ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/40'
                                    : 'bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600',
                                )}
                              >
                                <span>{opt.emoji}</span>
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Modificadores / Personalização */}
                      <div className="bg-gradient-to-br from-red-50/50 to-orange-50/30 dark:from-red-900/10 dark:to-orange-900/5 rounded-xl p-3 border border-red-100 dark:border-red-900/30">
                        <ModifierGroupsEditor
                          groups={form.modifierGroups}
                          onChange={(groups) => setForm(f => ({ ...f, modifierGroups: groups }))}
                        />
                      </div>

                      {/* Composição (BOM) */}
                      <div className="bg-gray-50 dark:bg-gray-800/40 rounded-xl p-3 border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Composição (opcional)</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                              Use para kits/cestas. Ao vender, o estoque é descontado dos componentes (não do próprio produto).
                            </p>
                          </div>
                        </div>

                        {form.components.length > 0 && (
                          <div className="space-y-1.5 mb-2">
                            {form.components.map((comp, idx) => (
                              <div key={idx} className="flex items-center gap-2 bg-white dark:bg-gray-900 rounded-lg p-2 border border-gray-200 dark:border-gray-700">
                                <span className="flex-1 text-sm text-gray-900 dark:text-gray-100 truncate">
                                  {comp.productName}
                                </span>
                                <input
                                  type="number"
                                  min={1}
                                  value={comp.quantity}
                                  onChange={(e) => {
                                    const next = [...form.components];
                                    next[idx] = { ...next[idx], quantity: Math.max(1, Number(e.target.value) || 1) };
                                    setForm(f => ({ ...f, components: next }));
                                  }}
                                  className="w-16 px-2 py-1 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                                />
                                <span className="text-xs text-gray-500 dark:text-gray-400 min-w-[24px]">un</span>
                                <IconButton
                                  size="small"
                                  onClick={() => {
                                    setForm(f => ({ ...f, components: f.components.filter((_, i) => i !== idx) }));
                                  }}
                                >
                                  <X size={14} />
                                </IconButton>
                              </div>
                            ))}
                          </div>
                        )}

                        <select
                          value=""
                          onChange={(e) => {
                            const id = e.target.value;
                            if (!id) return;
                            const p = allProducts.find(pp => pp.id === id);
                            if (!p) return;
                            if (form.components.some(c => c.productId === id)) return;
                            setForm(f => ({
                              ...f,
                              components: [...f.components, { productId: p.id, productName: p.name, quantity: 1 }],
                            }));
                            e.target.value = '';
                          }}
                          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                        >
                          <option value="">+ Adicionar componente...</option>
                          {allProducts
                            .filter(p => p.id !== product?.id && !p.components?.length)
                            .filter(p => !form.components.some(c => c.productId === p.id))
                            .map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({p.currentStock} em estoque)
                              </option>
                            ))}
                        </select>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
            </ModernSection>
          )}

          {/* Active Toggle — toggle card padronizado */}
          <button
            type="button"
            onClick={() => updateField('isActive', !form.isActive)}
            className={cn(
              'w-full flex items-center justify-between gap-3 p-3 rounded-2xl border-2 transition-all',
              form.isActive
                ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/40'
                : 'border-slate-300 dark:border-slate-700 bg-white/60 dark:bg-slate-950/30'
            )}
          >
            <div className="flex items-center gap-3">
              <div className={cn(
                'w-9 h-9 rounded-xl flex items-center justify-center transition-all',
                form.isActive
                  ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
              )}>
                <Send size={16} />
              </div>
              <div className="text-left">
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {t('inventory.productForm.activeProduct', 'Produto Ativo')}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {form.isActive
                    ? 'Disponível para venda e exibição'
                    : 'Inativo — não aparece em listagens nem PDV'}
                </p>
              </div>
            </div>
            <div className={cn(
              'w-11 h-6 rounded-full p-0.5 transition-colors',
              form.isActive ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
            )}>
              <div className={cn(
                'w-5 h-5 rounded-full bg-white shadow transition-transform',
                form.isActive ? 'translate-x-5' : 'translate-x-0'
              )} />
            </div>
          </button>
    </ModernDialog>
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
  const { t } = useTranslation();
  const typeConfig: Record<string, { label: string; bg: string; text: string }> = {
    entrada: { label: t('inventory.movement.entry', 'Entrada'), bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400' },
    saida: { label: t('inventory.movement.exit', 'Saída'), bg: 'bg-red-50 dark:bg-red-500/10', text: 'text-red-700 dark:text-red-400' },
    ajuste: { label: t('inventory.movement.adjustment', 'Ajuste'), bg: 'bg-blue-50 dark:bg-blue-500/10', text: 'text-blue-700 dark:text-blue-400' },
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
        <p className="text-sm font-medium text-muted-foreground">{t('inventory.history.empty', 'Nenhuma movimentação registrada')}</p>
        <p className="text-xs text-muted-foreground mt-1">{t('inventory.history.emptyHint', 'As movimentações de estoque aparecerão aqui')}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border/60">
            <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('inventory.history.colDate', 'Data')}</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('inventory.history.colProduct', 'Produto')}</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('inventory.history.colType', 'Tipo')}</th>
            <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('inventory.history.colQty', 'Qtd')}</th>
            <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">{t('inventory.history.colPrevious', 'Anterior')}</th>
            <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">{t('inventory.history.colNew', 'Novo')}</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">{t('inventory.history.colReason', 'Motivo')}</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">{t('inventory.history.colOperator', 'Operador')}</th>
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
  const { t } = useTranslation();
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
        {t('inventory.emptyState.title', 'Nenhum produto cadastrado')}
      </h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">
        {t('inventory.emptyState.description', 'Comece adicionando seus produtos e materiais para controlar o estoque da sua empresa.')}
      </p>
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-red-600 to-red-500 text-white text-sm font-medium hover:from-red-700 hover:to-red-600 transition-all shadow-sm"
      >
        <Plus className="w-4 h-4" />
        {t('inventory.emptyState.cta', 'Cadastrar Primeiro Produto')}
      </button>
    </motion.div>
  );
}

// ==============================================
// MAIN COMPONENT
// ==============================================

export default function InventoryModule() {
  const { t } = useTranslation();
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
  // stockMovements é coleção de alto throughput — pagina por janela crescente
  // em vez de baixar tudo (auditoria P1.5). Índice [businessId, createdAt desc] já existe.
  const [movementLimit, setMovementLimit] = useState(150);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [categoriesManagerOpen, setCategoriesManagerOpen] = useState(false);
  const [showSpreadsheetView, setShowSpreadsheetView] = useState(false);
  const [menuCategories, setMenuCategories] = useState<MenuCategory[]>([]);

  const deliveryEnabled = business?.settings?.useCase === 'pedidos';

  // Subscribe to menu categories (pedidos mode)
  React.useEffect(() => {
    if (!business?.id || !deliveryEnabled) {
      setMenuCategories([]);
      return;
    }
    const q = query(
      collection(db, 'menuCategories'),
      where('businessId', '==', business.id),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs
        .map(d => ({ ...d.data(), id: d.id }) as MenuCategory)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      setMenuCategories(list);
    });
    return () => unsub();
  }, [business?.id, deliveryEnabled]);

  // ==========================================
  // FIRESTORE QUERIES
  // ==========================================

  // Real-time listener (refactor sync multi-user):
  //
  // ANTES: useQuery + getDocs com staleTime 5min. Operador A ajustava estoque
  // ou cadastrava produto, operador B (PDV/Cardápio em outra sessão) só via
  // mudança após refetch (window focus ou mutation própria).
  //
  // AGORA: onSnapshot. Mudanças propagam em tempo real pra todos os clients
  // — crítico no PDV multiuser, onde estoque desatualizado leva a venda
  // de produto sem saldo.
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  React.useEffect(() => {
    if (!business?.id) { setProductsLoading(false); return; }
    setProductsLoading(true);
    // Single-field — sort client-side (evita composite index
    // products/businessId+name).
    const q = query(
      collection(db, 'products'),
      where('businessId', '==', business.id),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ ...d.data(), id: d.id } as Product))
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setProducts(list);
        setProductsLoading(false);
      },
      (err) => {
        console.error('[Inventory] products snapshot error:', err);
        setProductsLoading(false);
      },
    );
    return () => unsub();
  }, [business?.id]);

  const { data: movements = [], isLoading: movementsLoading } = useQuery({
    queryKey: ['stockMovements', business?.id, movementLimit],
    queryFn: async () => {
      if (!business?.id) return [];
      const q = query(
        collection(db, 'stockMovements'),
        where('businessId', '==', business.id),
        orderBy('createdAt', 'desc'),
        limit(movementLimit),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as StockMovement));
    },
    enabled: !!business?.id,
    staleTime: 2 * 60 * 1000,
  });

  const hasMoreMovements = movements.length >= movementLimit;

  // ==========================================
  // IMAGE UPLOAD
  // ==========================================

  async function uploadProductImage(file: File, productId: string): Promise<string> {
    if (!business?.id) throw new Error('Business not found');
    const ext = file.name.split('.').pop() || 'jpg';
    const fileName = `${productId}_${Date.now()}.${ext}`;
    const storageRef = ref(storage, `products/${business.id}/${productId}/${fileName}`);
    await uploadBytes(storageRef, file, { contentType: file.type || 'image/jpeg' });
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
        cest: data.cest.trim() || undefined,
        icmsOrigem: data.icmsOrigem || undefined,
        gtin: data.gtin.trim() || undefined,
        unidadeTrib: data.unidadeTrib.trim() || undefined,
        gtinTrib: data.gtinTrib.trim() || undefined,
        isActive: data.isActive,
        imageUrl: imageUrl || null,
        isDeliverable: data.isDeliverable,
        menuCategory: data.isDeliverable ? (data.menuCategory.trim() || null) : null,
        menuCategoryId: data.isDeliverable && data.menuCategoryId ? data.menuCategoryId : null,
        menuDescription: data.isDeliverable ? (data.menuDescription.trim() || null) : null,
        preparationTime: data.isDeliverable && data.preparationTime ? Number(data.preparationTime) : null,
        components: data.isDeliverable && data.components.length > 0 ? data.components : null,
        dietary: data.isDeliverable && data.dietary.length > 0 ? data.dietary : null,
        modifierGroups: data.isDeliverable && data.modifierGroups.length > 0 ? data.modifierGroups : null,
        hasModifiers: data.isDeliverable && data.modifierGroups.length > 0,
        updatedAt: new Date().toISOString(),
      };

      // Remove undefined values
      const cleanedData = Object.fromEntries(
        Object.entries(updateData).filter(([, v]) => v !== undefined)
      );

      await updateDoc(doc(db, 'products', editingProduct.id), cleanedData);
      toast.success(t('inventory.toast.productUpdated', 'Produto atualizado com sucesso!'));
    } else {
      // CREATE
      const productData: Record<string, unknown> = {
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
        cest: data.cest.trim() || '',
        icmsOrigem: data.icmsOrigem || '0',
        gtin: data.gtin.trim() || '',
        unidadeTrib: data.unidadeTrib.trim() || '',
        gtinTrib: data.gtinTrib.trim() || '',
        isActive: data.isActive,
        imageUrl: '',
        isDeliverable: data.isDeliverable,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (data.isDeliverable) {
        if (data.menuCategory.trim()) productData.menuCategory = data.menuCategory.trim();
        if (data.menuCategoryId) productData.menuCategoryId = data.menuCategoryId;
        if (data.menuDescription.trim()) productData.menuDescription = data.menuDescription.trim();
        if (data.preparationTime) productData.preparationTime = Number(data.preparationTime);
        if (data.components.length > 0) productData.components = data.components;
        if (data.dietary.length > 0) productData.dietary = data.dietary;
        if (data.modifierGroups.length > 0) {
          productData.modifierGroups = data.modifierGroups;
          productData.hasModifiers = true;
        }
      }

      const docRef = await addDoc(collection(db, 'products'), productData);

      // Upload image if provided
      if (data.imageFile) {
        const imageUrl = await uploadProductImage(data.imageFile, docRef.id);
        await updateDoc(doc(db, 'products', docRef.id), { imageUrl });
      }
      toast.success(t('inventory.toast.productCreated', 'Produto cadastrado com sucesso!'));
    }
    // products via onSnapshot — invalidação não é mais necessária.
  }, [business?.id, user, editingProduct]);

  const handleSaveMovement = useCallback(async (data: MovementFormData) => {
    if (!business?.id || !user) return;

    const product = products.find((p) => p.id === data.productId);
    if (!product) return;

    const qty = parseInt(data.quantity) || 0;
    if (qty < 0) return;

    // Roteia TODA movimentação manual por stock.ts: increment atômico + batch
    // único (produto + stockMovement no mesmo writeBatch). Nada de write direto
    // não-atômico aqui. Simetria com PDV/Pedidos.
    const productIndex = new Map(products.map((p) => [p.id, p]));
    const ctxBase = {
      businessId: business.id,
      operatorId: user.uid,
      operatorName: user.name,
      reason: data.reason || data.type,
      productIndex,
    };

    // saída/ajuste-abaixo passam por deductStock, que expande BOM
    // (expandComponents) e debita os insumos de produtos compostos — mesma
    // regra da venda. entrada credita o SKU pai (igual à nota de compra);
    // ajuste-acima usa restoreStock (inverso simétrico, também expande BOM).
    let adjustments: StockAdjustment[] = [];
    if (data.type === 'entrada') {
      adjustments = await addStock(db, [{ productId: product.id, quantity: qty }], ctxBase);
    } else if (data.type === 'saida') {
      adjustments = await deductStock(db, [{ productId: product.id, quantity: qty }], ctxBase);
    } else {
      // ajuste: seta o estoque do PRÓPRIO SKU para o valor exato (qty). expandBom:false
      // → em produto COMPOSTO mexe no saldo daquele doc, NÃO nos insumos (o ajuste
      // manual visa o balanço daquele produto). Atômico via os mesmos helpers.
      const ajusteCtx = { ...ctxBase, expandBom: false };
      const delta = qty - (product.currentStock || 0);
      if (delta > 0) {
        adjustments = await restoreStock(db, [{ productId: product.id, quantity: delta }], ajusteCtx);
      } else if (delta < 0) {
        adjustments = await deductStock(db, [{ productId: product.id, quantity: -delta }], ajusteCtx);
      }
    }

    toast.success(t('inventory.toast.movementCreated', 'Movimentação registrada com sucesso!'));
    // products via onSnapshot. stockMovements continua em useQuery local.
    queryClient.invalidateQueries({ queryKey: ['stockMovements', business.id] });

    // Estoque baixo: reusa os alerts que o deductStock já calcula em memória
    // (por insumo, em produto composto). Só o deductStock popula `alert` —
    // entrada/restore sobem estoque e não geram alerta.
    const stockAlerts = adjustments.flatMap((a) => (a.alert ? [a.alert] : []));
    if (stockAlerts.length > 0) {
      stockAlerts.forEach((alert) => {
        const icon = alert.severity === 'zeroed' ? '🚨' : '⚠️';
        const msg = alert.severity === 'zeroed'
          ? `${icon} ${alert.productName} esgotou`
          : `${icon} ${alert.productName} no estoque mínimo (${alert.newStock}/${alert.minStock})`;
        toast.warning(msg, { autoClose: 6000 });
      });
      void notifyLowStock(db, {
        businessId: business.id,
        alerts: stockAlerts,
        actorId: user.uid,
        actorName: user.name,
        sourceLabel: `Ajuste manual: ${data.reason || data.type}`,
      });
    }
  }, [business?.id, user, products, queryClient, t]);

  const handleDeleteProduct = useCallback(async () => {
    if (!business?.id || !deletingProduct) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'products', deletingProduct.id));
      toast.success(t('inventory.toast.productDeleted', 'Produto excluído com sucesso'));
      // products via onSnapshot — listener vai atualizar a lista automaticamente.
      setDeleteDialogOpen(false);
      setDeletingProduct(null);
    } catch (err) {
      console.error('Error deleting product:', err);
      toast.error(t('inventory.toast.deleteProductError', 'Erro ao excluir produto'));
    } finally {
      setIsDeleting(false);
    }
  }, [business?.id, deletingProduct]);

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
              {t('inventory.header.title', 'Estoque')}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t('inventory.header.subtitle', 'Gerencie seus produtos e materiais')}
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
          allProducts={products}
          deliveryEnabled={deliveryEnabled}
          menuCategories={menuCategories}
          onOpenCategoriesManager={() => setCategoriesManagerOpen(true)}
        />
        <MenuCategoriesManager open={categoriesManagerOpen} onClose={() => setCategoriesManagerOpen(false)} />
      </div>
    );
  }

  // ==========================================
  // MAIN RENDER
  // ==========================================

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      {/* ============ HEADER ============ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-display">
            {t('inventory.header.title', 'Estoque')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('inventory.header.productCount', '{{count}} produtos cadastrados', { count: stats.totalProducts })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {deliveryEnabled && (
            <button
              onClick={() => setCategoriesManagerOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm font-medium hover:border-red-300 dark:hover:border-red-700 hover:bg-red-50/50 dark:hover:bg-red-900/10 transition-all"
            >
              <Tag className="w-4 h-4 text-red-500" />
              Categorias
              {menuCategories.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-md bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 text-[10px] font-bold">
                  {menuCategories.length}
                </span>
              )}
            </button>
          )}
          <button
            onClick={() => setShowSpreadsheetView(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm font-medium hover:border-red-300 dark:hover:border-red-700 hover:bg-red-50/50 dark:hover:bg-red-900/10 transition-all"
            title="Abrir lista de produtos como planilha"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
            Planilha
          </button>
          <button
            onClick={handleNewProduct}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-red-600 to-red-500 text-white text-sm font-medium hover:from-red-700 hover:to-red-600 transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" />
            {t('inventory.header.newProduct', 'Novo Produto')}
          </button>
        </div>
      </div>

      {/* ============ FILTERS BAR ============ */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={t('inventory.filter.searchPlaceholder', 'Buscar por nome, SKU ou código...')}
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
            <option value="all">{t('inventory.filter.allCategories', 'Todas Categorias')}</option>
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
            <option value="all">{t('inventory.filter.allStock', 'Todo Estoque')}</option>
            <option value="em_estoque">{t('inventory.filter.inStock', 'Em Estoque')}</option>
            <option value="estoque_baixo">{t('inventory.filter.lowStock', 'Estoque Baixo')}</option>
            <option value="sem_estoque">{t('inventory.filter.outOfStock', 'Sem Estoque')}</option>
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
            <option value="all">{t('inventory.filter.all', 'Todos')}</option>
            <option value="ativo">{t('inventory.filter.active', 'Ativos')}</option>
            <option value="inativo">{t('inventory.filter.inactive', 'Inativos')}</option>
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
            title={t('inventory.filter.gridView', 'Visualização em grade')}
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
            title={t('inventory.filter.listView', 'Visualização em lista')}
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
          label={t('inventory.stats.totalProducts', 'Total de Produtos')}
          value={String(stats.totalProducts)}
          subtitle={t('inventory.stats.showing', '{{count}} exibidos', { count: filteredProducts.length })}
        />
        <StatCard
          icon={<DollarSign className="w-5 h-5 text-emerald-600" />}
          iconBg="bg-emerald-50 dark:bg-emerald-500/10"
          label={t('inventory.stats.stockValue', 'Valor em Estoque')}
          value={formatCurrency(stats.totalValue)}
          subtitle={t('inventory.stats.stockValueSubtitle', 'Custo total em estoque')}
        />
        <StatCard
          icon={<TrendingDown className="w-5 h-5 text-amber-600" />}
          iconBg="bg-amber-50 dark:bg-amber-500/10"
          label={t('inventory.stats.belowMinimum', 'Itens Abaixo do Mínimo')}
          value={String(stats.lowStockCount)}
          subtitle={stats.lowStockCount > 0 ? t('inventory.stats.needsReplenishment', 'Necessita reposição') : t('inventory.stats.allGood', 'Tudo em ordem')}
        />
        <StatCard
          icon={<Activity className="w-5 h-5 text-violet-600" />}
          iconBg="bg-violet-50 dark:bg-violet-500/10"
          label={t('inventory.stats.todayMovements', 'Movimentações Hoje')}
          value={String(stats.todayMovements)}
          subtitle={t('inventory.stats.entriesAndExits', 'Entradas e saídas')}
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
        {hasMoreMovements && !movementsLoading && (
          <div className="flex justify-center py-4 border-t border-border/40">
            <button
              onClick={() => setMovementLimit((n) => n + 150)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors border border-border/60"
            >
              {t('inventory.history.loadMore', 'Ver mais movimentações')}
            </button>
          </div>
        )}
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
        allProducts={products}
        deliveryEnabled={deliveryEnabled}
        menuCategories={menuCategories}
        onOpenCategoriesManager={() => setCategoriesManagerOpen(true)}
      />

      <MenuCategoriesManager open={categoriesManagerOpen} onClose={() => setCategoriesManagerOpen(false)} />

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

      {/* Spreadsheet view (overlay full-screen) */}
      {showSpreadsheetView && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 bg-black/40 p-4 flex items-stretch justify-center">
          <div className="w-full max-w-[1600px]">
            <SpreadsheetView
              collection="products"
              onClose={() => setShowSpreadsheetView(false)}
            />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
