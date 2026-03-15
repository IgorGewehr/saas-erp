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
  LinearProgress,
  Avatar,
} from '@mui/material';
import {
  TrendingUp,
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
  Wallet,
  CreditCard,
  Banknote,
  Repeat,
  Building2,
  Users,
  ChevronLeft,
  ChevronRight,
  Landmark,
  PiggyBank,
  BarChart3,
  ArrowRightLeft,
  Percent,
  Briefcase,
  UserCircle,
  CircleDollarSign,
  Target,
  Eye,
  EyeOff,
  MoreVertical,
  Globe,
  Server,
  Zap,
  Layers,
  TrendingUp as TrendUp,
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
  AreaChart,
  Area,
} from 'recharts';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { useTheme } from '@/app/components/providers/ThemeProvider';
import type {
  Transaction,
  TransactionType,
  TransactionStatus,
  PaymentMethod,
  Client,
  BankAccount,
  BusinessUnit,
  Employee,
  Partner,
} from '@/lib/types';

// ==========================================
// MOCK DATA
// ==========================================

const MOCK_BUSINESS_UNITS: BusinessUnit[] = [
  { id: 'bu1', businessId: 'b1', name: 'ServicePro', niche: 'Prestadores de Servico', description: 'ERP para saloes, clinicas e prestadores', color: '#DC2626', isActive: true, createdAt: '', updatedAt: '' },
  { id: 'bu2', businessId: 'b1', name: 'FoodManager', niche: 'Food Service', description: 'Sistema para restaurantes e delivery', color: '#F59E0B', isActive: true, createdAt: '', updatedAt: '' },
  { id: 'bu3', businessId: 'b1', name: 'HealthCare+', niche: 'Saude', description: 'ERP para clinicas medicas e odontologicas', color: '#10B981', isActive: true, createdAt: '', updatedAt: '' },
  { id: 'bu4', businessId: 'b1', name: 'RetailForce', niche: 'Varejo', description: 'Sistema para lojas e e-commerce', color: '#3B82F6', isActive: true, createdAt: '', updatedAt: '' },
  { id: 'bu5', businessId: 'b1', name: 'EduSys', niche: 'Educacao', description: 'Plataforma para escolas e cursos', color: '#8B5CF6', isActive: false, createdAt: '', updatedAt: '' },
];

const MOCK_BANK_ACCOUNTS: BankAccount[] = [
  { id: 'ba1', businessId: 'b1', name: 'Conta Principal', bankName: 'Itau', bankCode: '341', accountType: 'corrente', agency: '1234', accountNumber: '56789-0', balance: 284500.00, color: '#FF6600', isMain: true, isActive: true, createdAt: '', updatedAt: '' },
  { id: 'ba2', businessId: 'b1', name: 'Conta Operacional', bankName: 'Nubank', accountType: 'corrente', balance: 45200.00, color: '#820AD1', isMain: false, isActive: true, createdAt: '', updatedAt: '' },
  { id: 'ba3', businessId: 'b1', name: 'Reserva', bankName: 'Inter', accountType: 'poupanca', balance: 120000.00, color: '#FF7A00', isMain: false, isActive: true, createdAt: '', updatedAt: '' },
  { id: 'ba4', businessId: 'b1', name: 'Investimentos', bankName: 'BTG Pactual', accountType: 'investimento', balance: 350000.00, color: '#1A1A2E', isMain: false, isActive: true, createdAt: '', updatedAt: '' },
  { id: 'ba5', businessId: 'b1', name: 'Caixa Fisico', bankName: 'Caixa', accountType: 'caixa', balance: 2800.00, color: '#0051A5', isMain: false, isActive: true, createdAt: '', updatedAt: '' },
];

const MOCK_EMPLOYEES: Employee[] = [
  { id: 'e1', businessId: 'b1', name: 'Rafael Souza', role: 'CTO', department: 'Tecnologia', salary: 18000, benefits: 2500, startDate: '2023-01-15', isActive: true, createdAt: '', updatedAt: '' },
  { id: 'e2', businessId: 'b1', name: 'Camila Ferreira', role: 'Product Manager', department: 'Produto', salary: 14000, benefits: 2000, startDate: '2023-03-01', isActive: true, createdAt: '', updatedAt: '' },
  { id: 'e3', businessId: 'b1', name: 'Lucas Martins', role: 'Full Stack Developer', department: 'Tecnologia', salary: 12000, benefits: 1800, startDate: '2023-06-10', isActive: true, createdAt: '', updatedAt: '' },
  { id: 'e4', businessId: 'b1', name: 'Juliana Costa', role: 'Designer UI/UX', department: 'Produto', salary: 10000, benefits: 1500, startDate: '2023-09-01', isActive: true, createdAt: '', updatedAt: '' },
  { id: 'e5', businessId: 'b1', name: 'Pedro Almeida', role: 'DevOps Engineer', department: 'Tecnologia', salary: 13000, benefits: 1800, startDate: '2024-01-15', isActive: true, createdAt: '', updatedAt: '' },
  { id: 'e6', businessId: 'b1', name: 'Ana Rodrigues', role: 'Customer Success', department: 'Comercial', salary: 7000, benefits: 1200, startDate: '2024-03-01', isActive: true, createdAt: '', updatedAt: '' },
  { id: 'e7', businessId: 'b1', name: 'Bruno Lima', role: 'Comercial', department: 'Comercial', salary: 5000, benefits: 1000, startDate: '2024-06-01', isActive: true, createdAt: '', updatedAt: '' },
  { id: 'e8', businessId: 'b1', name: 'Mariana Santos', role: 'Financeiro', department: 'Administrativo', salary: 6500, benefits: 1200, startDate: '2024-02-15', isActive: true, createdAt: '', updatedAt: '' },
];

const MOCK_PARTNERS: Partner[] = [
  { id: 'p1', businessId: 'b1', name: 'Igor Gomes', cpf: '12345678901', email: 'igor@holding.com', sharePercentage: 45, role: 'CEO / Fundador', investedAmount: 250000, createdAt: '', updatedAt: '' },
  { id: 'p2', businessId: 'b1', name: 'Ana Silva', cpf: '98765432100', email: 'ana@holding.com', sharePercentage: 30, role: 'COO / Co-fundadora', investedAmount: 150000, createdAt: '', updatedAt: '' },
  { id: 'p3', businessId: 'b1', name: 'Carlos Mendes', cpf: '11122233344', email: 'carlos@holding.com', sharePercentage: 25, role: 'Investidor', investedAmount: 100000, createdAt: '', updatedAt: '' },
];

