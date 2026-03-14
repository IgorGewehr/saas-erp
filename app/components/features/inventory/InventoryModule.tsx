'use client';

import React, { useState, useMemo, useCallback } from 'react';
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
  Wrench,
  Beaker,
  Cpu,
  ShoppingCart,
  RotateCcw,
  Trash2,
  ClipboardList,
  Eye,
} from 'lucide-react';
import type { Product, StockMovement } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDateTime } from '@/lib/utils/format';

// ==============================================
// TYPES
// ==============================================

type ViewMode = 'grid' | 'list';
type MovementType = 'entrada' | 'saida' | 'ajuste';
type SortField = 'name' | 'sku' | 'category' | 'currentStock' | 'costPrice' | 'salePrice';
type SortDirection = 'asc' | 'desc';

interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

type ProductCategory = 'Material' | 'Produto' | 'Insumo' | 'Equipamento';
type ProductUnit = 'UN' | 'KG' | 'L' | 'M' | 'CX' | 'PCT';

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
const UNITS: ProductUnit[] = ['UN', 'KG', 'L', 'M', 'CX', 'PCT'];

const MOVEMENT_REASONS: Record<MovementType, string[]> = {
  entrada: ['Compra', 'Devolucao de Cliente', 'Transferencia', 'Ajuste Manual', 'Producao'],
  saida: ['Venda', 'Perda', 'Devolucao a Fornecedor', 'Transferencia', 'Consumo Interno'],
  ajuste: ['Inventario', 'Correcao', 'Ajuste Manual', 'Avaria'],
};

const CATEGORY_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  Material: { bg: 'bg-blue-50', text: 'text-blue-700', icon: 'text-blue-500' },
  Produto: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'text-emerald-500' },
  Insumo: { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'text-amber-500' },
  Equipamento: { bg: 'bg-violet-50', text: 'text-violet-700', icon: 'text-violet-500' },
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
};

const EMPTY_MOVEMENT_FORM: MovementFormData = {
  type: 'entrada',
  productId: '',
  quantity: '',
  reason: '',
  notes: '',
};

// ==============================================
// MOCK DATA
// ==============================================

