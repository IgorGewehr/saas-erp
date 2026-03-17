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
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Tooltip,
  Avatar,
  Slider,
} from '@mui/material';
import {
  Target,
  Plus,
  Search,
  X,
  Phone,
  Mail,
  MessageSquare,
  Calendar,
  Clock,
  Edit3,
  Trash2,
  Users,
  DollarSign,
  TrendingUp,
  MoreVertical,
  Filter,
  Globe,
  Instagram,
  Facebook,
  Linkedin,
  Send,
  CheckCircle2,
  XCircle,
  PhoneCall,
  Video,
  FileText,
  MessageCircle,
  BarChart3,
  Activity,
  Layers,
  Gauge,
  GripVertical,
  UserPlus,
  Briefcase,
  Tag,
  Hash,
  Building2,
  AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { toast } from 'react-toastify';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate, formatDateTime, formatPhone, getInitials } from '@/lib/utils/format';
import { useTheme } from '@/app/components/providers/ThemeProvider';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { db } from '@/lib/config/firebase';
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
  onSnapshot,
  Timestamp,
} from 'firebase/firestore';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CRMContact,
  CRMDeal,
  CRMPipelineStage,
  CRMActivity,
  CRMActivityType,
  LeadStatus,
  LeadSource,
  User,
  Broadcast,
  BroadcastStatus,
  Segment,
} from '@/lib/types';
import { LIFECYCLE_STAGE_LABELS, LIFECYCLE_STAGE_COLORS } from '@/lib/types';

// ==========================================
// CONSTANTS
// ==========================================

const PIPELINE_STAGES: CRMPipelineStage[] = [
  { id: 'prospeccao', name: 'Prospecção', color: '#6B7280', order: 0, probability: 10 },
  { id: 'qualificacao', name: 'Qualificação', color: '#3B82F6', order: 1, probability: 25 },
  { id: 'proposta', name: 'Proposta', color: '#F59E0B', order: 2, probability: 50 },
  { id: 'negociacao', name: 'Negociação', color: '#8B5CF6', order: 3, probability: 75 },
  { id: 'fechamento', name: 'Fechamento', color: '#10B981', order: 4, probability: 90 },
];

const SOURCE_LABELS: Record<LeadSource, string> = {
  site: 'Site', indicacao: 'Indicação', whatsapp: 'WhatsApp', instagram: 'Instagram',
  facebook: 'Facebook', google_ads: 'Google Ads', linkedin: 'LinkedIn', evento: 'Evento',
  email: 'E-mail', telefone: 'Telefone', outro: 'Outro',
};

const SOURCE_COLORS: Record<LeadSource, string> = {
  site: '#3B82F6', indicacao: '#10B981', whatsapp: '#25D366', instagram: '#E4405F',
  facebook: '#1877F2', google_ads: '#FBBC04', linkedin: '#0A66C2', evento: '#8B5CF6',
  email: '#EF4444', telefone: '#F59E0B', outro: '#6B7280',
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  novo: 'Novo', contatado: 'Contatado', qualificado: 'Qualificado',
  proposta: 'Proposta', negociacao: 'Negociação', ganho: 'Ganho', perdido: 'Perdido',
};

const STATUS_COLORS: Record<LeadStatus, { bg: string; text: string }> = {
  novo: { bg: '#EFF6FF', text: '#2563EB' },
  contatado: { bg: '#F0FDF4', text: '#16A34A' },
  qualificado: { bg: '#FDF4FF', text: '#9333EA' },
  proposta: { bg: '#FEFCE8', text: '#CA8A04' },
  negociacao: { bg: '#FFF7ED', text: '#EA580C' },
  ganho: { bg: '#F0FDF4', text: '#166534' },
  perdido: { bg: '#FEF2F2', text: '#991B1B' },
};

const ACTIVITY_ICONS: Record<CRMActivityType, React.ReactNode> = {
  ligacao: <PhoneCall size={14} />, email: <Mail size={14} />, reuniao: <Video size={14} />,
  whatsapp: <MessageCircle size={14} />, tarefa: <CheckCircle2 size={14} />,
  nota: <FileText size={14} />, proposta: <Send size={14} />,
};

const ACTIVITY_LABELS: Record<CRMActivityType, string> = {
  ligacao: 'Ligação', email: 'E-mail', reuniao: 'Reunião',
  whatsapp: 'WhatsApp', tarefa: 'Tarefa', nota: 'Nota', proposta: 'Proposta',
};

const ACTIVITY_COLORS: Record<CRMActivityType, string> = {
  ligacao: '#F59E0B', email: '#3B82F6', reuniao: '#8B5CF6',
  whatsapp: '#25D366', tarefa: '#10B981', nota: '#6B7280', proposta: '#DC2626',
};

type CRMTab = 'pipeline' | 'contatos' | 'atividades' | 'campanhas' | 'metricas';

const TABS: { key: CRMTab; label: string; icon: React.ReactNode }[] = [
  { key: 'pipeline', label: 'Pipeline', icon: <Layers size={16} /> },
  { key: 'contatos', label: 'Contatos', icon: <Users size={16} /> },
  { key: 'atividades', label: 'Atividades', icon: <Activity size={16} /> },
  { key: 'campanhas', label: 'Campanhas', icon: <Send size={16} /> },
  { key: 'metricas', label: 'Dashboard', icon: <BarChart3 size={16} /> },
];

const ALL_SOURCES: LeadSource[] = ['site', 'indicacao', 'whatsapp', 'instagram', 'facebook', 'google_ads', 'linkedin', 'evento', 'email', 'telefone', 'outro'];
const ALL_STATUSES: LeadStatus[] = ['novo', 'contatado', 'qualificado', 'proposta', 'negociacao', 'ganho', 'perdido'];
const ALL_ACTIVITY_TYPES: CRMActivityType[] = ['ligacao', 'email', 'reuniao', 'whatsapp', 'tarefa', 'nota', 'proposta'];

// ==========================================
// LOADING SKELETON
// ==========================================

function CRMSkeleton() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl shimmer" />
        <div>
          <div className="h-7 w-24 rounded-lg shimmer mb-1" />
          <div className="h-4 w-48 rounded-lg shimmer" />
        </div>
      </div>
      <div className="h-12 rounded-2xl shimmer" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }} className="h-[100px] rounded-2xl shimmer" />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 + i * 0.07 }} className="h-[250px] rounded-2xl shimmer" />
        ))}
      </div>
    </motion.div>
  );
}

// ==========================================
// PHONE MASK HELPER
// ==========================================