const MOCK_TRANSACTIONS: Transaction[] = [
  // Receitas por unidade
  { id: 't1', businessId: 'b1', type: 'receita', category: 'Assinaturas', description: 'MRR ServicePro - Marco/26', amount: 47500, dueDate: '2026-03-01', paymentDate: '2026-03-01', status: 'pago', businessUnitId: 'bu1', bankAccountId: 'ba1', paymentMethod: 'boleto', costCenter: 'ServicePro', createdAt: '2026-03-01', updatedAt: '' },
  { id: 't2', businessId: 'b1', type: 'receita', category: 'Assinaturas', description: 'MRR FoodManager - Marco/26', amount: 32000, dueDate: '2026-03-01', paymentDate: '2026-03-01', status: 'pago', businessUnitId: 'bu2', bankAccountId: 'ba1', paymentMethod: 'boleto', costCenter: 'FoodManager', createdAt: '2026-03-01', updatedAt: '' },
  { id: 't3', businessId: 'b1', type: 'receita', category: 'Assinaturas', description: 'MRR HealthCare+ - Marco/26', amount: 28500, dueDate: '2026-03-01', paymentDate: '2026-03-01', status: 'pago', businessUnitId: 'bu3', bankAccountId: 'ba1', paymentMethod: 'boleto', costCenter: 'HealthCare+', createdAt: '2026-03-01', updatedAt: '' },
  { id: 't4', businessId: 'b1', type: 'receita', category: 'Assinaturas', description: 'MRR RetailForce - Marco/26', amount: 21000, dueDate: '2026-03-05', paymentDate: '2026-03-05', status: 'pago', businessUnitId: 'bu4', bankAccountId: 'ba1', paymentMethod: 'pix', costCenter: 'RetailForce', createdAt: '2026-03-05', updatedAt: '' },
  { id: 't5', businessId: 'b1', type: 'receita', category: 'Implantacao', description: 'Setup novo cliente - FoodManager', amount: 4500, dueDate: '2026-03-10', paymentDate: '2026-03-10', status: 'pago', businessUnitId: 'bu2', bankAccountId: 'ba2', paymentMethod: 'pix', costCenter: 'FoodManager', createdAt: '2026-03-10', updatedAt: '' },
  { id: 't6', businessId: 'b1', type: 'receita', category: 'Consultoria', description: 'Consultoria customizacao - HealthCare+', amount: 8000, dueDate: '2026-03-15', status: 'pendente', businessUnitId: 'bu3', costCenter: 'HealthCare+', createdAt: '2026-03-08', updatedAt: '' },
  // Despesas gerais
  { id: 't7', businessId: 'b1', type: 'despesa', category: 'Escritorio', description: 'Aluguel escritorio - Marco/26', amount: 8500, dueDate: '2026-03-10', paymentDate: '2026-03-10', status: 'pago', bankAccountId: 'ba1', paymentMethod: 'boleto', costCenter: 'Administrativo', createdAt: '2026-03-10', updatedAt: '' },
  { id: 't8', businessId: 'b1', type: 'despesa', category: 'Infraestrutura', description: 'AWS Servers - Marco/26', amount: 12400, dueDate: '2026-03-05', paymentDate: '2026-03-05', status: 'pago', bankAccountId: 'ba1', paymentMethod: 'credito', costCenter: 'Infraestrutura', createdAt: '2026-03-05', updatedAt: '' },
  { id: 't9', businessId: 'b1', type: 'despesa', category: 'Infraestrutura', description: 'Google Cloud Platform', amount: 3200, dueDate: '2026-03-05', paymentDate: '2026-03-05', status: 'pago', bankAccountId: 'ba2', paymentMethod: 'credito', costCenter: 'Infraestrutura', createdAt: '2026-03-05', updatedAt: '' },
  { id: 't10', businessId: 'b1', type: 'despesa', category: 'Folha', description: 'Folha de pagamento - Marco/26', amount: 85500, dueDate: '2026-03-05', paymentDate: '2026-03-05', status: 'pago', bankAccountId: 'ba1', paymentMethod: 'pix', costCenter: 'Pessoal', createdAt: '2026-03-05', updatedAt: '' },
  { id: 't11', businessId: 'b1', type: 'despesa', category: 'Beneficios', description: 'VR + VT + Plano Saude', amount: 13000, dueDate: '2026-03-05', paymentDate: '2026-03-05', status: 'pago', bankAccountId: 'ba1', paymentMethod: 'boleto', costCenter: 'Pessoal', createdAt: '2026-03-05', updatedAt: '' },
  { id: 't12', businessId: 'b1', type: 'despesa', category: 'Marketing', description: 'Google Ads + Meta Ads', amount: 15000, dueDate: '2026-03-08', paymentDate: '2026-03-08', status: 'pago', bankAccountId: 'ba2', paymentMethod: 'credito', costCenter: 'Marketing', createdAt: '2026-03-08', updatedAt: '' },
  { id: 't13', businessId: 'b1', type: 'despesa', category: 'Software', description: 'Licencas (Figma, Jira, Slack)', amount: 2800, dueDate: '2026-03-01', paymentDate: '2026-03-01', status: 'pago', bankAccountId: 'ba2', paymentMethod: 'credito', costCenter: 'Administrativo', createdAt: '2026-03-01', updatedAt: '' },
  { id: 't14', businessId: 'b1', type: 'despesa', category: 'Contabilidade', description: 'Escritorio contabil', amount: 3500, dueDate: '2026-03-10', paymentDate: '2026-03-10', status: 'pago', bankAccountId: 'ba1', paymentMethod: 'boleto', costCenter: 'Administrativo', createdAt: '2026-03-10', updatedAt: '' },
  { id: 't15', businessId: 'b1', type: 'despesa', category: 'Impostos', description: 'DAS Simples Nacional', amount: 18200, dueDate: '2026-03-20', status: 'pendente', bankAccountId: 'ba1', costCenter: 'Fiscal', createdAt: '2026-03-01', updatedAt: '' },
  { id: 't16', businessId: 'b1', type: 'despesa', category: 'Pro-labore', description: 'Pro-labore socios - Marco/26', amount: 24000, dueDate: '2026-03-05', paymentDate: '2026-03-05', status: 'pago', bankAccountId: 'ba1', paymentMethod: 'pix', costCenter: 'Pessoal', createdAt: '2026-03-05', updatedAt: '' },
  { id: 't17', businessId: 'b1', type: 'receita', category: 'Assinaturas', description: 'Upgrade planos - ServicePro', amount: 3200, dueDate: '2026-03-12', paymentDate: '2026-03-12', status: 'pago', businessUnitId: 'bu1', bankAccountId: 'ba1', paymentMethod: 'credito', costCenter: 'ServicePro', createdAt: '2026-03-12', updatedAt: '' },
  { id: 't18', businessId: 'b1', type: 'despesa', category: 'Energia', description: 'Energia + Internet escritorio', amount: 1400, dueDate: '2026-03-15', status: 'pendente', costCenter: 'Administrativo', createdAt: '2026-03-01', updatedAt: '' },
  { id: 't19', businessId: 'b1', type: 'receita', category: 'Assinaturas', description: 'Novos clientes - RetailForce', amount: 5600, dueDate: '2026-03-20', status: 'pendente', businessUnitId: 'bu4', costCenter: 'RetailForce', createdAt: '2026-03-14', updatedAt: '' },
  { id: 't20', businessId: 'b1', type: 'despesa', category: 'Juridico', description: 'Assessoria juridica', amount: 4500, dueDate: '2026-02-28', status: 'atrasado', costCenter: 'Administrativo', createdAt: '2026-02-15', updatedAt: '' },
];