const mockProducts: Product[] = [
  { id: '1', businessId: 'b1', name: 'Shampoo Profissional 1L', description: 'Shampoo para uso profissional', sku: 'SHP-001', barcode: '7891234560010', category: 'Insumo', unit: 'UN', costPrice: 28.90, salePrice: 45.00, currentStock: 3, minStock: 5, maxStock: 50, ncm: '33051000', cfop: '5102', isActive: true, createdAt: '2025-12-01T10:00:00Z', updatedAt: '2026-03-10T14:30:00Z' },
  { id: '2', businessId: 'b1', name: 'Condicionador Profissional 1L', description: 'Condicionador para uso profissional', sku: 'CND-001', barcode: '7891234560027', category: 'Insumo', unit: 'UN', costPrice: 32.50, salePrice: 52.00, currentStock: 8, minStock: 5, maxStock: 50, isActive: true, createdAt: '2025-12-01T10:00:00Z', updatedAt: '2026-03-09T11:00:00Z' },
  { id: '3', businessId: 'b1', name: 'Tintura Loiro 7.0', description: 'Tintura capilar loiro natural', sku: 'TNT-070', barcode: '7891234560034', category: 'Insumo', unit: 'UN', costPrice: 18.00, salePrice: 35.00, currentStock: 2, minStock: 10, maxStock: 100, isActive: true, createdAt: '2025-12-05T09:00:00Z', updatedAt: '2026-03-12T08:00:00Z' },
  { id: '4', businessId: 'b1', name: 'Tintura Castanho 4.0', description: 'Tintura capilar castanho natural', sku: 'TNT-040', barcode: '7891234560041', category: 'Insumo', unit: 'UN', costPrice: 18.00, salePrice: 35.00, currentStock: 15, minStock: 10, maxStock: 100, isActive: true, createdAt: '2025-12-05T09:00:00Z', updatedAt: '2026-03-11T10:00:00Z' },
  { id: '5', businessId: 'b1', name: 'Oxidante 20 Vol 1L', description: 'Oxidante cremoso 20 volumes', sku: 'OXD-020', barcode: '7891234560058', category: 'Insumo', unit: 'UN', costPrice: 12.00, salePrice: 22.00, currentStock: 20, minStock: 8, maxStock: 60, isActive: true, createdAt: '2025-12-10T14:00:00Z', updatedAt: '2026-03-10T16:00:00Z' },
  { id: '6', businessId: 'b1', name: 'Mascara Hidratacao 500g', description: 'Mascara de hidratacao profunda', sku: 'MSK-001', barcode: '7891234560065', category: 'Produto', unit: 'UN', costPrice: 42.00, salePrice: 79.90, currentStock: 12, minStock: 5, maxStock: 30, isActive: true, createdAt: '2025-12-15T11:00:00Z', updatedAt: '2026-03-08T09:00:00Z' },
  { id: '7', businessId: 'b1', name: 'Oleo Reparador 60ml', description: 'Oleo finalizador reparador de pontas', sku: 'OLR-001', barcode: '7891234560072', category: 'Produto', unit: 'UN', costPrice: 25.00, salePrice: 49.90, currentStock: 7, minStock: 5, maxStock: 25, isActive: true, createdAt: '2025-12-20T13:00:00Z', updatedAt: '2026-03-07T15:00:00Z' },
  { id: '8', businessId: 'b1', name: 'Pomada Modeladora 150g', description: 'Pomada para modelagem capilar', sku: 'PMD-001', barcode: '7891234560089', category: 'Produto', unit: 'UN', costPrice: 15.00, salePrice: 32.00, currentStock: 22, minStock: 8, maxStock: 40, isActive: true, createdAt: '2026-01-05T10:00:00Z', updatedAt: '2026-03-06T12:00:00Z' },
  { id: '9', businessId: 'b1', name: 'Gel Fixador Forte 300g', description: 'Gel para fixacao forte dos fios', sku: 'GEL-001', barcode: '7891234560096', category: 'Produto', unit: 'UN', costPrice: 10.00, salePrice: 22.00, currentStock: 18, minStock: 10, maxStock: 50, isActive: true, createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-03-05T14:00:00Z' },
  { id: '10', businessId: 'b1', name: 'Luvas Descartaveis M CX100', description: 'Caixa com 100 luvas descartaveis tamanho M', sku: 'LUV-M01', barcode: '7891234560102', category: 'Material', unit: 'CX', costPrice: 28.00, salePrice: 28.00, currentStock: 4, minStock: 3, maxStock: 20, isActive: true, createdAt: '2026-01-15T09:00:00Z', updatedAt: '2026-03-12T10:00:00Z' },
  { id: '11', businessId: 'b1', name: 'Papel Aluminio 30cm x 100m', description: 'Rolo de papel aluminio para mechas', sku: 'PAL-001', barcode: '7891234560119', category: 'Material', unit: 'UN', costPrice: 22.00, salePrice: 22.00, currentStock: 6, minStock: 3, maxStock: 15, isActive: true, createdAt: '2026-01-20T11:00:00Z', updatedAt: '2026-03-11T08:00:00Z' },
  { id: '12', businessId: 'b1', name: 'Toalha Descartavel PCT50', description: 'Pacote com 50 toalhas descartaveis', sku: 'TWL-001', barcode: '7891234560126', category: 'Material', unit: 'PCT', costPrice: 18.00, salePrice: 18.00, currentStock: 1, minStock: 5, maxStock: 30, isActive: true, createdAt: '2026-02-01T10:00:00Z', updatedAt: '2026-03-13T07:00:00Z' },
  { id: '13', businessId: 'b1', name: 'Secador Profissional 2100W', description: 'Secador de cabelo profissional potencia 2100W', sku: 'SEC-001', barcode: '7891234560133', category: 'Equipamento', unit: 'UN', costPrice: 289.00, salePrice: 450.00, currentStock: 3, minStock: 1, maxStock: 5, isActive: true, createdAt: '2026-02-05T14:00:00Z', updatedAt: '2026-03-01T10:00:00Z' },
  { id: '14', businessId: 'b1', name: 'Prancha Alisadora Titanio', description: 'Prancha alisadora com placas de titanio', sku: 'PRA-001', barcode: '7891234560140', category: 'Equipamento', unit: 'UN', costPrice: 195.00, salePrice: 320.00, currentStock: 2, minStock: 1, maxStock: 5, isActive: true, createdAt: '2026-02-10T09:00:00Z', updatedAt: '2026-03-02T11:00:00Z' },
  { id: '15', businessId: 'b1', name: 'Maquina de Corte Pro', description: 'Maquina de corte profissional sem fio', sku: 'MAQ-001', barcode: '7891234560157', category: 'Equipamento', unit: 'UN', costPrice: 350.00, salePrice: 550.00, currentStock: 2, minStock: 1, maxStock: 4, isActive: true, createdAt: '2026-02-15T10:00:00Z', updatedAt: '2026-03-03T13:00:00Z' },
  { id: '16', businessId: 'b1', name: 'Po Descolorante 500g', description: 'Po descolorante profissional', sku: 'DSC-001', barcode: '7891234560164', category: 'Insumo', unit: 'UN', costPrice: 35.00, salePrice: 65.00, currentStock: 9, minStock: 5, maxStock: 25, isActive: true, createdAt: '2026-02-20T08:00:00Z', updatedAt: '2026-03-10T09:00:00Z' },
  { id: '17', businessId: 'b1', name: 'Creme Alisante 300g', description: 'Creme para alisamento capilar', sku: 'CRA-001', barcode: '7891234560171', category: 'Produto', unit: 'UN', costPrice: 38.00, salePrice: 72.00, currentStock: 0, minStock: 3, maxStock: 15, isActive: false, createdAt: '2026-03-01T10:00:00Z', updatedAt: '2026-03-12T16:00:00Z' },
  { id: '18', businessId: 'b1', name: 'Spray Termoprotetor 200ml', description: 'Protetor termico para cabelos', sku: 'SPT-001', barcode: '7891234560188', category: 'Produto', unit: 'UN', costPrice: 20.00, salePrice: 39.90, currentStock: 14, minStock: 5, maxStock: 30, isActive: true, createdAt: '2026-03-05T11:00:00Z', updatedAt: '2026-03-10T15:00:00Z' },
];

const mockMovements: StockMovement[] = [
  { id: 'm1', businessId: 'b1', productId: '1', productName: 'Shampoo Profissional 1L', type: 'saida', quantity: 2, previousStock: 5, newStock: 3, reason: 'Venda', operatorId: 'u1', operatorName: 'Igor Garcia', createdAt: '2026-03-13T09:15:00Z' },
  { id: 'm2', businessId: 'b1', productId: '3', productName: 'Tintura Loiro 7.0', type: 'saida', quantity: 3, previousStock: 5, newStock: 2, reason: 'Consumo Interno', operatorId: 'u1', operatorName: 'Igor Garcia', createdAt: '2026-03-13T08:40:00Z' },
  { id: 'm3', businessId: 'b1', productId: '12', productName: 'Toalha Descartavel PCT50', type: 'saida', quantity: 4, previousStock: 5, newStock: 1, reason: 'Consumo Interno', operatorId: 'u2', operatorName: 'Ana Souza', createdAt: '2026-03-13T08:00:00Z' },
  { id: 'm4', businessId: 'b1', productId: '5', productName: 'Oxidante 20 Vol 1L', type: 'entrada', quantity: 12, previousStock: 8, newStock: 20, reason: 'Compra', operatorId: 'u1', operatorName: 'Igor Garcia', createdAt: '2026-03-12T16:30:00Z' },
  { id: 'm5', businessId: 'b1', productId: '8', productName: 'Pomada Modeladora 150g', type: 'entrada', quantity: 10, previousStock: 12, newStock: 22, reason: 'Compra', operatorId: 'u1', operatorName: 'Igor Garcia', createdAt: '2026-03-12T14:20:00Z' },
  { id: 'm6', businessId: 'b1', productId: '17', productName: 'Creme Alisante 300g', type: 'ajuste', quantity: 0, previousStock: 3, newStock: 0, reason: 'Avaria', operatorId: 'u1', operatorName: 'Igor Garcia', createdAt: '2026-03-12T11:00:00Z' },
  { id: 'm7', businessId: 'b1', productId: '6', productName: 'Mascara Hidratacao 500g', type: 'saida', quantity: 1, previousStock: 13, newStock: 12, reason: 'Venda', operatorId: 'u2', operatorName: 'Ana Souza', createdAt: '2026-03-12T10:45:00Z' },
  { id: 'm8', businessId: 'b1', productId: '9', productName: 'Gel Fixador Forte 300g', type: 'entrada', quantity: 8, previousStock: 10, newStock: 18, reason: 'Compra', operatorId: 'u1', operatorName: 'Igor Garcia', createdAt: '2026-03-11T15:00:00Z' },
  { id: 'm9', businessId: 'b1', productId: '4', productName: 'Tintura Castanho 4.0', type: 'entrada', quantity: 5, previousStock: 10, newStock: 15, reason: 'Compra', operatorId: 'u1', operatorName: 'Igor Garcia', createdAt: '2026-03-11T14:00:00Z' },
  { id: 'm10', businessId: 'b1', productId: '10', productName: 'Luvas Descartaveis M CX100', type: 'saida', quantity: 1, previousStock: 5, newStock: 4, reason: 'Consumo Interno', operatorId: 'u2', operatorName: 'Ana Souza', createdAt: '2026-03-11T09:30:00Z' },
  { id: 'm11', businessId: 'b1', productId: '7', productName: 'Oleo Reparador 60ml', type: 'saida', quantity: 2, previousStock: 9, newStock: 7, reason: 'Venda', operatorId: 'u2', operatorName: 'Ana Souza', createdAt: '2026-03-10T16:15:00Z' },
  { id: 'm12', businessId: 'b1', productId: '16', productName: 'Po Descolorante 500g', type: 'entrada', quantity: 4, previousStock: 5, newStock: 9, reason: 'Compra', operatorId: 'u1', operatorName: 'Igor Garcia', createdAt: '2026-03-10T11:00:00Z' },
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
  if (current <= 0) return 'text-red-600';
  if (current <= min) return 'text-amber-600';
  return 'text-emerald-600';
}

function isLowStock(product: Product): boolean {
  return product.currentStock <= product.minStock && product.isActive;
}

function getMargin(cost: number, sale: number): number {
  if (sale === 0) return 0;
  return ((sale - cost) / sale) * 100;
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
        'group relative overflow-hidden rounded-xl border border-border/60',
        'bg-white/70 backdrop-blur-sm p-6',
        'hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-default',
      )}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
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
  onMovement: (product: Product, type: MovementType) => void;
}

