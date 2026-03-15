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
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  InputAdornment,
  Tooltip,
  Avatar,
  LinearProgress,
  ToggleButtonGroup,
  ToggleButton,
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
  ChevronDown,
  Edit3,
  Trash2,
  ArrowUpRight,
  ArrowDownRight,
  Users,
  DollarSign,
  TrendingUp,
  Eye,
  MoreVertical,
  Star,
  StarOff,
  Filter,
  Zap,
  Globe,
  Instagram,
  Facebook,
  Linkedin,
  Send,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Link2,
  RefreshCcw,
  Settings,
  ExternalLink,
  PhoneCall,
  Video,
  FileText,
  MessageCircle,
  BarChart3,
  PieChart as PieChartIcon,
  Activity,
  Layers,
  Plug,
  CreditCard,
  Webhook,
  Bot,
  Megaphone,
  ShoppingBag,
  Gauge,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  FunnelChart,
  Funnel,
  LabelList,
} from 'recharts';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate, getInitials } from '@/lib/utils/format';
import type {
  CRMContact,
  CRMDeal,
  CRMPipelineStage,
  CRMActivity,
  CRMActivityType,
  CRMIntegration,
  LeadStatus,
  LeadSource,
  IntegrationStatus,
} from '@/lib/types';

// ==========================================
// PIPELINE STAGES
// ==========================================

const PIPELINE_STAGES: CRMPipelineStage[] = [
  { id: 'prospeccao', name: 'Prospeccao', color: '#8B5CF6', order: 0, probability: 10 },
  { id: 'qualificacao', name: 'Qualificacao', color: '#3B82F6', order: 1, probability: 25 },
  { id: 'proposta', name: 'Proposta', color: '#F59E0B', order: 2, probability: 50 },
  { id: 'negociacao', name: 'Negociacao', color: '#F97316', order: 3, probability: 75 },
  { id: 'fechamento', name: 'Fechamento', color: '#10B981', order: 4, probability: 90 },
];

// ==========================================
// MOCK DATA
// ==========================================

const MOCK_CONTACTS: CRMContact[] = [
  { id: 'ct1', businessId: 'b1', name: 'Ricardo Almeida', email: 'ricardo@techstart.com', phone: '11999001122', whatsapp: '11999001122', company: 'TechStart Solutions', role: 'CEO', source: 'linkedin', status: 'qualificado', score: 85, assignedToName: 'Igor Gomes', tags: ['enterprise', 'saas'], socialMedia: { linkedin: 'ricardoalmeida', instagram: '@techstart' }, lastContactDate: '2026-03-13', createdAt: '2026-02-15', updatedAt: '2026-03-13' },
  { id: 'ct2', businessId: 'b1', name: 'Fernanda Lima', email: 'fernanda@gastrohub.com.br', phone: '21988112233', whatsapp: '21988112233', company: 'GastroHub', role: 'Diretora de Operacoes', source: 'instagram', status: 'proposta', score: 72, assignedToName: 'Ana Silva', tags: ['food-service', 'rede'], lastContactDate: '2026-03-12', createdAt: '2026-01-20', updatedAt: '2026-03-12' },
  { id: 'ct3', businessId: 'b1', name: 'Dr. Marcos Vieira', email: 'marcos@clinicavida.com', phone: '31977334455', company: 'Clinica Vida', role: 'Diretor Clinico', source: 'indicacao', status: 'negociacao', score: 90, assignedToName: 'Igor Gomes', tags: ['saude', 'clinica'], lastContactDate: '2026-03-14', createdAt: '2026-02-01', updatedAt: '2026-03-14' },
  { id: 'ct4', businessId: 'b1', name: 'Camila Rocha', email: 'camila@modaexpress.com', phone: '11966778899', company: 'Moda Express', role: 'Proprietaria', source: 'facebook', status: 'novo', score: 35, tags: ['varejo', 'moda'], createdAt: '2026-03-10', updatedAt: '2026-03-10' },
  { id: 'ct5', businessId: 'b1', name: 'Andre Santos', email: 'andre@edutech.io', phone: '41955667788', whatsapp: '41955667788', company: 'EduTech Academy', role: 'Co-fundador', source: 'google_ads', status: 'contatado', score: 55, assignedToName: 'Carlos Mendes', tags: ['educacao', 'startup'], socialMedia: { linkedin: 'andresantos' }, lastContactDate: '2026-03-11', createdAt: '2026-03-05', updatedAt: '2026-03-11' },
  { id: 'ct6', businessId: 'b1', name: 'Juliana Martins', email: 'juliana@saborecia.com', phone: '11944556677', company: 'Sabor & Cia Restaurantes', role: 'Gerente Geral', source: 'whatsapp', status: 'qualificado', score: 68, assignedToName: 'Ana Silva', tags: ['food-service'], lastContactDate: '2026-03-09', createdAt: '2026-02-25', updatedAt: '2026-03-09' },
  { id: 'ct7', businessId: 'b1', name: 'Felipe Oliveira', email: 'felipe@construtop.com', phone: '51933445566', company: 'ConstruTop', role: 'Diretor Comercial', source: 'evento', status: 'ganho', score: 95, assignedToName: 'Igor Gomes', tags: ['construcao'], lastContactDate: '2026-03-08', createdAt: '2025-12-10', updatedAt: '2026-03-08' },
  { id: 'ct8', businessId: 'b1', name: 'Patricia Souza', email: 'patricia@petworld.com', phone: '11922334455', company: 'PetWorld', role: 'CEO', source: 'site', status: 'perdido', score: 40, assignedToName: 'Carlos Mendes', tags: ['pet', 'varejo'], notes: 'Optou por solucao concorrente', lastContactDate: '2026-02-28', createdAt: '2026-01-15', updatedAt: '2026-02-28' },
  { id: 'ct9', businessId: 'b1', name: 'Roberto Nascimento', email: 'roberto@autotech.com', phone: '31988776655', whatsapp: '31988776655', company: 'AutoTech Pecas', role: 'Proprietario', source: 'telefone', status: 'novo', score: 20, createdAt: '2026-03-13', updatedAt: '2026-03-13' },
  { id: 'ct10', businessId: 'b1', name: 'Isabela Franco', email: 'isabela@beautyspace.com', phone: '11977889900', company: 'Beauty Space', role: 'Diretora', source: 'instagram', status: 'contatado', score: 48, assignedToName: 'Ana Silva', tags: ['beleza', 'franquia'], socialMedia: { instagram: '@beautyspace' }, lastContactDate: '2026-03-12', createdAt: '2026-03-08', updatedAt: '2026-03-12' },
];

