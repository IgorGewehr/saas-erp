'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
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
import { collection, query, where, orderBy, getDocs, addDoc, updateDoc, deleteDoc, doc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { logAudit } from '@/lib/services/audit';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useQuery as useTanstackQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { useTheme } from '@/app/components/providers/ThemeProvider';
import type {
  Transaction,
  TransactionType,
  TransactionStatus,
  PaymentMethod,
  BankAccount,
  BankAccountType,
  Sector,
  Broadcast,
  ConversationChannel,
  CRMContact,
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

type FinancialTab = 'visao-geral' | 'lancamentos' | 'contas' | 'fluxo' | 'auditoria' | 'comissoes';

const inputSx = { '& .MuiOutlinedInput-root': { borderRadius: '12px' } };

// ==========================================
// COMPONENT
// ==========================================

export default function FinancialModule() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { business, user, sectors } = useAuth();
  const queryClient = useQueryClient();

  const TABS: { key: FinancialTab; label: string; icon: React.ReactNode }[] = [
    { key: 'visao-geral', label: t('financial.tabs.overview', 'Visão Geral'), icon: <BarChart3 size={16} /> },
    { key: 'lancamentos', label: t('financial.tabs.transactions', 'Transações'), icon: <ArrowRightLeft size={16} /> },
    { key: 'fluxo',      label: t('financial.tabs.cashflow',  'Fluxo de Caixa'), icon: <TrendingUp size={16} /> },
    { key: 'contas',     label: t('financial.tabs.accounts',  'Contas Bancárias'), icon: <Landmark size={16} /> },
    { key: 'comissoes',  label: 'Comissões', icon: <Users size={16} /> },
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
  const [showForm, setShowForm] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [showBalances, setShowBalances] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
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

  // Transactions tab state
  const [txFilterTab, setTxFilterTab] = useState<'todas' | 'receitas' | 'despesas' | 'pendentes' | 'atrasadas'>('todas');
  const [txSearch, setTxSearch] = useState('');
  const [txSortField, setTxSortField] = useState('dueDate');
  const [txSortDir, setTxSortDir] = useState<'asc' | 'desc'>('desc');

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

  const filteredTransactions = useMemo(() => {
    let filtered = [...transactions];
    switch (txFilterTab) {
      case 'receitas': filtered = filtered.filter((t) => t.type === 'receita'); break;
      case 'despesas': filtered = filtered.filter((t) => t.type === 'despesa'); break;
      case 'pendentes': filtered = filtered.filter((t) => t.status === 'pendente'); break;
      case 'atrasadas': filtered = filtered.filter((t) => t.status === 'atrasado'); break;
    }
    if (txSearch) {
      const q = txSearch.toLowerCase();
      filtered = filtered.filter((t) =>
        t.description.toLowerCase().includes(q) ||
        (t.category || '').toLowerCase().includes(q) ||
        (t.clientName && t.clientName.toLowerCase().includes(q))
      );
    }
    filtered.sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[txSortField];
      const bVal = (b as unknown as Record<string, unknown>)[txSortField];
      if (typeof aVal === 'string' && typeof bVal === 'string') return txSortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      if (typeof aVal === 'number' && typeof bVal === 'number') return txSortDir === 'asc' ? aVal - bVal : bVal - aVal;
      return 0;
    });
    return filtered;
  }, [transactions, txFilterTab, txSearch, txSortField, txSortDir]);

  // Monthly data for charts
  const monthlyData = useMemo(() => {
    const months: Record<string, { receitas: number; despesas: number }> = {};
    transactions.forEach(t => {
      if (!t.dueDate) return;
      const month = t.dueDate.substring(0, 7);
      if (!months[month]) months[month] = { receitas: 0, despesas: 0 };
      if (t.type === 'receita' && t.status === 'pago') months[month].receitas += t.amount;
      if (t.type === 'despesa' && t.status === 'pago') months[month].despesas += t.amount;
    });
    return Object.entries(months)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, data]) => {
        const [y, m] = month.split('-');
        const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        const label = `${monthNames[parseInt(m) - 1]}/${y.slice(2)}`;
        return { month: label, receitas: data.receitas, despesas: data.despesas, saldo: data.receitas - data.despesas };
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
    setShowForm(true);
  }, []);

  const openEditForm = useCallback((transaction: Transaction) => {
    setEditingTransaction(transaction);
    setFormType(transaction.type);
    setFormDescription(transaction.description);
    setFormCategory(transaction.category ?? '');
    setFormAmount(transaction.amount.toString());
    setFormDueDate(transaction.dueDate ?? '');
    setFormPaymentDate(transaction.paymentDate || '');
    setFormPaymentMethod(transaction.paymentMethod || '');
    setFormNotes(transaction.notes || '');
    setFormClientName(transaction.clientName || '');
    setFormBankAccount(transaction.bankAccountId || '');
    setFormStatus(transaction.status);
    setFormSectorId(transaction.sectorId || '');
    setShowForm(true);
  }, []);

  const handleSaveTransaction = useCallback(async () => {
    if (!business?.id || !user) {
      toast.error(t('financial.toast.businessNotLoaded', 'Dados da empresa não carregados. Recarregue a página.'));
      return;
    }
    const amount = parseFloat(formAmount);
    if (!formDescription || isNaN(amount) || amount <= 0) return;

    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const status: TransactionStatus = formPaymentDate ? 'pago' : formStatus;
      const actor = { uid: user.uid, name: user.name };

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
        updatedByName: user.name,
        updatedBy: user.uid,
        updatedAt: now,
      };

      if (editingTransaction) {
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
  }, [business?.id, user, formType, formDescription, formCategory, formAmount, formDueDate, formPaymentDate, formPaymentMethod, formNotes, formClientName, formBankAccount, formStatus, formSectorId, formInstallments, formInstallmentInterval, editingTransaction, queryClient, t]);

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
            <Tooltip title={showBalances ? t('financial.header.hideBalances', 'Ocultar saldos') : t('financial.header.showBalances', 'Mostrar saldos')}>
              <IconButton
                onClick={() => setShowBalances(!showBalances)}
                size="small"
                sx={{ border: isDark ? '1px solid #374151' : '1px solid #E2E8F0', borderRadius: '10px', width: 36, height: 36 }}
              >
                {showBalances ? <Eye size={16} className="text-slate-500 dark:text-gray-400" /> : <EyeOff size={16} className="text-slate-500 dark:text-gray-400" />}
              </IconButton>
            </Tooltip>
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
        <div className="flex gap-1 p-1.5 bg-white dark:bg-gray-900/80 border border-slate-200/80 dark:border-gray-800 rounded-2xl mb-6 overflow-x-auto shadow-sm backdrop-blur-sm">
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
            </button>
          ))}
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
                onEdit={openEditForm}
                onDelete={(id) => setShowDeleteConfirm(id)}
                getStatusChipColor={getStatusChipColor}
                statusLabel={statusLabel}
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
              <CashFlowProjection transactions={transactions} />
            )}

            {activeTab === 'auditoria' && (
              <AuditLogView businessId={business?.id} />
            )}

            {activeTab === 'comissoes' && (
              <CommissionsContent
                transactions={transactions}
                onMarkPaid={handleMarkAsPaid}
                showBalances={showBalances}
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
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1, fontFamily: '"Plus Jakarta Sans", sans-serif', fontWeight: 700, color: isDark ? '#F1F5F9' : undefined }}>
          <span>{editingTransaction ? t('financial.form.editTransaction', 'Editar Transação') : t('financial.form.newTransaction', 'Nova Transação')}</span>
          <IconButton onClick={() => setShowForm(false)} size="small"><X size={20} className={isDark ? 'text-gray-400' : ''} /></IconButton>
        </DialogTitle>
        <Divider />
        <DialogContent sx={{ pt: 3 }}>
          <div className="space-y-4">
            {/* Type Toggle */}
            <ToggleButtonGroup value={formType} exclusive onChange={(_, v) => v && setFormType(v)} size="small" fullWidth>
              <ToggleButton value="receita" sx={{ gap: 1, borderRadius: '12px 0 0 12px', '&.Mui-selected': { backgroundColor: '#F0FDF4', color: '#166534', borderColor: '#BBF7D0', '&:hover': { backgroundColor: '#DCFCE7' } } }}>
                <ArrowUpRight size={16} /> {t('financial.form.income', 'Receita')}
              </ToggleButton>
              <ToggleButton value="despesa" sx={{ gap: 1, borderRadius: '0 12px 12px 0', '&.Mui-selected': { backgroundColor: '#FEF2F2', color: '#991B1B', borderColor: '#FECACA', '&:hover': { backgroundColor: '#FEE2E2' } } }}>
                <ArrowDownRight size={16} /> {t('financial.form.expense', 'Despesa')}
              </ToggleButton>
            </ToggleButtonGroup>

            <TextField label={t('financial.form.description', 'Descrição')} value={formDescription} onChange={(e) => setFormDescription(e.target.value)} fullWidth required size="small" sx={inputSx} />

            <div className="grid grid-cols-2 gap-3">
              <FormControl fullWidth size="small">
                <InputLabel>{t('financial.form.category', 'Categoria')}</InputLabel>
                <Select value={formCategory} onChange={(e) => setFormCategory(e.target.value)} label={t('financial.form.category', 'Categoria')} sx={{ borderRadius: '12px' }}>
                  {(formType === 'receita' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
                    <MenuItem key={c} value={c}>{c}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField label={t('financial.form.amount', 'Valor')} value={formAmount} onChange={(e) => setFormAmount(e.target.value)} type="number" fullWidth required size="small"
                InputProps={{ startAdornment: <InputAdornment position="start"><span className="text-sm text-slate-400">R$</span></InputAdornment> }}
                sx={inputSx}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <TextField label={t('financial.form.dueDate', 'Vencimento')} type="date" value={formDueDate} onChange={(e) => setFormDueDate(e.target.value)} fullWidth required size="small" InputLabelProps={{ shrink: true }} sx={inputSx} />
              <TextField label={t('financial.form.paymentDate', 'Pagamento')} type="date" value={formPaymentDate} onChange={(e) => setFormPaymentDate(e.target.value)} fullWidth size="small" InputLabelProps={{ shrink: true }} sx={inputSx}
                helperText={t('financial.form.paymentDateHelper', 'Preencha se já foi pago')}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormControl fullWidth size="small">
                <InputLabel>{t('financial.form.paymentMethod', 'Forma de Pagamento')}</InputLabel>
                <Select value={formPaymentMethod} onChange={(e) => setFormPaymentMethod(e.target.value as PaymentMethod | '')} label={t('financial.form.paymentMethod', 'Forma de Pagamento')} sx={{ borderRadius: '12px' }}>
                  <MenuItem value=""><em>-</em></MenuItem>
                  {PAYMENT_METHODS.map((pm) => (<MenuItem key={pm.value} value={pm.value}>{pm.label}</MenuItem>))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>{t('financial.form.status', 'Status')}</InputLabel>
                <Select value={formStatus} onChange={(e) => setFormStatus(e.target.value as TransactionStatus)} label={t('financial.form.status', 'Status')} sx={{ borderRadius: '12px' }}>
                  <MenuItem value="pendente">{t('financial.status.pending', 'Pendente')}</MenuItem>
                  <MenuItem value="pago">{t('financial.status.paid', 'Pago')}</MenuItem>
                  <MenuItem value="atrasado">{t('financial.status.overdue', 'Atrasado')}</MenuItem>
                  <MenuItem value="cancelado">{t('financial.status.cancelled', 'Cancelado')}</MenuItem>
                </Select>
              </FormControl>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <TextField label={t('financial.form.clientOptional', 'Cliente (opcional)')} value={formClientName} onChange={(e) => setFormClientName(e.target.value)} fullWidth size="small" sx={inputSx} />
              <FormControl fullWidth size="small">
                <InputLabel>{t('financial.form.bankAccount', 'Conta Bancária')}</InputLabel>
                <Select value={formBankAccount} onChange={(e) => setFormBankAccount(e.target.value)} label={t('financial.form.bankAccount', 'Conta Bancária')} sx={{ borderRadius: '12px' }}>
                  <MenuItem value=""><em>-</em></MenuItem>
                  {bankAccounts.filter((a) => a.isActive).map((a) => (<MenuItem key={a.id} value={a.id}>{a.name} - {a.bankName}</MenuItem>))}
                </Select>
              </FormControl>
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

            <TextField label={t('financial.form.notes', 'Observações')} value={formNotes} onChange={(e) => setFormNotes(e.target.value)} fullWidth multiline rows={2} size="small" sx={inputSx} />
          </div>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setShowForm(false)} sx={{ color: '#64748B', textTransform: 'none', fontWeight: 600, borderRadius: '12px' }}>{t('financial.form.cancel', 'Cancelar')}</Button>
          <Button onClick={handleSaveTransaction} variant="contained" disabled={!formDescription || !formAmount || parseFloat(formAmount) <= 0 || isSaving}
            sx={{ backgroundColor: '#DC2626', '&:hover': { backgroundColor: '#B91C1C' }, '&.Mui-disabled': { backgroundColor: '#FCA5A5', color: '#fff' }, borderRadius: '12px', textTransform: 'none', fontWeight: 700, px: 4 }}
          >
            {isSaving ? t('financial.form.saving', 'Salvando...') : editingTransaction ? t('financial.form.save', 'Salvar') : t('financial.form.createTransaction', 'Criar Transação')}
          </Button>
        </DialogActions>
      </Dialog>

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
}: {
  metrics: { receitas: number; despesas: number; lucro: number; aReceber: number; aPagar: number; totalContas: number };
  showBalances: boolean;
  ChartTooltip: React.FC;
  fmtChart: (v: number) => string;
  isDark: boolean;
  monthlyData: { month: string; receitas: number; despesas: number; saldo: number }[];
  expenseBreakdown: { name: string; amount: number; color: string; percentage: number }[];
  transactions: Transaction[];
  isEnterprise: boolean;
  sectors: Sector[];
  broadcasts: Broadcast[];
  crmContacts: CRMContact[];
}) {
  const { t } = useTranslation();
  const hiddenValue = '******';

  const overdueCount = transactions.filter(t =>
    t.status === 'pendente' && t.dueDate && new Date(t.dueDate + 'T00:00:00') < new Date()
  ).length;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {[
          { label: t('financial.kpi.paidIncome', 'Receitas Pagas'), value: metrics.receitas, icon: <TrendingUp size={18} />, color: 'emerald' },
          { label: t('financial.kpi.paidExpenses', 'Despesas Pagas'), value: metrics.despesas, icon: <TrendingDown size={18} />, color: 'red' },
          { label: t('financial.kpi.result', 'Resultado'), value: metrics.lucro, icon: <DollarSign size={18} />, color: metrics.lucro >= 0 ? 'blue' : 'red' },
          { label: t('financial.kpi.toReceive', 'A Receber'), value: metrics.aReceber, icon: <Clock size={18} />, color: 'amber' },
          { label: t('financial.kpi.toPay', 'A Pagar'), value: metrics.aPagar, icon: <AlertTriangle size={18} />, color: 'orange' },
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

      {/* Aging Report */}
      {(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const pending = transactions.filter(tx =>
          (tx.status === 'pendente' || tx.status === 'atrasado') && tx.dueDate
        );
        if (pending.length === 0) return null;

        const buckets = [
          { label: t('financial.aging.current', 'A vencer'), range: '0', min: 0, max: 0, color: 'emerald', txs: [] as typeof pending },
          { label: t('financial.aging.d30', '1–30 dias'), range: '30', min: 1, max: 30, color: 'amber', txs: [] as typeof pending },
          { label: t('financial.aging.d60', '31–60 dias'), range: '60', min: 31, max: 60, color: 'orange', txs: [] as typeof pending },
          { label: t('financial.aging.d90', '61–90 dias'), range: '90', min: 61, max: 90, color: 'red', txs: [] as typeof pending },
          { label: t('financial.aging.d90plus', '+90 dias'), range: '90+', min: 91, max: Infinity, color: 'rose', txs: [] as typeof pending },
        ];

        pending.forEach(tx => {
          const due = new Date(tx.dueDate + 'T00:00:00');
          const diffDays = Math.round((today.getTime() - due.getTime()) / 86400000);
          // diffDays > 0 means overdue, < 0 means not yet due
          if (diffDays <= 0) buckets[0].txs.push(tx);
          else if (diffDays <= 30) buckets[1].txs.push(tx);
          else if (diffDays <= 60) buckets[2].txs.push(tx);
          else if (diffDays <= 90) buckets[3].txs.push(tx);
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

        return (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-5 hover:shadow-md transition-all"
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-display font-bold text-slate-900 dark:text-gray-100">{t('financial.aging.title', 'Aging Report — Contas Pendentes')}</h3>
                <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">{t('financial.aging.subtitle', 'Distribuição por tempo de vencimento')}</p>
              </div>
              <span className="text-xs font-semibold text-slate-500 dark:text-gray-400">
                {t('financial.aging.total', 'Total: {{v}}', { v: formatCurrency(totalPending) })}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {buckets.map(b => {
                if (b.txs.length === 0) return null;
                const bTotal = b.txs.reduce((s, tx) => s + tx.amount, 0);
                const pct = totalPending > 0 ? (bTotal / totalPending) * 100 : 0;
                const c = colorMap[b.color];
                return (
                  <div key={b.range} className={`rounded-xl border p-3 ${c.badge}`}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-1 opacity-70">{b.label}</p>
                    <p className="text-sm font-bold mb-0.5">{formatCurrency(bTotal)}</p>
                    <p className="text-[10px] opacity-60 mb-2">{b.txs.length} {b.txs.length === 1 ? t('financial.aging.transaction', 'transação') : t('financial.aging.transactions', 'transações')}</p>
                    <div className="h-1 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                      <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
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
          {monthlyData.length > 0 ? (
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
                <Bar dataKey="receitas" name={t('financial.charts.revenues', 'Receitas')} fill="url(#gradReceita)" radius={[6, 6, 0, 0]} barSize={22} />
                <Bar dataKey="despesas" name={t('financial.charts.expenses', 'Despesas')} fill="url(#gradDespesa)" radius={[6, 6, 0, 0]} barSize={22} />
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

  // CLV Top 10
  const clvTop10 = useMemo(() => {
    const contactRevenue: Record<string, { name: string; total: number; count: number }> = {};
    transactions
      .filter(tx => tx.type === 'receita' && tx.status === 'pago' && tx.contactId)
      .forEach(tx => {
        if (!contactRevenue[tx.contactId!]) {
          const contact = crmContacts.find(c => c.id === tx.contactId);
          contactRevenue[tx.contactId!] = { name: contact?.name || tx.clientName || t('financial.enterprise.unknown', 'Desconhecido'), total: 0, count: 0 };
        }
        contactRevenue[tx.contactId!].total += tx.amount;
        contactRevenue[tx.contactId!].count += 1;
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

function CashFlowProjection({ transactions }: { transactions: Transaction[] }) {
  const [horizon, setHorizon] = useState<30 | 60 | 90>(30);

  const projection = useMemo(() => {
    const today = new Date();
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() + horizon);

    // Use due date for unpaid, payment date for paid (past context)
    const relevant = transactions.filter(t => {
      if (t.status === 'cancelado') return false;
      const dateStr = t.dueDate || t.paymentDate;
      if (!dateStr) return false;
      const d = new Date(dateStr + 'T12:00:00');
      return d >= new Date(today.toISOString().slice(0, 10)) && d <= cutoff;
    });

    // Bucket by date
    const byDate = new Map<string, { receitas: number; despesas: number; items: Transaction[] }>();
    for (const tx of relevant) {
      const key = (tx.dueDate || tx.paymentDate)!;
      const bucket = byDate.get(key) || { receitas: 0, despesas: 0, items: [] };
      if (tx.type === 'receita') bucket.receitas += tx.amount;
      else bucket.despesas += tx.amount;
      bucket.items.push(tx);
      byDate.set(key, bucket);
    }

    const sorted = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, b]) => ({
        date,
        receitas: b.receitas,
        despesas: b.despesas,
        saldo: b.receitas - b.despesas,
        count: b.items.length,
      }));

    // Cumulative balance over the horizon
    let running = 0;
    const withCumulative = sorted.map(s => {
      running += s.saldo;
      return { ...s, acumulado: running };
    });

    const totals = {
      receitas: withCumulative.reduce((s, d) => s + d.receitas, 0),
      despesas: withCumulative.reduce((s, d) => s + d.despesas, 0),
      pendingCount: relevant.filter(t => t.status === 'pendente' || t.status === 'atrasado').length,
    };

    return { data: withCumulative, totals };
  }, [transactions, horizon]);

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            Projeção de Fluxo de Caixa
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Entradas e saídas previstas nos próximos {horizon} dias
          </p>
        </div>
        <div className="inline-flex bg-gray-100 dark:bg-gray-800/60 rounded-xl p-0.5">
          {([30, 60, 90] as const).map(h => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-bold transition-colors',
                horizon === h
                  ? 'bg-white dark:bg-gray-900 shadow-sm text-gray-900 dark:text-gray-100'
                  : 'text-gray-500 dark:text-gray-400',
              )}
            >
              {h} dias
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-bold">Receitas previstas</p>
          <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 mt-1">{formatCurrency(projection.totals.receitas)}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-red-700 dark:text-red-400 font-bold">Despesas previstas</p>
          <p className="text-2xl font-bold text-red-700 dark:text-red-300 mt-1">{formatCurrency(projection.totals.despesas)}</p>
        </div>
        <div className={cn(
          'rounded-xl p-4 border',
          projection.totals.receitas - projection.totals.despesas >= 0
            ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30'
            : 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30',
        )}>
          <p className={cn(
            'text-[10px] uppercase tracking-wider font-bold',
            projection.totals.receitas - projection.totals.despesas >= 0
              ? 'text-blue-700 dark:text-blue-400'
              : 'text-amber-700 dark:text-amber-400',
          )}>Resultado previsto</p>
          <p className={cn(
            'text-2xl font-bold mt-1',
            projection.totals.receitas - projection.totals.despesas >= 0
              ? 'text-blue-700 dark:text-blue-300'
              : 'text-amber-700 dark:text-amber-300',
          )}>
            {formatCurrency(projection.totals.receitas - projection.totals.despesas)}
          </p>
        </div>
      </div>

      {/* Chart */}
      {projection.data.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-12 text-center">
          <TrendingUp className="w-10 h-10 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Nenhum lançamento previsto neste horizonte</p>
          <p className="text-xs text-gray-500 mt-1">Transações com data de vencimento nos próximos {horizon} dias aparecem aqui</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={projection.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Tooltip {...({
                formatter: (value: number) => formatCurrency(value),
                contentStyle: { borderRadius: '12px', border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)' },
              } as any)} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="receitas" fill="#10B981" name="Receitas" radius={[4, 4, 0, 0]} />
              <Bar dataKey="despesas" fill="#EF4444" name="Despesas" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="acumulado" stroke="#3B82F6" name="Saldo acumulado" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ==========================================
// AUDIT LOG VIEW
// ==========================================

function AuditLogView({ businessId }: { businessId?: string }) {
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

function TransactionsContent({
  transactions,
  allTransactions,
  filterTab,
  onFilterChange,
  search,
  onSearchChange,
  sortField,
  sortDir,
  onSort,
  onMarkPaid,
  onEdit,
  onDelete,
  getStatusChipColor,
  statusLabel,
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
  onEdit: (t: Transaction) => void;
  onDelete: (id: string) => void;
  getStatusChipColor: (s: TransactionStatus) => { bg: string; text: string; border: string };
  statusLabel: (s: TransactionStatus) => string;
}) {
  const { t } = useTranslation();
  const filterTabs = [
    { key: 'todas', label: t('financial.txFilter.all', 'Todas'), count: allTransactions.length },
    { key: 'receitas', label: t('financial.txFilter.income', 'Receitas'), count: allTransactions.filter((tx) => tx.type === 'receita').length },
    { key: 'despesas', label: t('financial.txFilter.expenses', 'Despesas'), count: allTransactions.filter((tx) => tx.type === 'despesa').length },
    { key: 'pendentes', label: t('financial.txFilter.pending', 'Pendentes'), count: allTransactions.filter((tx) => tx.status === 'pendente').length },
    { key: 'atrasadas', label: t('financial.txFilter.overdue', 'Atrasadas'), count: allTransactions.filter((tx) => tx.status === 'atrasado').length },
  ];

  return (
    <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl">
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <h3 className="text-base font-display font-bold text-slate-900 dark:text-gray-100">{t('financial.txList.title', 'Transações')}</h3>
          <div className="relative w-full sm:w-72">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
            <input type="text" placeholder={t('financial.txList.searchPlaceholder', 'Buscar transação...')} value={search} onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-xl text-sm text-slate-900 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
            />
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto">
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
                return (
                  <motion.tr key={tx.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ delay: i * 0.015 }}
                    className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors group"
                  >
                    <td className="px-5 py-3 text-sm text-slate-500 dark:text-gray-400 whitespace-nowrap">{formatDate(tx.dueDate)}</td>
                    <td className="px-5 py-3">
                      <p className="text-sm font-medium text-slate-800 dark:text-gray-200 truncate max-w-[220px]">{tx.description}</p>
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
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Tooltip title={t('financial.txList.edit', 'Editar')}><IconButton size="small" onClick={() => onEdit(tx)} sx={{ color: '#64748B' }}><Edit3 size={14} /></IconButton></Tooltip>
                        <Tooltip title={t('financial.txList.delete', 'Excluir')}><IconButton size="small" onClick={() => onDelete(tx.id)} sx={{ color: '#64748B', '&:hover': { color: '#EF4444' } }}><Trash2 size={14} /></IconButton></Tooltip>
                      </div>
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
          <p className="mt-3 text-sm">{t('financial.txList.empty', 'Nenhuma transação encontrada')}</p>
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

type CommissionPeriod = 'mes' | 'mes_anterior' | 'todos';

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
}: {
  transactions: Transaction[];
  onMarkPaid: (id: string) => void;
  showBalances: boolean;
}) {
  const [period, setPeriod] = useState<CommissionPeriod>('mes');
  const [expandedProfessional, setExpandedProfessional] = useState<string | null>(null);
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);

  // Filter commission transactions by period
  const commissionTx = useMemo<Transaction[]>(() => {
    const all = transactions.filter(t => t.category === 'Comissoes' && t.type === 'despesa');
    if (period === 'todos') return all;
    const now = new Date();
    const monthOffset = period === 'mes_anterior' ? -1 : 0;
    const y = now.getFullYear();
    const m = now.getMonth() + monthOffset;
    const start = new Date(y, m, 1).toISOString().slice(0, 10);
    const end = new Date(y, m + 1, 0).toISOString().slice(0, 10);
    return all.filter(t => t.dueDate && t.dueDate >= start && t.dueDate <= end);
  }, [transactions, period]);

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
    todos: 'Todos',
  };

  const handleMarkPaid = async (id: string) => {
    setMarkingPaid(id);
    try { await onMarkPaid(id); } finally { setMarkingPaid(null); }
  };

  const statusChip = (status: TransactionStatus) => {
    if (status === 'pago')      return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700/40';
    if (status === 'cancelado') return 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700';
    return 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700/40';
  };
  const statusText = (status: TransactionStatus) => ({
    pendente: 'Pendente', pago: 'Pago', cancelado: 'Cancelado', atrasado: 'Atrasado'
  }[status] ?? status);

  return (
    <div className="space-y-4">
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
            <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">Clique para expandir os lançamentos</p>
          </div>
          <div className="flex gap-1 p-1 bg-slate-50 dark:bg-gray-800 rounded-xl">
            {(Object.entries(periodLabels) as [CommissionPeriod, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setPeriod(key)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                  period === key
                    ? 'bg-white dark:bg-gray-700 text-slate-900 dark:text-gray-100 shadow-sm'
                    : 'text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300'
                )}
              >{label}</button>
            ))}
          </div>
        </div>

        {grouped.length === 0 ? (
          <div className="py-16 flex flex-col items-center text-slate-400 dark:text-gray-500">
            <Users size={40} strokeWidth={1.5} />
            <p className="mt-3 text-sm font-medium">Nenhuma comissão no período</p>
            <p className="text-xs mt-1">Configure a taxa de comissão dos profissionais em Configurações → Usuários</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-gray-800">
            {grouped.map(group => (
              <div key={group.professionalId}>
                {/* Professional row */}
                <button
                  type="button"
                  onClick={() => setExpandedProfessional(expandedProfessional === group.professionalId ? null : group.professionalId)}
                  className="w-full flex items-center gap-4 px-6 py-4 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors text-left"
                >
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-red-100 to-rose-100 dark:from-red-900/40 dark:to-rose-900/30 border border-red-200/60 dark:border-red-800/40 flex items-center justify-center text-xs font-bold text-red-700 dark:text-red-400 flex-shrink-0">
                    {(group.professionalName || '?').split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-gray-100 truncate">{group.professionalName}</p>
                    <p className="text-xs text-slate-400 dark:text-gray-500">{group.transactions.length} lançamento{group.transactions.length !== 1 ? 's' : ''}</p>
                  </div>
                  {/* Totals */}
                  <div className="hidden sm:flex items-center gap-6 text-right">
                    <div>
                      <p className="text-[10px] text-slate-400 dark:text-gray-500 uppercase tracking-wide">Pendente</p>
                      <p className="text-sm font-bold text-amber-600 dark:text-amber-400">
                        {showBalances ? formatCurrency(group.totalPendente) : '****'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 dark:text-gray-500 uppercase tracking-wide">Pago</p>
                      <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        {showBalances ? formatCurrency(group.totalPago) : '****'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 dark:text-gray-500 uppercase tracking-wide">Total</p>
                      <p className="text-sm font-bold text-slate-800 dark:text-gray-100">
                        {showBalances ? formatCurrency(group.totalGeral) : '****'}
                      </p>
                    </div>
                  </div>
                  <ChevronDown
                    size={16}
                    className={cn('text-slate-400 dark:text-gray-500 transition-transform flex-shrink-0', expandedProfessional === group.professionalId && 'rotate-180')}
                  />
                </button>

                {/* Expanded transactions */}
                <AnimatePresence>
                  {expandedProfessional === group.professionalId && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
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
                            <p className="text-sm font-bold text-slate-800 dark:text-gray-100 flex-shrink-0">
                              {showBalances ? formatCurrency(tx.amount) : '****'}
                            </p>
                            <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-lg border flex-shrink-0', statusChip(tx.status))}>
                              {statusText(tx.status)}
                            </span>
                            {tx.status === 'pendente' && (
                              <button
                                onClick={() => handleMarkPaid(tx.id)}
                                disabled={markingPaid === tx.id}
                                title="Marcar como pago"
                                className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[11px] font-semibold transition-colors"
                              >
                                {markingPaid === tx.id
                                  ? <><span className="w-3 h-3 border border-white/60 border-t-white rounded-full animate-spin" /></>
                                  : <><CheckCircle2 size={12} /> Pagar</>}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        )}
      </div>
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