function ProductCard({ product, onEdit, onMovement }: ProductCardProps) {
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
        'group relative rounded-xl border bg-white/70 backdrop-blur-sm overflow-hidden',
        'hover:shadow-md hover:-translate-y-0.5 transition-all duration-200',
        low ? 'border-amber-200' : 'border-border/60',
        !product.isActive && 'opacity-60',
      )}
    >
      {/* Low stock warning badge */}
      {low && (
        <div className="absolute top-3 right-3 z-10">
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 border border-amber-200">
            <AlertTriangle className="w-3 h-3 text-amber-600" />
            <span className="text-[10px] font-semibold text-amber-700">Estoque Baixo</span>
          </div>
        </div>
      )}

      {/* Product Image Placeholder */}
      <div className={cn('flex items-center justify-center h-32', catColor.bg)}>
        <div className={catColor.icon}>{catIcon}</div>
      </div>

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
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
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
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-500">
              Inativo
            </span>
          )}
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-1.5 pt-2 border-t border-border/40">
          <button
            onClick={() => onMovement(product, 'entrada')}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Entrada
          </button>
          <button
            onClick={() => onMovement(product, 'saida')}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 transition-colors"
          >
            <Minus className="w-3.5 h-3.5" />
            Saida
          </button>
          <button
            onClick={() => onEdit(product)}
            className="flex items-center justify-center p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" />
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
  sortConfig: SortConfig;
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
  onMovement: (product: Product, type: MovementType) => void;
}

