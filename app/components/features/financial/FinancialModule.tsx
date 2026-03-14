'use client';

import React, { useState, useMemo, useCallback } from 'react';
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
  Autocomplete,
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
  TrendingDown,
  DollarSign,
  Clock,
  AlertTriangle,
  Plus,
  Search,
  Filter,
  X,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  ChevronDown,
  MoreHorizontal,
  Edit3,
  Trash2,
  Eye,
  Receipt,
  Wallet,
  CreditCard,
  Banknote,
  Smartphone,
  FileText,
  Tag,
  Repeat,
  CircleDollarSign,
  PiggyBank,
  ShoppingBag,
  Briefcase,
  Car,
  Wifi,
  Wrench,
  Building2,
  Users,
  ChevronLeft,
  ChevronRight,
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
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate, getStatusColor, getStatusLabel } from '@/lib/utils/format';
import type { Transaction, TransactionType, TransactionStatus, PaymentMethod, Client } from '@/lib/types';

// ==========================================
// MOCK DATA
// ==========================================

const MOCK_CLIENTS: Client[] = [
  { id: 'c1', businessId: 'b1', tipo: 'pf', nome: 'Maria Silva', cpfCnpj: '12345678901', phone: '11999887766', isActive: true, totalSpent: 2450, visitCount: 12, createdAt: '', updatedAt: '' },
  { id: 'c2', businessId: 'b1', tipo: 'pf', nome: 'João Santos', cpfCnpj: '98765432100', phone: '11988776655', isActive: true, totalSpent: 890, visitCount: 5, createdAt: '', updatedAt: '' },
  { id: 'c3', businessId: 'b1', tipo: 'pf', nome: 'Ana Oliveira', cpfCnpj: '11122233344', phone: '11977665544', isActive: true, totalSpent: 3200, visitCount: 18, createdAt: '', updatedAt: '' },
  { id: 'c4', businessId: 'b1', tipo: 'pf', nome: 'Pedro Costa', cpfCnpj: '55566677788', phone: '11966554433', isActive: true, totalSpent: 420, visitCount: 3, createdAt: '', updatedAt: '' },
  { id: 'c5', businessId: 'b1', tipo: 'pf', nome: 'Carla Mendes', cpfCnpj: '99988877766', phone: '11955443322', isActive: true, totalSpent: 1580, visitCount: 9, createdAt: '', updatedAt: '' },
];

const TODAY = '2026-03-13';