const CASH_FLOW_DATA = [
  { month: 'Out', receitas: 118000, despesas: 142000, saldo: -24000 },
  { month: 'Nov', receitas: 128000, despesas: 148000, saldo: -20000 },
  { month: 'Dez', receitas: 142000, despesas: 155000, saldo: -13000 },
  { month: 'Jan', receitas: 138000, despesas: 152000, saldo: -14000 },
  { month: 'Fev', receitas: 145000, despesas: 158000, saldo: -13000 },
  { month: 'Mar', receitas: 150300, despesas: 192000, saldo: -41700 },
];

const REVENUE_BY_UNIT = [
  { name: 'ServicePro', receita: 50700, meta: 55000, color: '#DC2626' },
  { name: 'FoodManager', receita: 36500, meta: 40000, color: '#F59E0B' },
  { name: 'HealthCare+', receita: 36500, meta: 35000, color: '#10B981' },
  { name: 'RetailForce', receita: 26600, meta: 30000, color: '#3B82F6' },
];

const EXPENSE_BREAKDOWN = [
  { name: 'Folha + Beneficios', amount: 122500, color: '#DC2626', percentage: 63.8 },
  { name: 'Infraestrutura', amount: 15600, color: '#3B82F6', percentage: 8.1 },
  { name: 'Marketing', amount: 15000, color: '#F59E0B', percentage: 7.8 },
  { name: 'Impostos', amount: 18200, color: '#EF4444', percentage: 9.5 },
  { name: 'Escritorio', amount: 9900, color: '#10B981', percentage: 5.2 },
  { name: 'Software', amount: 2800, color: '#8B5CF6', percentage: 1.5 },
  { name: 'Outros', amount: 8000, color: '#6B7280', percentage: 4.2 },
];

const INCOME_CATEGORIES = ['Assinaturas', 'Implantacao', 'Consultoria', 'Suporte Premium', 'Outros'];
const EXPENSE_CATEGORIES = ['Escritorio', 'Infraestrutura', 'Folha', 'Beneficios', 'Marketing', 'Software', 'Contabilidade', 'Impostos', 'Pro-labore', 'Energia', 'Juridico', 'Outros'];
const COST_CENTERS = ['ServicePro', 'FoodManager', 'HealthCare+', 'RetailForce', 'Administrativo', 'Infraestrutura', 'Marketing', 'Pessoal', 'Fiscal'];

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'pix', label: 'PIX' },
  { value: 'credito', label: 'Cartao de Credito' },
  { value: 'debito', label: 'Cartao de Debito' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'outros', label: 'Outros' },
];

const RECURRENCE_OPTIONS = [
  { value: 'unica', label: 'Unica' },
  { value: 'mensal', label: 'Mensal' },
  { value: 'trimestral', label: 'Trimestral' },
  { value: 'anual', label: 'Anual' },
];

type FinancialTab = 'visao-geral' | 'lancamentos' | 'contas' | 'unidades' | 'equipe';

const TABS: { key: FinancialTab; label: string; icon: React.ReactNode }[] = [
  { key: 'visao-geral', label: 'Visao Geral', icon: <BarChart3 size={16} /> },
  { key: 'lancamentos', label: 'Lancamentos', icon: <ArrowRightLeft size={16} /> },
  { key: 'contas', label: 'Contas Bancarias', icon: <Landmark size={16} /> },
  { key: 'unidades', label: 'Unidades de Negocio', icon: <Layers size={16} /> },
  { key: 'equipe', label: 'Equipe & Socios', icon: <Users size={16} /> },
];

// ==========================================
// COMPONENT
// ==========================================