function ProductRow({ product, onEdit, onMovement }: ProductRowProps) {
  const catColor = CATEGORY_COLORS[product.category] || CATEGORY_COLORS.Produto;
  const low = isLowStock(product);
  const stockPct = getStockPercentage(product.currentStock, product.maxStock);
  const stockBarColor = getStockColor(product.currentStock, product.maxStock);

  return (
    <tr className={cn(
      'border-b border-border/40 hover:bg-muted/30 transition-colors',
      low && 'bg-amber-50/40',
    )}>
      {/* Produto */}
      <td className="py-3 px-4">
        <div className="flex items-center gap-3">
          <div className={cn('flex items-center justify-center w-9 h-9 rounded-lg shrink-0', catColor.bg, catColor.icon)}>
            {React.cloneElement((CATEGORY_ICONS[product.category] || CATEGORY_ICONS.Produto) as React.ReactElement<any>, { className: 'w-4 h-4' })}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{product.name}</p>
            {low && (
              <div className="flex items-center gap-1 mt-0.5">
                <AlertTriangle className="w-3 h-3 text-amber-500" />
                <span className="text-[10px] font-medium text-amber-600">Abaixo do minimo</span>
              </div>
            )}
          </div>
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
          <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full', stockBarColor)} style={{ width: `${stockPct}%` }} />
          </div>
        </div>
      </td>
      {/* Min/Max */}
      <td className="py-3 px-4">
        <span className="text-sm text-muted-foreground">{product.minStock} / {product.maxStock ?? '--'}</span>
      </td>
      {/* Preco Custo */}
      <td className="py-3 px-4">
        <span className="text-sm text-foreground">{formatCurrency(product.costPrice)}</span>
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
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-gray-100 text-gray-500',
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
            className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-50 transition-colors"
            title="Entrada"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={() => onMovement(product, 'saida')}
            className="p-1.5 rounded-md text-red-600 hover:bg-red-50 transition-colors"
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
        </div>
      </td>
    </tr>
  );
}