const MOCK_TRANSACTIONS: Transaction[] = [
  { id: 't1', businessId: 'b1', type: 'receita', category: 'Serviços', description: 'Corte + Escova - Maria Silva', amount: 130, dueDate: '2026-03-13', paymentDate: '2026-03-13', status: 'pago', clientId: 'c1', clientName: 'Maria Silva', paymentMethod: 'pix', createdAt: '2026-03-13T10:00:00', updatedAt: '' },
  { id: 't2', businessId: 'b1', type: 'receita', category: 'Produtos', description: 'Venda Shampoo + Condicionador', amount: 117, dueDate: '2026-03-13', paymentDate: '2026-03-13', status: 'pago', clientId: 'c3', clientName: 'Ana Oliveira', paymentMethod: 'credito', createdAt: '2026-03-13T11:30:00', updatedAt: '' },
  { id: 't3', businessId: 'b1', type: 'receita', category: 'Serviços', description: 'Coloração Completa', amount: 190, dueDate: '2026-03-13', status: 'pendente', clientId: 'c5', clientName: 'Carla Mendes', createdAt: '2026-03-13T14:00:00', updatedAt: '' },
  { id: 't4', businessId: 'b1', type: 'despesa', category: 'Fornecedores', description: 'Produtos de Limpeza', amount: 245, dueDate: '2026-03-12', paymentDate: '2026-03-12', status: 'pago', paymentMethod: 'pix', createdAt: '2026-03-12T09:00:00', updatedAt: '' },
  { id: 't5', businessId: 'b1', type: 'despesa', category: 'Aluguel', description: 'Aluguel Março/2026', amount: 3500, dueDate: '2026-03-10', paymentDate: '2026-03-10', status: 'pago', paymentMethod: 'boleto', createdAt: '2026-03-10T08:00:00', updatedAt: '' },
  { id: 't6', businessId: 'b1', type: 'receita', category: 'Serviços', description: 'Manicure + Pedicure', amount: 85, dueDate: '2026-03-11', paymentDate: '2026-03-11', status: 'pago', clientId: 'c2', clientName: 'João Santos', paymentMethod: 'dinheiro', createdAt: '2026-03-11T15:00:00', updatedAt: '' },
  { id: 't7', businessId: 'b1', type: 'receita', category: 'Serviços', description: 'Escova Progressiva', amount: 280, dueDate: '2026-03-10', paymentDate: '2026-03-10', status: 'pago', clientId: 'c1', clientName: 'Maria Silva', paymentMethod: 'credito', createdAt: '2026-03-10T10:00:00', updatedAt: '' },
  { id: 't8', businessId: 'b1', type: 'despesa', category: 'Salários', description: 'Salário - Funcionária Ana', amount: 2800, dueDate: '2026-03-05', paymentDate: '2026-03-05', status: 'pago', paymentMethod: 'pix', createdAt: '2026-03-05T08:00:00', updatedAt: '' },
  { id: 't9', businessId: 'b1', type: 'despesa', category: 'Fornecedores', description: 'Reposição de Estoque - Produtos Capilares', amount: 1850, dueDate: '2026-03-15', status: 'pendente', createdAt: '2026-03-08T14:00:00', updatedAt: '' },
  { id: 't10', businessId: 'b1', type: 'receita', category: 'Serviços', description: 'Mechas + Hidratação', amount: 345, dueDate: '2026-03-08', paymentDate: '2026-03-08', status: 'pago', clientId: 'c3', clientName: 'Ana Oliveira', paymentMethod: 'debito', createdAt: '2026-03-08T09:00:00', updatedAt: '' },
  { id: 't11', businessId: 'b1', type: 'despesa', category: 'Energia', description: 'Conta de Luz Fev/2026', amount: 680, dueDate: '2026-03-03', status: 'atrasado', createdAt: '2026-03-01T08:00:00', updatedAt: '' },
  { id: 't12', businessId: 'b1', type: 'receita', category: 'Serviços', description: 'Corte Masculino + Barba', amount: 75, dueDate: '2026-03-07', paymentDate: '2026-03-07', status: 'pago', clientId: 'c4', clientName: 'Pedro Costa', paymentMethod: 'dinheiro', createdAt: '2026-03-07T16:00:00', updatedAt: '' },
  { id: 't13', businessId: 'b1', type: 'receita', category: 'Produtos', description: 'Kit Manicure Profissional', amount: 159, dueDate: '2026-03-06', paymentDate: '2026-03-06', status: 'pago', clientId: 'c5', clientName: 'Carla Mendes', paymentMethod: 'pix', createdAt: '2026-03-06T11:00:00', updatedAt: '' },
  { id: 't14', businessId: 'b1', type: 'despesa', category: 'Internet', description: 'Internet + Telefone Março', amount: 320, dueDate: '2026-03-15', status: 'pendente', createdAt: '2026-03-01T08:00:00', updatedAt: '' },
  { id: 't15', businessId: 'b1', type: 'receita', category: 'Serviços', description: 'Design de Sobrancelha + Limpeza de Pele', amount: 155, dueDate: '2026-03-05', paymentDate: '2026-03-05', status: 'pago', clientId: 'c1', clientName: 'Maria Silva', paymentMethod: 'pix', createdAt: '2026-03-05T14:00:00', updatedAt: '' },
  { id: 't16', businessId: 'b1', type: 'despesa', category: 'Manutenção', description: 'Reparo torneira lavatório', amount: 150, dueDate: '2026-03-02', paymentDate: '2026-03-02', status: 'pago', paymentMethod: 'dinheiro', createdAt: '2026-03-02T09:00:00', updatedAt: '' },
  { id: 't17', businessId: 'b1', type: 'receita', category: 'Serviços', description: 'Hidratação Capilar', amount: 95, dueDate: '2026-03-04', paymentDate: '2026-03-04', status: 'pago', clientId: 'c2', clientName: 'João Santos', paymentMethod: 'debito', createdAt: '2026-03-04T10:00:00', updatedAt: '' },
  { id: 't18', businessId: 'b1', type: 'despesa', category: 'Marketing', description: 'Instagram Ads Março', amount: 500, dueDate: '2026-03-01', paymentDate: '2026-03-01', status: 'pago', paymentMethod: 'credito', createdAt: '2026-03-01T08:00:00', updatedAt: '' },
  { id: 't19', businessId: 'b1', type: 'receita', category: 'Serviços', description: 'Corte Feminino + Escova', amount: 120, dueDate: '2026-03-14', status: 'pendente', clientId: 'c3', clientName: 'Ana Oliveira', createdAt: '2026-03-12T16:00:00', updatedAt: '' },
  { id: 't20', businessId: 'b1', type: 'despesa', category: 'Fornecedores', description: 'Luvas + Máscaras descartáveis', amount: 180, dueDate: '2026-02-28', status: 'atrasado', createdAt: '2026-02-25T08:00:00', updatedAt: '' },
];