function applyPhoneMask(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function stripPhoneMask(value: string): string {
  return value.replace(/\D/g, '');
}

// ==========================================
// CURRENCY INPUT HELPER
// ==========================================

function parseCurrencyInput(value: string): number {
  const cleaned = value.replace(/[^\d,]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function formatCurrencyInput(value: number): string {
  if (value === 0) return '';
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function CRMModule() {
  const { isDark } = useTheme();
  const { user, business } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<CRMTab>('pipeline');

  // ---- Team members (real-time) ----
  const [members, setMembers] = useState<User[]>([]);
  useEffect(() => {
    if (!business?.id) return;
    const q = query(collection(db, 'users'), where('businessId', '==', business.id));
    const unsub = onSnapshot(q, (snap) => {
      setMembers(snap.docs.map((d) => ({ ...d.data(), id: d.id } as User)));
    });
    return () => unsub();
  }, [business?.id]);

  // ---- Fetch CRM Contacts ----
  const { data: contacts = [], isLoading: loadingContacts } = useQuery({
    queryKey: ['crmContacts', business?.id],
    queryFn: async () => {
      const q = query(
        collection(db, 'crmContacts'),
        where('businessId', '==', business!.id),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as CRMContact));
    },
    enabled: !!business?.id,
  });

  // ---- Fetch CRM Deals ----
  const { data: deals = [], isLoading: loadingDeals } = useQuery({
    queryKey: ['crmDeals', business?.id],
    queryFn: async () => {
      const q = query(
        collection(db, 'crmDeals'),
        where('businessId', '==', business!.id),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as CRMDeal));
    },
    enabled: !!business?.id,
  });

  // ---- Fetch CRM Activities ----
  const { data: activities = [], isLoading: loadingActivities } = useQuery({
    queryKey: ['crmActivities', business?.id],
    queryFn: async () => {
      const q = query(
        collection(db, 'crmActivities'),
        where('businessId', '==', business!.id),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as CRMActivity));
    },
    enabled: !!business?.id,
  });

  const isLoading = loadingContacts || loadingDeals || loadingActivities;

  // ---- Dialog states ----
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<CRMContact | null>(null);
  const [deleteContactConfirm, setDeleteContactConfirm] = useState<CRMContact | null>(null);

  const [dealDialogOpen, setDealDialogOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<CRMDeal | null>(null);
  const [deleteDealConfirm, setDeleteDealConfirm] = useState<CRMDeal | null>(null);

  const [activityDialogOpen, setActivityDialogOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<CRMActivity | null>(null);
  const [deleteActivityConfirm, setDeleteActivityConfirm] = useState<CRMActivity | null>(null);

  // ---- Pipeline KPIs ----
  const pipelineMetrics = useMemo(() => {
    const totalValue = deals.reduce((s, d) => s + d.value, 0);
    const weightedValue = deals.reduce((s, d) => s + d.value * (d.probability / 100), 0);
    const wonDeals = deals.filter((d) => d.stage === 'fechamento' || d.closedDate);
    const wonValue = wonDeals.reduce((s, d) => s + d.value, 0);
    const conversionRate = deals.length > 0 ? (wonDeals.length / deals.length) * 100 : 0;
    const avgDealSize = wonDeals.length > 0 ? wonValue / wonDeals.length : 0;
    const activeDeals = deals.length;
    return { totalValue, weightedValue, avgDealSize, activeDeals, conversionRate, wonValue, wonDeals: wonDeals.length };
  }, [deals]);

  // ---- CRUD Handlers: Contacts ----
  const handleSaveContact = useCallback(async (data: Partial<CRMContact>) => {
    if (!business?.id || !user) return;
    try {
      const now = new Date().toISOString();
      if (editingContact) {
        await updateDoc(doc(db, 'crmContacts', editingContact.id), { ...data, updatedAt: now });
        toast.success('Contato atualizado com sucesso!');
      } else {
        await addDoc(collection(db, 'crmContacts'), {
          ...data,
          businessId: business.id,
          score: data.score ?? 0,
          status: data.status ?? 'novo',
          source: data.source ?? 'outro',
          createdAt: now,
          updatedAt: now,
        });
        toast.success('Contato cadastrado com sucesso!');
      }
      queryClient.invalidateQueries({ queryKey: ['crmContacts', business.id] });
      setContactDialogOpen(false);
      setEditingContact(null);
    } catch {
      toast.error('Erro ao salvar contato');
    }
  }, [business?.id, user, editingContact, queryClient]);

  const handleDeleteContact = useCallback(async () => {
    if (!deleteContactConfirm || !business?.id) return;
    try {
      await deleteDoc(doc(db, 'crmContacts', deleteContactConfirm.id));
      toast.success('Contato excluido');
      queryClient.invalidateQueries({ queryKey: ['crmContacts', business.id] });
      setDeleteContactConfirm(null);
    } catch {
      toast.error('Erro ao excluir contato');
    }
  }, [deleteContactConfirm, business?.id, queryClient]);

  // ---- CRUD Handlers: Deals ----
  const handleSaveDeal = useCallback(async (data: Partial<CRMDeal>) => {
    if (!business?.id || !user) return;
    try {
      const now = new Date().toISOString();
      if (editingDeal) {
        await updateDoc(doc(db, 'crmDeals', editingDeal.id), { ...data, updatedAt: now });
        toast.success('Deal atualizado com sucesso!');
      } else {
        await addDoc(collection(db, 'crmDeals'), {
          ...data,
          businessId: business.id,
          stage: data.stage ?? 'prospeccao',
          probability: data.probability ?? 10,
          value: data.value ?? 0,
          createdAt: now,
          updatedAt: now,
        });
        toast.success('Deal criado com sucesso!');
      }
      queryClient.invalidateQueries({ queryKey: ['crmDeals', business.id] });
      setDealDialogOpen(false);
      setEditingDeal(null);
    } catch {
      toast.error('Erro ao salvar deal');
    }
  }, [business?.id, user, editingDeal, queryClient]);

  const handleDeleteDeal = useCallback(async () => {
    if (!deleteDealConfirm || !business?.id) return;
    try {
      await deleteDoc(doc(db, 'crmDeals', deleteDealConfirm.id));
      toast.success('Deal excluido');
      queryClient.invalidateQueries({ queryKey: ['crmDeals', business.id] });
      setDeleteDealConfirm(null);
    } catch {
      toast.error('Erro ao excluir deal');
    }
  }, [deleteDealConfirm, business?.id, queryClient]);

  const handleMoveDealStage = useCallback(async (dealId: string, newStage: string) => {
    if (!business?.id) return;
    try {
      const stage = PIPELINE_STAGES.find((s) => s.id === newStage);
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'crmDeals', dealId), {
        stage: newStage,
        probability: stage?.probability ?? 10,
        updatedAt: now,
        ...(newStage === 'fechamento' ? { closedDate: now } : {}),
      });
      queryClient.invalidateQueries({ queryKey: ['crmDeals', business.id] });
    } catch {
      toast.error('Erro ao mover deal');
    }
  }, [business?.id, queryClient]);

  // ---- CRUD Handlers: Activities ----
  const handleSaveActivity = useCallback(async (data: Partial<CRMActivity>) => {
    if (!business?.id || !user) return;
    try {
      const now = new Date().toISOString();
      if (editingActivity) {
        await updateDoc(doc(db, 'crmActivities', editingActivity.id), { ...data, updatedAt: now });
        toast.success('Atividade atualizada!');
      } else {
        await addDoc(collection(db, 'crmActivities'), {
          ...data,
          businessId: business.id,
          isCompleted: false,
          createdAt: now,
          updatedAt: now,
        });
        toast.success('Atividade registrada!');
      }
      queryClient.invalidateQueries({ queryKey: ['crmActivities', business.id] });
      setActivityDialogOpen(false);
      setEditingActivity(null);
    } catch {
      toast.error('Erro ao salvar atividade');
    }
  }, [business?.id, user, editingActivity, queryClient]);

  const handleToggleActivity = useCallback(async (activity: CRMActivity) => {
    if (!business?.id) return;
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'crmActivities', activity.id), {
        isCompleted: !activity.isCompleted,
        completedAt: !activity.isCompleted ? now : null,
        updatedAt: now,
      });
      queryClient.invalidateQueries({ queryKey: ['crmActivities', business.id] });
    } catch {
      toast.error('Erro ao atualizar atividade');
    }
  }, [business?.id, queryClient]);

  const handleDeleteActivity = useCallback(async () => {
    if (!deleteActivityConfirm || !business?.id) return;
    try {
      await deleteDoc(doc(db, 'crmActivities', deleteActivityConfirm.id));
      toast.success('Atividade excluida');
      queryClient.invalidateQueries({ queryKey: ['crmActivities', business.id] });
      setDeleteActivityConfirm(null);
    } catch {
      toast.error('Erro ao excluir atividade');
    }
  }, [deleteActivityConfirm, business?.id, queryClient]);

  // ---- Loading ----
  if (isLoading) return <CRMSkeleton />;

  return (
    <div>
      <div className="max-w-[1440px] mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center shadow-sm shadow-red-200 dark:shadow-red-900/30">
              <Target size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-gray-100">CRM</h1>
              <p className="text-sm text-slate-500 dark:text-gray-400">Gestão de relacionamento e vendas</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={() => { setEditingContact(null); setContactDialogOpen(true); }}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 text-slate-700 dark:text-gray-300 rounded-xl font-semibold text-sm hover:border-slate-300 dark:hover:border-gray-600 transition-all"
            >
              <UserPlus size={16} />
              Contato
            </motion.button>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={() => { setEditingActivity(null); setActivityDialogOpen(true); }}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 text-slate-700 dark:text-gray-300 rounded-xl font-semibold text-sm hover:border-slate-300 dark:hover:border-gray-600 transition-all"
            >
              <Activity size={16} />
              Atividade
            </motion.button>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={() => { setEditingDeal(null); setDealDialogOpen(true); }}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-red-600 to-red-500 text-white rounded-xl font-semibold text-sm shadow-sm shadow-red-200 dark:shadow-red-900/30 hover:shadow-md hover:shadow-red-200 dark:hover:shadow-red-900/40 transition-all"
            >
              <Plus size={18} />
              Novo Deal
            </motion.button>
          </div>
        </div>

        {/* Tab Nav */}
        <div className="flex gap-1 p-1 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-2xl mb-6 overflow-x-auto shadow-sm">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all',
                activeTab === tab.key
                  ? 'bg-slate-900 dark:bg-gray-700 text-white shadow-sm'
                  : 'text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300 hover:bg-slate-50 dark:bg-white/[0.02] dark:hover:bg-white/[0.04]'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: { duration: 0.15 } }} transition={{ duration: 0.2 }}>
            {activeTab === 'pipeline' && (
              <PipelineTab
                deals={deals}
                stages={PIPELINE_STAGES}
                metrics={pipelineMetrics}
                onEditDeal={(d) => { setEditingDeal(d); setDealDialogOpen(true); }}
                onDeleteDeal={(d) => setDeleteDealConfirm(d)}
                onMoveDeal={handleMoveDealStage}
                onNewDeal={() => { setEditingDeal(null); setDealDialogOpen(true); }}
              />
            )}
            {activeTab === 'contatos' && (
              <ContactsTab
                contacts={contacts}
                onEdit={(c) => { setEditingContact(c); setContactDialogOpen(true); }}
                onDelete={(c) => setDeleteContactConfirm(c)}
                onNew={() => { setEditingContact(null); setContactDialogOpen(true); }}
              />
            )}
            {activeTab === 'atividades' && (
              <ActivitiesTab
                activities={activities}
                onEdit={(a) => { setEditingActivity(a); setActivityDialogOpen(true); }}
                onDelete={(a) => setDeleteActivityConfirm(a)}
                onToggle={handleToggleActivity}
                onNew={() => { setEditingActivity(null); setActivityDialogOpen(true); }}
              />
            )}
            {activeTab === 'campanhas' && (
              <CampaignsTab businessId={business?.id || ''} />
            )}
            {activeTab === 'metricas' && (
              <MetricsTab deals={deals} contacts={contacts} activities={activities} stages={PIPELINE_STAGES} isDark={isDark} metrics={pipelineMetrics} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ===== Dialogs ===== */}

      {/* Contact Dialog */}
      <ContactFormDialog
        open={contactDialogOpen}
        onClose={() => { setContactDialogOpen(false); setEditingContact(null); }}
        onSave={handleSaveContact}
        contact={editingContact}
        members={members}
      />

      {/* Deal Dialog */}
      <DealFormDialog
        open={dealDialogOpen}
        onClose={() => { setDealDialogOpen(false); setEditingDeal(null); }}
        onSave={handleSaveDeal}
        deal={editingDeal}
        contacts={contacts}
        members={members}
      />

      {/* Activity Dialog */}
      <ActivityFormDialog
        open={activityDialogOpen}
        onClose={() => { setActivityDialogOpen(false); setEditingActivity(null); }}
        onSave={handleSaveActivity}
        activity={editingActivity}
        contacts={contacts}
        deals={deals}
        members={members}
      />

      {/* Delete Confirmations */}
      <DeleteConfirmDialog
        open={!!deleteContactConfirm}
        title="Excluir Contato"
        message={`Tem certeza que deseja excluir o contato "${deleteContactConfirm?.name}"? Essa ação não pode ser desfeita.`}
        onClose={() => setDeleteContactConfirm(null)}
        onConfirm={handleDeleteContact}
      />
      <DeleteConfirmDialog
        open={!!deleteDealConfirm}
        title="Excluir Deal"
        message={`Tem certeza que deseja excluir o deal "${deleteDealConfirm?.title}"? Essa ação não pode ser desfeita.`}
        onClose={() => setDeleteDealConfirm(null)}
        onConfirm={handleDeleteDeal}
      />
      <DeleteConfirmDialog
        open={!!deleteActivityConfirm}
        title="Excluir Atividade"
        message={`Tem certeza que deseja excluir a atividade "${deleteActivityConfirm?.title}"? Essa ação não pode ser desfeita.`}
        onClose={() => setDeleteActivityConfirm(null)}
        onConfirm={handleDeleteActivity}
      />
    </div>
  );
}