// ==============================================
// STOCK MOVEMENT DIALOG
// ==============================================

interface StockMovementDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: MovementFormData) => void;
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
        : qty // ajuste sets to the quantity value
    : 0;

  async function handleSubmit() {
    if (!form.productId || !form.quantity || !form.reason) return;
    setIsSaving(true);
    // Simulate API call
    await new Promise((r) => setTimeout(r, 500));
    onSave(form);
    setIsSaving(false);
    onClose();
  }

  const typeStyles: Record<MovementType, { bg: string; text: string; activeBg: string }> = {
    entrada: { bg: 'bg-emerald-50', text: 'text-emerald-700', activeBg: 'bg-emerald-100 border-emerald-300' },
    saida: { bg: 'bg-red-50', text: 'text-red-700', activeBg: 'bg-red-100 border-red-300' },
    ajuste: { bg: 'bg-blue-50', text: 'text-blue-700', activeBg: 'bg-blue-100 border-blue-300' },
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
            <p className="text-sm font-semibold text-slate-700 mb-2">Tipo de Movimentacao</p>
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
                        : 'bg-white border-border/60 text-muted-foreground hover:bg-muted/30',
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
            inputProps={{ min: 0 }}
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
  onSave: (data: ProductFormData) => void;
  product?: Product | null;
}