const CASH_FLOW_DATA = [
  { month: 'Out', receitas: 12400, despesas: 8200, saldo: 4200 },
  { month: 'Nov', receitas: 14800, despesas: 9100, saldo: 5700 },
  { month: 'Dez', receitas: 18200, despesas: 10500, saldo: 7700 },
  { month: 'Jan', receitas: 11600, despesas: 8800, saldo: 2800 },
  { month: 'Fev', receitas: 15900, despesas: 9400, saldo: 6500 },
  { month: 'Mar', receitas: 8750, despesas: 5225, saldo: 3525 },
];

const EXPENSE_CATEGORIES = [
  { name: 'Aluguel', amount: 3500, color: '#DC2626', percentage: 33.5 },
  { name: 'Salários', amount: 2800, color: '#F59E0B', percentage: 26.8 },
  { name: 'Fornecedores', amount: 2275, color: '#3B82F6', percentage: 21.8 },
  { name: 'Energia', amount: 680, color: '#10B981', percentage: 6.5 },
  { name: 'Marketing', amount: 500, color: '#8B5CF6', percentage: 4.8 },
  { name: 'Internet', amount: 320, color: '#EC4899', percentage: 3.1 },
  { name: 'Manutenção', amount: 150, color: '#6366F1', percentage: 1.4 },
];

const INCOME_CATEGORIES: string[] = [
  'Serviços',
  'Produtos',
  'Pacotes',
  'Assinaturas',
  'Outros',
];

const EXPENSE_CAT_OPTIONS: string[] = [
  'Aluguel',
  'Salários',
  'Fornecedores',
  'Energia',
  'Internet',
  'Marketing',
  'Manutenção',
  'Impostos',
  'Material de escritório',
  'Outros',
];

type FilterTab = 'todas' | 'receitas' | 'despesas' | 'pendentes' | 'atrasadas';
type PeriodFilter = 'hoje' | 'semana' | 'mes' | 'trimestre' | 'custom';

const RECURRENCE_OPTIONS = [
  { value: 'unica', label: 'Única' },
  { value: 'semanal', label: 'Semanal' },
  { value: 'quinzenal', label: 'Quinzenal' },
  { value: 'mensal', label: 'Mensal' },
  { value: 'trimestral', label: 'Trimestral' },
  { value: 'anual', label: 'Anual' },
];

const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'pix', label: 'PIX' },
  { value: 'credito', label: 'Cartão de Crédito' },
  { value: 'debito', label: 'Cartão de Débito' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'outros', label: 'Outros' },
];

// ==========================================
// COMPONENT
// ==========================================