const MOCK_DEALS: CRMDeal[] = [
  { id: 'd1', businessId: 'b1', contactId: 'ct1', contactName: 'Ricardo Almeida', title: 'Implantacao ServicePro - TechStart', value: 45000, stage: 'qualificacao', probability: 25, expectedCloseDate: '2026-04-15', businessUnitId: 'bu1', businessUnitName: 'ServicePro', assignedToName: 'Igor Gomes', tags: ['enterprise'], createdAt: '2026-02-20', updatedAt: '2026-03-13' },
  { id: 'd2', businessId: 'b1', contactId: 'ct2', contactName: 'Fernanda Lima', title: 'FoodManager - Rede GastroHub (12 unidades)', value: 96000, stage: 'proposta', probability: 50, expectedCloseDate: '2026-04-01', businessUnitId: 'bu2', businessUnitName: 'FoodManager', assignedToName: 'Ana Silva', tags: ['rede', 'alto-valor'], createdAt: '2026-01-25', updatedAt: '2026-03-12' },
  { id: 'd3', businessId: 'b1', contactId: 'ct3', contactName: 'Dr. Marcos Vieira', title: 'HealthCare+ - Clinica Vida Premium', value: 38000, stage: 'negociacao', probability: 75, expectedCloseDate: '2026-03-25', businessUnitId: 'bu3', businessUnitName: 'HealthCare+', assignedToName: 'Igor Gomes', tags: ['saude'], createdAt: '2026-02-05', updatedAt: '2026-03-14' },
  { id: 'd4', businessId: 'b1', contactId: 'ct5', contactName: 'Andre Santos', title: 'Consultoria EduTech - Plataforma EAD', value: 22000, stage: 'prospeccao', probability: 10, businessUnitId: 'bu5', businessUnitName: 'EduSys', assignedToName: 'Carlos Mendes', createdAt: '2026-03-06', updatedAt: '2026-03-11' },
  { id: 'd5', businessId: 'b1', contactId: 'ct6', contactName: 'Juliana Martins', title: 'FoodManager - Sabor & Cia (3 lojas)', value: 28000, stage: 'qualificacao', probability: 25, expectedCloseDate: '2026-05-01', businessUnitId: 'bu2', businessUnitName: 'FoodManager', assignedToName: 'Ana Silva', createdAt: '2026-03-01', updatedAt: '2026-03-09' },
  { id: 'd6', businessId: 'b1', contactId: 'ct7', contactName: 'Felipe Oliveira', title: 'RetailForce - ConstruTop Full', value: 55000, stage: 'fechamento', probability: 90, expectedCloseDate: '2026-03-20', businessUnitId: 'bu4', businessUnitName: 'RetailForce', assignedToName: 'Igor Gomes', tags: ['enterprise'], createdAt: '2025-12-15', updatedAt: '2026-03-08' },
  { id: 'd7', businessId: 'b1', contactId: 'ct4', contactName: 'Camila Rocha', title: 'RetailForce - Moda Express Starter', value: 12000, stage: 'prospeccao', probability: 10, businessUnitId: 'bu4', businessUnitName: 'RetailForce', createdAt: '2026-03-10', updatedAt: '2026-03-10' },
  { id: 'd8', businessId: 'b1', contactId: 'ct10', contactName: 'Isabela Franco', title: 'ServicePro - Beauty Space (5 unidades)', value: 35000, stage: 'prospeccao', probability: 10, expectedCloseDate: '2026-05-15', businessUnitId: 'bu1', businessUnitName: 'ServicePro', assignedToName: 'Ana Silva', createdAt: '2026-03-08', updatedAt: '2026-03-12' },
];