function ProductDialog({ open, onClose, onSave, product }: ProductDialogProps) {
  const [form, setForm] = useState<ProductFormData>(EMPTY_PRODUCT_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isEditing = !!product;

  React.useEffect(() => {
    if (product) {
      setForm({
        name: product.name,
        description: product.description || '',
        sku: product.sku || '',
        barcode: product.barcode || '',
        category: product.category,
        unit: product.unit,
        costPrice: String(product.costPrice),
        salePrice: String(product.salePrice),
        currentStock: String(product.currentStock),
        minStock: String(product.minStock),
        maxStock: product.maxStock ? String(product.maxStock) : '',
        ncm: product.ncm || '',
        cfop: product.cfop || '',
        isActive: product.isActive,
      });
    } else {
      setForm(EMPTY_PRODUCT_FORM);
    }
    setErrors({});
  }, [product, open]);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!form.name.trim()) newErrors.name = 'Nome obrigatorio';
    if (!form.costPrice || parseFloat(form.costPrice) < 0) newErrors.costPrice = 'Preco de custo invalido';
    if (!form.salePrice || parseFloat(form.salePrice) < 0) newErrors.salePrice = 'Preco de venda invalido';
    if (form.currentStock === '' || parseInt(form.currentStock) < 0) newErrors.currentStock = 'Estoque invalido';
    if (form.minStock === '' || parseInt(form.minStock) < 0) newErrors.minStock = 'Estoque minimo invalido';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setIsSaving(true);
    await new Promise((r) => setTimeout(r, 500));
    onSave(form);
    setIsSaving(false);
    onClose();
  }

  const costVal = parseFloat(form.costPrice) || 0;
  const saleVal = parseFloat(form.salePrice) || 0;
  const margin = getMargin(costVal, saleVal);

  function updateField(field: keyof ProductFormData, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: '' }));
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
              <p className="text-sm font-semibold text-slate-700 mb-3">Precos</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <TextField
                  label="Preco de Custo"
                  type="number"
                  value={form.costPrice}
                  onChange={(e) => updateField('costPrice', e.target.value)}
                  error={!!errors.costPrice}
                  helperText={errors.costPrice}
                  fullWidth
                  required
                  size="small"
                  inputProps={{ min: 0, step: 0.01 }}
                />
                <TextField
                  label="Preco de Venda"
                  type="number"
                  value={form.salePrice}
                  onChange={(e) => updateField('salePrice', e.target.value)}
                  error={!!errors.salePrice}
                  helperText={errors.salePrice}
                  fullWidth
                  required
                  size="small"
                  inputProps={{ min: 0, step: 0.01 }}
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
              <p className="text-sm font-semibold text-slate-700 mb-3">Estoque</p>
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
                  inputProps={{ min: 0 }}
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
                  inputProps={{ min: 0 }}
                />
                <TextField
                  label="Estoque Maximo"
                  type="number"
                  value={form.maxStock}
                  onChange={(e) => updateField('maxStock', e.target.value)}
                  fullWidth
                  size="small"
                  inputProps={{ min: 0 }}
                />
              </div>
            </div>

            {/* Fiscal */}
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-3">Fiscal (Opcional)</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TextField
                  label="NCM"
                  value={form.ncm}
                  onChange={(e) => updateField('ncm', e.target.value)}
                  fullWidth
                  size="small"
                  placeholder="00000000"
                />
                <TextField
                  label="CFOP"
                  value={form.cfop}
                  onChange={(e) => updateField('cfop', e.target.value)}
                  fullWidth
                  size="small"
                  placeholder="0000"
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
}