export default function FinancialModule() {
  const { isDark } = useTheme();
  const [activeTab, setActiveTab] = useState<FinancialTab>('visao-geral');
  const [transactions, setTransactions] = useState<Transaction[]>(MOCK_TRANSACTIONS);
  const [showForm, setShowForm] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [showBalances, setShowBalances] = useState(true);

  // Form state
  const [formType, setFormType] = useState<TransactionType>('receita');
  const [formDescription, setFormDescription] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formPaymentDate, setFormPaymentDate] = useState('');
  const [formPaymentMethod, setFormPaymentMethod] = useState<PaymentMethod | ''>('');
  const [formNotes, setFormNotes] = useState('');
  const [formCostCenter, setFormCostCenter] = useState('');
  const [formBusinessUnit, setFormBusinessUnit] = useState('');
  const [formBankAccount, setFormBankAccount] = useState('');
  const [formRecurrence, setFormRecurrence] = useState('unica');

  // Transactions tab state
  const [txFilterTab, setTxFilterTab] = useState<'todas' | 'receitas' | 'despesas' | 'pendentes' | 'atrasadas'>('todas');
  const [txSearch, setTxSearch] = useState('');
  const [txSortField, setTxSortField] = useState('dueDate');
  const [txSortDir, setTxSortDir] = useState<'asc' | 'desc'>('desc');

  // ---- Computed ----
  const summaryMetrics = useMemo(() => {
    const receitas = transactions.filter((t) => t.type === 'receita' && t.status === 'pago').reduce((s, t) => s + t.amount, 0);
    const despesas = transactions.filter((t) => t.type === 'despesa' && t.status === 'pago').reduce((s, t) => s + t.amount, 0);
    const aReceber = transactions.filter((t) => t.type === 'receita' && (t.status === 'pendente' || t.status === 'atrasado')).reduce((s, t) => s + t.amount, 0);
    const aPagar = transactions.filter((t) => t.type === 'despesa' && (t.status === 'pendente' || t.status === 'atrasado')).reduce((s, t) => s + t.amount, 0);
    const lucro = receitas - despesas;
    const totalContas = MOCK_BANK_ACCOUNTS.filter((a) => a.isActive).reduce((s, a) => s + a.balance, 0);
    return { receitas, despesas, lucro, aReceber, aPagar, totalContas };
  }, [transactions]);

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
        t.category.toLowerCase().includes(q) ||
        (t.costCenter && t.costCenter.toLowerCase().includes(q))
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

  const totalFolha = useMemo(() => {
    const salarios = MOCK_EMPLOYEES.filter((e) => e.isActive).reduce((s, e) => s + e.salary, 0);
    const beneficios = MOCK_EMPLOYEES.filter((e) => e.isActive).reduce((s, e) => s + (e.benefits || 0), 0);
    return { salarios, beneficios, total: salarios + beneficios };
  }, []);

  // ---- Handlers ----
  const handleTxSort = useCallback((field: string) => {
    setTxSortField((prev) => { if (prev === field) { setTxSortDir((d) => d === 'asc' ? 'desc' : 'asc'); return prev; } setTxSortDir('desc'); return field; });
  }, []);

  const handleMarkAsPaid = useCallback((id: string) => {
    setTransactions((prev) => prev.map((t) => t.id === id ? { ...t, status: 'pago' as TransactionStatus, paymentDate: '2026-03-14' } : t));
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
    setFormNotes('');
    setFormCostCenter('');
    setFormBusinessUnit('');
    setFormBankAccount('');
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
    setFormNotes(transaction.notes || '');
    setFormCostCenter(transaction.costCenter || '');
    setFormBusinessUnit(transaction.businessUnitId || '');
    setFormBankAccount(transaction.bankAccountId || '');
    setFormRecurrence('unica');
    setShowForm(true);
  }, []);

  const handleSave = useCallback(() => {
    const amount = parseFloat(formAmount);
    if (!formDescription || !formCategory || isNaN(amount) || !formDueDate) return;
    const tx: Transaction = {
      id: editingTransaction?.id || `t-${Date.now()}`,
      businessId: 'b1',
      type: formType,
      category: formCategory,
      description: formDescription,
      amount,
      dueDate: formDueDate,
      paymentDate: formPaymentDate || undefined,
      status: formPaymentDate ? 'pago' : 'pendente',
      paymentMethod: (formPaymentMethod as PaymentMethod) || undefined,
      notes: formNotes || undefined,
      costCenter: formCostCenter || undefined,
      businessUnitId: formBusinessUnit || undefined,
      bankAccountId: formBankAccount || undefined,
      createdAt: editingTransaction?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (editingTransaction) {
      setTransactions((prev) => prev.map((t) => t.id === editingTransaction.id ? tx : t));
    } else {
      setTransactions((prev) => [tx, ...prev]);
    }
    setShowForm(false);
  }, [formType, formDescription, formCategory, formAmount, formDueDate, formPaymentDate, formPaymentMethod, formNotes, formCostCenter, formBusinessUnit, formBankAccount, editingTransaction]);

  const handleDelete = useCallback((id: string) => {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  }, []);

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

  const statusLabel = (s: TransactionStatus) => ({ pago: 'Pago', pendente: 'Pendente', atrasado: 'Atrasado', cancelado: 'Cancelado' }[s]);

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

  // ==========================================
  // RENDER
  // ==========================================

  return (
    <div className="min-h-screen">
      <div className="max-w-[1440px] mx-auto">
        {/* ===== HEADER ===== */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-gray-100">Financeiro</h1>
            <p className="text-sm text-slate-500 dark:text-gray-400 mt-0.5">Gestao financeira da holding</p>
          </div>
          <div className="flex items-center gap-3">
            <Tooltip title={showBalances ? 'Ocultar saldos' : 'Mostrar saldos'}>
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
              Novo Lancamento
            </motion.button>
          </div>
        </div>

        {/* ===== TAB NAV ===== */}
        <div className="flex gap-1 p-1 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-2xl mb-6 overflow-x-auto shadow-sm">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all',
                activeTab === tab.key
                  ? 'bg-slate-900 dark:bg-gray-200 text-white dark:text-gray-900 shadow-sm'
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
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'visao-geral' && (
              <OverviewContent
                metrics={summaryMetrics}
                showBalances={showBalances}
                ChartTooltip={ChartTooltip}
                fmtChart={fmtChart}
                isDark={isDark}
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
                onDelete={handleDelete}
                getStatusChipColor={getStatusChipColor}
                statusLabel={statusLabel}
              />
            )}

            {activeTab === 'contas' && (
              <BankAccountsContent
                accounts={MOCK_BANK_ACCOUNTS}
                showBalances={showBalances}
              />
            )}

            {activeTab === 'unidades' && (
              <BusinessUnitsContent
                units={MOCK_BUSINESS_UNITS}
                revenueData={REVENUE_BY_UNIT}
                transactions={transactions}
                showBalances={showBalances}
              />
            )}

            {activeTab === 'equipe' && (
              <TeamContent
                employees={MOCK_EMPLOYEES}
                partners={MOCK_PARTNERS}
                totalFolha={totalFolha}
                lucroMensal={summaryMetrics.lucro}
                showBalances={showBalances}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ===== FORM DIALOG ===== */}
      <Dialog
        open={showForm}
        onClose={() => setShowForm(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: '20px', maxHeight: '90vh' } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1, fontFamily: '"Plus Jakarta Sans", sans-serif', fontWeight: 700 }}>
          <span>{editingTransaction ? 'Editar Lancamento' : 'Novo Lancamento'}</span>
          <IconButton onClick={() => setShowForm(false)} size="small"><X size={20} /></IconButton>
        </DialogTitle>
        <Divider />
        <DialogContent sx={{ pt: 3 }}>
          <div className="space-y-4">
            {/* Type Toggle */}
            <ToggleButtonGroup value={formType} exclusive onChange={(_, v) => v && setFormType(v)} size="small" fullWidth>
              <ToggleButton value="receita" sx={{ gap: 1, borderRadius: '12px 0 0 12px', '&.Mui-selected': { backgroundColor: '#F0FDF4', color: '#166534', borderColor: '#BBF7D0', '&:hover': { backgroundColor: '#DCFCE7' } } }}>
                <ArrowUpRight size={16} /> Receita
              </ToggleButton>
              <ToggleButton value="despesa" sx={{ gap: 1, borderRadius: '0 12px 12px 0', '&.Mui-selected': { backgroundColor: '#FEF2F2', color: '#991B1B', borderColor: '#FECACA', '&:hover': { backgroundColor: '#FEE2E2' } } }}>
                <ArrowDownRight size={16} /> Despesa
              </ToggleButton>
            </ToggleButtonGroup>

            <TextField label="Descricao" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} fullWidth required size="small" sx={inputSx} />

            <div className="grid grid-cols-2 gap-3">
              <FormControl fullWidth size="small">
                <InputLabel>Categoria</InputLabel>
                <Select value={formCategory} onChange={(e) => setFormCategory(e.target.value)} label="Categoria" sx={{ borderRadius: '12px' }}>
                  {(formType === 'receita' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
                    <MenuItem key={c} value={c}>{c}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField label="Valor" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} type="number" fullWidth required size="small"
                InputProps={{ startAdornment: <InputAdornment position="start"><span className="text-sm text-slate-400">R$</span></InputAdornment> }}
                sx={inputSx}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <TextField label="Vencimento" type="date" value={formDueDate} onChange={(e) => setFormDueDate(e.target.value)} fullWidth required size="small" InputLabelProps={{ shrink: true }} sx={inputSx} />
              <TextField label="Pagamento" type="date" value={formPaymentDate} onChange={(e) => setFormPaymentDate(e.target.value)} fullWidth size="small" InputLabelProps={{ shrink: true }} sx={inputSx} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormControl fullWidth size="small">
                <InputLabel>Forma Pagamento</InputLabel>
                <Select value={formPaymentMethod} onChange={(e) => setFormPaymentMethod(e.target.value as PaymentMethod | '')} label="Forma Pagamento" sx={{ borderRadius: '12px' }}>
                  <MenuItem value=""><em>-</em></MenuItem>
                  {PAYMENT_METHODS.map((pm) => (<MenuItem key={pm.value} value={pm.value}>{pm.label}</MenuItem>))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>Centro de Custo</InputLabel>
                <Select value={formCostCenter} onChange={(e) => setFormCostCenter(e.target.value)} label="Centro de Custo" sx={{ borderRadius: '12px' }}>
                  <MenuItem value=""><em>-</em></MenuItem>
                  {COST_CENTERS.map((cc) => (<MenuItem key={cc} value={cc}>{cc}</MenuItem>))}
                </Select>
              </FormControl>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormControl fullWidth size="small">
                <InputLabel>Unidade de Negocio</InputLabel>
                <Select value={formBusinessUnit} onChange={(e) => setFormBusinessUnit(e.target.value)} label="Unidade de Negocio" sx={{ borderRadius: '12px' }}>
                  <MenuItem value=""><em>Geral</em></MenuItem>
                  {MOCK_BUSINESS_UNITS.filter((u) => u.isActive).map((u) => (<MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>Conta Bancaria</InputLabel>
                <Select value={formBankAccount} onChange={(e) => setFormBankAccount(e.target.value)} label="Conta Bancaria" sx={{ borderRadius: '12px' }}>
                  <MenuItem value=""><em>-</em></MenuItem>
                  {MOCK_BANK_ACCOUNTS.filter((a) => a.isActive).map((a) => (<MenuItem key={a.id} value={a.id}>{a.name} - {a.bankName}</MenuItem>))}
                </Select>
              </FormControl>
            </div>

            <FormControl fullWidth size="small">
              <InputLabel>Recorrencia</InputLabel>
              <Select value={formRecurrence} onChange={(e) => setFormRecurrence(e.target.value)} label="Recorrencia" sx={{ borderRadius: '12px' }}>
                {RECURRENCE_OPTIONS.map((o) => (<MenuItem key={o.value} value={o.value}><div className="flex items-center gap-2"><Repeat size={14} className="text-slate-400" />{o.label}</div></MenuItem>))}
              </Select>
            </FormControl>

            <TextField label="Observacoes" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} fullWidth multiline rows={2} size="small" sx={inputSx} />
          </div>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setShowForm(false)} sx={{ color: '#64748B', textTransform: 'none', fontWeight: 600, borderRadius: '12px' }}>Cancelar</Button>
          <Button onClick={handleSave} variant="contained" disabled={!formDescription || !formCategory || !formAmount || !formDueDate}
            sx={{ backgroundColor: '#DC2626', '&:hover': { backgroundColor: '#B91C1C' }, '&.Mui-disabled': { backgroundColor: '#FCA5A5', color: '#fff' }, borderRadius: '12px', textTransform: 'none', fontWeight: 700, px: 4 }}
          >
            {editingTransaction ? 'Salvar' : 'Criar Lancamento'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

const inputSx = { '& .MuiOutlinedInput-root': { borderRadius: '12px' } };

// ==========================================
// TAB: VISAO GERAL
// ==========================================

function OverviewContent({
  metrics,
  showBalances,
  ChartTooltip,
  fmtChart,
  isDark,
}: {
  metrics: { receitas: number; despesas: number; lucro: number; aReceber: number; aPagar: number; totalContas: number };
  showBalances: boolean;
  ChartTooltip: React.FC;
  fmtChart: (v: number) => string;
  isDark: boolean;
}) {
  const hiddenValue = '******';
  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {[
          { label: 'Receita Mensal', value: metrics.receitas, icon: <TrendingUp size={18} />, color: 'emerald', trend: '+8.2%', up: true },
          { label: 'Despesas', value: metrics.despesas, icon: <TrendingDown size={18} />, color: 'red', trend: '+3.1%', up: false },
          { label: 'Resultado', value: metrics.lucro, icon: <DollarSign size={18} />, color: metrics.lucro >= 0 ? 'blue' : 'red', trend: null, up: metrics.lucro >= 0 },
          { label: 'A Receber', value: metrics.aReceber, icon: <Clock size={18} />, color: 'amber', trend: null, up: null },
          { label: 'A Pagar', value: metrics.aPagar, icon: <AlertTriangle size={18} />, color: 'orange', trend: null, up: null },
          { label: 'Saldo em Contas', value: metrics.totalContas, icon: <Landmark size={18} />, color: 'violet', trend: null, up: null },
        ].map((card, i) => {
          const cm: Record<string, { iconBg: string; iconTxt: string; valTxt: string }> = {
            emerald: { iconBg: 'bg-emerald-50 dark:bg-emerald-500/10', iconTxt: 'text-emerald-600 dark:text-emerald-400', valTxt: 'text-emerald-600 dark:text-emerald-400' },
            red: { iconBg: 'bg-red-50 dark:bg-red-500/10', iconTxt: 'text-red-600 dark:text-red-400', valTxt: 'text-red-600 dark:text-red-400' },
            blue: { iconBg: 'bg-blue-50 dark:bg-blue-500/10', iconTxt: 'text-blue-600 dark:text-blue-400', valTxt: 'text-blue-600 dark:text-blue-400' },
            amber: { iconBg: 'bg-amber-50 dark:bg-amber-500/10', iconTxt: 'text-amber-600 dark:text-amber-400', valTxt: 'text-amber-600 dark:text-amber-400' },
            orange: { iconBg: 'bg-orange-50 dark:bg-orange-500/10', iconTxt: 'text-orange-600 dark:text-orange-400', valTxt: 'text-orange-600 dark:text-orange-400' },
            violet: { iconBg: 'bg-violet-50 dark:bg-violet-500/10', iconTxt: 'text-violet-600 dark:text-violet-400', valTxt: 'text-violet-600 dark:text-violet-400' },
          };
          const c = cm[card.color] || cm.blue;
          return (
            <motion.div key={card.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
              className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-4 hover:shadow-md hover:border-slate-200 dark:hover:border-gray-700 transition-all"
            >
              <div className="flex items-center justify-between mb-3">
                <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', c.iconBg, c.iconTxt)}>{card.icon}</div>
                {card.trend && (
                  <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full', card.up ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400')}>
                    {card.up ? <ArrowUpRight size={10} className="inline" /> : <ArrowDownRight size={10} className="inline" />} {card.trend}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 dark:text-gray-500 font-medium mb-0.5">{card.label}</p>
              <p className={cn('text-lg font-display font-bold', c.valTxt)}>
                {showBalances ? formatCurrency(card.value) : hiddenValue}
              </p>
            </motion.div>
          );
        })}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Cash Flow */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="lg:col-span-2 bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-6 hover:shadow-md transition-all"
        >
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-base font-display font-bold text-slate-900 dark:text-gray-100">Fluxo de Caixa</h3>
              <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">Receitas vs Despesas - Ultimos 6 meses</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={CASH_FLOW_DATA}>
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
              <Bar dataKey="receitas" name="Receitas" fill="url(#gradReceita)" radius={[6, 6, 0, 0]} barSize={22} />
              <Bar dataKey="despesas" name="Despesas" fill="url(#gradDespesa)" radius={[6, 6, 0, 0]} barSize={22} />
              <Line type="monotone" dataKey="saldo" name="Resultado" stroke="#3B82F6" strokeWidth={2.5} dot={{ r: 4, fill: '#3B82F6', strokeWidth: 2, stroke: '#fff' }} />
            </ComposedChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Expense Breakdown */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-6 hover:shadow-md transition-all"
        >
          <h3 className="text-base font-display font-bold text-slate-900 dark:text-gray-100 mb-1">Despesas por Categoria</h3>
          <p className="text-xs text-slate-400 dark:text-gray-500 mb-4">Distribuicao mensal</p>
          <div className="flex justify-center mb-4">
            <ResponsiveContainer width={160} height={160}>
              <PieChart>
                <Pie data={EXPENSE_BREAKDOWN} cx="50%" cy="50%" innerRadius={45} outerRadius={72} paddingAngle={2} dataKey="amount">
                  {EXPENSE_BREAKDOWN.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <RechartsTooltip formatter={(v: number, n: string) => [formatCurrency(v), n]} contentStyle={{ borderRadius: '12px', border: isDark ? '1px solid #374151' : '1px solid #E2E8F0', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', backgroundColor: isDark ? '#111827' : '#fff', color: isDark ? '#F1F5F9' : undefined }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
            {EXPENSE_BREAKDOWN.map((c) => (
              <div key={c.name} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                  <span className="text-xs text-slate-600 dark:text-gray-400">{c.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 dark:text-gray-500">{c.percentage}%</span>
                  <span className="text-xs font-semibold text-slate-800 dark:text-gray-200 w-16 text-right">{showBalances ? formatCurrency(c.amount) : '***'}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Revenue by Unit */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
        className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-6 hover:shadow-md transition-all"
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-base font-display font-bold text-slate-900 dark:text-gray-100">Receita por Unidade de Negocio</h3>
            <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">Performance mensal vs meta</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {REVENUE_BY_UNIT.map((unit) => {
            const progress = Math.min((unit.receita / unit.meta) * 100, 100);
            const exceeded = unit.receita >= unit.meta;
            return (
              <div key={unit.name} className="p-4 rounded-xl border border-slate-100 dark:border-gray-800 hover:border-slate-200 dark:hover:border-gray-700 hover:shadow-sm transition-all">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: unit.color }} />
                  <span className="text-sm font-semibold text-slate-800 dark:text-gray-200">{unit.name}</span>
                </div>
                <p className="text-xl font-display font-bold text-slate-900 dark:text-gray-100 mb-1">
                  {showBalances ? formatCurrency(unit.receita) : '******'}
                </p>
                <div className="flex items-center justify-between text-[11px] mb-2">
                  <span className="text-slate-400 dark:text-gray-500">Meta: {showBalances ? formatCurrency(unit.meta) : '***'}</span>
                  <span className={cn('font-semibold', exceeded ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                    {progress.toFixed(0)}%
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.8, delay: 0.3 }}
                    className="h-full rounded-full"
                    style={{ backgroundColor: exceeded ? '#10B981' : unit.color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}

// ==========================================
// TAB: LANCAMENTOS
// ==========================================

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
  const filterTabs = [
    { key: 'todas', label: 'Todas', count: allTransactions.length },
    { key: 'receitas', label: 'Receitas', count: allTransactions.filter((t) => t.type === 'receita').length },
    { key: 'despesas', label: 'Despesas', count: allTransactions.filter((t) => t.type === 'despesa').length },
    { key: 'pendentes', label: 'Pendentes', count: allTransactions.filter((t) => t.status === 'pendente').length },
    { key: 'atrasadas', label: 'Atrasadas', count: allTransactions.filter((t) => t.status === 'atrasado').length },
  ];

  return (
    <div className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl">
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <h3 className="text-base font-display font-bold text-slate-900 dark:text-gray-100">Lancamentos</h3>
          <div className="relative w-full sm:w-72">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
            <input type="text" placeholder="Buscar lancamento..." value={search} onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-xl text-sm text-slate-900 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
            />
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {filterTabs.map((tab) => (
            <button key={tab.key} onClick={() => onFilterChange(tab.key as 'todas' | 'receitas' | 'despesas' | 'pendentes' | 'atrasadas')}
              className={cn('flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all',
                filterTab === tab.key ? 'bg-slate-900 dark:bg-gray-200 text-white dark:text-gray-900' : 'text-slate-500 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-white/[0.04] hover:text-slate-700 dark:hover:text-gray-300'
              )}
            >
              {tab.label}
              <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', filterTab === tab.key ? 'bg-white/20 text-white dark:bg-black/20 dark:text-gray-900' : 'bg-slate-100 dark:bg-gray-800 text-slate-400 dark:text-gray-500')}>{tab.count}</span>
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
                { key: 'description', label: 'Descricao' },
                { key: 'category', label: 'Categoria' },
                { key: 'costCenter', label: 'Centro Custo' },
                { key: 'type', label: 'Tipo' },
                { key: 'amount', label: 'Valor' },
                { key: 'status', label: 'Status' },
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
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-[11px] font-medium text-slate-500 dark:text-gray-400 bg-slate-100 dark:bg-gray-800 px-2.5 py-1 rounded-full">{tx.category}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs text-slate-500 dark:text-gray-400">{tx.costCenter || '—'}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full',
                        tx.type === 'receita' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400'
                      )}>
                        {tx.type === 'receita' ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                        {tx.type === 'receita' ? 'Receita' : 'Despesa'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={cn('text-sm font-bold', tx.type === 'receita' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                        {tx.type === 'receita' ? '+' : '-'}{formatCurrency(tx.amount)}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {(tx.status === 'pendente' || tx.status === 'atrasado') ? (
                        <Tooltip title="Marcar como pago">
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
                        <Tooltip title="Editar"><IconButton size="small" onClick={() => onEdit(tx)} sx={{ color: '#64748B' }}><Edit3 size={14} /></IconButton></Tooltip>
                        <Tooltip title="Excluir"><IconButton size="small" onClick={() => onDelete(tx.id)} sx={{ color: '#64748B', '&:hover': { color: '#EF4444' } }}><Trash2 size={14} /></IconButton></Tooltip>
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
          <p className="mt-3 text-sm">Nenhum lancamento encontrado</p>
        </div>
      )}

      <div className="px-6 py-3 border-t border-slate-100 dark:border-gray-800 text-sm text-slate-400 dark:text-gray-500">
        {transactions.length} lancamento{transactions.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

// ==========================================
// TAB: CONTAS BANCARIAS
// ==========================================

function BankAccountsContent({ accounts, showBalances }: { accounts: BankAccount[]; showBalances: boolean }) {
  const totalBalance = accounts.filter((a) => a.isActive).reduce((s, a) => s + a.balance, 0);
  const typeLabels: Record<string, string> = { corrente: 'Conta Corrente', poupanca: 'Poupanca', investimento: 'Investimento', caixa: 'Caixa' };

  return (
    <div className="space-y-6">
      {/* Total */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-6 text-white"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-300 mb-1">Saldo Total Consolidado</p>
            <p className="text-3xl font-display font-bold">
              {showBalances ? formatCurrency(totalBalance) : 'R$ ******'}
            </p>
            <p className="text-xs text-slate-400 mt-2">{accounts.filter((a) => a.isActive).length} contas ativas</p>
          </div>
          <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center">
            <Landmark size={28} className="text-white/80" />
          </div>
        </div>
      </motion.div>

      {/* Account Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {accounts.filter((a) => a.isActive).map((account, i) => (
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
              {account.isMain && (
                <Chip label="Principal" size="small" sx={{ backgroundColor: '#EFF6FF', color: '#2563EB', fontWeight: 600, fontSize: '0.65rem', height: 22 }} />
              )}
            </div>

            <div className="mb-3">
              <p className="text-[11px] text-slate-400 dark:text-gray-500 mb-0.5">{typeLabels[account.accountType] || account.accountType}</p>
              <p className="text-xl font-display font-bold text-slate-900 dark:text-gray-100">
                {showBalances ? formatCurrency(account.balance) : 'R$ ******'}
              </p>
            </div>

            {account.agency && (
              <div className="flex items-center gap-4 text-[11px] text-slate-400 dark:text-gray-500 pt-3 border-t border-slate-100 dark:border-gray-800">
                <span>Ag: {account.agency}</span>
                <span>CC: {account.accountNumber}</span>
              </div>
            )}

            {/* Balance bar relative to total */}
            <div className="mt-3">
              <div className="w-full h-1.5 bg-slate-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${(account.balance / totalBalance) * 100}%`, backgroundColor: account.color }} />
              </div>
              <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-1">{((account.balance / totalBalance) * 100).toFixed(1)}% do total</p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ==========================================
// TAB: UNIDADES DE NEGOCIO
// ==========================================

function BusinessUnitsContent({
  units,
  revenueData,
  transactions,
  showBalances,
}: {
  units: BusinessUnit[];
  revenueData: { name: string; receita: number; meta: number; color: string }[];
  transactions: Transaction[];
  showBalances: boolean;
}) {
  const unitMetrics = useMemo(() => {
    return units.filter((u) => u.isActive).map((unit) => {
      const unitTx = transactions.filter((t) => t.businessUnitId === unit.id);
      const receita = unitTx.filter((t) => t.type === 'receita' && t.status === 'pago').reduce((s, t) => s + t.amount, 0);
      const pendente = unitTx.filter((t) => t.type === 'receita' && t.status === 'pendente').reduce((s, t) => s + t.amount, 0);
      const rd = revenueData.find((r) => r.name === unit.name);
      return { ...unit, receita, pendente, meta: rd?.meta || 0, progress: rd ? (rd.receita / rd.meta) * 100 : 0 };
    });
  }, [units, transactions, revenueData]);

  const totalReceita = unitMetrics.reduce((s, u) => s + u.receita, 0);

  return (
    <div className="space-y-6">
      {/* Summary Bar */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-display font-bold text-slate-900 dark:text-gray-100">Performance das Unidades</h3>
            <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">Receita total: {showBalances ? formatCurrency(totalReceita) : '******'}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 dark:text-gray-500">{unitMetrics.length} unidades ativas</span>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={revenueData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
            <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} tickFormatter={(v: number) => `R$ ${(v / 1000).toFixed(0)}k`} />
            <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#334155', fontSize: 12, fontWeight: 600 }} width={100} />
            <RechartsTooltip formatter={(v: number) => [formatCurrency(v)]} contentStyle={{ borderRadius: '12px', border: '1px solid #E2E8F0' }} />
            <Bar dataKey="receita" name="Receita" radius={[0, 6, 6, 0]} barSize={20}>
              {revenueData.map((e, i) => <Cell key={i} fill={e.color} />)}
            </Bar>
            <Bar dataKey="meta" name="Meta" fill="#E2E8F0" radius={[0, 6, 6, 0]} barSize={20} />
          </BarChart>
        </ResponsiveContainer>
      </motion.div>

      {/* Unit Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {unitMetrics.map((unit, i) => {
          const exceeded = unit.receita >= unit.meta;
          return (
            <motion.div key={unit.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
              className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-5 hover:shadow-md hover:border-slate-200 dark:hover:border-gray-700 transition-all"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${unit.color}15` }}>
                  <Globe size={18} style={{ color: unit.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800 dark:text-gray-200">{unit.name}</p>
                  <p className="text-xs text-slate-400 dark:text-gray-500 truncate">{unit.niche}</p>
                </div>
                <Chip label={exceeded ? 'Meta atingida' : 'Em progresso'} size="small"
                  sx={{ backgroundColor: exceeded ? '#F0FDF4' : '#FEFCE8', color: exceeded ? '#166534' : '#854D0E', fontWeight: 600, fontSize: '0.6rem', height: 22 }}
                />
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4">
                <div>
                  <p className="text-[10px] text-slate-400 dark:text-gray-500">Receita</p>
                  <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{showBalances ? formatCurrency(unit.receita) : '***'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 dark:text-gray-500">Pendente</p>
                  <p className="text-sm font-bold text-amber-600 dark:text-amber-400">{showBalances ? formatCurrency(unit.pendente) : '***'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 dark:text-gray-500">Meta</p>
                  <p className="text-sm font-bold text-slate-600 dark:text-gray-400">{showBalances ? formatCurrency(unit.meta) : '***'}</p>
                </div>
              </div>

              <div className="w-full h-2 bg-slate-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(unit.progress, 100)}%` }} transition={{ duration: 0.8, delay: 0.3 }}
                  className="h-full rounded-full" style={{ backgroundColor: exceeded ? '#10B981' : unit.color }}
                />
              </div>
              <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-1 text-right">{unit.progress.toFixed(0)}% da meta</p>

              {unit.description && (
                <p className="text-xs text-slate-400 dark:text-gray-500 mt-3 pt-3 border-t border-slate-100 dark:border-gray-800">{unit.description}</p>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ==========================================
// TAB: EQUIPE & SOCIOS
// ==========================================

function TeamContent({
  employees,
  partners,
  totalFolha,
  lucroMensal,
  showBalances,
}: {
  employees: Employee[];
  partners: Partner[];
  totalFolha: { salarios: number; beneficios: number; total: number };
  lucroMensal: number;
  showBalances: boolean;
}) {
  const activeEmployees = employees.filter((e) => e.isActive);
  const departments = [...new Set(activeEmployees.map((e) => e.department).filter(Boolean))];

  return (
    <div className="space-y-6">
      {/* Payroll Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-5"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
              <Users size={18} className="text-blue-600 dark:text-blue-400" />
            </div>
            <p className="text-xs text-slate-400 dark:text-gray-500 font-medium">Total Folha Mensal</p>
          </div>
          <p className="text-xl font-display font-bold text-slate-900 dark:text-gray-100">{showBalances ? formatCurrency(totalFolha.total) : '******'}</p>
          <div className="flex gap-4 mt-2 text-[11px] text-slate-400 dark:text-gray-500">
            <span>Salarios: {showBalances ? formatCurrency(totalFolha.salarios) : '***'}</span>
            <span>Beneficios: {showBalances ? formatCurrency(totalFolha.beneficios) : '***'}</span>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
          className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-5"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
              <Briefcase size={18} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-xs text-slate-400 dark:text-gray-500 font-medium">Colaboradores Ativos</p>
          </div>
          <p className="text-xl font-display font-bold text-slate-900 dark:text-gray-100">{activeEmployees.length}</p>
          <div className="flex gap-3 mt-2 text-[11px] text-slate-400 dark:text-gray-500">
            {departments.map((d) => (
              <span key={d}>{d}: {activeEmployees.filter((e) => e.department === d).length}</span>
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}
          className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl p-5"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center">
              <Percent size={18} className="text-violet-600 dark:text-violet-400" />
            </div>
            <p className="text-xs text-slate-400 dark:text-gray-500 font-medium">Socios</p>
          </div>
          <p className="text-xl font-display font-bold text-slate-900 dark:text-gray-100">{partners.length}</p>
          <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-2">
            Lucro distribuivel: {showBalances ? formatCurrency(Math.max(0, lucroMensal)) : '***'}
          </p>
        </motion.div>
      </div>

      {/* Employees Table */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-slate-100 dark:border-gray-800">
          <h3 className="text-base font-display font-bold text-slate-900 dark:text-gray-100">Colaboradores</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left border-b border-slate-100 dark:border-gray-800">
                <th className="px-6 py-3 text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wider">Colaborador</th>
                <th className="px-6 py-3 text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wider">Cargo</th>
                <th className="px-6 py-3 text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wider">Departamento</th>
                <th className="px-6 py-3 text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wider">Salario</th>
                <th className="px-6 py-3 text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wider">Beneficios</th>
                <th className="px-6 py-3 text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wider">Custo Total</th>
                <th className="px-6 py-3 text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wider">Desde</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-gray-800">
              {activeEmployees.map((emp, i) => (
                <motion.tr key={emp.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                  className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-gray-700 dark:to-gray-600 flex items-center justify-center text-xs font-bold text-slate-600 dark:text-gray-300">
                        {emp.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                      </div>
                      <span className="text-sm font-medium text-slate-800 dark:text-gray-200">{emp.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-3.5 text-sm text-slate-600 dark:text-gray-400">{emp.role}</td>
                  <td className="px-6 py-3.5">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-gray-400 bg-slate-100 dark:bg-gray-800 px-2.5 py-1 rounded-full">{emp.department}</span>
                  </td>
                  <td className="px-6 py-3.5 text-sm font-semibold text-slate-800 dark:text-gray-200">{showBalances ? formatCurrency(emp.salary) : '***'}</td>
                  <td className="px-6 py-3.5 text-sm text-slate-600 dark:text-gray-400">{showBalances ? formatCurrency(emp.benefits || 0) : '***'}</td>
                  <td className="px-6 py-3.5 text-sm font-bold text-slate-900 dark:text-gray-100">{showBalances ? formatCurrency(emp.salary + (emp.benefits || 0)) : '***'}</td>
                  <td className="px-6 py-3.5 text-xs text-slate-400 dark:text-gray-500">{formatDate(emp.startDate)}</td>
                </motion.tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 dark:border-gray-700 bg-slate-50/50 dark:bg-white/[0.02]">
                <td colSpan={3} className="px-6 py-3 text-sm font-bold text-slate-700 dark:text-gray-300">Total</td>
                <td className="px-6 py-3 text-sm font-bold text-slate-900 dark:text-gray-100">{showBalances ? formatCurrency(totalFolha.salarios) : '***'}</td>
                <td className="px-6 py-3 text-sm font-bold text-slate-900 dark:text-gray-100">{showBalances ? formatCurrency(totalFolha.beneficios) : '***'}</td>
                <td className="px-6 py-3 text-sm font-bold text-red-600 dark:text-red-400">{showBalances ? formatCurrency(totalFolha.total) : '***'}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </motion.div>

      {/* Partners / Profit Sharing */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-2xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-slate-100 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-display font-bold text-slate-900 dark:text-gray-100">Socios & Divisao de Lucros</h3>
            <div className="text-right">
              <p className="text-[11px] text-slate-400 dark:text-gray-500">Lucro mensal</p>
              <p className={cn('text-sm font-bold', lucroMensal >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                {showBalances ? formatCurrency(lucroMensal) : '***'}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 dark:divide-gray-800">
          {partners.map((partner, i) => {
            const lucroShare = Math.max(0, lucroMensal) * (partner.sharePercentage / 100);
            return (
              <motion.div key={partner.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 + i * 0.08 }}
                className="p-5"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center text-sm font-bold text-white">
                    {partner.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800 dark:text-gray-200">{partner.name}</p>
                    <p className="text-xs text-slate-400 dark:text-gray-500">{partner.role}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[11px] text-slate-400 dark:text-gray-500">Participacao</p>
                      <p className="text-sm font-bold text-slate-800 dark:text-gray-200">{partner.sharePercentage}%</p>
                    </div>
                    <div className="w-full h-2 bg-slate-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${partner.sharePercentage}%` }} transition={{ duration: 0.6, delay: 0.5 }}
                        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-600"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-gray-800">
                    <p className="text-[11px] text-slate-400 dark:text-gray-500">Distribuicao mensal</p>
                    <p className={cn('text-sm font-bold', lucroShare > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-gray-500')}>
                      {showBalances ? formatCurrency(lucroShare) : '***'}
                    </p>
                  </div>

                  {partner.investedAmount && (
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-slate-400 dark:text-gray-500">Capital investido</p>
                      <p className="text-xs font-semibold text-slate-600 dark:text-gray-400">{showBalances ? formatCurrency(partner.investedAmount) : '***'}</p>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