const MOCK_ACTIVITIES: CRMActivity[] = [
  { id: 'a1', businessId: 'b1', contactId: 'ct3', contactName: 'Dr. Marcos Vieira', dealId: 'd3', dealTitle: 'HealthCare+ - Clinica Vida Premium', type: 'reuniao', title: 'Demo do sistema HealthCare+', description: 'Apresentacao completa do modulo de prontuario eletronico', isCompleted: true, completedAt: '2026-03-14T14:00:00', assignedToName: 'Igor Gomes', duration: 60, createdAt: '2026-03-14', updatedAt: '2026-03-14' },
  { id: 'a2', businessId: 'b1', contactId: 'ct2', contactName: 'Fernanda Lima', dealId: 'd2', dealTitle: 'FoodManager - Rede GastroHub', type: 'proposta', title: 'Envio proposta comercial', description: 'Proposta com desconto para 12 unidades', isCompleted: true, completedAt: '2026-03-13T10:30:00', assignedToName: 'Ana Silva', createdAt: '2026-03-13', updatedAt: '2026-03-13' },
  { id: 'a3', businessId: 'b1', contactId: 'ct1', contactName: 'Ricardo Almeida', type: 'whatsapp', title: 'Follow-up via WhatsApp', description: 'Enviado material sobre integracao com APIs', isCompleted: true, completedAt: '2026-03-13T16:00:00', assignedToName: 'Igor Gomes', createdAt: '2026-03-13', updatedAt: '2026-03-13' },
  { id: 'a4', businessId: 'b1', contactId: 'ct6', contactName: 'Juliana Martins', dealId: 'd5', type: 'ligacao', title: 'Ligacao de qualificacao', description: 'Entender necessidades das 3 lojas', isCompleted: true, completedAt: '2026-03-12T11:00:00', assignedToName: 'Ana Silva', duration: 25, createdAt: '2026-03-12', updatedAt: '2026-03-12' },
  { id: 'a5', businessId: 'b1', contactId: 'ct5', contactName: 'Andre Santos', type: 'email', title: 'E-mail com case de sucesso', description: 'Enviado case da escola XYZ', isCompleted: true, completedAt: '2026-03-11T09:00:00', assignedToName: 'Carlos Mendes', createdAt: '2026-03-11', updatedAt: '2026-03-11' },
  { id: 'a6', businessId: 'b1', contactId: 'ct10', contactName: 'Isabela Franco', type: 'whatsapp', title: 'Primeiro contato via Instagram DM', isCompleted: true, completedAt: '2026-03-10T15:30:00', assignedToName: 'Ana Silva', createdAt: '2026-03-10', updatedAt: '2026-03-10' },
  // Scheduled
  { id: 'a7', businessId: 'b1', contactId: 'ct3', contactName: 'Dr. Marcos Vieira', dealId: 'd3', type: 'reuniao', title: 'Reuniao de fechamento', description: 'Revisar contrato e condicoes finais', scheduledAt: '2026-03-18T10:00:00', isCompleted: false, assignedToName: 'Igor Gomes', duration: 45, createdAt: '2026-03-14', updatedAt: '2026-03-14' },
  { id: 'a8', businessId: 'b1', contactId: 'ct1', contactName: 'Ricardo Almeida', dealId: 'd1', type: 'ligacao', title: 'Call tecnica com CTO', scheduledAt: '2026-03-17T14:00:00', isCompleted: false, assignedToName: 'Igor Gomes', duration: 30, createdAt: '2026-03-13', updatedAt: '2026-03-13' },
  { id: 'a9', businessId: 'b1', contactId: 'ct2', contactName: 'Fernanda Lima', dealId: 'd2', type: 'tarefa', title: 'Preparar POC para GastroHub', description: 'Montar ambiente de testes com cardapio digital', scheduledAt: '2026-03-16T09:00:00', isCompleted: false, assignedToName: 'Ana Silva', createdAt: '2026-03-13', updatedAt: '2026-03-13' },
  { id: 'a10', businessId: 'b1', contactId: 'ct4', contactName: 'Camila Rocha', type: 'whatsapp', title: 'Enviar apresentacao RetailForce', scheduledAt: '2026-03-15T11:00:00', isCompleted: false, createdAt: '2026-03-14', updatedAt: '2026-03-14' },
];