export default function FinancialModule() {
  // --- State ---
  const [period, setPeriod] = useState<PeriodFilter>('mes');
  const [filterTab, setFilterTab] = useState<FilterTab>('todas');
  const [searchQuery, setSearchQuery] = useState('');
  const [transactions, setTransactions] = useState<Transaction[]>(MOCK_TRANSACTIONS);
  const [showForm, setShowForm] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [sortField, setSortField] = useState<string>('dueDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Form state
  const [formType, setFormType] = useState<TransactionType>('receita');
  const [formDescription, setFormDescription] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formPaymentDate, setFormPaymentDate] = useState('');
  const [formPaymentMethod, setFormPaymentMethod] = useState<PaymentMethod | ''>('');
  const [formClient, setFormClient] = useState<Client | null>(null);
  const [formNotes, setFormNotes] = useState('');
  const [formRecurrence, setFormRecurrence] = useState('unica');

  // --- Derived ---
  const filteredTransactions = useMemo(() => {
    let filtered = [...transactions];

    // Filter by tab
    switch (filterTab) {
      case 'receitas':
        filtered = filtered.filter((t) => t.type === 'receita');
        break;
      case 'despesas':
        filtered = filtered.filter((t) => t.type === 'despesa');
        break;
      case 'pendentes':
        filtered = filtered.filter((t) => t.status === 'pendente');
        break;
      case 'atrasadas':
        filtered = filtered.filter((t) => t.status === 'atrasado');
        break;
    }

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.description.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          (t.clientName && t.clientName.toLowerCase().includes(q)),
      );
    }

    // Sort
    filtered.sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sortField];
      const bVal = (b as unknown as Record<string, unknown>)[sortField];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });

    return filtered;
  }, [transactions, filterTab, searchQuery, sortField, sortDir]);

  const summaryMetrics = useMemo(() => {
    const receitas = transactions
      .filter((t) => t.type === 'receita' && t.status === 'pago')
      .reduce((sum, t) => sum + t.amount, 0);
    const despesas = transactions
      .filter((t) => t.type === 'despesa' && t.status === 'pago')
      .reduce((sum, t) => sum + t.amount, 0);
    const aReceber = transactions
      .filter((t) => t.type === 'receita' && (t.status === 'pendente' || t.status === 'atrasado'))
      .reduce((sum, t) => sum + t.amount, 0);
    const aPagar = transactions
      .filter((t) => t.type === 'despesa' && (t.status === 'pendente' || t.status === 'atrasado'))
      .reduce((sum, t) => sum + t.amount, 0);
    const saldo = receitas - despesas;
    return { receitas, despesas, saldo, aReceber, aPagar };
  }, [transactions]);

  // --- Handlers ---
  const handleSort = useCallback(
    (field: string) => {
      if (sortField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir('desc');
      }
    },
    [sortField],
  );

  const handleMarkAsPaid = useCallback((id: string) => {
    setTransactions((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, status: 'pago' as TransactionStatus, paymentDate: TODAY }
          : t,
      ),
    );
  }, []);

  const openNewForm = useCallback(() => {
    setEditingTransaction(null);
    setFormType('receita');
    setFormDescription('');
    setFormCategory('');
    setFormAmount('');
    setFormDueDate('');
    setFormPaymentDate('');
    setFormPaymentMethod('');
    setFormClient(null);
    setFormNotes('');
    setFormRecurrence('unica');
    setShowForm(true);
  }, []);

  const openEditForm = useCallback((transaction: Transaction) => {
    setEditingTransaction(transaction);
    setFormType(transaction.type);
    setFormDescription(transaction.description);
    setFormCategory(transaction.category);
    setFormAmount(transaction.amount.toString());
    setFormDueDate(transaction.dueDate);
    setFormPaymentDate(transaction.paymentDate || '');
    setFormPaymentMethod(transaction.paymentMethod || '');
    setFormClient(
      MOCK_CLIENTS.find((c) => c.id === transaction.clientId) || null,
    );
    setFormNotes(transaction.notes || '');
    setFormRecurrence('unica');
    setShowForm(true);
  }, []);

  const handleSaveTransaction = useCallback(() => {
    const amount = parseFloat(formAmount);
    if (!formDescription || !formCategory || isNaN(amount) || !formDueDate) return;

    const newTransaction: Transaction = {
      id: editingTransaction?.id || `t-${Date.now()}`,
      businessId: 'b1',
      type: formType,
      category: formCategory,
      description: formDescription,
      amount,
      dueDate: formDueDate,
      paymentDate: formPaymentDate || undefined,
      status: formPaymentDate ? 'pago' : 'pendente',
      clientId: formClient?.id,
      clientName: formClient?.nome,
      paymentMethod: (formPaymentMethod as PaymentMethod) || undefined,
      notes: formNotes || undefined,
      createdAt: editingTransaction?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (editingTransaction) {
      setTransactions((prev) =>
        prev.map((t) => (t.id === editingTransaction.id ? newTransaction : t)),
      );
    } else {
      setTransactions((prev) => [newTransaction, ...prev]);
    }

    setShowForm(false);
  }, [
    formType,
    formDescription,
    formCategory,
    formAmount,
    formDueDate,
    formPaymentDate,
    formPaymentMethod,
    formClient,
    formNotes,
    formRecurrence,
    editingTransaction,
  ]);

  const handleDeleteTransaction = useCallback((id: string) => {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const getStatusChipColor = (status: TransactionStatus) => {
    const colors: Record<TransactionStatus, { bg: string; text: string; border: string }> = {
      pago: { bg: '#F0FDF4', text: '#166534', border: '#BBF7D0' },
      pendente: { bg: '#FEFCE8', text: '#854D0E', border: '#FEF08A' },
      atrasado: { bg: '#FEF2F2', text: '#991B1B', border: '#FECACA' },
      cancelado: { bg: '#F8FAFC', text: '#475569', border: '#E2E8F0' },
    };
    return colors[status] || colors.pendente;
  };

  const formatChartCurrency = (value: number) => {
    if (value >= 1000) return `R$ ${(value / 1000).toFixed(1)}k`;
    return `R$ ${value}`;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-3">
          <p className="text-sm font-semibold text-slate-900 mb-2">{label}</p>
          {payload.map((entry: { name: string; value: number; color: string }, index: number) => (
            <div key={index} className="flex items-center gap-2 text-sm">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-slate-600">{entry.name}:</span>
              <span className="font-semibold text-slate-900">{formatCurrency(entry.value)}</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const periodLabels: Record<PeriodFilter, string> = {
    hoje: 'Hoje',
    semana: 'Esta Semana',
    mes: 'Este Mês',
    trimestre: 'Trimestre',
    custom: 'Personalizado',
  };

  const filterTabs: { key: FilterTab; label: string; count?: number }[] = [
    { key: 'todas', label: 'Todas', count: transactions.length },
    {
      key: 'receitas',
      label: 'Receitas',
      count: transactions.filter((t) => t.type === 'receita').length,
    },
    {
      key: 'despesas',
      label: 'Despesas',
      count: transactions.filter((t) => t.type === 'despesa').length,
    },
    {
      key: 'pendentes',
      label: 'Pendentes',
      count: transactions.filter((t) => t.status === 'pendente').length,
    },
    {
      key: 'atrasadas',
      label: 'Atrasadas',
      count: transactions.filter((t) => t.status === 'atrasado').length,
    },
  ];

  // ==========================================
  // RENDER
  // ==========================================

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* ========== HEADER ========== */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-display font-bold text-slate-900">Financeiro</h1>
            <p className="text-sm text-slate-500 mt-0.5">Gestão financeira completa</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Period Selector */}
            <div className="flex p-0.5 bg-white border border-slate-200 rounded-xl shadow-sm">
              {(['hoje', 'semana', 'mes', 'trimestre'] as PeriodFilter[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                    period === p
                      ? 'bg-red-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700',
                  )}
                >
                  {periodLabels[p]}
                </button>
              ))}
            </div>
            <Button
              onClick={openNewForm}
              variant="contained"
              startIcon={<Plus size={18} />}
              sx={{
                backgroundColor: '#DC2626',
                '&:hover': { backgroundColor: '#B91C1C' },
                borderRadius: '12px',
                textTransform: 'none',
                fontWeight: 700,
                px: 3,
                py: 1,
              }}
            >
              Nova Transação
            </Button>
          </div>
        </div>

        {/* ========== SUMMARY CARDS ========== */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          {[
            {
              label: 'Total Receitas',
              value: summaryMetrics.receitas,
              icon: <TrendingUp size={20} />,
              color: 'emerald',
              trend: '+12.5%',
              trendUp: true,
            },
            {
              label: 'Total Despesas',
              value: summaryMetrics.despesas,
              icon: <TrendingDown size={20} />,
              color: 'red',
              trend: '-3.2%',
              trendUp: false,
            },
            {
              label: 'Saldo',
              value: summaryMetrics.saldo,
              icon: <DollarSign size={20} />,
              color: summaryMetrics.saldo >= 0 ? 'blue' : 'red',
              trend: summaryMetrics.saldo >= 0 ? '+8.1%' : '-8.1%',
              trendUp: summaryMetrics.saldo >= 0,
            },
            {
              label: 'A Receber',
              value: summaryMetrics.aReceber,
              icon: <Clock size={20} />,
              color: 'amber',
              trend: null,
              trendUp: null,
            },
            {
              label: 'A Pagar',
              value: summaryMetrics.aPagar,
              icon: <AlertTriangle size={20} />,
              color: 'orange',
              trend: null,
              trendUp: null,
            },
          ].map((card, index) => {
            const colorMap: Record<string, { bg: string; iconBg: string; iconText: string; valueText: string }> = {
              emerald: { bg: 'bg-white', iconBg: 'bg-emerald-50', iconText: 'text-emerald-600', valueText: 'text-emerald-600' },
              red: { bg: 'bg-white', iconBg: 'bg-red-50', iconText: 'text-red-600', valueText: 'text-red-600' },
              blue: { bg: 'bg-white', iconBg: 'bg-blue-50', iconText: 'text-blue-600', valueText: 'text-blue-600' },
              amber: { bg: 'bg-white', iconBg: 'bg-amber-50', iconText: 'text-amber-600', valueText: 'text-amber-600' },
              orange: { bg: 'bg-white', iconBg: 'bg-orange-50', iconText: 'text-orange-600', valueText: 'text-orange-600' },
            };
            const colors = colorMap[card.color] || colorMap.blue;
            return (
              <motion.div
                key={card.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08 }}
                className={cn(
                  'rounded-2xl border border-slate-200 p-5 shadow-sm',
                  colors.bg,
                )}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', colors.iconBg, colors.iconText)}>
                    {card.icon}
                  </div>
                  {card.trend && (
                    <div className={cn(
                      'flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full',
                      card.trendUp ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600',
                    )}>
                      {card.trendUp ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                      {card.trend}
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-500 font-medium mb-1">{card.label}</p>
                <p className={cn('text-xl font-display font-bold', colors.valueText)}>
                  {formatCurrency(card.value)}
                </p>
              </motion.div>
            );
          })}
        </div>

        {/* ========== CHARTS ROW ========== */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Cash Flow Chart */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-base font-display font-bold text-slate-900">Fluxo de Caixa</h3>
                <p className="text-xs text-slate-500 mt-0.5">Receitas vs Despesas - Últimos 6 meses</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={CASH_FLOW_DATA}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#94A3B8', fontSize: 12 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#94A3B8', fontSize: 12 }}
                  tickFormatter={formatChartCurrency}
                />
                <RechartsTooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ paddingTop: 16 }}
                  iconType="circle"
                  iconSize={8}
                  formatter={(value: string) => (
                    <span className="text-xs text-slate-600">{value}</span>
                  )}
                />
                <Bar
                  dataKey="receitas"
                  name="Receitas"
                  fill="#10B981"
                  radius={[6, 6, 0, 0]}
                  barSize={24}
                />
                <Bar
                  dataKey="despesas"
                  name="Despesas"
                  fill="#EF4444"
                  radius={[6, 6, 0, 0]}
                  barSize={24}
                />
                <Line
                  type="monotone"
                  dataKey="saldo"
                  name="Saldo Acumulado"
                  stroke="#3B82F6"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#3B82F6', strokeWidth: 2, stroke: '#fff' }}
                  activeDot={{ r: 6, fill: '#3B82F6', strokeWidth: 2, stroke: '#fff' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </motion.div>

          {/* Category Breakdown */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6"
          >
            <div className="mb-4">
              <h3 className="text-base font-display font-bold text-slate-900">Despesas por Categoria</h3>
              <p className="text-xs text-slate-500 mt-0.5">Distribuição mensal</p>
            </div>
            <div className="flex justify-center mb-4">
              <ResponsiveContainer width={180} height={180}>
                <PieChart>
                  <Pie
                    data={EXPENSE_CATEGORIES}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="amount"
                  >
                    {EXPENSE_CATEGORIES.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    formatter={(value: number, name: string) => [formatCurrency(value), name]}
                    contentStyle={{
                      borderRadius: '12px',
                      border: '1px solid #E2E8F0',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 max-h-[180px] overflow-y-auto">
              {EXPENSE_CATEGORIES.map((cat) => (
                <div key={cat.name} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: cat.color }}
                    />
                    <span className="text-sm text-slate-700">{cat.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400">{cat.percentage}%</span>
                    <span className="text-sm font-semibold text-slate-900 w-20 text-right">
                      {formatCurrency(cat.amount)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* ========== TRANSACTIONS TABLE ========== */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="bg-white rounded-2xl border border-slate-200 shadow-sm"
        >
          {/* Table Header */}
          <div className="px-6 pt-6 pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
              <h3 className="text-base font-display font-bold text-slate-900">Transações</h3>
              <div className="relative w-full sm:w-72">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar transação..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
                />
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex gap-1 overflow-x-auto">
              {filterTabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setFilterTab(tab.key)}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all',
                    filterTab === tab.key
                      ? 'bg-red-50 text-red-600'
                      : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
                  )}
                >
                  {tab.label}
                  {tab.count !== undefined && (
                    <span
                      className={cn(
                        'text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                        filterTab === tab.key
                          ? 'bg-red-100 text-red-600'
                          : 'bg-slate-100 text-slate-400',
                      )}
                    >
                      {tab.count}
                    </span>
                  )}
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
                    { key: 'dueDate', label: 'Data' },
                    { key: 'description', label: 'Descrição' },
                    { key: 'category', label: 'Categoria' },
                    { key: 'clientName', label: 'Cliente' },
                    { key: 'type', label: 'Tipo' },
                    { key: 'amount', label: 'Valor' },
                    { key: 'status', label: 'Status' },
                    { key: 'actions', label: '' },
                  ].map((col) => (
                    <th
                      key={col.key}
                      onClick={() => col.key !== 'actions' && handleSort(col.key)}
                      className={cn(
                        'px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider',
                        col.key !== 'actions' && 'cursor-pointer hover:text-slate-700',
                      )}
                    >
                      <div className="flex items-center gap-1">
                        {col.label}
                        {sortField === col.key && (
                          <ChevronDown
                            size={12}
                            className={cn(
                              'transition-transform',
                              sortDir === 'asc' && 'rotate-180',
                            )}
                          />
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <AnimatePresence>
                  {filteredTransactions.map((transaction, index) => {
                    const chipColors = getStatusChipColor(transaction.status);
                    return (
                      <motion.tr
                        key={transaction.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ delay: index * 0.02 }}
                        className="hover:bg-slate-50/50 transition-colors group"
                      >
                        <td className="px-6 py-3.5 text-sm text-slate-600 whitespace-nowrap">
                          {formatDate(transaction.dueDate)}
                        </td>
                        <td className="px-6 py-3.5">
                          <p className="text-sm font-medium text-slate-900 truncate max-w-[200px]">
                            {transaction.description}
                          </p>
                        </td>
                        <td className="px-6 py-3.5">
                          <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
                            {transaction.category}
                          </span>
                        </td>
                        <td className="px-6 py-3.5 text-sm text-slate-600">
                          {transaction.clientName || '—'}
                        </td>
                        <td className="px-6 py-3.5">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full',
                              transaction.type === 'receita'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-red-50 text-red-700',
                            )}
                          >
                            {transaction.type === 'receita' ? (
                              <ArrowUpRight size={12} />
                            ) : (
                              <ArrowDownRight size={12} />
                            )}
                            {transaction.type === 'receita' ? 'Receita' : 'Despesa'}
                          </span>
                        </td>
                        <td className="px-6 py-3.5">
                          <span
                            className={cn(
                              'text-sm font-bold',
                              transaction.type === 'receita'
                                ? 'text-emerald-600'
                                : 'text-red-600',
                            )}
                          >
                            {transaction.type === 'receita' ? '+' : '-'}
                            {formatCurrency(transaction.amount)}
                          </span>
                        </td>
                        <td className="px-6 py-3.5">
                          {transaction.status === 'pendente' || transaction.status === 'atrasado' ? (
                            <Tooltip title="Clique para marcar como pago">
                              <button
                                onClick={() => handleMarkAsPaid(transaction.id)}
                                className="inline-flex"
                              >
                                <Chip
                                  label={getStatusLabel(transaction.status)}
                                  size="small"
                                  sx={{
                                    backgroundColor: chipColors.bg,
                                    color: chipColors.text,
                                    border: `1px solid ${chipColors.border}`,
                                    fontWeight: 600,
                                    fontSize: '0.7rem',
                                    cursor: 'pointer',
                                    '&:hover': { opacity: 0.8 },
                                  }}
                                />
                              </button>
                            </Tooltip>
                          ) : (
                            <Chip
                              label={getStatusLabel(transaction.status)}
                              size="small"
                              sx={{
                                backgroundColor: chipColors.bg,
                                color: chipColors.text,
                                border: `1px solid ${chipColors.border}`,
                                fontWeight: 600,
                                fontSize: '0.7rem',
                              }}
                            />
                          )}
                        </td>
                        <td className="px-6 py-3.5">
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Tooltip title="Editar">
                              <IconButton
                                size="small"
                                onClick={() => openEditForm(transaction)}
                                sx={{ color: '#64748B' }}
                              >
                                <Edit3 size={15} />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Excluir">
                              <IconButton
                                size="small"
                                onClick={() => handleDeleteTransaction(transaction.id)}
                                sx={{ color: '#64748B', '&:hover': { color: '#EF4444' } }}
                              >
                                <Trash2 size={15} />
                              </IconButton>
                            </Tooltip>
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

          {filteredTransactions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Receipt size={40} strokeWidth={1.5} />
              <p className="mt-3 text-sm">Nenhuma transação encontrada</p>
            </div>
          )}

          {/* Table Footer */}
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between text-sm text-slate-500">
            <span>{filteredTransactions.length} transações</span>
            <div className="flex items-center gap-2">
              <button className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors disabled:opacity-40" disabled>
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs font-medium px-3 py-1 bg-red-50 text-red-600 rounded-lg">1</span>
              <button className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors disabled:opacity-40" disabled>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </motion.div>
      </div>

      {/* ========== TRANSACTION FORM DIALOG ========== */}
      <Dialog
        open={showForm}
        onClose={() => setShowForm(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: '20px', maxHeight: '90vh' } }}
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
          <span>{editingTransaction ? 'Editar Transação' : 'Nova Transação'}</span>
          <IconButton onClick={() => setShowForm(false)} size="small">
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
              {/* Type Toggle */}
              <div>
                <ToggleButtonGroup
                  value={formType}
                  exclusive
                  onChange={(_, val) => val && setFormType(val)}
                  size="small"
                  fullWidth
                >
                  <ToggleButton
                    value="receita"
                    sx={{
                      gap: 1,
                      borderRadius: '12px 0 0 12px',
                      '&.Mui-selected': {
                        backgroundColor: '#F0FDF4',
                        color: '#166534',
                        borderColor: '#BBF7D0',
                        '&:hover': { backgroundColor: '#DCFCE7' },
                      },
                    }}
                  >
                    <ArrowUpRight size={16} />
                    Receita
                  </ToggleButton>
                  <ToggleButton
                    value="despesa"
                    sx={{
                      gap: 1,
                      borderRadius: '0 12px 12px 0',
                      '&.Mui-selected': {
                        backgroundColor: '#FEF2F2',
                        color: '#991B1B',
                        borderColor: '#FECACA',
                        '&:hover': { backgroundColor: '#FEE2E2' },
                      },
                    }}
                  >
                    <ArrowDownRight size={16} />
                    Despesa
                  </ToggleButton>
                </ToggleButtonGroup>
              </div>

              {/* Description */}
              <TextField
                label="Descrição"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                fullWidth
                required
                size="small"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: '12px',
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#DC2626' },
                  },
                }}
              />

              {/* Category + Amount */}
              <div className="grid grid-cols-2 gap-4">
                <FormControl fullWidth size="small">
                  <InputLabel>Categoria</InputLabel>
                  <Select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    label="Categoria"
                    sx={{
                      borderRadius: '12px',
                      '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#DC2626' },
                    }}
                  >
                    {(formType === 'receita' ? INCOME_CATEGORIES : EXPENSE_CAT_OPTIONS).map(
                      (cat) => (
                        <MenuItem key={cat} value={cat}>
                          {cat}
                        </MenuItem>
                      ),
                    )}
                  </Select>
                </FormControl>
                <TextField
                  label="Valor"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  type="number"
                  fullWidth
                  required
                  size="small"
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <span className="text-sm text-slate-400">R$</span>
                      </InputAdornment>
                    ),
                  }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '12px',
                      '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#DC2626' },
                    },
                  }}
                />
              </div>

              {/* Due Date + Payment Date */}
              <div className="grid grid-cols-2 gap-4">
                <TextField
                  label="Data de Vencimento"
                  type="date"
                  value={formDueDate}
                  onChange={(e) => setFormDueDate(e.target.value)}
                  fullWidth
                  required
                  size="small"
                  InputLabelProps={{ shrink: true }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '12px',
                      '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#DC2626' },
                    },
                  }}
                />
                <TextField
                  label="Data de Pagamento"
                  type="date"
                  value={formPaymentDate}
                  onChange={(e) => setFormPaymentDate(e.target.value)}
                  fullWidth
                  size="small"
                  InputLabelProps={{ shrink: true }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '12px',
                      '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#DC2626' },
                    },
                  }}
                />
              </div>

              {/* Payment Method */}
              <FormControl fullWidth size="small">
                <InputLabel>Forma de Pagamento</InputLabel>
                <Select
                  value={formPaymentMethod}
                  onChange={(e) => setFormPaymentMethod(e.target.value as PaymentMethod | '')}
                  label="Forma de Pagamento"
                  sx={{
                    borderRadius: '12px',
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#DC2626' },
                  }}
                >
                  <MenuItem value="">
                    <em>Não informado</em>
                  </MenuItem>
                  {PAYMENT_METHOD_OPTIONS.map((pm) => (
                    <MenuItem key={pm.value} value={pm.value}>
                      {pm.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {/* Client */}
              <Autocomplete
                options={MOCK_CLIENTS}
                getOptionLabel={(option) => option.nome}
                value={formClient}
                onChange={(_, value) => setFormClient(value)}
                size="small"
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Cliente (opcional)"
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        borderRadius: '12px',
                        '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#DC2626' },
                      },
                    }}
                  />
                )}
                noOptionsText="Nenhum cliente encontrado"
              />

              {/* Recurrence */}
              <FormControl fullWidth size="small">
                <InputLabel>Recorrência</InputLabel>
                <Select
                  value={formRecurrence}
                  onChange={(e) => setFormRecurrence(e.target.value)}
                  label="Recorrência"
                  sx={{
                    borderRadius: '12px',
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#DC2626' },
                  }}
                >
                  {RECURRENCE_OPTIONS.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>
                      <div className="flex items-center gap-2">
                        <Repeat size={14} className="text-slate-400" />
                        {opt.label}
                      </div>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {/* Notes */}
              <TextField
                label="Observações"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                fullWidth
                multiline
                rows={3}
                size="small"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: '12px',
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#DC2626' },
                  },
                }}
              />
            </div>
          </motion.div>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button
            onClick={() => setShowForm(false)}
            sx={{ color: '#64748B', textTransform: 'none', fontWeight: 600, borderRadius: '12px' }}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSaveTransaction}
            variant="contained"
            disabled={!formDescription || !formCategory || !formAmount || !formDueDate}
            sx={{
              backgroundColor: '#DC2626',
              '&:hover': { backgroundColor: '#B91C1C' },
              '&.Mui-disabled': { backgroundColor: '#FCA5A5', color: '#fff' },
              borderRadius: '12px',
              textTransform: 'none',
              fontWeight: 700,
              px: 4,
            }}
          >
            {editingTransaction ? 'Salvar' : 'Criar Transação'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
