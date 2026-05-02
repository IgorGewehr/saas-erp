'use client';

import React, { useState, useMemo, useCallback, useEffect, useDeferredValue, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  IconButton,
  Chip,
  Divider,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  ToggleButtonGroup,
  ToggleButton,
  InputAdornment,
  Tooltip,
} from '@mui/material';
import {
  TrendingUp,
  History,
  TrendingDown,
  DollarSign,
  Clock,
  AlertTriangle,
  Plus,
  Search,
  X,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  ChevronDown,
  Edit3,
  Trash2,
  Receipt,
  Landmark,
  BarChart3,
  ArrowRightLeft,
  Eye,
  EyeOff,
  Layers,
  MessageSquare,
  Target,
  Users,
  Crown,
  FileSpreadsheet,
  Download,
  ChevronLeft,
  ChevronRight,
  Repeat,
  Scale,
  RotateCcw,
  Filter,
  Paperclip,
  FileText,
  Image as ImageIcon,
  XCircle,
  PauseCircle,
  PlayCircle,
  StopCircle,
  CalendarDays,
  ChevronsRight,
  Lock,
  Loader2,
  Upload,
  Settings2,
  Bell,
  BellOff,
  Percent,
  Check,
  LayoutList,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ComposedChart,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { collection, query, where, orderBy, getDocs, addDoc, updateDoc, deleteDoc, doc, writeBatch, getDoc, arrayUnion } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '@/lib/config/firebase';
import { logAudit } from '@/lib/services/audit';
import ConciliacaoTab from './ConciliacaoTab';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useQuery as useTanstackQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { CurrencyProvider, useCurrencyFormat } from './CurrencyContext';
import CurrencyToggle from './CurrencyToggle';
import RecurrenceDetailDialog from './RecurrenceDetailDialog';
import {
  exportTransactionsCSV,
  exportTransactionsPDF,
  exportDRECSV,
  exportDREPDF,
  exportCashFlowCSV,
  exportDRESectorCSV,
  exportCommissionsCSV,
  exportRecurrencesCSV,
  type DREData,
  type CashFlowRow,
  type SectorDRERow,
  type CommissionRow,
} from '@/lib/utils/financial-export';
import { useTheme } from '@/app/components/providers/ThemeProvider';
import type {
  Transaction,
  TransactionType,
  TransactionStatus,
  PaymentMethod,
  BankAccount,
  BankAccountType,
  RecurrenceFrequency,
  Sector,
  Broadcast,
  ConversationChannel,
  CRMContact,
  TransactionAttachment,
  Budget,
  DasRecord,
  DasStatus,
  SimplesAnexo,
  FinancialNotificationSettings,
} from '@/lib/types';

// ==========================================
// CONSTANTS
// ==========================================

const INCOME_CATEGORIES = ['Assinaturas', 'Implantacao', 'Consultoria', 'Servicos', 'Vendas', 'Comissoes', 'Juros', 'Outros'];
const EXPENSE_CATEGORIES = ['Escritorio', 'Infraestrutura', 'Folha', 'Beneficios', 'Marketing', 'Software', 'Contabilidade', 'Impostos', 'Pro-labore', 'Energia', 'Juridico', 'Aluguel', 'Transporte', 'Outros'];


const PRESET_COLORS = [
  '#DC2626', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6',
  '#EC4899', '#F97316', '#06B6D4', '#6366F1', '#0051A5',
  '#820AD1', '#FF7A00', '#1A1A2E', '#14532D', '#7C2D12',
];

type FinancialTab = 'visao-geral' | 'lancamentos' | 'recorrentes' | 'contas' | 'fluxo' | 'dre' | 'orcamento' | 'das' | 'comissoes' | 'conciliacao' | 'auditoria';

const inputSx = { '& .MuiOutlinedInput-root': { borderRadius: '12px' } };

// ==========================================
// HELPERS
// ==========================================

// ── FIN-R17: Brazilian national holiday set (fixed + moveable 2025–2030) ─────
function _easterDate(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-indexed
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

const BR_HOLIDAYS: Set<string> = (() => {
  const set = new Set<string>();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const addDays = (base: Date, n: number) => { const d = new Date(base); d.setDate(d.getDate() + n); return d; };
  for (let year = 2025; year <= 2030; year++) {
    const y = year;
    const fix = (m: number, day: number) => new Date(y, m - 1, day);
    set.add(fmt(fix(1, 1))); set.add(fmt(fix(4, 21))); set.add(fmt(fix(5, 1)));
    set.add(fmt(fix(9, 7))); set.add(fmt(fix(10, 12))); set.add(fmt(fix(11, 2)));
    set.add(fmt(fix(11, 15))); set.add(fmt(fix(11, 20))); set.add(fmt(fix(12, 25)));
    const easter = _easterDate(y);
    set.add(fmt(addDays(easter, -48))); // Carnaval (segunda)
    set.add(fmt(addDays(easter, -47))); // Carnaval (terça)
    set.add(fmt(addDays(easter, -2)));  // Sexta-Feira Santa
    set.add(fmt(easter));               // Páscoa
    set.add(fmt(addDays(easter, 60)));  // Corpus Christi
  }
  return set;
})();

function adjustForBusinessDay(dateStr: string, adjust: 'none' | 'before' | 'after' | undefined): string {
  if (!adjust || adjust === 'none') return dateStr;
  const d = new Date(dateStr + 'T00:00:00');
  const step = adjust === 'before' ? -1 : 1;
  let guard = 0;
  while ((d.getDay() === 0 || d.getDay() === 6 || BR_HOLIDAYS.has(d.toISOString().slice(0, 10))) && guard++ < 10) {
    d.setDate(d.getDate() + step);
  }
  return d.toISOString().slice(0, 10);
}

function computeNextDueDate(currentDue: string, frequency: string, dayOfMonth?: number, secondDayOfMonth?: number, holidayAdjust?: 'none' | 'before' | 'after'): string {
  const d = new Date(currentDue + 'T00:00:00');
  // Cap dayOfMonth at 28 to avoid JS auto-overflow into next month (e.g., Feb 31 → Mar 3)
  const day = dayOfMonth ? Math.min(dayOfMonth, 28) : undefined;
  switch (frequency) {
    case 'weekly':     d.setDate(d.getDate() + 7); break;
    case 'biweekly':   d.setDate(d.getDate() + 14); break;
    case 'monthly':    d.setMonth(d.getMonth() + 1);   if (day) d.setDate(day); break;
    case 'quarterly':  d.setMonth(d.getMonth() + 3);   if (day) d.setDate(day); break;
    case 'semiannual': d.setMonth(d.getMonth() + 6);   if (day) d.setDate(day); break;
    case 'yearly':     d.setFullYear(d.getFullYear() + 1); if (day) d.setDate(day); break;
    case 'biweekly_fixed': {
      const d1 = day ?? 1;
      const d2 = secondDayOfMonth ? Math.min(secondDayOfMonth, 28) : 15;
      // Always sort so first < second, regardless of input order
      const first = Math.min(d1, d2);
      const second = Math.max(d1, d2);
      const cur = d.getDate();
      if (cur < first)        { d.setDate(first); }
      else if (cur < second)  { d.setDate(second); }
      else                    { d.setMonth(d.getMonth() + 1); d.setDate(first); }
      break;
    }
  }
  return adjustForBusinessDay(d.toISOString().slice(0, 10), holidayAdjust);
}

// FIN-R20: normalização de frequência → valor mensal equivalente
const FREQ_TO_MONTHLY: Record<string, number> = {
  weekly: 4.33, biweekly: 2.17, biweekly_fixed: 2,
  monthly: 1, quarterly: 1 / 3, semiannual: 1 / 6, yearly: 1 / 12,
};

const RECURRENCE_LABELS: Record<string, string> = {
  weekly: 'Semanal',
  biweekly: 'Quinzenal',
  biweekly_fixed: 'Quinzenal (dias fixos)',
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  yearly: 'Anual',
};

// ==========================================
// COMPONENT
// ==========================================

function FinancialModuleBody() {
  const formatCurrency = useCurrencyFormat();
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { business, user, sectors } = useAuth();
  const queryClient = useQueryClient();

  const TABS: { key: FinancialTab; label: string; icon: React.ReactNode }[] = [
    { key: 'visao-geral', label: t('financial.tabs.overview', 'Visão Geral'), icon: <BarChart3 size={16} /> },
    { key: 'lancamentos', label: t('financial.tabs.transactions', 'Transações'), icon: <ArrowRightLeft size={16} /> },
    { key: 'recorrentes', label: 'Recorrentes', icon: <Repeat size={16} /> },
    { key: 'fluxo',      label: t('financial.tabs.cashflow',  'Fluxo de Caixa'), icon: <TrendingUp size={16} /> },
    { key: 'dre',        label: 'DRE', icon: <FileSpreadsheet size={16} /> },
    { key: 'orcamento',  label: 'Orçamento', icon: <Target size={16} /> },
    { key: 'das',        label: 'DAS / Simples', icon: <Receipt size={16} /> },
    { key: 'contas',     label: t('financial.tabs.accounts',  'Contas Bancárias'), icon: <Landmark size={16} /> },
    { key: 'comissoes',  label: 'Comissões', icon: <Users size={16} /> },
    { key: 'conciliacao', label: t('financial.tabs.reconciliation', 'Conciliação'), icon: <Scale size={16} /> },
    { key: 'auditoria',  label: t('financial.tabs.audit',     'Auditoria'), icon: <History size={16} /> },
  ];

  const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
    { value: 'dinheiro', label: t('financial.paymentMethods.cash', 'Dinheiro') },
    { value: 'pix', label: t('financial.paymentMethods.pix', 'PIX') },
    { value: 'credito', label: t('financial.paymentMethods.credit', 'Cartão de Crédito') },
    { value: 'debito', label: t('financial.paymentMethods.debit', 'Cartão de Débito') },
    { value: 'boleto', label: t('financial.paymentMethods.boleto', 'Boleto') },
    { value: 'outros', label: t('financial.paymentMethods.other', 'Outros') },
  ];

  const ACCOUNT_TYPES: { value: BankAccountType; label: string }[] = [
    { value: 'corrente', label: t('financial.accountTypes.checking', 'Conta Corrente') },
    { value: 'poupanca', label: t('financial.accountTypes.savings', 'Poupança') },
    { value: 'investimento', label: t('financial.accountTypes.investment', 'Investimento') },
    { value: 'caixa', label: t('financial.accountTypes.cash', 'Caixa') },
  ];
  const isEnterprise = !!business?.enterprise?.isEnabled;

  const [activeTab, setActiveTab] = useState<FinancialTab>('visao-geral');

  // ── Scrollable tab bar ────────────────────────────────────────────────────
  // Use a callback ref (state) instead of useRef so effects re-run when the
  // tab bar mounts — the module has an early-return skeleton that causes
  // tabsRef.current to be null when effects first run on mount.
  const [tabsEl, setTabsEl] = useState<HTMLDivElement | null>(null);
  const [canScrollLeft,  setCanScrollLeft]  = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    if (!tabsEl) return;
    setCanScrollLeft(tabsEl.scrollLeft > 1);
    setCanScrollRight(tabsEl.scrollLeft + tabsEl.clientWidth < tabsEl.scrollWidth - 1);
  }, [tabsEl]);

  const scrollTabsBy = useCallback((amount: number) => {
    tabsEl?.scrollBy({ left: amount, behavior: 'smooth' });
  }, [tabsEl]);

  // Wheel listener — re-runs when tabsEl appears (loading → loaded transition)
  useEffect(() => {
    if (!tabsEl) return;
    checkScroll();
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      tabsEl.scrollLeft += e.deltaY;
      checkScroll();
    };
    tabsEl.addEventListener('wheel', onWheel, { passive: false });
    return () => tabsEl.removeEventListener('wheel', onWheel);
  }, [tabsEl, checkScroll]);

  useEffect(() => {
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, [checkScroll]);

  const [showForm, setShowForm] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [showScopeDialog, setShowScopeDialog] = useState(false);
  const [showBalances, setShowBalances] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showAlertsModal, setShowAlertsModal] = useState(false);
  const [alertSettings, setAlertSettings] = useState<FinancialNotificationSettings>({
    enabled: false,
    dueSoonDays: 3,
    sendEmail: false,
    sendWhatsApp: true,
    notifyPayable: true,
    notifyReceivable: true,
  });
  const [isSavingAlerts, setIsSavingAlerts] = useState(false);

  // Installment group dialog
  const [installmentGroupId, setInstallmentGroupId] = useState<string | null>(null);
  const [installmentGroupTxs, setInstallmentGroupTxs] = useState<Transaction[]>([]);
  const [isLoadingGroup, setIsLoadingGroup] = useState(false);
  const [showBankForm, setShowBankForm] = useState(false);
  const [editingBankAccount, setEditingBankAccount] = useState<BankAccount | null>(null);
  const [showDeleteBankConfirm, setShowDeleteBankConfirm] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Transaction form state
  const [formType, setFormType] = useState<TransactionType>('receita');
  const [formDescription, setFormDescription] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formPaymentDate, setFormPaymentDate] = useState('');
  const [formPaymentMethod, setFormPaymentMethod] = useState<PaymentMethod | ''>('');
  const [formNotes, setFormNotes] = useState('');
  const [formClientName, setFormClientName] = useState('');
  const [formBankAccount, setFormBankAccount] = useState('');
  const [formStatus, setFormStatus] = useState<TransactionStatus>('pendente');
  const [formAttachments, setFormAttachments] = useState<TransactionAttachment[]>([]);
  const [formFilesToUpload, setFormFilesToUpload] = useState<File[]>([]);
  const [formAttachmentsToDelete, setFormAttachmentsToDelete] = useState<TransactionAttachment[]>([]);

  // Bank account form state
  const [bankName, setBankName] = useState('');
  const [bankBankName, setBankBankName] = useState('');
  const [bankBankCode, setBankBankCode] = useState('');
  const [bankAccountType, setBankAccountType] = useState<BankAccountType>('corrente');
  const [bankAgency, setBankAgency] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankBalance, setBankBalance] = useState('');
  const [bankColor, setBankColor] = useState('#3B82F6');
  const [bankIsMain, setBankIsMain] = useState(false);

  // Sector form (enterprise)
  const [formSectorId, setFormSectorId] = useState('');
  const [formInstallments, setFormInstallments] = useState(1);
  const [formInstallmentInterval, setFormInstallmentInterval] = useState<'monthly' | 'weekly'>('monthly');
  const [formRecurrence, setFormRecurrence] = useState(false);
  const [formRecurrenceFrequency, setFormRecurrenceFrequency] = useState<'weekly' | 'biweekly' | 'biweekly_fixed' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly'>('monthly');
  const [formRecurrenceEndDate, setFormRecurrenceEndDate] = useState('');
  const [formRecurrenceDay, setFormRecurrenceDay] = useState<string>('');
  const [formRecurrenceSecondDay, setFormRecurrenceSecondDay] = useState<string>('');
  const [formRecurrenceLabel, setFormRecurrenceLabel] = useState<string>('');
  const [formRecurrenceHolidayAdjust, setFormRecurrenceHolidayAdjust] = useState<'none' | 'before' | 'after'>('none');
  const [formRecurrenceLateFeePct, setFormRecurrenceLateFeePct] = useState('');
  const [formRecurrenceInterestPct, setFormRecurrenceInterestPct] = useState('');

  // Transactions tab state
  const [txFilterTab, setTxFilterTab] = useState<'todas' | 'receitas' | 'despesas' | 'pendentes' | 'atrasadas'>('todas');
  const [txSearch, setTxSearch] = useState('');
  const [txSortField, setTxSortField] = useState('dueDate');
  const [txSortDir, setTxSortDir] = useState<'asc' | 'desc'>('desc');

  // Advanced filters
  const [txDateFrom, setTxDateFrom] = useState('');
  const [txDateTo, setTxDateTo] = useState('');
  const [txCategory, setTxCategory] = useState('');
  const [txBankAccount, setTxBankAccount] = useState('');
  const [txPaymentMethod, setTxPaymentMethod] = useState('');
  const [txSectorId, setTxSectorId] = useState('');
  const [txClientName, setTxClientName] = useState('');

  const deferredTxSearch = useDeferredValue(txSearch);
  const deferredTxClientName = useDeferredValue(txClientName);

  // Restore saved filter from localStorage on mount
  // Load notification settings from Firestore
  useEffect(() => {
    if (!business?.id) return;
    const ns = business.financial?.notificationSettings;
    if (ns) setAlertSettings(prev => ({ ...prev, ...ns }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('financial_tx_filters');
      if (!saved) return;
      const f = JSON.parse(saved);
      if (typeof f !== 'object' || f === null) return;
      // Strict validators — prevent arbitrary strings from localStorage polluting state
      const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
      const isStr  = (v: unknown): v is string => typeof v === 'string' && v.length <= 200;
      if (isDate(f.dateFrom))    setTxDateFrom(f.dateFrom);
      if (isDate(f.dateTo))      setTxDateTo(f.dateTo);
      if (isStr(f.category))     setTxCategory(f.category);
      if (isStr(f.bankAccount))  setTxBankAccount(f.bankAccount);
      if (isStr(f.paymentMethod))setTxPaymentMethod(f.paymentMethod);
      if (isStr(f.sectorId))     setTxSectorId(f.sectorId);
      if (isStr(f.clientName))   setTxClientName(f.clientName);
    } catch { /* ignore malformed JSON */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveTxFilters = useCallback(() => {
    localStorage.setItem('financial_tx_filters', JSON.stringify({
      dateFrom: txDateFrom, dateTo: txDateTo, category: txCategory,
      bankAccount: txBankAccount, paymentMethod: txPaymentMethod,
      sectorId: txSectorId, clientName: txClientName,
    }));
    toast.success('Filtro salvo como favorito');
  }, [txDateFrom, txDateTo, txCategory, txBankAccount, txPaymentMethod, txSectorId, txClientName]);

  const clearTxFilters = useCallback(() => {
    setTxSearch('');
    setTxDateFrom(''); setTxDateTo(''); setTxCategory('');
    setTxBankAccount(''); setTxPaymentMethod(''); setTxSectorId(''); setTxClientName('');
    localStorage.removeItem('financial_tx_filters');
  }, []);

  // ---- Firestore Queries ----
  const { data: transactions = [], isLoading: isLoadingTransactions } = useTanstackQuery({
    queryKey: ['transactions', business?.id],
    queryFn: async () => {
      if (!business?.id) return [];
      const q = query(
        collection(db, 'transactions'),
        where('businessId', '==', business.id),
        orderBy('dueDate', 'desc')
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as Transaction));
    },
    enabled: !!business?.id,
    staleTime: 2 * 60 * 1000,
  });

  const { data: bankAccounts = [], isLoading: isLoadingBankAccounts } = useTanstackQuery({
    queryKey: ['bankAccounts', business?.id],
    queryFn: async () => {
      if (!business?.id) return [];
      const q = query(
        collection(db, 'bankAccounts'),
        where('businessId', '==', business.id),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as BankAccount));
    },
    enabled: !!business?.id,
    staleTime: 2 * 60 * 1000,
  });

  // ---- Enterprise Queries ----
  const { data: broadcasts = [] } = useTanstackQuery({
    queryKey: ['broadcasts', business?.id],
    queryFn: async () => {
      if (!business?.id) return [];
      const q = query(
        collection(db, 'broadcasts'),
        where('businessId', '==', business.id),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as Broadcast));
    },
    enabled: !!business?.id && isEnterprise,
    staleTime: 5 * 60 * 1000,
  });

  const { data: crmContacts = [] } = useTanstackQuery({
    queryKey: ['clients', business?.id],
    queryFn: async () => {
      if (!business?.id) return [];
      const q = query(
        collection(db, 'clients'),
        where('businessId', '==', business.id)
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as CRMContact));
    },
    enabled: !!business?.id && isEnterprise,
    staleTime: 5 * 60 * 1000,
  });

  // Fiscal documents with status 'autorizada' — used to build the set of locked saleIds
  const { data: authorizedFiscalSaleIds = new Set<string>() } = useTanstackQuery({
    queryKey: ['fiscalLocks', business?.id],
    queryFn: async () => {
      if (!business?.id) return new Set<string>();
      const q = query(
        collection(db, 'fiscalDocuments'),
        where('businessId', '==', business.id),
        where('status', '==', 'autorizada'),
      );
      const snap = await getDocs(q);
      const ids = new Set<string>();
      snap.docs.forEach(d => { const saleId = d.data().saleId as string | undefined; if (saleId) ids.add(saleId); });
      return ids;
    },
    enabled: !!business?.id,
    staleTime: 30 * 1000,
  });

  const isTransactionLocked = useCallback((tx: Transaction): boolean => {
    if (tx.isLocked) return true;
    if (tx.saleId && authorizedFiscalSaleIds.has(tx.saleId)) return true;
    return false;
  }, [authorizedFiscalSaleIds]);

  // ---- Computed ----
  const summaryMetrics = useMemo(() => {
    const receitas = transactions.filter((t) => t.type === 'receita' && t.status === 'pago').reduce((s, t) => s + t.amount, 0);
    const despesas = transactions.filter((t) => t.type === 'despesa' && t.status === 'pago').reduce((s, t) => s + t.amount, 0);
    const aReceber = transactions.filter((t) => t.type === 'receita' && (t.status === 'pendente' || t.status === 'atrasado')).reduce((s, t) => s + t.amount, 0);
    const aPagar = transactions.filter((t) => t.type === 'despesa' && (t.status === 'pendente' || t.status === 'atrasado')).reduce((s, t) => s + t.amount, 0);
    const lucro = receitas - despesas;
    const totalContas = bankAccounts.filter((a) => a.isActive).reduce((s, a) => s + a.balance, 0);
    return { receitas, despesas, lucro, aReceber, aPagar, totalContas };
  }, [transactions, bankAccounts]);

  // Derive unique categories from transactions for the filter dropdown
  const txAvailableCategories = useMemo(() => {
    const cats = new Set<string>();
    transactions.forEach(t => { if (t.category) cats.add(t.category); });
    return Array.from(cats).sort();
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    let filtered = [...transactions];

    // Tab quick-filter
    switch (txFilterTab) {
      case 'receitas': filtered = filtered.filter((t) => t.type === 'receita'); break;
      case 'despesas': filtered = filtered.filter((t) => t.type === 'despesa'); break;
      case 'pendentes': filtered = filtered.filter((t) => t.status === 'pendente'); break;
      case 'atrasadas': filtered = filtered.filter((t) => t.status === 'atrasado'); break;
    }

    // Text search
    if (deferredTxSearch) {
      const q = deferredTxSearch.toLowerCase();
      filtered = filtered.filter((t) =>
        t.description.toLowerCase().includes(q) ||
        (t.category || '').toLowerCase().includes(q) ||
        (t.clientName && t.clientName.toLowerCase().includes(q))
      );
    }
    // Advanced filters (AND logic — all active filters must match)
    if (txDateFrom)       filtered = filtered.filter(t => (t.dueDate || t.paymentDate || '') >= txDateFrom);
    if (txDateTo)         filtered = filtered.filter(t => (t.dueDate || t.paymentDate || '') <= txDateTo);
    if (txCategory)       filtered = filtered.filter(t => t.category === txCategory);
    if (txBankAccount)    filtered = filtered.filter(t => t.bankAccountId === txBankAccount);
    if (txPaymentMethod)  filtered = filtered.filter(t => t.paymentMethod === txPaymentMethod);
    if (txSectorId)       filtered = filtered.filter(t => t.sectorId === txSectorId);
    if (deferredTxClientName) {
      const cq = deferredTxClientName.toLowerCase();
      filtered = filtered.filter(t => (t.clientName || '').toLowerCase().includes(cq));
    }

    filtered.sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[txSortField];
      const bVal = (b as unknown as Record<string, unknown>)[txSortField];
      if (typeof aVal === 'string' && typeof bVal === 'string') return txSortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      if (typeof aVal === 'number' && typeof bVal === 'number') return txSortDir === 'asc' ? aVal - bVal : bVal - aVal;
      return 0;
    });
    return filtered;
  }, [transactions, txFilterTab, deferredTxSearch, txDateFrom, txDateTo, txCategory, txBankAccount, txPaymentMethod, txSectorId, deferredTxClientName, txSortField, txSortDir]);

  // Monthly data for charts — 2 months back + current + 3 months forward
  const monthlyData = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    // Fixed 6-month window
    const windowMonths: string[] = [];
    for (let i = -2; i <= 3; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      windowMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const months: Record<string, { receitas: number; despesas: number; receitasPrevisto: number; despesasPrevisto: number }> = {};
    for (const m of windowMonths) months[m] = { receitas: 0, despesas: 0, receitasPrevisto: 0, despesasPrevisto: 0 };

    // Historical paid transactions
    transactions.forEach(t => {
      if (!t.dueDate || t.status !== 'pago') return;
      const month = t.dueDate.substring(0, 7);
      if (!months[month]) return;
      if (t.type === 'receita') months[month].receitas += t.amount;
      else months[month].despesas += t.amount;
    });

    // Project active recurring transactions into future months
    const maxMonth = windowMonths[windowMonths.length - 1];
    const [maxY, maxM] = maxMonth.split('-').map(Number);
    const maxDate = new Date(maxY, maxM, 0).toISOString().slice(0, 10); // last day of window

    for (const tx of transactions.filter(t => t.recurrence?.isActive && t.recurrence.nextDueDate)) {
      const rec = tx.recurrence!;
      let next = rec.nextDueDate!;
      let guard = 0;
      while (next <= maxDate && guard++ < 100) {
        if (next > todayStr) {
          const month = next.slice(0, 7);
          if (months[month]) {
            if (tx.type === 'receita') months[month].receitasPrevisto += tx.amount;
            else months[month].despesasPrevisto += tx.amount;
          }
        }
        if (rec.endDate && next >= rec.endDate) break;
        next = computeNextDueDate(next, rec.frequency, rec.dayOfMonth, rec.secondDayOfMonth);
      }
    }

    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return windowMonths.map(month => {
      const data = months[month];
      const [y, m] = month.split('-');
      const label = `${monthNames[parseInt(m) - 1]}/${y.slice(2)}`;
      return {
        month: label,
        receitas: data.receitas,
        despesas: data.despesas,
        receitasPrevisto: data.receitasPrevisto,
        despesasPrevisto: data.despesasPrevisto,
        saldo: (data.receitas + data.receitasPrevisto) - (data.despesas + data.despesasPrevisto),
      };
    });
  }, [transactions]);

  // Expense breakdown by category
  const expenseBreakdown = useMemo(() => {
    const cats: Record<string, number> = {};
    transactions
      .filter(t => t.type === 'despesa' && t.status === 'pago' && t.category)
      .forEach(t => {
        cats[t.category!] = (cats[t.category!] || 0) + t.amount;
      });
    const total = Object.values(cats).reduce((s, v) => s + v, 0);
    const colors = ['#DC2626', '#3B82F6', '#F59E0B', '#10B981', '#8B5CF6', '#EC4899', '#F97316', '#06B6D4', '#6366F1', '#6B7280'];
    return Object.entries(cats)
      .sort(([, a], [, b]) => b - a)
      .map(([name, amount], i) => ({
        name,
        amount,
        color: colors[i % colors.length],
        percentage: total > 0 ? parseFloat(((amount / total) * 100).toFixed(1)) : 0,
      }));
  }, [transactions]);

  // ---- Transaction Handlers ----
  const handleTxSort = useCallback((field: string) => {
    setTxSortField((prev) => {
      if (prev === field) { setTxSortDir((d) => d === 'asc' ? 'desc' : 'asc'); return prev; }
      setTxSortDir('desc');
      return field;
    });
  }, []);

  const handleMarkAsPaid = useCallback(async (id: string) => {
    if (!business?.id) return;
    try {
      const docRef = doc(db, 'transactions', id);
      await updateDoc(docRef, {
        status: 'pago',
        paymentDate: new Date().toISOString().split('T')[0],
        updatedAt: new Date().toISOString(),
      });
      queryClient.invalidateQueries({ queryKey: ['transactions', business.id] });
      toast.success(t('financial.toast.markedAsPaid', 'Transação marcada como paga'));
    } catch (err) {
      console.error('Error marking as paid:', err);
      toast.error(t('financial.toast.updateError', 'Erro ao atualizar transação'));
    }
  }, [business?.id, queryClient]);

  const handleRevertToPending = useCallback(async (id: string) => {
    if (!business?.id) return;
    try {
      await updateDoc(doc(db, 'transactions', id), {
        status: 'pendente',
        paymentDate: null,
        updatedAt: new Date().toISOString(),
      });
      queryClient.invalidateQueries({ queryKey: ['transactions', business.id] });
      toast.info(t('financial.toast.revertedToPending', 'Transação revertida para pendente'));
    } catch (err) {
      console.error('Error reverting transaction:', err);
      toast.error(t('financial.toast.updateError', 'Erro ao atualizar transação'));
    }
  }, [business?.id, queryClient]);

  // ---- Installment Group Handlers ----
  const handleOpenInstallmentGroup = useCallback(async (groupId: string) => {
    if (!business?.id) return;
    setIsLoadingGroup(true);
    setInstallmentGroupId(groupId);
    setInstallmentGroupTxs([]);
    try {
      const q = query(
        collection(db, 'transactions'),
        where('businessId', '==', business.id),
        where('installmentGroupId', '==', groupId),
        orderBy('installmentNumber', 'asc'),
      );
      const snap = await getDocs(q);
      setInstallmentGroupTxs(snap.docs.map(d => ({ ...d.data(), id: d.id } as Transaction)));
    } finally {
      setIsLoadingGroup(false);
    }
  }, [business?.id]);

  const handleUpdateInstallmentDate = useCallback(async (id: string, newDate: string) => {
    if (!business?.id) return;
    await updateDoc(doc(db, 'transactions', id), { dueDate: newDate, updatedAt: new Date().toISOString() });
    setInstallmentGroupTxs(prev => prev.map(t => t.id === id ? { ...t, dueDate: newDate } : t));
    queryClient.invalidateQueries({ queryKey: ['transactions', business.id] });
  }, [business?.id, queryClient]);

  const handleMarkInstallmentPaid = useCallback(async (id: string) => {
    if (!business?.id) return;
    const today = new Date().toISOString().slice(0, 10);
    await updateDoc(doc(db, 'transactions', id), { status: 'pago', paymentDate: today, updatedAt: new Date().toISOString() });
    setInstallmentGroupTxs(prev => prev.map(t => t.id === id ? { ...t, status: 'pago' as TransactionStatus, paymentDate: today } : t));
    queryClient.invalidateQueries({ queryKey: ['transactions', business.id] });
    toast.success('Parcela quitada');
  }, [business?.id, queryClient]);

  const handleCancelInstallment = useCallback(async (id: string) => {
    if (!business?.id) return;
    await updateDoc(doc(db, 'transactions', id), { status: 'cancelado', updatedAt: new Date().toISOString() });
    setInstallmentGroupTxs(prev => prev.map(t => t.id === id ? { ...t, status: 'cancelado' as TransactionStatus } : t));
    queryClient.invalidateQueries({ queryKey: ['transactions', business.id] });
    toast.info('Parcela cancelada');
  }, [business?.id, queryClient]);

  const handlePayAllPendingInstallments = useCallback(async () => {
    if (!business?.id) return;
    const pending = installmentGroupTxs.filter(t => t.status === 'pendente' || t.status === 'atrasado');
    if (!pending.length) return;
    const today = new Date().toISOString().slice(0, 10);
    const batch = writeBatch(db);
    pending.forEach(t => batch.update(doc(db, 'transactions', t.id), { status: 'pago', paymentDate: today, updatedAt: new Date().toISOString() }));
    await batch.commit();
    setInstallmentGroupTxs(prev => prev.map(t => pending.find(p => p.id === t.id) ? { ...t, status: 'pago' as TransactionStatus, paymentDate: today } : t));
    queryClient.invalidateQueries({ queryKey: ['transactions', business.id] });
    toast.success(`${pending.length} parcela(s) quitada(s)`);
  }, [installmentGroupTxs, business?.id, queryClient]);

  // ── Recurring: count urgent (overdue + ≤3d) for tab badge ──────────────────
  const urgentRecurringCount = useMemo(() => {
    const in3d = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    return transactions.filter(tx => tx.recurrence?.isActive && tx.recurrence.nextDueDate && tx.recurrence.nextDueDate <= in3d).length;
  }, [transactions]);

  const handlePauseRecurrence = useCallback(async (txId: string) => {
    await updateDoc(doc(db, 'transactions', txId), {
      'recurrence.isActive': false,
      updatedAt: new Date().toISOString(),
    });
    queryClient.invalidateQueries({ queryKey: ['transactions', business?.id] });
  }, [business?.id, queryClient]);

  const handleMarkRecurringPaid = useCallback(async (txId: string, paidAmount?: number) => {
    const tx = transactions.find(t => t.id === txId);
    const rec = tx?.recurrence;
    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    if (tx && rec?.isActive && rec.nextDueDate && rec.frequency) {
      const nextDate = computeNextDueDate(rec.nextDueDate, rec.frequency, rec.dayOfMonth, rec.secondDayOfMonth, rec.holidayAdjust);
      const seriesEnds = rec.endDate && nextDate > rec.endDate;
      await updateDoc(doc(db, 'transactions', txId), {
        status: 'pago',
        paymentDate: today,
        updatedAt: now,
        'recurrence.nextDueDate': nextDate,
        'recurrence.history': arrayUnion({
          dueDate: rec.nextDueDate,
          paidDate: today,
          amount: paidAmount ?? tx.amount,
        }),
        ...(seriesEnds ? { 'recurrence.isActive': false } : {}),
      });
    } else {
      await updateDoc(doc(db, 'transactions', txId), {
        status: 'pago',
        paymentDate: today,
        updatedAt: now,
      });
    }
    queryClient.invalidateQueries({ queryKey: ['transactions', business?.id] });
  }, [business?.id, queryClient, transactions]);

  const handleResumeRecurrence = useCallback(async (txId: string) => {
    await updateDoc(doc(db, 'transactions', txId), {
      'recurrence.isActive': true,
      updatedAt: new Date().toISOString(),
    });
    queryClient.invalidateQueries({ queryKey: ['transactions', business?.id] });
  }, [business?.id, queryClient]);

  const handleSkipRecurrence = useCallback(async (txId: string) => {
    const tx = transactions.find(t => t.id === txId);
    const rec = tx?.recurrence;
    if (!rec?.nextDueDate || !rec.frequency) return;
    const nextDate = computeNextDueDate(rec.nextDueDate, rec.frequency, rec.dayOfMonth, rec.secondDayOfMonth, rec.holidayAdjust);
    const seriesEnds = rec.endDate && nextDate > rec.endDate;
    await updateDoc(doc(db, 'transactions', txId), {
      'recurrence.nextDueDate': nextDate,
      updatedAt: new Date().toISOString(),
      ...(seriesEnds ? { 'recurrence.isActive': false } : {}),
    });
    queryClient.invalidateQueries({ queryKey: ['transactions', business?.id] });
  }, [business?.id, queryClient, transactions]);

  // mode='pct' → aplica percentual (ex: 5 = +5%), mode='fixed' → novo valor absoluto
  const handleAdjustSeriesValue = useCallback(async (txId: string, mode: 'pct' | 'fixed', value: number) => {
    const tx = transactions.find(t => t.id === txId);
    if (!tx) return;
    const newAmount = mode === 'pct'
      ? Math.round(tx.amount * (1 + value / 100) * 100) / 100
      : Math.round(value * 100) / 100;
    if (newAmount <= 0) return;
    await updateDoc(doc(db, 'transactions', txId), {
      amount: newAmount,
      updatedAt: new Date().toISOString(),
    });
    queryClient.invalidateQueries({ queryKey: ['transactions', business?.id] });
  }, [business?.id, queryClient, transactions]);

  // cancelCurrent=true → encerra série e cancela o vencimento atual
  // cancelCurrent=false → encerra série e mantém o vencimento atual como pendente
  const handleEndSeries = useCallback(async (txId: string, cancelCurrent: boolean) => {
    const updates: Record<string, unknown> = {
      'recurrence.isActive': false,
      updatedAt: new Date().toISOString(),
    };
    if (cancelCurrent) updates.status = 'cancelado';
    await updateDoc(doc(db, 'transactions', txId), updates);
    queryClient.invalidateQueries({ queryKey: ['transactions', business?.id] });
  }, [business?.id, queryClient]);

  const handleSaveAlerts = useCallback(async () => {
    if (!business?.id) return;
    setIsSavingAlerts(true);
    try {
      await updateDoc(doc(db, 'businesses', business.id), {
        'financial.notificationSettings': alertSettings,
        updatedAt: new Date().toISOString(),
      });
      setShowAlertsModal(false);
    } catch (err) {
      console.error('[financial-alerts] save failed:', err);
    } finally {
      setIsSavingAlerts(false);
    }
  }, [business?.id, alertSettings]);

  const openNewForm = useCallback(() => {
    setEditingTransaction(null);
    setFormType('receita');
    setFormDescription('');
    setFormCategory('');
    setFormAmount('');
    setFormDueDate('');
    setFormPaymentDate('');
    setFormPaymentMethod('');
    setFormNotes('');
    setFormClientName('');
    setFormBankAccount('');
    setFormStatus('pendente');
    setFormSectorId('');
    setFormInstallments(1);
    setFormInstallmentInterval('monthly');
    setFormRecurrence(false);
    setFormRecurrenceFrequency('monthly');
    setFormRecurrenceEndDate('');
    setFormRecurrenceDay('');
    setFormRecurrenceSecondDay('');
    setFormRecurrenceLabel('');
    setFormRecurrenceHolidayAdjust('none');
    setFormRecurrenceLateFeePct('');
    setFormRecurrenceInterestPct('');
    setFormAttachments([]);
    setFormFilesToUpload([]);
    setFormAttachmentsToDelete([]);
    setShowForm(true);
  }, []);

  const openEditForm = useCallback(async (transaction: Transaction) => {
    // Always fetch fresh data from Firestore before opening the edit form.
    let tx = transaction;
    try {
      const fresh = await getDoc(doc(db, 'transactions', transaction.id));
      if (fresh.exists()) tx = { ...fresh.data(), id: fresh.id } as Transaction;
    } catch {
      // Fall back to cached version if Firestore fetch fails
    }

    // Lock guard: block editing if linked to an authorized fiscal document
    if (isTransactionLocked(tx)) {
      toast.error('Esta transação está vinculada a um documento fiscal autorizado e não pode ser alterada.');
      // Backfill isLocked flag so the icon shows without querying fiscal docs next time
      if (!tx.isLocked && tx.saleId) {
        updateDoc(doc(db, 'transactions', tx.id), { isLocked: true, lockedReason: 'Documento fiscal autorizado' }).catch(() => {});
      }
      return;
    }

    setEditingTransaction(tx);
    setFormType(tx.type);
    setFormDescription(tx.description);
    setFormCategory(tx.category ?? '');
    setFormAmount(tx.amount.toString());
    setFormDueDate(tx.dueDate ?? '');
    setFormPaymentDate(tx.paymentDate || '');
    setFormPaymentMethod(tx.paymentMethod || '');
    setFormNotes(tx.notes || '');
    setFormClientName(tx.clientName || '');
    setFormBankAccount(tx.bankAccountId || '');
    setFormStatus(tx.status);
    setFormSectorId(tx.sectorId || '');
    setFormRecurrence(!!tx.recurrence?.isActive);
    setFormRecurrenceFrequency(tx.recurrence?.frequency || 'monthly');
    setFormRecurrenceEndDate(tx.recurrence?.endDate || '');
    setFormRecurrenceDay(tx.recurrence?.dayOfMonth?.toString() || '');
    setFormRecurrenceSecondDay(tx.recurrence?.secondDayOfMonth?.toString() || '');
    setFormRecurrenceLabel(tx.recurrence?.label || '');
    setFormRecurrenceHolidayAdjust(tx.recurrence?.holidayAdjust ?? 'none');
    setFormRecurrenceLateFeePct(tx.recurrence?.lateFeePct?.toString() ?? '');
    setFormRecurrenceInterestPct(tx.recurrence?.interestPctMonth?.toString() ?? '');
    setFormAttachments(tx.attachments || []);
    setFormFilesToUpload([]);
    setFormAttachmentsToDelete([]);
    setShowForm(true);
  }, []);

  const handleSaveTransaction = useCallback(async (scope: 'all' | 'this_only' = 'all') => {
    if (!business?.id || !user) {
      toast.error(t('financial.toast.businessNotLoaded', 'Dados da empresa não carregados. Recarregue a página.'));
      return;
    }
    const amount = parseFloat(formAmount);
    if (!formDescription || isNaN(amount) || amount <= 0) return;

    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const status: TransactionStatus = formStatus;
      const actor = { uid: user.uid, name: user.name };

      // Excluir arquivos removidos
      for (const att of formAttachmentsToDelete) {
        try {
          // Use stored path (not download URL) — ref() doesn't accept HTTPS URLs
          const fileRef = att.path ? ref(storage, att.path) : null;
          if (fileRef) await deleteObject(fileRef);
        } catch (e) {
          console.error('Falha ao excluir anexo do storage:', e);
        }
      }

      let finalAttachments = [...formAttachments];
      if (formFilesToUpload.length > 0) {
        for (const file of formFilesToUpload) {
          const fileId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          // Limpar caracteres estranhos do nome
          const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
          const storageRef = ref(storage, `businesses/${business.id}/financial_attachments/${fileId}_${safeName}`);
          await uploadBytes(storageRef, file);
          const url = await getDownloadURL(storageRef);
          finalAttachments.push({
            id: fileId,
            name: file.name,
            url,
            path: storageRef.fullPath,
            size: file.size,
            type: file.type,
            createdAt: now,
          });
        }
      }

      const baseTx: Record<string, unknown> = {
        businessId: business.id,
        type: formType,
        category: formCategory || null,
        description: formDescription,
        amount,
        dueDate: formDueDate || null,
        paymentDate: formPaymentDate || null,
        status,
        paymentMethod: (formPaymentMethod as PaymentMethod) || null,
        notes: formNotes || null,
        clientName: formClientName || null,
        bankAccountId: formBankAccount || null,
        sectorId: formSectorId || null,
        attachments: finalAttachments,
        updatedByName: user.name,
        updatedBy: user.uid,
        updatedAt: now,
        // Use paymentDate as fallback when dueDate is missing (e.g. already-paid transaction being made recurrent)
        recurrence: (() => {
          if (!formRecurrence || formInstallments > 1) return null;
          // Fall back to today when neither dueDate nor paymentDate is set
          const baseDate = formDueDate || formPaymentDate || new Date().toISOString().slice(0, 10);
          const dayNum = formRecurrenceDay ? parseInt(formRecurrenceDay, 10) : undefined;
          const secondDayNum = formRecurrenceSecondDay ? parseInt(formRecurrenceSecondDay, 10) : undefined;
          return {
            frequency: formRecurrenceFrequency,
            nextDueDate: computeNextDueDate(baseDate, formRecurrenceFrequency, dayNum, secondDayNum, formRecurrenceHolidayAdjust),
            ...(formRecurrenceEndDate ? { endDate: formRecurrenceEndDate } : {}),
            isActive: true,
            ...(dayNum ? { dayOfMonth: dayNum } : {}),
            ...(secondDayNum && formRecurrenceFrequency === 'biweekly_fixed' ? { secondDayOfMonth: secondDayNum } : {}),
            ...(formRecurrenceLabel ? { label: formRecurrenceLabel } : {}),
            holidayAdjust: formRecurrenceHolidayAdjust,
            ...(formRecurrenceLateFeePct ? { lateFeePct: parseFloat(formRecurrenceLateFeePct) } : {}),
            ...(formRecurrenceInterestPct ? { interestPctMonth: parseFloat(formRecurrenceInterestPct) } : {}),
          };
        })(),
      };

      // editingTransaction.id === '' means it came from FIN-R23 "Criar série" (suggested pattern) → treat as new
      if (editingTransaction && editingTransaction.id) {
        if (scope === 'this_only') {
          // Cria uma cópia avulsa com os valores editados, sem alterar a série original
          const { recurrence: _r, ...oneTimeFields } = baseTx as Record<string, unknown>;
          const newRef = await addDoc(collection(db, 'transactions'), {
            ...oneTimeFields,
            recurrence: null,
            createdBy: user.uid,
            createdByName: user.name,
            createdAt: now,
          });
          await logAudit(db, {
            businessId: business.id,
            entity: 'transaction',
            entityId: newRef.id,
            action: 'create',
            actor,
            amount,
            description: `${formDescription} (cópia avulsa da série recorrente)`,
          });
          toast.success('Vencimento avulso criado — a série continua inalterada');
        } else {
          const docRef = doc(db, 'transactions', editingTransaction.id);
          const before = { ...editingTransaction };
          await updateDoc(docRef, baseTx);
          await logAudit(db, {
            businessId: business.id,
            entity: 'transaction',
            entityId: editingTransaction.id,
            action: 'update',
            actor,
            before,
            after: { ...editingTransaction, ...baseTx },
            amount,
            description: formDescription,
          });
          toast.success(t('financial.toast.transactionUpdated', 'Transação atualizada'));
        }
      } else if (formInstallments > 1 && formDueDate) {
        // Split into N linked installments via batch write
        const groupId = `inst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const perAmount = Math.round((amount / formInstallments) * 100) / 100;
        const roundingGap = Math.round((amount - perAmount * formInstallments) * 100) / 100;
        const batch = writeBatch(db);
        const createdIds: string[] = [];
        const baseDate = new Date(formDueDate + 'T12:00:00');
        for (let i = 0; i < formInstallments; i++) {
          const ref = doc(collection(db, 'transactions'));
          createdIds.push(ref.id);
          const due = new Date(baseDate);
          if (formInstallmentInterval === 'monthly') due.setMonth(due.getMonth() + i);
          else due.setDate(due.getDate() + i * 7);
          // Tack the rounding gap onto the last installment so totals always match
          const instAmount = i === formInstallments - 1 ? perAmount + roundingGap : perAmount;
          batch.set(ref, {
            ...baseTx,
            amount: instAmount,
            dueDate: due.toISOString().slice(0, 10),
            paymentDate: null,       // parcels default to pending
            status: 'pendente',
            installmentGroupId: groupId,
            installmentNumber: i + 1,
            installmentTotal: formInstallments,
            description: `${formDescription} (${i + 1}/${formInstallments})`,
            createdBy: user.uid,
            createdByName: user.name,
            createdAt: now,
          });
        }
        await batch.commit();
        for (const id of createdIds) {
          await logAudit(db, {
            businessId: business.id,
            entity: 'transaction',
            entityId: id,
            action: 'create',
            actor,
            amount: perAmount,
            description: `${formDescription} (parcelada ${formInstallments}x)`,
          });
        }
        toast.success(`${formInstallments} parcelas criadas`);
      } else {
        const ref = await addDoc(collection(db, 'transactions'), {
          ...baseTx,
          createdBy: user.uid,
          createdByName: user.name,
          createdAt: now,
        });
        await logAudit(db, {
          businessId: business.id,
          entity: 'transaction',
          entityId: ref.id,
          action: 'create',
          actor,
          amount,
          description: formDescription,
        });
        toast.success(t('financial.toast.transactionCreated', 'Transação criada'));
      }

      queryClient.invalidateQueries({ queryKey: ['transactions', business.id] });
      setShowForm(false);
    } catch (err) {
      console.error('Error saving transaction:', err);
      toast.error(t('financial.toast.saveError', 'Erro ao salvar transação'));
    } finally {
      setIsSaving(false);
    }
  }, [business?.id, user, formType, formDescription, formCategory, formAmount, formDueDate, formPaymentDate, formPaymentMethod, formNotes, formClientName, formBankAccount, formStatus, formSectorId, formInstallments, formInstallmentInterval, formRecurrence, formRecurrenceFrequency, formRecurrenceEndDate, formRecurrenceDay, formRecurrenceSecondDay, formRecurrenceLabel, formRecurrenceHolidayAdjust, formRecurrenceLateFeePct, formRecurrenceInterestPct, formAttachments, formFilesToUpload, formAttachmentsToDelete, editingTransaction, queryClient, t]);

  const handleDeleteTransaction = useCallback(async (id: string) => {
    if (!business?.id || !user) return;
    try {
      // Fetch before-state for the audit log
      const snap = await getDocs(query(collection(db, 'transactions'), where('__name__', '==', id)));
      const before = snap.docs[0]?.data() as Transaction | undefined;
      await deleteDoc(doc(db, 'transactions', id));
      if (before) {
        await logAudit(db, {
          businessId: business.id,
          entity: 'transaction',
          entityId: id,
          action: 'delete',
          actor: { uid: user.uid, name: user.name },
          before: before as unknown as Record<string, unknown>,
          amount: before.amount,
          description: before.description,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['transactions', business.id] });
      setShowDeleteConfirm(null);
      toast.success(t('financial.toast.transactionDeleted', 'Transação excluída'));
    } catch (err) {
      console.error('Error deleting transaction:', err);
      toast.error(t('financial.toast.deleteError', 'Erro ao excluir transação'));
    }
  }, [business?.id, user, queryClient, t]);

  // ---- Bank Account Handlers ----
  const openNewBankForm = useCallback(() => {
    setEditingBankAccount(null);
    setBankName('');
    setBankBankName('');
    setBankBankCode('');
    setBankAccountType('corrente');
    setBankAgency('');
    setBankAccountNumber('');
    setBankBalance('');
    setBankColor('#3B82F6');
    setBankIsMain(false);
    setShowBankForm(true);
  }, []);

  const openEditBankForm = useCallback((account: BankAccount) => {
    setEditingBankAccount(account);
    setBankName(account.name);
    setBankBankName(account.bankName);
    setBankBankCode(account.bankCode || '');
    setBankAccountType(account.accountType);
    setBankAgency(account.agency || '');
    setBankAccountNumber(account.accountNumber || '');
    setBankBalance(account.balance.toString());
    setBankColor(account.color);
    setBankIsMain(account.isMain);
    setShowBankForm(true);
  }, []);

  const handleSaveBankAccount = useCallback(async () => {
    if (!business?.id) return;
    const balance = parseFloat(bankBalance);
    if (!bankName || !bankBankName || isNaN(balance)) return;

    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const accData = {
        businessId: business.id,
        name: bankName,
        bankName: bankBankName,
        bankCode: bankBankCode || null,
        accountType: bankAccountType,
        agency: bankAgency || null,
        accountNumber: bankAccountNumber || null,
        balance,
        color: bankColor,
        isMain: bankIsMain,
        isActive: true,
        updatedAt: now,
      };

      if (editingBankAccount) {
        const docRef = doc(db, 'bankAccounts', editingBankAccount.id);
        await updateDoc(docRef, accData);
        toast.success(t('financial.toast.accountUpdated', 'Conta atualizada'));
      } else {
        await addDoc(collection(db, 'bankAccounts'), {
          ...accData,
          createdAt: now,
        });
        toast.success(t('financial.toast.accountCreated', 'Conta criada'));
      }

      queryClient.invalidateQueries({ queryKey: ['bankAccounts', business.id] });
      setShowBankForm(false);
    } catch (err) {
      console.error('Error saving bank account:', err);
      toast.error(t('financial.toast.accountSaveError', 'Erro ao salvar conta'));
    } finally {
      setIsSaving(false);
    }
  }, [business?.id, bankName, bankBankName, bankBankCode, bankAccountType, bankAgency, bankAccountNumber, bankBalance, bankColor, bankIsMain, editingBankAccount, queryClient]);

  const handleDeleteBankAccount = useCallback(async (id: string) => {
    if (!business?.id) return;
    try {
      await deleteDoc(doc(db, 'bankAccounts', id));
      queryClient.invalidateQueries({ queryKey: ['bankAccounts', business.id] });
      setShowDeleteBankConfirm(null);
      toast.success(t('financial.toast.accountDeleted', 'Conta excluída'));
    } catch (err) {
      console.error('Error deleting bank account:', err);
      toast.error(t('financial.toast.accountDeleteError', 'Erro ao excluir conta'));
    }
  }, [business?.id, queryClient]);

  // ---- UI Helpers ----
  const getStatusChipColor = (status: TransactionStatus) => {
    const map: Record<TransactionStatus, { bg: string; text: string; border: string }> = isDark ? {
      pago: { bg: 'rgba(16,185,129,0.1)', text: '#6EE7B7', border: 'rgba(16,185,129,0.2)' },
      pendente: { bg: 'rgba(245,158,11,0.1)', text: '#FCD34D', border: 'rgba(245,158,11,0.2)' },
      atrasado: { bg: 'rgba(239,68,68,0.1)', text: '#FCA5A5', border: 'rgba(239,68,68,0.2)' },
      cancelado: { bg: 'rgba(148,163,184,0.1)', text: '#94A3B8', border: 'rgba(148,163,184,0.2)' },
    } : {
      pago: { bg: '#F0FDF4', text: '#166534', border: '#BBF7D0' },
      pendente: { bg: '#FEFCE8', text: '#854D0E', border: '#FEF08A' },
      atrasado: { bg: '#FEF2F2', text: '#991B1B', border: '#FECACA' },
      cancelado: { bg: '#F8FAFC', text: '#475569', border: '#E2E8F0' },
    };
    return map[status] || map.pendente;
  };

  const statusLabel = (s: TransactionStatus) => ({
    pago: t('financial.status.paid', 'Pago'),
    pendente: t('financial.status.pending', 'Pendente'),
    atrasado: t('financial.status.overdue', 'Atrasado'),
    cancelado: t('financial.status.cancelled', 'Cancelado'),
  }[s] ?? s);

  const fmtChart = (v: number) => v >= 1000 ? `R$ ${(v / 1000).toFixed(0)}k` : `R$ ${v}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ChartTooltip = ({ active, payload, label }: any) => {
    if (active && payload?.length) {
      return (
        <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm rounded-xl border border-slate-200 dark:border-gray-700 shadow-xl p-3.5">
          <p className="text-sm font-bold text-slate-900 dark:text-gray-100 mb-2">{label}</p>
          {payload.map((e: { name: string; value: number; color: string }, i: number) => (
            <div key={i} className="flex items-center gap-2 text-sm py-0.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: e.color }} />
              <span className="text-slate-500 dark:text-gray-400">{e.name}:</span>
              <span className="font-semibold text-slate-900 dark:text-gray-100">{formatCurrency(e.value)}</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const isLoading = isLoadingTransactions || isLoadingBankAccounts;

  // ---- Loading skeleton ----
  if (isLoading) {
    return (
      <div className="max-w-[1440px] mx-auto">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="h-8 w-36 rounded-xl shimmer" />
              <div className="h-4 w-56 rounded-lg shimmer mt-2" />
            </div>
            <div className="h-10 w-40 rounded-xl shimmer" />
          </div>
          <div className="h-12 rounded-2xl shimmer" />
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, delay: i * 0.07 }}
                className="h-[120px] rounded-2xl shimmer"
              />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 h-[380px] rounded-2xl shimmer" />
            <div className="h-[380px] rounded-2xl shimmer" />
          </div>
        </motion.div>
      </div>
    );
  }

  // ==========================================
  // RENDER
  // ==========================================

  return (
    <div>
      <div className="max-w-[1440px] mx-auto">
        {/* ===== HEADER ===== */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-gray-100 tracking-tight">{t('financial.header.title', 'Financeiro')}</h1>
            <p className="text-sm text-slate-400 dark:text-gray-500 mt-0.5">{t('financial.header.subtitle', 'Gestão financeira completa')}</p>
          </div>
          <div className="flex items-center gap-3">
            <Tooltip title={alertSettings.enabled ? 'Alertas de vencimento ativos' : 'Configurar alertas de vencimento'}>
              <IconButton
                onClick={() => setShowAlertsModal(true)}
                size="small"
                sx={{ border: isDark ? '1px solid #374151' : '1px solid #E2E8F0', borderRadius: '10px', width: 36, height: 36, position: 'relative' }}
              >
                {alertSettings.enabled
                  ? <Bell size={16} className="text-emerald-500" />
                  : <BellOff size={16} className="text-slate-400 dark:text-gray-500" />}
              </IconButton>
            </Tooltip>
            <Tooltip title={showBalances ? t('financial.header.hideBalances', 'Ocultar saldos') : t('financial.header.showBalances', 'Mostrar saldos')}>
              <IconButton
                onClick={() => setShowBalances(!showBalances)}
                size="small"
                sx={{ border: isDark ? '1px solid #374151' : '1px solid #E2E8F0', borderRadius: '10px', width: 36, height: 36 }}
              >
                {showBalances ? <Eye size={16} className="text-slate-500 dark:text-gray-400" /> : <EyeOff size={16} className="text-slate-500 dark:text-gray-400" />}
              </IconButton>
            </Tooltip>
            <CurrencyToggle />
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={openNewForm}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-red-600 to-red-700 text-white rounded-xl font-semibold text-sm shadow-sm shadow-red-200 hover:shadow-md hover:shadow-red-200 transition-all"
            >
              <Plus size={18} />
              {t('financial.header.newEntry', 'Novo Lançamento')}
            </motion.button>
          </div>
        </div>

        {/* ===== TAB NAV ===== */}
        <div className="relative mb-6">
          <AnimatePresence>
            {canScrollLeft && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute left-0 top-0 bottom-0 w-12 z-10 flex items-center justify-start pointer-events-none rounded-l-2xl bg-gradient-to-r from-white dark:from-gray-900 to-transparent"
              >
                <button
                  type="button"
                  onClick={() => scrollTabsBy(-160)}
                  className="pointer-events-auto ml-1.5 w-7 h-7 rounded-full bg-white dark:bg-gray-700 shadow-md border border-gray-200 dark:border-gray-600 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div
            ref={setTabsEl}
            onScroll={checkScroll}
            className="overflow-x-auto scrollbar-hide"
          >
            <div className="flex gap-1 p-1.5 bg-white dark:bg-gray-900/80 border border-slate-200/80 dark:border-gray-800 rounded-2xl shadow-sm backdrop-blur-sm w-max min-w-full">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    'relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-200',
                    activeTab === tab.key
                      ? 'bg-gradient-to-r from-red-600 to-red-500 text-white shadow-md shadow-red-500/20'
                      : 'text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300 hover:bg-slate-50 dark:hover:bg-white/[0.04]'
                  )}
                >
                  {tab.icon}
                  {tab.label}
                  {tab.key === 'recorrentes' && urgentRecurringCount > 0 && (
                    <span className={cn(
                      'min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center leading-none',
                      activeTab === 'recorrentes' ? 'bg-white/30 text-white' : 'bg-amber-500 text-white'
                    )}>
                      {urgentRecurringCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <AnimatePresence>
            {canScrollRight && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-0 bottom-0 w-12 z-10 flex items-center justify-end pointer-events-none rounded-r-2xl bg-gradient-to-l from-white dark:from-gray-900 to-transparent"
              >
                <button
                  type="button"
                  onClick={() => scrollTabsBy(160)}
                  className="pointer-events-auto mr-1.5 w-7 h-7 rounded-full bg-white dark:bg-gray-700 shadow-md border border-gray-200 dark:border-gray-600 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ===== TAB CONTENT ===== */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4, scale: 0.998, transition: { duration: 0.15 } }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'visao-geral' && (
              <OverviewContent
                metrics={summaryMetrics}
                showBalances={showBalances}
                ChartTooltip={ChartTooltip}
                fmtChart={fmtChart}
                isDark={isDark}
                monthlyData={monthlyData}
                expenseBreakdown={expenseBreakdown}
                transactions={transactions}
                isEnterprise={isEnterprise}
                sectors={sectors}
                broadcasts={broadcasts}
                crmContacts={crmContacts}
                onGoToRecurrences={() => setActiveTab('recorrentes')}
                onMarkPaid={handleMarkAsPaid}
                onGoToDAS={() => setActiveTab('das')}
                businessId={business?.id || ''}
              />
            )}

            {activeTab === 'lancamentos' && (
              <TransactionsContent
                transactions={filteredTransactions}
                allTransactions={transactions}
                filterTab={txFilterTab}
                onFilterChange={setTxFilterTab}
                search={txSearch}
                onSearchChange={setTxSearch}
                sortField={txSortField}
                sortDir={txSortDir}
                onSort={handleTxSort}
                onMarkPaid={handleMarkAsPaid}
                onRevertPaid={handleRevertToPending}
                onEdit={openEditForm}
                onDelete={(id) => {
                  const tx = transactions.find(t => t.id === id);
                  if (tx && isTransactionLocked(tx)) {
                    toast.error('Esta transação está vinculada a um documento fiscal autorizado e não pode ser excluída.');
                    return;
                  }
                  setShowDeleteConfirm(id);
                }}
                onViewInstallments={handleOpenInstallmentGroup}
                getIsLocked={isTransactionLocked}
                getStatusChipColor={getStatusChipColor}
                statusLabel={statusLabel}
                // Advanced filters
                dateFrom={txDateFrom}    onDateFromChange={setTxDateFrom}
                dateTo={txDateTo}        onDateToChange={setTxDateTo}
                category={txCategory}   onCategoryChange={setTxCategory}
                bankAccount={txBankAccount} onBankAccountChange={setTxBankAccount}
                paymentMethod={txPaymentMethod} onPaymentMethodChange={setTxPaymentMethod}
                sectorId={txSectorId}   onSectorIdChange={setTxSectorId}
                clientName={txClientName} onClientNameChange={setTxClientName}
                availableCategories={txAvailableCategories}
                bankAccounts={bankAccounts}
                onSaveFilters={saveTxFilters}
                onClearFilters={clearTxFilters}
              />
            )}

            {activeTab === 'recorrentes' && (
              <RecurringContent
                transactions={transactions}
                showBalances={showBalances}
                businessName={business?.razaoSocial ?? ''}
                bankAccounts={bankAccounts}
                sectors={sectors}
                businessId={business?.id ?? ''}
                onEdit={openEditForm}
                onPause={handlePauseRecurrence}
                onResume={handleResumeRecurrence}
                onMarkPaid={handleMarkRecurringPaid}
                onSkip={handleSkipRecurrence}
                onEndSeries={handleEndSeries}
                onAdjustValue={handleAdjustSeriesValue}
              />
            )}

            {activeTab === 'contas' && (
              <BankAccountsContent
                accounts={bankAccounts}
                showBalances={showBalances}
                onAdd={openNewBankForm}
                onEdit={openEditBankForm}
                onDelete={(id) => setShowDeleteBankConfirm(id)}
              />
            )}

            {activeTab === 'fluxo' && (
              <CashFlowProjection transactions={transactions} bankAccounts={bankAccounts} businessName={business?.razaoSocial ?? ''} />
            )}

            {activeTab === 'dre' && (
              <DREContent transactions={transactions} businessName={business?.razaoSocial || business?.nomeFantasia || 'Empresa'} />
            )}

            {activeTab === 'auditoria' && (
              <AuditLogView businessId={business?.id} />
            )}

            {activeTab === 'comissoes' && (
              <CommissionsContent
                transactions={transactions}
                onMarkPaid={handleMarkAsPaid}
                showBalances={showBalances}
                businessName={business?.razaoSocial ?? ''}
              />
            )}

            {activeTab === 'orcamento' && (
              <BudgetContent
                transactions={transactions}
                businessId={business?.id || ''}
              />
            )}

            {activeTab === 'das' && (
              <DASContent
                transactions={transactions}
                businessId={business?.id || ''}
              />
            )}

            {activeTab === 'conciliacao' && (
              <ConciliacaoTab
                businessId={business?.id || ''}
                transactions={transactions}
                bankAccounts={bankAccounts}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ===== TRANSACTION FORM DIALOG ===== */}
      <Dialog
        open={showForm}
        onClose={() => setShowForm(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: '20px', maxHeight: '90vh', backgroundColor: isDark ? '#111827' : undefined } }}
      >
        {/* Custom header with type-color accent */}
        <div className={cn(
          'flex items-center justify-between px-6 pt-5 pb-4 border-b transition-colors duration-200',
          formType === 'receita'
            ? 'border-emerald-100 dark:border-emerald-900/40'
            : 'border-red-100 dark:border-red-900/40',
          isDark ? 'bg-gray-900' : 'bg-white'
        )}>
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-9 h-9 rounded-xl flex items-center justify-center',
              formType === 'receita'
                ? 'bg-emerald-100 dark:bg-emerald-900/40'
                : 'bg-red-100 dark:bg-red-900/40'
            )}>
              {formType === 'receita'
                ? <ArrowUpRight size={18} className="text-emerald-600 dark:text-emerald-400" />
                : <ArrowDownRight size={18} className="text-red-600 dark:text-red-400" />}
            </div>
            <h2 className="text-base font-bold font-display text-gray-900 dark:text-gray-100">
              {editingTransaction ? t('financial.form.editTransaction', 'Editar Transação') : t('financial.form.newTransaction', 'Nova Transação')}
            </h2>
          </div>
          <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <X size={18} className="text-gray-400 dark:text-gray-500" />
          </button>
        </div>

        {/* Série recorrente banner — visível apenas ao editar transação com recorrência ativa */}
        {editingTransaction?.recurrence?.isActive && (
          <div className="mx-6 mb-1 mt-0 px-3 py-2 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 flex items-center gap-2">
            <Repeat size={14} className="text-blue-500 dark:text-blue-400 shrink-0" />
            <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
              Lançamento recorrente —{' '}
              <strong>{RECURRENCE_LABELS[editingTransaction.recurrence.frequency] ?? editingTransaction.recurrence.frequency}</strong>
              {editingTransaction.recurrence.dayOfMonth ? `, dia ${editingTransaction.recurrence.dayOfMonth}` : ''}
            </span>
          </div>
        )}

        <DialogContent sx={{ pt: 2.5, pb: 2 }}>
          <div className="space-y-4">

            {/* ── Tipo ─────────────────────────────────────────────── */}
            <div className={cn(
              'flex rounded-2xl p-1 border transition-colors duration-200',
              formType === 'receita'
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/40'
                : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/40'
            )}>
              {([
                { value: 'receita', label: t('financial.form.income', 'Receita'), Icon: ArrowUpRight, color: 'text-emerald-700 dark:text-emerald-400' },
                { value: 'despesa', label: t('financial.form.expense', 'Despesa'), Icon: ArrowDownRight, color: 'text-red-600 dark:text-red-400' },
              ] as const).map(({ value, label, Icon, color }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFormType(value)}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200',
                    formType === value
                      ? cn('bg-white dark:bg-gray-900 shadow-sm', color)
                      : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
                  )}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </div>

            {/* ── Valor (destaque) ─────────────────────────────────── */}
            <div className={cn(
              'rounded-2xl px-4 py-3 border transition-colors duration-200',
              formType === 'receita'
                ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40'
                : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800/40'
            )}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1">Valor *</p>
              <div className="flex items-center gap-2">
                <span className={cn('text-xl font-bold leading-none', formType === 'receita' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>R$</span>
                <input
                  type="number"
                  value={formAmount}
                  onChange={e => setFormAmount(e.target.value)}
                  placeholder="0,00"
                  className="flex-1 bg-transparent text-2xl font-bold outline-none text-gray-900 dark:text-gray-100 placeholder-gray-200 dark:placeholder-gray-700 min-w-0"
                />
              </div>
            </div>

            {/* ── Descrição ─────────────────────────────────────────── */}
            <TextField label={t('financial.form.description', 'Descrição *')} value={formDescription} onChange={(e) => setFormDescription(e.target.value)} fullWidth required size="small" sx={inputSx} />

            {/* ── Categorização ─────────────────────────────────────── */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2 px-0.5">Categoria</p>
              <FormControl fullWidth size="small">
                <InputLabel>{t('financial.form.category', 'Categoria')}</InputLabel>
                <Select value={formCategory} onChange={(e) => setFormCategory(e.target.value)} label={t('financial.form.category', 'Categoria')} sx={{ borderRadius: '12px' }}>
                  {(formType === 'receita' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
                    <MenuItem key={c} value={c}>{c}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </div>

            {/* ── Datas ─────────────────────────────────────────────── */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2 px-0.5">Datas</p>
              <div className="grid grid-cols-2 gap-3">
                <TextField label={t('financial.form.dueDate', 'Vencimento')} type="date" value={formDueDate} onChange={(e) => setFormDueDate(e.target.value)} fullWidth required size="small" InputLabelProps={{ shrink: true }} sx={inputSx} />
                <TextField label={t('financial.form.paymentDate', 'Pagamento')} type="date" value={formPaymentDate} onChange={(e) => setFormPaymentDate(e.target.value)} fullWidth size="small" InputLabelProps={{ shrink: true }} sx={inputSx}
                  helperText={t('financial.form.paymentDateHelper', 'Preencha se já foi pago')}
                />
              </div>
            </div>

            {/* ── Status e Pagamento ─────────────────────────────────── */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2 px-0.5">Pagamento</p>
              <div className="grid grid-cols-2 gap-3">
                <FormControl fullWidth size="small">
                  <InputLabel>{t('financial.form.status', 'Status')}</InputLabel>
                  <Select value={formStatus} onChange={(e) => setFormStatus(e.target.value as TransactionStatus)} label={t('financial.form.status', 'Status')} sx={{ borderRadius: '12px' }}>
                    <MenuItem value="pendente">{t('financial.status.pending', 'Pendente')}</MenuItem>
                    <MenuItem value="pago">{t('financial.status.paid', 'Pago')}</MenuItem>
                    <MenuItem value="atrasado">{t('financial.status.overdue', 'Atrasado')}</MenuItem>
                    <MenuItem value="cancelado">{t('financial.status.cancelled', 'Cancelado')}</MenuItem>
                  </Select>
                </FormControl>
                <FormControl fullWidth size="small">
                  <InputLabel>{t('financial.form.paymentMethod', 'Forma de Pagamento')}</InputLabel>
                  <Select value={formPaymentMethod} onChange={(e) => setFormPaymentMethod(e.target.value as PaymentMethod | '')} label={t('financial.form.paymentMethod', 'Forma de Pagamento')} sx={{ borderRadius: '12px' }}>
                    <MenuItem value=""><em>-</em></MenuItem>
                    {PAYMENT_METHODS.map((pm) => (<MenuItem key={pm.value} value={pm.value}>{pm.label}</MenuItem>))}
                  </Select>
                </FormControl>
              </div>
            </div>

            {/* ── Opcionais ─────────────────────────────────────────── */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2 px-0.5">Opcionais</p>
              <div className="grid grid-cols-2 gap-3">
                <TextField label={t('financial.form.clientOptional', 'Cliente')} value={formClientName} onChange={(e) => setFormClientName(e.target.value)} fullWidth size="small" sx={inputSx} />
                <FormControl fullWidth size="small">
                  <InputLabel>{t('financial.form.bankAccount', 'Conta Bancária')}</InputLabel>
                  <Select value={formBankAccount} onChange={(e) => setFormBankAccount(e.target.value)} label={t('financial.form.bankAccount', 'Conta Bancária')} sx={{ borderRadius: '12px' }}>
                    <MenuItem value=""><em>-</em></MenuItem>
                    {bankAccounts.filter((a) => a.isActive).map((a) => (<MenuItem key={a.id} value={a.id}>{a.name} - {a.bankName}</MenuItem>))}
                  </Select>
                </FormControl>
              </div>
            </div>

            {isEnterprise && sectors.length > 0 && (
              <FormControl fullWidth size="small">
                <InputLabel>{t('financial.form.sectorOptional', 'Setor (opcional)')}</InputLabel>
                <Select value={formSectorId} onChange={(e) => setFormSectorId(e.target.value)} label={t('financial.form.sectorOptional', 'Setor (opcional)')} sx={{ borderRadius: '12px' }}>
                  <MenuItem value=""><em>{t('financial.form.none', 'Nenhum')}</em></MenuItem>
                  {sectors.filter(s => s.isActive).map((s) => (
                    <MenuItem key={s.id} value={s.id}>
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                        {s.name}
                      </div>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {/* Parcelamento — apenas ao criar (não edita série existente aqui) */}
            {!editingTransaction && (
              <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700">
                <TextField
                  label="Parcelas"
                  type="number"
                  value={formInstallments}
                  onChange={(e) => setFormInstallments(Math.max(1, Math.min(36, Number(e.target.value) || 1)))}
                  inputProps={{ min: 1, max: 36 }}
                  size="small"
                  helperText={formInstallments > 1 ? `${formInstallments}× de ${formAmount ? formatCurrency(parseFloat(formAmount) / formInstallments) : '—'}` : 'À vista'}
                  sx={inputSx}
                />
                {formInstallments > 1 && (
                  <FormControl size="small">
                    <InputLabel>Intervalo</InputLabel>
                    <Select
                      value={formInstallmentInterval}
                      onChange={(e) => setFormInstallmentInterval(e.target.value as 'monthly' | 'weekly')}
                      label="Intervalo"
                      sx={{ borderRadius: '12px' }}
                    >
                      <MenuItem value="monthly">Mensal</MenuItem>
                      <MenuItem value="weekly">Semanal</MenuItem>
                    </Select>
                  </FormControl>
                )}
              </div>
            )}

            {/* Recorrência — apenas transação simples (não parcelada) */}
            {formInstallments <= 1 && (
              <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 space-y-3">
                <button
                  type="button"
                  onClick={() => setFormRecurrence(!formRecurrence)}
                  className={cn(
                    'flex items-center gap-2 text-sm font-medium transition-colors',
                    formRecurrence ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  )}
                >
                  <Repeat className="w-4 h-4" />
                  {t('financial.form.recurrence', 'Lançamento recorrente')}
                  <div className={cn(
                    'ml-auto w-8 h-4.5 rounded-full transition-colors relative',
                    formRecurrence ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600'
                  )}>
                    <div className={cn(
                      'absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform',
                      formRecurrence ? 'translate-x-4' : 'translate-x-0.5'
                    )} />
                  </div>
                </button>
                {formRecurrence && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <FormControl size="small">
                        <InputLabel>{t('financial.form.frequency', 'Frequência')}</InputLabel>
                        <Select
                          value={formRecurrenceFrequency}
                          onChange={(e) => setFormRecurrenceFrequency(e.target.value as typeof formRecurrenceFrequency)}
                          label={t('financial.form.frequency', 'Frequência')}
                          sx={{ borderRadius: '12px' }}
                        >
                          {Object.entries(RECURRENCE_LABELS).map(([k, v]) => (
                            <MenuItem key={k} value={k}>{v}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <TextField
                        label={t('financial.form.recurrenceEnd', 'Encerrar em')}
                        type="date"
                        value={formRecurrenceEndDate}
                        onChange={(e) => setFormRecurrenceEndDate(e.target.value)}
                        size="small"
                        InputLabelProps={{ shrink: true }}
                        helperText={!formRecurrenceEndDate ? 'Sem data de encerramento' : ''}
                        sx={inputSx}
                      />
                    </div>
                    {['monthly', 'quarterly', 'semiannual', 'yearly', 'biweekly_fixed'].includes(formRecurrenceFrequency) && (
                      <div className="space-y-3 bg-slate-50 dark:bg-gray-800/50 p-3 rounded-xl border border-slate-100 dark:border-gray-800">
                        {formRecurrenceFrequency !== 'biweekly_fixed' && (
                          <TextField
                            label="Nome da Recorrência (Opcional)"
                            value={formRecurrenceLabel}
                            onChange={(e) => setFormRecurrenceLabel(e.target.value)}
                            size="small"
                            placeholder="Ex: Aluguel, Internet..."
                            fullWidth
                            sx={inputSx}
                          />
                        )}
                        <div className="grid grid-cols-2 gap-3">
                          <TextField
                            label={formRecurrenceFrequency === 'biweekly_fixed' ? '1º Dia do mês' : 'Dia Fixo de Vencimento'}
                            type="number"
                            value={formRecurrenceDay}
                            onChange={(e) => setFormRecurrenceDay(e.target.value)}
                            size="small"
                            inputProps={{ min: 1, max: 28 }}
                            placeholder="Ex: 5"
                            helperText={formRecurrenceFrequency === 'biweekly_fixed' ? '' : 'Se vazio, usa o dia da primeira parcela'}
                            sx={inputSx}
                          />
                          {formRecurrenceFrequency === 'biweekly_fixed' && (
                            <TextField
                              label="2º Dia do mês"
                              type="number"
                              value={formRecurrenceSecondDay}
                              onChange={(e) => setFormRecurrenceSecondDay(e.target.value)}
                              size="small"
                              inputProps={{ min: 1, max: 28 }}
                              placeholder="Ex: 15"
                              helperText="Ex: 1 e 15, 5 e 20"
                              sx={inputSx}
                            />
                          )}
                        </div>
                      </div>
                    )}

                    {/* FIN-R17: Ajuste de vencimento para dia útil */}
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-slate-600 dark:text-gray-400">Vencimento em feriado / fim de semana</p>
                      <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-gray-800 rounded-xl w-fit">
                        {(['none', 'before', 'after'] as const).map((opt) => {
                          const labels = { none: 'Manter', before: 'Antecipar', after: 'Postergar' };
                          return (
                            <button key={opt} type="button" onClick={() => setFormRecurrenceHolidayAdjust(opt)}
                              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                                formRecurrenceHolidayAdjust === opt
                                  ? 'bg-white dark:bg-gray-700 text-red-600 dark:text-red-400 shadow-sm'
                                  : 'text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200'
                              )}
                            >{labels[opt]}</button>
                          );
                        })}
                      </div>
                    </div>

                    {/* FIN-R18: Multa e juros por atraso (apenas receitas) */}
                    {formType === 'receita' && (
                      <div className="grid grid-cols-2 gap-3">
                        <TextField
                          label="Multa por atraso (%)"
                          type="number"
                          value={formRecurrenceLateFeePct}
                          onChange={(e) => setFormRecurrenceLateFeePct(e.target.value)}
                          size="small"
                          inputProps={{ min: 0, max: 100, step: 0.1 }}
                          placeholder="Ex: 2"
                          helperText="% sobre o valor (único)"
                          sx={inputSx}
                        />
                        <TextField
                          label="Juros ao mês (%)"
                          type="number"
                          value={formRecurrenceInterestPct}
                          onChange={(e) => setFormRecurrenceInterestPct(e.target.value)}
                          size="small"
                          inputProps={{ min: 0, max: 100, step: 0.01 }}
                          placeholder="Ex: 1"
                          helperText="% a.m. pro-rata em dias"
                          sx={inputSx}
                        />
                      </div>
                    )}

                    {/* Preview das próximas ocorrências */}
                    {(() => {
                      const base = formDueDate || formPaymentDate || new Date().toISOString().slice(0, 10);
                      const dayNum = formRecurrenceDay ? Math.min(parseInt(formRecurrenceDay, 10), 28) : undefined;
                      const secondDayNum = formRecurrenceSecondDay ? Math.min(parseInt(formRecurrenceSecondDay, 10), 28) : undefined;
                      const dates: string[] = [];
                      let cur = base;
                      for (let i = 0; i < 5; i++) {
                        cur = computeNextDueDate(cur, formRecurrenceFrequency, dayNum, secondDayNum);
                        if (formRecurrenceEndDate && cur > formRecurrenceEndDate) break;
                        dates.push(cur);
                      }
                      if (!dates.length) return null;
                      return (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wider shrink-0">Próximas:</span>
                          {dates.map((d, i) => (
                            <span key={i} className="text-[11px] font-medium text-slate-600 dark:text-gray-300 bg-slate-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                              {d.slice(5).replace('-', '/')}/{d.slice(2, 4)}
                            </span>
                          ))}
                          {!formRecurrenceEndDate && <span className="text-[10px] text-slate-400 dark:text-gray-500">…</span>}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            <TextField label={t('financial.form.notes', 'Observações')} value={formNotes} onChange={(e) => setFormNotes(e.target.value)} fullWidth multiline rows={2} size="small" sx={inputSx} />
            
            {/* --- Anexos --- */}
            <div className="mt-4 border border-slate-200 dark:border-gray-700 rounded-xl p-4 bg-slate-50 dark:bg-gray-800/50">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Paperclip size={16} className="text-slate-500 dark:text-gray-400" />
                  <span className="text-sm font-semibold text-slate-700 dark:text-gray-300">Anexos e Comprovantes</span>
                </div>
                <div className="flex items-center gap-2">
                  <Tooltip title="Em breve: extrair dados do comprovante via OCR (Google Cloud Vision)">
                    <span>
                      <Button
                        size="small"
                        variant="outlined"
                        disabled
                        startIcon={<FileText size={13} />}
                        sx={{ textTransform: 'none', borderRadius: '8px', opacity: 0.45, fontSize: '0.7rem' }}
                      >
                        Auto-detectar OCR
                      </Button>
                    </span>
                  </Tooltip>
                <Button component="label" size="small" variant="outlined" sx={{ textTransform: 'none', borderRadius: '8px' }}>
                  Adicionar
                  <input
                    type="file"
                    multiple
                    hidden
                    accept="image/*,.pdf,.jpg,.jpeg,.png"
                    onChange={(e) => {
                      if (!e.target.files) return;
                      const MAX_MB = 10;
                      const valid: File[] = [];
                      for (const file of Array.from(e.target.files)) {
                        if (file.size > MAX_MB * 1024 * 1024) {
                          toast.error(`"${file.name}" excede ${MAX_MB}MB e não foi adicionado.`);
                        } else {
                          valid.push(file);
                        }
                      }
                      if (valid.length) setFormFilesToUpload(prev => [...prev, ...valid]);
                      e.target.value = '';
                    }}
                  />
                </Button>
                </div>
              </div>
              
              <div className="space-y-2">
                {formAttachments.filter(a => !formAttachmentsToDelete.includes(a)).map(att => (
                  <div key={att.id} className="flex items-center justify-between bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 p-2 rounded-lg">
                    <div className="flex items-center gap-2 overflow-hidden pr-2">
                      {att.type?.includes('image') ? <ImageIcon size={16} className="text-blue-500 shrink-0" /> : <FileText size={16} className="text-red-500 shrink-0" />}
                      <a href={att.url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline truncate">{att.name}</a>
                    </div>
                    <IconButton size="small" onClick={() => setFormAttachmentsToDelete(prev => [...prev, att])}>
                      <X size={14} className="text-slate-400 hover:text-red-500 transition-colors" />
                    </IconButton>
                  </div>
                ))}
                {formFilesToUpload.map((f, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 p-2 rounded-lg">
                    <div className="flex items-center gap-2 overflow-hidden pr-2">
                      {f.type?.includes('image') ? <ImageIcon size={16} className="text-slate-400 shrink-0" /> : <FileText size={16} className="text-slate-400 shrink-0" />}
                      <span className="text-xs text-slate-600 dark:text-gray-400 truncate">{f.name}</span>
                      <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-gray-800 px-1.5 py-0.5 rounded shrink-0">novo</span>
                    </div>
                    <IconButton size="small" onClick={() => setFormFilesToUpload(prev => prev.filter((_, i) => i !== idx))}>
                      <X size={14} className="text-slate-400 hover:text-red-500 transition-colors" />
                    </IconButton>
                  </div>
                ))}
                {formAttachments.filter(a => !formAttachmentsToDelete.includes(a)).length === 0 && formFilesToUpload.length === 0 && (
                  <p className="text-xs text-slate-400 dark:text-gray-500 text-center py-2">Nenhum anexo adicionado</p>
                )}
              </div>
            </div>

          </div>
        </DialogContent>
        <div className={cn(
          'flex items-center justify-between px-6 py-4 border-t',
          isDark ? 'border-gray-800 bg-gray-900' : 'border-gray-100 bg-white'
        )}>
          <button
            onClick={() => setShowForm(false)}
            className="px-5 py-2 rounded-xl text-sm font-semibold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            {t('financial.form.cancel', 'Cancelar')}
          </button>
          <button
            onClick={() => {
              if (editingTransaction?.recurrence?.isActive) {
                setShowScopeDialog(true);
              } else {
                handleSaveTransaction('all');
              }
            }}
            disabled={!formDescription || !formAmount || parseFloat(formAmount) <= 0 || isSaving}
            className={cn(
              'flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold text-white transition-all',
              formType === 'receita'
                ? 'bg-emerald-600 hover:bg-emerald-700 shadow-sm shadow-emerald-200 dark:shadow-emerald-900/30'
                : 'bg-red-600 hover:bg-red-700 shadow-sm shadow-red-200 dark:shadow-red-900/30',
              (!formDescription || !formAmount || parseFloat(formAmount) <= 0 || isSaving) && 'opacity-40 cursor-not-allowed'
            )}
          >
            {isSaving ? (
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}
                className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
            ) : (
              formType === 'receita' ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />
            )}
            {isSaving ? t('financial.form.saving', 'Salvando...') : editingTransaction ? t('financial.form.save', 'Salvar') : t('financial.form.createTransaction', 'Criar Transação')}
          </button>
        </div>
      </Dialog>

      {/* ===== SCOPE DIALOG — editar série recorrente ===== */}
      <Dialog
        open={showScopeDialog}
        onClose={() => setShowScopeDialog(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: '20px', backgroundColor: isDark ? '#111827' : undefined } }}
      >
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
              <Repeat size={18} className="text-blue-500 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-base font-bold font-display text-gray-900 dark:text-gray-100">Editar série recorrente</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">O que você deseja alterar?</p>
            </div>
          </div>

          <div className="space-y-2">
            <button
              onClick={() => { setShowScopeDialog(false); handleSaveTransaction('this_only'); }}
              className="w-full flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-gray-800 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-sm font-bold text-slate-500 dark:text-gray-400">1</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Apenas este vencimento</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Cria uma cópia avulsa com as alterações. A série original continua inalterada.</p>
              </div>
            </button>

            <button
              onClick={() => { setShowScopeDialog(false); handleSaveTransaction('all'); }}
              className="w-full flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-gray-800 flex items-center justify-center shrink-0 mt-0.5">
                <Repeat size={14} className="text-slate-500 dark:text-gray-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Este e todos os seguintes</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Atualiza a série — todos os vencimentos futuros usarão os novos valores.</p>
              </div>
            </button>
          </div>

          <button
            onClick={() => setShowScopeDialog(false)}
            className="w-full text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors py-1"
          >
            Cancelar
          </button>
        </div>
      </Dialog>

      {/* ===== FINANCIAL ALERTS MODAL ===== */}
      <Dialog
        open={showAlertsModal}
        onClose={() => setShowAlertsModal(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: '20px', backgroundColor: isDark ? '#111827' : undefined } }}
      >
        <DialogTitle sx={{ fontFamily: '"Plus Jakarta Sans", sans-serif', fontWeight: 700, color: isDark ? '#F1F5F9' : undefined, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Bell size={18} className="text-emerald-500" />
          Alertas de Vencimento
        </DialogTitle>
        <DialogContent>
          <div className="space-y-5 pt-1">
            {/* Enable toggle */}
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm font-semibold text-slate-700 dark:text-gray-300">Ativar notificações automáticas</span>
              <button
                type="button"
                onClick={() => setAlertSettings(s => ({ ...s, enabled: !s.enabled }))}
                className={`relative w-11 h-6 rounded-full transition-colors ${alertSettings.enabled ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-gray-700'}`}
              >
                <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${alertSettings.enabled ? 'translate-x-5' : ''}`} />
              </button>
            </label>

            {alertSettings.enabled && (
              <>
                {/* Days before */}
                <div>
                  <p className="text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wide mb-2">Avisar com antecedência</p>
                  <div className="flex gap-2">
                    {[1, 2, 3, 7].map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setAlertSettings(s => ({ ...s, dueSoonDays: d }))}
                        className={`flex-1 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${alertSettings.dueSoonDays === d ? 'bg-emerald-500 text-white border-emerald-500' : 'border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:border-emerald-300'}`}
                      >
                        {d}d
                      </button>
                    ))}
                  </div>
                </div>

                {/* Channels */}
                <div>
                  <p className="text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wide mb-2">Canais de envio</p>
                  <div className="space-y-2">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={alertSettings.sendWhatsApp}
                        onChange={e => setAlertSettings(s => ({ ...s, sendWhatsApp: e.target.checked }))}
                        className="w-4 h-4 accent-emerald-500"
                      />
                      <span className="text-sm text-slate-700 dark:text-gray-300">WhatsApp (via conversa existente)</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={alertSettings.sendEmail}
                        onChange={e => setAlertSettings(s => ({ ...s, sendEmail: e.target.checked }))}
                        className="w-4 h-4 accent-emerald-500"
                      />
                      <span className="text-sm text-slate-700 dark:text-gray-300">E-mail via Resend</span>
                      {!business?.enterprise?.integrations?.find(i => i.provider === 'resend' && i.isActive) && (
                        <span className="text-xs text-amber-500 font-medium">(requer integração)</span>
                      )}
                    </label>
                  </div>
                </div>

                {/* Types */}
                <div>
                  <p className="text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wide mb-2">Tipo de transação</p>
                  <div className="space-y-2">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={alertSettings.notifyPayable}
                        onChange={e => setAlertSettings(s => ({ ...s, notifyPayable: e.target.checked }))}
                        className="w-4 h-4 accent-emerald-500"
                      />
                      <span className="text-sm text-slate-700 dark:text-gray-300">Contas a pagar (lembrete interno)</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={alertSettings.notifyReceivable}
                        onChange={e => setAlertSettings(s => ({ ...s, notifyReceivable: e.target.checked }))}
                        className="w-4 h-4 accent-emerald-500"
                      />
                      <span className="text-sm text-slate-700 dark:text-gray-300">Contas a receber (cobrança de clientes)</span>
                    </label>
                  </div>
                </div>
              </>
            )}

            <p className="text-xs text-slate-400 dark:text-gray-500">
              Notificações são enviadas automaticamente pelo sistema (cron horário). Clientes só são notificados se houver uma conversa ativa vinculada.
            </p>
          </div>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
          <Button onClick={() => setShowAlertsModal(false)} sx={{ color: '#64748B', textTransform: 'none', fontWeight: 600, borderRadius: '12px' }}>Cancelar</Button>
          <Button
            onClick={handleSaveAlerts}
            disabled={isSavingAlerts}
            variant="contained"
            sx={{ backgroundColor: '#10B981', '&:hover': { backgroundColor: '#059669' }, borderRadius: '12px', textTransform: 'none', fontWeight: 700 }}
          >
            {isSavingAlerts ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ===== INSTALLMENT GROUP DIALOG ===== */}
      {installmentGroupId && (
        <InstallmentGroupDialog
          groupTxs={installmentGroupTxs}
          isLoading={isLoadingGroup}
          showBalances={showBalances}
          onClose={() => setInstallmentGroupId(null)}
          onUpdateDate={handleUpdateInstallmentDate}
          onMarkPaid={handleMarkInstallmentPaid}
          onCancel={handleCancelInstallment}
          onPayAll={handlePayAllPendingInstallments}
        />
      )}

      {/* ===== DELETE TRANSACTION CONFIRM ===== */}
      <Dialog
        open={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: '20px', backgroundColor: isDark ? '#111827' : undefined } }}
      >
        <DialogTitle sx={{ fontFamily: '"Plus Jakarta Sans", sans-serif', fontWeight: 700, color: isDark ? '#F1F5F9' : undefined }}>
          {t('financial.deleteTransaction.title', 'Excluir Transação')}
        </DialogTitle>
        <DialogContent>
          <p className="text-sm text-slate-600 dark:text-gray-400">
            {t('financial.deleteTransaction.confirm', 'Tem certeza que deseja excluir esta transação? Esta ação não pode ser desfeita.')}
          </p>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setShowDeleteConfirm(null)} sx={{ color: '#64748B', textTransform: 'none', fontWeight: 600, borderRadius: '12px' }}>{t('financial.form.cancel', 'Cancelar')}</Button>
          <Button onClick={() => showDeleteConfirm && handleDeleteTransaction(showDeleteConfirm)} variant="contained"
            sx={{ backgroundColor: '#DC2626', '&:hover': { backgroundColor: '#B91C1C' }, borderRadius: '12px', textTransform: 'none', fontWeight: 700 }}
          >
            {t('financial.form.delete', 'Excluir')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ===== BANK ACCOUNT FORM DIALOG ===== */}
      <Dialog
        open={showBankForm}
        onClose={() => setShowBankForm(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: '20px', maxHeight: '90vh', backgroundColor: isDark ? '#111827' : undefined } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1, fontFamily: '"Plus Jakarta Sans", sans-serif', fontWeight: 700, color: isDark ? '#F1F5F9' : undefined }}>
          <span>{editingBankAccount ? t('financial.bankForm.editAccount', 'Editar Conta') : t('financial.bankForm.newAccount', 'Nova Conta Bancária')}</span>
          <IconButton onClick={() => setShowBankForm(false)} size="small"><X size={20} className={isDark ? 'text-gray-400' : ''} /></IconButton>
        </DialogTitle>
        <Divider />
        <DialogContent sx={{ pt: 3 }}>
          <div className="space-y-4">
            <TextField label={t('financial.bankForm.accountName', 'Nome da Conta')} value={bankName} onChange={(e) => setBankName(e.target.value)} fullWidth required size="small" sx={inputSx}
              placeholder={t('financial.bankForm.accountNamePlaceholder', 'Ex: Conta Principal')}
            />

            <div className="grid grid-cols-2 gap-3">
              <TextField label={t('financial.bankForm.bankName', 'Nome do Banco')} value={bankBankName} onChange={(e) => setBankBankName(e.target.value)} fullWidth required size="small" sx={inputSx}
                placeholder={t('financial.bankForm.bankNamePlaceholder', 'Ex: Nubank')}
              />
              <TextField label={t('financial.bankForm.bankCode', 'Código do Banco')} value={bankBankCode} onChange={(e) => setBankBankCode(e.target.value)} fullWidth size="small" sx={inputSx}
                placeholder={t('financial.bankForm.bankCodePlaceholder', 'Ex: 260')}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormControl fullWidth size="small">
                <InputLabel>{t('financial.bankForm.accountType', 'Tipo de Conta')}</InputLabel>
                <Select value={bankAccountType} onChange={(e) => setBankAccountType(e.target.value as BankAccountType)} label={t('financial.bankForm.accountType', 'Tipo de Conta')} sx={{ borderRadius: '12px' }}>
                  {ACCOUNT_TYPES.map((at) => (<MenuItem key={at.value} value={at.value}>{at.label}</MenuItem>))}
                </Select>
              </FormControl>
              <TextField label={t('financial.bankForm.initialBalance', 'Saldo Inicial')} value={bankBalance} onChange={(e) => setBankBalance(e.target.value)} type="number" fullWidth required size="small"
                InputProps={{ startAdornment: <InputAdornment position="start"><span className="text-sm text-slate-400">R$</span></InputAdornment> }}
                sx={inputSx}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <TextField label={t('financial.bankForm.agency', 'Agência')} value={bankAgency} onChange={(e) => setBankAgency(e.target.value)} fullWidth size="small" sx={inputSx} />
              <TextField label={t('financial.bankForm.accountNumber', 'Número da Conta')} value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} fullWidth size="small" sx={inputSx} />
            </div>

            {/* Color picker */}
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-2">{t('financial.bankForm.accountColor', 'Cor da Conta')}</p>
              <div className="flex gap-2 flex-wrap">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => setBankColor(color)}
                    className={cn(
                      'w-8 h-8 rounded-lg transition-all duration-150',
                      bankColor === color ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-900 scale-110' : 'hover:scale-105'
                    )}
                    style={{ backgroundColor: color, '--tw-ring-color': color } as React.CSSProperties}
                  />
                ))}
              </div>
            </div>

            {/* Main account toggle */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-white/[0.04] border border-slate-100 dark:border-gray-800">
              <div>
                <p className="text-sm font-medium text-slate-700 dark:text-gray-300">{t('financial.bankForm.mainAccount', 'Conta Principal')}</p>
                <p className="text-xs text-slate-400 dark:text-gray-500">{t('financial.bankForm.mainAccountDesc', 'Definir como conta principal da empresa')}</p>
              </div>
              <button
                onClick={() => setBankIsMain(!bankIsMain)}
                className={cn(
                  'relative w-11 h-6 rounded-full transition-colors duration-200',
                  bankIsMain ? 'bg-red-500' : 'bg-slate-300 dark:bg-gray-600'
                )}
              >
                <div className={cn(
                  'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200',
                  bankIsMain ? 'translate-x-[22px]' : 'translate-x-0.5'
                )} />
              </button>
            </div>
          </div>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setShowBankForm(false)} sx={{ color: '#64748B', textTransform: 'none', fontWeight: 600, borderRadius: '12px' }}>{t('financial.form.cancel', 'Cancelar')}</Button>
          <Button onClick={handleSaveBankAccount} variant="contained" disabled={!bankName || !bankBankName || !bankBalance || isSaving}
            sx={{ backgroundColor: '#DC2626', '&:hover': { backgroundColor: '#B91C1C' }, '&.Mui-disabled': { backgroundColor: '#FCA5A5', color: '#fff' }, borderRadius: '12px', textTransform: 'none', fontWeight: 700, px: 4 }}
          >
            {isSaving ? t('financial.form.saving', 'Salvando...') : editingBankAccount ? t('financial.form.save', 'Salvar') : t('financial.bankForm.createAccount', 'Criar Conta')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ===== DELETE BANK ACCOUNT CONFIRM ===== */}
      <Dialog
        open={!!showDeleteBankConfirm}
        onClose={() => setShowDeleteBankConfirm(null)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: '20px', backgroundColor: isDark ? '#111827' : undefined } }}
      >
        <DialogTitle sx={{ fontFamily: '"Plus Jakarta Sans", sans-serif', fontWeight: 700, color: isDark ? '#F1F5F9' : undefined }}>
          {t('financial.deleteAccount.title', 'Excluir Conta Bancária')}
        </DialogTitle>
        <DialogContent>
          <p className="text-sm text-slate-600 dark:text-gray-400">
            {t('financial.deleteAccount.confirm', 'Tem certeza que deseja excluir esta conta bancária? Esta ação não pode ser desfeita.')}
          </p>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setShowDeleteBankConfirm(null)} sx={{ color: '#64748B', textTransform: 'none', fontWeight: 600, borderRadius: '12px' }}>{t('financial.form.cancel', 'Cancelar')}</Button>
          <Button onClick={() => showDeleteBankConfirm && handleDeleteBankAccount(showDeleteBankConfirm)} variant="contained"
            sx={{ backgroundColor: '#DC2626', '&:hover': { backgroundColor: '#B91C1C' }, borderRadius: '12px', textTransform: 'none', fontWeight: 700 }}
          >
            {t('financial.form.delete', 'Excluir')}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

// ==========================================
// TAB: VISAO GERAL
// ==========================================

type DashboardPeriod = '30d' | '3m' | '6m' | '12m' | 'month';

function OverviewContent({
  metrics,
  showBalances,
  ChartTooltip,
  fmtChart,
  isDark,
  monthlyData,
  expenseBreakdown,
  transactions,
  isEnterprise,
  sectors,
  broadcasts,
  crmContacts,
  onGoToRecurrences,
  onMarkPaid,
  onGoToDAS,
  businessId: overviewBusinessId,
}: {
  metrics: { receitas: number; despesas: number; lucro: number; aReceber: number; aPagar: number; totalContas: number };
  showBalances: boolean;
  ChartTooltip: React.FC;
  fmtChart: (v: number) => string;
  isDark: boolean;
  monthlyData: { month: string; receitas: number; despesas: number; receitasPrevisto: number; despesasPrevisto: number; saldo: number }[];
  expenseBreakdown: { name: string; amount: number; color: string; percentage: number }[];
  transactions: Transaction[];
  isEnterprise: boolean;
  sectors: Sector[];
  broadcasts: Broadcast[];
  crmContacts: CRMContact[];
  onGoToRecurrences?: () => void;
  onMarkPaid: (id: string) => void;
  onGoToDAS: () => void;
  businessId: string;
}) {
  const formatCurrency = useCurrencyFormat();
  const { t } = useTranslation();
  const hiddenValue = '******';
  const [dashboardPeriod, setDashboardPeriod] = useState<DashboardPeriod>('30d');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [agingType, setAgingType] = useState<'ambos' | 'receber' | 'pagar'>('ambos');
  const [expandedAgingClient, setExpandedAgingClient] = useState<string | null>(null);
  const [dismissedRecurringBanner, setDismissedRecurringBanner] = useState(false);
  useEffect(() => { setExpandedAgingClient(null); }, [agingType]);

  const urgentRecurrings = useMemo(() => {
    const in3d = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    return transactions.filter(tx => tx.recurrence?.isActive && tx.recurrence.nextDueDate && tx.recurrence.nextDueDate <= in3d);
  }, [transactions]);

  // Period-filtered transactions for KPI + period-specific analytics
  const periodDays: Record<Exclude<DashboardPeriod, 'month'>, number> = { '30d': 30, '3m': 90, '6m': 180, '12m': 365 };

  const { periodTx, prevTx } = useMemo(() => {
    const txDate = (t: Transaction) => {
      const d = t.paymentDate || t.dueDate;
      return d ? new Date(d + 'T00:00:00').getTime() : 0;
    };

    if (dashboardPeriod === 'month') {
      const [y, m] = selectedMonth.split('-').map(Number);
      const start = new Date(y, m - 1, 1).getTime();
      const end   = new Date(y, m, 0, 23, 59, 59, 999).getTime();
      const prevM = m === 1 ? 12 : m - 1;
      const prevY = m === 1 ? y - 1 : y;
      const prevStart = new Date(prevY, prevM - 1, 1).getTime();
      const prevEnd   = new Date(prevY, prevM, 0, 23, 59, 59, 999).getTime();
      return {
        periodTx: transactions.filter(t => { const d = txDate(t); return d >= start && d <= end; }),
        prevTx:   transactions.filter(t => { const d = txDate(t); return d >= prevStart && d <= prevEnd; }),
      };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = today.getTime() + 86400000;
    const ms = periodDays[dashboardPeriod] * 86400000;
    const cutoffCurrent = now - ms;
    const cutoffPrev    = now - ms * 2;
    return {
      periodTx: transactions.filter(t => txDate(t) >= cutoffCurrent),
      prevTx:   transactions.filter(t => txDate(t) >= cutoffPrev && txDate(t) < cutoffCurrent),
    };
  }, [transactions, dashboardPeriod, selectedMonth, periodDays]);

  const periodMetrics = useMemo(() => {
    const paid = (arr: Transaction[], type: 'receita' | 'despesa') =>
      arr.filter(t => t.type === type && t.status === 'pago').reduce((s, t) => s + t.amount, 0);
    const pending = (arr: Transaction[], type: 'receita' | 'despesa') =>
      arr.filter(t => t.type === type && (t.status === 'pendente' || t.status === 'atrasado')).reduce((s, t) => s + t.amount, 0);
    const r = paid(periodTx, 'receita');
    const d = paid(periodTx, 'despesa');
    const pr = paid(prevTx, 'receita');
    const pd = paid(prevTx, 'despesa');
    const delta = (curr: number, prev: number) => prev === 0 ? null : ((curr - prev) / prev) * 100;
    return {
      receitas: r, despesas: d, lucro: r - d,
      aReceber: pending(periodTx, 'receita'),
      aPagar: pending(periodTx, 'despesa'),
      deltaReceitas: delta(r, pr),
      deltaDespesas: delta(d, pd),
      deltaLucro: delta(r - d, pr - pd),
    };
  }, [periodTx, prevTx]);

  // Waterfall chart data
  const waterfallData = useMemo(() => {
    const r = periodMetrics.receitas;
    const d = periodMetrics.despesas;
    const res = r - d;
    return [
      { name: 'Receitas', bottom: 0, value: r, fill: '#10b981' },
      { name: 'Despesas', bottom: Math.max(0, res), value: d, fill: '#ef4444' },
      { name: 'Resultado', bottom: 0, value: Math.max(0, res), fill: res >= 0 ? '#3b82f6' : '#f97316' },
    ];
  }, [periodMetrics]);

  // Top 5 expense categories (period-filtered)
  const topExpenseCategories = useMemo(() => {
    const cats: Record<string, number> = {};
    periodTx.filter(t => t.type === 'despesa' && t.status === 'pago' && t.category)
      .forEach(t => { cats[t.category!] = (cats[t.category!] || 0) + t.amount; });
    const total = Object.values(cats).reduce((s, v) => s + v, 0);
    const colors = ['#ef4444', '#f97316', '#f59e0b', '#8b5cf6', '#6366f1'];
    return Object.entries(cats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, amount], i) => ({ name, amount, color: colors[i], pct: total > 0 ? (amount / total) * 100 : 0 }));
  }, [periodTx]);

  // Top 5 clients by revenue (period-filtered)
  const topClients = useMemo(() => {
    const clients: Record<string, number> = {};
    periodTx.filter(t => t.type === 'receita' && t.status === 'pago' && t.clientName)
      .forEach(t => { clients[t.clientName!] = (clients[t.clientName!] || 0) + t.amount; });
    const max = Math.max(...Object.values(clients), 0);
    return Object.entries(clients)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, amount]) => ({ name, amount, pct: max > 0 ? (amount / max) * 100 : 0 }));
  }, [periodTx]);

  const upcomingRecurrences = useMemo(() => {
    const in3Days = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    return transactions.filter(t =>
      t.recurrence?.isActive &&
      t.recurrence.nextDueDate &&
      t.recurrence.nextDueDate <= in3Days
    );
  }, [transactions]);

  const recurringNext7Days = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const in7Days = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    return transactions
      .filter(t => t.recurrence?.isActive && t.recurrence.nextDueDate && t.recurrence.nextDueDate >= today && t.recurrence.nextDueDate <= in7Days)
      .sort((a, b) => (a.recurrence!.nextDueDate!).localeCompare(b.recurrence!.nextDueDate!));
  }, [transactions]);

  const overdueCount = transactions.filter(t =>
    t.status === 'pendente' && t.dueDate && new Date(t.dueDate + 'T00:00:00') < new Date()
  ).length;

  const PERIOD_LABELS: Record<DashboardPeriod, string> = {
    '30d': 'Últ. 30 dias', '3m': 'Últ. 3 meses', '6m': 'Últ. 6 meses', '12m': 'Últ. 12 meses',
    'month': (() => {
      const [y, m] = selectedMonth.split('-').map(Number);
      return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    })(),
  };

  function DeltaBadge({ delta, invert = false }: { delta: number | null; invert?: boolean }) {
    if (delta === null) return null;
    const isUp = delta >= 0;
    const isGood = invert ? !isUp : isUp;
    return (
      <span className={cn('inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full', isGood ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400')}>
        {isUp ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
        {Math.abs(delta).toFixed(1)}%
      </span>
    );
  }

  return (
    <div className="space-y-6">
      {upcomingRecurrences.length > 0 && !dismissedRecurringBanner && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-800/50 flex items-center justify-center shrink-0 mt-0.5">
              <Repeat size={16} className="text-amber-600 dark:text-amber-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
                {upcomingRecurrences.length} recorrência{upcomingRecurrences.length > 1 ? 's' : ''} vencendo em breve
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5 truncate">
                {upcomingRecurrences.slice(0, 3).map(tx => tx.recurrence?.label || tx.description).join(' · ')}
                {upcomingRecurrences.length > 3 && ` · +${upcomingRecurrences.length - 3} mais`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onGoToRecurrences && (
              <button
                onClick={onGoToRecurrences}
                className="px-3 py-1.5 text-xs font-semibold bg-amber-100 dark:bg-amber-800/50 text-amber-800 dark:text-amber-100 hover:bg-amber-200 dark:hover:bg-amber-800 rounded-lg transition-colors"
              >
                Ver painel →
              </button>
            )}
            <button onClick={() => setDismissedRecurringBanner(true)} className="text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 transition-colors p-1">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Próximos vencimentos recorrentes — 7 dias */}
      {recurringNext7Days.length > 0 && (
        <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-slate-100 dark:border-gray-800 flex items-center gap-2">
            <Repeat size={15} className="text-blue-500 dark:text-blue-400" />
            <h3 className="text-sm font-display font-bold text-slate-800 dark:text-gray-100">Próximos vencimentos recorrentes</h3>
            <span className="ml-auto text-xs text-slate-400 dark:text-gray-500 font-medium">próximos 7 dias</span>
          </div>
          <div className="divide-y divide-slate-50 dark:divide-gray-800">
            {recurringNext7Days.map(tx => {
              const today = new Date().toISOString().slice(0, 10);
              const diff = Math.round((new Date(tx.recurrence!.nextDueDate! + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000);
              const dueLabel = diff === 0 ? 'Hoje' : diff === 1 ? 'Amanhã' : `em ${diff}d`;
              const isUrgent = diff <= 3;
              return (
                <div key={tx.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-gray-800/40 transition-colors">
                  <div className={cn('w-12 h-10 rounded-xl flex flex-col items-center justify-center border shrink-0', isUrgent ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800')}>
                    <span className={cn('text-[10px] font-bold leading-none', isUrgent ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400')}>{dueLabel}</span>
                    <span className={cn('text-[9px] leading-none mt-0.5 opacity-70', isUrgent ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400')}>
                      {tx.recurrence!.nextDueDate!.slice(5).replace('-', '/')}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 dark:text-gray-100 truncate">{tx.recurrence?.label || tx.description}</p>
                    <p className="text-[11px] text-slate-400 dark:text-gray-500">{RECURRENCE_LABELS[tx.recurrence?.frequency || 'monthly']} · {tx.category || '—'}</p>
                  </div>
                  <p className={cn('text-sm font-bold shrink-0 mr-2', tx.type === 'receita' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                    {tx.type === 'receita' ? '+' : '-'}{showBalances ? formatCurrency(tx.amount) : 'R$ ****'}
                  </p>
                  <button
                    onClick={() => onMarkPaid(tx.id)}
                    title="Quitar agora"
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors shrink-0"
                  >
                    <CheckCircle2 size={12} />
                    Quitar
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* DAS Widget */}
      <DASWidget businessId={overviewBusinessId} onGoToDAS={onGoToDAS} />

      {/* Period selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-400 dark:text-gray-500 font-medium">Período:</span>
        <div className="flex items-center gap-1 p-1 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl">
          {(['30d', '3m', '6m', '12m'] as DashboardPeriod[]).map(p => (
            <button key={p} onClick={() => setDashboardPeriod(p)}
              className={cn('px-3 py-1 rounded-lg text-xs font-medium transition-all',
                dashboardPeriod === p ? 'bg-red-600 text-white shadow-sm' : 'text-slate-500 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800'
              )}
            >{PERIOD_LABELS[p]}</button>
          ))}
          <button
            onClick={() => setDashboardPeriod('month')}
            className={cn('px-3 py-1 rounded-lg text-xs font-medium transition-all',
              dashboardPeriod === 'month' ? 'bg-red-600 text-white shadow-sm' : 'text-slate-500 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800'
            )}
          >Mês específico</button>
        </div>
        {/* Month/year picker — only visible when 'month' is selected */}
        {dashboardPeriod === 'month' && (
          <motion.div
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-1.5"
          >
            <input
              type="month"
              value={selectedMonth}
              max={`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`}
              onChange={e => setSelectedMonth(e.target.value)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 text-slate-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-red-400/30 focus:border-red-300 dark:focus:border-red-700 transition-all"
              style={{ colorScheme: 'dark' }}
            />
          </motion.div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {[
          { label: t('financial.kpi.paidIncome', 'Receitas Pagas'), value: periodMetrics.receitas, delta: periodMetrics.deltaReceitas, invertDelta: false, icon: <TrendingUp size={18} />, color: 'emerald' },
          { label: t('financial.kpi.paidExpenses', 'Despesas Pagas'), value: periodMetrics.despesas, delta: periodMetrics.deltaDespesas, invertDelta: true, icon: <TrendingDown size={18} />, color: 'red' },
          { label: t('financial.kpi.result', 'Resultado'), value: periodMetrics.lucro, delta: periodMetrics.deltaLucro, invertDelta: false, icon: <DollarSign size={18} />, color: periodMetrics.lucro >= 0 ? 'blue' : 'red' },
          { label: t('financial.kpi.toReceive', 'A Receber'), value: periodMetrics.aReceber, delta: null, invertDelta: false, icon: <Clock size={18} />, color: 'amber' },
          { label: t('financial.kpi.toPay', 'A Pagar'), value: periodMetrics.aPagar, delta: null, invertDelta: false, icon: <AlertTriangle size={18} />, color: 'orange' },
        ].map((card, i) => {
          const cm: Record<string, { iconBg: string; iconTxt: string; valTxt: string }> = {
            emerald: { iconBg: 'bg-emerald-50 dark:bg-emerald-500/10', iconTxt: 'text-emerald-600 dark:text-emerald-400', valTxt: 'text-emerald-600 dark:text-emerald-400' },
            red: { iconBg: 'bg-red-50 dark:bg-red-500/10', iconTxt: 'text-red-600 dark:text-red-400', valTxt: 'text-red-600 dark:text-red-400' },
            blue: { iconBg: 'bg-blue-50 dark:bg-blue-500/10', iconTxt: 'text-blue-600 dark:text-blue-400', valTxt: 'text-blue-600 dark:text-blue-400' },
            amber: { iconBg: 'bg-amber-50 dark:bg-amber-500/10', iconTxt: 'text-amber-600 dark:text-amber-400', valTxt: 'text-amber-600 dark:text-amber-400' },
            orange: { iconBg: 'bg-orange-50 dark:bg-orange-500/10', iconTxt: 'text-orange-600 dark:text-orange-400', valTxt: 'text-orange-600 dark:text-orange-400' },
          };
          const c = cm[card.color] || cm.blue;
          return (
            <motion.div key={card.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
              className="bg-white dark:bg-gray-900/80 border border-slate-100 dark:border-gray-800/80 rounded-2xl p-4 hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/20 hover:border-slate-200 dark:hover:border-gray-700 hover:-translate-y-0.5 transition-all duration-200 group"
            >
              <div className="flex items-center justify-between mb-3">
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shadow-sm', c.iconBg, c.iconTxt, 'group-hover:scale-110 transition-transform duration-200')}>{card.icon}</div>
                <DeltaBadge delta={card.delta ?? null} invert={card.invertDelta} />
              </div>
              <p className="text-[11px] text-slate-400 dark:text-gray-500 font-medium mb-1 uppercase tracking-wide">{card.label}</p>
              <p className={cn('text-xl font-display font-bold leading-none', c.valTxt)}>
                {showBalances ? formatCurrency(card.value) : hiddenValue}
              </p>
            </motion.div>
          );
        })}
      </div>

      {/* Overdue alert */}
      {overdueCount > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 px-5 py-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl"
        >
          <AlertTriangle size={18} className="text-red-600 dark:text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-300">
            {t('financial.overdueAlert', 'Você tem {{count}} transação(ões) vencida(s) com pagamento pendente.', { count: overdueCount })}
          </p>
        </motion.div>
      )}

      {/* Aging Report — aprimorado (2.4) */}
      {(() => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const allPending = transactions.filter(tx => (tx.status === 'pendente' || tx.status === 'atrasado') && tx.dueDate);
        if (allPending.length === 0) return null;

        const pending = allPending.filter(tx =>
          agingType === 'ambos' ? true :
          agingType === 'receber' ? tx.type === 'receita' :
          tx.type === 'despesa'
        );

        const buckets = [
          { label: 'A vencer',    range: '0',   color: 'emerald', txs: [] as typeof pending },
          { label: '1–30 dias',   range: '30',  color: 'amber',   txs: [] as typeof pending },
          { label: '31–60 dias',  range: '60',  color: 'orange',  txs: [] as typeof pending },
          { label: '61–90 dias',  range: '90',  color: 'red',     txs: [] as typeof pending },
          { label: '+90 dias',    range: '90+', color: 'rose',    txs: [] as typeof pending },
        ];
        pending.forEach(tx => {
          const diff = Math.round((today.getTime() - new Date(tx.dueDate + 'T00:00:00').getTime()) / 86400000);
          if (diff <= 0) buckets[0].txs.push(tx);
          else if (diff <= 30) buckets[1].txs.push(tx);
          else if (diff <= 60) buckets[2].txs.push(tx);
          else if (diff <= 90) buckets[3].txs.push(tx);
          else buckets[4].txs.push(tx);
        });

        const colorMap: Record<string, { bar: string; badge: string; text: string }> = {
          emerald: { bar: 'bg-emerald-500', badge: 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400', text: 'text-emerald-600 dark:text-emerald-400' },
          amber:   { bar: 'bg-amber-400',   badge: 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-400', text: 'text-amber-600 dark:text-amber-400' },
          orange:  { bar: 'bg-orange-500',  badge: 'bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/30 text-orange-700 dark:text-orange-400', text: 'text-orange-600 dark:text-orange-400' },
          red:     { bar: 'bg-red-500',     badge: 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-400', text: 'text-red-600 dark:text-red-400' },
          rose:    { bar: 'bg-rose-600',    badge: 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-400', text: 'text-rose-600 dark:text-rose-400' },
        };
        const totalPending = pending.reduce((s, tx) => s + tx.amount, 0);

        // Ranking por cliente
        const clientMap = new Map<string, { total: number; count: number; oldest: string; txIds: string[] }>();
        pending.filter(tx => tx.clientName?.trim() && tx.dueDate).forEach(tx => {
          const key = tx.clientName!;
          const entry = clientMap.get(key) ?? { total: 0, count: 0, oldest: tx.dueDate!, txIds: [] };
          entry.total += tx.amount;
          entry.count += 1;
          entry.txIds.push(tx.id);
          if (tx.dueDate && tx.dueDate < entry.oldest) entry.oldest = tx.dueDate;
          clientMap.set(key, entry);
        });
        const clientRanking = [...clientMap.entries()]
          .sort(([, a], [, b]) => b.total - a.total)
          .slice(0, 8);

        return (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-5 hover:shadow-md transition-all space-y-4"
          >
            {/* Header + type filter */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-display font-bold text-slate-900 dark:text-gray-100">Aging Report — Contas Pendentes</h3>
                <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">Distribuição por tempo de vencimento</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 p-1 bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-xl">
                  {([['ambos', 'Ambos'], ['receber', 'A Receber'], ['pagar', 'A Pagar']] as const).map(([val, label]) => (
                    <button key={val} onClick={() => setAgingType(val)}
                      className={cn('px-2.5 py-1 rounded-lg text-xs font-medium transition-all',
                        agingType === val ? 'bg-white dark:bg-gray-900 text-slate-800 dark:text-gray-100 shadow-sm' : 'text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300'
                      )}
                    >{label}</button>
                  ))}
                </div>
                <span className="text-xs font-semibold text-slate-500 dark:text-gray-400 whitespace-nowrap">
                  Total: {showBalances ? formatCurrency(totalPending) : '****'}
                </span>
              </div>
            </div>

            {/* Buckets */}
            {pending.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {buckets.map(b => {
                  if (b.txs.length === 0) return null;
                  const bTotal = b.txs.reduce((s, tx) => s + tx.amount, 0);
                  const pct = totalPending > 0 ? (bTotal / totalPending) * 100 : 0;
                  const c = colorMap[b.color];
                  return (
                    <div key={b.range} className={`rounded-xl border p-3 ${c.badge}`}>
                      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1 opacity-70">{b.label}</p>
                      <p className="text-sm font-bold mb-0.5">{showBalances ? formatCurrency(bTotal) : '****'}</p>
                      <p className="text-[10px] opacity-60 mb-2">{b.txs.length} transação{b.txs.length !== 1 ? 'ões' : ''}</p>
                      <div className="h-1 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                        <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-400 dark:text-gray-500 text-center py-4">Nenhuma conta pendente para este filtro</p>
            )}

            {/* Ranking por cliente */}
            {clientRanking.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wide mb-2">Por Cliente</p>
                <div className="divide-y divide-slate-50 dark:divide-gray-800 rounded-xl border border-slate-100 dark:border-gray-800 overflow-hidden">
                  {clientRanking.map(([name, data]) => {
                    const isExpanded = expandedAgingClient === name;
                    const clientTxs = pending.filter(tx => tx.clientName === name);
                    const oldestDiff = Math.round((today.getTime() - new Date(data.oldest + 'T00:00:00').getTime()) / 86400000);
                    return (
                      <div key={name}>
                        <div
                          className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-gray-800/40 transition-colors cursor-pointer"
                          onClick={() => setExpandedAgingClient(isExpanded ? null : name)}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <ChevronRight size={14} className={cn('text-slate-400 shrink-0 transition-transform', isExpanded && 'rotate-90')} />
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-800 dark:text-gray-200 truncate">{name}</p>
                              <p className="text-[11px] text-slate-400 dark:text-gray-500">
                                {data.count} transaç{data.count !== 1 ? 'ões' : 'ão'} · mais antiga: {oldestDiff <= 0 ? 'a vencer' : `${oldestDiff}d atraso`}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 ml-4 shrink-0">
                            <span className="text-sm font-bold text-slate-800 dark:text-gray-200 tabular-nums">
                              {showBalances ? formatCurrency(data.total) : '****'}
                            </span>
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                const results = await Promise.allSettled(data.txIds.map(id => onMarkPaid(id)));
                                const failed = results.filter(r => r.status === 'rejected').length;
                                if (failed > 0) toast.error(`${failed} transação(ões) não foram quitadas. Tente novamente.`);
                              }}
                              className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 border border-emerald-200/60 dark:border-emerald-500/20 rounded-lg transition-colors"
                            >
                              Quitar tudo
                            </button>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="bg-slate-50/50 dark:bg-gray-900/40">
                            {clientTxs.map(tx => {
                              const diff = Math.round((today.getTime() - new Date(tx.dueDate + 'T00:00:00').getTime()) / 86400000);
                              return (
                                <div key={tx.id} className="flex items-center justify-between px-8 py-2.5 border-t border-slate-100 dark:border-gray-800">
                                  <div className="min-w-0">
                                    <p className="text-xs font-medium text-slate-700 dark:text-gray-300 truncate">{tx.description}</p>
                                    <p className={cn('text-[11px]', diff > 0 ? 'text-red-500 dark:text-red-400' : 'text-slate-400 dark:text-gray-500')}>
                                      {diff <= 0 ? `vence ${formatDate(tx.dueDate)}` : `${diff}d em atraso · ${formatDate(tx.dueDate)}`}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2 ml-4 shrink-0">
                                    <span className="text-xs font-bold text-slate-700 dark:text-gray-300 tabular-nums">
                                      {showBalances ? formatCurrency(tx.amount) : '****'}
                                    </span>
                                    <Tooltip title="Marcar como pago">
                                      <IconButton size="small" onClick={() => onMarkPaid(tx.id)} sx={{ color: '#10B981', '&:hover': { backgroundColor: '#D1FAE5' } }}>
                                        <CheckCircle2 size={14} />
                                      </IconButton>
                                    </Tooltip>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        );
      })()}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Cash Flow */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="lg:col-span-2 bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-6 hover:shadow-md transition-all"
        >
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-base font-display font-bold text-slate-900 dark:text-gray-100">{t('financial.charts.cashFlow', 'Fluxo de Caixa')}</h3>
              <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">{t('financial.charts.cashFlowSubtitle', 'Receitas vs Despesas')}</p>
            </div>
          </div>
          {monthlyData.some(d => d.receitas > 0 || d.despesas > 0 || d.receitasPrevisto > 0 || d.despesasPrevisto > 0) ? (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={monthlyData}>
                <defs>
                  <linearGradient id="gradReceita" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#10B981" stopOpacity={0.6} />
                  </linearGradient>
                  <linearGradient id="gradDespesa" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#EF4444" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#EF4444" stopOpacity={0.6} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#1E293B' : '#F1F5F9'} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} tickFormatter={fmtChart} />
                <RechartsTooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ paddingTop: 12 }} iconType="circle" iconSize={8} formatter={(v: string) => <span className="text-xs text-slate-500 dark:text-gray-400">{v}</span>} />
                <Bar dataKey="receitas" name={t('financial.charts.revenues', 'Receitas')} fill="url(#gradReceita)" radius={[0, 0, 0, 0]} barSize={22} stackId="r" />
                <Bar dataKey="receitasPrevisto" name="Receitas Previstas" fill="#6EE7B7" radius={[6, 6, 0, 0]} barSize={22} stackId="r" fillOpacity={0.65} />
                <Bar dataKey="despesas" name={t('financial.charts.expenses', 'Despesas')} fill="url(#gradDespesa)" radius={[0, 0, 0, 0]} barSize={22} stackId="d" />
                <Bar dataKey="despesasPrevisto" name="Despesas Previstas" fill="#FCA5A5" radius={[6, 6, 0, 0]} barSize={22} stackId="d" fillOpacity={0.65} />
                <Line type="monotone" dataKey="saldo" name={t('financial.charts.result', 'Resultado')} stroke="#3B82F6" strokeWidth={2.5} dot={{ r: 4, fill: '#3B82F6', strokeWidth: 2, stroke: '#fff' }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center h-[280px] text-slate-400 dark:text-gray-500">
              <BarChart3 size={36} strokeWidth={1.5} />
              <p className="mt-3 text-sm">{t('financial.charts.noData', 'Sem dados para exibir')}</p>
              <p className="text-xs mt-1">{t('financial.charts.noDataHint', 'Crie transações para visualizar o gráfico')}</p>
            </div>
          )}
        </motion.div>

        {/* Expense Breakdown */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-6 hover:shadow-md transition-all"
        >
          <h3 className="text-base font-display font-bold text-slate-900 dark:text-gray-100 mb-1">{t('financial.charts.expenseByCategory', 'Despesas por Categoria')}</h3>
          <p className="text-xs text-slate-400 dark:text-gray-500 mb-4">{t('financial.charts.expenseByCategorySubtitle', 'Distribuição das despesas pagas')}</p>
          {expenseBreakdown.length > 0 ? (
            <>
              <div className="flex justify-center mb-4">
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie data={expenseBreakdown} cx="50%" cy="50%" innerRadius={45} outerRadius={72} paddingAngle={2} dataKey="amount">
                      {expenseBreakdown.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <RechartsTooltip formatter={(v: number, n: string) => [formatCurrency(v), n]} contentStyle={{ borderRadius: '12px', border: isDark ? '1px solid #374151' : '1px solid #E2E8F0', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', backgroundColor: isDark ? '#111827' : '#fff', color: isDark ? '#F1F5F9' : undefined }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {expenseBreakdown.map((c) => (
                  <div key={c.name} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                      <span className="text-xs text-slate-600 dark:text-gray-400">{c.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 dark:text-gray-500">{c.percentage}%</span>
                      <span className="text-xs font-semibold text-slate-800 dark:text-gray-200 w-20 text-right">{showBalances ? formatCurrency(c.amount) : '***'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-[280px] text-slate-400 dark:text-gray-500">
              <Receipt size={36} strokeWidth={1.5} />
              <p className="mt-3 text-sm">{t('financial.charts.noExpenses', 'Sem despesas registradas')}</p>
            </div>
          )}
        </motion.div>
      </div>

      {/* Waterfall + Top 5 Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Waterfall chart */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}
          className="lg:col-span-2 bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-6 hover:shadow-md transition-all"
        >
          <div className="mb-4">
            <h3 className="text-base font-display font-bold text-slate-900 dark:text-gray-100">Resultado do Período</h3>
            <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">Receitas → Despesas → Resultado ({PERIOD_LABELS[dashboardPeriod]})</p>
          </div>
          {periodMetrics.receitas > 0 || periodMetrics.despesas > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={waterfallData} margin={{ top: 8, right: 8, left: 8, bottom: 4 }} barCategoryGap="35%">
                <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#1E293B' : '#F1F5F9'} vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 13 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} tickFormatter={fmtChart} />
                <RechartsTooltip
                  formatter={(value: number, name: string) => name === 'bottom' ? null : [formatCurrency(value), waterfallData.find(d => d.value === value)?.name ?? '']}
                  contentStyle={{ background: isDark ? '#1e293b' : '#fff', border: isDark ? '1px solid #374151' : '1px solid #E2E8F0', borderRadius: 10, fontSize: 13 }}
                />
                <Bar dataKey="bottom" stackId="wf" fill="transparent" legendType="none" />
                <Bar dataKey="value" stackId="wf" radius={[6, 6, 0, 0]} barSize={60}>
                  {waterfallData.map((entry, index) => (
                    <Cell key={index} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center h-[220px] text-slate-400 dark:text-gray-500">
              <BarChart3 size={32} strokeWidth={1.5} />
              <p className="mt-2 text-sm">Sem dados neste período</p>
            </div>
          )}
        </motion.div>

        {/* Top 5 expense categories */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
          className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-5 hover:shadow-md transition-all"
        >
          <h3 className="text-sm font-display font-bold text-slate-900 dark:text-gray-100 mb-0.5">Top 5 — Despesas</h3>
          <p className="text-xs text-slate-400 dark:text-gray-500 mb-4">Por categoria no período</p>
          {topExpenseCategories.length > 0 ? (
            <div className="space-y-3">
              {topExpenseCategories.map((c, i) => (
                <div key={c.name}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-slate-400 dark:text-gray-500 w-4">#{i + 1}</span>
                      <span className="text-xs font-medium text-slate-700 dark:text-gray-300 truncate max-w-[120px]">{c.name}</span>
                    </div>
                    <span className="text-xs font-bold text-slate-800 dark:text-gray-200 tabular-nums">
                      {showBalances ? formatCurrency(c.amount) : '***'}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 dark:bg-gray-800 overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${c.pct}%`, backgroundColor: c.color }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-[160px] text-slate-400 dark:text-gray-500">
              <Receipt size={28} strokeWidth={1.5} />
              <p className="mt-2 text-xs">Sem despesas no período</p>
            </div>
          )}
        </motion.div>
      </div>

      {/* Top 5 clients */}
      {topClients.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }}
          className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-5 hover:shadow-md transition-all"
        >
          <h3 className="text-sm font-display font-bold text-slate-900 dark:text-gray-100 mb-0.5">Top 5 — Clientes por Receita</h3>
          <p className="text-xs text-slate-400 dark:text-gray-500 mb-4">Transações pagas no período</p>
          <div className="space-y-3">
            {topClients.map((c, i) => (
              <div key={c.name} className="flex items-center gap-3">
                <span className="text-[10px] font-bold text-slate-400 dark:text-gray-500 w-4 flex-shrink-0">#{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slate-700 dark:text-gray-300 truncate">{c.name}</span>
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 tabular-nums ml-2 flex-shrink-0">
                      {showBalances ? formatCurrency(c.amount) : '***'}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 dark:bg-gray-800 overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${c.pct}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Recent Transactions */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
        className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-slate-100 dark:border-gray-800">
          <h3 className="text-base font-display font-bold text-slate-900 dark:text-gray-100">{t('financial.recentTransactions.title', 'Transações Recentes')}</h3>
          <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">{t('financial.recentTransactions.subtitle', 'Últimas 10 transações')}</p>
        </div>
        {transactions.length > 0 ? (
          <div className="divide-y divide-slate-50 dark:divide-gray-800">
            {transactions.slice(0, 10).map((tx, i) => (
              <motion.div key={tx.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                className="flex items-center justify-between px-6 py-3 hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                    tx.type === 'receita' ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-red-50 dark:bg-red-500/10'
                  )}>
                    {tx.type === 'receita' ? <ArrowUpRight size={14} className="text-emerald-600 dark:text-emerald-400" /> : <ArrowDownRight size={14} className="text-red-600 dark:text-red-400" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-gray-200 truncate">{tx.description}</p>
                    <p className="text-xs text-slate-400 dark:text-gray-500">{tx.category} - {formatDate(tx.dueDate)}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  <p className={cn('text-sm font-bold', tx.type === 'receita' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                    {showBalances ? `${tx.type === 'receita' ? '+' : '-'}${formatCurrency(tx.amount)}` : '***'}
                  </p>
                  <p className={cn('text-[10px] font-medium',
                    tx.status === 'pago' ? 'text-emerald-600 dark:text-emerald-400' :
                    tx.status === 'atrasado' ? 'text-red-600 dark:text-red-400' :
                    'text-amber-600 dark:text-amber-400'
                  )}>
                    {tx.status === 'pago' ? t('financial.status.paid', 'Pago') : tx.status === 'atrasado' ? t('financial.status.overdue', 'Atrasado') : tx.status === 'pendente' ? t('financial.status.pending', 'Pendente') : t('financial.status.cancelled', 'Cancelado')}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400 dark:text-gray-500">
            <Receipt size={36} strokeWidth={1.5} />
            <p className="mt-3 text-sm">{t('financial.recentTransactions.empty', 'Nenhuma transação registrada')}</p>
            <p className="text-xs mt-1">{t('financial.recentTransactions.emptyHint', 'Clique em "Novo Lançamento" para começar')}</p>
          </div>
        )}
      </motion.div>

      {/* ===== ENTERPRISE SECTION ===== */}
      {isEnterprise && (
        <EnterpriseFinancialCards
          transactions={transactions}
          sectors={sectors}
          broadcasts={broadcasts}
          crmContacts={crmContacts}
          showBalances={showBalances}
          isDark={isDark}
        />
      )}
    </div>
  );
}

// ==========================================
// ENTERPRISE FINANCIAL CARDS
// ==========================================

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  facebook: 'Facebook',
  instagram: 'Instagram',
};
const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: '#25D366',
  facebook: '#1877F2',
  instagram: '#E4405F',
};

function EnterpriseFinancialCards({
  transactions,
  sectors,
  broadcasts,
  crmContacts,
  showBalances,
  isDark,
}: {
  transactions: Transaction[];
  sectors: Sector[];
  broadcasts: Broadcast[];
  crmContacts: CRMContact[];
  showBalances: boolean;
  isDark: boolean;
}) {
  const formatCurrency = useCurrencyFormat();
  const { t } = useTranslation();
  const hiddenValue = '******';

  // Revenue by Channel
  const revenueByChannel = useMemo(() => {
    const channels: Record<string, number> = {};
    transactions
      .filter(t => t.type === 'receita' && t.status === 'pago' && t.channelType)
      .forEach(t => {
        const ch = t.channelType!;
        channels[ch] = (channels[ch] || 0) + t.amount;
      });
    const total = Object.values(channels).reduce((s, v) => s + v, 0);
    return Object.entries(channels)
      .sort(([, a], [, b]) => b - a)
      .map(([channel, amount]) => ({
        channel,
        label: CHANNEL_LABELS[channel] || channel,
        amount,
        color: CHANNEL_COLORS[channel] || '#6B7280',
        percentage: total > 0 ? parseFloat(((amount / total) * 100).toFixed(1)) : 0,
      }));
  }, [transactions]);

  // Revenue by Sector
  const revenueBySector = useMemo(() => {
    const sectorMap: Record<string, number> = {};
    transactions
      .filter(tx => tx.type === 'receita' && tx.status === 'pago' && tx.sectorId)
      .forEach(tx => {
        sectorMap[tx.sectorId!] = (sectorMap[tx.sectorId!] || 0) + tx.amount;
      });
    return Object.entries(sectorMap)
      .sort(([, a], [, b]) => b - a)
      .map(([sectorId, amount]) => {
        const sector = sectors.find(s => s.id === sectorId);
        return {
          sectorId,
          name: sector?.name || t('financial.enterprise.unknown', 'Desconhecido'),
          color: sector?.color || '#6B7280',
          amount,
        };
      });
  }, [transactions, sectors]);

  // Campaign ROI
  const campaignROI = useMemo(() => {
    const META_MSG_COST = 0.05; // approximate cost per WhatsApp template message in USD
    return broadcasts
      .filter(b => b.status === 'sent')
      .slice(0, 5)
      .map(b => {
        const cost = b.stats.sent * META_MSG_COST;
        // Revenue attributed to this campaign
        const revenue = transactions
          .filter(tx => tx.type === 'receita' && tx.status === 'pago' && tx.campaignId === b.id)
          .reduce((s, tx) => s + tx.amount, 0);
        const roi = cost > 0 ? ((revenue - cost) / cost) * 100 : 0;
        return {
          id: b.id,
          name: b.name,
          channel: b.channel,
          sent: b.stats.sent,
          delivered: b.stats.delivered,
          read: b.stats.read,
          cost,
          revenue,
          roi,
        };
      });
  }, [broadcasts, transactions]);

  // CLV Top 10 — agrega por cliente. Aceita transação que tenha contactId
  // (caminho CRM/webhook) OU clientId (caminho PDV/Sale). Antes filtrava só
  // por contactId, então vendas do PDV nunca apareciam no CLV — bug crítico
  // do tier Enterprise. Como Client e CRMContact são a MESMA coleção
  // (lib/types/index.ts:1832 — CRMContact = Client), ambos resolvem certo.
  const clvTop10 = useMemo(() => {
    const contactRevenue: Record<string, { name: string; total: number; count: number }> = {};
    transactions
      .filter(tx => tx.type === 'receita' && tx.status === 'pago' && (tx.contactId || tx.clientId))
      .forEach(tx => {
        const key = tx.contactId || tx.clientId!;
        if (!contactRevenue[key]) {
          const contact = crmContacts.find(c => c.id === key);
          contactRevenue[key] = { name: contact?.name || tx.clientName || t('financial.enterprise.unknown', 'Desconhecido'), total: 0, count: 0 };
        }
        contactRevenue[key].total += tx.amount;
        contactRevenue[key].count += 1;
      });
    return Object.entries(contactRevenue)
      .sort(([, a], [, b]) => b.total - a.total)
      .slice(0, 10)
      .map(([contactId, data]) => ({ contactId, ...data }));
  }, [transactions, crmContacts]);

  const hasAnyData = revenueByChannel.length > 0 || revenueBySector.length > 0 || campaignROI.length > 0 || clvTop10.length > 0;

  if (!hasAnyData) return null;

  return (
    <div className="space-y-6 mt-6">
      {/* Enterprise Section Header */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}
        className="flex items-center gap-3"
      >
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
          <Crown size={16} className="text-white" />
        </div>
        <div>
          <h2 className="text-lg font-display font-bold text-slate-900 dark:text-gray-100">{t('financial.enterprise.title', 'Relatórios Enterprise')}</h2>
          <p className="text-xs text-slate-400 dark:text-gray-500">{t('financial.enterprise.subtitle', 'Atribuição de receita por canal, setor e campanha')}</p>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue by Channel */}
        {revenueByChannel.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.65 }}
            className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-6 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
                <MessageSquare size={16} className="text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="text-sm font-display font-bold text-slate-900 dark:text-gray-100">{t('financial.enterprise.revenueByChannel', 'Receita por Canal')}</h3>
                <p className="text-[11px] text-slate-400 dark:text-gray-500">{t('financial.enterprise.revenueByChannelSubtitle', 'Origem omnichannel')}</p>
              </div>
            </div>
            <div className="space-y-3">
              {revenueByChannel.map((ch) => (
                <div key={ch.channel} className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: ch.color }} />
                    <span className="text-sm text-slate-700 dark:text-gray-300 truncate">{ch.label}</span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-[11px] text-slate-400 dark:text-gray-500">{ch.percentage}%</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-gray-100 w-28 text-right">
                      {showBalances ? formatCurrency(ch.amount) : hiddenValue}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {/* Mini bar chart */}
            <div className="flex gap-1 mt-4 h-2 rounded-full overflow-hidden bg-slate-100 dark:bg-gray-800">
              {revenueByChannel.map((ch) => (
                <div key={ch.channel} className="h-full rounded-full transition-all" style={{ width: `${ch.percentage}%`, backgroundColor: ch.color }} />
              ))}
            </div>
          </motion.div>
        )}

        {/* Revenue by Sector */}
        {revenueBySector.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
            className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-6 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center">
                <Layers size={16} className="text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <h3 className="text-sm font-display font-bold text-slate-900 dark:text-gray-100">{t('financial.enterprise.revenueBySector', 'Receita por Setor')}</h3>
                <p className="text-[11px] text-slate-400 dark:text-gray-500">{t('financial.enterprise.revenueBySectorSubtitle', 'Performance por departamento')}</p>
              </div>
            </div>
            <div className="space-y-3">
              {revenueBySector.map((s, i) => {
                const maxAmount = revenueBySector[0]?.amount || 1;
                return (
                  <div key={s.sectorId}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                        <span className="text-sm text-slate-700 dark:text-gray-300">{s.name}</span>
                      </div>
                      <span className="text-sm font-bold text-slate-900 dark:text-gray-100">
                        {showBalances ? formatCurrency(s.amount) : hiddenValue}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(s.amount / maxAmount) * 100}%` }}
                        transition={{ duration: 0.6, delay: i * 0.1 }}
                        className="h-full rounded-full"
                        style={{ backgroundColor: s.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </div>

      {/* Campaign ROI */}
      {campaignROI.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75 }}
          className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl overflow-hidden"
        >
          <div className="px-6 py-4 border-b border-slate-100 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
                <Target size={16} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h3 className="text-sm font-display font-bold text-slate-900 dark:text-gray-100">{t('financial.enterprise.campaignROI', 'ROI de Campanhas')}</h3>
                <p className="text-[11px] text-slate-400 dark:text-gray-500">{t('financial.enterprise.campaignROISubtitle', 'Custo vs receita gerada pelas últimas campanhas')}</p>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left">
                  <th className="px-5 py-3 text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wider">{t('financial.enterprise.campaign', 'Campanha')}</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wider">{t('financial.enterprise.channel', 'Canal')}</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wider text-right">{t('financial.enterprise.sent', 'Enviadas')}</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wider text-right">{t('financial.enterprise.estimatedCost', 'Custo Est.')}</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wider text-right">{t('financial.enterprise.revenue', 'Receita')}</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wider text-right">{t('financial.enterprise.roi', 'ROI')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-gray-800">
                {campaignROI.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3 text-sm font-medium text-slate-800 dark:text-gray-200 truncate max-w-[200px]">{c.name}</td>
                    <td className="px-5 py-3">
                      <span className="text-[11px] font-medium px-2.5 py-1 rounded-full" style={{
                        backgroundColor: (CHANNEL_COLORS[c.channel] || '#6B7280') + '15',
                        color: CHANNEL_COLORS[c.channel] || '#6B7280',
                      }}>
                        {CHANNEL_LABELS[c.channel] || c.channel}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-600 dark:text-gray-400 text-right">{c.sent.toLocaleString('pt-BR')}</td>
                    <td className="px-5 py-3 text-sm text-slate-600 dark:text-gray-400 text-right">
                      {showBalances ? `US$ ${c.cost.toFixed(2)}` : hiddenValue}
                    </td>
                    <td className="px-5 py-3 text-sm font-bold text-emerald-600 dark:text-emerald-400 text-right">
                      {showBalances ? formatCurrency(c.revenue) : hiddenValue}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className={cn('text-sm font-bold', c.roi >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                        {c.roi >= 0 ? '+' : ''}{c.roi.toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* CLV Top 10 */}
      {clvTop10.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}
          className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl overflow-hidden"
        >
          <div className="px-6 py-4 border-b border-slate-100 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
                <Users size={16} className="text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="text-sm font-display font-bold text-slate-900 dark:text-gray-100">{t('financial.enterprise.clvTop10', 'CLV Top 10')}</h3>
                <p className="text-[11px] text-slate-400 dark:text-gray-500">{t('financial.enterprise.clvTop10Subtitle', 'Contatos com maior valor acumulado')}</p>
              </div>
            </div>
          </div>
          <div className="divide-y divide-slate-50 dark:divide-gray-800">
            {clvTop10.map((c, i) => {
              const maxTotal = clvTop10[0]?.total || 1;
              return (
                <div key={c.contactId} className="flex items-center gap-4 px-6 py-3 hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors">
                  <span className="text-[11px] font-bold text-slate-400 dark:text-gray-500 w-5 text-center">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-gray-200 truncate">{c.name}</p>
                    <p className="text-[11px] text-slate-400 dark:text-gray-500">{t('financial.enterprise.transactionCount', '{{count}} transação(ões)', { count: c.count })}</p>
                  </div>
                  <div className="w-24 h-1.5 bg-slate-100 dark:bg-gray-800 rounded-full overflow-hidden flex-shrink-0">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(c.total / maxTotal) * 100}%` }}
                      transition={{ duration: 0.5, delay: i * 0.05 }}
                      className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500"
                    />
                  </div>
                  <span className="text-sm font-bold text-slate-900 dark:text-gray-100 flex-shrink-0 w-28 text-right">
                    {showBalances ? formatCurrency(c.total) : hiddenValue}
                  </span>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ==========================================
// TAB: TRANSACOES
// ==========================================

// ==========================================
// CASH FLOW PROJECTION (30/60/90 day)
// ==========================================

function CashFlowProjection({
  transactions,
  bankAccounts,
  businessName,
}: {
  transactions: Transaction[];
  bankAccounts: BankAccount[];
  businessName: string;
}) {
  const formatCurrency = useCurrencyFormat();
  const { isDark } = useTheme();
  const [viewMode, setViewMode]   = useState<'daily' | 'weekly'>('weekly');
  const [horizon,  setHorizon]    = useState<30 | 60 | 90>(30);
  const [scenario, setScenario]   = useState<'otimista' | 'conservador'>('otimista');

  // Starting balance from active bank accounts
  const startingBalance = useMemo(
    () => bankAccounts.filter(a => a.isActive).reduce((s, a) => s + a.balance, 0),
    [bankAccounts],
  );

  // ── Helper: advance a date by one recurrence period ─────────────────────────
  function advanceRecurrence(dateStr: string, frequency: string, dayOfMonth?: number, secondDayOfMonth?: number, holidayAdjust?: 'none' | 'before' | 'after'): string {
    const d = new Date(dateStr + 'T00:00:00');
    const day = dayOfMonth ? Math.min(dayOfMonth, 28) : undefined;
    switch (frequency) {
      case 'weekly':     d.setDate(d.getDate() + 7); break;
      case 'biweekly':   d.setDate(d.getDate() + 14); break;
      case 'monthly':    d.setMonth(d.getMonth() + 1);    if (day) d.setDate(day); break;
      case 'quarterly':  d.setMonth(d.getMonth() + 3);    if (day) d.setDate(day); break;
      case 'semiannual': d.setMonth(d.getMonth() + 6);    if (day) d.setDate(day); break;
      case 'yearly':     d.setFullYear(d.getFullYear() + 1); if (day) d.setDate(day); break;
      case 'biweekly_fixed': {
        const d1 = day ?? 1;
        const d2 = secondDayOfMonth ? Math.min(secondDayOfMonth, 28) : 15;
        const first = Math.min(d1, d2);
        const second = Math.max(d1, d2);
        const cur = d.getDate();
        if (cur < first)       { d.setDate(first); }
        else if (cur < second) { d.setDate(second); }
        else                   { d.setMonth(d.getMonth() + 1); d.setDate(first); }
        break;
      }
    }
    return adjustForBusinessDay(d.toISOString().slice(0, 10), holidayAdjust);
  }

  // ── 13-week rolling projection ───────────────────────────────────────────────
  const weeklyProjection = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayStr  = today.toISOString().slice(0, 10);
    const maxDate   = new Date(today); maxDate.setDate(today.getDate() + 91);
    const maxDateStr = maxDate.toISOString().slice(0, 10);

    // Build 13 weekly buckets
    const weeks = Array.from({ length: 13 }, (_, i) => {
      const start = new Date(today); start.setDate(today.getDate() + i * 7);
      const end   = new Date(today); end.setDate(today.getDate() + i * 7 + 6);
      const label = `S${i + 1} (${start.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })})`;
      return {
        name: label,
        startStr: start.toISOString().slice(0, 10),
        endStr:   end.toISOString().slice(0, 10),
        receitas: 0, despesas: 0,
      };
    });

    const weekOf = (dateStr: string): number => {
      const ms = new Date(dateStr + 'T00:00:00').getTime() - today.getTime();
      return Math.floor(ms / (7 * 86400000));
    };

    // 1. Regular pending/overdue transactions
    for (const tx of transactions) {
      if (tx.status === 'cancelado' || tx.status === 'pago') continue;
      if (scenario === 'conservador' && tx.status === 'atrasado') continue;
      const dateStr = tx.dueDate;
      if (!dateStr || dateStr < todayStr || dateStr > maxDateStr) continue;
      const w = weekOf(dateStr);
      if (w >= 0 && w < 13) {
        if (tx.type === 'receita') weeks[w].receitas += tx.amount;
        else weeks[w].despesas += tx.amount;
      }
    }

    // 2. Recurring transactions — project forward within horizon
    for (const tx of transactions.filter(t => t.recurrence?.isActive && t.recurrence.nextDueDate)) {
      const freq = tx.recurrence!.frequency;
      const dom  = tx.recurrence!.dayOfMonth;
      let next = tx.recurrence!.nextDueDate!;
      let guard = 0;
      while (next <= maxDateStr && guard++ < 52) {
        if (next >= todayStr) {
          const w = weekOf(next);
          if (w >= 0 && w < 13) {
            if (tx.type === 'receita') weeks[w].receitas += tx.amount;
            else weeks[w].despesas += tx.amount;
          }
        }
        next = advanceRecurrence(next, freq, dom, tx.recurrence!.secondDayOfMonth, tx.recurrence!.holidayAdjust);
      }
    }

    // 3. Compute running balance starting from bank accounts
    let running = startingBalance;
    const data = weeks.map(w => {
      running += w.receitas - w.despesas;
      return {
        name:     w.name,
        receitas: w.receitas,
        despesas: w.despesas,
        saldo:    w.receitas - w.despesas,
        acumulado: running,
      };
    });

    return {
      data,
      totals: {
        receitas: data.reduce((s, d) => s + d.receitas, 0),
        despesas: data.reduce((s, d) => s + d.despesas, 0),
        finalBalance: running,
      },
    };
  }, [transactions, startingBalance, scenario]);

  // ── Daily projection (existing logic, unchanged) ──────────────────────────
  const dailyProjection = useMemo(() => {
    const today    = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const cutoff   = new Date(today); cutoff.setDate(today.getDate() + horizon);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const relevant = transactions.filter(t => {
      if (t.status === 'cancelado') return false;
      const dateStr = t.dueDate || t.paymentDate;
      return dateStr && dateStr >= todayStr && dateStr <= cutoffStr;
    });

    const byDate = new Map<string, { receitas: number; despesas: number }>();
    for (const tx of relevant) {
      const key = (tx.dueDate || tx.paymentDate)!;
      const bucket = byDate.get(key) || { receitas: 0, despesas: 0 };
      if (tx.type === 'receita') bucket.receitas += tx.amount;
      else bucket.despesas += tx.amount;
      byDate.set(key, bucket);
    }

    let running = startingBalance;
    const data = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, b]) => {
        running += b.receitas - b.despesas;
        return { date, receitas: b.receitas, despesas: b.despesas, saldo: b.receitas - b.despesas, acumulado: running };
      });

    return {
      data,
      totals: {
        receitas: data.reduce((s, d) => s + d.receitas, 0),
        despesas: data.reduce((s, d) => s + d.despesas, 0),
        finalBalance: running,
      },
    };
  }, [transactions, horizon, startingBalance]);

  const active = viewMode === 'weekly' ? weeklyProjection : dailyProjection;
  const positiveEnd = active.totals.finalBalance >= 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-display">Projeção de Fluxo de Caixa</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {viewMode === 'weekly' ? `Rolling 13 semanas · ${scenario === 'otimista' ? 'inclui atrasados' : 'exclui atrasados'}` : `Próximos ${horizon} dias`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* View mode toggle */}
          <div className="flex items-center gap-1 p-1 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl">
            {([['daily', 'Diário'], ['weekly', '13 Semanas']] as const).map(([mode, label]) => (
              <button key={mode} onClick={() => setViewMode(mode)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                  viewMode === mode ? 'bg-red-600 text-white shadow-sm' : 'text-slate-500 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800'
                )}
              >{label}</button>
            ))}
          </div>
          {viewMode === 'daily' ? (
            <div className="inline-flex bg-gray-100 dark:bg-gray-800/60 rounded-xl p-0.5">
              {([30, 60, 90] as const).map(h => (
                <button key={h} onClick={() => setHorizon(h)}
                  className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition-colors',
                    horizon === h ? 'bg-white dark:bg-gray-900 shadow-sm text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'
                  )}
                >{h}d</button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-1 p-1 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl">
              {([['otimista', 'Otimista'], ['conservador', 'Conservador']] as const).map(([s, label]) => (
                <button key={s} onClick={() => setScenario(s)}
                  className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                    scenario === s ? (s === 'otimista' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-amber-500 text-white shadow-sm') : 'text-slate-500 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800'
                  )}
                >{label}</button>
              ))}
            </div>
          )}
          <button
            onClick={() => exportCashFlowCSV(
              active.data.map(d => ({ date: ('date' in d ? d.date : d.name) as string, receitas: d.receitas, despesas: d.despesas, saldo: d.saldo, acumulado: d.acumulado })),
              viewMode === 'weekly' ? 13 : horizon, businessName
            )}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
          >
            <Download size={13} /> CSV
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Saldo Inicial', value: startingBalance, color: 'text-slate-700 dark:text-gray-200', bg: 'bg-white dark:bg-gray-900 border-slate-100 dark:border-gray-800' },
          { label: 'Entradas Previstas', value: active.totals.receitas, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20' },
          { label: 'Saídas Previstas', value: active.totals.despesas, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20' },
          { label: 'Saldo Final Projetado', value: active.totals.finalBalance, color: positiveEnd ? 'text-blue-600 dark:text-blue-400' : 'text-orange-600 dark:text-orange-400', bg: positiveEnd ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20' : 'bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/20' },
        ].map(k => (
          <div key={k.label} className={`rounded-xl p-4 border ${k.bg}`}>
            <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 dark:text-gray-500 mb-1">{k.label}</p>
            <p className={`text-lg font-bold font-display ${k.color}`}>{formatCurrency(k.value)}</p>
          </div>
        ))}
      </div>

      {/* Negative balance warning */}
      {!positiveEnd && (
        <div className="flex items-center gap-3 px-4 py-3 bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 rounded-2xl">
          <AlertTriangle size={16} className="text-orange-600 dark:text-orange-400 shrink-0" />
          <p className="text-sm text-orange-800 dark:text-orange-200">
            Projeção indica saldo negativo de <strong>{formatCurrency(Math.abs(active.totals.finalBalance))}</strong> ao final do período.
          </p>
        </div>
      )}

      {/* Chart */}
      {active.data.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-12 text-center">
          <TrendingUp className="w-10 h-10 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Nenhum lançamento previsto neste horizonte</p>
          <p className="text-xs text-gray-500 mt-1">Transações pendentes com data de vencimento futura aparecem aqui</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={active.data} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#1E293B' : '#F1F5F9'} vertical={false} />
              <XAxis dataKey={viewMode === 'weekly' ? 'name' : 'date'} tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} interval={viewMode === 'weekly' ? 1 : 'preserveStartEnd'} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} width={56} />
              <RechartsTooltip
                formatter={(v: number, name: string) => [formatCurrency(v), name]}
                contentStyle={{ background: isDark ? '#1e293b' : '#fff', border: isDark ? '1px solid #374151' : '1px solid #E2E8F0', borderRadius: 10, fontSize: 12 }}
              />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="receitas" fill="#10B981" name="Entradas" radius={[4, 4, 0, 0]} barSize={viewMode === 'weekly' ? 14 : 8} />
              <Bar dataKey="despesas" fill="#EF4444" name="Saídas" radius={[4, 4, 0, 0]} barSize={viewMode === 'weekly' ? 14 : 8} />
              <Line type="monotone" dataKey="acumulado" stroke="#3B82F6" name="Saldo projetado" strokeWidth={2.5} dot={{ r: 3, fill: '#3B82F6', strokeWidth: 2, stroke: '#fff' }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Weekly table (13 semanas mode only) */}
      {viewMode === 'weekly' && active.data.length > 0 && (
        <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-slate-100 dark:border-gray-800">
            <span className="text-sm font-semibold text-slate-800 dark:text-gray-200">Detalhamento Semanal</span>
          </div>
          <div className="divide-y divide-slate-50 dark:divide-gray-800">
            <div className="grid grid-cols-5 px-5 py-2 text-[10px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wide">
              <div className="col-span-2">Semana</div>
              <div className="text-right">Entradas</div>
              <div className="text-right">Saídas</div>
              <div className="text-right">Saldo Acum.</div>
            </div>
            {active.data.map((row, i) => (
              <div key={i} className={cn('grid grid-cols-5 px-5 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-gray-800/40 transition-colors', row.acumulado < 0 && 'bg-red-50/30 dark:bg-red-500/5')}>
                <div className="col-span-2 text-slate-700 dark:text-gray-300 font-medium">{'name' in row ? row.name : ''}</div>
                <div className="text-right text-emerald-600 dark:text-emerald-400 tabular-nums">{row.receitas > 0 ? `+${formatCurrency(row.receitas)}` : '—'}</div>
                <div className="text-right text-red-600 dark:text-red-400 tabular-nums">{row.despesas > 0 ? `-${formatCurrency(row.despesas)}` : '—'}</div>
                <div className={cn('text-right font-semibold tabular-nums', row.acumulado >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-orange-600 dark:text-orange-400')}>
                  {formatCurrency(row.acumulado)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// AUDIT LOG VIEW
// ==========================================

function AuditLogView({ businessId }: { businessId?: string }) {
  const formatCurrency = useCurrencyFormat();
  const [logs, setLogs] = useState<import('@/lib/types').FinancialAuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    const q = query(
      collection(db, 'financialAuditLog'),
      where('businessId', '==', businessId),
      orderBy('createdAt', 'desc'),
    );
    getDocs(q).then(snap => {
      setLogs(snap.docs.slice(0, 100).map(d => ({ ...(d.data() as import('@/lib/types').FinancialAuditLog), id: d.id })));
      setLoading(false);
    }).catch(err => {
      console.error('[audit] fetch failed:', err);
      setLoading(false);
    });
  }, [businessId]);

  const ACTION_CFG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    create: { label: 'Criação', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400', icon: '+' },
    update: { label: 'Edição', color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400', icon: '~' },
    delete: { label: 'Exclusão', color: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400', icon: '−' },
    pay: { label: 'Pagamento', color: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400', icon: '✓' },
    cancel: { label: 'Cancelamento', color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400', icon: '×' },
    restore: { label: 'Restauração', color: 'bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400', icon: '↺' },
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Auditoria Financeira</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Histórico imutável de todas as mudanças em transações. Últimas 100 ações.
        </p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 rounded-xl shimmer" />)}
        </div>
      ) : logs.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-12 text-center">
          <History className="w-10 h-10 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Nenhum registro ainda</p>
          <p className="text-xs text-gray-500 mt-1">Toda criação, edição ou exclusão de transação fica registrada aqui</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {logs.map(log => {
            const cfg = ACTION_CFG[log.action] || ACTION_CFG.update;
            return (
              <motion.div
                key={log.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3 flex items-center gap-3"
              >
                <div className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0',
                  cfg.color,
                )}>
                  {cfg.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold', cfg.color)}>
                      {cfg.label}
                    </span>
                    <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {log.description || 'Transação'}
                    </span>
                    {log.amount != null && (
                      <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
                        {formatCurrency(log.amount)}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    por <strong>{log.actorName}</strong> · {formatDate(log.createdAt)} {new Date(log.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    {log.changedFields && log.changedFields.length > 0 && (
                      <> · campos: {log.changedFields.join(', ')}</>
                    )}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ==========================================
// TAB: DAS / SIMPLES NACIONAL (3.3)
// ==========================================

// Tabelas Simples Nacional 2024 (Resolução CGSN nº 140/2018 atualizada)
const SIMPLES_TABELAS: Record<SimplesAnexo, { limite: number; aliquota: number; deducao: number; faixa: string }[]> = {
  I:   [ // Comércio
    { faixa: '1ª', limite: 180000,   aliquota: 4.00,  deducao: 0 },
    { faixa: '2ª', limite: 360000,   aliquota: 7.30,  deducao: 5940 },
    { faixa: '3ª', limite: 720000,   aliquota: 9.50,  deducao: 13860 },
    { faixa: '4ª', limite: 1800000,  aliquota: 10.70, deducao: 22500 },
    { faixa: '5ª', limite: 3600000,  aliquota: 14.30, deducao: 87300 },
    { faixa: '6ª', limite: 4800000,  aliquota: 19.00, deducao: 378000 },
  ],
  II:  [ // Indústria
    { faixa: '1ª', limite: 180000,   aliquota: 4.50,  deducao: 0 },
    { faixa: '2ª', limite: 360000,   aliquota: 7.80,  deducao: 5940 },
    { faixa: '3ª', limite: 720000,   aliquota: 10.00, deducao: 13860 },
    { faixa: '4ª', limite: 1800000,  aliquota: 11.20, deducao: 22500 },
    { faixa: '5ª', limite: 3600000,  aliquota: 14.70, deducao: 85500 },
    { faixa: '6ª', limite: 4800000,  aliquota: 30.00, deducao: 720000 },
  ],
  III: [ // Serviços (tecnologia, comunicação, corretagem)
    { faixa: '1ª', limite: 180000,   aliquota: 6.00,  deducao: 0 },
    { faixa: '2ª', limite: 360000,   aliquota: 11.20, deducao: 9360 },
    { faixa: '3ª', limite: 720000,   aliquota: 13.50, deducao: 17640 },
    { faixa: '4ª', limite: 1800000,  aliquota: 16.00, deducao: 35640 },
    { faixa: '5ª', limite: 3600000,  aliquota: 21.00, deducao: 125640 },
    { faixa: '6ª', limite: 4800000,  aliquota: 33.00, deducao: 648000 },
  ],
  IV:  [ // Serviços (construção, limpeza, vigilância, advocacia)
    { faixa: '1ª', limite: 180000,   aliquota: 4.50,  deducao: 0 },
    { faixa: '2ª', limite: 360000,   aliquota: 9.00,  deducao: 8100 },
    { faixa: '3ª', limite: 720000,   aliquota: 10.20, deducao: 12420 },
    { faixa: '4ª', limite: 1800000,  aliquota: 14.00, deducao: 39780 },
    { faixa: '5ª', limite: 3600000,  aliquota: 22.00, deducao: 183780 },
    { faixa: '6ª', limite: 4800000,  aliquota: 33.00, deducao: 828000 },
  ],
  V:   [ // Serviços (fator R — TI, medicina, engenharia, arquitetura)
    { faixa: '1ª', limite: 180000,   aliquota: 15.50, deducao: 0 },
    { faixa: '2ª', limite: 360000,   aliquota: 18.00, deducao: 4500 },
    { faixa: '3ª', limite: 720000,   aliquota: 19.50, deducao: 9900 },
    { faixa: '4ª', limite: 1800000,  aliquota: 20.50, deducao: 17100 },
    { faixa: '5ª', limite: 3600000,  aliquota: 23.00, deducao: 62100 },
    { faixa: '6ª', limite: 4800000,  aliquota: 30.50, deducao: 540000 },
  ],
};

const ANEXO_LABELS: Record<SimplesAnexo, string> = {
  I:   'Anexo I — Comércio',
  II:  'Anexo II — Indústria',
  III: 'Anexo III — Serviços (tecnologia, comunicação)',
  IV:  'Anexo IV — Serviços (construção, limpeza, advocacia)',
  V:   'Anexo V — Serviços com fator R (TI, medicina, engenharia)',
};

function calcDAS(rbt12: number, receitaBruta: number, anexo: SimplesAnexo): { faixa: string; aliquotaNominal: number; aliquotaEfetiva: number; valorDas: number; deducao: number } {
  if (rbt12 <= 0 || receitaBruta <= 0) return { faixa: '—', aliquotaNominal: 0, aliquotaEfetiva: 0, valorDas: 0, deducao: 0 };
  const tabela = SIMPLES_TABELAS[anexo];
  const row = tabela.find(r => rbt12 <= r.limite) ?? tabela[tabela.length - 1];
  const aliquotaEfetiva = ((rbt12 * (row.aliquota / 100)) - row.deducao) / rbt12;
  return {
    faixa: row.faixa,
    aliquotaNominal: row.aliquota,
    aliquotaEfetiva: aliquotaEfetiva * 100,
    valorDas: receitaBruta * aliquotaEfetiva,
    deducao: row.deducao,
  };
}

function dasVencimento(competencia: string): string {
  const year = parseInt(competencia.slice(0, 4));
  const month = parseInt(competencia.slice(4, 6));
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-20`;
}

function competenciaLabel(c: string): string {
  const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${months[parseInt(c.slice(4, 6)) - 1]}/${c.slice(0, 4)}`;
}

function DASContent({ transactions, businessId }: { transactions: Transaction[]; businessId: string }) {
  const formatCurrency = useCurrencyFormat();
  const { user } = useAuth();
  const { isDark } = useTheme();
  const queryClient = useQueryClient();
  const dasFileRef = useRef<HTMLInputElement>(null);

  const now = new Date();
  const currentComp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [selComp,    setSelComp]    = useState(currentComp);
  const [anexo,      setAnexo]      = useState<SimplesAnexo>('III');
  const [manualRec,  setManualRec]  = useState('');
  const [manualRbt,  setManualRbt]  = useState('');
  const [isSaving,   setIsSaving]   = useState(false);
  const [uploadingId,setUploadingId]= useState<string | null>(null);
  const [showTabela, setShowTabela] = useState(false);

  // Auto-calc receita bruta from paid transactions in selected competência
  const autoReceita = useMemo(() => {
    const prefix = `${selComp.slice(0, 4)}-${selComp.slice(4, 6)}`;
    return transactions
      .filter(t => t.type === 'receita' && t.status === 'pago' && (t.paymentDate || t.dueDate || '').startsWith(prefix))
      .reduce((s, t) => s + t.amount, 0);
  }, [transactions, selComp]);

  // Auto-calc RBT12 = paid receitas in last 12 months
  const autoRbt12 = useMemo(() => {
    const compYear  = parseInt(selComp.slice(0, 4));
    const compMonth = parseInt(selComp.slice(4, 6));
    const cutoffDate = new Date(compYear, compMonth - 12, 1);
    const cutoffStr  = cutoffDate.toISOString().slice(0, 7);
    const endStr     = `${selComp.slice(0, 4)}-${selComp.slice(4, 6)}`;
    return transactions
      .filter(t => {
        if (t.type !== 'receita' || t.status !== 'pago') return false;
        const d = (t.paymentDate || t.dueDate || '').slice(0, 7);
        return d >= cutoffStr && d <= endStr;
      })
      .reduce((s, t) => s + t.amount, 0);
  }, [transactions, selComp]);

  const receitaBruta = parseFloat(manualRec) || autoReceita;
  const rbt12        = parseFloat(manualRbt) || autoRbt12;
  const calc         = useMemo(() => calcDAS(rbt12, receitaBruta, anexo), [rbt12, receitaBruta, anexo]);

  // Firestore: dasRecords
  const { data: dasRecords = [] } = useTanstackQuery<DasRecord[]>({
    queryKey: ['dasRecords', businessId],
    queryFn: async () => {
      if (!businessId) return [];
      const q = query(
        collection(db, 'dasRecords'),
        where('businessId', '==', businessId),
        orderBy('competencia', 'desc'),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as DasRecord));
    },
    enabled: !!businessId,
    staleTime: 60 * 1000,
  });

  const currentRecord = dasRecords.find(r => r.competencia === selComp);

  const handleSaveDAS = async () => {
    if (!businessId || !user || calc.valorDas <= 0) return;
    setIsSaving(true);
    try {
      const nowStr = new Date().toISOString();
      const data: Omit<DasRecord, 'id'> = {
        businessId,
        competencia: selComp,
        receitaBruta,
        rbt12,
        anexo,
        aliquotaEfetiva: calc.aliquotaEfetiva,
        valorDas: calc.valorDas,
        vencimento: dasVencimento(selComp),
        status: 'pendente',
        createdAt: currentRecord?.createdAt ?? nowStr,
        updatedAt: nowStr,
      };
      if (currentRecord) {
        await updateDoc(doc(db, 'dasRecords', currentRecord.id), { ...data });
      } else {
        await addDoc(collection(db, 'dasRecords'), data);
      }
      queryClient.invalidateQueries({ queryKey: ['dasRecords', businessId] });
      toast.success('DAS gerado com sucesso');
    } finally {
      setIsSaving(false);
    }
  };

  const handleMarkPago = async (record: DasRecord) => {
    if (!businessId) return;
    await updateDoc(doc(db, 'dasRecords', record.id), {
      status: 'pago',
      pagoEm: new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString(),
    });
    queryClient.invalidateQueries({ queryKey: ['dasRecords', businessId] });
    toast.success('DAS marcado como pago');
  };

  const handleUploadRecibo = async (record: DasRecord, file: File) => {
    if (!businessId) return;
    if (file.size > 10 * 1024 * 1024) { toast.error('Arquivo muito grande. Máximo 10MB.'); return; }
    setUploadingId(record.id);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const path = `businesses/${businessId}/das/${record.competencia}_${safeName}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'dasRecords', record.id), {
        recibo: url, reciboPath: path, updatedAt: new Date().toISOString(),
      });
      queryClient.invalidateQueries({ queryKey: ['dasRecords', businessId] });
      toast.success('Comprovante enviado');
    } finally {
      setUploadingId(null);
    }
  };

  // Available competências (current month + last 23)
  const competencias = useMemo(() => {
    const list: string[] = [];
    for (let i = 0; i < 24; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      list.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return list;
  }, []);

  const todayStr = now.toISOString().slice(0, 10);
  const statusColor: Record<DasStatus, string> = {
    pendente: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20',
    pago:     'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20',
    atrasado: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-display">DAS — Simples Nacional</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Calcule, registre e acompanhe o pagamento mensal do DAS</p>
        </div>
        <button onClick={() => setShowTabela(v => !v)}
          className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors',
            showTabela ? 'border-violet-400 bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400' : 'border-slate-200 dark:border-gray-700 text-slate-500 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800'
          )}
        >
          <FileSpreadsheet size={13} />
          {showTabela ? 'Ocultar' : 'Ver'} Tabela de Alíquotas
        </button>
      </div>

      {/* Alíquota table */}
      <AnimatePresence>
        {showTabela && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
              <div className="px-5 py-3 border-b border-slate-100 dark:border-gray-800">
                <span className="text-sm font-semibold text-slate-800 dark:text-gray-200">Tabela Simples Nacional 2024 — {ANEXO_LABELS[anexo]}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-gray-800/60">
                    <tr>
                      {['Faixa', 'RBT12 até', 'Alíquota Nominal', 'Parcela a Deduzir'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-gray-800">
                    {SIMPLES_TABELAS[anexo].map((row, i) => {
                      const isActive = rbt12 > 0 && rbt12 <= row.limite && (i === 0 || rbt12 > SIMPLES_TABELAS[anexo][i - 1].limite);
                      return (
                        <tr key={i} className={cn(isActive && 'bg-violet-50/50 dark:bg-violet-500/5')}>
                          <td className="px-4 py-2.5 text-slate-700 dark:text-gray-300 font-medium">
                            {row.faixa} {isActive && <span className="ml-1 text-[10px] text-violet-600 dark:text-violet-400 font-bold">← atual</span>}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600 dark:text-gray-400 tabular-nums">{formatCurrency(row.limite)}</td>
                          <td className="px-4 py-2.5 font-semibold text-slate-800 dark:text-gray-200">{row.aliquota.toFixed(2).replace('.', ',')}%</td>
                          <td className="px-4 py-2.5 text-slate-600 dark:text-gray-400 tabular-nums">{row.deducao > 0 ? formatCurrency(row.deducao) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Calculator */}
      <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-5 shadow-sm space-y-4">
        <p className="text-sm font-semibold text-slate-800 dark:text-gray-200">Calcular DAS</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Competência */}
          <div>
            <label className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1 block">Competência</label>
            <select value={selComp} onChange={e => setSelComp(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500/20"
            >
              {competencias.map(c => <option key={c} value={c}>{competenciaLabel(c)}</option>)}
            </select>
          </div>
          {/* Anexo */}
          <div>
            <label className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1 block">Anexo / Atividade</label>
            <select value={anexo} onChange={e => setAnexo(e.target.value as SimplesAnexo)}
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500/20"
            >
              {(Object.keys(ANEXO_LABELS) as SimplesAnexo[]).map(a => <option key={a} value={a}>{ANEXO_LABELS[a]}</option>)}
            </select>
          </div>
          {/* Vencimento preview */}
          <div className="flex flex-col justify-end">
            <label className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1 block">Vencimento</label>
            <div className="px-3 py-2 text-sm rounded-xl border border-slate-100 dark:border-gray-800 bg-slate-50 dark:bg-gray-800 text-slate-700 dark:text-gray-300 font-medium">
              {formatDate(dasVencimento(selComp))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1 block">
              Receita Bruta do Mês
              {autoReceita > 0 && <span className="ml-1 text-emerald-600 dark:text-emerald-400">(calculada: {formatCurrency(autoReceita)})</span>}
            </label>
            <input type="number" min="0" step="0.01" value={manualRec} onChange={e => setManualRec(e.target.value)}
              placeholder={autoReceita > 0 ? `${autoReceita.toFixed(2)} (auto)` : 'Ex: 15000,00'}
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500/20"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1 block">
              RBT12 (últimos 12 meses)
              {autoRbt12 > 0 && <span className="ml-1 text-emerald-600 dark:text-emerald-400">(calculado: {formatCurrency(autoRbt12)})</span>}
            </label>
            <input type="number" min="0" step="0.01" value={manualRbt} onChange={e => setManualRbt(e.target.value)}
              placeholder={autoRbt12 > 0 ? `${autoRbt12.toFixed(2)} (auto)` : 'Ex: 180000,00'}
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500/20"
            />
          </div>
        </div>

        {/* Result */}
        {calc.valorDas > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-slate-50 dark:bg-gray-800/50 rounded-xl border border-slate-100 dark:border-gray-700">
            {[
              { label: 'Faixa', value: `${calc.faixa} faixa` },
              { label: 'Alíquota Nominal', value: `${calc.aliquotaNominal.toFixed(2).replace('.', ',')}%` },
              { label: 'Alíquota Efetiva', value: `${calc.aliquotaEfetiva.toFixed(4).replace('.', ',')}%` },
              { label: 'Valor DAS', value: formatCurrency(calc.valorDas) },
            ].map(k => (
              <div key={k.label}>
                <p className="text-[10px] text-slate-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">{k.label}</p>
                <p className={cn('text-sm font-bold', k.label === 'Valor DAS' ? 'text-red-600 dark:text-red-400 text-base' : 'text-slate-800 dark:text-gray-200')}>{k.value}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button onClick={handleSaveDAS} disabled={isSaving || calc.valorDas <= 0} variant="contained"
            sx={{ backgroundColor: '#DC2626', '&:hover': { backgroundColor: '#B91C1C' }, '&.Mui-disabled': { backgroundColor: '#FCA5A5', color: '#fff' }, textTransform: 'none', fontWeight: 700, borderRadius: '12px' }}
          >
            {isSaving ? 'Salvando...' : currentRecord ? 'Atualizar DAS' : 'Gerar DAS'}
          </Button>
          {calc.valorDas <= 0 && <p className="text-xs text-slate-400 dark:text-gray-500">Preencha RBT12 e Receita Bruta para calcular</p>}
        </div>
      </div>

      {/* History */}
      <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-slate-100 dark:border-gray-800">
          <span className="text-sm font-semibold text-slate-800 dark:text-gray-200">Histórico de DAS</span>
        </div>

        {dasRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-gray-500">
            <Receipt size={40} strokeWidth={1.5} />
            <p className="mt-3 text-sm font-medium">Nenhum DAS registrado ainda</p>
            <p className="text-xs mt-1">Use a calculadora acima para gerar o primeiro DAS</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-gray-800">
            {dasRecords.map(record => {
              const daysToVenc = Math.round((new Date(record.vencimento + 'T00:00:00').getTime() - new Date(todayStr + 'T00:00:00').getTime()) / 86400000);
              const isAlert = record.status === 'pendente' && daysToVenc >= 0 && daysToVenc <= 5;
              const isLate  = record.status !== 'pago' && record.vencimento < todayStr;
              const effectiveStatus: DasStatus = isLate ? 'atrasado' : record.status;
              return (
                <div key={record.id} className={cn('px-5 py-4 hover:bg-slate-50 dark:hover:bg-gray-800/40 transition-colors', isAlert && 'bg-amber-50/40 dark:bg-amber-500/5')}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-800 dark:text-gray-200">{competenciaLabel(record.competencia)}</span>
                        <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border', statusColor[effectiveStatus])}>
                          {effectiveStatus === 'pago' ? 'Pago' : effectiveStatus === 'atrasado' ? 'Atrasado' : 'Pendente'}
                        </span>
                        {isAlert && <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">⚠ vence em {daysToVenc}d</span>}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-slate-500 dark:text-gray-400">
                        <span>Venc: {formatDate(record.vencimento)}</span>
                        <span>{ANEXO_LABELS[record.anexo].split('—')[0].trim()}</span>
                        <span>Alíq efetiva: {record.aliquotaEfetiva.toFixed(2).replace('.', ',')}%</span>
                        {record.pagoEm && <span>Pago em {formatDate(record.pagoEm)}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-base font-bold text-red-600 dark:text-red-400 tabular-nums">{formatCurrency(record.valorDas)}</span>
                      <div className="flex items-center gap-1">
                        {record.status !== 'pago' && (
                          <Tooltip title="Marcar como pago">
                            <IconButton size="small" onClick={() => handleMarkPago(record)} sx={{ color: '#10B981', '&:hover': { backgroundColor: '#D1FAE5' } }}>
                              <CheckCircle2 size={15} />
                            </IconButton>
                          </Tooltip>
                        )}
                        {record.recibo ? (
                          <Tooltip title="Ver comprovante">
                            <IconButton size="small" href={record.recibo} target="_blank" component="a" sx={{ color: '#6366F1' }}>
                              <Paperclip size={15} />
                            </IconButton>
                          </Tooltip>
                        ) : (
                          <Tooltip title="Anexar comprovante">
                            <IconButton size="small" onClick={() => { setUploadingId(record.id); dasFileRef.current?.click(); }} disabled={uploadingId === record.id} sx={{ color: '#94A3B8' }}>
                              {uploadingId === record.id ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                            </IconButton>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Hidden file input for receipt */}
      <input ref={dasFileRef} type="file" accept="image/*,.pdf" className="hidden"
        onChange={async e => {
          const file = e.target.files?.[0];
          const record = dasRecords.find(r => r.id === uploadingId);
          if (file && record) await handleUploadRecibo(record, file);
          if (dasFileRef.current) dasFileRef.current.value = '';
        }}
      />
    </div>
  );
}

// Widget for OverviewContent dashboard
function DASWidget({ businessId, onGoToDAS }: { businessId: string; onGoToDAS: () => void }) {
  const formatCurrency = useCurrencyFormat();
  const [record, setRecord] = useState<DasRecord | null | undefined>(undefined);

  useEffect(() => {
    if (!businessId) return;
    const now = new Date();
    const comp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    getDocs(query(
      collection(db, 'dasRecords'),
      where('businessId', '==', businessId),
      where('competencia', '==', comp),
    )).then(snap => {
      setRecord(snap.empty ? null : { ...snap.docs[0].data(), id: snap.docs[0].id } as DasRecord);
    }).catch(() => setRecord(null));
  }, [businessId]);

  if (record === undefined) return null;

  const todayStr = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const comp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const venc = dasVencimento(comp);
  const daysToVenc = Math.round((new Date(venc + 'T00:00:00').getTime() - new Date(todayStr + 'T00:00:00').getTime()) / 86400000);
  const isAlert = daysToVenc >= 0 && daysToVenc <= 5;

  if (!record) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between px-5 py-4 bg-slate-50 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-700 rounded-2xl"
      >
        <div className="flex items-center gap-3">
          <Receipt size={18} className="text-slate-400 dark:text-gray-500" />
          <div>
            <p className="text-sm font-semibold text-slate-700 dark:text-gray-300">DAS {competenciaLabel(comp)}</p>
            <p className="text-xs text-slate-400 dark:text-gray-500">Vence {formatDate(venc)} · Não gerado</p>
          </div>
        </div>
        <button onClick={onGoToDAS} className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline">Calcular →</button>
      </motion.div>
    );
  }

  const isPago = record.status === 'pago';
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className={cn('flex items-center justify-between px-5 py-4 rounded-2xl border',
        isPago ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20' :
        isAlert ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20' :
        'bg-slate-50 dark:bg-gray-800/50 border-slate-200 dark:border-gray-700'
      )}
    >
      <div className="flex items-center gap-3">
        <Receipt size={18} className={isPago ? 'text-emerald-500' : isAlert ? 'text-amber-500' : 'text-slate-400 dark:text-gray-500'} />
        <div>
          <p className="text-sm font-semibold text-slate-800 dark:text-gray-200">
            DAS {competenciaLabel(comp)} — {formatCurrency(record.valorDas)}
          </p>
          <p className="text-xs text-slate-500 dark:text-gray-400">
            {isPago ? `Pago em ${formatDate(record.pagoEm)}` : isAlert ? `⚠ Vence em ${daysToVenc} dia${daysToVenc !== 1 ? 's' : ''}` : `Vence ${formatDate(venc)}`}
          </p>
        </div>
      </div>
      <button onClick={onGoToDAS} className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline">
        {isPago ? 'Ver' : 'Gerenciar'} →
      </button>
    </motion.div>
  );
}

// ==========================================
// TAB: ORÇAMENTO (Budget vs Realizado — 3.1)
// ==========================================

function BudgetContent({
  transactions,
  businessId,
}: {
  transactions: Transaction[];
  businessId: string;
}) {
  const formatCurrency = useCurrencyFormat();
  const { user, business } = useAuth();
  const queryClient = useQueryClient();
  const { isDark } = useTheme();

  const now = new Date();
  const [selYear,  setSelYear]  = useState(now.getFullYear());
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1);
  const [showForm, setShowForm] = useState(false);
  const [formCat,  setFormCat]  = useState('');
  const [formType, setFormType] = useState<'receita' | 'despesa'>('despesa');
  const [formAmt,  setFormAmt]  = useState('');
  const [editId,   setEditId]   = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCopying, setIsCopying] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: budgets = [], refetch } = useTanstackQuery<Budget[]>({
    queryKey: ['budgets', businessId, selYear, selMonth],
    queryFn: async () => {
      if (!businessId) return [];
      const q = query(
        collection(db, 'budgets'),
        where('businessId', '==', businessId),
        where('year', '==', selYear),
        where('month', '==', selMonth),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as Budget));
    },
    enabled: !!businessId,
    staleTime: 60 * 1000,
  });

  // ── Realizado: paid transactions for the selected month ───────────────────
  const realized = useMemo(() => {
    const prefix = `${selYear}-${String(selMonth).padStart(2, '0')}`;
    const map = new Map<string, { receita: number; despesa: number }>();
    transactions
      .filter(t => t.status === 'pago' && (t.paymentDate || t.dueDate || '').startsWith(prefix))
      .forEach(t => {
        const cat = t.category || 'Outros';
        const entry = map.get(cat) ?? { receita: 0, despesa: 0 };
        if (t.type === 'receita') entry.receita += t.amount;
        else entry.despesa += t.amount;
        map.set(cat, entry);
      });
    return map;
  }, [transactions, selYear, selMonth]);

  // ── Merged rows: union of budgeted and realized categories ────────────────
  const rows = useMemo(() => {
    const categories = new Set<string>([
      ...budgets.map(b => b.category),
      ...Array.from(realized.keys()),
    ]);
    return Array.from(categories).sort().map(cat => {
      const bRec  = budgets.find(b => b.category === cat && b.type === 'receita');
      const bDesp = budgets.find(b => b.category === cat && b.type === 'despesa');
      const real  = realized.get(cat) ?? { receita: 0, despesa: 0 };
      return {
        category: cat,
        budgetedReceita:  bRec?.amount  ?? 0,
        budgetedDespesa:  bDesp?.amount ?? 0,
        realizedReceita:  real.receita,
        realizedDespesa:  real.despesa,
        budgetRecId:  bRec?.id,
        budgetDespId: bDesp?.id,
      };
    });
  }, [budgets, realized]);

  // Alerts: categories reaching ≥ 80% of their budget
  const alerts = useMemo(() =>
    rows.filter(r => {
      const despPct = r.budgetedDespesa > 0 ? (r.realizedDespesa / r.budgetedDespesa) * 100 : 0;
      const recPct  = r.budgetedReceita > 0 ? (r.realizedReceita  / r.budgetedReceita)  * 100 : 0;
      return despPct >= 80 || recPct >= 80;
    }),
  [rows]);

  // Chart data
  const chartData = useMemo(() =>
    rows
      .filter(r => r.budgetedDespesa > 0 || r.budgetedReceita > 0)
      .map(r => ({
        name: r.category.length > 12 ? r.category.slice(0, 11) + '…' : r.category,
        'Orçado (D)':    r.budgetedDespesa,
        'Realizado (D)': r.realizedDespesa,
        'Orçado (R)':    r.budgetedReceita,
        'Realizado (R)': r.realizedReceita,
      })),
  [rows]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const openAdd = (cat = '', type: 'receita' | 'despesa' = 'despesa', id: string | null = null, amt = '') => {
    setFormCat(cat); setFormType(type); setFormAmt(amt); setEditId(id); setShowForm(true);
  };

  const handleSave = async () => {
    if (!businessId || !formCat.trim() || !formAmt || parseFloat(formAmt) <= 0) return;
    if (!user) return;
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const data = {
        businessId,
        year: selYear,
        month: selMonth,
        category: formCat.trim(),
        type: formType,
        amount: parseFloat(formAmt),
        updatedAt: now,
      };
      if (editId) {
        await updateDoc(doc(db, 'budgets', editId), data);
      } else {
        await addDoc(collection(db, 'budgets'), { ...data, createdAt: now });
      }
      queryClient.invalidateQueries({ queryKey: ['budgets', businessId, selYear, selMonth] });
      setShowForm(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, 'budgets', id));
    queryClient.invalidateQueries({ queryKey: ['budgets', businessId, selYear, selMonth] });
  };

  const handleCopyPrevMonth = async () => {
    if (!businessId || !user) return;
    setIsCopying(true);
    try {
      const prevMonth = selMonth === 1 ? 12 : selMonth - 1;
      const prevYear  = selMonth === 1 ? selYear - 1 : selYear;
      const q = query(
        collection(db, 'budgets'),
        where('businessId', '==', businessId),
        where('year', '==', prevYear),
        where('month', '==', prevMonth),
      );
      const snap = await getDocs(q);
      if (snap.empty) { toast.info('Sem orçamento no mês anterior para copiar.'); return; }
      const batch = writeBatch(db);
      const nowStr = new Date().toISOString();
      snap.docs.forEach(d => {
        const { year: _y, month: _m, ...rest } = d.data();
        const ref = doc(collection(db, 'budgets'));
        batch.set(ref, { ...rest, year: selYear, month: selMonth, createdAt: nowStr, updatedAt: nowStr });
      });
      await batch.commit();
      queryClient.invalidateQueries({ queryKey: ['budgets', businessId, selYear, selMonth] });
      toast.success(`${snap.size} meta(s) copiadas do mês anterior.`);
    } finally {
      setIsCopying(false);
    }
  };

  const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const availableCategories = useMemo(() => {
    const cats = new Set<string>([...budgets.map(b => b.category), ...Array.from(realized.keys())]);
    transactions.forEach(t => { if (t.category) cats.add(t.category); });
    return Array.from(cats).sort();
  }, [budgets, realized, transactions]);

  const totalBudgetedDesp  = rows.reduce((s, r) => s + r.budgetedDespesa, 0);
  const totalRealizedDesp  = rows.reduce((s, r) => s + r.realizedDespesa, 0);
  const totalBudgetedRec   = rows.reduce((s, r) => s + r.budgetedReceita, 0);
  const totalRealizedRec   = rows.reduce((s, r) => s + r.realizedReceita, 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-display">Orçamento vs Realizado</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Compare metas com resultados por categoria</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Month selector */}
          <select value={selMonth} onChange={e => setSelMonth(Number(e.target.value))}
            className="px-3 py-1.5 rounded-xl text-xs font-medium bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 text-slate-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {monthNames.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
          <select value={selYear} onChange={e => setSelYear(Number(e.target.value))}
            className="px-3 py-1.5 rounded-xl text-xs font-medium bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 text-slate-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {[0,1,2].map(d => { const y = now.getFullYear() - d; return <option key={y} value={y}>{y}</option>; })}
          </select>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={handleCopyPrevMonth} disabled={isCopying}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-all"
          >
            {isCopying ? <Loader2 size={13} className="animate-spin" /> : <ChevronsRight size={13} />}
            Copiar mês anterior
          </motion.button>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={() => openAdd()}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-700 text-white transition-all"
          >
            <Plus size={13} />
            Nova meta
          </motion.button>
        </div>
      </div>

      {/* Alert banner */}
      {alerts.length > 0 && (
        <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-2xl">
          <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              {alerts.length} categoria{alerts.length > 1 ? 's' : ''} atingiu 80% do orçamento
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              {alerts.map(a => a.category).join(' · ')}
            </p>
          </div>
        </div>
      )}

      {/* KPI summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Orçado Despesas',    value: totalBudgetedDesp,  color: 'text-slate-700 dark:text-gray-200' },
          { label: 'Realizado Despesas', value: totalRealizedDesp,  color: totalRealizedDesp > totalBudgetedDesp && totalBudgetedDesp > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Orçado Receitas',    value: totalBudgetedRec,   color: 'text-slate-700 dark:text-gray-200' },
          { label: 'Realizado Receitas', value: totalRealizedRec,   color: totalRealizedRec >= totalBudgetedRec && totalBudgetedRec > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400' },
        ].map(k => (
          <div key={k.label} className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-slate-400 dark:text-gray-500 mb-1">{k.label}</p>
            <p className={`text-lg font-bold font-display ${k.color}`}>{formatCurrency(k.value)}</p>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      {chartData.length > 0 && (
        <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-800 dark:text-gray-200 mb-4">Orçado vs Realizado por Categoria</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#1E293B' : '#F1F5F9'} vertical={false} />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} width={52} />
              <RechartsTooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ background: isDark ? '#1e293b' : '#fff', border: isDark ? '1px solid #374151' : '1px solid #E2E8F0', borderRadius: 10, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Orçado (D)"    fill="#fca5a5" radius={[3,3,0,0]} />
              <Bar dataKey="Realizado (D)" fill="#ef4444" radius={[3,3,0,0]} />
              <Bar dataKey="Orçado (R)"    fill="#6ee7b7" radius={[3,3,0,0]} />
              <Bar dataKey="Realizado (R)" fill="#10b981" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Budget vs Realized table */}
      <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-slate-100 dark:border-gray-800 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-800 dark:text-gray-200">Metas por Categoria — {monthNames[selMonth - 1]} {selYear}</span>
          <span className="text-xs text-slate-400 dark:text-gray-500">{rows.length} categoria{rows.length !== 1 ? 's' : ''}</span>
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-gray-500">
            <Target size={40} strokeWidth={1.5} />
            <p className="mt-3 text-sm font-medium">Nenhuma meta definida para este mês</p>
            <p className="text-xs mt-1">Clique em "Nova meta" ou copie o mês anterior</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-gray-800">
            {/* Column headers */}
            <div className="grid grid-cols-12 px-5 py-2 text-[10px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wide">
              <div className="col-span-3">Categoria</div>
              <div className="col-span-2 text-right">Orçado</div>
              <div className="col-span-2 text-right">Realizado</div>
              <div className="col-span-2 text-right">Variação</div>
              <div className="col-span-2">Progresso</div>
              <div className="col-span-1" />
            </div>
            {rows.map(r => {
              const showDesp = r.budgetedDespesa > 0 || r.realizedDespesa > 0;
              const showRec  = r.budgetedReceita > 0 || r.realizedReceita > 0;
              return (
                <div key={r.category}>
                  {showDesp && (() => {
                    const pct     = r.budgetedDespesa > 0 ? Math.min(100, (r.realizedDespesa / r.budgetedDespesa) * 100) : 0;
                    const varAmt  = r.realizedDespesa - r.budgetedDespesa;
                    const isOver  = varAmt > 0 && r.budgetedDespesa > 0;
                    const barCls  = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-emerald-500';
                    return (
                      <div className="grid grid-cols-12 items-center px-5 py-3 hover:bg-slate-50 dark:hover:bg-gray-800/40 transition-colors">
                        <div className="col-span-3">
                          <p className="text-sm font-medium text-slate-800 dark:text-gray-200 truncate">{r.category}</p>
                          <span className="text-[10px] text-red-500 font-medium">Despesa</span>
                        </div>
                        <div className="col-span-2 text-right text-sm text-slate-600 dark:text-gray-400 tabular-nums">
                          {r.budgetedDespesa > 0 ? formatCurrency(r.budgetedDespesa) : '—'}
                        </div>
                        <div className="col-span-2 text-right text-sm font-semibold text-slate-800 dark:text-gray-200 tabular-nums">
                          {formatCurrency(r.realizedDespesa)}
                        </div>
                        <div className={`col-span-2 text-right text-sm font-semibold tabular-nums ${r.budgetedDespesa === 0 ? 'text-slate-400' : isOver ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                          {r.budgetedDespesa > 0 ? `${isOver ? '+' : ''}${formatCurrency(varAmt)}` : '—'}
                        </div>
                        <div className="col-span-2 pr-3">
                          {r.budgetedDespesa > 0 ? (
                            <div>
                              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-gray-800 overflow-hidden mb-0.5">
                                <div className={`h-full rounded-full transition-all ${barCls}`} style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[10px] text-slate-400">{pct.toFixed(0)}%</span>
                            </div>
                          ) : <span className="text-[10px] text-slate-300 dark:text-gray-600">sem meta</span>}
                        </div>
                        <div className="col-span-1 flex items-center justify-end gap-0.5">
                          <Tooltip title="Editar meta">
                            <IconButton size="small" onClick={() => openAdd(r.category, 'despesa', r.budgetDespId ?? null, r.budgetedDespesa.toString())} sx={{ color: '#94A3B8' }}>
                              <Edit3 size={13} />
                            </IconButton>
                          </Tooltip>
                          {r.budgetDespId && (
                            <Tooltip title="Remover meta">
                              <IconButton size="small" onClick={() => handleDelete(r.budgetDespId!)} sx={{ color: '#94A3B8', '&:hover': { color: '#EF4444' } }}>
                                <Trash2 size={13} />
                              </IconButton>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                  {showRec && (() => {
                    const pct    = r.budgetedReceita > 0 ? Math.min(100, (r.realizedReceita / r.budgetedReceita) * 100) : 0;
                    const varAmt = r.realizedReceita - r.budgetedReceita;
                    const isUnder = varAmt < 0 && r.budgetedReceita > 0;
                    const barCls  = pct >= 100 ? 'bg-emerald-500' : pct >= 80 ? 'bg-blue-400' : 'bg-amber-400';
                    return (
                      <div className="grid grid-cols-12 items-center px-5 py-3 hover:bg-slate-50 dark:hover:bg-gray-800/40 transition-colors bg-emerald-50/20 dark:bg-emerald-500/[0.03]">
                        <div className="col-span-3">
                          <p className="text-sm font-medium text-slate-800 dark:text-gray-200 truncate">{r.category}</p>
                          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Receita</span>
                        </div>
                        <div className="col-span-2 text-right text-sm text-slate-600 dark:text-gray-400 tabular-nums">
                          {r.budgetedReceita > 0 ? formatCurrency(r.budgetedReceita) : '—'}
                        </div>
                        <div className="col-span-2 text-right text-sm font-semibold text-slate-800 dark:text-gray-200 tabular-nums">
                          {formatCurrency(r.realizedReceita)}
                        </div>
                        <div className={`col-span-2 text-right text-sm font-semibold tabular-nums ${r.budgetedReceita === 0 ? 'text-slate-400' : isUnder ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                          {r.budgetedReceita > 0 ? `${varAmt >= 0 ? '+' : ''}${formatCurrency(varAmt)}` : '—'}
                        </div>
                        <div className="col-span-2 pr-3">
                          {r.budgetedReceita > 0 ? (
                            <div>
                              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-gray-800 overflow-hidden mb-0.5">
                                <div className={`h-full rounded-full transition-all ${barCls}`} style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[10px] text-slate-400">{pct.toFixed(0)}%</span>
                            </div>
                          ) : <span className="text-[10px] text-slate-300 dark:text-gray-600">sem meta</span>}
                        </div>
                        <div className="col-span-1 flex items-center justify-end gap-0.5">
                          <Tooltip title="Editar meta">
                            <IconButton size="small" onClick={() => openAdd(r.category, 'receita', r.budgetRecId ?? null, r.budgetedReceita.toString())} sx={{ color: '#94A3B8' }}>
                              <Edit3 size={13} />
                            </IconButton>
                          </Tooltip>
                          {r.budgetRecId && (
                            <Tooltip title="Remover meta">
                              <IconButton size="small" onClick={() => handleDelete(r.budgetRecId!)} sx={{ color: '#94A3B8', '&:hover': { color: '#EF4444' } }}>
                                <Trash2 size={13} />
                              </IconButton>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add/Edit budget dialog */}
      <Dialog open={showForm} onClose={() => setShowForm(false)} maxWidth="xs" fullWidth
        PaperProps={{ sx: { borderRadius: '20px', backgroundColor: isDark ? '#111827' : undefined } }}
      >
        <DialogTitle sx={{ fontFamily: '"Plus Jakarta Sans", sans-serif', fontWeight: 700, fontSize: '1rem', color: isDark ? '#F1F5F9' : undefined }}>
          {editId ? 'Editar Meta' : 'Nova Meta de Orçamento'}
        </DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <div className="space-y-3 pt-1">
            <div>
              <label className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1 block">Tipo</label>
              <div className="flex gap-2">
                {(['despesa', 'receita'] as const).map(t => (
                  <button key={t} onClick={() => setFormType(t)}
                    className={cn('flex-1 py-2 rounded-xl text-sm font-semibold border transition-all',
                      formType === t
                        ? t === 'despesa' ? 'bg-red-600 text-white border-red-600' : 'bg-emerald-600 text-white border-emerald-600'
                        : 'border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800'
                    )}
                  >{t === 'despesa' ? 'Despesa' : 'Receita'}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1 block">Categoria</label>
              <input
                list="budget-cats"
                value={formCat}
                onChange={e => setFormCat(e.target.value)}
                placeholder="Ex: Marketing, Aluguel, Serviços..."
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500/20"
              />
              <datalist id="budget-cats">
                {availableCategories.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1 block">Valor da Meta (R$)</label>
              <input
                type="number" min="0" step="0.01"
                value={formAmt}
                onChange={e => setFormAmt(e.target.value)}
                placeholder="0,00"
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500/20"
              />
            </div>
          </div>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setShowForm(false)} sx={{ color: '#64748B', textTransform: 'none', fontWeight: 600, borderRadius: '12px' }}>Cancelar</Button>
          <Button onClick={handleSave} disabled={isSaving || !formCat.trim() || !formAmt || parseFloat(formAmt) <= 0} variant="contained"
            sx={{ backgroundColor: '#DC2626', '&:hover': { backgroundColor: '#B91C1C' }, '&.Mui-disabled': { backgroundColor: '#FCA5A5', color: '#fff' }, textTransform: 'none', fontWeight: 700, borderRadius: '12px' }}
          >
            {isSaving ? 'Salvando...' : editId ? 'Salvar' : 'Criar Meta'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

// ==========================================
// INSTALLMENT GROUP DIALOG
// ==========================================

function InstallmentGroupDialog({
  groupTxs,
  isLoading,
  onClose,
  onUpdateDate,
  onMarkPaid,
  onCancel,
  onPayAll,
  showBalances,
}: {
  groupTxs: Transaction[];
  isLoading: boolean;
  onClose: () => void;
  onUpdateDate: (id: string, date: string) => Promise<void>;
  onMarkPaid: (id: string) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
  onPayAll: () => Promise<void>;
  showBalances: boolean;
}) {
  const formatCurrency = useCurrencyFormat();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const { isDark } = useTheme();

  const pendingCount = groupTxs.filter(t => t.status === 'pendente' || t.status === 'atrasado').length;
  const totalPaid = groupTxs.filter(t => t.status === 'pago').reduce((s, t) => s + t.amount, 0);
  const totalPending = groupTxs.filter(t => t.status === 'pendente' || t.status === 'atrasado').reduce((s, t) => s + t.amount, 0);
  const totalAmount = groupTxs.reduce((s, t) => s + (t.status !== 'cancelado' ? t.amount : 0), 0);

  const statusColors: Record<string, { bg: string; text: string }> = {
    pago:      { bg: '#D1FAE5', text: '#065F46' },
    pendente:  { bg: '#FEF3C7', text: '#92400E' },
    atrasado:  { bg: '#FEE2E2', text: '#991B1B' },
    cancelado: { bg: '#F1F5F9', text: '#94A3B8' },
  };

  async function commitDate(id: string) {
    if (!editingDate) { setEditingId(null); return; }
    setSaving(id);
    try { await onUpdateDate(id, editingDate); } finally { setSaving(null); setEditingId(null); }
  }

  const base = groupTxs[0];
  const title = base ? base.description.replace(/\s*\(\d+\/\d+\)\s*$/, '') : 'Parcelas';

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { borderRadius: '20px', backgroundColor: isDark ? '#111827' : undefined } }}
    >
      <DialogTitle sx={{ fontFamily: '"Plus Jakarta Sans", sans-serif', fontWeight: 700, fontSize: '1rem', color: isDark ? '#F1F5F9' : undefined, pb: 0 }}>
        <div className="flex items-center gap-2">
          <Layers size={18} className="text-violet-500" />
          <span>{title}</span>
          <span className="text-sm font-normal text-slate-400 dark:text-gray-500 ml-1">
            {groupTxs.length} parcela{groupTxs.length !== 1 ? 's' : ''}
          </span>
        </div>
      </DialogTitle>

      <DialogContent sx={{ pt: 2 }}>
        {/* Summary strip */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { label: 'Total', value: totalAmount, color: 'text-slate-800 dark:text-gray-100' },
            { label: 'Pago', value: totalPaid, color: 'text-emerald-600 dark:text-emerald-400' },
            { label: 'Pendente', value: totalPending, color: 'text-amber-600 dark:text-amber-400' },
          ].map(k => (
            <div key={k.label} className="bg-slate-50 dark:bg-gray-800/60 rounded-xl p-3 text-center">
              <p className="text-[10px] text-slate-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">{k.label}</p>
              <p className={cn('text-sm font-bold font-display', k.color)}>{showBalances ? formatCurrency(k.value) : 'R$ ****'}</p>
            </div>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-slate-400 dark:text-gray-500">
            <div className="w-6 h-6 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-100 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-gray-800/60">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wide">#</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wide">Vencimento</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wide">Valor</th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wide">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-gray-800">
                {groupTxs.map((tx) => {
                  const sc = statusColors[tx.status] ?? statusColors.pendente;
                  const isEditing = editingId === tx.id;
                  const isCancelled = tx.status === 'cancelado';
                  const isPaid = tx.status === 'pago';
                  return (
                    <tr key={tx.id} className={cn('transition-colors', isCancelled && 'opacity-40')}>
                      <td className="px-4 py-3">
                        <span className="w-6 h-6 rounded-full bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs font-bold flex items-center justify-center">
                          {tx.installmentNumber}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="date"
                              value={editingDate}
                              onChange={e => setEditingDate(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') commitDate(tx.id); if (e.key === 'Escape') setEditingId(null); }}
                              autoFocus
                              className="border border-violet-300 dark:border-violet-600 rounded-lg px-2 py-1 text-sm bg-white dark:bg-gray-900 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
                            />
                            <button onClick={() => commitDate(tx.id)} disabled={!!saving} className="p-1 text-emerald-600 hover:text-emerald-700 disabled:opacity-50">
                              {saving === tx.id ? <div className="w-3.5 h-3.5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" /> : <CheckCircle2 size={15} />}
                            </button>
                            <button onClick={() => setEditingId(null)} className="p-1 text-slate-400 hover:text-slate-600"><X size={15} /></button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { if (!isCancelled && !isPaid) { setEditingId(tx.id); setEditingDate(tx.dueDate || ''); } }}
                            className={cn('flex items-center gap-1.5 text-sm text-slate-600 dark:text-gray-400 group/date', !isCancelled && !isPaid && 'hover:text-violet-600 dark:hover:text-violet-400 cursor-pointer')}
                          >
                            {formatDate(tx.dueDate)}
                            {!isCancelled && !isPaid && <CalendarDays size={12} className="opacity-0 group-hover/date:opacity-100 transition-opacity text-violet-500" />}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800 dark:text-gray-200 tabular-nums">
                        {showBalances ? formatCurrency(tx.amount) : '****'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: sc.bg, color: sc.text }}>
                          {tx.status === 'pago' ? 'Pago' : tx.status === 'pendente' ? 'Pendente' : tx.status === 'atrasado' ? 'Atrasado' : 'Cancelado'}
                        </span>
                        {tx.status === 'pago' && tx.paymentDate && (
                          <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-0.5">{formatDate(tx.paymentDate)}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {(tx.status === 'pendente' || tx.status === 'atrasado') && (
                            <Tooltip title="Quitar parcela">
                              <IconButton size="small" onClick={() => onMarkPaid(tx.id)} sx={{ color: '#10B981', '&:hover': { backgroundColor: '#D1FAE5' } }}>
                                <CheckCircle2 size={15} />
                              </IconButton>
                            </Tooltip>
                          )}
                          {(tx.status === 'pendente' || tx.status === 'atrasado') && (
                            <Tooltip title="Cancelar parcela">
                              <IconButton size="small" onClick={() => onCancel(tx.id)} sx={{ color: '#94A3B8', '&:hover': { color: '#EF4444', backgroundColor: '#FEE2E2' } }}>
                                <XCircle size={15} />
                              </IconButton>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>

      <Divider />
      <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
        <div>
          {pendingCount > 0 && (
            <Button
              onClick={onPayAll}
              variant="outlined"
              startIcon={<ChevronsRight size={15} />}
              sx={{ textTransform: 'none', borderRadius: '10px', borderColor: '#10B981', color: '#10B981', fontWeight: 600, '&:hover': { backgroundColor: '#D1FAE5', borderColor: '#10B981' } }}
            >
              Quitar {pendingCount} pendente{pendingCount > 1 ? 's' : ''}
            </Button>
          )}
        </div>
        <Button onClick={onClose} sx={{ color: '#64748B', textTransform: 'none', fontWeight: 600, borderRadius: '10px' }}>
          Fechar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function TransactionsContent({
  transactions, allTransactions, filterTab, onFilterChange,
  search, onSearchChange, sortField, sortDir, onSort,
  onMarkPaid, onRevertPaid, onEdit, onDelete, onViewInstallments,
  getStatusChipColor, statusLabel, getIsLocked,
  dateFrom, onDateFromChange, dateTo, onDateToChange,
  category, onCategoryChange, bankAccount, onBankAccountChange,
  paymentMethod, onPaymentMethodChange, sectorId, onSectorIdChange,
  clientName, onClientNameChange,
  availableCategories, bankAccounts,
  onSaveFilters, onClearFilters,
}: {
  transactions: Transaction[];
  allTransactions: Transaction[];
  filterTab: string;
  onFilterChange: (v: 'todas' | 'receitas' | 'despesas' | 'pendentes' | 'atrasadas') => void;
  search: string;
  onSearchChange: (v: string) => void;
  sortField: string;
  sortDir: 'asc' | 'desc';
  onSort: (f: string) => void;
  onMarkPaid: (id: string) => void;
  onRevertPaid: (id: string) => void;
  onEdit: (t: Transaction) => void;
  onDelete: (id: string) => void;
  onViewInstallments: (groupId: string) => void;
  getStatusChipColor: (s: TransactionStatus) => { bg: string; text: string; border: string };
  statusLabel: (s: TransactionStatus) => string;
  getIsLocked: (t: Transaction) => boolean;
  dateFrom: string; onDateFromChange: (v: string) => void;
  dateTo: string;   onDateToChange:   (v: string) => void;
  category: string; onCategoryChange: (v: string) => void;
  bankAccount: string; onBankAccountChange: (v: string) => void;
  paymentMethod: string; onPaymentMethodChange: (v: string) => void;
  sectorId: string; onSectorIdChange: (v: string) => void;
  clientName: string; onClientNameChange: (v: string) => void;
  availableCategories: string[];
  bankAccounts: import('@/lib/types').BankAccount[];
  onSaveFilters: () => void;
  onClearFilters: () => void;
}) {
  const formatCurrency = useCurrencyFormat();
  const { t } = useTranslation();
  const { sectors } = useAuth();
  const [showFilters, setShowFilters] = useState(false);

  const filterTabs = [
    { key: 'todas', label: t('financial.txFilter.all', 'Todas'), count: allTransactions.length },
    { key: 'receitas', label: t('financial.txFilter.income', 'Receitas'), count: allTransactions.filter((tx) => tx.type === 'receita').length },
    { key: 'despesas', label: t('financial.txFilter.expenses', 'Despesas'), count: allTransactions.filter((tx) => tx.type === 'despesa').length },
    { key: 'pendentes', label: t('financial.txFilter.pending', 'Pendentes'), count: allTransactions.filter((tx) => tx.status === 'pendente').length },
    { key: 'atrasadas', label: t('financial.txFilter.overdue', 'Atrasadas'), count: allTransactions.filter((tx) => tx.status === 'atrasado').length },
  ];

  const activeFilterCount = [dateFrom, dateTo, category, bankAccount, paymentMethod, sectorId, clientName].filter(Boolean).length;

  const inputCls = 'w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 transition-all';
  const labelCls = 'block text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500 mb-1';

  return (
    <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl">
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <h3 className="text-base font-display font-bold text-slate-900 dark:text-gray-100">{t('financial.txList.title', 'Transações')}</h3>
          <div className="flex items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
              <input type="text" placeholder={t('financial.txList.searchPlaceholder', 'Buscar transação...')} value={search} onChange={(e) => onSearchChange(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-xl text-sm text-slate-900 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
              />
            </div>
            <button
              onClick={() => exportTransactionsCSV(transactions)}
              title={t('financial.export.csvTooltip', 'Exportar CSV')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
            >
              <Download size={13} /> CSV
            </button>
            <button
              onClick={() => exportTransactionsPDF(transactions, '', t('financial.export.allPeriods', 'Todos os períodos'))}
              title={t('financial.export.pdfTooltip', 'Exportar PDF')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
            >
              <Download size={13} /> PDF
            </button>
            {/* Advanced filters toggle */}
            <button
              onClick={() => setShowFilters(v => !v)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-colors',
                showFilters || activeFilterCount > 0
                  ? 'border-red-400 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'
                  : 'border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-white/[0.04]'
              )}
            >
              <Filter size={13} />
              Filtros
              {activeFilterCount > 0 && (
                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold">{activeFilterCount}</span>
              )}
            </button>
          </div>
        </div>

        {/* ── Advanced filter panel ── */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-3 p-4 bg-slate-50 dark:bg-gray-800/40 rounded-xl border border-slate-200 dark:border-gray-700 space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {/* Date range */}
                  <div>
                    <label className={labelCls}>De</label>
                    <input type="date" value={dateFrom} onChange={e => onDateFromChange(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Até</label>
                    <input type="date" value={dateTo} onChange={e => onDateToChange(e.target.value)} className={inputCls} />
                  </div>

                  {/* Category */}
                  <div>
                    <label className={labelCls}>Categoria</label>
                    <select value={category} onChange={e => onCategoryChange(e.target.value)} className={inputCls}>
                      <option value="">Todas</option>
                      {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>

                  {/* Bank account */}
                  <div>
                    <label className={labelCls}>Conta Bancária</label>
                    <select value={bankAccount} onChange={e => onBankAccountChange(e.target.value)} className={inputCls}>
                      <option value="">Todas</option>
                      {bankAccounts.filter(a => a.isActive).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>

                  {/* Payment method */}
                  <div>
                    <label className={labelCls}>Forma de Pagamento</label>
                    <select value={paymentMethod} onChange={e => onPaymentMethodChange(e.target.value)} className={inputCls}>
                      <option value="">Todas</option>
                      <option value="dinheiro">Dinheiro</option>
                      <option value="pix">PIX</option>
                      <option value="credito">Cartão de Crédito</option>
                      <option value="debito">Cartão de Débito</option>
                      <option value="boleto">Boleto</option>
                      <option value="creditoLoja">Crédito em Loja</option>
                      <option value="outros">Outros</option>
                    </select>
                  </div>

                  {/* Sector */}
                  <div>
                    <label className={labelCls}>Setor</label>
                    <select value={sectorId} onChange={e => onSectorIdChange(e.target.value)} className={inputCls}>
                      <option value="">Todos</option>
                      {sectors.filter(s => s.isActive).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>

                  {/* Client */}
                  <div>
                    <label className={labelCls}>Cliente</label>
                    <input
                      type="text"
                      value={clientName}
                      onChange={e => onClientNameChange(e.target.value)}
                      placeholder="Nome do cliente..."
                      className={inputCls}
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex items-end gap-2">
                    <button
                      onClick={onClearFilters}
                      className="flex-1 px-3 py-1.5 rounded-xl text-xs font-medium border border-slate-200 dark:border-gray-700 text-slate-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-900 transition-colors"
                    >
                      Limpar
                    </button>
                    <button
                      onClick={onSaveFilters}
                      className="flex-1 px-3 py-1.5 rounded-xl text-xs font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
                    >
                      Salvar
                    </button>
                  </div>
                </div>

                {activeFilterCount > 0 && (
                  <p className="text-[11px] text-slate-500 dark:text-gray-400">
                    {activeFilterCount} filtro{activeFilterCount > 1 ? 's' : ''} ativo{activeFilterCount > 1 ? 's' : ''} — mostrando {transactions.length} de {allTransactions.length} transações
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex gap-1 overflow-x-auto mt-3">
          {filterTabs.map((tab) => (
            <button key={tab.key} onClick={() => onFilterChange(tab.key as 'todas' | 'receitas' | 'despesas' | 'pendentes' | 'atrasadas')}
              className={cn('flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-200',
                filterTab === tab.key ? 'bg-gradient-to-r from-red-600 to-red-500 text-white shadow-sm shadow-red-500/20' : 'text-slate-500 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-white/[0.04] hover:text-slate-700 dark:hover:text-gray-300'
              )}
            >
              {tab.label}
              <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', filterTab === tab.key ? 'bg-white/25 text-white' : 'bg-slate-100 dark:bg-gray-800 text-slate-400 dark:text-gray-500')}>{tab.count}</span>
            </button>
          ))}
        </div>
      </div>
      <Divider />

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left">
              {[
                { key: 'dueDate', label: t('financial.txList.colDate', 'Data') },
                { key: 'description', label: t('financial.txList.colDescription', 'Descrição') },
                { key: 'category', label: t('financial.txList.colCategory', 'Categoria') },
                { key: 'type', label: t('financial.txList.colType', 'Tipo') },
                { key: 'amount', label: t('financial.txList.colAmount', 'Valor') },
                { key: 'status', label: t('financial.txList.colStatus', 'Status') },
                { key: 'actions', label: '' },
              ].map((col) => (
                <th key={col.key} onClick={() => col.key !== 'actions' && onSort(col.key)}
                  className={cn('px-5 py-3 text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wider', col.key !== 'actions' && 'cursor-pointer hover:text-slate-600 dark:hover:text-gray-300')}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {sortField === col.key && <ChevronDown size={11} className={cn('transition-transform', sortDir === 'asc' && 'rotate-180')} />}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-gray-800">
            <AnimatePresence>
              {transactions.map((tx, i) => {
                const sc = getStatusChipColor(tx.status);
                const locked = getIsLocked(tx);
                return (
                  <motion.tr key={tx.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ delay: i * 0.015 }}
                    className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors group"
                  >
                    <td className="px-5 py-3 text-sm text-slate-500 dark:text-gray-400 whitespace-nowrap">{formatDate(tx.dueDate)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-medium text-slate-800 dark:text-gray-200 truncate max-w-[200px]">{tx.description}</p>
                        {tx.installmentGroupId && (
                          <Tooltip title="Ver grupo de parcelas">
                            <button
                              onClick={(e) => { e.stopPropagation(); onViewInstallments(tx.installmentGroupId!); }}
                              className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-500/20 border border-violet-200/60 dark:border-violet-500/20 transition-colors shrink-0"
                            >
                              <Layers size={9} />
                              {tx.installmentNumber}/{tx.installmentTotal}
                            </button>
                          </Tooltip>
                        )}
                        {tx.attachments && tx.attachments.length > 0 && (
                          <Tooltip title={`${tx.attachments.length} anexo(s)`}>
                            <Paperclip size={14} className="text-slate-400 dark:text-gray-500 shrink-0" />
                          </Tooltip>
                        )}
                      </div>
                      {tx.clientName && <p className="text-xs text-slate-400 dark:text-gray-500 truncate">{tx.clientName}</p>}
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-[11px] font-medium text-slate-500 dark:text-gray-400 bg-slate-100 dark:bg-gray-800 px-2.5 py-1 rounded-full">{tx.category}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full',
                        tx.type === 'receita' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400'
                      )}>
                        {tx.type === 'receita' ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                        {tx.type === 'receita' ? t('financial.form.income', 'Receita') : t('financial.form.expense', 'Despesa')}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={cn('text-sm font-bold', tx.type === 'receita' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                        {tx.type === 'receita' ? '+' : '-'}{formatCurrency(tx.amount)}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {(tx.status === 'pendente' || tx.status === 'atrasado') ? (
                        <Tooltip title={t('financial.txList.markAsPaid', 'Marcar como pago')}>
                          <button onClick={() => onMarkPaid(tx.id)} className="inline-flex">
                            <Chip label={statusLabel(tx.status)} size="small" sx={{ backgroundColor: sc.bg, color: sc.text, border: `1px solid ${sc.border}`, fontWeight: 600, fontSize: '0.65rem', cursor: 'pointer', '&:hover': { opacity: 0.8 } }} />
                          </button>
                        </Tooltip>
                      ) : (
                        <Chip label={statusLabel(tx.status)} size="small" sx={{ backgroundColor: sc.bg, color: sc.text, border: `1px solid ${sc.border}`, fontWeight: 600, fontSize: '0.65rem' }} />
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {locked ? (
                        <Tooltip title="Vinculado a documento fiscal autorizado — não pode ser alterado">
                          <div className="flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                            <Lock size={14} className="text-amber-500" />
                          </div>
                        </Tooltip>
                      ) : (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {tx.status === 'pago' && (
                            <Tooltip title={t('financial.txList.revertPaid', 'Reverter para pendente')}>
                              <IconButton size="small" onClick={() => onRevertPaid(tx.id)} sx={{ color: '#64748B', '&:hover': { color: '#F59E0B' } }}>
                                <RotateCcw size={14} />
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip title={t('financial.txList.edit', 'Editar')}><IconButton size="small" onClick={() => onEdit(tx)} sx={{ color: '#64748B' }}><Edit3 size={14} /></IconButton></Tooltip>
                          <Tooltip title={t('financial.txList.delete', 'Excluir')}><IconButton size="small" onClick={() => onDelete(tx.id)} sx={{ color: '#64748B', '&:hover': { color: '#EF4444' } }}><Trash2 size={14} /></IconButton></Tooltip>
                        </div>
                      )}
                    </td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      {transactions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-gray-500">
          <Receipt size={36} strokeWidth={1.5} />
          <p className="mt-3 text-sm">
            {(activeFilterCount > 0 || search) ? 'Nenhum resultado para estes filtros' : t('financial.txList.empty', 'Nenhuma transação encontrada')}
          </p>
          {(activeFilterCount > 0 || search) && (
            <button onClick={onClearFilters} className="mt-4 px-4 py-2 bg-slate-100 dark:bg-gray-800 hover:bg-slate-200 dark:hover:bg-gray-700 text-slate-600 dark:text-gray-300 rounded-xl text-sm font-medium transition-colors">
              Limpar Filtros
            </button>
          )}
        </div>
      )}

      <div className="px-6 py-3 border-t border-slate-100 dark:border-gray-800 text-sm text-slate-400 dark:text-gray-500">
        {t('financial.txList.count', '{{count}} transação(ões)', { count: transactions.length })}
      </div>
    </div>
  );
}

// ==========================================
// TAB: COMISSÕES
// ==========================================

type CommissionPeriod = 'mes' | 'mes_anterior' | 'personalizado' | 'todos';

interface ProfessionalCommissionGroup {
  professionalId: string;
  professionalName: string;
  totalPendente: number;
  totalPago: number;
  totalCancelado: number;
  totalGeral: number;
  transactions: Transaction[];
}

function CommissionsContent({
  transactions,
  onMarkPaid,
  showBalances,
  businessName,
}: {
  transactions: Transaction[];
  onMarkPaid: (id: string) => void;
  showBalances: boolean;
  businessName: string;
}) {
  const formatCurrency = useCurrencyFormat();
  const { business } = useAuth();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<CommissionPeriod>('mes');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [expandedProfessional, setExpandedProfessional] = useState<string | null>(null);
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);
  const [payingAll, setPayingAll]     = useState<string | null>(null);
  const [showRules, setShowRules]     = useState(false);
  const [editingRate, setEditingRate] = useState<{ uid: string; value: string } | null>(null);
  const [savingRate, setSavingRate]   = useState(false);

  // Load business members for commission rules panel
  const { data: members = [] } = useTanstackQuery<import('@/lib/types').User[]>({
    queryKey: ['members', business?.id],
    queryFn: async () => {
      if (!business?.id) return [];
      const snap = await getDocs(query(collection(db, 'users'), where('businessId', '==', business.id)));
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as import('@/lib/types').User));
    },
    enabled: !!business?.id && showRules,
    staleTime: 2 * 60 * 1000,
  });

  const handleSaveRate = async (uid: string, rate: number) => {
    if (isNaN(rate) || rate < 0 || rate > 100) { toast.error('Taxa deve ser entre 0 e 100%'); return; }
    setSavingRate(true);
    try {
      await updateDoc(doc(db, 'users', uid), { commissionRate: rate });
      queryClient.invalidateQueries({ queryKey: ['members', business?.id] });
      setEditingRate(null);
      toast.success('Taxa de comissão atualizada');
    } finally { setSavingRate(false); }
  };

  // Filter commission transactions by period
  const commissionTx = useMemo<Transaction[]>(() => {
    const all = transactions.filter(t => t.category === 'Comissoes' && t.type === 'despesa');
    if (period === 'todos') return all;
    if (period === 'personalizado') {
      return all.filter(t => {
        const d = t.dueDate ?? '';
        return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
      });
    }
    const now = new Date();
    const monthOffset = period === 'mes_anterior' ? -1 : 0;
    const y = now.getFullYear();
    const m = now.getMonth() + monthOffset;
    const start = new Date(y, m, 1).toISOString().slice(0, 10);
    const end   = new Date(y, m + 1, 0).toISOString().slice(0, 10);
    return all.filter(t => t.dueDate && t.dueDate >= start && t.dueDate <= end);
  }, [transactions, period, dateFrom, dateTo]);

  // Group by professional
  const grouped = useMemo<ProfessionalCommissionGroup[]>(() => {
    const map = new Map<string, ProfessionalCommissionGroup>();
    for (const tx of commissionTx) {
      const key = tx.clientId || tx.clientName || 'unknown';
      const name = tx.clientName || 'Profissional';
      if (!map.has(key)) {
        map.set(key, { professionalId: key, professionalName: name, totalPendente: 0, totalPago: 0, totalCancelado: 0, totalGeral: 0, transactions: [] });
      }
      const g = map.get(key)!;
      g.transactions.push(tx);
      if (tx.status === 'pago') { g.totalPago += tx.amount; g.totalGeral += tx.amount; }
      else if (tx.status === 'cancelado') { g.totalCancelado += tx.amount; }
      else { g.totalPendente += tx.amount; g.totalGeral += tx.amount; }
    }
    return Array.from(map.values()).sort((a, b) => b.totalGeral - a.totalGeral);
  }, [commissionTx]);

  const kpis = useMemo(() => ({
    pendente: commissionTx.filter(t => t.status === 'pendente').reduce((s, t) => s + t.amount, 0),
    pago:     commissionTx.filter(t => t.status === 'pago').reduce((s, t) => s + t.amount, 0),
    total:    commissionTx.filter(t => t.status !== 'cancelado').reduce((s, t) => s + t.amount, 0),
  }), [commissionTx]);

  const periodLabels: Record<CommissionPeriod, string> = {
    mes: 'Este mês',
    mes_anterior: 'Mês anterior',
    personalizado: 'Período',
    todos: 'Todos',
  };

  const periodLabel = period === 'personalizado' && (dateFrom || dateTo)
    ? `${dateFrom ? formatDate(dateFrom) : '...'} – ${dateTo ? formatDate(dateTo) : '...'}`
    : periodLabels[period];

  const handleMarkPaid = async (id: string) => {
    setMarkingPaid(id);
    try { await onMarkPaid(id); } finally { setMarkingPaid(null); }
  };

  const handlePayAll = async (group: ProfessionalCommissionGroup) => {
    const pending = group.transactions.filter(t => t.status === 'pendente');
    if (!pending.length) return;
    setPayingAll(group.professionalId);
    try {
      const results = await Promise.allSettled(pending.map(t => onMarkPaid(t.id)));
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) toast.error(`${failed} comissão(ões) não foram pagas`);
      else toast.success(`${pending.length} comissão(ões) pagas`);
    } finally { setPayingAll(null); }
  };

  const statusChip = (status: TransactionStatus) => {
    if (status === 'pago')      return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700/40';
    if (status === 'cancelado') return 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700';
    return 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700/40';
  };
  const statusText = (status: TransactionStatus) => ({
    pendente: 'Pendente', pago: 'Pago', cancelado: 'Cancelado', atrasado: 'Atrasado'
  }[status] ?? status);

  const csvRows: CommissionRow[] = commissionTx.map(t => ({
    professionalName: t.clientName ?? '—',
    description: t.description,
    date: t.dueDate ?? '',
    amount: t.amount,
    status: t.status,
    notes: t.notes ?? '',
  }));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-display">Comissões</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{commissionTx.length} lançamento(s) · {periodLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={() => setShowRules(v => !v)}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors',
              showRules ? 'border-violet-400 bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400' : 'border-slate-200 dark:border-gray-700 text-slate-500 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800'
            )}
          >
            <Settings2 size={13} />
            Regras
          </motion.button>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={() => exportCommissionsCSV(csvRows, periodLabel, businessName)}
            disabled={csvRows.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800 disabled:opacity-40 transition-all"
          >
            <Download size={13} /> CSV
          </motion.button>
        </div>
      </div>

      {/* Commission rules panel */}
      <AnimatePresence>
        {showRules && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="bg-white dark:bg-gray-900 border border-violet-200 dark:border-violet-500/20 rounded-2xl overflow-hidden shadow-sm">
              <div className="px-5 py-3 border-b border-violet-100 dark:border-violet-500/10 bg-violet-50/50 dark:bg-violet-500/5">
                <p className="text-sm font-semibold text-violet-800 dark:text-violet-200">Regras de Comissão por Profissional</p>
                <p className="text-xs text-violet-600 dark:text-violet-400 mt-0.5">Taxa padrão do profissional. Serviços individuais podem sobrescrever.</p>
              </div>
              {members.length === 0 ? (
                <div className="flex items-center justify-center py-6 text-slate-400 dark:text-gray-500 text-sm">
                  <Loader2 size={16} className="animate-spin mr-2" /> Carregando membros...
                </div>
              ) : (
                <div className="divide-y divide-slate-50 dark:divide-gray-800">
                  {members.filter(m => m.name).map(m => (
                    <div key={m.id} className="flex items-center gap-4 px-5 py-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-red-100 to-rose-100 dark:from-red-900/40 dark:to-rose-900/30 flex items-center justify-center text-xs font-bold text-red-700 dark:text-red-400 shrink-0">
                        {(m.name || '?').split(' ').map((n: string) => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 dark:text-gray-200 truncate">{m.name}</p>
                        <p className="text-[11px] text-slate-400 dark:text-gray-500">{m.role}</p>
                      </div>
                      {editingRate?.uid === m.id ? (
                        <div className="flex items-center gap-2">
                          <input type="number" min="0" max="100" step="0.5"
                            value={editingRate.value}
                            onChange={e => setEditingRate({ uid: m.id, value: e.target.value })}
                            onKeyDown={e => { if (e.key === 'Enter') handleSaveRate(m.id, parseFloat(editingRate.value)); if (e.key === 'Escape') setEditingRate(null); }}
                            className="w-20 px-2 py-1 text-sm rounded-lg border border-violet-300 dark:border-violet-600 bg-white dark:bg-gray-900 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
                            autoFocus
                          />
                          <span className="text-sm text-slate-500">%</span>
                          <button onClick={() => handleSaveRate(m.id, parseFloat(editingRate.value))} disabled={savingRate}
                            className="px-2 py-1 rounded-lg bg-violet-600 text-white text-xs font-medium disabled:opacity-50"
                          >{savingRate ? '...' : '✓'}</button>
                          <button onClick={() => setEditingRate(null)} className="p-1 text-slate-400 hover:text-slate-600"><X size={14} /></button>
                        </div>
                      ) : (
                        <button onClick={() => setEditingRate({ uid: m.id, value: String(m.commissionRate ?? 0) })}
                          className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-slate-200 dark:border-gray-700 hover:border-violet-300 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-colors"
                        >
                          <span className={cn('text-sm font-bold', (m.commissionRate ?? 0) > 0 ? 'text-violet-600 dark:text-violet-400' : 'text-slate-400')}>{m.commissionRate ?? 0}%</span>
                          <Edit3 size={11} className="text-slate-400" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'A Pagar', value: kpis.pendente, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10', border: 'border-amber-200/60 dark:border-amber-700/30' },
          { label: 'Pagas',   value: kpis.pago,     color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10', border: 'border-emerald-200/60 dark:border-emerald-700/30' },
          { label: 'Total',   value: kpis.total,    color: 'text-slate-800 dark:text-gray-100', bg: 'bg-white dark:bg-gray-900', border: 'border-slate-200 dark:border-gray-800' },
        ].map(kpi => (
          <div key={kpi.label} className={`${kpi.bg} ${kpi.border} border rounded-2xl px-5 py-4`}>
            <p className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">{kpi.label}</p>
            <p className={`text-2xl font-display font-bold ${kpi.color}`}>
              {showBalances ? formatCurrency(kpi.value) : 'R$ ****'}
            </p>
          </div>
        ))}
      </div>

      {/* List card */}
      <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl overflow-hidden">
        {/* Header + period filter */}
        <div className="px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 dark:border-gray-800">
          <div>
            <h3 className="text-base font-display font-bold text-slate-900 dark:text-gray-100">Por Profissional</h3>
            <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">Clique para expandir · "Pagar todas" quita as pendentes de uma vez</p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex gap-1 p-1 bg-slate-50 dark:bg-gray-800 rounded-xl">
              {(Object.entries(periodLabels) as [CommissionPeriod, string][]).map(([key, label]) => (
                <button key={key} onClick={() => setPeriod(key)}
                  className={cn('px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
                    period === key ? 'bg-white dark:bg-gray-700 text-slate-900 dark:text-gray-100 shadow-sm' : 'text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300'
                  )}
                >{label}</button>
              ))}
            </div>
            {period === 'personalizado' && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="px-2 py-1 text-xs rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
                <span className="text-slate-400 text-xs">–</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="px-2 py-1 text-xs rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>
            )}
          </div>
        </div>

        {grouped.length === 0 ? (
          <div className="py-16 flex flex-col items-center text-slate-400 dark:text-gray-500">
            <Users size={40} strokeWidth={1.5} />
            <p className="mt-3 text-sm font-medium">Nenhuma comissão no período</p>
            <p className="text-xs mt-1">Configure a taxa de comissão dos profissionais clicando em "Regras"</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-gray-800">
            {grouped.map(group => {
              const paidPct = group.totalGeral > 0 ? (group.totalPago / group.totalGeral) * 100 : 0;
              const hasPending = group.totalPendente > 0;
              return (
                <div key={group.professionalId}>
                  <div className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                    {/* Expand button */}
                    <button type="button"
                      onClick={() => setExpandedProfessional(expandedProfessional === group.professionalId ? null : group.professionalId)}
                      className="flex items-center gap-4 flex-1 min-w-0 text-left"
                    >
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-red-100 to-rose-100 dark:from-red-900/40 dark:to-rose-900/30 border border-red-200/60 dark:border-red-800/40 flex items-center justify-center text-xs font-bold text-red-700 dark:text-red-400 flex-shrink-0">
                        {(group.professionalName || '?').split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-gray-100 truncate">{group.professionalName}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1 rounded-full bg-slate-100 dark:bg-gray-800 overflow-hidden max-w-[80px]">
                            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${paidPct}%` }} />
                          </div>
                          <span className="text-[10px] text-slate-400 dark:text-gray-500">{paidPct.toFixed(0)}% pago</span>
                        </div>
                      </div>
                    </button>
                    {/* Totals + actions */}
                    <div className="hidden sm:flex items-center gap-4 text-right shrink-0">
                      <div>
                        <p className="text-[10px] text-slate-400 dark:text-gray-500 uppercase tracking-wide">Pendente</p>
                        <p className="text-sm font-bold text-amber-600 dark:text-amber-400">{showBalances ? formatCurrency(group.totalPendente) : '****'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400 dark:text-gray-500 uppercase tracking-wide">Pago</p>
                        <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{showBalances ? formatCurrency(group.totalPago) : '****'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400 dark:text-gray-500 uppercase tracking-wide">Total</p>
                        <p className="text-sm font-bold text-slate-800 dark:text-gray-100">{showBalances ? formatCurrency(group.totalGeral) : '****'}</p>
                      </div>
                    </div>
                    {hasPending && (
                      <button onClick={() => handlePayAll(group)} disabled={payingAll === group.professionalId}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors shrink-0"
                      >
                        {payingAll === group.professionalId
                          ? <Loader2 size={12} className="animate-spin" />
                          : <><ChevronsRight size={12} /> Pagar todas</>}
                      </button>
                    )}
                    <ChevronDown size={16}
                      onClick={() => setExpandedProfessional(expandedProfessional === group.professionalId ? null : group.professionalId)}
                      className={cn('text-slate-400 dark:text-gray-500 transition-transform flex-shrink-0 cursor-pointer', expandedProfessional === group.professionalId && 'rotate-180')}
                    />
                  </div>

                  {/* Expanded transactions */}
                  <AnimatePresence>
                    {expandedProfessional === group.professionalId && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                        <div className="bg-slate-50/70 dark:bg-white/[0.01] border-t border-slate-100 dark:border-gray-800/60">
                          {group.transactions
                            .sort((a, b) => (b.dueDate ?? '').localeCompare(a.dueDate ?? ''))
                            .map(tx => (
                            <div key={tx.id} className="flex items-center gap-3 px-6 py-3 border-b border-slate-100 dark:border-gray-800/40 last:border-0">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-slate-800 dark:text-gray-200 truncate">{tx.description}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <p className="text-[11px] text-slate-400 dark:text-gray-500">{formatDate(tx.dueDate)}</p>
                                  {tx.notes && <p className="text-[11px] text-slate-400 dark:text-gray-500 truncate">· {tx.notes}</p>}
                                </div>
                              </div>
                              <p className="text-sm font-bold text-slate-800 dark:text-gray-100 flex-shrink-0">{showBalances ? formatCurrency(tx.amount) : '****'}</p>
                              <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-lg border flex-shrink-0', statusChip(tx.status))}>{statusText(tx.status)}</span>
                              {tx.status === 'pendente' && (
                                <button onClick={() => handleMarkPaid(tx.id)} disabled={markingPaid === tx.id}
                                  className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[11px] font-semibold transition-colors"
                                >
                                  {markingPaid === tx.id ? <span className="w-3 h-3 border border-white/60 border-t-white rounded-full animate-spin" /> : <><CheckCircle2 size={12} /> Pagar</>}
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// TAB: DRE
// ==========================================

type DrePeriod = 'mensal' | 'trimestral' | 'anual';

interface DreSection {
  label: string;
  value: number;
  isTotal?: boolean;
  isSubtotal?: boolean;
  indent?: boolean;
  positive?: boolean; // for coloring: green if positive result
  items?: { label: string; value: number }[];
}

// Cost categories (direct costs of services/products)
const CPV_CATEGORIES = new Set(['Infraestrutura', 'Software', 'Energia', 'Aluguel']);
// Deductions (taxes)
const DEDUCAO_CATEGORIES = new Set(['Impostos']);
// Financial results
const FINANCEIRO_RECEITA_CATEGORIES = new Set(['Juros']);

function DREContent({ transactions, businessName }: { transactions: Transaction[]; businessName: string }) {
  const formatCurrency = useCurrencyFormat();
  const { sectors } = useAuth();
  const [period, setPeriod] = useState<DrePeriod>('mensal');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()));
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'consolidado' | 'por-setor'>('consolidado');

  // Filter transactions by period
  const periodTransactions = useMemo(() => {
    const paid = transactions.filter(t => t.status === 'pago' && t.paymentDate);
    if (period === 'mensal') {
      return paid.filter(t => t.paymentDate!.startsWith(selectedMonth));
    }
    if (period === 'trimestral') {
      const [y, m] = selectedMonth.split('-').map(Number);
      const months: string[] = [];
      for (let i = 0; i < 3; i++) {
        const date = new Date(y, m - 1 - i, 1);
        months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
      }
      return paid.filter(t => months.some(mo => t.paymentDate!.startsWith(mo)));
    }
    // anual
    return paid.filter(t => t.paymentDate!.startsWith(selectedYear));
  }, [transactions, period, selectedMonth, selectedYear]);

  // DRE computation
  const dre = useMemo(() => {
    const receitas = periodTransactions.filter(t => t.type === 'receita');
    const despesas = periodTransactions.filter(t => t.type === 'despesa');

    // 1. Receita Bruta breakdown by category
    const receitaByCategory = new Map<string, number>();
    let receitaBruta = 0;
    for (const t of receitas) {
      if (FINANCEIRO_RECEITA_CATEGORIES.has(t.category || '')) continue; // juros handled separately
      const cat = t.category || 'Outros';
      receitaByCategory.set(cat, (receitaByCategory.get(cat) || 0) + t.amount);
      receitaBruta += t.amount;
    }

    // 2. Deduções (taxes)
    const deducaoByCategory = new Map<string, number>();
    let totalDeducoes = 0;
    for (const t of despesas) {
      if (DEDUCAO_CATEGORIES.has(t.category || '')) {
        const cat = t.category || 'Impostos';
        deducaoByCategory.set(cat, (deducaoByCategory.get(cat) || 0) + t.amount);
        totalDeducoes += t.amount;
      }
    }

    const receitaLiquida = receitaBruta - totalDeducoes;

    // 3. CPV/CSV (Custo das Mercadorias/Serviços Vendidos)
    const cpvByCategory = new Map<string, number>();
    let totalCPV = 0;
    for (const t of despesas) {
      if (CPV_CATEGORIES.has(t.category || '')) {
        const cat = t.category || 'Outros';
        cpvByCategory.set(cat, (cpvByCategory.get(cat) || 0) + t.amount);
        totalCPV += t.amount;
      }
    }

    const lucroBruto = receitaLiquida - totalCPV;

    // 4. Despesas Operacionais (everything that's not CPV, not Impostos, not Juros)
    const opexByCategory = new Map<string, number>();
    let totalOpex = 0;
    for (const t of despesas) {
      const cat = t.category || 'Outros';
      if (DEDUCAO_CATEGORIES.has(cat) || CPV_CATEGORIES.has(cat)) continue;
      opexByCategory.set(cat, (opexByCategory.get(cat) || 0) + t.amount);
      totalOpex += t.amount;
    }

    const resultadoOperacional = lucroBruto - totalOpex;

    // 5. Resultado Financeiro
    const receitaFinanceira = receitas.filter(t => FINANCEIRO_RECEITA_CATEGORIES.has(t.category || '')).reduce((s, t) => s + t.amount, 0);
    const despesaFinanceira = despesas.filter(t => FINANCEIRO_RECEITA_CATEGORIES.has(t.category || '')).reduce((s, t) => s + t.amount, 0);
    const resultadoFinanceiro = receitaFinanceira - despesaFinanceira;

    const resultadoLiquido = resultadoOperacional + resultadoFinanceiro;
    const margemBruta = receitaBruta > 0 ? (lucroBruto / receitaBruta) * 100 : 0;
    const margemLiquida = receitaBruta > 0 ? (resultadoLiquido / receitaBruta) * 100 : 0;

    return {
      receitaBruta,
      receitaByCategory,
      totalDeducoes,
      deducaoByCategory,
      receitaLiquida,
      totalCPV,
      cpvByCategory,
      lucroBruto,
      totalOpex,
      opexByCategory,
      resultadoOperacional,
      receitaFinanceira,
      despesaFinanceira,
      resultadoFinanceiro,
      resultadoLiquido,
      margemBruta,
      margemLiquida,
    };
  }, [periodTransactions]);

  // Sector DRE computation
  const sectorDRE = useMemo((): SectorDRERow[] => {
    const sectorMap = new Map<string, { receitas: number; despesas: number }>();

    // "Sem setor" bucket for unassigned transactions
    sectorMap.set('__none__', { receitas: 0, despesas: 0 });

    for (const t of periodTransactions) {
      const key = t.sectorId || '__none__';
      if (!sectorMap.has(key)) sectorMap.set(key, { receitas: 0, despesas: 0 });
      const bucket = sectorMap.get(key)!;
      if (t.type === 'receita') bucket.receitas += t.amount;
      else bucket.despesas += t.amount;
    }

    const rows: SectorDRERow[] = [];
    for (const [key, { receitas, despesas }] of sectorMap.entries()) {
      if (receitas === 0 && despesas === 0) continue;
      const sector = sectors.find(s => s.id === key);
      const sectorName = key === '__none__' ? 'Sem Setor' : (sector?.name ?? key);
      const resultado = receitas - despesas;
      const margem = receitas > 0 ? (resultado / receitas) * 100 : 0;
      rows.push({ sectorName, receitas, despesas, resultado, margem });
    }
    return rows.sort((a, b) => b.receitas - a.receitas);
  }, [periodTransactions, sectors]);

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Available months from transactions
  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    const now = new Date();
    for (let i = 0; i < 24; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, []);

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    for (let y = new Date().getFullYear(); y >= new Date().getFullYear() - 5; y--) years.add(String(y));
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, []);

  const periodLabel = useMemo(() => {
    if (period === 'anual') return `Ano ${selectedYear}`;
    const [y, m] = selectedMonth.split('-').map(Number);
    const monthName = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    if (period === 'mensal') return monthName.charAt(0).toUpperCase() + monthName.slice(1);
    const endDate = new Date(y, m - 1, 1);
    const startDate = new Date(y, m - 3, 1);
    return `${startDate.toLocaleDateString('pt-BR', { month: 'short' })} – ${endDate.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}`;
  }, [period, selectedMonth, selectedYear]);

  const handleExportPDF = async () => {
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const doc = new jsPDF({ orientation: 'portrait', format: 'a4' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Demonstrativo de Resultado do Exercício', 14, 20);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(businessName, 14, 28);
    doc.text(`Período: ${periodLabel}`, 14, 34);
    doc.text(`Emitido em: ${new Date().toLocaleDateString('pt-BR')}`, 14, 40);

    const rows: (string | number)[][] = [];
    const addRow = (label: string, value: number, bold = false) => rows.push([label, formatCurrency(value)]);

    addRow('RECEITA BRUTA', dre.receitaBruta, true);
    Array.from(dre.receitaByCategory.entries()).forEach(([k, v]) => addRow(`  ${k}`, v));
    addRow('(-) DEDUÇÕES', -dre.totalDeducoes, true);
    Array.from(dre.deducaoByCategory.entries()).forEach(([k, v]) => addRow(`  ${k}`, -v));
    addRow('(=) RECEITA LÍQUIDA', dre.receitaLiquida, true);
    addRow('(-) CUSTO DOS SERVIÇOS (CPV)', -dre.totalCPV, true);
    Array.from(dre.cpvByCategory.entries()).forEach(([k, v]) => addRow(`  ${k}`, -v));
    addRow('(=) LUCRO BRUTO', dre.lucroBruto, true);
    addRow('(-) DESPESAS OPERACIONAIS', -dre.totalOpex, true);
    Array.from(dre.opexByCategory.entries()).forEach(([k, v]) => addRow(`  ${k}`, -v));
    addRow('(=) RESULTADO OPERACIONAL (EBIT)', dre.resultadoOperacional, true);
    if (dre.receitaFinanceira > 0 || dre.despesaFinanceira > 0) {
      addRow('(+/-) RESULTADO FINANCEIRO', dre.resultadoFinanceiro, true);
    }
    addRow('(=) RESULTADO LÍQUIDO', dre.resultadoLiquido, true);

    autoTable(doc, {
      head: [['Descrição', 'Valor']],
      body: rows,
      startY: 48,
      styles: { fontSize: 10, font: 'helvetica' },
      headStyles: { fillColor: [220, 38, 38], textColor: 255 },
      columnStyles: { 1: { halign: 'right' } },
    });

    doc.save(`DRE_${businessName.replace(/\s+/g, '_')}_${periodLabel.replace(/\s+/g, '_')}.pdf`);
  };

  const fmt = (v: number) => formatCurrency(Math.abs(v));
  const isNeg = (v: number) => v < 0;

  interface DreRowProps {
    label: string;
    value: number;
    sign?: '+' | '-' | '=';
    isHeader?: boolean;
    isResult?: boolean;
    indent?: boolean;
    expandKey?: string;
    items?: Map<string, number>;
    valueSign?: -1 | 1; // multiply value by this for display purposes
  }

  function DreRow({ label, value, sign, isHeader, isResult, indent, expandKey, items, valueSign = 1 }: DreRowProps) {
    const displayValue = value * valueSign;
    const hasItems = items && items.size > 0;
    const isExpanded = expandKey ? expandedSections.has(expandKey) : false;
    const colorClass = isResult
      ? displayValue >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
      : 'text-slate-700 dark:text-gray-300';

    return (
      <>
        <div
          className={cn(
            'flex items-center justify-between py-2.5 px-4 border-b border-slate-100 dark:border-gray-800 transition-colors',
            isHeader && 'bg-slate-50 dark:bg-gray-800/60 font-semibold',
            isResult && 'bg-slate-100 dark:bg-gray-800 font-bold',
            indent && 'pl-8',
            hasItems && 'cursor-pointer hover:bg-slate-50 dark:hover:bg-gray-800/40',
          )}
          onClick={hasItems && expandKey ? () => toggleSection(expandKey) : undefined}
        >
          <div className="flex items-center gap-2">
            {sign && (
              <span className="text-xs font-mono w-4 text-slate-400 dark:text-gray-500 select-none">{sign}</span>
            )}
            <span className={cn('text-sm', isHeader ? 'text-slate-800 dark:text-gray-200' : isResult ? colorClass : 'text-slate-600 dark:text-gray-400', indent && 'text-[13px]')}>
              {label}
            </span>
            {hasItems && (
              <ChevronRight size={14} className={cn('text-slate-400 dark:text-gray-500 transition-transform', isExpanded && 'rotate-90')} />
            )}
          </div>
          <span className={cn('text-sm font-mono tabular-nums', colorClass, isResult && 'text-base')}>
            {fmt(displayValue)}
          </span>
        </div>
        {hasItems && isExpanded && (
          <div className="bg-slate-50/50 dark:bg-gray-900/30">
            {Array.from(items!.entries()).sort(([, a], [, b]) => b - a).map(([cat, val]) => (
              <div key={cat} className="flex items-center justify-between py-1.5 px-4 pl-12 border-b border-slate-100/70 dark:border-gray-800/50">
                <span className="text-[12px] text-slate-500 dark:text-gray-500">{cat}</span>
                <span className="text-[12px] font-mono tabular-nums text-slate-500 dark:text-gray-500">{fmt(val)}</span>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-display">
            Demonstrativo de Resultado do Exercício
          </h3>
          <p className="text-sm text-slate-500 dark:text-gray-400 mt-0.5">{periodLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Period type selector */}
          <div className="flex items-center gap-1 p-1 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl">
            {(['mensal', 'trimestral', 'anual'] as DrePeriod[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                  period === p ? 'bg-red-600 text-white shadow-sm' : 'text-slate-500 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800'
                )}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          {/* Period value selector */}
          {period === 'anual' ? (
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(e.target.value)}
              className="px-3 py-1.5 rounded-xl text-xs font-medium bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 text-slate-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          ) : (
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="px-3 py-1.5 rounded-xl text-xs font-medium bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 text-slate-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              {availableMonths.map(m => {
                const [y, mo] = m.split('-').map(Number);
                const label = new Date(y, mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
                return <option key={m} value={m}>{label.charAt(0).toUpperCase() + label.slice(1)}</option>;
              })}
            </select>
          )}
          {/* View mode toggle */}
          <div className="flex items-center gap-1 p-1 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl">
            {(['consolidado', 'por-setor'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap',
                  viewMode === mode ? 'bg-red-600 text-white shadow-sm' : 'text-slate-500 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800'
                )}
              >
                {mode === 'consolidado' ? 'Consolidado' : 'Por Setor'}
              </button>
            ))}
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => viewMode === 'por-setor'
              ? exportDRESectorCSV(sectorDRE, periodLabel, businessName)
              : exportDRECSV(dre as DREData, periodLabel, businessName)
            }
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl text-sm font-medium text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-800 transition-all shadow-sm"
          >
            <Download size={15} />
            CSV
          </motion.button>
          {viewMode === 'consolidado' && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleExportPDF}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl text-sm font-medium text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-800 transition-all shadow-sm"
            >
              <Download size={15} />
              PDF
            </motion.button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Receita Bruta', value: dre.receitaBruta, color: 'emerald' },
          { label: 'Lucro Bruto', value: dre.lucroBruto, color: dre.lucroBruto >= 0 ? 'emerald' : 'red' },
          { label: 'Margem Bruta', value: null, pct: dre.margemBruta, color: dre.margemBruta >= 0 ? 'emerald' : 'red' },
          { label: 'Resultado Líquido', value: dre.resultadoLiquido, color: dre.resultadoLiquido >= 0 ? 'emerald' : 'red' },
        ].map(({ label, value, pct, color }) => (
          <div key={label} className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-slate-500 dark:text-gray-400 mb-1">{label}</p>
            <p className={cn('text-lg font-bold font-display', color === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
              {pct !== undefined ? `${pct.toFixed(1)}%` : formatCurrency(value!)}
            </p>
          </div>
        ))}
      </div>

      {/* Consolidated DRE Table */}
      <AnimatePresence mode="wait">
        {viewMode === 'consolidado' ? (
          <motion.div key="consolidado" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-slate-100 dark:border-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet size={16} className="text-red-500" />
                  <span className="text-sm font-semibold text-slate-800 dark:text-gray-200">Estrutura do DRE</span>
                </div>
                <button
                  onClick={() => {
                    const allKeys = ['receita', 'deducao', 'cpv', 'opex'];
                    const allExpanded = allKeys.every(k => expandedSections.has(k));
                    setExpandedSections(allExpanded ? new Set() : new Set(allKeys));
                  }}
                  className="text-xs text-red-500 hover:text-red-600 font-medium"
                >
                  {['receita', 'deducao', 'cpv', 'opex'].every(k => expandedSections.has(k)) ? 'Recolher tudo' : 'Expandir tudo'}
                </button>
              </div>

              <div className="divide-y-0">
                <DreRow label="RECEITA BRUTA" value={dre.receitaBruta} isHeader expandKey="receita" items={dre.receitaByCategory} />
                <DreRow label="Deduções da Receita" value={-dre.totalDeducoes} sign="-" expandKey="deducao" items={dre.deducaoByCategory} />
                <DreRow label="RECEITA LÍQUIDA" value={dre.receitaLiquida} sign="=" isResult />

                <div className="h-px bg-slate-200 dark:bg-gray-700 my-0.5" />

                <DreRow label="Custo dos Serviços/Produtos (CPV)" value={-dre.totalCPV} sign="-" expandKey="cpv" items={dre.cpvByCategory} />
                <DreRow label="LUCRO BRUTO" value={dre.lucroBruto} sign="=" isResult />

                <div className="h-px bg-slate-200 dark:bg-gray-700 my-0.5" />

                <DreRow label="Despesas Operacionais" value={-dre.totalOpex} sign="-" expandKey="opex" items={dre.opexByCategory} />
                <DreRow label="RESULTADO OPERACIONAL (EBIT)" value={dre.resultadoOperacional} sign="=" isResult />

                {(dre.receitaFinanceira > 0 || dre.despesaFinanceira > 0) && (
                  <>
                    <div className="h-px bg-slate-200 dark:bg-gray-700 my-0.5" />
                    {dre.receitaFinanceira > 0 && (
                      <DreRow label="Receita Financeira (Juros)" value={dre.receitaFinanceira} sign="+" />
                    )}
                    {dre.despesaFinanceira > 0 && (
                      <DreRow label="Despesa Financeira (Juros)" value={-dre.despesaFinanceira} sign="-" />
                    )}
                    <DreRow label="Resultado Financeiro" value={dre.resultadoFinanceiro} sign="=" isResult />
                  </>
                )}

                <div className="h-1 bg-red-600/10 dark:bg-red-500/10 my-0.5" />

                <div className={cn(
                  'flex items-center justify-between py-4 px-4',
                  dre.resultadoLiquido >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-red-50 dark:bg-red-900/20'
                )}>
                  <div>
                    <p className="text-xs text-slate-500 dark:text-gray-400 font-medium mb-0.5">RESULTADO LÍQUIDO</p>
                    <p className={cn('text-2xl font-bold font-display', dre.resultadoLiquido >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                      {formatCurrency(dre.resultadoLiquido)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500 dark:text-gray-400 mb-0.5">Margem Líquida</p>
                    <p className={cn('text-lg font-bold font-display', dre.margemLiquida >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                      {dre.margemLiquida.toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Empty state (consolidated) */}
            {periodTransactions.length === 0 && (
              <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl flex flex-col items-center justify-center py-16 text-slate-400 dark:text-gray-500 mt-4">
                <FileSpreadsheet size={40} strokeWidth={1.5} />
                <p className="mt-3 text-sm font-medium">Nenhum lançamento pago neste período</p>
                <p className="text-xs mt-1">Apenas transações com status "pago" entram no DRE</p>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div key="por-setor" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="space-y-4">
            {/* Sector comparison bar chart */}
            {sectorDRE.length > 0 ? (
              <>
                <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <BarChart3 size={16} className="text-red-500" />
                    <span className="text-sm font-semibold text-slate-800 dark:text-gray-200">Resultado por Departamento</span>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={sectorDRE} margin={{ top: 4, right: 4, left: 4, bottom: 4 }} barCategoryGap="30%">
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.12)" />
                      <XAxis dataKey="sectorName" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={60} />
                      <RechartsTooltip
                        formatter={(value: number, name: string) => [
                          formatCurrency(value),
                          name === 'receitas' ? 'Receitas' : name === 'despesas' ? 'Despesas' : 'Resultado',
                        ]}
                        contentStyle={{ background: 'var(--tooltip-bg, #1e293b)', border: 'none', borderRadius: 10, color: '#e2e8f0', fontSize: 13 }}
                      />
                      <Legend formatter={(v) => v === 'receitas' ? 'Receitas' : v === 'despesas' ? 'Despesas' : 'Resultado'} wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="receitas" fill="#10b981" radius={[4, 4, 0, 0]} name="receitas" />
                      <Bar dataKey="despesas" fill="#ef4444" radius={[4, 4, 0, 0]} name="despesas" />
                      <Bar dataKey="resultado" fill="#3b82f6" radius={[4, 4, 0, 0]} name="resultado">
                        {sectorDRE.map((entry, index) => (
                          <Cell key={index} fill={entry.resultado >= 0 ? '#3b82f6' : '#f97316'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Sector cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {sectorDRE.map(s => {
                    const sector = sectors.find(sec => sec.name === s.sectorName);
                    const isPositive = s.resultado >= 0;
                    return (
                      <div key={s.sectorName} className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-4 shadow-sm">
                        <div className="flex items-center gap-2 mb-3">
                          {sector?.color && (
                            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: sector.color }} />
                          )}
                          <span className="text-sm font-semibold text-slate-800 dark:text-gray-200 truncate">{s.sectorName}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <p className="text-[10px] text-slate-400 dark:text-gray-500 mb-0.5">Receitas</p>
                            <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{formatCurrency(s.receitas)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-400 dark:text-gray-500 mb-0.5">Despesas</p>
                            <p className="text-sm font-bold text-red-600 dark:text-red-400 tabular-nums">{formatCurrency(s.despesas)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-400 dark:text-gray-500 mb-0.5">Resultado</p>
                            <p className={cn('text-sm font-bold tabular-nums', isPositive ? 'text-blue-600 dark:text-blue-400' : 'text-orange-500 dark:text-orange-400')}>
                              {isPositive ? '+' : ''}{formatCurrency(s.resultado)}
                            </p>
                          </div>
                        </div>
                        <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-gray-800 flex items-center justify-between">
                          <span className="text-[11px] text-slate-400 dark:text-gray-500">Margem</span>
                          <span className={cn('text-[11px] font-bold', isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                            {s.margem.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl flex flex-col items-center justify-center py-16 text-slate-400 dark:text-gray-500">
                <FileSpreadsheet size={40} strokeWidth={1.5} />
                <p className="mt-3 text-sm font-medium">Nenhum lançamento com setor neste período</p>
                <p className="text-xs mt-1">Associe transações a setores para ver esta visão</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ==========================================
// TAB: CONTAS BANCARIAS
// ==========================================

function BankAccountsContent({
  accounts,
  showBalances,
  onAdd,
  onEdit,
  onDelete,
}: {
  accounts: BankAccount[];
  showBalances: boolean;
  onAdd: () => void;
  onEdit: (account: BankAccount) => void;
  onDelete: (id: string) => void;
}) {
  const formatCurrency = useCurrencyFormat();
  const { t } = useTranslation();
  const activeAccounts = accounts.filter((a) => a.isActive);
  const totalBalance = activeAccounts.reduce((s, a) => s + a.balance, 0);
  const typeLabels: Record<string, string> = {
    corrente: t('financial.accountTypes.checking', 'Conta Corrente'),
    poupanca: t('financial.accountTypes.savings', 'Poupança'),
    investimento: t('financial.accountTypes.investment', 'Investimento'),
    caixa: t('financial.accountTypes.cash', 'Caixa'),
  };

  return (
    <div className="space-y-6">
      {/* Total + Add button */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-6 text-white"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-300 mb-1">{t('financial.accounts.totalBalance', 'Saldo Total Consolidado')}</p>
            <p className="text-3xl font-display font-bold">
              {showBalances ? formatCurrency(totalBalance) : 'R$ ******'}
            </p>
            <p className="text-xs text-slate-400 mt-2">{t('financial.accounts.activeCount', '{{count}} conta(s) ativa(s)', { count: activeAccounts.length })}</p>
          </div>
          <div className="flex items-center gap-3">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onAdd}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl font-semibold text-sm transition-all"
            >
              <Plus size={16} />
              {t('financial.accounts.newAccount', 'Nova Conta')}
            </motion.button>
            <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center">
              <Landmark size={28} className="text-white/80" />
            </div>
          </div>
        </div>
      </motion.div>

      {/* Account Cards */}
      {/* Payment features — coming soon */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-bold text-slate-700 dark:text-gray-300">Recebimentos Digitais</h3>
          <span className="text-[10px] font-bold px-2 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded-full tracking-wide">Em breve</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            {
              title: 'PIX QR Code',
              desc: 'Gere QR Codes PIX estáticos e dinâmicos por transação. Confirmação automática via webhook.',
              icon: '⚡',
              provider: 'Asaas / Gerencianet / Pagar.me',
            },
            {
              title: 'Boleto Bancário',
              desc: 'Emita boletos vinculados a contas a receber. Baixa automática ao pagar.',
              icon: '🏦',
              provider: 'Asaas / Iugu / Gerencianet',
            },
            {
              title: 'Open Banking',
              desc: 'Sincronização automática diária do extrato bancário via Open Finance Brasil.',
              icon: '🔄',
              provider: 'Pluggy / Belvo',
            },
          ].map(item => (
            <div key={item.title} className="relative bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-2xl p-4 opacity-60 select-none">
              <div className="absolute top-3 right-3">
                <span className="text-[9px] font-bold px-1.5 py-0.5 bg-slate-100 dark:bg-gray-800 text-slate-400 dark:text-gray-500 rounded-full uppercase tracking-widest">Em breve</span>
              </div>
              <div className="text-2xl mb-2">{item.icon}</div>
              <p className="text-sm font-bold text-slate-700 dark:text-gray-300">{item.title}</p>
              <p className="text-xs text-slate-500 dark:text-gray-500 mt-1 leading-relaxed">{item.desc}</p>
              <p className="text-[10px] text-slate-400 dark:text-gray-600 mt-2 font-medium">Provedor: {item.provider}</p>
            </div>
          ))}
        </div>
      </div>

      {activeAccounts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeAccounts.map((account, i) => (
            <motion.div key={account.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
              className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-5 hover:shadow-md hover:border-slate-200 dark:hover:border-gray-700 transition-all group"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${account.color}15` }}>
                    <Landmark size={18} style={{ color: account.color }} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-gray-200">{account.name}</p>
                    <p className="text-xs text-slate-400 dark:text-gray-500">{account.bankName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {account.isMain && (
                    <Chip label={t('financial.accounts.main', 'Principal')} size="small" sx={{ backgroundColor: '#EFF6FF', color: '#2563EB', fontWeight: 600, fontSize: '0.65rem', height: 22 }} />
                  )}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Tooltip title={t('financial.txList.edit', 'Editar')}>
                      <IconButton size="small" onClick={() => onEdit(account)} sx={{ color: '#64748B' }}>
                        <Edit3 size={14} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('financial.txList.delete', 'Excluir')}>
                      <IconButton size="small" onClick={() => onDelete(account.id)} sx={{ color: '#64748B', '&:hover': { color: '#EF4444' } }}>
                        <Trash2 size={14} />
                      </IconButton>
                    </Tooltip>
                  </div>
                </div>
              </div>

              <div className="mb-3">
                <p className="text-[11px] text-slate-400 dark:text-gray-500 mb-0.5">{typeLabels[account.accountType] || account.accountType}</p>
                <p className="text-xl font-display font-bold text-slate-900 dark:text-gray-100">
                  {showBalances ? formatCurrency(account.balance) : 'R$ ******'}
                </p>
              </div>

              {account.agency && (
                <div className="flex items-center gap-4 text-[11px] text-slate-400 dark:text-gray-500 pt-3 border-t border-slate-100 dark:border-gray-800">
                  <span>{t('financial.accounts.agency', 'Ag')}: {account.agency}</span>
                  {account.accountNumber && <span>{t('financial.accounts.accountNumber', 'CC')}: {account.accountNumber}</span>}
                </div>
              )}

              {/* Balance bar relative to total */}
              {totalBalance > 0 && (
                <div className="mt-3">
                  <div className="w-full h-1.5 bg-slate-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${(account.balance / totalBalance) * 100}%`, backgroundColor: account.color }} />
                  </div>
                  <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-1">{((account.balance / totalBalance) * 100).toFixed(1)}% {t('financial.accounts.ofTotal', 'do total')}</p>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl flex flex-col items-center justify-center py-16 text-slate-400 dark:text-gray-500">
          <Landmark size={40} strokeWidth={1.5} />
          <p className="mt-3 text-sm font-medium">{t('financial.accounts.empty', 'Nenhuma conta bancária cadastrada')}</p>
          <p className="text-xs mt-1">{t('financial.accounts.emptyHint', 'Clique em "Nova Conta" para adicionar sua primeira conta')}</p>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onAdd}
            className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-red-600 to-red-700 text-white rounded-xl font-semibold text-sm shadow-sm"
          >
            <Plus size={16} />
            {t('financial.accounts.newAccount', 'Nova Conta')}
          </motion.button>
        </div>
      )}
    </div>
  );
}

// ==========================================
// TAB: RECORRENTES
// ==========================================

type RecurringFilter = 'all' | '7d' | '15d' | '30d';

function RecurringContent({
  transactions,
  showBalances,
  businessName,
  bankAccounts,
  sectors: _sectors,
  businessId,
  onEdit,
  onPause,
  onResume,
  onMarkPaid,
  onSkip,
  onEndSeries,
  onAdjustValue,
}: {
  transactions: Transaction[];
  showBalances: boolean;
  businessName: string;
  bankAccounts: BankAccount[];
  sectors: Sector[];
  businessId: string;
  onEdit: (tx: Transaction) => void;
  onPause: (txId: string) => Promise<void>;
  onResume: (txId: string) => Promise<void>;
  onMarkPaid: (txId: string, paidAmount?: number) => Promise<void>;
  onSkip: (txId: string) => Promise<void>;
  onEndSeries: (txId: string, cancelCurrent: boolean) => Promise<void>;
  onAdjustValue: (txId: string, mode: 'pct' | 'fixed', value: number) => Promise<void>;
}) {
  const formatCurrency = useCurrencyFormat();
  const { isDark } = useTheme();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<RecurringFilter>('all');
  const [pausingId, setPausingId] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [skippingId, setSkippingId] = useState<string | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [endingSaving, setEndingSaving] = useState(false);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [adjustMode, setAdjustMode] = useState<'pct' | 'fixed'>('pct');
  const [adjustValue, setAdjustValue] = useState('');
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [historyExpandedId, setHistoryExpandedId] = useState<string | null>(null);
  const [detailTxId, setDetailTxId] = useState<string | null>(null);
  const [latePayingId, setLatePayingId] = useState<string | null>(null);
  const [lateConfirmedAmount, setLateConfirmedAmount] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth()); // 0-indexed
  // FIN-R24: edição em lote
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkReajusteOpen, setBulkReajusteOpen] = useState(false);
  const [bulkReclassifyOpen, setBulkReclassifyOpen] = useState(false);
  const [bulkEndOpen, setBulkEndOpen] = useState(false);
  const [bulkPct, setBulkPct] = useState('');
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  // FIN-R25: comprovante por ocorrência
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  // FIN-R22: simulador
  const [simOpen, setSimOpen] = useState(false);
  const [simOverrides, setSimOverrides] = useState<Record<string, { amountMultiplier: number; paused: boolean }>>({});
  const [simNewSeries, setSimNewSeries] = useState<Array<{ type: 'receita' | 'despesa'; amount: string; frequency: string }>>([]);
  // FIN-R23: padrões ignorados (persistidos em localStorage)
  const [dismissedPatterns, setDismissedPatterns] = useState<Set<string>>(() => {
    try { const r = localStorage.getItem(`dP_${businessId}`); return r ? new Set(JSON.parse(r)) : new Set(); }
    catch { return new Set(); }
  });

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const allRecurrences = useMemo(() =>
    transactions.filter(t => t.recurrence?.isActive)
  , [transactions]);

  const pausedRecurrences = useMemo(() =>
    transactions.filter(t => t.recurrence && t.recurrence.isActive === false)
  , [transactions]);

  const filteredRecurrences = useMemo(() => {
    if (filter === 'all') return allRecurrences;
    const days = filter === '7d' ? 7 : filter === '15d' ? 15 : 30;
    const cutoff = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    return allRecurrences.filter(tx => tx.recurrence?.nextDueDate && tx.recurrence.nextDueDate <= cutoff);
  }, [allRecurrences, filter]);

  const sortedRecurrences = useMemo(() =>
    [...filteredRecurrences].sort((a, b) => (a.recurrence?.nextDueDate || '').localeCompare(b.recurrence?.nextDueDate || ''))
  , [filteredRecurrences]);

  const despesas = sortedRecurrences.filter(t => t.type === 'despesa');
  const receitas = sortedRecurrences.filter(t => t.type === 'receita');

  // Calendar: map date string → transactions due that day (projected forward from nextDueDate)
  const calendarDayMap = useMemo(() => {
    const firstStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const lastStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const map: Record<string, Array<{ tx: Transaction; overdue: boolean }>> = {};
    for (const tx of transactions.filter(t => t.recurrence?.isActive && t.recurrence.nextDueDate)) {
      const rec = tx.recurrence!;
      let next = rec.nextDueDate!;
      let guard = 0;
      while (next <= lastStr && guard++ < 200) {
        if (next >= firstStr) {
          map[next] = [...(map[next] ?? []), { tx, overdue: next < todayStr }];
        }
        if (rec.endDate && next >= rec.endDate) break;
        next = computeNextDueDate(next, rec.frequency, rec.dayOfMonth, rec.secondDayOfMonth, rec.holidayAdjust);
      }
    }
    return map;
  }, [transactions, calendarYear, calendarMonth, todayStr]);

  // ── FIN-R20/R21: normalização de frequência → mensal ─────────────────────
  const healthKpis = useMemo(() => {
    let mrr = 0, burnRate = 0;
    for (const tx of allRecurrences) {
      const mult = FREQ_TO_MONTHLY[tx.recurrence?.frequency ?? 'monthly'] ?? 1;
      if (tx.type === 'receita') mrr += tx.amount * mult;
      else burnRate += tx.amount * mult;
    }
    const totalBankBalance = bankAccounts.filter(a => a.isActive).reduce((s, a) => s + a.balance, 0);
    const netMrr = mrr - burnRate;
    const runway = burnRate > 0 ? totalBankBalance / burnRate : Infinity;
    return { mrr, burnRate, netMrr, runway, arr: mrr * 12, totalBankBalance };
  }, [allRecurrences, bankAccounts]);

  const burnByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    for (const tx of allRecurrences.filter(t => t.type === 'despesa')) {
      const cat = tx.category || 'Sem categoria';
      map[cat] = (map[cat] ?? 0) + tx.amount * (FREQ_TO_MONTHLY[tx.recurrence?.frequency ?? 'monthly'] ?? 1);
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([category, amount]) => ({ category, amount }));
  }, [allRecurrences]);

  const mrrByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    for (const tx of allRecurrences.filter(t => t.type === 'receita')) {
      const cat = tx.category || 'Sem categoria';
      map[cat] = (map[cat] ?? 0) + tx.amount * (FREQ_TO_MONTHLY[tx.recurrence?.frequency ?? 'monthly'] ?? 1);
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([category, amount]) => ({ category, amount }));
  }, [allRecurrences]);

  // ── FIN-R22: projeção simulada ────────────────────────────────────────────
  const simMonthlyData = useMemo(() => {
    if (!simOpen) return [];
    let simMrr = 0, simBurn = 0;
    for (const tx of allRecurrences) {
      const ov = simOverrides[tx.id];
      if (ov?.paused) continue;
      const mult = FREQ_TO_MONTHLY[tx.recurrence?.frequency ?? 'monthly'] ?? 1;
      const val = tx.amount * (ov?.amountMultiplier ?? 1) * mult;
      if (tx.type === 'receita') simMrr += val; else simBurn += val;
    }
    for (const s of simNewSeries) {
      const v = parseFloat(s.amount);
      if (!v || isNaN(v)) continue;
      const val = v * (FREQ_TO_MONTHLY[s.frequency] ?? 1);
      if (s.type === 'receita') simMrr += val; else simBurn += val;
    }
    const today = new Date();
    let balance = healthKpis.totalBankBalance;
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      const label = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
      balance = balance + simMrr - simBurn;
      return { month: label, receita: +simMrr.toFixed(2), despesa: +simBurn.toFixed(2), saldo: +balance.toFixed(2) };
    });
  }, [simOpen, simOverrides, simNewSeries, allRecurrences, healthKpis.totalBankBalance]);

  const simRunway = useMemo(() => {
    if (!simMonthlyData.length) return null;
    const idx = simMonthlyData.findIndex(d => d.saldo < 0);
    return idx === -1 ? Infinity : idx;
  }, [simMonthlyData]);

  // ── FIN-R23: detecção de padrões recorrentes ──────────────────────────────
  const suggestedPatterns = useMemo(() => {
    const nonRecurring = transactions.filter(t => !t.recurrence);
    const groups: Record<string, Transaction[]> = {};
    for (const tx of nonRecurring) {
      const key = tx.description.toLowerCase().trim();
      groups[key] = [...(groups[key] ?? []), tx];
    }
    const THRESHOLDS = [
      { freq: 'weekly',    label: 'Semanal',     target: 7,  tol: 3  }, // 4-10d — no overlap with biweekly
      { freq: 'biweekly', label: 'Quinzenal',    target: 14, tol: 4  }, // 10-18d — no overlap with monthly
      { freq: 'monthly',  label: 'Mensal',       target: 30, tol: 8  }, // 22-38d
      { freq: 'quarterly',label: 'Trimestral',   target: 90, tol: 15 }, // 75-105d
    ];
    const suggestions: Array<{ key: string; description: string; count: number; avgAmount: number; frequency: string; freqLabel: string; type: 'receita' | 'despesa'; sampleTx: Transaction }> = [];
    for (const [, txList] of Object.entries(groups)) {
      if (txList.length < 3) continue;
      const amounts = txList.map(t => t.amount);
      const avg = amounts.reduce((s, v) => s + v, 0) / amounts.length;
      const stdDev = Math.sqrt(amounts.reduce((s, v) => s + (v - avg) ** 2, 0) / amounts.length);
      if (avg > 0 && stdDev / avg > 0.15) continue;
      const sorted = [...txList].sort((a, b) => (a.dueDate ?? a.paymentDate ?? a.createdAt).localeCompare(b.dueDate ?? b.paymentDate ?? b.createdAt));
      const dates = sorted.map(t => new Date((t.dueDate ?? t.paymentDate ?? t.createdAt).slice(0, 10) + 'T00:00:00').getTime());
      const diffs: number[] = [];
      for (let i = 1; i < dates.length; i++) diffs.push((dates[i] - dates[i - 1]) / 86400000);
      const avgDiff = diffs.reduce((s, v) => s + v, 0) / diffs.length;
      const match = THRESHOLDS.find(f => Math.abs(avgDiff - f.target) <= f.tol);
      if (!match) continue;
      const pKey = `${businessId}_${sorted[0].description.toLowerCase().trim()}_${match.freq}`;
      if (dismissedPatterns.has(pKey)) continue;
      suggestions.push({ key: pKey, description: sorted[0].description, count: txList.length, avgAmount: avg, frequency: match.freq, freqLabel: match.label, type: sorted[0].type, sampleTx: sorted[sorted.length - 1] });
    }
    return suggestions;
  }, [transactions, businessId, dismissedPatterns]);

  const kpis = useMemo(() => {
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10);
    let receitas30 = 0, despesas30 = 0;
    for (const r of allRecurrences) {
      if (r.recurrence?.nextDueDate && r.recurrence.nextDueDate <= in30Days) {
        if (r.type === 'receita') receitas30 += r.amount;
        else despesas30 += r.amount;
      }
    }
    const urgentCount = allRecurrences.filter(r => r.recurrence?.nextDueDate && r.recurrence.nextDueDate <= new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)).length;
    return { active: allRecurrences.length, receitas30, despesas30, saldo30: receitas30 - despesas30, urgentCount };
  }, [allRecurrences]);

  // ── FIN-R24: bulk handlers ────────────────────────────────────────────────
  const toggleSelect = (txId: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(txId) ? n.delete(txId) : n.add(txId); return n; });
  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkReajuste = async () => {
    const pctVal = parseFloat(bulkPct);
    if (!pctVal || isNaN(pctVal)) return;
    setBulkSaving(true);
    try {
      const batch = writeBatch(db);
      for (const txId of selectedIds) {
        const tx = transactions.find(t => t.id === txId);
        if (!tx) continue;
        batch.update(doc(db, 'transactions', txId), { amount: +(tx.amount * (1 + pctVal / 100)).toFixed(2), updatedAt: new Date().toISOString() });
      }
      await batch.commit();
      queryClient.invalidateQueries({ queryKey: ['transactions', businessId] });
      toast.success(`${selectedIds.size} série(s) reajustadas em ${pctVal}%`);
      clearSelection(); setBulkReajusteOpen(false); setBulkPct('');
    } catch { toast.error('Erro ao reajustar em lote'); } finally { setBulkSaving(false); }
  };

  const handleBulkReclassify = async () => {
    if (!bulkCategory.trim()) return;
    setBulkSaving(true);
    try {
      const batch = writeBatch(db);
      for (const txId of selectedIds) batch.update(doc(db, 'transactions', txId), { category: bulkCategory.trim(), updatedAt: new Date().toISOString() });
      await batch.commit();
      queryClient.invalidateQueries({ queryKey: ['transactions', businessId] });
      toast.success(`${selectedIds.size} série(s) reclassificadas`);
      clearSelection(); setBulkReclassifyOpen(false); setBulkCategory('');
    } catch { toast.error('Erro ao reclassificar'); } finally { setBulkSaving(false); }
  };

  const handleBulkEnd = async () => {
    setBulkSaving(true);
    try {
      const batch = writeBatch(db);
      for (const txId of selectedIds) batch.update(doc(db, 'transactions', txId), { 'recurrence.isActive': false, updatedAt: new Date().toISOString() });
      await batch.commit();
      queryClient.invalidateQueries({ queryKey: ['transactions', businessId] });
      toast.success(`${selectedIds.size} série(s) encerrada(s)`);
      clearSelection(); setBulkEndOpen(false);
    } catch { toast.error('Erro ao encerrar'); } finally { setBulkSaving(false); }
  };

  // ── FIN-R25: comprovante por ocorrência ───────────────────────────────────
  const handleOccurrenceAttachment = async (tx: Transaction, entryDueDate: string, file: File) => {
    const key = `${tx.id}_${entryDueDate}`;
    setUploadingKey(key);
    try {
      const fileId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const storagePath = `businesses/${businessId}/financial_attachments/rec_${tx.id}_${entryDueDate}_${fileId}`;
      const storRef = ref(storage, storagePath);
      await uploadBytes(storRef, file);
      const url = await getDownloadURL(storRef);
      const txSnap = await getDoc(doc(db, 'transactions', tx.id));
      const txData = txSnap.data() as Transaction | undefined;
      if (!txData?.recurrence?.history) throw new Error('Histórico não encontrado');
      const updatedHistory = txData.recurrence.history.map(entry =>
        entry.dueDate !== entryDueDate ? entry : { ...entry, attachments: [...(entry.attachments ?? []), { id: fileId, name: file.name, url, path: storagePath, uploadedAt: new Date().toISOString() }] }
      );
      await updateDoc(doc(db, 'transactions', tx.id), { 'recurrence.history': updatedHistory, updatedAt: new Date().toISOString() });
      queryClient.invalidateQueries({ queryKey: ['transactions', businessId] });
      toast.success('Comprovante salvo!');
    } catch { toast.error('Erro ao salvar comprovante'); } finally { setUploadingKey(null); }
  };

  const handleDeleteOccurrenceAttachment = async (tx: Transaction, entryDueDate: string, attachmentId: string, storagePath: string) => {
    try {
      await deleteObject(ref(storage, storagePath));
      const txSnap = await getDoc(doc(db, 'transactions', tx.id));
      const txData = txSnap.data() as Transaction | undefined;
      if (!txData?.recurrence?.history) return;
      const updatedHistory = txData.recurrence.history.map(entry =>
        entry.dueDate !== entryDueDate ? entry : { ...entry, attachments: (entry.attachments ?? []).filter(a => a.id !== attachmentId) }
      );
      await updateDoc(doc(db, 'transactions', tx.id), { 'recurrence.history': updatedHistory, updatedAt: new Date().toISOString() });
      queryClient.invalidateQueries({ queryKey: ['transactions', businessId] });
      toast.success('Comprovante removido');
    } catch { toast.error('Erro ao remover comprovante'); }
  };

  // ── FIN-R23: dismiss pattern ──────────────────────────────────────────────
  const dismissPattern = (patternKey: string) => {
    setDismissedPatterns(prev => {
      const next = new Set(prev); next.add(patternKey);
      try { localStorage.setItem(`dP_${businessId}`, JSON.stringify([...next])); } catch { /* silent */ }
      return next;
    });
  };

  const getDaysLabel = (dateStr?: string): string => {
    if (!dateStr) return '—';
    const diff = Math.round((new Date(dateStr + 'T00:00:00').getTime() - new Date(todayStr + 'T00:00:00').getTime()) / 86400000);
    if (diff < 0) return `${Math.abs(diff)}d atraso`;
    if (diff === 0) return 'Hoje';
    if (diff === 1) return 'Amanhã';
    return `em ${diff}d`;
  };

  const getUrgency = (dateStr?: string) => {
    if (!dateStr) return { color: 'text-slate-500', bg: 'bg-slate-100 dark:bg-gray-800', border: 'border-slate-200 dark:border-gray-700' };
    if (dateStr < todayStr) return { color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800' };
    const diffDays = Math.ceil((new Date(dateStr + 'T00:00:00').getTime() - new Date(todayStr + 'T00:00:00').getTime()) / 86400000);
    if (diffDays <= 3) return { color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800' };
    if (diffDays <= 7) return { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800' };
    return { color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800' };
  };

  const handlePause = async (tx: Transaction) => {
    setPausingId(tx.id);
    try { await onPause(tx.id); } finally { setPausingId(null); }
  };

  const handleResume = async (tx: Transaction) => {
    setResumingId(tx.id);
    try { await onResume(tx.id); } finally { setResumingId(null); }
  };

  const handlePay = async (tx: Transaction) => {
    setPayingId(tx.id);
    try { await onMarkPaid(tx.id); } finally { setPayingId(null); }
  };

  const handleSkip = async (tx: Transaction) => {
    setSkippingId(tx.id);
    try { await onSkip(tx.id); } finally { setSkippingId(null); }
  };

  const FILTER_LABELS: Record<RecurringFilter, string> = { all: 'Todas', '7d': '7 dias', '15d': '15 dias', '30d': '30 dias' };

  const RecurringGroup = ({ items, title, icon }: { items: Transaction[]; title: string; icon: React.ReactNode }) => {
    if (items.length === 0) return null;
    return (
      <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-3 border-b border-slate-100 dark:border-gray-800 flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-display font-bold text-slate-900 dark:text-gray-100">{title}</h3>
          <span className="ml-auto text-xs text-slate-400 dark:text-gray-500 font-medium">{items.length} recorrência{items.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="divide-y divide-slate-50 dark:divide-gray-800">
          {items.map((tx) => {
            const u = getUrgency(tx.recurrence?.nextDueDate);
            const isOverdue = tx.recurrence?.nextDueDate && tx.recurrence.nextDueDate < todayStr;
            return (
              <div key={tx.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-gray-800/40 transition-colors">
                {/* FIN-R24: Checkbox de seleção */}
                <input type="checkbox" checked={selectedIds.has(tx.id)} onChange={() => toggleSelect(tx.id)}
                  className="w-4 h-4 rounded border-slate-300 dark:border-gray-600 text-red-500 focus:ring-red-400 shrink-0 cursor-pointer mt-1 sm:mt-0"
                />
                {/* Left: urgency badge + info */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={cn('w-14 h-12 rounded-xl flex items-center justify-center border shrink-0 flex-col gap-0.5', u.bg, u.border)}>
                    <span className={cn('text-[10px] font-bold leading-none', u.color)}>
                      {getDaysLabel(tx.recurrence?.nextDueDate)}
                    </span>
                    {tx.recurrence?.nextDueDate && (
                      <span className={cn('text-[9px] leading-none opacity-70', u.color)}>
                        {tx.recurrence.nextDueDate.slice(5).replace('-', '/')}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 dark:text-gray-100 truncate">
                      {tx.recurrence?.label || tx.description}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      <span className="text-[11px] text-slate-500 dark:text-gray-400 bg-slate-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-md">
                        {RECURRENCE_LABELS[tx.recurrence?.frequency || 'monthly']}
                      </span>
                      {tx.recurrence?.dayOfMonth && (
                        <span className="text-[11px] text-slate-400 dark:text-gray-500">dia {tx.recurrence.dayOfMonth}</span>
                      )}
                      {tx.category && (
                        <span className="text-[11px] text-slate-400 dark:text-gray-500">{tx.category}</span>
                      )}
                      {isOverdue && (
                        <span className="text-[10px] font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-1.5 py-0.5 rounded-full">ATRASADO</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: value + actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right mr-2">
                    <p className="text-xs text-slate-400 dark:text-gray-500 leading-none mb-0.5">Valor</p>
                    <p className={cn('text-sm font-bold', tx.type === 'receita' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                      {tx.type === 'receita' ? '+' : '-'}{showBalances ? formatCurrency(tx.amount) : 'R$ ****'}
                    </p>
                  </div>

                  {/* Quitar agora — abre painel de late payment se houver multa/juros configurados */}
                  <button
                    onClick={() => {
                      const hasLateFees = !!(tx.recurrence?.lateFeePct || tx.recurrence?.interestPctMonth);
                      if (isOverdue && hasLateFees) {
                        setLatePayingId(latePayingId === tx.id ? null : tx.id);
                        const daysDue = Math.max(0, Math.round((new Date(todayStr + 'T00:00:00').getTime() - new Date(tx.recurrence!.nextDueDate! + 'T00:00:00').getTime()) / 86400000));
                        const multa = tx.amount * (tx.recurrence!.lateFeePct ?? 0) / 100;
                        const juros = tx.amount * (tx.recurrence!.interestPctMonth ?? 0) / 100 * daysDue / 30;
                        setLateConfirmedAmount((tx.amount + multa + juros).toFixed(2));
                      } else {
                        handlePay(tx);
                      }
                    }}
                    disabled={payingId === tx.id}
                    title="Quitar agora"
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors disabled:opacity-50"
                  >
                    {payingId === tx.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                    Quitar
                  </button>

                  {/* Editar */}
                  <button
                    onClick={() => onEdit(tx)}
                    title="Editar lançamento"
                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                  >
                    <Edit3 size={14} />
                  </button>

                  {/* Reajustar valor */}
                  <button
                    onClick={() => { setAdjustingId(adjustingId === tx.id ? null : tx.id); setAdjustValue(''); setAdjustMode('pct'); }}
                    title="Reajustar valor da série"
                    className={cn('p-1.5 rounded-lg transition-colors', adjustingId === tx.id ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400' : 'text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20')}
                  >
                    <Percent size={14} />
                  </button>

                  {/* Detalhes (modal completo: histórico + próximas + config) */}
                  <button
                    onClick={() => setDetailTxId(tx.id)}
                    title="Ver histórico, próximas e configuração"
                    className="p-1.5 rounded-lg transition-colors text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                  >
                    <BarChart3 size={14} />
                  </button>

                  {/* Histórico inline (legado — atalho rápido) */}
                  {(tx.recurrence?.history?.length ?? 0) > 0 && (
                    <button
                      onClick={() => setHistoryExpandedId(historyExpandedId === tx.id ? null : tx.id)}
                      title="Ver histórico inline (atalho)"
                      className={cn('p-1.5 rounded-lg transition-colors', historyExpandedId === tx.id ? 'bg-slate-200 dark:bg-gray-700 text-slate-600 dark:text-gray-300' : 'text-slate-400 hover:text-slate-600 dark:hover:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-800')}
                    >
                      <History size={14} />
                    </button>
                  )}

                  {/* Pular ocorrência */}
                  <button
                    onClick={() => handleSkip(tx)}
                    disabled={skippingId === tx.id}
                    title="Pular este vencimento (avança para o próximo sem quitar)"
                    className="p-1.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {skippingId === tx.id ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
                  </button>

                  {/* Pausar */}
                  <button
                    onClick={() => handlePause(tx)}
                    disabled={pausingId === tx.id}
                    title="Pausar recorrência temporariamente"
                    className="p-1.5 text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {pausingId === tx.id ? <Loader2 size={14} className="animate-spin" /> : <PauseCircle size={14} />}
                  </button>

                  {/* Encerrar série */}
                  <button
                    onClick={() => setEndingId(endingId === tx.id ? null : tx.id)}
                    title="Encerrar série recorrente"
                    className={cn('p-1.5 rounded-lg transition-colors', endingId === tx.id ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20')}
                  >
                    <StopCircle size={14} />
                  </button>
                </div>

                {/* Reajuste de valor panel */}
                {adjustingId === tx.id && (
                  <div className="mt-3 p-3 rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 space-y-2.5">
                    <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">Reajustar valor da série</p>
                    <div className="flex items-center gap-1 p-0.5 bg-violet-100 dark:bg-violet-900/40 rounded-lg w-fit">
                      {(['pct', 'fixed'] as const).map(m => (
                        <button key={m} onClick={() => { setAdjustMode(m); setAdjustValue(''); }}
                          className={cn('px-2.5 py-1 rounded-md text-xs font-medium transition-all', adjustMode === m ? 'bg-white dark:bg-gray-800 text-violet-700 dark:text-violet-300 shadow-sm' : 'text-violet-500 dark:text-violet-400')}>
                          {m === 'pct' ? '% Percentual' : 'R$ Valor fixo'}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 flex-1">
                        <span className="text-xs font-semibold text-slate-500 dark:text-gray-400">{adjustMode === 'pct' ? '+' : 'R$'}</span>
                        <input
                          type="number"
                          value={adjustValue}
                          onChange={e => setAdjustValue(e.target.value)}
                          placeholder={adjustMode === 'pct' ? 'Ex: 5 (= +5%)' : `Ex: ${tx.amount.toFixed(2)}`}
                          className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-violet-200 dark:border-violet-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-violet-400 dark:focus:border-violet-500"
                        />
                      </div>
                      {adjustValue && (adjustMode === 'pct' ? parseFloat(adjustValue) !== 0 : parseFloat(adjustValue) > 0) && (
                        <span className="text-[11px] text-slate-500 dark:text-gray-400 shrink-0">
                          → {formatCurrency(adjustMode === 'pct' ? tx.amount * (1 + parseFloat(adjustValue) / 100) : parseFloat(adjustValue))}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        disabled={adjustSaving || !adjustValue || parseFloat(adjustValue) <= 0}
                        onClick={async () => {
                          setAdjustSaving(true);
                          try { await onAdjustValue(tx.id, adjustMode, parseFloat(adjustValue)); setAdjustingId(null); setAdjustValue(''); }
                          finally { setAdjustSaving(false); }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 transition-colors disabled:opacity-40"
                      >
                        {adjustSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        Aplicar reajuste
                      </button>
                      <button onClick={() => { setAdjustingId(null); setAdjustValue(''); }} className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-600 dark:hover:text-gray-300 transition-colors">Cancelar</button>
                    </div>
                  </div>
                )}

                {/* Histórico de ocorrências + FIN-R25 comprovantes */}
                {historyExpandedId === tx.id && (tx.recurrence?.history?.length ?? 0) > 0 && (
                  <div className="mt-3 p-3 rounded-xl bg-slate-50 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-700 space-y-2">
                    <p className="text-[10px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wider mb-2">Histórico de pagamentos</p>
                    {[...(tx.recurrence?.history ?? [])].reverse().map((entry, i) => {
                      const uKey = `${tx.id}_${entry.dueDate}`;
                      return (
                        <div key={i} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                              <span className="text-slate-600 dark:text-gray-300">
                                Venc. <strong>{entry.dueDate.slice(5).replace('-', '/')}/{entry.dueDate.slice(2,4)}</strong>
                              </span>
                              <span className="text-slate-400 dark:text-gray-500">→ pago em {entry.paidDate.slice(5).replace('-', '/')}/{entry.paidDate.slice(2,4)}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={cn('font-semibold', tx.type === 'receita' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                                {showBalances ? formatCurrency(entry.amount) : 'R$ ****'}
                              </span>
                              <label title="Anexar comprovante" className="cursor-pointer text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors">
                                {uploadingKey === uKey ? <Loader2 size={12} className="animate-spin text-blue-500" /> : <Paperclip size={12} />}
                                <input type="file" accept="image/*,application/pdf" className="hidden" disabled={uploadingKey === uKey}
                                  onChange={e => { const f = e.target.files?.[0]; if (f) handleOccurrenceAttachment(tx, entry.dueDate, f); e.target.value = ''; }}
                                />
                              </label>
                            </div>
                          </div>
                          {(entry.attachments ?? []).length > 0 && (
                            <div className="pl-5 flex flex-wrap gap-1.5">
                              {(entry.attachments ?? []).map(att => (
                                <div key={att.id} className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-[10px] text-blue-700 dark:text-blue-300">
                                  <Paperclip size={9} />
                                  <a href={att.url} target="_blank" rel="noreferrer" className="max-w-[100px] truncate hover:underline">{att.name}</a>
                                  <button onClick={() => handleDeleteOccurrenceAttachment(tx, entry.dueDate, att.id, att.path)} className="ml-0.5 text-blue-400 hover:text-red-500 transition-colors"><X size={9} /></button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* FIN-R18: Painel de late payment */}
                {latePayingId === tx.id && tx.recurrence?.nextDueDate && (
                  <div className="mt-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 space-y-2.5">
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">Quitar com encargos por atraso</p>
                    {(() => {
                      const daysDue = Math.max(0, Math.round((new Date(todayStr + 'T00:00:00').getTime() - new Date(tx.recurrence!.nextDueDate! + 'T00:00:00').getTime()) / 86400000));
                      const multa = tx.amount * (tx.recurrence!.lateFeePct ?? 0) / 100;
                      const juros = tx.amount * (tx.recurrence!.interestPctMonth ?? 0) / 100 * daysDue / 30;
                      return (
                        <div className="space-y-1.5 text-xs text-slate-600 dark:text-gray-300">
                          <div className="flex justify-between"><span>Valor original</span><span className="font-semibold">{formatCurrency(tx.amount)}</span></div>
                          {multa > 0 && <div className="flex justify-between"><span>Multa ({tx.recurrence!.lateFeePct}%)</span><span className="font-semibold text-amber-600 dark:text-amber-400">+{formatCurrency(multa)}</span></div>}
                          {juros > 0 && <div className="flex justify-between"><span>Juros ({daysDue}d × {tx.recurrence!.interestPctMonth}% a.m.)</span><span className="font-semibold text-amber-600 dark:text-amber-400">+{formatCurrency(juros)}</span></div>}
                          <div className="border-t border-amber-200 dark:border-amber-700 pt-1.5 flex justify-between font-bold"><span>Total sugerido</span><span>{formatCurrency(tx.amount + multa + juros)}</span></div>
                        </div>
                      );
                    })()}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 dark:text-gray-400 shrink-0">Valor a quitar</span>
                      <input type="number" value={lateConfirmedAmount} onChange={e => setLateConfirmedAmount(e.target.value)} step="0.01" min="0"
                        className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-amber-200 dark:border-amber-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-amber-400"
                      />
                    </div>
                    <div className="flex gap-1.5">
                      <button disabled={payingId === tx.id}
                        onClick={async () => {
                          setPayingId(tx.id);
                          try { await onMarkPaid(tx.id, parseFloat(lateConfirmedAmount)); setLatePayingId(null); }
                          finally { setPayingId(null); }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors disabled:opacity-40"
                      >
                        {payingId === tx.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        Confirmar
                      </button>
                      <button disabled={payingId === tx.id} onClick={() => handlePay(tx)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-700 bg-white dark:bg-gray-800 text-amber-700 dark:text-amber-300 text-xs font-medium hover:bg-amber-50 transition-colors disabled:opacity-40"
                      >Quitar valor original</button>
                      <button onClick={() => setLatePayingId(null)} className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-600 dark:hover:text-gray-300 transition-colors">Cancelar</button>
                    </div>
                  </div>
                )}

                {/* End-series confirmation panel */}
                {endingId === tx.id && (
                  <div className="mt-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 space-y-2">
                    <p className="text-xs font-semibold text-red-700 dark:text-red-300">Encerrar esta série recorrente?</p>
                    <div className="flex flex-col gap-1.5">
                      <button
                        disabled={endingSaving}
                        onClick={async () => { setEndingSaving(true); try { await onEndSeries(tx.id, false); setEndingId(null); } finally { setEndingSaving(false); } }}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-red-200 dark:border-red-700 text-xs font-medium text-slate-700 dark:text-gray-200 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50 text-left"
                      >
                        {endingSaving ? <Loader2 size={12} className="animate-spin shrink-0" /> : <StopCircle size={12} className="text-amber-500 shrink-0" />}
                        <span>Encerrar e <strong>manter</strong> o vencimento atual como pendente</span>
                      </button>
                      <button
                        disabled={endingSaving}
                        onClick={async () => { setEndingSaving(true); try { await onEndSeries(tx.id, true); setEndingId(null); } finally { setEndingSaving(false); } }}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-red-200 dark:border-red-700 text-xs font-medium text-slate-700 dark:text-gray-200 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50 text-left"
                      >
                        {endingSaving ? <Loader2 size={12} className="animate-spin shrink-0" /> : <XCircle size={12} className="text-red-500 shrink-0" />}
                        <span>Encerrar e <strong>cancelar</strong> o vencimento atual</span>
                      </button>
                      <button onClick={() => setEndingId(null)} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-gray-300 text-center py-1 transition-colors">Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* ── FIN-R20/R21: Saúde Financeira ── */}
      {allRecurrences.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Scale size={15} className="text-violet-500" />
            <h2 className="text-sm font-display font-bold text-slate-700 dark:text-gray-200">Saúde Financeira</h2>
            <span className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/30 px-1.5 py-0.5 rounded-full">por mês</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">MRR</p>
              <p className="text-lg font-display font-bold text-emerald-600 dark:text-emerald-400">{showBalances ? formatCurrency(healthKpis.mrr) : 'R$ ****'}</p>
              <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-0.5">Receita recorrente/mês</p>
            </div>
            <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">Burn Rate</p>
              <p className="text-lg font-display font-bold text-red-600 dark:text-red-400">{showBalances ? formatCurrency(healthKpis.burnRate) : 'R$ ****'}</p>
              <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-0.5">Despesas recorrentes/mês</p>
            </div>
            <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">Net MRR</p>
              <p className={cn('text-lg font-display font-bold', healthKpis.netMrr >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-orange-600 dark:text-orange-400')}>{showBalances ? formatCurrency(healthKpis.netMrr) : 'R$ ****'}</p>
              <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-0.5">MRR − Burn Rate</p>
            </div>
            <div className={cn('border rounded-2xl p-4 shadow-sm', healthKpis.runway === Infinity ? 'bg-white dark:bg-gray-900 border-slate-100 dark:border-gray-800' : healthKpis.runway < 3 ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800' : healthKpis.runway < 6 ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800' : 'bg-white dark:bg-gray-900 border-slate-100 dark:border-gray-800')}>
              <p className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">Runway</p>
              <p className={cn('text-lg font-display font-bold', healthKpis.runway === Infinity ? 'text-slate-400 dark:text-gray-500' : healthKpis.runway < 3 ? 'text-red-600 dark:text-red-400' : healthKpis.runway < 6 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>
                {healthKpis.runway === Infinity ? '∞' : `${healthKpis.runway.toFixed(1)}m`}
              </p>
              <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-0.5">{healthKpis.runway === Infinity ? 'Sem burn rate' : `Saldo ÷ Burn (${showBalances ? formatCurrency(healthKpis.totalBankBalance) : '****'})`}</p>
            </div>
            <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">ARR</p>
              <p className="text-lg font-display font-bold text-violet-600 dark:text-violet-400">{showBalances ? formatCurrency(healthKpis.arr) : 'R$ ****'}</p>
              <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-0.5">MRR × 12</p>
            </div>
          </div>
          {/* FIN-R21: Breakdown por categoria */}
          {(mrrByCategory.length > 0 || burnByCategory.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {mrrByCategory.length > 0 && (
                <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-4 shadow-sm space-y-2.5">
                  <p className="text-xs font-semibold text-slate-600 dark:text-gray-300 flex items-center gap-1.5"><ArrowUpRight size={13} className="text-emerald-500" />MRR por categoria</p>
                  {mrrByCategory.map(({ category, amount }) => {
                    const pct = healthKpis.mrr > 0 ? (amount / healthKpis.mrr) * 100 : 0;
                    return (
                      <div key={category} className="space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-slate-600 dark:text-gray-300 truncate flex-1 mr-2">{category}</span>
                          <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">{showBalances ? formatCurrency(amount) : '****'} <span className="text-[10px] text-slate-400 font-normal">({pct.toFixed(0)}%)</span></span>
                        </div>
                        <div className="h-1.5 bg-slate-100 dark:bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                      </div>
                    );
                  })}
                </div>
              )}
              {burnByCategory.length > 0 && (
                <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-4 shadow-sm space-y-2.5">
                  <p className="text-xs font-semibold text-slate-600 dark:text-gray-300 flex items-center gap-1.5"><ArrowDownRight size={13} className="text-red-500" />Burn por categoria</p>
                  {burnByCategory.map(({ category, amount }) => {
                    const pct = healthKpis.burnRate > 0 ? (amount / healthKpis.burnRate) * 100 : 0;
                    return (
                      <div key={category} className="space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-slate-600 dark:text-gray-300 truncate flex-1 mr-2">{category}</span>
                          <span className="text-xs font-semibold text-red-600 dark:text-red-400 shrink-0">{showBalances ? formatCurrency(amount) : '****'} <span className="text-[10px] text-slate-400 font-normal">({pct.toFixed(0)}%)</span></span>
                        </div>
                        <div className="h-1.5 bg-slate-100 dark:bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-red-400 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">Ativas</p>
          <div className="flex items-end gap-2">
            <p className="text-2xl font-display font-bold text-slate-900 dark:text-gray-100">{kpis.active}</p>
            {kpis.urgentCount > 0 && (
              <span className="mb-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-amber-500 text-white leading-none">
                {kpis.urgentCount} urgente{kpis.urgentCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">Entradas 30d</p>
          <p className="text-lg font-display font-bold text-emerald-600 dark:text-emerald-400">
            {showBalances ? formatCurrency(kpis.receitas30) : 'R$ ****'}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">Saídas 30d</p>
          <p className="text-lg font-display font-bold text-red-600 dark:text-red-400">
            {showBalances ? formatCurrency(kpis.despesas30) : 'R$ ****'}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">Saldo Previsto 30d</p>
          <p className={cn('text-lg font-display font-bold', kpis.saldo30 >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-orange-600 dark:text-orange-400')}>
            {showBalances ? formatCurrency(kpis.saldo30) : 'R$ ****'}
          </p>
        </div>
      </div>

      {/* ── FIN-R23: Padrões recorrentes detectados ── */}
      {suggestedPatterns.length > 0 && (
        <div className="bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-blue-100 dark:border-blue-900/50 flex items-center gap-2">
            <Repeat size={15} className="text-blue-500" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-900 dark:text-gray-100">Padrões recorrentes detectados</p>
              <p className="text-[11px] text-slate-400 dark:text-gray-500">{suggestedPatterns.length} transação{suggestedPatterns.length !== 1 ? 'ões parecem' : ' parece'} recorrente{suggestedPatterns.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="divide-y divide-blue-50 dark:divide-blue-900/20">
            {suggestedPatterns.map(p => (
              <div key={p.key} className="px-5 py-3.5 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-gray-100 truncate">{p.description}</p>
                  <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                    {p.count} pagamentos de ~{formatCurrency(p.avgAmount)} · {p.freqLabel} ·{' '}
                    <span className={p.type === 'receita' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{p.type === 'receita' ? 'Receita' : 'Despesa'}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => onEdit({ ...p.sampleTx, id: '', recurrence: { frequency: p.frequency as RecurrenceFrequency, nextDueDate: p.sampleTx.dueDate ?? new Date().toISOString().slice(0, 10), isActive: true } })}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 transition-colors"
                  ><Repeat size={11} /> Criar série</button>
                  <button onClick={() => dismissPattern(p.key)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-gray-300 border border-slate-200 dark:border-gray-700 rounded-lg hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors"
                  ><X size={11} /> Ignorar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FIN-R27: Dashboard de inadimplência */}
      {(() => {
        const overdue = allRecurrences.filter(tx => tx.recurrence?.nextDueDate && tx.recurrence.nextDueDate < todayStr);
        if (overdue.length === 0) return null;
        const totalOverdue = overdue.reduce((s, tx) => s + tx.amount, 0);
        return (
          <div className="bg-white dark:bg-gray-900 border border-red-200 dark:border-red-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-5 py-3 bg-red-600 flex items-center gap-3">
              <AlertTriangle size={16} className="text-white shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white">Em Atraso</p>
                <p className="text-xs text-red-100">{overdue.length} lançamento{overdue.length !== 1 ? 's' : ''} · Total: {showBalances ? formatCurrency(totalOverdue) : 'R$ ****'}</p>
              </div>
            </div>
            <div className="divide-y divide-red-50 dark:divide-red-900/20">
              {overdue.map(tx => {
                const daysDue = Math.round((new Date(todayStr + 'T00:00:00').getTime() - new Date(tx.recurrence!.nextDueDate! + 'T00:00:00').getTime()) / 86400000);
                return (
                  <div key={tx.id} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-red-50/50 dark:hover:bg-red-900/10 transition-colors">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="shrink-0 text-[11px] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded-full whitespace-nowrap">{daysDue}d</span>
                      <span className="text-sm font-medium text-slate-900 dark:text-gray-100 truncate">{tx.recurrence?.label || tx.description}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={cn('text-sm font-bold', tx.type === 'receita' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                        {showBalances ? formatCurrency(tx.amount) : 'R$ ****'}
                      </span>
                      <button
                        onClick={() => {
                          const hasLateFees = !!(tx.recurrence?.lateFeePct || tx.recurrence?.interestPctMonth);
                          if (hasLateFees) {
                            setLatePayingId(tx.id);
                            const multa = tx.amount * (tx.recurrence!.lateFeePct ?? 0) / 100;
                            const juros = tx.amount * (tx.recurrence!.interestPctMonth ?? 0) / 100 * daysDue / 30;
                            setLateConfirmedAmount((tx.amount + multa + juros).toFixed(2));
                          } else {
                            setPayingId(tx.id);
                            onMarkPaid(tx.id).finally(() => setPayingId(null));
                          }
                        }}
                        disabled={payingId === tx.id}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50"
                      >
                        {payingId === tx.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                        Quitar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Filter + view toggle bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {viewMode === 'list' && (
          <>
            <span className="text-xs text-slate-400 dark:text-gray-500 font-medium">Mostrar vencimentos:</span>
            <div className="flex items-center gap-1 p-1 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl">
              {(['all', '7d', '15d', '30d'] as RecurringFilter[]).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={cn('px-3 py-1 rounded-lg text-xs font-medium transition-all',
                    filter === f ? 'bg-red-600 text-white shadow-sm' : 'text-slate-500 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800'
                  )}
                >{FILTER_LABELS[f]}</button>
              ))}
            </div>
            {filter !== 'all' && filteredRecurrences.length === 0 && (
              <span className="text-xs text-slate-400 dark:text-gray-500">Nenhum vencimento nesse período</span>
            )}
          </>
        )}
        {/* FIN-R19: Exportar CSV */}
        <button onClick={() => exportRecurrencesCSV(transactions, businessName)} title="Exportar recorrências em CSV"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors ml-auto"
        ><Download size={13} /> CSV</button>
        {/* FIN-R22: Botão Simulador */}
        <button onClick={() => setSimOpen(v => !v)}
          className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-colors', simOpen ? 'bg-violet-50 dark:bg-violet-900/30 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300' : 'border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-white/[0.04]')}
        ><Scale size={13} /> Simular</button>
        <div className="flex items-center gap-1 p-1 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl">
          <button onClick={() => setViewMode('list')} title="Visão em lista"
            className={cn('p-1.5 rounded-lg transition-all', viewMode === 'list' ? 'bg-red-600 text-white shadow-sm' : 'text-slate-500 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800')}
          ><LayoutList size={14} /></button>
          <button onClick={() => setViewMode('calendar')} title="Visão calendário"
            className={cn('p-1.5 rounded-lg transition-all', viewMode === 'calendar' ? 'bg-red-600 text-white shadow-sm' : 'text-slate-500 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800')}
          ><CalendarDays size={14} /></button>
        </div>
      </div>

      {/* ── FIN-R22: Painel Simulador "E Se?" ── */}
      <AnimatePresence>
        {simOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
            <div className="bg-white dark:bg-gray-900 border border-violet-200 dark:border-violet-800 rounded-2xl p-5 space-y-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scale size={16} className="text-violet-500" />
                  <h3 className="text-sm font-display font-bold text-slate-900 dark:text-gray-100">Simulador &quot;E Se?&quot;</h3>
                  <span className="text-[10px] text-violet-500 bg-violet-50 dark:bg-violet-900/30 px-1.5 py-0.5 rounded-full font-semibold">Não salva</span>
                </div>
                <button onClick={() => setSimOpen(false)} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"><X size={14} /></button>
              </div>
              {/* Séries ativas */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wider">Ajustar séries ativas</p>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {allRecurrences.map(tx => {
                    const ov = simOverrides[tx.id] ?? { amountMultiplier: 1, paused: false };
                    const monthly = tx.amount * (FREQ_TO_MONTHLY[tx.recurrence?.frequency ?? 'monthly'] ?? 1);
                    return (
                      <div key={tx.id} className={cn('flex items-center gap-3 p-2.5 rounded-xl border text-xs', ov.paused ? 'opacity-40 bg-slate-50 dark:bg-gray-800/50 border-slate-200 dark:border-gray-700' : 'bg-white dark:bg-gray-900 border-slate-200 dark:border-gray-700')}>
                        <button onClick={() => setSimOverrides(p => ({ ...p, [tx.id]: { ...ov, paused: !ov.paused } }))} className={cn('p-1 rounded-lg shrink-0 transition-colors', ov.paused ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600' : 'text-slate-400 hover:text-amber-500')} title={ov.paused ? 'Retomar no simulador' : 'Pausar no simulador'}>
                          {ov.paused ? <PlayCircle size={12} /> : <PauseCircle size={12} />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-700 dark:text-gray-200 truncate">{tx.recurrence?.label || tx.description}</p>
                          <p className="text-[10px] text-slate-400 dark:text-gray-500">{formatCurrency(monthly)}/mês base</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <input type="range" min={0.1} max={3} step={0.05} value={ov.amountMultiplier} disabled={ov.paused}
                            onChange={e => setSimOverrides(p => ({ ...p, [tx.id]: { ...ov, amountMultiplier: parseFloat(e.target.value) } }))}
                            className="w-20 accent-violet-500"
                          />
                          <span className={cn('w-20 text-right font-semibold', tx.type === 'receita' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                            {formatCurrency(monthly * ov.amountMultiplier)}/m
                          </span>
                          {ov.amountMultiplier !== 1 && <span className="text-[10px] text-slate-400 w-10 text-right">×{ov.amountMultiplier.toFixed(2)}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Séries hipotéticas */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wider">Séries hipotéticas</p>
                  <button onClick={() => setSimNewSeries(p => [...p, { type: 'despesa', amount: '', frequency: 'monthly' }])}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded-lg border border-violet-200 dark:border-violet-700 hover:bg-violet-100 transition-colors"
                  ><Plus size={10} /> Adicionar</button>
                </div>
                {simNewSeries.map((s, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 rounded-xl bg-violet-50 dark:bg-violet-900/10 border border-violet-100 dark:border-violet-900/50">
                    <select value={s.type} onChange={e => setSimNewSeries(p => p.map((x, i) => i === idx ? { ...x, type: e.target.value as 'receita' | 'despesa' } : x))}
                      className="text-xs bg-transparent text-slate-700 dark:text-gray-300 font-medium focus:outline-none cursor-pointer">
                      <option value="receita">Receita</option><option value="despesa">Despesa</option>
                    </select>
                    <input type="number" placeholder="R$ Valor" value={s.amount} onChange={e => setSimNewSeries(p => p.map((x, i) => i === idx ? { ...x, amount: e.target.value } : x))}
                      className="flex-1 text-xs px-2 py-1 rounded-lg border border-violet-200 dark:border-violet-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none" />
                    <select value={s.frequency} onChange={e => setSimNewSeries(p => p.map((x, i) => i === idx ? { ...x, frequency: e.target.value } : x))}
                      className="text-xs border border-violet-200 dark:border-violet-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-1 py-1 rounded-lg focus:outline-none">
                      {Object.entries(RECURRENCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <button onClick={() => setSimNewSeries(p => p.filter((_, i) => i !== idx))} className="p-1 text-slate-400 hover:text-red-500 transition-colors"><X size={12} /></button>
                  </div>
                ))}
              </div>
              {/* Resultado simulado */}
              {simMonthlyData.length > 0 && (
                <div className="flex items-start gap-4">
                  <div className={cn('flex-none p-3 rounded-xl border text-center min-w-[100px]', simRunway === Infinity ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800' : (simRunway ?? 0) < 3 ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800' : (simRunway ?? 0) < 6 ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800' : 'bg-slate-50 dark:bg-gray-800 border-slate-200 dark:border-gray-700')}>
                    <p className="text-[10px] text-slate-500 dark:text-gray-400">Runway simulado</p>
                    <p className={cn('text-2xl font-display font-bold mt-0.5', simRunway === Infinity ? 'text-emerald-600 dark:text-emerald-400' : (simRunway ?? 0) < 3 ? 'text-red-600 dark:text-red-400' : (simRunway ?? 0) < 6 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-gray-200')}>
                      {simRunway === Infinity ? '∞' : `${simRunway}m`}
                    </p>
                    <p className="text-[10px] text-slate-400 dark:text-gray-500">{simRunway === Infinity ? 'Saldo positivo' : 'meses até zerar'}</p>
                  </div>
                  <div className="flex-1 min-w-0 h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={simMonthlyData} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#1E293B' : '#F1F5F9'} />
                        <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#94A3B8' }} />
                        <YAxis tick={{ fontSize: 9, fill: '#94A3B8' }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                        <RechartsTooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ borderRadius: '10px', fontSize: 11 }} />
                        <Bar dataKey="receita" name="MRR sim." fill="#10B981" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="despesa" name="Burn sim." fill="#EF4444" radius={[3, 3, 0, 0]} />
                        <Line dataKey="saldo" name="Saldo acum." stroke="#8B5CF6" strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Calendar view */}
      {viewMode === 'calendar' && (() => {
        const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
        const dayHeaders = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        const firstDay = new Date(calendarYear, calendarMonth, 1).getDay(); // 0 = Sun
        const totalDays = new Date(calendarYear, calendarMonth + 1, 0).getDate();
        const todayDateStr = new Date().toISOString().slice(0, 10);
        const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)];
        while (cells.length % 7 !== 0) cells.push(null);
        const prevMonth = () => {
          if (calendarMonth === 0) { setCalendarYear(y => y - 1); setCalendarMonth(11); }
          else setCalendarMonth(m => m - 1);
        };
        const nextMonth = () => {
          if (calendarMonth === 11) { setCalendarYear(y => y + 1); setCalendarMonth(0); }
          else setCalendarMonth(m => m + 1);
        };
        return (
          <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
            {/* Calendar header */}
            <div className="px-5 py-3 border-b border-slate-100 dark:border-gray-800 flex items-center gap-3">
              <button onClick={prevMonth} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 text-slate-500 dark:text-gray-400 transition-colors"><ChevronLeft size={16} /></button>
              <h3 className="flex-1 text-center text-sm font-display font-bold text-slate-900 dark:text-gray-100">{monthNames[calendarMonth]} {calendarYear}</h3>
              <button onClick={nextMonth} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 text-slate-500 dark:text-gray-400 transition-colors"><ChevronRight size={16} /></button>
            </div>
            {/* Day headers */}
            <div className="grid grid-cols-7 border-b border-slate-100 dark:border-gray-800">
              {dayHeaders.map(d => (
                <div key={d} className="py-2 text-center text-[10px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wider">{d}</div>
              ))}
            </div>
            {/* Day cells */}
            <div className="grid grid-cols-7">
              {cells.map((day, i) => {
                if (!day) return <div key={i} className={cn('min-h-[72px] border-b border-slate-50 dark:border-gray-800/50', (i + 1) % 7 !== 0 && 'border-r')} />;
                const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const items = calendarDayMap[dateStr] ?? [];
                const isToday = dateStr === todayDateStr;
                return (
                  <div key={i} className={cn('min-h-[72px] p-1.5 border-b border-r border-slate-50 dark:border-gray-800/50', (i + 1) % 7 === 0 && 'border-r-0', isToday && 'bg-red-50/50 dark:bg-red-900/10')}>
                    <span className={cn('text-[11px] font-semibold leading-none block mb-1', isToday ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-gray-400')}>{day}</span>
                    <div className="space-y-0.5">
                      {items.slice(0, 3).map(({ tx, overdue }, j) => (
                        <div key={j} title={`${tx.recurrence?.label || tx.description} — ${formatCurrency(tx.amount)}`}
                          className={cn('text-[9px] font-medium px-1 py-0.5 rounded truncate leading-tight',
                            tx.type === 'receita' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
                              overdue ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' :
                                'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                          )}>
                          {tx.recurrence?.label || tx.description}
                        </div>
                      ))}
                      {items.length > 3 && <span className="text-[9px] text-slate-400 dark:text-gray-500 pl-0.5">+{items.length - 3}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* List groups (hidden in calendar mode) */}
      {viewMode === 'list' && (allRecurrences.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl flex flex-col items-center justify-center py-16 text-slate-400 dark:text-gray-500">
          <Repeat size={40} strokeWidth={1.5} />
          <p className="mt-3 text-sm font-medium">Nenhuma recorrência ativa</p>
          <p className="text-xs mt-1">Crie transações e ative "Lançamento recorrente" para gerenciar</p>
        </div>
      ) : (
        <>
          <RecurringGroup
            items={despesas}
            title="Despesas Recorrentes"
            icon={<ArrowDownRight size={16} className="text-red-500" />}
          />
          <RecurringGroup
            items={receitas}
            title="Receitas Recorrentes"
            icon={<ArrowUpRight size={16} className="text-emerald-500" />}
          />
        </>
      ))}

      {/* Paused recurrences (list mode only) */}
      {viewMode === 'list' && pausedRecurrences.length > 0 && (
        <div className="bg-white dark:bg-gray-900 border border-dashed border-slate-200 dark:border-gray-700 rounded-2xl overflow-hidden">
          <div className="px-6 py-3 border-b border-slate-100 dark:border-gray-800 flex items-center gap-2">
            <PauseCircle size={16} className="text-slate-400 dark:text-gray-500" />
            <h3 className="text-sm font-display font-bold text-slate-500 dark:text-gray-400">Pausadas</h3>
            <span className="ml-auto text-xs text-slate-400 dark:text-gray-500 font-medium">{pausedRecurrences.length} recorrência{pausedRecurrences.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="divide-y divide-slate-50 dark:divide-gray-800">
            {pausedRecurrences.map((tx) => (
              <div key={tx.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3.5 opacity-60">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-14 h-12 rounded-xl flex items-center justify-center border shrink-0 flex-col gap-0.5 bg-slate-100 dark:bg-gray-800 border-slate-200 dark:border-gray-700">
                    <PauseCircle size={16} className="text-slate-400 dark:text-gray-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-700 dark:text-gray-300 truncate">
                      {tx.recurrence?.label || tx.description}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      <span className="text-[11px] text-slate-400 dark:text-gray-500 bg-slate-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-md">
                        {RECURRENCE_LABELS[tx.recurrence?.frequency || 'monthly']}
                      </span>
                      {tx.category && <span className="text-[11px] text-slate-400 dark:text-gray-500">{tx.category}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right mr-2">
                    <p className="text-xs text-slate-400 dark:text-gray-500 leading-none mb-0.5">Valor</p>
                    <p className={cn('text-sm font-bold', tx.type === 'receita' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                      {tx.type === 'receita' ? '+' : '-'}{showBalances ? formatCurrency(tx.amount) : 'R$ ****'}
                    </p>
                  </div>
                  <button
                    onClick={() => handleResume(tx)}
                    disabled={resumingId === tx.id}
                    title="Retomar recorrência"
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors disabled:opacity-50 opacity-100"
                  >
                    {resumingId === tx.id ? <Loader2 size={12} className="animate-spin" /> : <PlayCircle size={12} />}
                    Retomar
                  </button>
                  <button onClick={() => onEdit(tx)} title="Editar" className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-800 rounded-lg transition-colors opacity-100">
                    <Edit3 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── FIN-R24: Toolbar flutuante de edição em lote ── */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 dark:bg-gray-800 text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 border border-gray-700"
          >
            <span className="text-sm font-semibold">{selectedIds.size} selecionada{selectedIds.size !== 1 ? 's' : ''}</span>
            <div className="w-px h-4 bg-gray-600" />
            <button onClick={() => setBulkReajusteOpen(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors"><Percent size={12} /> Reajustar %</button>
            <button onClick={() => setBulkReclassifyOpen(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"><LayoutList size={12} /> Reclassificar</button>
            <button onClick={() => setBulkEndOpen(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold bg-red-600 hover:bg-red-700 rounded-lg transition-colors"><StopCircle size={12} /> Encerrar</button>
            <div className="w-px h-4 bg-gray-600" />
            <button onClick={clearSelection} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-400 hover:text-white rounded-lg transition-colors"><X size={12} /> Desmarcar</button>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={bulkReajusteOpen} onClose={() => setBulkReajusteOpen(false)} PaperProps={{ sx: { borderRadius: '16px', maxWidth: 400, width: '100%' } }}>
        <DialogTitle sx={{ fontWeight: 700, fontSize: '1rem', pb: 1 }}>Reajustar {selectedIds.size} série(s)</DialogTitle>
        <DialogContent>
          <p className="text-sm text-slate-500 mb-4">Informe o percentual de reajuste. Use valores negativos para redução.</p>
          <TextField label="Percentual (%)" type="number" fullWidth value={bulkPct} onChange={e => setBulkPct(e.target.value)} placeholder="Ex: 5"
            InputProps={{ startAdornment: <InputAdornment position="start"><Percent size={14} /></InputAdornment> }}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px' } }}
          />
          {bulkPct && !isNaN(parseFloat(bulkPct)) && <p className="text-xs text-slate-400 mt-2">Exemplo: R$ 1.000 → {formatCurrency(1000 * (1 + parseFloat(bulkPct) / 100))}</p>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setBulkReajusteOpen(false)} disabled={bulkSaving}>Cancelar</Button>
          <Button onClick={handleBulkReajuste} disabled={bulkSaving || !bulkPct || isNaN(parseFloat(bulkPct))} variant="contained"
            sx={{ background: '#7C3AED', '&:hover': { background: '#6D28D9' }, borderRadius: '10px' }}
            startIcon={bulkSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}>Aplicar</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={bulkReclassifyOpen} onClose={() => setBulkReclassifyOpen(false)} PaperProps={{ sx: { borderRadius: '16px', maxWidth: 400, width: '100%' } }}>
        <DialogTitle sx={{ fontWeight: 700, fontSize: '1rem', pb: 1 }}>Reclassificar {selectedIds.size} série(s)</DialogTitle>
        <DialogContent>
          <p className="text-sm text-slate-500 mb-4">Informe a nova categoria para todas as séries selecionadas.</p>
          <TextField label="Nova categoria" fullWidth value={bulkCategory} onChange={e => setBulkCategory(e.target.value)} placeholder="Ex: Infraestrutura"
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px' } }} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setBulkReclassifyOpen(false)} disabled={bulkSaving}>Cancelar</Button>
          <Button onClick={handleBulkReclassify} disabled={bulkSaving || !bulkCategory.trim()} variant="contained"
            sx={{ background: '#2563EB', '&:hover': { background: '#1D4ED8' }, borderRadius: '10px' }}
            startIcon={bulkSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}>Aplicar</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={bulkEndOpen} onClose={() => setBulkEndOpen(false)} PaperProps={{ sx: { borderRadius: '16px', maxWidth: 400, width: '100%' } }}>
        <DialogTitle sx={{ fontWeight: 700, fontSize: '1rem', pb: 1, color: '#DC2626' }}>Encerrar {selectedIds.size} série(s)?</DialogTitle>
        <DialogContent>
          <p className="text-sm text-slate-600">Esta ação marca todas as séries como <strong>inativas</strong>. Lançamentos existentes não são alterados.</p>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setBulkEndOpen(false)} disabled={bulkSaving}>Cancelar</Button>
          <Button onClick={handleBulkEnd} disabled={bulkSaving} variant="contained" color="error" sx={{ borderRadius: '10px' }}
            startIcon={bulkSaving ? <Loader2 size={14} className="animate-spin" /> : <StopCircle size={14} />}>Confirmar encerramento</Button>
        </DialogActions>
      </Dialog>

      {/* Modal completo de detalhe da recorrência */}
      <AnimatePresence>
        {detailTxId && (() => {
          const tx = transactions.find(t => t.id === detailTxId);
          if (!tx) return null;
          return (
            <RecurrenceDetailDialog
              transaction={tx}
              onClose={() => setDetailTxId(null)}
              onPause={onPause}
              onResume={onResume}
              onEndSeries={onEndSeries}
              onAdjustValue={onAdjustValue}
              onMarkPaid={onMarkPaid}
              onSkip={onSkip}
              onEdit={(t) => { onEdit(t); setDetailTxId(null); }}
            />
          );
        })()}
      </AnimatePresence>
    </div>
  );
}

/**
 * Wrapper que injeta o CurrencyProvider em volta do FinancialModuleBody.
 * Mantemos o body como função separada pra que `useCurrencyFormat()` possa
 * ser chamado dentro dele e seus filhos vendo o context corretamente.
 */
export default function FinancialModule() {
  return (
    <CurrencyProvider>
      <FinancialModuleBody />
    </CurrencyProvider>
  );
}