const MOCK_INTEGRATIONS: CRMIntegration[] = [
  { id: 'int1', businessId: 'b1', platform: 'whatsapp', name: 'WhatsApp Business', description: 'Envie e receba mensagens, automatize respostas e capture leads via WhatsApp Business API', status: 'connected', color: '#25D366', category: 'messaging', lastSync: '2026-03-14T10:30:00', features: ['Mensagens automaticas', 'Chatbot', 'Templates', 'Captura de leads', 'Historico de conversas'], createdAt: '', updatedAt: '' },
  { id: 'int2', businessId: 'b1', platform: 'instagram', name: 'Instagram Business', description: 'Gerencie DMs, capture leads de comentarios e stories, integre catalogo de produtos', status: 'connected', color: '#E4405F', category: 'social', lastSync: '2026-03-14T09:15:00', features: ['DM automatizado', 'Lead capture', 'Comentarios', 'Stories', 'Catalogo'], createdAt: '', updatedAt: '' },
  { id: 'int3', businessId: 'b1', platform: 'facebook', name: 'Facebook / Meta', description: 'Lead Ads, Messenger, pagina comercial e pixel de conversao integrados', status: 'connected', color: '#1877F2', category: 'social', lastSync: '2026-03-14T08:00:00', features: ['Lead Ads', 'Messenger Bot', 'Pixel', 'Catalogo', 'Audiences'], createdAt: '', updatedAt: '' },
  { id: 'int4', businessId: 'b1', platform: 'mercadopago', name: 'Mercado Pago', description: 'Processe pagamentos, gere links de cobranca e acompanhe recebimentos em tempo real', status: 'connected', color: '#00B1EA', category: 'payment', lastSync: '2026-03-14T07:00:00', features: ['Checkout Pro', 'Link de pagamento', 'QR Code', 'Split payment', 'Assinaturas'], createdAt: '', updatedAt: '' },
  { id: 'int5', businessId: 'b1', platform: 'gmail', name: 'Gmail / Google Workspace', description: 'Sincronize e-mails, agende reunioes e rastreie aberturas de e-mail automaticamente', status: 'disconnected', color: '#EA4335', category: 'email', features: ['Sync de e-mails', 'Rastreamento', 'Templates', 'Sequencias', 'Agendamento'], createdAt: '', updatedAt: '' },
  { id: 'int6', businessId: 'b1', platform: 'linkedin', name: 'LinkedIn Sales Navigator', description: 'Importe leads, enriqueca dados de contato e acompanhe interacoes profissionais', status: 'disconnected', color: '#0A66C2', category: 'social', features: ['Import leads', 'Enriquecimento', 'InMail', 'Company insights', 'Lead scoring'], createdAt: '', updatedAt: '' },
  { id: 'int7', businessId: 'b1', platform: 'google_calendar', name: 'Google Calendar', description: 'Sincronize agendamentos, envie convites automaticos e evite conflitos de horario', status: 'connected', color: '#4285F4', category: 'calendar', lastSync: '2026-03-14T10:00:00', features: ['Sync bidirecional', 'Convites', 'Disponibilidade', 'Lembretes'], createdAt: '', updatedAt: '' },
  { id: 'int8', businessId: 'b1', platform: 'slack', name: 'Slack', description: 'Receba notificacoes de deals, atividades e alertas do CRM diretamente no Slack', status: 'disconnected', color: '#4A154B', category: 'messaging', features: ['Notificacoes', 'Comandos', 'Alertas', 'Reports'], createdAt: '', updatedAt: '' },
  { id: 'int9', businessId: 'b1', platform: 'stripe', name: 'Stripe', description: 'Gateway de pagamentos internacional com suporte a assinaturas recorrentes e invoices', status: 'disconnected', color: '#635BFF', category: 'payment', features: ['Checkout', 'Subscriptions', 'Invoices', 'Payment Links', 'Webhooks'], createdAt: '', updatedAt: '' },
  { id: 'int10', businessId: 'b1', platform: 'rdstation', name: 'RD Station Marketing', description: 'Automacao de marketing, landing pages, fluxos de nurturing e lead scoring avancado', status: 'pending', color: '#00CF9D', category: 'automation', features: ['Landing pages', 'Email marketing', 'Lead scoring', 'Automacoes', 'Analytics'], createdAt: '', updatedAt: '' },
  { id: 'int11', businessId: 'b1', platform: 'google_ads', name: 'Google Ads', description: 'Importe leads de campanhas, acompanhe ROI e otimize conversoes com dados do CRM', status: 'disconnected', color: '#FBBC04', category: 'analytics', features: ['Lead import', 'Conversion tracking', 'ROAS', 'Audiences', 'Smart bidding'], createdAt: '', updatedAt: '' },
  { id: 'int12', businessId: 'b1', platform: 'zapier', name: 'Zapier', description: 'Conecte com mais de 5.000 apps. Automatize fluxos entre CRM e qualquer ferramenta', status: 'disconnected', color: '#FF4A00', category: 'automation', features: ['5.000+ apps', 'Workflows', 'Triggers', 'Multi-step zaps', 'Webhooks'], createdAt: '', updatedAt: '' },
];