// ==========================================
// DELETE CONFIRM DIALOG
// ==========================================

function DeleteConfirmDialog({ open, title, message, onClose, onConfirm }: { open: boolean; title: string; message: string; onClose: () => void; onConfirm: () => void }) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
      <DialogTitle sx={{ pb: 1 }}>
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
            <AlertTriangle size={18} className="text-red-600 dark:text-red-400" />
          </div>
          <span className="text-base font-display font-bold text-slate-900 dark:text-gray-100">{title}</span>
        </div>
      </DialogTitle>
      <DialogContent>
        <p className="text-sm text-slate-500 dark:text-gray-400">{message}</p>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={loading} sx={{ borderRadius: '10px', textTransform: 'none' }}>Cancelar</Button>
        <Button onClick={handleConfirm} disabled={loading} variant="contained" color="error" sx={{ borderRadius: '10px', textTransform: 'none' }}>
          {loading ? 'Excluindo...' : 'Excluir'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ==========================================
// CONTACT FORM DIALOG
// ==========================================

function ContactFormDialog({ open, onClose, onSave, contact, members }: {
  open: boolean; onClose: () => void; onSave: (data: Partial<CRMContact>) => Promise<void>; contact: CRMContact | null; members: User[];
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [source, setSource] = useState<LeadSource>('outro');
  const [status, setStatus] = useState<LeadStatus>('novo');
  const [score, setScore] = useState(0);
  const [assignedTo, setAssignedTo] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(contact?.name ?? '');
      setEmail(contact?.email ?? '');
      setPhone(contact?.phone ? applyPhoneMask(contact.phone) : '');
      setWhatsapp(contact?.whatsapp ? applyPhoneMask(contact.whatsapp) : '');
      setCompany(contact?.company ?? '');
      setRole(contact?.role ?? '');
      setSource(contact?.source ?? 'outro');
      setStatus(contact?.status ?? 'novo');
      setScore(contact?.score ?? 0);
      setAssignedTo(contact?.assignedTo ?? '');
      setTags(contact?.tags?.join(', ') ?? '');
      setNotes(contact?.notes ?? '');
    }
  }, [open, contact]);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const member = members.find((m) => m.id === assignedTo);
      const tagsList = tags.split(',').map((t) => t.trim()).filter(Boolean);
      await onSave({
        name: name.trim(),
        email: email.trim() || undefined,
        phone: stripPhoneMask(phone) || undefined,
        whatsapp: stripPhoneMask(whatsapp) || undefined,
        company: company.trim() || undefined,
        role: role.trim() || undefined,
        source,
        status,
        score,
        assignedTo: assignedTo || undefined,
        assignedToName: member?.name || undefined,
        tags: tagsList.length > 0 ? tagsList : undefined,
        notes: notes.trim() || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
      <DialogTitle sx={{ pb: 1 }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center">
              <UserPlus size={18} className="text-white" />
            </div>
            <span className="text-base font-display font-bold text-slate-900 dark:text-gray-100">
              {contact ? 'Editar Contato' : 'Novo Contato'}
            </span>
          </div>
          <IconButton onClick={onClose} size="small"><X size={18} /></IconButton>
        </div>
      </DialogTitle>
      <DialogContent sx={{ pt: '12px !important' }}>
        <div className="space-y-4">
          <TextField label="Nome *" value={name} onChange={(e) => setName(e.target.value)} fullWidth size="small" sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} fullWidth size="small" type="email" sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
            <TextField label="Telefone" value={phone} onChange={(e) => setPhone(applyPhoneMask(e.target.value))} fullWidth size="small" sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="WhatsApp" value={whatsapp} onChange={(e) => setWhatsapp(applyPhoneMask(e.target.value))} fullWidth size="small" sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
            <TextField label="Empresa" value={company} onChange={(e) => setCompany(e.target.value)} fullWidth size="small" sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Cargo" value={role} onChange={(e) => setRole(e.target.value)} fullWidth size="small" sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
            <FormControl size="small" fullWidth>
              <InputLabel>Origem</InputLabel>
              <Select value={source} onChange={(e) => setSource(e.target.value as LeadSource)} label="Origem" sx={{ borderRadius: '10px' }}>
                {ALL_SOURCES.map((s) => <MenuItem key={s} value={s}>{SOURCE_LABELS[s]}</MenuItem>)}
              </Select>
            </FormControl>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormControl size="small" fullWidth>
              <InputLabel>Status</InputLabel>
              <Select value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)} label="Status" sx={{ borderRadius: '10px' }}>
                {ALL_STATUSES.map((s) => <MenuItem key={s} value={s}>{STATUS_LABELS[s]}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>Responsável</InputLabel>
              <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} label="Responsável" sx={{ borderRadius: '10px' }}>
                <MenuItem value="">Nenhum</MenuItem>
                {members.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}
              </Select>
            </FormControl>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-600 dark:text-gray-400 mb-2">Score: {score}</p>
            <Slider value={score} onChange={(_, v) => setScore(v as number)} min={0} max={100} step={5}
              sx={{ color: score >= 80 ? '#10B981' : score >= 50 ? '#F59E0B' : '#94A3B8' }}
            />
          </div>
          <TextField label="Tags (separadas por vírgula)" value={tags} onChange={(e) => setTags(e.target.value)} fullWidth size="small" placeholder="ex: enterprise, saas, alto-valor" sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          <TextField label="Observações" value={notes} onChange={(e) => setNotes(e.target.value)} fullWidth size="small" multiline rows={3} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
        </div>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={saving} sx={{ borderRadius: '10px', textTransform: 'none' }}>Cancelar</Button>
        <Button onClick={handleSubmit} disabled={saving || !name.trim()} variant="contained" sx={{ borderRadius: '10px', textTransform: 'none', bgcolor: '#DC2626', '&:hover': { bgcolor: '#B91C1C' } }}>
          {saving ? 'Salvando...' : contact ? 'Salvar' : 'Criar Contato'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ==========================================
// DEAL FORM DIALOG
// ==========================================

function DealFormDialog({ open, onClose, onSave, deal, contacts, members }: {
  open: boolean; onClose: () => void; onSave: (data: Partial<CRMDeal>) => Promise<void>; deal: CRMDeal | null; contacts: CRMContact[]; members: User[];
}) {
  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState('');
  const [valueStr, setValueStr] = useState('');
  const [stage, setStage] = useState('prospeccao');
  const [probability, setProbability] = useState(10);
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(deal?.title ?? '');
      setContactId(deal?.contactId ?? '');
      setValueStr(deal?.value ? formatCurrencyInput(deal.value) : '');
      setStage(deal?.stage ?? 'prospeccao');
      setProbability(deal?.probability ?? 10);
      setExpectedCloseDate(deal?.expectedCloseDate ?? '');
      setAssignedTo(deal?.assignedTo ?? '');
      setNotes(deal?.notes ?? '');
    }
  }, [open, deal]);

  const handleStageChange = (newStage: string) => {
    setStage(newStage);
    const stageInfo = PIPELINE_STAGES.find((s) => s.id === newStage);
    if (stageInfo) setProbability(stageInfo.probability);
  };

  const handleSubmit = async () => {
    if (!title.trim() || !contactId) return;
    setSaving(true);
    try {
      const selectedContact = contacts.find((c) => c.id === contactId);
      const member = members.find((m) => m.id === assignedTo);
      await onSave({
        title: title.trim(),
        contactId,
        contactName: selectedContact?.name ?? '',
        value: parseCurrencyInput(valueStr),
        stage,
        probability,
        expectedCloseDate: expectedCloseDate || undefined,
        assignedTo: assignedTo || undefined,
        assignedToName: member?.name || undefined,
        notes: notes.trim() || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
      <DialogTitle sx={{ pb: 1 }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center">
              <Briefcase size={18} className="text-white" />
            </div>
            <span className="text-base font-display font-bold text-slate-900 dark:text-gray-100">
              {deal ? 'Editar Deal' : 'Novo Deal'}
            </span>
          </div>
          <IconButton onClick={onClose} size="small"><X size={18} /></IconButton>
        </div>
      </DialogTitle>
      <DialogContent sx={{ pt: '12px !important' }}>
        <div className="space-y-4">
          <TextField label="Título *" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth size="small" sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          <FormControl size="small" fullWidth>
            <InputLabel>Contato *</InputLabel>
            <Select value={contactId} onChange={(e) => setContactId(e.target.value)} label="Contato *" sx={{ borderRadius: '10px' }}>
              {contacts.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}{c.company ? ` - ${c.company}` : ''}</MenuItem>)}
            </Select>
          </FormControl>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Valor (R$)" value={valueStr} onChange={(e) => setValueStr(e.target.value)} fullWidth size="small" placeholder="0,00" sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
            <FormControl size="small" fullWidth>
              <InputLabel>Etapa</InputLabel>
              <Select value={stage} onChange={(e) => handleStageChange(e.target.value)} label="Etapa" sx={{ borderRadius: '10px' }}>
                {PIPELINE_STAGES.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                      {s.name}
                    </div>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium text-slate-600 dark:text-gray-400 mb-2">Probabilidade: {probability}%</p>
              <Slider value={probability} onChange={(_, v) => setProbability(v as number)} min={0} max={100} step={5} sx={{ color: '#DC2626' }} />
            </div>
            <TextField label="Previsão de Fechamento" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} fullWidth size="small" type="date" InputLabelProps={{ shrink: true }} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          </div>
          <FormControl size="small" fullWidth>
            <InputLabel>Responsável</InputLabel>
            <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} label="Responsável" sx={{ borderRadius: '10px' }}>
              <MenuItem value="">Nenhum</MenuItem>
              {members.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField label="Observações" value={notes} onChange={(e) => setNotes(e.target.value)} fullWidth size="small" multiline rows={3} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
        </div>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={saving} sx={{ borderRadius: '10px', textTransform: 'none' }}>Cancelar</Button>
        <Button onClick={handleSubmit} disabled={saving || !title.trim() || !contactId} variant="contained" sx={{ borderRadius: '10px', textTransform: 'none', bgcolor: '#DC2626', '&:hover': { bgcolor: '#B91C1C' } }}>
          {saving ? 'Salvando...' : deal ? 'Salvar' : 'Criar Deal'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ==========================================
// ACTIVITY FORM DIALOG
// ==========================================

function ActivityFormDialog({ open, onClose, onSave, activity, contacts, deals, members }: {
  open: boolean; onClose: () => void; onSave: (data: Partial<CRMActivity>) => Promise<void>; activity: CRMActivity | null; contacts: CRMContact[]; deals: CRMDeal[]; members: User[];
}) {
  const [type, setType] = useState<CRMActivityType>('tarefa');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [contactId, setContactId] = useState('');
  const [dealId, setDealId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [duration, setDuration] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setType(activity?.type ?? 'tarefa');
      setTitle(activity?.title ?? '');
      setDescription(activity?.description ?? '');
      setContactId(activity?.contactId ?? '');
      setDealId(activity?.dealId ?? '');
      setScheduledAt(activity?.scheduledAt ? activity.scheduledAt.slice(0, 16) : '');
      setAssignedTo(activity?.assignedTo ?? '');
      setDuration(activity?.duration ? String(activity.duration) : '');
    }
  }, [open, activity]);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const selectedContact = contacts.find((c) => c.id === contactId);
      const selectedDeal = deals.find((d) => d.id === dealId);
      const member = members.find((m) => m.id === assignedTo);
      await onSave({
        type,
        title: title.trim(),
        description: description.trim() || undefined,
        contactId: contactId || undefined,
        contactName: selectedContact?.name || undefined,
        dealId: dealId || undefined,
        dealTitle: selectedDeal?.title || undefined,
        scheduledAt: scheduledAt || undefined,
        assignedTo: assignedTo || undefined,
        assignedToName: member?.name || undefined,
        duration: duration ? parseInt(duration, 10) : undefined,
        ...(activity ? {} : { isCompleted: false }),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
      <DialogTitle sx={{ pb: 1 }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center">
              <Activity size={18} className="text-white" />
            </div>
            <span className="text-base font-display font-bold text-slate-900 dark:text-gray-100">
              {activity ? 'Editar Atividade' : 'Nova Atividade'}
            </span>
          </div>
          <IconButton onClick={onClose} size="small"><X size={18} /></IconButton>
        </div>
      </DialogTitle>
      <DialogContent sx={{ pt: '12px !important' }}>
        <div className="space-y-4">
          <FormControl size="small" fullWidth>
            <InputLabel>Tipo</InputLabel>
            <Select value={type} onChange={(e) => setType(e.target.value as CRMActivityType)} label="Tipo" sx={{ borderRadius: '10px' }}>
              {ALL_ACTIVITY_TYPES.map((t) => (
                <MenuItem key={t} value={t}>
                  <div className="flex items-center gap-2">
                    <span style={{ color: ACTIVITY_COLORS[t] }}>{ACTIVITY_ICONS[t]}</span>
                    {ACTIVITY_LABELS[t]}
                  </div>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField label="Título *" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth size="small" sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          <TextField label="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} fullWidth size="small" multiline rows={2} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          <div className="grid grid-cols-2 gap-3">
            <FormControl size="small" fullWidth>
              <InputLabel>Contato</InputLabel>
              <Select value={contactId} onChange={(e) => setContactId(e.target.value)} label="Contato" sx={{ borderRadius: '10px' }}>
                <MenuItem value="">Nenhum</MenuItem>
                {contacts.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>Deal</InputLabel>
              <Select value={dealId} onChange={(e) => setDealId(e.target.value)} label="Deal" sx={{ borderRadius: '10px' }}>
                <MenuItem value="">Nenhum</MenuItem>
                {deals.map((d) => <MenuItem key={d.id} value={d.id}>{d.title}</MenuItem>)}
              </Select>
            </FormControl>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Data/Hora Agendada" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} fullWidth size="small" type="datetime-local" InputLabelProps={{ shrink: true }} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
            <TextField label="Duração (min)" value={duration} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))} fullWidth size="small" sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          </div>
          <FormControl size="small" fullWidth>
            <InputLabel>Responsável</InputLabel>
            <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} label="Responsável" sx={{ borderRadius: '10px' }}>
              <MenuItem value="">Nenhum</MenuItem>
              {members.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}
            </Select>
          </FormControl>
        </div>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={saving} sx={{ borderRadius: '10px', textTransform: 'none' }}>Cancelar</Button>
        <Button onClick={handleSubmit} disabled={saving || !title.trim()} variant="contained" sx={{ borderRadius: '10px', textTransform: 'none', bgcolor: '#DC2626', '&:hover': { bgcolor: '#B91C1C' } }}>
          {saving ? 'Salvando...' : activity ? 'Salvar' : 'Criar Atividade'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ==========================================
// TAB: PIPELINE
// ==========================================

function PipelineTab({
  deals, stages, metrics, onEditDeal, onDeleteDeal, onMoveDeal, onNewDeal,
}: {
  deals: CRMDeal[];
  stages: CRMPipelineStage[];
  metrics: { totalValue: number; weightedValue: number; avgDealSize: number; activeDeals: number; conversionRate: number; wonValue: number; wonDeals: number };
  onEditDeal: (d: CRMDeal) => void;
  onDeleteDeal: (d: CRMDeal) => void;
  onMoveDeal: (dealId: string, newStage: string) => void;
  onNewDeal: () => void;
}) {
  const [menuDeal, setMenuDeal] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Pipeline Total', value: formatCurrency(metrics.totalValue), icon: <DollarSign size={18} />, color: 'red' },
          { label: 'Forecast Ponderado', value: formatCurrency(metrics.weightedValue), icon: <Target size={18} />, color: 'blue' },
          { label: 'Ticket Médio', value: formatCurrency(metrics.avgDealSize), icon: <BarChart3 size={18} />, color: 'amber' },
          { label: 'Deals Ativos', value: String(metrics.activeDeals), icon: <Layers size={18} />, color: 'emerald' },
        ].map((card, i) => {
          const cm: Record<string, { bg: string; txt: string }> = {
            red: { bg: 'bg-red-50 dark:bg-red-500/10', txt: 'text-red-600 dark:text-red-400' },
            blue: { bg: 'bg-blue-50 dark:bg-blue-500/10', txt: 'text-blue-600 dark:text-blue-400' },
            amber: { bg: 'bg-amber-50 dark:bg-amber-500/10', txt: 'text-amber-600 dark:text-amber-400' },
            emerald: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', txt: 'text-emerald-600 dark:text-emerald-400' },
          };
          const c = cm[card.color] || cm.red;
          return (
            <motion.div key={card.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
              className="bg-white dark:bg-[#111827] border border-slate-100 dark:border-gray-700/50 rounded-2xl p-4 hover:shadow-md hover:border-slate-200 dark:hover:border-gray-600 transition-all"
            >
              <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center mb-3', c.bg, c.txt)}>{card.icon}</div>
              <p className="text-[11px] text-slate-400 dark:text-gray-500 font-medium mb-0.5">{card.label}</p>
              <p className="text-lg font-display font-bold text-slate-900 dark:text-gray-100">{card.value}</p>
            </motion.div>
          );
        })}
      </div>

      {/* Kanban Pipeline */}
      <div className="overflow-x-auto pb-4">
        <div className="flex gap-4 min-w-max">
          {stages.map((stage, si) => {
            const stageDeals = deals.filter((d) => d.stage === stage.id);
            const stageValue = stageDeals.reduce((s, d) => s + d.value, 0);
            return (
              <motion.div key={stage.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: si * 0.08 }}
                className="w-[300px] shrink-0"
              >
                {/* Column Header */}
                <div className="flex items-center justify-between mb-3 px-1">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: stage.color }} />
                    <h3 className="text-sm font-bold text-slate-800 dark:text-gray-200">{stage.name}</h3>
                    <span className="text-[10px] font-bold bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400 px-1.5 py-0.5 rounded-full">{stageDeals.length}</span>
                  </div>
                  <span className="text-xs text-slate-400 dark:text-gray-500 font-medium">{formatCurrency(stageValue)}</span>
                </div>

                {/* Cards */}
                <div className="space-y-2.5 min-h-[200px] bg-slate-50/50 dark:bg-white/[0.02] rounded-xl p-2">
                  {stageDeals.map((deal, di) => (
                    <motion.div key={deal.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: si * 0.08 + di * 0.04 }}
                      className="bg-white dark:bg-[#111827] border border-slate-100 dark:border-gray-700/50 rounded-xl p-3.5 hover:shadow-md hover:border-slate-200 dark:hover:border-gray-600 transition-all cursor-pointer group relative"
                      onClick={() => onEditDeal(deal)}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <p className="text-sm font-semibold text-slate-800 dark:text-gray-200 leading-tight pr-2">{deal.title}</p>
                        <div className="relative">
                          <IconButton size="small"
                            onClick={(e) => { e.stopPropagation(); setMenuDeal(menuDeal === deal.id ? null : deal.id); }}
                            sx={{ opacity: 0, '.group:hover &': { opacity: 1 }, transition: 'opacity 0.15s' }}
                          >
                            <MoreVertical size={14} className="text-slate-400 dark:text-gray-500" />
                          </IconButton>

                          {/* Inline Menu */}
                          <AnimatePresence>
                            {menuDeal === deal.id && (
                              <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                                className="absolute right-0 top-8 z-50 bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-xl shadow-lg p-1.5 min-w-[160px]"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <p className="text-[10px] font-semibold text-slate-400 dark:text-gray-500 px-2 py-1 mb-0.5">Mover para</p>
                                {stages.filter((s) => s.id !== deal.stage).map((s) => (
                                  <button key={s.id}
                                    onClick={() => { onMoveDeal(deal.id, s.id); setMenuDeal(null); }}
                                    className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
                                  >
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                                    {s.name}
                                  </button>
                                ))}
                                <div className="h-px bg-slate-100 dark:bg-gray-700 my-1" />
                                <button
                                  onClick={() => { onEditDeal(deal); setMenuDeal(null); }}
                                  className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
                                >
                                  <Edit3 size={12} /> Editar
                                </button>
                                <button
                                  onClick={() => { onDeleteDeal(deal); setMenuDeal(null); }}
                                  className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                                >
                                  <Trash2 size={12} /> Excluir
                                </button>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 dark:text-gray-500 mb-3">{deal.contactName}</p>

                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-slate-900 dark:text-gray-100">{formatCurrency(deal.value)}</span>
                        {deal.expectedCloseDate && (
                          <span className="text-[10px] text-slate-400 dark:text-gray-500 flex items-center gap-1">
                            <Calendar size={10} /> {formatDate(deal.expectedCloseDate)}
                          </span>
                        )}
                      </div>

                      {deal.assignedToName && (
                        <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-slate-100 dark:border-gray-700/50">
                          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-slate-300 to-slate-400 dark:from-gray-600 dark:to-gray-500 flex items-center justify-center text-[8px] font-bold text-white">
                            {getInitials(deal.assignedToName)}
                          </div>
                          <span className="text-[11px] text-slate-400 dark:text-gray-500">{deal.assignedToName}</span>
                        </div>
                      )}

                      {deal.tags && deal.tags.length > 0 && (
                        <div className="flex gap-1 mt-2">
                          {deal.tags.map((tag) => (
                            <span key={tag} className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400">{tag}</span>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  ))}

                  {stageDeals.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-32 text-slate-300 dark:text-gray-600">
                      <Layers size={20} strokeWidth={1.5} />
                      <p className="text-xs mt-2">Nenhum deal</p>
                      <button onClick={onNewDeal} className="mt-2 text-[10px] font-semibold text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors">
                        + Adicionar
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ==========================================
// TAB: CONTATOS
// ==========================================

function ContactsTab({ contacts, onEdit, onDelete, onNew }: {
  contacts: CRMContact[];
  onEdit: (c: CRMContact) => void;
  onDelete: (c: CRMContact) => void;
  onNew: () => void;
}) {
  const [search, setSearch] = useState('');
  const [filterSource, setFilterSource] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const filtered = useMemo(() => {
    let result = [...contacts];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.company && c.company.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q))
      );
    }
    if (filterSource !== 'all') result = result.filter((c) => c.source === filterSource);
    if (filterStatus !== 'all') result = result.filter((c) => c.status === filterStatus);
    return result.sort((a, b) => b.score - a.score);
  }, [contacts, search, filterSource, filterStatus]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
          <input type="text" placeholder="Buscar contato, empresa, e-mail..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-white/[0.04] border border-slate-200 dark:border-gray-700/50 rounded-xl text-sm text-slate-900 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:focus:ring-red-500/30 focus:border-red-400 dark:focus:border-red-500/40 transition-all"
          />
        </div>
        <div className="flex gap-2">
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <Select value={filterSource} onChange={(e) => setFilterSource(e.target.value)} displayEmpty sx={{ borderRadius: '12px', fontSize: '0.8rem' }}>
              <MenuItem value="all">Todas origens</MenuItem>
              {Object.entries(SOURCE_LABELS).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} displayEmpty sx={{ borderRadius: '12px', fontSize: '0.8rem' }}>
              <MenuItem value="all">Todos status</MenuItem>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
            </Select>
          </FormControl>
        </div>
      </div>

      {/* Contact Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((contact, i) => {
          const sc = STATUS_COLORS[contact.status];
          const srcColor = SOURCE_COLORS[contact.source];
          return (
            <motion.div key={contact.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className="bg-white dark:bg-[#111827] border border-slate-100 dark:border-gray-700/50 rounded-2xl p-4 hover:shadow-md hover:border-slate-200 dark:hover:border-gray-600 transition-all cursor-pointer group"
              onClick={() => onEdit(contact)}
            >
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-200 to-slate-300 dark:from-gray-700 dark:to-gray-600 flex items-center justify-center text-sm font-bold text-slate-600 dark:text-gray-300 shrink-0">
                  {getInitials(contact.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800 dark:text-gray-200 truncate">{contact.name}</p>
                  {contact.company && <p className="text-xs text-slate-400 dark:text-gray-500 truncate">{contact.role ? `${contact.role} · ` : ''}{contact.company}</p>}
                </div>
                {/* Score */}
                <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold',
                  contact.score >= 80 ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : contact.score >= 50 ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400'
                )}>
                  {contact.score}
                </div>
              </div>

              {/* Contact Info */}
              <div className="space-y-1.5 mb-3">
                {contact.email && (
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-gray-400">
                    <Mail size={12} className="text-slate-400 dark:text-gray-500" /> <span className="truncate">{contact.email}</span>
                  </div>
                )}
                {contact.phone && (
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-gray-400">
                    <Phone size={12} className="text-slate-400 dark:text-gray-500" /> {formatPhone(contact.phone)}
                  </div>
                )}
                {contact.whatsapp && (
                  <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                    <MessageCircle size={12} /> WhatsApp
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-gray-700/50">
                <div className="flex items-center gap-2">
                  <Chip label={STATUS_LABELS[contact.status]} size="small"
                    sx={{ backgroundColor: sc.bg, color: sc.text, fontWeight: 600, fontSize: '0.6rem', height: 22 }}
                  />
                  <Tooltip title={SOURCE_LABELS[contact.source]} arrow>
                    <span className="w-2 h-2 rounded-full cursor-help" style={{ backgroundColor: srcColor }} />
                  </Tooltip>
                </div>
                <div className="flex items-center gap-1">
                  {contact.tags && contact.tags.slice(0, 2).map((tag) => (
                    <span key={tag} className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400">{tag}</span>
                  ))}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center ml-1">
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); onDelete(contact); }}>
                      <Trash2 size={13} className="text-slate-400 dark:text-gray-500 hover:text-red-500" />
                    </IconButton>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {filtered.length === 0 && contacts.length === 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-gray-500">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-gray-800 flex items-center justify-center mb-4">
            <Users size={28} strokeWidth={1.5} />
          </div>
          <p className="text-sm font-medium mb-1">Nenhum contato cadastrado</p>
          <p className="text-xs text-slate-400 dark:text-gray-500 mb-4">Adicione seus primeiros contatos ao CRM</p>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onNew}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-red-600 to-red-500 text-white rounded-xl font-semibold text-sm"
          >
            <Plus size={16} /> Adicionar Contato
          </motion.button>
        </motion.div>
      )}

      {filtered.length === 0 && contacts.length > 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-gray-500">
          <Search size={36} strokeWidth={1.5} />
          <p className="mt-3 text-sm">Nenhum contato encontrado com os filtros aplicados</p>
        </div>
      )}
    </div>
  );
}

// ==========================================
// TAB: ATIVIDADES
// ==========================================

function ActivitiesTab({ activities, onEdit, onDelete, onToggle, onNew }: {
  activities: CRMActivity[];
  onEdit: (a: CRMActivity) => void;
  onDelete: (a: CRMActivity) => void;
  onToggle: (a: CRMActivity) => void;
  onNew: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');

  const sorted = useMemo(() => {
    let result = [...activities];
    if (filter === 'pending') result = result.filter((a) => !a.isCompleted);
    if (filter === 'completed') result = result.filter((a) => a.isCompleted);
    return result.sort((a, b) => {
      const aDate = a.completedAt || a.scheduledAt || a.createdAt;
      const bDate = b.completedAt || b.scheduledAt || b.createdAt;
      return bDate.localeCompare(aDate);
    });
  }, [activities, filter]);

  const pending = activities.filter((a) => !a.isCompleted);
  const completed = activities.filter((a) => a.isCompleted);
  const todayStr = new Date().toISOString().split('T')[0];
  const todayActivities = activities.filter((a) => {
    const d = a.scheduledAt || a.completedAt || '';
    return d.startsWith(todayStr);
  });

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-white dark:bg-[#111827] border border-slate-100 dark:border-gray-700/50 rounded-2xl p-4">
          <p className="text-[11px] text-slate-400 dark:text-gray-500 font-medium mb-1">Pendentes</p>
          <p className="text-xl font-display font-bold text-amber-600 dark:text-amber-400">{pending.length}</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }} className="bg-white dark:bg-[#111827] border border-slate-100 dark:border-gray-700/50 rounded-2xl p-4">
          <p className="text-[11px] text-slate-400 dark:text-gray-500 font-medium mb-1">Hoje</p>
          <p className="text-xl font-display font-bold text-red-600 dark:text-red-400">{todayActivities.length}</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="bg-white dark:bg-[#111827] border border-slate-100 dark:border-gray-700/50 rounded-2xl p-4">
          <p className="text-[11px] text-slate-400 dark:text-gray-500 font-medium mb-1">Concluídas</p>
          <p className="text-xl font-display font-bold text-emerald-600 dark:text-emerald-400">{completed.length}</p>
        </motion.div>
      </div>

      {/* Filter */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 p-0.5 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl w-fit">
          {[
            { key: 'all' as const, label: 'Todas' },
            { key: 'pending' as const, label: 'Pendentes' },
            { key: 'completed' as const, label: 'Concluídas' },
          ].map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={cn('px-4 py-1.5 rounded-lg text-xs font-medium transition-all', filter === f.key ? 'bg-slate-900 dark:bg-gray-700 text-white' : 'text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300')}
            >
              {f.label}
            </button>
          ))}
        </div>
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onNew}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors"
        >
          <Plus size={14} /> Nova Atividade
        </motion.button>
      </div>

      {/* Timeline */}
      <div className="space-y-3">
        {sorted.map((activity, i) => {
          const actColor = ACTIVITY_COLORS[activity.type];
          const dateStr = activity.completedAt || activity.scheduledAt || activity.createdAt;
          return (
            <motion.div key={activity.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
              className={cn('bg-white dark:bg-[#111827] border rounded-xl p-4 hover:shadow-md transition-all flex gap-4 group',
                activity.isCompleted ? 'border-slate-100 dark:border-gray-700/50' : 'border-l-4 border-slate-100 dark:border-gray-700/50',
              )}
              style={!activity.isCompleted ? { borderLeftColor: actColor } : undefined}
            >
              {/* Icon */}
              <button onClick={() => onToggle(activity)} className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 hover:scale-110 transition-transform"
                style={{ backgroundColor: `${actColor}15`, color: actColor }}
                title={activity.isCompleted ? 'Reabrir' : 'Concluir'}
              >
                {activity.isCompleted ? <CheckCircle2 size={14} /> : ACTIVITY_ICONS[activity.type]}
              </button>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className={cn('text-sm font-semibold', activity.isCompleted ? 'text-slate-400 dark:text-gray-500 line-through' : 'text-slate-800 dark:text-gray-200')}>
                      {activity.title}
                    </p>
                    {activity.description && <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">{activity.description}</p>}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <IconButton size="small" onClick={() => onEdit(activity)}>
                      <Edit3 size={13} className="text-slate-400 dark:text-gray-500" />
                    </IconButton>
                    <IconButton size="small" onClick={() => onDelete(activity)}>
                      <Trash2 size={13} className="text-slate-400 dark:text-gray-500 hover:text-red-500" />
                    </IconButton>
                  </div>
                </div>

                <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-slate-400 dark:text-gray-500">
                  <span className="font-medium px-1.5 py-0.5 rounded-md" style={{ backgroundColor: `${actColor}15`, color: actColor }}>
                    {ACTIVITY_LABELS[activity.type]}
                  </span>
                  {activity.contactName && <span className="font-medium text-slate-500 dark:text-gray-400">{activity.contactName}</span>}
                  {activity.dealTitle && <span>· {activity.dealTitle}</span>}
                  <span>· {formatDateTime(dateStr)}</span>
                  {activity.duration && <span>· {activity.duration}min</span>}
                  {activity.assignedToName && <span>· {activity.assignedToName}</span>}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {sorted.length === 0 && activities.length === 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-gray-500">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-gray-800 flex items-center justify-center mb-4">
            <Activity size={28} strokeWidth={1.5} />
          </div>
          <p className="text-sm font-medium mb-1">Nenhuma atividade registrada</p>
          <p className="text-xs text-slate-400 dark:text-gray-500 mb-4">Registre suas interações com contatos e deals</p>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onNew}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-red-600 to-red-500 text-white rounded-xl font-semibold text-sm"
          >
            <Plus size={16} /> Nova Atividade
          </motion.button>
        </motion.div>
      )}

      {sorted.length === 0 && activities.length > 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-gray-500">
          <Activity size={36} strokeWidth={1.5} />
          <p className="mt-3 text-sm">Nenhuma atividade nesta categoria</p>
        </div>
      )}
    </div>
  );
}

// ==========================================
// TAB: METRICAS / DASHBOARD
// ==========================================

function MetricsTab({
  deals, contacts, activities, stages, isDark, metrics,
}: {
  deals: CRMDeal[];
  contacts: CRMContact[];
  activities: CRMActivity[];
  stages: CRMPipelineStage[];
  isDark: boolean;
  metrics: { totalValue: number; weightedValue: number; avgDealSize: number; activeDeals: number; conversionRate: number; wonValue: number; wonDeals: number };
}) {
  // Funnel data
  const funnelData = useMemo(() => {
    return stages.map((stage) => {
      const stageDeals = deals.filter((d) => d.stage === stage.id);
      const count = stageDeals.length;
      const value = stageDeals.reduce((s, d) => s + d.value, 0);
      return { name: stage.name, value: count, dealValue: value, fill: stage.color };
    });
  }, [deals, stages]);

  // Source breakdown
  const sourceData = useMemo(() => {
    const counts: Record<string, number> = {};
    contacts.forEach((c) => { counts[c.source] = (counts[c.source] || 0) + 1; });
    return Object.entries(counts).map(([source, count]) => ({
      name: SOURCE_LABELS[source as LeadSource] || source,
      value: count,
      color: SOURCE_COLORS[source as LeadSource] || '#6B7280',
    })).sort((a, b) => b.value - a.value);
  }, [contacts]);

  // Status breakdown
  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    contacts.forEach((c) => { counts[c.status] = (counts[c.status] || 0) + 1; });
    return Object.entries(counts).map(([status, count]) => ({
      name: STATUS_LABELS[status as LeadStatus] || status,
      value: count,
      color: STATUS_COLORS[status as LeadStatus]?.text || '#6B7280',
    }));
  }, [contacts]);

  // Calculated metrics
  const conversionRate = contacts.length > 0
    ? ((contacts.filter((c) => c.status === 'ganho').length / contacts.length) * 100).toFixed(1)
    : '0';
  const avgScore = contacts.length > 0
    ? (contacts.reduce((s, c) => s + c.score, 0) / contacts.length).toFixed(0)
    : '0';

  // Activity stats
  const activityStats = useMemo(() => {
    const counts: Record<string, number> = {};
    activities.forEach((a) => { counts[a.type] = (counts[a.type] || 0) + 1; });
    return Object.entries(counts).map(([type, count]) => ({
      name: ACTIVITY_LABELS[type as CRMActivityType] || type,
      value: count,
      color: ACTIVITY_COLORS[type as CRMActivityType] || '#6B7280',
    })).sort((a, b) => b.value - a.value);
  }, [activities]);

  const tooltipStyle = {
    borderRadius: '12px',
    border: isDark ? '1px solid #374151' : '1px solid #E2E8F0',
    backgroundColor: isDark ? '#111827' : '#ffffff',
    color: isDark ? '#F1F5F9' : '#0F172A',
    boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
  };

  const hasData = deals.length > 0 || contacts.length > 0;

  if (!hasData) {
    return (
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-gray-500">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-gray-800 flex items-center justify-center mb-4">
          <BarChart3 size={28} strokeWidth={1.5} />
        </div>
        <p className="text-sm font-medium mb-1">Sem dados para exibir</p>
        <p className="text-xs">Adicione contatos e deals para visualizar as métricas</p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Taxa de Conversão', value: `${conversionRate}%`, icon: <TrendingUp size={18} />, color: 'emerald' },
          { label: 'Lead Score Médio', value: avgScore, icon: <Gauge size={18} />, color: 'amber' },
          { label: 'Total de Leads', value: String(contacts.length), icon: <Users size={18} />, color: 'blue' },
          { label: 'Valor Ganho', value: formatCurrency(metrics.wonValue), icon: <DollarSign size={18} />, color: 'red' },
        ].map((card, i) => {
          const cm: Record<string, { bg: string; txt: string }> = {
            emerald: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', txt: 'text-emerald-600 dark:text-emerald-400' },
            amber: { bg: 'bg-amber-50 dark:bg-amber-500/10', txt: 'text-amber-600 dark:text-amber-400' },
            blue: { bg: 'bg-blue-50 dark:bg-blue-500/10', txt: 'text-blue-600 dark:text-blue-400' },
            red: { bg: 'bg-red-50 dark:bg-red-500/10', txt: 'text-red-600 dark:text-red-400' },
          };
          const c = cm[card.color] || cm.blue;
          return (
            <motion.div key={card.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
              className="bg-white dark:bg-[#111827] border border-slate-100 dark:border-gray-700/50 rounded-2xl p-4"
            >
              <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center mb-3', c.bg, c.txt)}>{card.icon}</div>
              <p className="text-[11px] text-slate-400 dark:text-gray-500 font-medium mb-0.5">{card.label}</p>
              <p className="text-lg font-display font-bold text-slate-900 dark:text-gray-100">{card.value}</p>
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Funnel */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="bg-white dark:bg-[#111827] border border-slate-100 dark:border-gray-700/50 rounded-2xl p-6"
        >
          <h3 className="text-base font-display font-bold text-slate-900 dark:text-gray-100 mb-1">Funil de Vendas</h3>
          <p className="text-xs text-slate-400 dark:text-gray-500 mb-4">Distribuição de deals por estágio</p>
          <div className="space-y-3">
            {funnelData.map((stage, i) => {
              const maxValue = Math.max(...funnelData.map((s) => s.value), 1);
              const width = (stage.value / maxValue) * 100;
              return (
                <div key={stage.name} className="flex items-center gap-3">
                  <span className="text-xs text-slate-600 dark:text-gray-400 font-medium w-24 shrink-0">{stage.name}</span>
                  <div className="flex-1 h-8 bg-slate-50 dark:bg-white/[0.02] rounded-lg overflow-hidden relative">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${width}%` }} transition={{ duration: 0.6, delay: 0.3 + i * 0.1 }}
                      className="h-full rounded-lg flex items-center px-3"
                      style={{ backgroundColor: stage.fill }}
                    >
                      {stage.value > 0 && <span className="text-[11px] font-bold text-white">{stage.value} {stage.value === 1 ? 'deal' : 'deals'}</span>}
                    </motion.div>
                  </div>
                  <span className="text-xs text-slate-400 dark:text-gray-500 font-medium w-20 text-right">{formatCurrency(stage.dealValue)}</span>
                </div>
              );
            })}
          </div>
        </motion.div>

        {/* Source Breakdown */}
        {sourceData.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            className="bg-white dark:bg-[#111827] border border-slate-100 dark:border-gray-700/50 rounded-2xl p-6"
          >
            <h3 className="text-base font-display font-bold text-slate-900 dark:text-gray-100 mb-1">Origem dos Leads</h3>
            <p className="text-xs text-slate-400 dark:text-gray-500 mb-4">De onde vêm seus contatos</p>
            <div className="flex items-center gap-6">
              <ResponsiveContainer width={150} height={150}>
                <PieChart>
                  <Pie data={sourceData} cx="50%" cy="50%" innerRadius={40} outerRadius={68} paddingAngle={2} dataKey="value">
                    {sourceData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <RechartsTooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {sourceData.map((s) => (
                  <div key={s.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                      <span className="text-xs text-slate-600 dark:text-gray-400">{s.name}</span>
                    </div>
                    <span className="text-xs font-semibold text-slate-800 dark:text-gray-200">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Breakdown */}
        {statusData.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
            className="bg-white dark:bg-[#111827] border border-slate-100 dark:border-gray-700/50 rounded-2xl p-6"
          >
            <h3 className="text-base font-display font-bold text-slate-900 dark:text-gray-100 mb-1">Status dos Contatos</h3>
            <p className="text-xs text-slate-400 dark:text-gray-500 mb-4">Distribuição por etapa do funil de leads</p>
            <div className="space-y-3">
              {statusData.map((s, i) => {
                const maxVal = Math.max(...statusData.map((x) => x.value), 1);
                const pct = (s.value / maxVal) * 100;
                return (
                  <div key={s.name} className="flex items-center gap-3">
                    <span className="text-xs text-slate-600 dark:text-gray-400 font-medium w-24 shrink-0">{s.name}</span>
                    <div className="flex-1 h-6 bg-slate-50 dark:bg-white/[0.02] rounded-lg overflow-hidden">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5, delay: 0.4 + i * 0.08 }}
                        className="h-full rounded-lg flex items-center px-2" style={{ backgroundColor: s.color }}
                      >
                        {s.value > 0 && <span className="text-[10px] font-bold text-white">{s.value}</span>}
                      </motion.div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Activity Breakdown */}
        {activityStats.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
            className="bg-white dark:bg-[#111827] border border-slate-100 dark:border-gray-700/50 rounded-2xl p-6"
          >
            <h3 className="text-base font-display font-bold text-slate-900 dark:text-gray-100 mb-1">Atividades por Tipo</h3>
            <p className="text-xs text-slate-400 dark:text-gray-500 mb-4">Volume de interações registradas</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={activityStats} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#1E293B' : '#F1F5F9'} horizontal={false} />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} />
                <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} width={80} />
                <RechartsTooltip contentStyle={tooltipStyle} />
                <Bar dataKey="value" name="Atividades" radius={[0, 6, 6, 0]} barSize={20}>
                  {activityStats.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// CAMPAIGNS TAB
// ==========================================

const BROADCAST_STATUS_LABELS: Record<BroadcastStatus, { label: string; color: string; bg: string }> = {
  draft: { label: 'Rascunho', color: 'text-gray-600 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-800' },
  scheduled: { label: 'Agendada', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-500/10' },
  sending: { label: 'Enviando', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10' },
  sent: { label: 'Enviada', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
  paused: { label: 'Pausada', color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-500/10' },
  failed: { label: 'Falha', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-500/10' },
};

function CampaignsTab({ businessId }: { businessId: string }) {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewCampaign, setShowNewCampaign] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formChannel, setFormChannel] = useState<'whatsapp' | 'facebook' | 'instagram'>('whatsapp');
  const [formAudienceType, setFormAudienceType] = useState<'all_contacts' | 'tags' | 'manual'>('all_contacts');
  const [formTags, setFormTags] = useState('');
  const [formMessageType, setFormMessageType] = useState<'template' | 'text'>('template');
  const [formTemplateName, setFormTemplateName] = useState('');
  const [formMessageContent, setFormMessageContent] = useState('');
  const [saving, setSaving] = useState(false);

  const { user } = useAuth();

  useEffect(() => {
    if (!businessId) return;
    const q = query(
      collection(db, 'broadcasts'),
      where('businessId', '==', businessId),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      setBroadcasts(snap.docs.map(d => ({ ...d.data(), id: d.id } as Broadcast)));
      setLoading(false);
    });
    return () => unsub();
  }, [businessId]);

  const handleCreateBroadcast = async () => {
    if (!businessId || !user || !formName.trim()) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      await addDoc(collection(db, 'broadcasts'), {
        businessId,
        name: formName.trim(),
        channel: formChannel,
        audienceType: formAudienceType,
        audienceTags: formAudienceType === 'tags' ? formTags.split(',').map(t => t.trim()).filter(Boolean) : [],
        messageType: formMessageType,
        templateName: formMessageType === 'template' ? formTemplateName.trim() : undefined,
        messageContent: formMessageType === 'text' ? formMessageContent.trim() : undefined,
        status: 'draft' as BroadcastStatus,
        stats: { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, replied: 0 },
        createdBy: user.uid,
        createdByName: user.name,
        createdAt: now,
        updatedAt: now,
      });
      toast.success('Campanha criada');
      setShowNewCampaign(false);
      setFormName('');
      setFormMessageContent('');
      setFormTemplateName('');
    } catch (err) {
      console.error('Error creating broadcast:', err);
      toast.error('Erro ao criar campanha');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-24 rounded-2xl shimmer" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 font-display">Campanhas</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">{broadcasts.length} campanha{broadcasts.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowNewCampaign(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-red-600 to-red-500 hover:from-red-700 hover:to-red-600 shadow-lg shadow-red-500/25 transition-all"
        >
          <Plus size={16} />
          Nova Campanha
        </button>
      </div>

      {/* Broadcast List */}
      {broadcasts.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-900/50 rounded-2xl border border-gray-200 dark:border-gray-700/50">
          <Send className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <h4 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-1">Nenhuma campanha</h4>
          <p className="text-xs text-gray-400 dark:text-gray-500">Crie campanhas para enviar mensagens em massa via WhatsApp, Facebook ou Instagram</p>
        </div>
      ) : (
        <div className="space-y-3">
          {broadcasts.map((broadcast) => {
            const statusCfg = BROADCAST_STATUS_LABELS[broadcast.status];
            const deliveryRate = broadcast.stats.total > 0
              ? Math.round((broadcast.stats.delivered / broadcast.stats.total) * 100)
              : 0;
            const readRate = broadcast.stats.delivered > 0
              ? Math.round((broadcast.stats.read / broadcast.stats.delivered) * 100)
              : 0;

            return (
              <motion.div
                key={broadcast.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white dark:bg-gray-900/50 rounded-2xl border border-gray-200 dark:border-gray-700/50 p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{broadcast.name}</h4>
                      <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', statusCfg.bg, statusCfg.color)}>
                        {statusCfg.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400 dark:text-gray-500">
                      <span className="capitalize">{broadcast.channel}</span>
                      <span>·</span>
                      <span>{broadcast.messageType === 'template' ? `Template: ${broadcast.templateName}` : 'Texto'}</span>
                      <span>·</span>
                      <span>{formatDate(broadcast.createdAt)}</span>
                    </div>
                  </div>
                </div>

                {/* Stats bar */}
                {broadcast.stats.total > 0 && (
                  <div className="mt-3 grid grid-cols-4 gap-3">
                    <div>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">Total</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{broadcast.stats.total}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">Enviadas</p>
                      <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{broadcast.stats.sent}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">Entregues</p>
                      <p className="text-sm font-bold text-blue-600 dark:text-blue-400">{deliveryRate}%</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">Lidas</p>
                      <p className="text-sm font-bold text-purple-600 dark:text-purple-400">{readRate}%</p>
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* New Campaign Dialog */}
      <Dialog
        open={showNewCampaign}
        onClose={() => setShowNewCampaign(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: '1rem', bgcolor: 'inherit' } }}
      >
        <DialogTitle sx={{ fontWeight: 700, fontFamily: '"Plus Jakarta Sans", sans-serif' }}>
          Nova Campanha
        </DialogTitle>
        <DialogContent className="space-y-4 !pt-2">
          <TextField
            label="Nome da Campanha"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            fullWidth
            size="small"
          />
          <FormControl fullWidth size="small">
            <InputLabel>Canal</InputLabel>
            <Select
              value={formChannel}
              label="Canal"
              onChange={(e) => setFormChannel(e.target.value as typeof formChannel)}
            >
              <MenuItem value="whatsapp">WhatsApp</MenuItem>
              <MenuItem value="facebook">Facebook Messenger</MenuItem>
              <MenuItem value="instagram">Instagram Direct</MenuItem>
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel>Audiência</InputLabel>
            <Select
              value={formAudienceType}
              label="Audiência"
              onChange={(e) => setFormAudienceType(e.target.value as typeof formAudienceType)}
            >
              <MenuItem value="all_contacts">Todos os contatos</MenuItem>
              <MenuItem value="tags">Por tags</MenuItem>
              <MenuItem value="manual">Seleção manual</MenuItem>
            </Select>
          </FormControl>
          {formAudienceType === 'tags' && (
            <TextField
              label="Tags (separadas por vírgula)"
              value={formTags}
              onChange={(e) => setFormTags(e.target.value)}
              fullWidth
              size="small"
              placeholder="vip, lead-quente, demo"
            />
          )}
          <FormControl fullWidth size="small">
            <InputLabel>Tipo de Mensagem</InputLabel>
            <Select
              value={formMessageType}
              label="Tipo de Mensagem"
              onChange={(e) => setFormMessageType(e.target.value as typeof formMessageType)}
            >
              <MenuItem value="template">Template (WhatsApp)</MenuItem>
              <MenuItem value="text">Texto livre</MenuItem>
            </Select>
          </FormControl>
          {formMessageType === 'template' ? (
            <TextField
              label="Nome do Template"
              value={formTemplateName}
              onChange={(e) => setFormTemplateName(e.target.value)}
              fullWidth
              size="small"
              placeholder="hello_world"
              helperText="Nome do template aprovado no WhatsApp Business"
            />
          ) : (
            <TextField
              label="Conteúdo da Mensagem"
              value={formMessageContent}
              onChange={(e) => setFormMessageContent(e.target.value)}
              fullWidth
              multiline
              rows={3}
              size="small"
            />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setShowNewCampaign(false)}>Cancelar</Button>
          <Button
            onClick={handleCreateBroadcast}
            variant="contained"
            disabled={saving || !formName.trim()}
            sx={{ bgcolor: '#DC2626', '&:hover': { bgcolor: '#B91C1C' }, borderRadius: '0.75rem' }}
          >
            {saving ? 'Criando...' : 'Criar Campanha'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