function MovementHistory({ movements }: MovementHistoryProps) {
  const typeConfig: Record<string, { label: string; bg: string; text: string }> = {
    entrada: { label: 'Entrada', bg: 'bg-emerald-50', text: 'text-emerald-700' },
    saida: { label: 'Saida', bg: 'bg-red-50', text: 'text-red-700' },
    ajuste: { label: 'Ajuste', bg: 'bg-blue-50', text: 'text-blue-700' },
  };

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
// MAIN COMPONENT
// ==============================================

export default function InventoryModule() {
  // State
  const [products] = useState<Product[]>(mockProducts);
  const [movements] = useState<StockMovement[]>(mockMovements);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: 'name', direction: 'asc' });

  // Dialog state
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [movementDialogOpen, setMovementDialogOpen] = useState(false);
  const [movementProduct, setMovementProduct] = useState<Product | null>(null);
  const [movementType, setMovementType] = useState<MovementType>('entrada');

  // Computed
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
  }, [products, searchQuery, categoryFilter, sortConfig]);

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

  // Handlers
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

  const handleSaveProduct = useCallback((data: ProductFormData) => {
    // In a real app, this would call productsService
    console.log('Save product:', data);
  }, []);

  const handleSaveMovement = useCallback((data: MovementFormData) => {
    // In a real app, this would call stockMovementsService
    console.log('Save movement:', data);
  }, []);

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
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#DC2626] text-white text-sm font-medium hover:bg-[#B91C1C] transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Novo Produto
        </button>
      </div>

      {/* ============ FILTERS BAR ============ */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por nome, SKU ou codigo..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border/60 bg-white/70 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-300 transition-all"
          />
        </div>

        {/* Category Filter */}
        <div className="relative">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="appearance-none pl-3 pr-9 py-2.5 rounded-lg border border-border/60 bg-white/70 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-300 transition-all cursor-pointer"
          >
            <option value="all">Todas Categorias</option>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
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
                ? 'bg-white text-foreground shadow-sm'
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
                ? 'bg-white text-foreground shadow-sm'
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
          iconBg="bg-blue-50"
          label="Total de Produtos"
          value={String(stats.totalProducts)}
          subtitle={`${filteredProducts.length} exibidos`}
        />
        <StatCard
          icon={<DollarSign className="w-5 h-5 text-emerald-600" />}
          iconBg="bg-emerald-50"
          label="Valor em Estoque"
          value={formatCurrency(stats.totalValue)}
          subtitle="Custo total em estoque"
        />
        <StatCard
          icon={<TrendingDown className="w-5 h-5 text-amber-600" />}
          iconBg="bg-amber-50"
          label="Itens Abaixo do Minimo"
          value={String(stats.lowStockCount)}
          subtitle={stats.lowStockCount > 0 ? 'Necessita reposicao' : 'Tudo em ordem'}
        />
        <StatCard
          icon={<Activity className="w-5 h-5 text-violet-600" />}
          iconBg="bg-violet-50"
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
              className="rounded-xl border border-border/60 bg-white/70 backdrop-blur-sm overflow-hidden"
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
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Min/Max</span>
                        </th>
                        <th className="text-left py-3 px-4">
                          <SortableHeader label="P. Custo" field="costPrice" sortConfig={sortConfig} onSort={handleSort} />
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
        className="rounded-xl border border-border/60 bg-white/70 backdrop-blur-sm overflow-hidden"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-6 pb-4">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground">
              Historico de Movimentacoes
            </h2>
          </div>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors border border-border/60">
            <Download className="w-3.5 h-3.5" />
            Exportar
          </button>
        </div>
        <MovementHistory movements={movements} />
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
    </div>
  );
}