const SOURCE_LABELS: Record<LeadSource, string> = {
  site: 'Site', indicacao: 'Indicacao', whatsapp: 'WhatsApp', instagram: 'Instagram',
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
  proposta: 'Proposta', negociacao: 'Negociacao', ganho: 'Ganho', perdido: 'Perdido',
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

const ACTIVITY_COLORS: Record<CRMActivityType, string> = {
  ligacao: '#F59E0B', email: '#3B82F6', reuniao: '#8B5CF6',
  whatsapp: '#25D366', tarefa: '#10B981', nota: '#6B7280', proposta: '#DC2626',
};

const INTEGRATION_ICONS: Record<string, React.ReactNode> = {
  whatsapp: <MessageCircle size={20} />, instagram: <Instagram size={20} />,
  facebook: <Facebook size={20} />, mercadopago: <CreditCard size={20} />,
  gmail: <Mail size={20} />, linkedin: <Linkedin size={20} />,
  google_calendar: <Calendar size={20} />, slack: <MessageSquare size={20} />,
  stripe: <CreditCard size={20} />, rdstation: <Megaphone size={20} />,
  google_ads: <Megaphone size={20} />, zapier: <Zap size={20} />,
};

type CRMTab = 'pipeline' | 'contatos' | 'atividades' | 'integracoes' | 'metricas';

const TABS: { key: CRMTab; label: string; icon: React.ReactNode }[] = [
  { key: 'pipeline', label: 'Pipeline', icon: <Layers size={16} /> },
  { key: 'contatos', label: 'Contatos', icon: <Users size={16} /> },
  { key: 'atividades', label: 'Atividades', icon: <Activity size={16} /> },
  { key: 'integracoes', label: 'Integracoes', icon: <Plug size={16} /> },
  { key: 'metricas', label: 'Metricas', icon: <BarChart3 size={16} /> },
];

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function CRMModule() {
  const [activeTab, setActiveTab] = useState<CRMTab>('pipeline');
  const [deals, setDeals] = useState<CRMDeal[]>(MOCK_DEALS);
  const [contacts] = useState<CRMContact[]>(MOCK_CONTACTS);
  const [activities] = useState<CRMActivity[]>(MOCK_ACTIVITIES);
  const [integrations] = useState<CRMIntegration[]>(MOCK_INTEGRATIONS);

  // Pipeline metrics
  const pipelineMetrics = useMemo(() => {
    const totalValue = deals.reduce((s, d) => s + d.value, 0);
    const weightedValue = deals.reduce((s, d) => s + d.value * (d.probability / 100), 0);
    const avgDealSize = deals.length > 0 ? totalValue / deals.length : 0;
    const activeDeals = deals.length;
    return { totalValue, weightedValue, avgDealSize, activeDeals };
  }, [deals]);

  return (
    <div className="min-h-screen">
      <div className="max-w-[1440px] mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center shadow-sm shadow-violet-200 dark:shadow-violet-900/30">
              <Target size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-gray-100">CRM</h1>
              <p className="text-sm text-slate-500 dark:text-gray-400">Gestao de relacionamento e vendas</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl text-sm">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-slate-500 dark:text-gray-400">{integrations.filter((i) => i.status === 'connected').length} integracoes ativas</span>
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-violet-600 to-violet-700 text-white rounded-xl font-semibold text-sm shadow-sm shadow-violet-200 dark:shadow-violet-900/30 hover:shadow-md hover:shadow-violet-200 dark:hover:shadow-violet-900/40 transition-all"
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
          <motion.div key={activeTab} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2 }}>
            {activeTab === 'pipeline' && <PipelineTab deals={deals} stages={PIPELINE_STAGES} metrics={pipelineMetrics} />}
            {activeTab === 'contatos' && <ContactsTab contacts={contacts} />}
            {activeTab === 'atividades' && <ActivitiesTab activities={activities} />}
            {activeTab === 'integracoes' && <IntegrationsTab integrations={integrations} />}
            {activeTab === 'metricas' && <MetricsTab deals={deals} contacts={contacts} activities={activities} stages={PIPELINE_STAGES} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ==========================================
// TAB: PIPELINE
// ==========================================

function PipelineTab({ deals, stages, metrics }: { deals: CRMDeal[]; stages: CRMPipelineStage[]; metrics: { totalValue: number; weightedValue: number; avgDealSize: number; activeDeals: number } }) {
  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Pipeline Total', value: formatCurrency(metrics.totalValue), icon: <DollarSign size={18} />, color: 'violet' },
          { label: 'Forecast Ponderado', value: formatCurrency(metrics.weightedValue), icon: <Target size={18} />, color: 'blue' },
          { label: 'Ticket Medio', value: formatCurrency(metrics.avgDealSize), icon: <BarChart3 size={18} />, color: 'amber' },
          { label: 'Deals Ativos', value: String(metrics.activeDeals), icon: <Layers size={18} />, color: 'emerald' },
        ].map((card, i) => {
          const cm: Record<string, { bg: string; txt: string }> = {
            violet: { bg: 'bg-violet-50 dark:bg-violet-500/10', txt: 'text-violet-600 dark:text-violet-400' },
            blue: { bg: 'bg-blue-50 dark:bg-blue-500/10', txt: 'text-blue-600 dark:text-blue-400' },
            amber: { bg: 'bg-amber-50 dark:bg-amber-500/10', txt: 'text-amber-600 dark:text-amber-400' },
            emerald: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', txt: 'text-emerald-600 dark:text-emerald-400' },
          };
          const c = cm[card.color] || cm.violet;
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
                      className="bg-white dark:bg-[#111827] border border-slate-100 dark:border-gray-700/50 rounded-xl p-3.5 hover:shadow-md hover:border-slate-200 dark:hover:border-gray-600 transition-all cursor-pointer group"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <p className="text-sm font-semibold text-slate-800 dark:text-gray-200 leading-tight pr-2">{deal.title}</p>
                        <IconButton size="small" sx={{ opacity: 0, '.group:hover &': { opacity: 1 }, transition: 'opacity 0.15s' }}>
                          <MoreVertical size={14} className="text-slate-400 dark:text-gray-500" />
                        </IconButton>
                      </div>
                      <p className="text-xs text-slate-400 dark:text-gray-500 mb-3">{deal.contactName} {deal.businessUnitName && `· ${deal.businessUnitName}`}</p>

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
                            <span key={tag} className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400">{tag}</span>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  ))}

                  {stageDeals.length === 0 && (
                    <div className="flex items-center justify-center h-24 text-slate-300 dark:text-gray-600">
                      <p className="text-xs">Nenhum deal</p>
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

function ContactsTab({ contacts }: { contacts: CRMContact[] }) {
  const [search, setSearch] = useState('');
  const [filterSource, setFilterSource] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const filtered = useMemo(() => {
    let result = [...contacts];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((c) => c.name.toLowerCase().includes(q) || (c.company && c.company.toLowerCase().includes(q)) || (c.email && c.email.toLowerCase().includes(q)));
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
            className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-white/[0.04] border border-slate-200 dark:border-gray-700/50 rounded-xl text-sm text-slate-900 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20 dark:focus:ring-violet-500/30 focus:border-violet-400 dark:focus:border-violet-500/40 transition-all"
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
                    <Phone size={12} className="text-slate-400 dark:text-gray-500" /> {contact.phone}
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
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: srcColor }} title={SOURCE_LABELS[contact.source]} />
                </div>
                {contact.tags && contact.tags.length > 0 && (
                  <div className="flex gap-1">
                    {contact.tags.slice(0, 2).map((tag) => (
                      <span key={tag} className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-gray-500">
          <Users size={36} strokeWidth={1.5} />
          <p className="mt-3 text-sm">Nenhum contato encontrado</p>
        </div>
      )}
    </div>
  );
}

// ==========================================
// TAB: ATIVIDADES
// ==========================================

function ActivitiesTab({ activities }: { activities: CRMActivity[] }) {
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
  const today = activities.filter((a) => {
    const d = a.scheduledAt || a.completedAt || '';
    return d.startsWith('2026-03-14');
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
          <p className="text-xl font-display font-bold text-violet-600 dark:text-violet-400">{today.length}</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="bg-white dark:bg-[#111827] border border-slate-100 dark:border-gray-700/50 rounded-2xl p-4">
          <p className="text-[11px] text-slate-400 dark:text-gray-500 font-medium mb-1">Concluidas</p>
          <p className="text-xl font-display font-bold text-emerald-600 dark:text-emerald-400">{activities.filter((a) => a.isCompleted).length}</p>
        </motion.div>
      </div>

      {/* Filter */}
      <div className="flex gap-1 p-0.5 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl w-fit">
        {[
          { key: 'all' as const, label: 'Todas' },
          { key: 'pending' as const, label: 'Pendentes' },
          { key: 'completed' as const, label: 'Concluidas' },
        ].map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={cn('px-4 py-1.5 rounded-lg text-xs font-medium transition-all', filter === f.key ? 'bg-slate-900 dark:bg-gray-700 text-white' : 'text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300')}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Timeline */}
      <div className="space-y-3">
        {sorted.map((activity, i) => {
          const actColor = ACTIVITY_COLORS[activity.type];
          const dateStr = activity.completedAt || activity.scheduledAt || activity.createdAt;
          return (
            <motion.div key={activity.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
              className={cn('bg-white dark:bg-[#111827] border rounded-xl p-4 hover:shadow-md transition-all flex gap-4',
                activity.isCompleted ? 'border-slate-100 dark:border-gray-700/50' : 'border-l-4 border-slate-100 dark:border-gray-700/50',
              )}
              style={!activity.isCompleted ? { borderLeftColor: actColor } : undefined}
            >
              {/* Icon */}
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${actColor}15`, color: actColor }}>
                {ACTIVITY_ICONS[activity.type]}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-gray-200">{activity.title}</p>
                    {activity.description && <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">{activity.description}</p>}
                  </div>
                  {activity.isCompleted ? (
                    <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" />
                  ) : (
                    <Clock size={16} className="text-amber-500 shrink-0 mt-0.5" />
                  )}
                </div>

                <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-400 dark:text-gray-500">
                  {activity.contactName && <span className="font-medium text-slate-500 dark:text-gray-400">{activity.contactName}</span>}
                  {activity.dealTitle && <span>· {activity.dealTitle}</span>}
                  <span>· {formatDate(dateStr)}</span>
                  {activity.duration && <span>· {activity.duration}min</span>}
                  {activity.assignedToName && <span>· {activity.assignedToName}</span>}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ==========================================
// TAB: INTEGRACOES
// ==========================================

function IntegrationsTab({ integrations }: { integrations: CRMIntegration[] }) {
  const [filter, setFilter] = useState<string>('all');

  const categories = [
    { key: 'all', label: 'Todas' },
    { key: 'messaging', label: 'Mensagens' },
    { key: 'social', label: 'Redes Sociais' },
    { key: 'payment', label: 'Pagamentos' },
    { key: 'email', label: 'E-mail' },
    { key: 'automation', label: 'Automacao' },
    { key: 'analytics', label: 'Analytics' },
    { key: 'calendar', label: 'Calendario' },
  ];

  const filtered = filter === 'all' ? integrations : integrations.filter((i) => i.category === filter);
  const connected = integrations.filter((i) => i.status === 'connected').length;

  const statusConfig: Record<IntegrationStatus, { label: string; bg: string; text: string; icon: React.ReactNode }> = {
    connected: { label: 'Conectado', bg: '#F0FDF4', text: '#166534', icon: <CheckCircle2 size={12} /> },
    disconnected: { label: 'Desconectado', bg: '#F8FAFC', text: '#64748B', icon: <XCircle size={12} /> },
    error: { label: 'Erro', bg: '#FEF2F2', text: '#991B1B', icon: <AlertCircle size={12} /> },
    pending: { label: 'Configurando', bg: '#FEFCE8', text: '#854D0E', icon: <Clock size={12} /> },
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-slate-900 via-slate-800 to-violet-900 rounded-2xl p-6 text-white"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-display font-bold mb-1">Hub de Integracoes</h3>
            <p className="text-sm text-slate-300">Conecte suas ferramentas favoritas ao CRM. Automatize fluxos e centralize dados.</p>
            <div className="flex items-center gap-4 mt-3">
              <span className="text-xs text-slate-400">{connected} de {integrations.length} conectadas</span>
              <div className="w-32 h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${(connected / integrations.length) * 100}%` }} />
              </div>
            </div>
          </div>
          <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center">
            <Plug size={28} className="text-white/80" />
          </div>
        </div>
      </motion.div>

      {/* Category Filter */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {categories.map((cat) => (
          <button key={cat.key} onClick={() => setFilter(cat.key)}
            className={cn('px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all',
              filter === cat.key ? 'bg-violet-600 text-white' : 'bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 text-slate-500 dark:text-gray-400 hover:border-slate-300 dark:hover:border-gray-600'
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Integration Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((integration, i) => {
          const sc = statusConfig[integration.status];
          return (
            <motion.div key={integration.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className="bg-white dark:bg-[#111827] border border-slate-100 dark:border-gray-700/50 rounded-2xl p-5 hover:shadow-lg hover:border-slate-200 dark:hover:border-gray-600 transition-all group"
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${integration.color}12`, color: integration.color }}>
                    {INTEGRATION_ICONS[integration.platform] || <Globe size={20} />}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800 dark:text-gray-200">{integration.name}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span style={{ color: sc.text }}>{sc.icon}</span>
                      <span className="text-[10px] font-semibold" style={{ color: sc.text }}>{sc.label}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Description */}
              <p className="text-xs text-slate-400 dark:text-gray-500 leading-relaxed mb-3">{integration.description}</p>

              {/* Features */}
              <div className="flex flex-wrap gap-1 mb-4">
                {integration.features.slice(0, 3).map((f) => (
                  <span key={f} className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400">{f}</span>
                ))}
                {integration.features.length > 3 && (
                  <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-gray-800 text-slate-400 dark:text-gray-500">+{integration.features.length - 3}</span>
                )}
              </div>

              {/* Action */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-gray-700/50">
                {integration.lastSync && (
                  <span className="text-[10px] text-slate-400 dark:text-gray-500">Sync: {formatDate(integration.lastSync)}</span>
                )}
                {!integration.lastSync && <span />}
                <button className={cn('text-xs font-semibold px-3 py-1.5 rounded-lg transition-all',
                  integration.status === 'connected'
                    ? 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 hover:bg-slate-200 dark:hover:bg-gray-700'
                    : 'bg-violet-600 text-white hover:bg-violet-700'
                )}>
                  {integration.status === 'connected' ? 'Configurar' : 'Conectar'}
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ==========================================
// TAB: METRICAS
// ==========================================

function MetricsTab({ deals, contacts, activities, stages }: { deals: CRMDeal[]; contacts: CRMContact[]; activities: CRMActivity[]; stages: CRMPipelineStage[] }) {
  // Funnel data
  const funnelData = useMemo(() => {
    return stages.map((stage) => {
      const count = deals.filter((d) => d.stage === stage.id).length;
      const value = deals.filter((d) => d.stage === stage.id).reduce((s, d) => s + d.value, 0);
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

  // Conversion metrics
  const conversionRate = contacts.length > 0
    ? ((contacts.filter((c) => c.status === 'ganho').length / contacts.length) * 100).toFixed(1)
    : '0';
  const avgScore = contacts.length > 0
    ? (contacts.reduce((s, c) => s + c.score, 0) / contacts.length).toFixed(0)
    : '0';
  const avgDealValue = deals.length > 0 ? deals.reduce((s, d) => s + d.value, 0) / deals.length : 0;

  // Monthly performance mock
  const monthlyData = [
    { month: 'Out', leads: 18, deals: 4, conversao: 22 },
    { month: 'Nov', leads: 25, deals: 6, conversao: 24 },
    { month: 'Dez', leads: 22, deals: 5, conversao: 23 },
    { month: 'Jan', leads: 30, deals: 8, conversao: 27 },
    { month: 'Fev', leads: 28, deals: 7, conversao: 25 },
    { month: 'Mar', leads: 35, deals: 10, conversao: 29 },
  ];

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Taxa de Conversao', value: `${conversionRate}%`, icon: <TrendingUp size={18} />, color: 'emerald' },
          { label: 'Lead Score Medio', value: avgScore, icon: <Gauge size={18} />, color: 'amber' },
          { label: 'Total de Leads', value: String(contacts.length), icon: <Users size={18} />, color: 'blue' },
          { label: 'Ticket Medio', value: formatCurrency(avgDealValue), icon: <DollarSign size={18} />, color: 'violet' },
        ].map((card, i) => {
          const cm: Record<string, { bg: string; txt: string }> = {
            emerald: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', txt: 'text-emerald-600 dark:text-emerald-400' },
            amber: { bg: 'bg-amber-50 dark:bg-amber-500/10', txt: 'text-amber-600 dark:text-amber-400' },
            blue: { bg: 'bg-blue-50 dark:bg-blue-500/10', txt: 'text-blue-600 dark:text-blue-400' },
            violet: { bg: 'bg-violet-50 dark:bg-violet-500/10', txt: 'text-violet-600 dark:text-violet-400' },
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
          <p className="text-xs text-slate-400 dark:text-gray-500 mb-4">Distribuicao de deals por estagio</p>
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
                      <span className="text-[11px] font-bold text-white">{stage.value} deals</span>
                    </motion.div>
                  </div>
                  <span className="text-xs text-slate-400 dark:text-gray-500 font-medium w-20 text-right">{formatCurrency(stage.dealValue)}</span>
                </div>
              );
            })}
          </div>
        </motion.div>

        {/* Source Breakdown */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="bg-white dark:bg-[#111827] border border-slate-100 dark:border-gray-700/50 rounded-2xl p-6"
        >
          <h3 className="text-base font-display font-bold text-slate-900 dark:text-gray-100 mb-1">Origem dos Leads</h3>
          <p className="text-xs text-slate-400 dark:text-gray-500 mb-4">De onde vem seus contatos</p>
          <div className="flex items-center gap-6">
            <ResponsiveContainer width={150} height={150}>
              <PieChart>
                <Pie data={sourceData} cx="50%" cy="50%" innerRadius={40} outerRadius={68} paddingAngle={2} dataKey="value">
                  {sourceData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <RechartsTooltip contentStyle={{ borderRadius: '12px', border: '1px solid #E2E8F0' }} />
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
      </div>

      {/* Monthly Performance */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
        className="bg-white dark:bg-[#111827] border border-slate-100 dark:border-gray-700/50 rounded-2xl p-6"
      >
        <h3 className="text-base font-display font-bold text-slate-900 dark:text-gray-100 mb-1">Performance Mensal</h3>
        <p className="text-xs text-slate-400 dark:text-gray-500 mb-4">Evolucao de leads, deals e taxa de conversao</p>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={monthlyData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
            <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 12 }} />
            <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} />
            <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} tickFormatter={(v: number) => `${v}%`} />
            <RechartsTooltip contentStyle={{ borderRadius: '12px', border: '1px solid #E2E8F0' }} />
            <Bar yAxisId="left" dataKey="leads" name="Leads" fill="#8B5CF6" radius={[6, 6, 0, 0]} barSize={18} />
            <Bar yAxisId="left" dataKey="deals" name="Deals Ganhos" fill="#10B981" radius={[6, 6, 0, 0]} barSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </motion.div>
    </div>
  );
}
