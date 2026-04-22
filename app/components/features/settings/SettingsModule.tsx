'use client';

import { useTranslation } from 'react-i18next';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { doc, setDoc, collection, query, where, onSnapshot, updateDoc, getDocs, addDoc, deleteDoc, arrayRemove } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth as firebaseAuth, db, storage } from '@/lib/config/firebase';
import { toast } from 'react-toastify';
import {
  Building2,
  FileText,
  Users,
  Save,
  Loader2,
  Phone,
  Mail,
  MapPin,
  Hash,
  Store,
  Key,
  Shield,
  AlertTriangle,
  CheckCircle,
  Upload,
  Trash2,
  Eye,
  EyeOff,
  DollarSign,
  Receipt,
  X,
  ImagePlus,
  Info,
  Briefcase,
  Copy,
  Check,
  Plus,
  UserPlus,
  Link2,
  Clock,
  RefreshCw,
  Crown,
  Wifi,
  WifiOff,
  User as UserCircle,
  Blocks,
  Plug,
  Zap,
  ToggleLeft,
  ToggleRight,
  ExternalLink,
  Lock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  CreditCard,
  Triangle,
  ChevronLeft,
  ChevronRight,
  Bug,
  Cloud,
  Database,
  Globe,
  MessageCircle,
  Plug2,
  Layers,
  Palette,
  UserMinus,
  Edit3,
  Instagram,
  Facebook,
  Smartphone,
  QrCode,
  Calendar,
  Package,
  Kanban,
  ShoppingBag,
  Sparkles,
  Search,
  Bell,
} from 'lucide-react';
import type { Business, User as UserType, InviteCode, UserRole, UserStatus, IntegrationProvider, IntegrationConfig, IntegrationStatus, EnterpriseSettings, SaasApiKey, ApiKeyScope, Sector, Service, WorkingHours, DaySchedule, UseCase } from '@/lib/types';
import { CachedImage } from '@/app/components/ui/CachedImage';
import { ROLE_LABELS, ROLE_HIERARCHY, USER_STATUS_LABELS, INTEGRATION_PROVIDERS, API_KEY_SCOPES, API_KEY_SCOPE_GROUPS, SECTOR_COLORS, DEFAULT_WORKING_HOURS, USE_CASE_LABELS, USE_CASE_DESCRIPTIONS } from '@/lib/types';
import { formatDate, formatCurrency } from '@/lib/utils/format';
// encryptToken/decryptToken no longer needed — channel credentials handled by Embedded Signup
import {
  validateCNPJ,
  validateCPF,
  validateEmail,
  formatCNPJInput,
  formatCPFInput,
  formatPhoneInput,
  formatCEPInput,
  UF_LIST,
} from '@/lib/utils/validators';

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = 'perfil' | 'empresa' | 'fiscal' | 'usuarios' | 'setores' | 'enterprise' | 'canais' | 'modo' | 'agente' | 'cofre';

interface CertStatus {
  hasCertificate: boolean;
  subject?: string;
  serialNumber?: string;
  expiresAt?: string;
  daysUntilExpiry?: number;
  isExpired?: boolean;
  isExpiringSoon?: boolean;
}

// ─── Shared Sub-components ───────────────────────────────────────────────────

const inputClasses = cn(
  'w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700/50',
  'bg-white dark:bg-white/[0.04] text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
  'focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:focus:ring-red-500/30 focus:border-red-300 dark:focus:border-red-500/40',
  'transition-all duration-200'
);

const selectClasses = cn(
  'w-full h-10 px-3 rounded-xl border text-sm appearance-none cursor-pointer',
  'bg-white dark:bg-white/[0.04] border-gray-200 dark:border-gray-700/50 text-gray-900 dark:text-gray-100',
  'focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:focus:ring-red-500/30 focus:border-red-300 dark:focus:border-red-500/40',
  'transition-all duration-150'
);

function FormField({
  label,
  icon: Icon,
  tooltip,
  children,
  className,
  error,
}: {
  label: string;
  icon?: React.ElementType;
  tooltip?: string;
  children: React.ReactNode;
  className?: string;
  error?: string;
}) {
  return (
    <div className={className}>
      <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        {Icon && <Icon className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />}
        {label}
        {tooltip && (
          <span className="group relative">
            <Info className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 cursor-help" />
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs text-white bg-gray-900 dark:bg-gray-700 rounded-lg whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
              {tooltip}
            </span>
          </span>
        )}
      </label>
      {children}
      {error && <p className="text-xs text-red-500 dark:text-red-400 mt-1">{error}</p>}
    </div>
  );
}

function SectionCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-[#111827] rounded-2xl border border-gray-200 dark:border-gray-700/50 shadow-sm dark:shadow-black/10 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.02]">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Icon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          {title}
        </h3>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function SaveButton({
  onClick,
  loading,
  label = 'Salvar',
  disabled,
  variant = 'primary',
}: {
  onClick?: () => void;
  loading: boolean;
  label?: string;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const isPrimary = variant === 'primary';
  return (
    <button
      type={onClick ? 'button' : 'submit'}
      onClick={onClick}
      disabled={loading || disabled}
      className={cn(
        'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200',
        'disabled:opacity-60 disabled:cursor-not-allowed',
        'focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-[#111827]',
        isPrimary
          ? 'bg-gradient-to-r from-red-600 to-red-500 text-white hover:from-red-700 hover:to-red-600 shadow-lg shadow-red-500/25 focus:ring-red-500/40'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 focus:ring-gray-300 dark:focus:ring-gray-600'
      )}
    >
      {loading ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Salvando...
        </>
      ) : (
        <>
          <Save className="w-4 h-4" />
          {label}
        </>
      )}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERFIL TAB
// ═══════════════════════════════════════════════════════════════════════════════

const STATUS_OPTIONS: { value: UserStatus; label: string; dot: string; text: string; bg: string }[] = [
  { value: 'online',    label: 'Online',    dot: 'bg-emerald-400', text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
  { value: 'busy',      label: 'Ocupado',   dot: 'bg-amber-400',   text: 'text-amber-700 dark:text-amber-400',     bg: 'bg-amber-50 dark:bg-amber-500/10'     },
  { value: 'invisible', label: 'Invisível', dot: 'bg-gray-400',    text: 'text-gray-600 dark:text-gray-400',       bg: 'bg-gray-100 dark:bg-gray-700/40'      },
  { value: 'offline',   label: 'Offline',   dot: 'bg-gray-400',    text: 'text-gray-600 dark:text-gray-400',       bg: 'bg-gray-100 dark:bg-gray-700/40'      },
];

const LANGUAGE_OPTIONS = [
  { value: 'pt-BR', label: 'Português (Brasil)', flag: '🇧🇷' },
  { value: 'en-US', label: 'English (US)',        flag: '🇺🇸' },
];

function ProfileTab() {
  const { t, i18n } = useTranslation();
  const { user, business, updateUserProfile } = useAuth();
  const [isSaving, setIsSaving]                 = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [name, setName]                         = useState('');
  const [phone, setPhone]                       = useState('');
  const [photoPreview, setPhotoPreview]         = useState<string | null>(null);
  const [cep, setCep]                           = useState('');
  const [logradouro, setLogradouro]             = useState('');
  const [numero, setNumero]                     = useState('');
  const [complemento, setComplemento]           = useState('');
  const [bairro, setBairro]                     = useState('');
  const [municipio, setMunicipio]               = useState('');
  const [uf, setUf]                             = useState('');

  // ─── Minha Agenda state ───
  const [isProfessional, setIsProfessional] = useState(true);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [workingHours, setWorkingHours] = useState<WorkingHours>(DEFAULT_WORKING_HOURS);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  // Fetch active services for this business
  const { data: services = [], isLoading: isLoadingServices } = useQuery({
    queryKey: ['services', business?.id],
    queryFn: async () => {
      if (!business?.id) return [];
      const q = query(
        collection(db, 'services'),
        where('businessId', '==', business.id),
        where('isActive', '==', true)
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as Service));
    },
    enabled: !!business?.id,
    staleTime: 5 * 60 * 1000,
  });

  // Time slot options from 06:00 to 22:00 in 30-min intervals
  const timeSlots = useMemo(() => {
    const slots: string[] = [];
    for (let h = 6; h <= 22; h++) {
      slots.push(`${String(h).padStart(2, '0')}:00`);
      if (h < 22) slots.push(`${String(h).padStart(2, '0')}:30`);
    }
    return slots;
  }, []);

  const DAY_NAMES = [
    t('settings.profile.days.sunday',    'Domingo'),
    t('settings.profile.days.monday',    'Segunda'),
    t('settings.profile.days.tuesday',   'Terça'),
    t('settings.profile.days.wednesday', 'Quarta'),
    t('settings.profile.days.thursday',  'Quinta'),
    t('settings.profile.days.friday',    'Sexta'),
    t('settings.profile.days.saturday',  'Sábado'),
  ];

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setPhone(user.phone ? formatPhoneInput(user.phone) : '');
      setPhotoPreview(user.photoURL || null);
      const pa = user.profileAddress;
      if (pa) {
        setCep(pa.cep ? formatCEPInput(pa.cep) : '');
        setLogradouro(pa.logradouro || '');
        setNumero(pa.numero || '');
        setComplemento(pa.complemento || '');
        setBairro(pa.bairro || '');
        setMunicipio(pa.municipio || '');
        setUf(pa.uf || '');
      }
      // Schedule data
      setIsProfessional(user.isProfessional !== false); // default true for backward compat
      setSelectedServiceIds(user.serviceIds || []);
      setWorkingHours(user.workingHours || DEFAULT_WORKING_HOURS);
    }
  }, [user]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (!file.type.startsWith('image/')) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('Foto deve ter no máximo 2MB'); return; }

    setIsUploadingPhoto(true);
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);

    try {
      const storageRef = ref(storage, `users/${user.uid}/avatar`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      setPhotoPreview(url);
      await updateUserProfile({ photoURL: url });
      toast.success('Foto atualizada!');
    } catch {
      toast.error('Erro ao fazer upload da foto');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!user) return;
    setPhotoPreview(null);
    await updateUserProfile({ photoURL: '' });
    toast.success('Foto removida');
  };

  const handleCEPChange = async (value: string) => {
    const formatted = formatCEPInput(value);
    setCep(formatted);
    const cleaned = formatted.replace(/\D/g, '');
    if (cleaned.length === 8) {
      try {
        const res = await fetch(`https://viacep.com.br/ws/${cleaned}/json/`);
        const data = await res.json();
        if (!data.erro) {
          setLogradouro(data.logradouro || '');
          setBairro(data.bairro || '');
          setMunicipio(data.localidade || '');
          setUf(data.uf || '');
        }
      } catch { /* silently fail */ }
    }
  };

  const handleSave = async () => {
    if (!user) return;
    if (!name.trim()) { toast.error('Nome é obrigatório'); return; }
    setIsSaving(true);
    try {
      await updateUserProfile({
        name: name.trim(),
        phone: phone.replace(/\D/g, ''),
        profileAddress: { logradouro, numero, complemento, bairro, municipio, uf, cep: cep.replace(/\D/g, '') },
      });
      toast.success('Perfil atualizado com sucesso!');
    } catch {
      toast.error('Erro ao salvar o perfil');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetStatus = async (status: UserStatus) => {
    await updateUserProfile({ userStatus: status });
  };

  const toggleServiceId = (serviceId: string) => {
    setSelectedServiceIds(prev =>
      prev.includes(serviceId) ? prev.filter(id => id !== serviceId) : [...prev, serviceId]
    );
  };

  const updateDaySchedule = (day: number, field: keyof DaySchedule, value: string | boolean) => {
    setWorkingHours(prev => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }));
  };

  const handleSaveSchedule = async () => {
    if (!user || !business) return;
    setIsSavingSchedule(true);
    try {
      await updateUserProfile({
        isProfessional,
        serviceIds: isProfessional ? selectedServiceIds : [],
        workingHours,
      });

      // Sync to business.settings.openingHours (format expected by AI agent prompt)
      // Converts {[day]: {enabled, start, end}} → [{isOpen, openTime, closeTime}] (7 elements)
      const openingHours = Array.from({ length: 7 }, (_, i) => {
        const day = (workingHours as Record<number, { enabled: boolean; start: string; end: string }>)[i];
        return {
          isOpen: day?.enabled ?? false,
          openTime: day?.start ?? '09:00',
          closeTime: day?.end ?? '18:00',
        };
      });
      await updateDoc(doc(db, 'businesses', business.id), {
        'settings.openingHours': openingHours,
        updatedAt: new Date().toISOString(),
      });

      toast.success(t('settings.profile.scheduleSaved', 'Agenda atualizada com sucesso!'));
    } catch {
      toast.error(t('settings.profile.scheduleError', 'Erro ao salvar a agenda'));
    } finally {
      setIsSavingSchedule(false);
    }
  };

  const currentStatus = (user?.userStatus || 'online') as UserStatus;
  const currentStatusCfg = STATUS_OPTIONS.find(s => s.value === currentStatus) || STATUS_OPTIONS[0];
  const initials = user?.name ? user.name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) : '??';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      className="space-y-6"
    >
      {/* Avatar & Status */}
      <SectionCard title={t('settings.profile.photoTitle', 'Foto de Perfil')} icon={UserCircle}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
          {/* Avatar */}
          <div className="relative group flex-shrink-0">
            <div className="w-24 h-24 rounded-2xl overflow-hidden bg-gradient-to-br from-red-100 to-rose-100 dark:from-red-900/40 dark:to-rose-900/30 border-2 border-red-200/60 dark:border-red-800/40 flex items-center justify-center">
              {photoPreview
                ? <img src={photoPreview} alt="Avatar" className="w-full h-full object-cover" />
                : <span className="text-2xl font-bold text-red-700 dark:text-red-400">{initials}</span>
              }
            </div>
            {isUploadingPhoto && (
              <div className="absolute inset-0 rounded-2xl bg-black/40 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-white animate-spin" />
              </div>
            )}
            {!isUploadingPhoto && (
              <label className="absolute inset-0 rounded-2xl bg-black/0 group-hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 cursor-pointer">
                <ImagePlus className="w-5 h-5 text-white" />
                <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
              </label>
            )}
          </div>

          {/* Info + actions */}
          <div className="flex-1 space-y-3">
            <div>
              <p className="text-base font-semibold text-gray-900 dark:text-gray-100">{user?.name}</p>
              <p className="text-sm text-gray-400 dark:text-gray-500">{user?.email}</p>
              <span className="inline-block mt-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md">
                {ROLE_LABELS[user?.role || 'viewer']}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                Alterar foto
                <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
              </label>
              {photoPreview && (
                <button
                  onClick={handleRemovePhoto}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remover
                </button>
              )}
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Status */}
      <SectionCard title={t('settings.profile.statusTitle', 'Status de Presença')} icon={Wifi}>
        <div className="space-y-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('settings.profile.statusDesc', 'Controle como você aparece para os outros membros da equipe.')}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {STATUS_OPTIONS.map((opt) => {
              const isActive = currentStatus === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => handleSetStatus(opt.value)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all duration-200',
                    isActive
                      ? `${opt.bg} border-current ${opt.text} shadow-sm`
                      : 'border-gray-200 dark:border-gray-700/50 bg-white dark:bg-white/[0.03] text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
                  )}
                >
                  <div className={cn('w-2 h-2 rounded-full flex-shrink-0', opt.dot)} />
                  <span className="text-sm font-medium">{opt.label}</span>
                  {isActive && <Check className="w-3.5 h-3.5 ml-auto" />}
                </button>
              );
            })}
          </div>
          {currentStatus === 'invisible' && (
            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              {t('settings.profile.invisibleWarning', 'No modo invisível, você aparecerá como offline para os outros membros.')}
            </p>
          )}
        </div>
      </SectionCard>

      {/* Language */}
      <SectionCard title={t('settings.profile.languageTitle', 'Idioma')} icon={Globe}>
        <div className="space-y-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('settings.profile.languageDesc', 'Escolha o idioma da interface do sistema.')}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {LANGUAGE_OPTIONS.map((opt) => {
              const isActive = i18n.language === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={async () => {
                    await i18n.changeLanguage(opt.value);
                    await updateUserProfile({ language: opt.value });
                  }}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-200 text-left',
                    isActive
                      ? 'bg-red-50 dark:bg-red-500/10 border-red-300 dark:border-red-500/40 text-red-700 dark:text-red-400 shadow-sm'
                      : 'border-gray-200 dark:border-gray-700/50 bg-white dark:bg-white/[0.03] text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
                  )}
                >
                  <span className="text-xl leading-none">{opt.flag}</span>
                  <span className="text-sm font-medium flex-1">{opt.label}</span>
                  {isActive && <Check className="w-4 h-4 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      </SectionCard>

      {/* Personal Info */}
      <SectionCard title={t('settings.profile.personalInfo', 'Informações Pessoais')} icon={UserCircle}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label={t('settings.profile.fullName', 'Nome completo')} icon={UserCircle}>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('settings.profile.fullNamePlaceholder', 'Seu nome completo')}
              className={inputClasses}
            />
          </FormField>
          <FormField label={t('settings.profile.phone', 'Telefone')} icon={Phone}>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(formatPhoneInput(e.target.value))}
              placeholder="(00) 00000-0000"
              maxLength={15}
              className={inputClasses}
            />
          </FormField>
          <FormField label={t('settings.profile.email', 'E-mail')} icon={Mail} className="md:col-span-2">
            <input
              type="email"
              value={user?.email || ''}
              readOnly
              className={cn(inputClasses, 'bg-gray-50 dark:bg-gray-800/50 cursor-not-allowed opacity-70')}
            />
          </FormField>
        </div>
      </SectionCard>

      {/* Address */}
      <SectionCard title={t('settings.profile.address', 'Endereço')} icon={MapPin}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label={t('settings.profile.zipCode', 'CEP')} tooltip={t('settings.profile.zipTooltip', 'Busca automática do endereço')}>
            <input
              type="text"
              value={cep}
              onChange={e => handleCEPChange(e.target.value)}
              placeholder="00000-000"
              maxLength={9}
              className={inputClasses}
            />
          </FormField>
          <FormField label={t('settings.profile.street', 'Logradouro')}>
            <input type="text" value={logradouro} onChange={e => setLogradouro(e.target.value)} placeholder={t('settings.profile.streetPlaceholder', 'Rua, Avenida, etc.')} className={inputClasses} />
          </FormField>
          <FormField label={t('settings.profile.number', 'Número')}>
            <input type="text" value={numero} onChange={e => setNumero(e.target.value)} placeholder={t('settings.profile.numberPlaceholder', 'Nº')} className={inputClasses} />
          </FormField>
          <FormField label={t('settings.profile.complement', 'Complemento')}>
            <input type="text" value={complemento} onChange={e => setComplemento(e.target.value)} placeholder={t('settings.profile.complementPlaceholder', 'Sala, Andar, etc.')} className={inputClasses} />
          </FormField>
          <FormField label={t('settings.profile.neighborhood', 'Bairro')}>
            <input type="text" value={bairro} onChange={e => setBairro(e.target.value)} placeholder={t('settings.profile.neighborhood', 'Bairro')} className={inputClasses} />
          </FormField>
          <FormField label={t('settings.profile.city', 'Município')}>
            <input type="text" value={municipio} onChange={e => setMunicipio(e.target.value)} placeholder={t('settings.profile.cityPlaceholder', 'Cidade')} className={inputClasses} />
          </FormField>
          <FormField label={t('settings.profile.state', 'UF')}>
            <select value={uf} onChange={e => setUf(e.target.value)} className={selectClasses}>
              <option value="">{t('settings.profile.select', 'Selecione...')}</option>
              {UF_LIST.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </FormField>
        </div>
      </SectionCard>

      {/* ─── Minha Agenda — oculto no modo pedidos ───────────────────────── */}
      {(business?.settings?.useCase ?? 'servicos') !== 'pedidos' && <>

      {/* isProfessional toggle */}
      <SectionCard title={t('settings.profile.professionalTitle', 'Prestador de Serviço')} icon={Briefcase}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {t('settings.profile.isProfessionalLabel', 'Sou prestador de serviço')}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {isProfessional
                ? t('settings.profile.isProfessionalOnDesc', 'Você aparece como opção de profissional na agenda e no agente de IA.')
                : t('settings.profile.isProfessionalOffDesc', 'Você não aparece como opção de profissional para agendamentos.')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsProfessional(v => !v)}
            className={cn(
              'relative w-10 h-[22px] rounded-full transition-all duration-200 flex-shrink-0',
              isProfessional ? 'bg-red-600' : 'bg-gray-300 dark:bg-gray-600'
            )}
          >
            <span className={cn(
              'absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white shadow-sm transition-all duration-200',
              isProfessional ? 'left-[20px]' : 'left-[2px]'
            )} />
          </button>
        </div>
      </SectionCard>

      {/* Services + Hours — only shown when isProfessional */}
      {isProfessional && (
        <>
          {/* Services Selection */}
          <SectionCard title={t('settings.profile.servicesTitle', 'Meus Serviços')} icon={Briefcase}>
            <div className="space-y-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Marque os serviços que você realiza. O agente de IA usará esta lista para apresentar sua agenda aos clientes.
              </p>

              {isLoadingServices ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-[72px] rounded-xl shimmer" />
                  ))}
                </div>
              ) : services.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Briefcase className="w-8 h-8 text-gray-300 dark:text-gray-600 mb-2" />
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('settings.profile.noServices', 'Nenhum serviço cadastrado')}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t('settings.profile.noServicesDesc', 'Cadastre serviços no módulo de Agenda.')}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {services.map(service => {
                    const isSelected = selectedServiceIds.includes(service.id);
                    return (
                      <button
                        key={service.id}
                        type="button"
                        onClick={() => toggleServiceId(service.id)}
                        className={cn(
                          'flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all duration-200',
                          isSelected
                            ? 'border-red-300 dark:border-red-500/40 bg-red-50/60 dark:bg-red-500/10 shadow-sm'
                            : 'border-gray-200 dark:border-gray-700/50 bg-white dark:bg-white/[0.03] hover:border-gray-300 dark:hover:border-gray-600'
                        )}
                      >
                        <div
                          className={cn(
                            'w-5 h-5 rounded-lg border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all duration-200',
                            isSelected
                              ? 'bg-red-600 border-red-600'
                              : 'border-gray-300 dark:border-gray-600'
                          )}
                        >
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={cn(
                            'text-sm font-medium truncate',
                            isSelected ? 'text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'
                          )}>
                            {service.name}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {service.duration}min
                            </span>
                            <span className="text-xs text-gray-300 dark:text-gray-600">·</span>
                            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                              {formatCurrency(service.price)}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </SectionCard>

          {/* Working Hours */}
          <SectionCard title={t('settings.profile.workingHours', 'Horários de Trabalho')} icon={Calendar}>
            <div className="space-y-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('settings.profile.workingHoursDesc', 'Configure seus horários de atendimento por dia. O agente usará esses horários para verificar disponibilidade.')}
              </p>

              <div className="space-y-2">
                {DAY_NAMES.map((dayName, dayIndex) => {
                  const day = workingHours[dayIndex];
                  const isWeekend = dayIndex === 0 || dayIndex === 6;
                  return (
                    <div
                      key={dayIndex}
                      className={cn(
                        'flex flex-col sm:flex-row sm:items-center gap-3 p-3.5 rounded-xl border transition-all duration-200',
                        day.enabled
                          ? 'border-gray-200 dark:border-gray-700/50 bg-white dark:bg-white/[0.03]'
                          : 'border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-white/[0.01]'
                      )}
                    >
                      {/* Day toggle */}
                      <div className="flex items-center gap-3 sm:w-36 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => updateDaySchedule(dayIndex, 'enabled', !day.enabled)}
                          className={cn(
                            'relative w-10 h-[22px] rounded-full transition-all duration-200 flex-shrink-0',
                            day.enabled
                              ? 'bg-red-600'
                              : 'bg-gray-300 dark:bg-gray-600'
                          )}
                        >
                          <span
                            className={cn(
                              'absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white shadow-sm transition-all duration-200',
                              day.enabled ? 'left-[20px]' : 'left-[2px]'
                            )}
                          />
                        </button>
                        <span className={cn(
                          'text-sm font-medium',
                          day.enabled
                            ? 'text-gray-900 dark:text-gray-100'
                            : 'text-gray-400 dark:text-gray-500',
                          isWeekend && 'text-gray-500 dark:text-gray-400'
                        )}>
                          {dayName}
                        </span>
                      </div>

                      {/* Time selects */}
                      {day.enabled ? (
                        <div className="flex items-center gap-2 flex-1">
                          <div className="flex items-center gap-2">
                            <Clock className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 flex-shrink-0 hidden sm:block" />
                            <select
                              value={day.start}
                              onChange={e => updateDaySchedule(dayIndex, 'start', e.target.value)}
                              className={cn(selectClasses, 'w-[110px] h-9 text-xs')}
                            >
                              {timeSlots.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">{t('settings.profile.until', 'até')}</span>
                          <select
                            value={day.end}
                            onChange={e => updateDaySchedule(dayIndex, 'end', e.target.value)}
                            className={cn(selectClasses, 'w-[110px] h-9 text-xs')}
                          >
                            {timeSlots.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400 dark:text-gray-500 italic">
                          {t('settings.profile.unavailable', 'Indisponível')}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </SectionCard>
        </>
      )}

      {/* Save Schedule */}
      <div className="flex justify-end">
        <SaveButton onClick={handleSaveSchedule} loading={isSavingSchedule} label={t('settings.profile.saveSchedule', 'Salvar Agenda')} />
      </div>

      </> /* end Minha Agenda block */}

      {/* Save Profile */}
      <div className="flex justify-end">
        <SaveButton onClick={handleSave} loading={isSaving} label={t('settings.profile.saveProfile', 'Salvar Perfil')} />
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMPRESA TAB
// ═══════════════════════════════════════════════════════════════════════════════

function EmpresaTab() {
  const { t } = useTranslation();
  const { user, business, refreshUser } = useAuth();
  const canEditSettings = ROLE_HIERARCHY[user?.role ?? 'viewer'] >= ROLE_HIERARCHY['admin'];
  const [isSaving, setIsSaving] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Form state
  const [nomeFantasia, setNomeFantasia] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [slug, setSlug] = useState('');
  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const slugTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cnpj, setCnpj] = useState('');
  const [cpf, setCpf] = useState('');
  const [inscricaoEstadual, setInscricaoEstadual] = useState('');
  const [inscricaoMunicipal, setInscricaoMunicipal] = useState('');
  const [companyType, setCompanyType] = useState('mei');
  const [crt, setCrt] = useState('1');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [cep, setCep] = useState('');
  const [logradouro, setLogradouro] = useState('');
  const [numero, setNumero] = useState('');
  const [complemento, setComplemento] = useState('');
  const [bairro, setBairro] = useState('');
  const [municipio, setMunicipio] = useState('');
  const [uf, setUf] = useState('');
  const [codigoMunicipio, setCodigoMunicipio] = useState('');

  // Loyalty program state
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(false);
  const [loyaltyPointsPerReal, setLoyaltyPointsPerReal] = useState('1');
  const [loyaltyPointValueCents, setLoyaltyPointValueCents] = useState('1');
  const [loyaltyMinRedeem, setLoyaltyMinRedeem] = useState('100');
  const [loyaltyExpirationDays, setLoyaltyExpirationDays] = useState('');

  // Populate from business
  useEffect(() => {
    if (business) {
      setNomeFantasia(business.nomeFantasia || '');
      setRazaoSocial(business.razaoSocial || '');
      setSlug(business.slug || '');
      setCnpj(business.cnpj ? formatCNPJInput(business.cnpj) : '');
      setCpf(business.cpf ? formatCPFInput(business.cpf) : '');
      setInscricaoEstadual(business.inscricaoEstadual || '');
      setInscricaoMunicipal(business.inscricaoMunicipal || '');
      setCompanyType(business.companyType || 'mei');
      setCrt(business.crt || '1');
      setPhone(business.phone ? formatPhoneInput(business.phone) : '');
      setEmail(business.email || '');
      setCep(business.endereco?.cep ? formatCEPInput(business.endereco.cep) : '');
      setLogradouro(business.endereco?.logradouro || '');
      setNumero(business.endereco?.numero || '');
      setComplemento(business.endereco?.complemento || '');
      setBairro(business.endereco?.bairro || '');
      setMunicipio(business.endereco?.municipio || '');
      setUf(business.endereco?.uf || '');
      setCodigoMunicipio(business.endereco?.codigoMunicipio || '');
      if (business.logo) setLogoPreview(business.logo);
      // Loyalty
      const lc = business.settings?.loyalty;
      setLoyaltyEnabled(lc?.isEnabled ?? false);
      setLoyaltyPointsPerReal(String(lc?.pointsPerReal ?? 1));
      setLoyaltyPointValueCents(String(lc?.pointValueInCentavos ?? 1));
      setLoyaltyMinRedeem(String(lc?.minPointsToRedeem ?? 100));
      setLoyaltyExpirationDays(lc?.expirationDays ? String(lc.expirationDays) : '');
    }
  }, [business]);

  // CEP auto-lookup
  const handleCEPChange = async (value: string) => {
    const formatted = formatCEPInput(value);
    setCep(formatted);
    setErrors(prev => ({ ...prev, cep: '' }));

    const cleaned = formatted.replace(/\D/g, '');
    if (cleaned.length === 8) {
      try {
        const res = await fetch(`https://viacep.com.br/ws/${cleaned}/json/`);
        const data = await res.json();
        if (!data.erro) {
          setLogradouro(data.logradouro || '');
          setBairro(data.bairro || '');
          setMunicipio(data.localidade || '');
          setUf(data.uf || '');
          if (data.ibge) setCodigoMunicipio(data.ibge);
        }
      } catch {
        // silently fail
      }
    }
  };

  // Logo upload
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !business) return;
    if (!file.type.startsWith('image/')) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t('settings.company.logoMaxSize', 'Logo deve ter no máximo 2MB'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(file);

    try {
      const storageRef = ref(storage, `businesses/${business.id}/logo`);
      await uploadBytes(storageRef, file, { contentType: file.type || 'image/jpeg' });
      const url = await getDownloadURL(storageRef);
      setLogoPreview(url);
      await setDoc(doc(db, 'businesses', business.id), { logo: url, updatedAt: new Date().toISOString() }, { merge: true });
      await refreshUser();
      toast.success(t('settings.company.logoSuccess', 'Logo atualizada!'));
    } catch (err) {
      console.error('[Logo Upload]', err);
      toast.error(t('settings.company.logoError', 'Erro ao fazer upload da logo'));
    }
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!nomeFantasia.trim()) errs.nomeFantasia = t('settings.company.errorTradeName', 'Nome Fantasia é obrigatório');

    const isMEI = companyType === 'mei';
    if (isMEI) {
      if (cpf && !validateCPF(cpf)) errs.cpf = t('settings.company.errorCpf', 'CPF inválido');
    } else {
      if (cnpj && !validateCNPJ(cnpj)) errs.cnpj = t('settings.company.errorCnpj', 'CNPJ inválido');
    }

    if (email && !validateEmail(email)) errs.email = t('settings.company.errorEmail', 'Email inválido');
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || !business || !canEditSettings) return;
    if (slugStatus === 'taken' || slugStatus === 'invalid') {
      toast.error('Corrija o slug antes de salvar.');
      return;
    }

    setIsSaving(true);
    try {
      await setDoc(
        doc(db, 'businesses', business.id),
        {
          nomeFantasia,
          razaoSocial,
          slug: slug.trim() || undefined,
          cnpj: cnpj.replace(/\D/g, ''),
          cpf: cpf.replace(/\D/g, ''),
          inscricaoEstadual,
          inscricaoMunicipal,
          companyType,
          crt,
          phone: phone.replace(/\D/g, ''),
          email,
          endereco: {
            logradouro,
            numero,
            complemento,
            bairro,
            municipio,
            codigoMunicipio,
            uf,
            cep: cep.replace(/\D/g, ''),
          },
          updatedAt: new Date().toISOString(),
          'settings.loyalty': {
            isEnabled: loyaltyEnabled,
            pointsPerReal: Number(loyaltyPointsPerReal) || 1,
            pointValueInCentavos: Number(loyaltyPointValueCents) || 1,
            minPointsToRedeem: Number(loyaltyMinRedeem) || 100,
            expirationDays: loyaltyExpirationDays ? Number(loyaltyExpirationDays) : null,
          },
        },
        { merge: true }
      );

      await refreshUser();
      toast.success(t('settings.company.saveSuccess', 'Dados da empresa salvos com sucesso!'));
    } catch (error) {
      console.error('Error saving:', error);
      toast.error(t('settings.company.saveError', 'Erro ao salvar. Tente novamente.'));
    } finally {
      setIsSaving(false);
    }
  };

  const isMEI = companyType === 'mei' || companyType === 'individual';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
    >
      <form onSubmit={handleSave} className="space-y-6">
        {/* Logo & Type */}
        <SectionCard title={t('settings.company.identification', 'Identificação')} icon={Briefcase}>
          <div className="space-y-5">
            {/* Logo Upload */}
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Logo da Empresa
              </label>
              <div className="flex items-center gap-4">
                {logoPreview ? (
                  <div className="relative group">
                    <div className="w-20 h-20 rounded-xl border border-gray-200 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-800/30 overflow-hidden flex items-center justify-center">
                      <img src={logoPreview} alt="Logo" className="max-w-full max-h-full object-contain" />
                    </div>
                    {canEditSettings && (
                      <button
                        type="button"
                        onClick={async () => { setLogoPreview(null); if (business) { await setDoc(doc(db, 'businesses', business.id), { logo: '', updatedAt: new Date().toISOString() }, { merge: true }); await refreshUser(); } }}
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 dark:bg-red-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ) : canEditSettings ? (
                  <label className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/30 flex flex-col items-center justify-center cursor-pointer hover:border-red-400 dark:hover:border-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors duration-200">
                    <ImagePlus className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">{t('settings.company.upload', 'Upload')}</span>
                    <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                  </label>
                ) : (
                  <div className="w-20 h-20 rounded-xl border border-gray-200 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-800/30 flex items-center justify-center">
                    <Building2 className="w-6 h-6 text-gray-300 dark:text-gray-600" />
                  </div>
                )}
                {canEditSettings && (
                  <p className="text-xs text-gray-400 dark:text-gray-500">{t('settings.company.logoHelp', 'PNG ou JPG, max 2MB.')}</p>
                )}
              </div>
            </div>

            {/* Company Type */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label={t('settings.company.companyType', 'Tipo de Empresa')} icon={Briefcase} tooltip={t('settings.company.companyTypeTooltip', 'Natureza jurídica da empresa')}>
                <select
                  value={companyType}
                  onChange={(e) => setCompanyType(e.target.value)}
                  className={selectClasses}
                  disabled={!canEditSettings}
                >
                  <option value="mei">{t('settings.company.types.mei', 'MEI - Microempreendedor Individual')}</option>
                  <option value="me">{t('settings.company.types.me', 'ME - Microempresa')}</option>
                  <option value="epp">{t('settings.company.types.epp', 'EPP - Empresa de Pequeno Porte')}</option>
                  <option value="individual">{t('settings.company.types.individual', 'Empresário Individual')}</option>
                  <option value="ltda">{t('settings.company.types.ltda', 'LTDA - Sociedade Limitada')}</option>
                  <option value="eireli">{t('settings.company.types.eireli', 'EIRELI')}</option>
                  <option value="sa">{t('settings.company.types.sa', 'S/A - Sociedade Anônima')}</option>
                </select>
              </FormField>

              <FormField label={t('settings.company.crt', 'Regime Tributário (CRT)')} icon={FileText} tooltip={t('settings.company.crtTooltip', 'Código de Regime Tributário')}>
                <select
                  value={crt}
                  onChange={(e) => setCrt(e.target.value)}
                  className={selectClasses}
                  disabled={!canEditSettings}
                >
                  <option value="1">{t('settings.company.crtOptions.1', '1 - Simples Nacional')}</option>
                  <option value="2">{t('settings.company.crtOptions.2', '2 - Simples Nacional - Excesso')}</option>
                  <option value="3">{t('settings.company.crtOptions.3', '3 - Regime Normal (Lucro Presumido/Real)')}</option>
                  <option value="4">{t('settings.company.crtOptions.4', '4 - MEI')}</option>
                </select>
              </FormField>
            </div>
          </div>
        </SectionCard>

        {/* Business Data */}
        <SectionCard title={t('settings.company.dataTitle', 'Dados da Empresa')} icon={Store}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label={t('settings.company.tradeName', 'Nome Fantasia')} icon={Store} error={errors.nomeFantasia}>
              <input
                type="text"
                value={nomeFantasia}
                onChange={(e) => { setNomeFantasia(e.target.value); setErrors(p => ({ ...p, nomeFantasia: '' })); }}
                placeholder={t('settings.company.tradeNamePlaceholder', 'Nome fantasia da empresa')}
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>

            <FormField label={t('settings.company.companyName', 'Razão Social')} icon={Building2}>
              <input
                type="text"
                value={razaoSocial}
                onChange={(e) => setRazaoSocial(e.target.value)}
                placeholder={t('settings.company.companyNamePlaceholder', 'Razão social completa')}
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>

            {isMEI ? (
              <FormField label="CPF" icon={FileText} error={errors.cpf}>
                <input
                  type="text"
                  value={cpf}
                  onChange={(e) => { setCpf(formatCPFInput(e.target.value)); setErrors(p => ({ ...p, cpf: '' })); }}
                  placeholder="000.000.000-00"
                  maxLength={14}
                  className={inputClasses}
                  disabled={!canEditSettings}
                />
              </FormField>
            ) : (
              <FormField label="CNPJ" icon={FileText} error={errors.cnpj}>
                <input
                  type="text"
                  value={cnpj}
                  onChange={(e) => { setCnpj(formatCNPJInput(e.target.value)); setErrors(p => ({ ...p, cnpj: '' })); }}
                  placeholder="00.000.000/0001-00"
                  maxLength={18}
                  className={inputClasses}
                  disabled={!canEditSettings}
                />
              </FormField>
            )}

            <FormField label={t('settings.company.stateRegistration', 'Inscrição Estadual (IE)')} icon={Hash}>
              <input
                type="text"
                value={inscricaoEstadual}
                onChange={(e) => setInscricaoEstadual(e.target.value)}
                placeholder={isMEI ? 'ISENTO' : 'Inscrição Estadual'}
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>

            <FormField label={t('settings.company.municipalRegistration', 'Inscrição Municipal (IM)')} icon={Hash}>
              <input
                type="text"
                value={inscricaoMunicipal}
                onChange={(e) => setInscricaoMunicipal(e.target.value)}
                placeholder={t('settings.company.municipalRegistrationPlaceholder', 'Inscrição Municipal')}
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>
          </div>
        </SectionCard>

        {/* Contact */}
        <SectionCard title={t('settings.company.contact', 'Contato')} icon={Phone}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label={t('settings.profile.phone', 'Telefone')} icon={Phone}>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                placeholder="(00) 00000-0000"
                maxLength={15}
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>

            <FormField label={t('settings.profile.email', 'E-mail')} icon={Mail} error={errors.email}>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setErrors(p => ({ ...p, email: '' })); }}
                placeholder={t('settings.company.emailPlaceholder', 'contato@empresa.com')}
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>
          </div>
        </SectionCard>

        {/* Address */}
        <SectionCard title={t('settings.profile.address', 'Endereço')} icon={MapPin}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label={t('settings.profile.zipCode', 'CEP')} tooltip={t('settings.profile.zipTooltip', 'Busca automática do endereço')} error={errors.cep}>
              <input
                type="text"
                value={cep}
                onChange={(e) => handleCEPChange(e.target.value)}
                placeholder="00000-000"
                maxLength={9}
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>

            <FormField label={t('settings.profile.street', 'Logradouro')}>
              <input
                type="text"
                value={logradouro}
                onChange={(e) => setLogradouro(e.target.value)}
                placeholder={t('settings.profile.streetPlaceholder', 'Rua, Avenida, etc.')}
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>

            <FormField label={t('settings.profile.number', 'Número')}>
              <input
                type="text"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder={t('settings.profile.numberPlaceholder', 'Nº')}
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>

            <FormField label={t('settings.profile.complement', 'Complemento')}>
              <input
                type="text"
                value={complemento}
                onChange={(e) => setComplemento(e.target.value)}
                placeholder={t('settings.profile.complementPlaceholder', 'Sala, Andar, etc.')}
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>

            <FormField label={t('settings.profile.neighborhood', 'Bairro')}>
              <input
                type="text"
                value={bairro}
                onChange={(e) => setBairro(e.target.value)}
                placeholder={t('settings.profile.neighborhood', 'Bairro')}
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>

            <FormField label={t('settings.profile.city', 'Município')}>
              <input
                type="text"
                value={municipio}
                onChange={(e) => setMunicipio(e.target.value)}
                placeholder={t('settings.profile.cityPlaceholder', 'Cidade')}
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>

            <FormField label={t('settings.profile.state', 'UF')}>
              <select
                value={uf}
                onChange={(e) => setUf(e.target.value)}
                className={cn(selectClasses, 'uppercase')}
                disabled={!canEditSettings}
              >
                <option value="">Selecione</option>
                {UF_LIST.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </FormField>

            <FormField label={t('settings.company.ibgeCode', 'Cód. Município IBGE')} tooltip={t('settings.company.ibgeTooltip', 'Preenchido automaticamente pelo CEP')}>
              <input
                type="text"
                value={codigoMunicipio}
                onChange={(e) => setCodigoMunicipio(e.target.value)}
                placeholder="0000000"
                maxLength={7}
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>
          </div>
        </SectionCard>

        {/* Cardápio / Link público */}
        <SectionCard title="Cardápio Online" icon={ExternalLink}>
          <div className="space-y-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Defina um slug curto para o link do cardápio público. Compartilhe com clientes via WhatsApp ou QR Code.
            </p>

            {/* Slug input */}
            <div className="flex items-center gap-2">
              <div className={`flex items-center flex-1 border rounded-lg overflow-hidden transition-colors ${
                slugStatus === 'available' ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-500/5' :
                slugStatus === 'taken' || slugStatus === 'invalid' ? 'border-red-400 bg-red-50/50 dark:bg-red-500/5' :
                'border-gray-200 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-800/50'
              }`}>
                <span className="px-3 py-2 text-sm text-gray-400 border-r border-gray-200 dark:border-gray-700/50 flex-shrink-0 bg-gray-100 dark:bg-gray-800">
                  /p/
                </span>
                <input
                  value={slug}
                  onChange={e => {
                    const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/--+/g, '-');
                    setSlug(val);
                    setSlugStatus('checking');
                    if (slugTimerRef.current) clearTimeout(slugTimerRef.current);
                    if (!val || val.length < 3) { setSlugStatus(val.length > 0 ? 'invalid' : 'idle'); return; }
                    slugTimerRef.current = setTimeout(async () => {
                      try {
                        const res = await fetch(`/api/businesses/check-slug?slug=${encodeURIComponent(val)}&businessId=${business?.id || ''}`);
                        const data = await res.json();
                        setSlugStatus(data.available ? 'available' : data.reason === 'invalid_format' ? 'invalid' : 'taken');
                      } catch { setSlugStatus('idle'); }
                    }, 500);
                  }}
                  placeholder="meu-negocio"
                  disabled={!canEditSettings}
                  className="flex-1 px-3 py-2 bg-transparent text-sm text-gray-900 dark:text-white outline-none placeholder-gray-400 font-mono"
                />
                {/* Status indicator */}
                <div className="pr-2.5">
                  {slugStatus === 'checking' && <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />}
                  {slugStatus === 'available' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                  {(slugStatus === 'taken' || slugStatus === 'invalid') && <X className="w-3.5 h-3.5 text-red-500" />}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const generated = (nomeFantasia || razaoSocial)
                    .toLowerCase()
                    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                    .replace(/[^a-z0-9\s-]/g, '')
                    .trim()
                    .replace(/\s+/g, '-')
                    .slice(0, 40);
                  setSlug(generated);
                  setSlugStatus('checking');
                  if (slugTimerRef.current) clearTimeout(slugTimerRef.current);
                  slugTimerRef.current = setTimeout(async () => {
                    try {
                      const res = await fetch(`/api/businesses/check-slug?slug=${encodeURIComponent(generated)}&businessId=${business?.id || ''}`);
                      const data = await res.json();
                      setSlugStatus(data.available ? 'available' : 'taken');
                    } catch { setSlugStatus('idle'); }
                  }, 400);
                }}
                disabled={!canEditSettings}
                className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 text-sm font-medium transition-colors disabled:opacity-40"
              >
                Gerar
              </button>
            </div>

            {/* Status message */}
            {slugStatus === 'taken' && (
              <p className="text-xs text-red-500 font-medium">Este slug já está em uso. Escolha outro.</p>
            )}
            {slugStatus === 'invalid' && (
              <p className="text-xs text-red-500 font-medium">Mínimo 3 caracteres. Apenas letras, números e hífens.</p>
            )}
            {slugStatus === 'available' && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Disponível!</p>
            )}

            {/* Preview + actions */}
            {slug && slugStatus !== 'taken' && slugStatus !== 'invalid' && (
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 font-mono text-xs text-gray-600 dark:text-gray-400 overflow-hidden">
                  <ExternalLink className="w-3 h-3 text-gray-400 flex-shrink-0" />
                  <span className="truncate">{typeof window !== 'undefined' ? window.location.origin : 'https://seudominio.com'}/p/{slug}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/p/${slug}`);
                    toast.success('Link copiado!');
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copiar
                </button>
                {slug === (business?.slug || '') ? (
                  <a
                    href={`/p/${slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-600 dark:text-gray-400 text-sm font-medium transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Abrir
                  </a>
                ) : (
                  <span className="px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-xs text-gray-400 font-medium">
                    Salve primeiro
                  </span>
                )}
              </div>
            )}

            <p className="text-xs text-gray-400 dark:text-gray-500">
              Apenas letras minúsculas, números e hífens. Salve a empresa para aplicar.
            </p>
          </div>
        </SectionCard>

        {/* Programa de Fidelidade */}
        <SectionCard title="Programa de Fidelidade" icon={DollarSign}>
          <div className="space-y-4">
            {/* Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Ativar programa de fidelidade</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Clientes acumulam pontos a cada compra ou atendimento</p>
              </div>
              <button
                type="button"
                onClick={() => setLoyaltyEnabled(!loyaltyEnabled)}
                disabled={!canEditSettings}
                className={cn(
                  'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none',
                  loyaltyEnabled ? 'bg-red-600' : 'bg-gray-200 dark:bg-gray-700'
                )}
              >
                <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform', loyaltyEnabled ? 'translate-x-6' : 'translate-x-1')} />
              </button>
            </div>

            {loyaltyEnabled && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Pontos por R$1,00 gasto</label>
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={loyaltyPointsPerReal}
                    onChange={e => setLoyaltyPointsPerReal(e.target.value)}
                    disabled={!canEditSettings}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                  <p className="text-[11px] text-gray-400 mt-0.5">Ex: 1 = cliente ganha 1 ponto por real</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Valor do ponto (centavos)</label>
                  <input
                    type="number"
                    min="1"
                    value={loyaltyPointValueCents}
                    onChange={e => setLoyaltyPointValueCents(e.target.value)}
                    disabled={!canEditSettings}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                  <p className="text-[11px] text-gray-400 mt-0.5">Ex: 1 = 1 ponto vale R$0,01</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Mínimo para resgatar (pontos)</label>
                  <input
                    type="number"
                    min="1"
                    value={loyaltyMinRedeem}
                    onChange={e => setLoyaltyMinRedeem(e.target.value)}
                    disabled={!canEditSettings}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Expiração (dias, vazio = nunca)</label>
                  <input
                    type="number"
                    min="1"
                    value={loyaltyExpirationDays}
                    onChange={e => setLoyaltyExpirationDays(e.target.value)}
                    disabled={!canEditSettings}
                    placeholder="Não expira"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              </div>
            )}

            {loyaltyEnabled && (
              <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/30 px-4 py-3">
                <p className="text-xs text-red-700 dark:text-red-400">
                  Resumo: cliente ganha <strong>{loyaltyPointsPerReal} pt</strong>/R$1 e cada ponto vale{' '}
                  <strong>R${(Number(loyaltyPointValueCents) / 100).toFixed(2)}</strong>.
                  Resgate mínimo: <strong>{loyaltyMinRedeem} pts</strong> ={' '}
                  <strong>R${((Number(loyaltyMinRedeem) * Number(loyaltyPointValueCents)) / 100).toFixed(2)}</strong>.
                </p>
              </div>
            )}
          </div>
        </SectionCard>

        {/* Save */}
        {canEditSettings && (
          <div className="flex justify-end pt-2">
            <SaveButton loading={isSaving} label={t('settings.company.saveButton', 'Salvar Dados da Empresa')} />
          </div>
        )}
      </form>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FISCAL TAB
// ═══════════════════════════════════════════════════════════════════════════════

function FiscalTab() {
  const { t } = useTranslation();
  const { user, business, refreshUser } = useAuth();
  const canEditFiscal = ROLE_HIERARCHY[user?.role ?? 'viewer'] >= ROLE_HIERARCHY['admin'];

  // ── Fiscal state ──
  const [environment, setEnvironment] = useState<'homologation' | 'production'>('homologation');
  const [isSavingEnv, setIsSavingEnv] = useState(false);

  const [taxRegime, setTaxRegime] = useState('simples_nacional');
  const [operationType, setOperationType] = useState('saida');
  const [sellsInterstate, setSellsInterstate] = useState(false);
  const [ibgeCode, setIbgeCode] = useState('');
  const [isSavingRegime, setIsSavingRegime] = useState(false);

  const [nfeSeries, setNfeSeries] = useState('1');
  const [nfeNextNumber, setNfeNextNumber] = useState('1');
  const [isSavingNfe, setIsSavingNfe] = useState(false);

  const [nfceSeries, setNfceSeries] = useState('1');
  const [nfceNextNumber, setNfceNextNumber] = useState('1');
  const [cscId, setCscId] = useState('');
  const [cscToken, setCscToken] = useState('');
  const [showCscToken, setShowCscToken] = useState(false);
  const [isSavingNfce, setIsSavingNfce] = useState(false);
  const [isSavingCsc, setIsSavingCsc] = useState(false);

  const [icmsCst, setIcmsCst] = useState('102');
  const [icmsRate, setIcmsRate] = useState('0');
  const [pisCst, setPisCst] = useState('49');
  const [pisRate, setPisRate] = useState('0.65');
  const [cofinsCst, setCofinsCst] = useState('49');
  const [cofinsRate, setCofinsRate] = useState('3');
  const [isSavingTax, setIsSavingTax] = useState(false);

  const [cfopSales, setCfopSales] = useState('5102');
  const [cfopPurchases, setCfopPurchases] = useState('1102');
  const [isSavingCfop, setIsSavingCfop] = useState(false);

  // ── Accounting state ──
  const [accountingEmail, setAccountingEmail] = useState('');
  const [notificationServerUrl, setNotificationServerUrl] = useState('');
  const [notificationServerKey, setNotificationServerKey] = useState('');
  const [isSavingAccounting, setIsSavingAccounting] = useState(false);

  // ── Certificate state ──
  const certFileRef = useRef<HTMLInputElement>(null);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certPassword, setCertPassword] = useState('');
  const [showCertPassword, setShowCertPassword] = useState(false);
  const [isUploadingCert, setIsUploadingCert] = useState(false);

  // Populate from business fiscal config
  useEffect(() => {
    if (!business?.fiscal) return;
    const f = business.fiscal;

    setEnvironment(((f.nfeConfig?.environment || (f as Record<string, unknown>).environment) || 'homologacao') as typeof environment);
    setTaxRegime(f.taxRegime || 'simples_nacional');
    setOperationType(((f as Record<string, unknown>).operationType as string) || 'saida');
    setSellsInterstate(!!((f as Record<string, unknown>).sellsInterstate));
    setIbgeCode(f.ibgeCodigoMunicipio || business.endereco?.codigoMunicipio || '');

    if (f.nfeConfig) {
      setNfeSeries(f.nfeConfig.series || '1');
      setNfeNextNumber(String(f.nfeConfig.nextNumber || 1));
    }
    if (f.nfceConfig) {
      setNfceSeries(f.nfceConfig.series || '1');
      setNfceNextNumber(String(f.nfceConfig.nextNumber || 1));
      // CSC loaded via encrypted API route
      firebaseAuth.currentUser?.getIdToken().then(token => {
        if (!token || !business?.id) return;
        fetch(`/api/fiscal/csc?businessId=${business.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.ok ? r.json() : null).then(data => {
          if (data) { setCscId(data.cscId || ''); setCscToken(data.cscToken || ''); }
        }).catch(() => {
          setCscId(f.nfceConfig?.cscId || '');
        });
      });
    }
    const fAny = f as Record<string, unknown>;
    const taxation = fAny.taxation as Record<string, Record<string, unknown>> | undefined;
    if (taxation) {
      if (taxation.icms) { setIcmsCst(String(taxation.icms.cstCsosn || '102')); setIcmsRate(String(taxation.icms.rate || 0)); }
      if (taxation.pis) { setPisCst(String(taxation.pis.cst || '49')); setPisRate(String(taxation.pis.rate || 0.65)); }
      if (taxation.cofins) { setCofinsCst(String(taxation.cofins.cst || '49')); setCofinsRate(String(taxation.cofins.rate || 3)); }
    }
    const cfops = fAny.cfops as Record<string, string> | undefined;
    if (cfops) {
      setCfopSales(cfops.defaultSales || '5102');
      setCfopPurchases(cfops.defaultPurchases || '1102');
    }
    if (f.accountingEmail) setAccountingEmail(f.accountingEmail);
    if (fAny.notificationServerUrl) setNotificationServerUrl(fAny.notificationServerUrl as string);
    if (fAny.notificationServerKey) setNotificationServerKey(fAny.notificationServerKey as string);
  }, [business]);

  // ── Fiscal save helpers ──
  const saveFiscalField = async (data: Record<string, unknown>) => {
    if (!business) return;
    const currentFiscal = business.fiscal || {};
    await setDoc(
      doc(db, 'businesses', business.id),
      { fiscal: { ...currentFiscal, ...data }, updatedAt: new Date().toISOString() },
      { merge: true }
    );
    await refreshUser();
  };

  const handleSaveEnv = async () => {
    setIsSavingEnv(true);
    try {
      await saveFiscalField({ environment });
      toast.success(t('settings.fiscal.envSaved', 'Ambiente fiscal salvo!'));
    } catch { toast.error(t('settings.fiscal.envError', 'Erro ao salvar ambiente')); }
    finally { setIsSavingEnv(false); }
  };

  const handleSaveRegime = async () => {
    setIsSavingRegime(true);
    try {
      await saveFiscalField({ taxRegime, operationType, sellsInterstate, ibgeCodigoMunicipio: ibgeCode || null });
      toast.success(t('settings.fiscal.regimeSaved', 'Regime e operação salvos!'));
    } catch { toast.error(t('settings.fiscal.regimeError', 'Erro ao salvar regime')); }
    finally { setIsSavingRegime(false); }
  };

  const handleSaveNfe = async () => {
    setIsSavingNfe(true);
    try {
      await saveFiscalField({ nfeConfig: { series: nfeSeries, nextNumber: Number(nfeNextNumber) || 1, environment } });
      toast.success(t('settings.fiscal.nfeSaved', 'Configurações NF-e salvas!'));
    } catch { toast.error(t('settings.fiscal.nfeError', 'Erro ao salvar NF-e')); }
    finally { setIsSavingNfe(false); }
  };

  const handleSaveNfce = async () => {
    setIsSavingNfce(true);
    try {
      await saveFiscalField({
        nfceConfig: {
          series: nfceSeries,
          nextNumber: Number(nfceNextNumber) || 1,
          environment,
        },
      });
      toast.success(t('settings.fiscal.nfceSaved', 'Configurações NFC-e salvas!'));
    } catch { toast.error(t('settings.fiscal.nfceError', 'Erro ao salvar NFC-e')); }
    finally { setIsSavingNfce(false); }
  };

  const handleSaveCsc = async () => {
    setIsSavingCsc(true);
    try {
      const token = await firebaseAuth.currentUser?.getIdToken();
      const res = await fetch('/api/fiscal/csc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ businessId: business?.id, cscId, cscToken }),
      });
      if (!res.ok) throw new Error('Failed to save CSC');
      await refreshUser();
      toast.success(t('settings.fiscal.cscSaved', 'CSC salvo!'));
    } catch { toast.error(t('settings.fiscal.cscError', 'Erro ao salvar CSC')); }
    finally { setIsSavingCsc(false); }
  };

  const handleSaveTax = async () => {
    setIsSavingTax(true);
    try {
      await saveFiscalField({
        taxation: {
          icms: { cstCsosn: icmsCst, rate: Number(icmsRate) || 0 },
          pis: { cst: pisCst, rate: Number(pisRate) || 0 },
          cofins: { cst: cofinsCst, rate: Number(cofinsRate) || 0 },
        },
      });
      toast.success(t('settings.fiscal.taxationSaved', 'Tributação salva!'));
    } catch { toast.error(t('settings.fiscal.taxationError', 'Erro ao salvar tributação')); }
    finally { setIsSavingTax(false); }
  };

  const handleSaveCfop = async () => {
    setIsSavingCfop(true);
    try {
      await saveFiscalField({ cfops: { defaultSales: cfopSales, defaultPurchases: cfopPurchases } });
      toast.success(t('settings.fiscal.cfopsSaved', 'CFOPs salvos!'));
    } catch { toast.error(t('settings.fiscal.cfopsError', 'Erro ao salvar CFOPs')); }
    finally { setIsSavingCfop(false); }
  };

  const handleSaveAccounting = async () => {
    setIsSavingAccounting(true);
    try {
      await saveFiscalField({
        accountingEmail: accountingEmail.trim(),
        notificationServerUrl: notificationServerUrl.trim(),
        notificationServerKey: notificationServerKey.trim(),
      });
      toast.success(t('settings.fiscal.accountingSaved', 'Configurações de contabilidade salvas!'));
    } catch { toast.error(t('settings.fiscal.accountSaveError', 'Erro ao salvar')); }
    finally { setIsSavingAccounting(false); }
  };

  // ── Certificate handlers ──
  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.pfx') && !file.name.endsWith('.p12')) {
      toast.error(t('settings.fiscal.invalidFormat', 'Formato inválido. Envie um arquivo .pfx ou .p12'));
      e.target.value = '';
      return;
    }
    if (file.size > 256 * 1024) {
      toast.error(t('settings.fiscal.certTooLarge', 'Certificado muito grande. Máximo 256KB.'));
      e.target.value = '';
      return;
    }
    setCertFile(file);
    e.target.value = '';
  };

  const handleUploadCert = async () => {
    if (!certFile || !certPassword.trim() || !business) return;
    setIsUploadingCert(true);
    try {
      const { getAuth } = await import('firebase/auth');
      const token = await getAuth().currentUser?.getIdToken();
      if (!token) throw new Error('Sessão expirada — faça login novamente');

      // Server-side upload — parses PFX + validates password + encrypts + persists
      const form = new FormData();
      form.append('file', certFile);
      form.append('password', certPassword);
      form.append('businessId', business.id);

      const resp = await fetch('/api/fiscal/certificate/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) {
        throw new Error(json.error || 'Falha ao enviar certificado');
      }

      const daysLeft = json.daysUntilExpiry as number | undefined;
      if (typeof daysLeft === 'number' && daysLeft <= 30) {
        toast.warning(`Certificado enviado, mas expira em ${daysLeft} dias. Considere renovar em breve.`);
      } else {
        toast.success(t('settings.fiscal.certUploadSuccess', 'Certificado digital enviado e validado!'));
      }
      setCertFile(null);
      setCertPassword('');
      // Force a refresh of the business doc so the new certificate info renders
      window.location.reload();
    } catch (error) {
      console.error('Error uploading cert:', error);
      toast.error(error instanceof Error ? error.message : t('settings.fiscal.certUploadError', 'Erro ao enviar certificado'));
    } finally {
      setIsUploadingCert(false);
    }
  };

  const handleDeleteCert = async () => {
    if (!business) return;
    if (!confirm('Tem certeza que deseja remover o certificado digital?')) return;
    try {
      const { getAuth } = await import('firebase/auth');
      const token = await getAuth().currentUser?.getIdToken();
      if (!token) throw new Error('Sessão expirada');
      const resp = await fetch('/api/fiscal/certificate/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ businessId: business.id }),
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) throw new Error(json.error || 'Falha ao remover');
      toast.success('Certificado removido!');
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover certificado');
    }
  };

  // ── CST/CSOSN options ──
  const isSimples = taxRegime === 'simples_nacional' || taxRegime === 'simples_nacional_excesso';

  const icmsCstOptions = isSimples
    ? [
        { value: '101', label: '101 - Tributada com permissão de crédito' },
        { value: '102', label: '102 - Tributada sem permissão de crédito' },
        { value: '103', label: '103 - Isenção do ICMS' },
        { value: '201', label: '201 - Com crédito e ST' },
        { value: '202', label: '202 - Sem crédito e ST' },
        { value: '300', label: '300 - Imune' },
        { value: '400', label: '400 - Não tributada' },
        { value: '500', label: '500 - ICMS cobrado por ST' },
        { value: '900', label: '900 - Outros' },
      ]
    : [
        { value: '00', label: '00 - Tributada integralmente' },
        { value: '10', label: '10 - Tributada com ST' },
        { value: '20', label: '20 - Com redução de base' },
        { value: '30', label: '30 - Isenta/Não tributada com ST' },
        { value: '40', label: '40 - Isenta' },
        { value: '41', label: '41 - Não tributada' },
        { value: '50', label: '50 - Suspensão' },
        { value: '60', label: '60 - ICMS cobrado anteriormente por ST' },
        { value: '90', label: '90 - Outros' },
      ];

  const pisCofinsOptions = [
    { value: '01', label: '01 - Tributável (BC = valor x alíquota)' },
    { value: '02', label: '02 - Tributável (BC = valor x qtd)' },
    { value: '04', label: '04 - Monofásica' },
    { value: '06', label: '06 - Alíquota zero' },
    { value: '07', label: '07 - Isenta' },
    { value: '08', label: '08 - Sem incidência' },
    { value: '09', label: '09 - Com suspensão' },
    { value: '49', label: '49 - Outras operações de saída' },
    { value: '99', label: '99 - Outras operações' },
  ];

  // ── Certificate info ──
  const certInfo = business?.fiscal?.certificate;
  const hasCert = !!certInfo;
  const certDaysRemaining = certInfo?.expiresAt
    ? Math.ceil((new Date(certInfo.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : 0;

  return (
    <motion.div
      key="fiscal"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      className="space-y-6"
    >
      {/* ── Certificate ── */}
      <SectionCard title={t('settings.fiscal.certificateTitle', 'Certificado Digital A1')} icon={Key}>
        {hasCert ? (
          <div className="space-y-4">
            <div className={cn(
              'p-4 rounded-xl flex items-start gap-4',
              certDaysRemaining <= 0
                ? 'bg-red-50 dark:bg-red-900/20'
                : certDaysRemaining <= 30
                ? 'bg-amber-50 dark:bg-amber-900/20'
                : 'bg-emerald-50 dark:bg-emerald-900/20',
            )}>
              {certDaysRemaining <= 0 ? (
                <AlertTriangle className="h-6 w-6 text-red-500 dark:text-red-400 flex-shrink-0" />
              ) : certDaysRemaining <= 30 ? (
                <AlertTriangle className="h-6 w-6 text-amber-500 flex-shrink-0" />
              ) : (
                <CheckCircle className="h-6 w-6 text-emerald-500 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={cn(
                    'font-medium',
                    certDaysRemaining <= 0 ? 'text-red-600 dark:text-red-400' : certDaysRemaining <= 30 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400',
                  )}>
                    {certDaysRemaining <= 0 ? 'Certificado Expirado' : 'Certificado Válido'}
                  </p>
                  <span className={cn(
                    'text-xs font-medium px-2 py-0.5 rounded-full',
                    certDaysRemaining <= 0
                      ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                      : certDaysRemaining <= 30
                      ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                      : 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
                  )}>
                    {certDaysRemaining <= 0 ? 'Expirado' : certDaysRemaining <= 30 ? `Expira em ${certDaysRemaining} dias` : 'Válido'}
                  </span>
                </div>
                {certInfo?.subject && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 truncate">{certInfo.subject}</p>
                )}
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Expira em: {new Date(certInfo!.expiresAt).toLocaleDateString('pt-BR')}
                </p>
              </div>
              {canEditFiscal && (
                <button
                  onClick={handleDeleteCert}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                  Remover
                </button>
              )}
            </div>
            {canEditFiscal && (
              <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">Substituir certificado</p>
                <CertificateUploadInline
                  fileRef={certFileRef}
                  certFile={certFile}
                  certPassword={certPassword}
                  showPassword={showCertPassword}
                  uploading={isUploadingCert}
                  onPickFile={() => certFileRef.current?.click()}
                  onFileChange={handleFileSelected}
                  onPasswordChange={setCertPassword}
                  onTogglePassword={() => setShowCertPassword(v => !v)}
                  onSubmit={handleUploadCert}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="border-2 border-dashed border-gray-200 dark:border-gray-700/50 rounded-xl p-6 text-center">
              <Upload className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <h3 className="font-medium text-gray-900 dark:text-gray-100">{t('settings.fiscal.noCert', 'Nenhum certificado cadastrado')}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('settings.fiscal.uploadInstruction', 'Faça upload do seu certificado A1 (.pfx ou .p12)')}</p>
            </div>
            {canEditFiscal && (
              <CertificateUploadInline
                fileRef={certFileRef}
                certFile={certFile}
                certPassword={certPassword}
                showPassword={showCertPassword}
                uploading={isUploadingCert}
                onPickFile={() => certFileRef.current?.click()}
                onFileChange={handleFileSelected}
                onPasswordChange={setCertPassword}
                onTogglePassword={() => setShowCertPassword(v => !v)}
                onSubmit={handleUploadCert}
              />
            )}
          </div>
        )}
      </SectionCard>

      {/* ── Emission Environment ── */}
      <SectionCard title={t('settings.fiscal.environmentTitle', 'Ambiente de Emissão')} icon={Shield}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 max-w-sm">
            {([
              { value: 'homologation' as const, label: 'Homologação', desc: 'Ambiente de testes' },
              { value: 'production' as const, label: 'Produção', desc: 'Notas reais' },
            ]).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => canEditFiscal && setEnvironment(opt.value)}
                className={cn(
                  'p-4 rounded-xl border-2 text-center transition-all',
                  environment === opt.value
                    ? opt.value === 'homologation'
                      ? 'border-amber-400 dark:border-amber-500/50 bg-amber-50 dark:bg-amber-900/20'
                      : 'border-emerald-400 dark:border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-900/20'
                    : 'border-gray-200 dark:border-gray-700/50 hover:border-gray-300 dark:hover:border-gray-600',
                )}
              >
                <p className="font-semibold text-gray-900 dark:text-gray-100">{opt.label}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{opt.desc}</p>
              </button>
            ))}
          </div>
          {environment === 'production' && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-xl flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-500 dark:text-red-400 flex-shrink-0" />
              <div>
                <p className="font-medium text-red-600 dark:text-red-400">{t('settings.fiscal.attention', 'Atenção!')}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Em produção, todas as notas têm validade fiscal e efeito legal perante a SEFAZ.
                </p>
              </div>
            </div>
          )}
          {canEditFiscal && (
            <div className="flex justify-end">
              <SaveButton onClick={handleSaveEnv} loading={isSavingEnv} label={t('settings.fiscal.saveEnv', 'Salvar Ambiente')} variant="secondary" />
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── Tax Regime ── */}
      <SectionCard title={t('settings.fiscal.regimeTitle', 'Regime e Operação')} icon={Building2}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label={t('settings.fiscal.taxRegime', 'Regime Tributário')} tooltip={t('settings.fiscal.taxRegimeTooltip', 'Regime fiscal da empresa')}>
              <select value={taxRegime} onChange={(e) => setTaxRegime(e.target.value)} className={selectClasses} disabled={!canEditFiscal}>
                <option value="simples_nacional">{t('settings.fiscal.regimeSimples', 'Simples Nacional')}</option>
                <option value="simples_nacional_excesso">{t('settings.fiscal.regimeSimplesExcess', 'Simples Nacional — Excesso')}</option>
                <option value="lucro_presumido">{t('settings.fiscal.regimeLucroPresumido', 'Lucro Presumido')}</option>
                <option value="lucro_real">{t('settings.fiscal.regimeLucroReal', 'Lucro Real')}</option>
              </select>
            </FormField>
            <FormField label={t('settings.fiscal.operationType', 'Tipo de Operação')} tooltip={t('settings.fiscal.opTypeTooltip', 'Tipo principal de operação')}>
              <select value={operationType} onChange={(e) => setOperationType(e.target.value)} className={selectClasses} disabled={!canEditFiscal}>
                <option value="saida">{t('settings.fiscal.opOutput', 'Saída (venda)')}</option>
                <option value="entrada">{t('settings.fiscal.opInput', 'Entrada (compra)')}</option>
              </select>
            </FormField>
            <FormField label={t('settings.fiscal.interstate', 'Vende Interestadual?')} tooltip={t('settings.fiscal.interstateTooltip', 'Se vende para outros estados')}>
              <select value={sellsInterstate ? 'true' : 'false'} onChange={(e) => setSellsInterstate(e.target.value === 'true')} className={selectClasses} disabled={!canEditFiscal}>
                <option value="false">Não</option>
                <option value="true">Sim</option>
              </select>
            </FormField>
            <FormField label={t('settings.fiscal.ibgeCode', 'Cód. IBGE Município')} tooltip={t('settings.fiscal.ibgeCodeTooltip', 'Código IBGE de 7 dígitos')}>
              <input value={ibgeCode} onChange={(e) => setIbgeCode(e.target.value)} placeholder="3550308" maxLength={7} className={inputClasses} disabled={!canEditFiscal} />
            </FormField>
          </div>
          {canEditFiscal && (
            <div className="flex justify-end">
              <SaveButton onClick={handleSaveRegime} loading={isSavingRegime} label={t('settings.fiscal.saveRegime', 'Salvar Regime')} variant="secondary" />
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── CSC NFC-e ── */}
      <SectionCard title={t('settings.fiscal.cscTitle', 'CSC — NFC-e')} icon={Shield}>
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            O CSC (Código de Segurança do Contribuinte) é gerado na SEFAZ estadual e obrigatório para emissão de NFC-e.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label={t('settings.fiscal.cscId', 'ID do CSC')} tooltip={t('settings.fiscal.cscIdTooltip', 'Identificador fornecido pela SEFAZ')}>
              <input value={cscId} onChange={(e) => setCscId(e.target.value)} placeholder="000001" className={inputClasses} disabled={!canEditFiscal} />
            </FormField>
            <FormField label={t('settings.fiscal.cscToken', 'Token do CSC')} tooltip={t('settings.fiscal.cscTokenTooltip', 'Token fornecido pela SEFAZ')}>
              <div className="relative">
                <input
                  type={showCscToken ? 'text' : 'password'}
                  value={cscToken}
                  onChange={(e) => setCscToken(e.target.value)}
                  placeholder="CF7E8B8C..."
                  className={cn(inputClasses, 'pr-10')}
                  disabled={!canEditFiscal}
                />
                <button
                  type="button"
                  onClick={() => setShowCscToken(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  tabIndex={-1}
                >
                  {showCscToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </FormField>
          </div>
          {canEditFiscal && (
            <div className="flex justify-end">
              <SaveButton onClick={handleSaveCsc} loading={isSavingCsc} label={t('settings.fiscal.saveCsc', 'Salvar CSC')} variant="secondary" disabled={!cscId.trim() || !cscToken.trim()} />
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── Series & Numbering ── */}
      <SectionCard title={t('settings.fiscal.seriesTitle', 'Séries e Numeração')} icon={Receipt}>
        <div className="space-y-6">
          {/* NF-e */}
          <div>
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">NF-e</p>
            <div className="grid grid-cols-2 gap-4 max-w-sm mb-3">
              <FormField label={t('settings.fiscal.series', 'Série')} tooltip={t('settings.fiscal.nfeSeriesTooltip', 'Série da NF-e (geralmente 1)')}>
                <input value={nfeSeries} onChange={(e) => setNfeSeries(e.target.value)} className={inputClasses} disabled={!canEditFiscal} />
              </FormField>
              <FormField label={t('settings.fiscal.nextNumber', 'Próximo Nº')} tooltip={t('settings.fiscal.nfeNextTooltip', 'Número da próxima NF-e')}>
                <input type="number" min={1} value={nfeNextNumber} onChange={(e) => setNfeNextNumber(e.target.value)} className={inputClasses} disabled={!canEditFiscal} />
              </FormField>
            </div>
            {canEditFiscal && (
              <div className="flex justify-end">
                <SaveButton onClick={handleSaveNfe} loading={isSavingNfe} label={t('settings.fiscal.saveNfe', 'Salvar NF-e')} variant="secondary" />
              </div>
            )}
          </div>

          <hr className="border-gray-100 dark:border-gray-800" />

          {/* NFC-e */}
          <div>
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">NFC-e</p>
            <div className="grid grid-cols-2 gap-4 max-w-sm mb-3">
              <FormField label={t('settings.fiscal.series', 'Série')} tooltip={t('settings.fiscal.nfceSeriesTooltip', 'Série da NFC-e (geralmente 1)')}>
                <input value={nfceSeries} onChange={(e) => setNfceSeries(e.target.value)} className={inputClasses} disabled={!canEditFiscal} />
              </FormField>
              <FormField label={t('settings.fiscal.nextNumber', 'Próximo Nº')} tooltip={t('settings.fiscal.nfceNextTooltip', 'Número da próxima NFC-e')}>
                <input type="number" min={1} value={nfceNextNumber} onChange={(e) => setNfceNextNumber(e.target.value)} className={inputClasses} disabled={!canEditFiscal} />
              </FormField>
            </div>
            {canEditFiscal && (
              <div className="flex justify-end">
                <SaveButton onClick={handleSaveNfce} loading={isSavingNfce} label={t('settings.fiscal.saveNfce', 'Salvar NFC-e')} variant="secondary" />
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      {/* ── Default Taxation ── */}
      <SectionCard title={t('settings.fiscal.taxationTitle', 'Tributação Padrão')} icon={DollarSign}>
        <div className="space-y-5">
          {/* ICMS */}
          <div>
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">ICMS</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label={isSimples ? 'CSOSN' : 'CST ICMS'} tooltip={t('settings.fiscal.cstIcmsTooltip', 'Código de Situação Tributária do ICMS')}>
                <select value={icmsCst} onChange={(e) => setIcmsCst(e.target.value)} className={selectClasses} disabled={!canEditFiscal}>
                  {icmsCstOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </FormField>
              <FormField label={t('settings.fiscal.icmsRate', 'Alíquota ICMS (%)')} tooltip={t('settings.fiscal.icmsRateTooltip', 'Percentual de ICMS padrão')}>
                <input type="number" step="0.01" min={0} value={icmsRate} onChange={(e) => setIcmsRate(e.target.value)} className={inputClasses} disabled={!canEditFiscal} />
              </FormField>
            </div>
          </div>
          {/* PIS */}
          <div>
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">PIS</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label={t('settings.fiscal.cstPis', 'CST PIS')} tooltip={t('settings.fiscal.cstPisTooltip', 'Código de Situação Tributária do PIS')}>
                <select value={pisCst} onChange={(e) => setPisCst(e.target.value)} className={selectClasses} disabled={!canEditFiscal}>
                  {pisCofinsOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </FormField>
              <FormField label={t('settings.fiscal.pisRate', 'Alíquota PIS (%)')} tooltip={t('settings.fiscal.pisRateTooltip', 'Percentual de PIS padrão')}>
                <input type="number" step="0.01" min={0} value={pisRate} onChange={(e) => setPisRate(e.target.value)} className={inputClasses} disabled={!canEditFiscal} />
              </FormField>
            </div>
          </div>
          {/* COFINS */}
          <div>
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">COFINS</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label={t('settings.fiscal.cstCofins', 'CST COFINS')} tooltip={t('settings.fiscal.cstCofinsTooltip', 'Código de Situação Tributária do COFINS')}>
                <select value={cofinsCst} onChange={(e) => setCofinsCst(e.target.value)} className={selectClasses} disabled={!canEditFiscal}>
                  {pisCofinsOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </FormField>
              <FormField label={t('settings.fiscal.cofinsRate', 'Alíquota COFINS (%)')} tooltip={t('settings.fiscal.cofinsRateTooltip', 'Percentual de COFINS padrão')}>
                <input type="number" step="0.01" min={0} value={cofinsRate} onChange={(e) => setCofinsRate(e.target.value)} className={inputClasses} disabled={!canEditFiscal} />
              </FormField>
            </div>
          </div>
          {canEditFiscal && (
            <div className="flex justify-end">
              <SaveButton onClick={handleSaveTax} loading={isSavingTax} label={t('settings.fiscal.saveTaxation', 'Salvar Tributação')} />
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── Default CFOPs ── */}
      <SectionCard title={t('settings.fiscal.cfopTitle', 'CFOPs Padrão')} icon={FileText}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label={t('settings.fiscal.cfopSales', 'CFOP Venda')} tooltip={t('settings.fiscal.cfopSalesTooltip', 'CFOP padrão para operações de saída')}>
              <input value={cfopSales} onChange={(e) => setCfopSales(e.target.value)} placeholder="5102" className={inputClasses} disabled={!canEditFiscal} />
            </FormField>
            <FormField label={t('settings.fiscal.cfopPurchases', 'CFOP Compra')} tooltip={t('settings.fiscal.cfopPurchasesTooltip', 'CFOP padrão para operações de entrada')}>
              <input value={cfopPurchases} onChange={(e) => setCfopPurchases(e.target.value)} placeholder="1102" className={inputClasses} disabled={!canEditFiscal} />
            </FormField>
          </div>
          {canEditFiscal && (
            <div className="flex justify-end">
              <SaveButton onClick={handleSaveCfop} loading={isSavingCfop} label={t('settings.fiscal.saveCfops', 'Salvar CFOPs')} variant="secondary" />
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── Contabilidade ── */}
      <SectionCard title={t('settings.fiscal.accountingTitle', 'Contabilidade')} icon={FileText}>
        <div className="space-y-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Configure o envio automatico de XMLs e SPED para seu contador.
          </p>
          <div className="grid grid-cols-1 gap-4">
            <FormField label={t('settings.fiscal.accountantEmail', 'Email do Contador')} tooltip={t('settings.fiscal.accountantEmailTooltip', 'Email para envio dos documentos fiscais')}>
              <input
                type="email"
                value={accountingEmail}
                onChange={(e) => setAccountingEmail(e.target.value)}
                placeholder="contador@escritorio.com.br"
                className={inputClasses}
                disabled={!canEditFiscal}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label={t('settings.fiscal.webhookUrl', 'URL Servidor de Notificação')} tooltip={t('settings.fiscal.webhookUrlTooltip', 'URL da API de envio de emails')}>
              <input
                value={notificationServerUrl}
                onChange={(e) => setNotificationServerUrl(e.target.value)}
                placeholder="https://notification.example.com"
                className={inputClasses}
                disabled={!canEditFiscal}
              />
            </FormField>
            <FormField label={t('settings.fiscal.webhookKey', 'API Key Notificação')} tooltip={t('settings.fiscal.webhookKeyTooltip', 'Chave de autenticação do servidor')}>
              <input
                type="password"
                value={notificationServerKey}
                onChange={(e) => setNotificationServerKey(e.target.value)}
                placeholder="API key..."
                className={inputClasses}
                disabled={!canEditFiscal}
              />
            </FormField>
          </div>
          {canEditFiscal && (
            <div className="flex justify-end">
              <SaveButton onClick={handleSaveAccounting} loading={isSavingAccounting} label={t('settings.fiscal.saveAccounting', 'Salvar Contabilidade')} variant="secondary" />
            </div>
          )}
        </div>
      </SectionCard>
    </motion.div>
  );
}

// Certificate Upload Inline Component
function CertificateUploadInline({
  fileRef,
  certFile,
  certPassword,
  showPassword,
  uploading,
  onPickFile,
  onFileChange,
  onPasswordChange,
  onTogglePassword,
  onSubmit,
}: {
  fileRef: React.RefObject<HTMLInputElement | null>;
  certFile: File | null;
  certPassword: string;
  showPassword: boolean;
  uploading: boolean;
  onPickFile: () => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPasswordChange: (v: string) => void;
  onTogglePassword: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <input ref={fileRef} type="file" accept=".pfx,.p12" onChange={onFileChange} className="hidden" />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onPickFile}
          disabled={uploading}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all',
            'border-gray-200 dark:border-gray-700/50 text-gray-700 dark:text-gray-300 hover:border-red-400 dark:hover:border-red-500 hover:text-red-600 dark:hover:text-red-400',
            uploading && 'opacity-50 cursor-not-allowed',
          )}
        >
          <Upload className="h-4 w-4" />
          {certFile ? 'Trocar arquivo' : 'Selecionar .pfx / .p12'}
        </button>
        {certFile && (
          <div className="flex flex-col">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-[200px]">{certFile.name}</span>
            <span className="text-xs text-gray-400 dark:text-gray-500">{(certFile.size / 1024).toFixed(1)} KB</span>
          </div>
        )}
      </div>

      <div className="relative max-w-sm">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('settings.fiscal.certPassword', 'Senha do certificado')}</label>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={certPassword}
            onChange={(e) => onPasswordChange(e.target.value)}
            placeholder={t('settings.fiscal.certPasswordPlaceholder', 'Senha do arquivo .pfx')}
            disabled={uploading}
            autoComplete="new-password"
            className={cn(inputClasses, 'pr-10', uploading && 'opacity-50 cursor-not-allowed')}
          />
          <button
            type="button"
            onClick={onTogglePassword}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('settings.fiscal.certPasswordHelp', 'A senha é usada apenas durante o upload.')}</p>
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={!certFile || !certPassword.trim() || uploading}
        className={cn(
          'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all',
          'bg-gradient-to-r from-red-600 to-red-500 text-white',
          'hover:from-red-700 hover:to-red-600',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {uploading ? 'Enviando...' : 'Enviar Certificado'}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// USERS TAB
// ═══════════════════════════════════════════════════════════════════════════════

const ROLE_COLORS: Record<UserRole, string> = {
  founder: 'bg-purple-100 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-500/20',
  admin:   'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/20',
  manager: 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/20',
  operator:'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/20',
  viewer:  'bg-gray-100 dark:bg-gray-700/40 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-600/30',
};

const INVITE_ROLES: UserRole[] = ['admin', 'manager', 'operator', 'viewer'];

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function getMemberDisplayStatus(member: UserType): 'online' | 'busy' | 'offline' {
  if (member.userStatus === 'invisible') return 'offline';
  if (!member.isOnline || !member.lastSeenAt) return 'offline';
  if (Date.now() - new Date(member.lastSeenAt).getTime() >= 3 * 60 * 1000) return 'offline';
  return member.userStatus === 'busy' ? 'busy' : 'online';
}

function relativeTime(dateStr?: string): string {
  if (!dateStr) return 'Nunca';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000)       return 'Agora mesmo';
  if (diff < 3_600_000)    return `${Math.floor(diff / 60_000)}min atrás`;
  if (diff < 86_400_000)   return `${Math.floor(diff / 3_600_000)}h atrás`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d atrás`;
  return formatDate(dateStr);
}

function daysUntil(dateStr: string): number {
  return Math.max(0, Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000));
}

function UsersTab() {
  const { t } = useTranslation();
  const { user, business, sectors } = useAuth();
  const [members, setMembers]           = useState<UserType[]>([]);
  const [inviteCodes, setInviteCodes]   = useState<InviteCode[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRole>('operator');
  const [selectedSectorId, setSelectedSectorId] = useState<string>('');
  const [copiedCode, setCopiedCode]     = useState<string | null>(null);
  const [revokingCode, setRevokingCode] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [removingMember, setRemovingMember] = useState<UserType | null>(null);
  const [removingLoading, setRemovingLoading] = useState(false);
  const [editingRoleFor, setEditingRoleFor] = useState<string | null>(null);
  const [roleDropdownPos, setRoleDropdownPos] = useState<{ top: number; right: number } | null>(null);
  const [editingCommissionFor, setEditingCommissionFor] = useState<string | null>(null);
  const [commissionInput, setCommissionInput] = useState('');
  const [savingCommission, setSavingCommission] = useState<string | null>(null);
  const isOwner = user?.role === 'founder' || user?.role === 'admin';
  const isFounder = user?.role === 'founder';
  const activeSectors = sectors.filter(s => s.isActive);

  // ── Live members ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!business?.id) return;
    const q = query(collection(db, 'users'), where('businessId', '==', business.id));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ ...d.data(), id: d.id }) as UserType);
      data.sort((a, b) => (ROLE_HIERARCHY[b.role] ?? 0) - (ROLE_HIERARCHY[a.role] ?? 0));
      setMembers(data);
      setLoadingMembers(false);
    }, () => setLoadingMembers(false));
    return () => unsub();
  }, [business?.id]);

  // ── Live invite codes ────────────────────────────────────────────────────
  useEffect(() => {
    if (!business?.id || !isOwner) return;
    const q = query(
      collection(db, 'inviteCodes'),
      where('businessId', '==', business.id),
      where('isActive', '==', true),
    );
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ ...d.data(), id: d.id }) as InviteCode);
      data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setInviteCodes(data);
    });
    return () => unsub();
  }, [business?.id, isOwner]);

  // ── Close role dropdown on outside click ─────────────────────────────────
  useEffect(() => {
    if (!editingRoleFor) return;
    const handler = () => { setEditingRoleFor(null); setRoleDropdownPos(null); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editingRoleFor]);

  // ── Generate invite code ─────────────────────────────────────────────────
  const handleGenerateCode = async () => {
    if (!business || !user) return;
    setGeneratingCode(true);
    try {
      let code = generateCode();
      // Ensure uniqueness (retry up to 3 times)
      for (let i = 0; i < 3; i++) {
        const existing = inviteCodes.find(c => c.code === code);
        if (!existing) break;
        code = generateCode();
      }
      const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const invitePayload: Record<string, unknown> = {
        businessId: business.id,
        code,
        role: selectedRole,
        createdBy: user.uid,
        createdByName: user.name,
        expiresAt,
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      if (selectedSectorId) invitePayload.sectorId = selectedSectorId;
      await setDoc(doc(db, 'inviteCodes', code), invitePayload);
      const sectorName = activeSectors.find(s => s.id === selectedSectorId)?.name;
      toast.success(`Código ${code} gerado!${sectorName ? ` Setor: ${sectorName}.` : ''} Válido por 7 dias.`);
    } catch {
      toast.error(t('settings.users.codeGenerateError', 'Erro ao gerar código. Tente novamente.'));
    } finally {
      setGeneratingCode(false);
    }
  };

  // ── Copy code to clipboard ───────────────────────────────────────────────
  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    });
  };

  // ── Change member role ───────────────────────────────────────────────────
  const handleChangeRole = async (member: UserType, newRole: UserRole) => {
    if (!user || !business) return;
    if (member.uid === user.uid) {
      toast.error('Você não pode alterar seu próprio papel');
      return;
    }
    const myRank = ROLE_HIERARCHY[user.role];
    const targetCurrentRank = ROLE_HIERARCHY[member.role];
    const targetNewRank = ROLE_HIERARCHY[newRole];
    // Cannot escalate someone to >= your own rank unless you're founder
    if (user.role !== 'founder' && targetNewRank >= myRank) {
      toast.error('Você não pode definir um papel igual ou superior ao seu');
      return;
    }
    // Cannot modify someone at >= your own rank
    if (targetCurrentRank >= myRank && user.role !== 'founder') {
      toast.error('Você não pode alterar o papel deste membro');
      return;
    }
    setSavingRole(member.id);
    try {
      await updateDoc(doc(db, 'users', member.uid), {
        role: newRole,
        updatedAt: new Date().toISOString(),
      });
      toast.success(`${member.name} agora é ${ROLE_LABELS[newRole]}`);
      setEditingRoleFor(null);
      setRoleDropdownPos(null);
    } catch (err) {
      console.error('[Users] change role failed:', err);
      toast.error('Erro ao alterar papel');
    } finally {
      setSavingRole(null);
    }
  };

  // ── Remove member (founder only) ─────────────────────────────────────────
  const handleRemoveMember = async () => {
    if (!removingMember || !business || !user) return;
    if (user.role !== 'founder') {
      toast.error('Apenas o fundador pode remover membros');
      return;
    }
    if (removingMember.uid === user.uid) {
      toast.error('Você não pode remover a si mesmo');
      return;
    }
    setRemovingLoading(true);
    try {
      // Soft remove: mark as inactive + strip business link
      // (keeps historical records pointing to a valid uid)
      await updateDoc(doc(db, 'users', removingMember.uid), {
        businessId: null,
        role: 'viewer',
        isActive: false,
        removedAt: new Date().toISOString(),
        removedBy: user.uid,
        updatedAt: new Date().toISOString(),
      });
      // Remove from business.memberIds array atomically (no read needed)
      await updateDoc(doc(db, 'businesses', business.id), {
        memberIds: arrayRemove(removingMember.uid),
        updatedAt: new Date().toISOString(),
      });
      toast.success(`${removingMember.name} removido da empresa`);
      setRemovingMember(null);
    } catch (err) {
      console.error('[Users] remove member failed:', err);
      toast.error('Erro ao remover membro');
    } finally {
      setRemovingLoading(false);
    }
  };

  // ── Save commission rate ─────────────────────────────────────────────────
  const handleSaveCommission = async (member: UserType) => {
    const rate = parseFloat(commissionInput);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      toast.error('Taxa deve ser entre 0% e 100%');
      return;
    }
    setSavingCommission(member.id);
    try {
      await updateDoc(doc(db, 'users', member.uid), {
        commissionRate: rate,
        updatedAt: new Date().toISOString(),
      });
      toast.success(`Comissão de ${member.name}: ${rate}%`);
      setEditingCommissionFor(null);
    } catch (err) {
      console.error('[Users] commission save failed:', err);
      toast.error('Erro ao salvar comissão');
    } finally {
      setSavingCommission(null);
    }
  };

  // ── Revoke code ──────────────────────────────────────────────────────────
  const handleRevoke = async (code: string) => {
    setRevokingCode(code);
    try {
      await updateDoc(doc(db, 'inviteCodes', code), { isActive: false });
      toast.success(t('settings.users.codeRevoked', 'Código revogado.'));
    } catch {
      toast.error(t('settings.users.codeRevokeError', 'Erro ao revogar código.'));
    } finally {
      setRevokingCode(null);
    }
  };

  return (
    <motion.div
      key="users"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      className="space-y-6"
    >
      {/* ── Team members ─────────────────────────────────────────────────── */}
      <SectionCard title={t('settings.users.team', 'Equipe')} icon={Users}>
        {loadingMembers ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl">
                <div className="w-9 h-9 rounded-full shimmer flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-32 rounded-lg shimmer" />
                  <div className="h-3 w-48 rounded-lg shimmer" />
                </div>
              </div>
            ))}
          </div>
        ) : members.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">{t('settings.users.noMembers', 'Nenhum membro encontrado.')}</p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800/80 -mx-6 -mb-6">
            {members.map((member, i) => {
              const displayStatus = getMemberDisplayStatus(member);
              const isCurrentUser = member.uid === user?.uid;
              return (
                <motion.div
                  key={member.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.25 }}
                  className="flex items-center gap-3 px-6 py-3.5 hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors"
                >
                  {/* Avatar */}
                  <div className="relative flex-shrink-0">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-red-100 to-rose-100 dark:from-red-900/40 dark:to-rose-900/30 border border-red-200/60 dark:border-red-800/40 flex items-center justify-center text-xs font-bold text-red-700 dark:text-red-400 shadow-sm">
                      {member.photoURL
                        ? <CachedImage src={member.photoURL} alt={member.name} className="w-full h-full rounded-full object-cover" />
                        : (member.name || '?').split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
                      }
                    </div>
                    {/* Presence dot — 3 states: online (green) | busy (amber) | offline (gray) */}
                    <div className={cn(
                      'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-[#111827] transition-colors',
                      displayStatus === 'online' ? 'bg-emerald-400' :
                      displayStatus === 'busy'   ? 'bg-amber-400' :
                      'bg-gray-300 dark:bg-gray-600'
                    )} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {member.name}
                        {isCurrentUser && <span className="text-gray-400 dark:text-gray-500 font-normal"> (você)</span>}
                      </span>
                      {member.role === 'founder' && <Crown className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />}
                    </div>
                    <p className="text-[12px] text-gray-400 dark:text-gray-500 truncate">{member.email}</p>
                  </div>

                  {/* Right side */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {/* Online status */}
                    <div className="hidden sm:flex items-center gap-1.5 text-[11.5px]">
                      {displayStatus === 'online' ? (
                        <>
                          <Wifi className="w-3 h-3 text-emerald-500" />
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">Online</span>
                        </>
                      ) : displayStatus === 'busy' ? (
                        <>
                          <Wifi className="w-3 h-3 text-amber-500" />
                          <span className="text-amber-600 dark:text-amber-400 font-medium">Ocupado</span>
                        </>
                      ) : (
                        <>
                          <WifiOff className="w-3 h-3 text-gray-400 dark:text-gray-500" />
                          <span className="text-gray-400 dark:text-gray-500">
                            {relativeTime(member.lastSeenAt || member.lastLoginAt)}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Commission rate — editable for admins */}
                    {isOwner && !isCurrentUser && (
                      <div className="hidden sm:block">
                        {editingCommissionFor === member.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={0.5}
                              value={commissionInput}
                              onChange={e => setCommissionInput(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleSaveCommission(member);
                                if (e.key === 'Escape') setEditingCommissionFor(null);
                              }}
                              className="w-14 text-xs px-2 py-0.5 rounded-lg border border-emerald-300 dark:border-emerald-700/50 bg-white dark:bg-white/[0.04] text-emerald-700 dark:text-emerald-400 text-center outline-none focus:ring-1 focus:ring-emerald-400"
                              autoFocus
                            />
                            <span className="text-[10px] text-gray-400">%</span>
                            <button
                              onClick={() => handleSaveCommission(member)}
                              disabled={savingCommission === member.id}
                              className="p-0.5 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors"
                              title="Salvar"
                            >
                              {savingCommission === member.id
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <Check className="w-3 h-3" />}
                            </button>
                            <button
                              onClick={() => setEditingCommissionFor(null)}
                              className="p-0.5 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                              title="Cancelar"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCommissionFor(member.id);
                              setCommissionInput(String(member.commissionRate ?? 0));
                            }}
                            title="Taxa de comissão — clique para editar"
                            className="inline-flex items-center gap-0.5 text-[11px] font-semibold px-2 py-0.5 rounded-lg border border-emerald-200 dark:border-emerald-700/40 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 hover:opacity-80 transition-opacity"
                          >
                            <DollarSign className="w-2.5 h-2.5" />
                            {member.commissionRate ? `${member.commissionRate}%` : '—'}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Role — clickable dropdown for admins, badge for the rest */}
                    {isOwner && !isCurrentUser && (user?.role === 'founder' || ROLE_HIERARCHY[member.role] < ROLE_HIERARCHY[user!.role]) ? (
                      <div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (editingRoleFor === member.id) {
                              setEditingRoleFor(null);
                              setRoleDropdownPos(null);
                            } else {
                              const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                              setRoleDropdownPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                              setEditingRoleFor(member.id);
                            }
                          }}
                          disabled={savingRole === member.id}
                          className={cn(
                            'inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-lg border transition-colors',
                            ROLE_COLORS[member.role],
                            'hover:opacity-80',
                            savingRole === member.id && 'opacity-50',
                          )}
                        >
                          {savingRole === member.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                          {ROLE_LABELS[member.role]}
                          <ChevronRight className={cn('w-3 h-3 transition-transform', editingRoleFor === member.id && 'rotate-90')} />
                        </button>
                      </div>
                    ) : (
                      <span className={cn(
                        'text-[11px] font-semibold px-2 py-0.5 rounded-lg border',
                        ROLE_COLORS[member.role]
                      )}>
                        {ROLE_LABELS[member.role]}
                      </span>
                    )}

                    {/* Remove button — founder only, not self */}
                    {isFounder && !isCurrentUser && (
                      <button
                        type="button"
                        onClick={() => setRemovingMember(member)}
                        className="p-1 rounded-md text-gray-300 dark:text-gray-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                        title="Remover da equipe"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* ── Remove member confirmation ─────────────────────────────────────── */}
      <AnimatePresence>
        {removingMember && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget && !removingLoading) setRemovingMember(null); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6"
            >
              <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                <UserMinus className="w-6 h-6 text-red-500" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white text-center mb-2">
                Remover membro da equipe?
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 text-center mb-6">
                <strong className="text-gray-900 dark:text-white">{removingMember.name}</strong> perderá acesso ao sistema.
                Os registros criados por ele(a) serão mantidos no histórico.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setRemovingMember(null)}
                  disabled={removingLoading}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleRemoveMember}
                  disabled={removingLoading}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-bold shadow-sm"
                >
                  {removingLoading ? 'Removendo...' : 'Remover'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Invite codes (admin/founder only) ────────────────────────────── */}
      {isOwner && (
        <SectionCard title={t('settings.users.inviteCodes', 'Códigos de Convite')} icon={Link2}>
          <div className="space-y-5">
            {/* Generator */}
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3 p-4 rounded-xl bg-gray-50 dark:bg-white/[0.02] border border-gray-100 dark:border-gray-800/60">
              <div className="flex-1 min-w-0">
                <label className="block text-[12px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                  Função do novo membro
                </label>
                <div className="flex flex-wrap gap-2">
                  {INVITE_ROLES.map(role => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setSelectedRole(role)}
                      className={cn(
                        'text-[12px] font-semibold px-3 py-1.5 rounded-lg border transition-all duration-150',
                        selectedRole === role
                          ? ROLE_COLORS[role]
                          : 'bg-white dark:bg-white/[0.04] text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      )}
                    >
                      {ROLE_LABELS[role]}
                    </button>
                  ))}
                </div>
                {/* Sector selector (optional) */}
                {activeSectors.length > 0 && (
                  <div className="mt-3">
                    <label className="block text-[12px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                      Setor <span className="text-gray-400 font-normal normal-case">(opcional)</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedSectorId('')}
                        className={cn(
                          'text-[12px] font-medium px-3 py-1.5 rounded-lg border transition-all duration-150',
                          selectedSectorId === ''
                            ? 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 border-gray-800 dark:border-gray-200'
                            : 'bg-white dark:bg-white/[0.04] text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-gray-300'
                        )}
                      >
                        Nenhum
                      </button>
                      {activeSectors.map(sector => (
                        <button
                          key={sector.id}
                          type="button"
                          onClick={() => setSelectedSectorId(sector.id)}
                          className={cn(
                            'text-[12px] font-medium px-3 py-1.5 rounded-lg border transition-all duration-150 flex items-center gap-1.5',
                            selectedSectorId === sector.id
                              ? 'text-white border-transparent'
                              : 'bg-white dark:bg-white/[0.04] text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-gray-300'
                          )}
                          style={selectedSectorId === sector.id ? { backgroundColor: sector.color, borderColor: sector.color } : {}}
                        >
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: selectedSectorId === sector.id ? 'rgba(255,255,255,0.7)' : sector.color }}
                          />
                          {sector.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mt-2">
                  O código expira em <span className="font-semibold">7 dias</span> e só pode ser usado <span className="font-semibold">uma vez</span>.
                </p>
              </div>
              <button
                type="button"
                onClick={handleGenerateCode}
                disabled={generatingCode}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-red-500 text-white text-[13px] font-semibold shadow-md shadow-red-500/25 hover:from-red-700 hover:to-red-600 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0"
              >
                {generatingCode
                  ? <><Loader2 className="w-4 h-4 animate-spin" />{t('common.generating', 'Gerando...')}</>
                  : <><Plus className="w-4 h-4" />{t('settings.users.generateCode', 'Gerar Código')}</>
                }
              </button>
            </div>

            {/* Active codes list */}
            {inviteCodes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
                  <UserPlus className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                </div>
                <p className="text-[13px] text-gray-400 dark:text-gray-500">{t('settings.users.noCodes', 'Nenhum código ativo. Gere um acima.')}</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                <p className="text-[12px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                  Códigos ativos ({inviteCodes.length})
                </p>
                <AnimatePresence>
                  {inviteCodes.map((ic) => {
                    const days = daysUntil(ic.expiresAt);
                    const isCopied = copiedCode === ic.code;
                    const isRevoking = revokingCode === ic.code;
                    return (
                      <motion.div
                        key={ic.id}
                        initial={{ opacity: 0, y: -6, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, x: 20, scale: 0.96 }}
                        transition={{ duration: 0.2 }}
                        className="flex items-center gap-3 p-3.5 rounded-xl bg-white dark:bg-white/[0.03] border border-gray-200 dark:border-gray-700/50 shadow-sm hover:shadow-md transition-shadow duration-200"
                      >
                        {/* Code */}
                        <div className="flex-shrink-0 px-3 py-2 rounded-lg bg-gray-900 dark:bg-gray-800 border border-gray-700">
                          <span className="font-mono font-bold text-[17px] tracking-[0.25em] text-white">
                            {ic.code}
                          </span>
                        </div>

                        {/* Meta */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span className={cn(
                              'text-[11px] font-semibold px-2 py-0.5 rounded-md border',
                              ROLE_COLORS[ic.role]
                            )}>
                              {ROLE_LABELS[ic.role]}
                            </span>
                            {ic.sectorId && (() => {
                              const sector = activeSectors.find(s => s.id === ic.sectorId);
                              return sector ? (
                                <span
                                  className="text-[11px] font-medium px-2 py-0.5 rounded-md text-white flex items-center gap-1"
                                  style={{ backgroundColor: sector.color }}
                                >
                                  {sector.name}
                                </span>
                              ) : null;
                            })()}
                          </div>
                          <div className="flex items-center gap-1 text-[11.5px] text-gray-400 dark:text-gray-500">
                            <Clock className="w-3 h-3 flex-shrink-0" />
                            <span className={cn(days <= 1 && 'text-amber-500 dark:text-amber-400 font-medium')}>
                              {days === 0 ? 'Expira hoje!' : `Expira em ${days}d`}
                            </span>
                            <span className="mx-1 opacity-40">·</span>
                            <span>por {ic.createdByName}</span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => handleCopy(ic.code)}
                            title={t('settings.users.copyTitle', 'Copiar código')}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/[0.1] transition-colors"
                          >
                            {isCopied
                              ? <><Check className="w-3.5 h-3.5 text-green-500" /><span className="text-green-600 dark:text-green-400">{t('settings.users.copied', 'Copiado')}</span></>
                              : <><Copy className="w-3.5 h-3.5" />{t('settings.users.copy', 'Copiar')}</>
                            }
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRevoke(ic.code)}
                            disabled={isRevoking}
                            title="Revogar código"
                            className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50"
                          >
                            {isRevoking
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <X className="w-3.5 h-3.5" />
                            }
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {/* Info card for non-admins */}
      {!isOwner && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 text-sm text-blue-700 dark:text-blue-300">
          <Shield className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p>Somente administradores e fundadores podem gerar códigos de convite.</p>
        </div>
      )}

      {/* Role dropdown portal — escapes overflow:hidden of parent cards */}
      {typeof document !== 'undefined' && editingRoleFor && roleDropdownPos && createPortal(
        <AnimatePresence>
          <motion.div
            key={editingRoleFor}
            initial={{ opacity: 0, y: -4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            onMouseDown={e => e.stopPropagation()}
            style={{ position: 'fixed', top: roleDropdownPos.top, right: roleDropdownPos.right, zIndex: 9999 }}
            className="w-40 rounded-xl bg-white dark:bg-[#1e293b] shadow-xl border border-gray-200 dark:border-white/[0.08] overflow-hidden"
          >
            {(['founder', 'admin', 'manager', 'operator', 'viewer'] as UserRole[])
              .filter(r => user?.role === 'founder' || ROLE_HIERARCHY[r] < ROLE_HIERARCHY[user!.role])
              .map(r => {
                const targetMember = members.find(m => m.id === editingRoleFor);
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => targetMember && handleChangeRole(targetMember, r)}
                    disabled={r === targetMember?.role}
                    className={cn(
                      'w-full text-left px-3 py-2 flex items-center justify-between text-xs transition-colors',
                      r === targetMember?.role
                        ? 'bg-gray-100 dark:bg-white/[0.04] text-gray-500 cursor-default'
                        : 'hover:bg-gray-50 dark:hover:bg-white/[0.04] text-gray-700 dark:text-gray-300',
                    )}
                  >
                    <span className="font-medium">{ROLE_LABELS[r]}</span>
                    {r === targetMember?.role && <Check className="w-3 h-3 text-emerald-500" />}
                  </button>
                );
              })}
          </motion.div>
        </AnimatePresence>,
        document.body
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENTERPRISE TAB
// ═══════════════════════════════════════════════════════════════════════════════

const ICON_MAP: Record<string, React.ElementType> = {
  CreditCard, Triangle, Mail, Bug, Shield, Cloud, Database, Globe,
};

function IntegrationRow({
  providerId,
  provider,
  config,
  keyValues,
  showKeys,
  saving,
  testing,
  onKeyChange,
  onToggleShowKey,
  onSave,
  onTest,
}: {
  providerId: string;
  provider: typeof INTEGRATION_PROVIDERS[IntegrationProvider];
  config: IntegrationConfig | undefined;
  keyValues: Record<string, string>;
  showKeys: Record<string, boolean>;
  saving: string | null;
  testing: string | null;
  onKeyChange: (providerId: string, fieldKey: string, value: string) => void;
  onToggleShowKey: (providerId: string) => void;
  onSave: (providerId: string) => void;
  onTest: (providerId: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const IconComponent = ICON_MAP[provider.icon] || Plug;
  const isConnected = config?.isActive;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50/60 dark:hover:bg-white/[0.02] transition-colors text-left"
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${provider.color}12` }}
        >
          <IconComponent className="w-[18px] h-[18px]" style={{ color: provider.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">{provider.name}</span>
            {isConnected ? (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                {t('settings.enterprise.integrationStatusConnected', 'Conectado')}
              </span>
            ) : (
              <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">{t('settings.enterprise.integrationStatusNotConfigured', 'Não configurado')}</span>
            )}
          </div>
          <p className="text-[12px] text-gray-400 dark:text-gray-500 truncate">{provider.description}</p>
        </div>
        <motion.div
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          className="text-gray-300 dark:text-gray-600 flex-shrink-0"
        >
          <ChevronRight className="w-4 h-4" />
        </motion.div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-1 space-y-3">
              {provider.fields.map(field => (
                <div key={field.key}>
                  <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5 block">
                    {field.label}
                  </label>
                  <div className="relative">
                    <input
                      type={showKeys[providerId] ? 'text' : 'password'}
                      placeholder={field.placeholder}
                      value={keyValues[`${providerId}_${field.key}`] || ''}
                      onChange={(e) => onKeyChange(providerId, field.key, e.target.value)}
                      className="w-full px-3.5 py-2.5 pr-10 text-sm font-mono rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-900 dark:text-white placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 dark:focus:border-violet-500 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => onToggleShowKey(providerId)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 transition-colors"
                    >
                      {showKeys[providerId] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  {field.help && (
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5 flex items-start gap-1">
                      <Info className="w-3 h-3 flex-shrink-0 mt-px" />
                      {field.help}
                    </p>
                  )}
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onSave(providerId)}
                  disabled={saving === providerId}
                  className="px-5 py-2 text-xs font-semibold rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 transition-all disabled:opacity-50"
                >
                  {saving === providerId ? (
                    <span className="flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Salvando</span>
                  ) : 'Salvar'}
                </button>
                {isConnected && (
                  <button
                    type="button"
                    onClick={() => onTest(providerId)}
                    disabled={testing === providerId}
                    className="px-4 py-2 text-xs font-medium rounded-xl text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
                  >
                    {testing === providerId ? (
                      <span className="flex items-center gap-1.5"><RefreshCw className="w-3 h-3 animate-spin" /> Testando</span>
                    ) : 'Testar conexão'}
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Agente IA Tab ────────────────────────────────────────────────────────────

// ─── Password Vault Tab ──────────────────────────────────────────────────────

interface VaultListItem extends Omit<import('@/lib/types').VaultEntry, 'encryptedPassword'> {}

interface VaultFormState {
  id?: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  category: string;
  accessScope: 'admins' | 'specific';
  sharedWith: string[];
}

const EMPTY_VAULT_FORM: VaultFormState = {
  title: '', username: '', password: '', url: '', notes: '', category: '',
  accessScope: 'admins', sharedWith: [],
};

function generatePassword(length: number, opts: { upper: boolean; lower: boolean; numbers: boolean; symbols: boolean }): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const nums = '23456789';
  const syms = '!@#$%^&*()-_=+[]{};:,.<>?/';
  let pool = '';
  if (opts.upper) pool += upper;
  if (opts.lower) pool += lower;
  if (opts.numbers) pool += nums;
  if (opts.symbols) pool += syms;
  if (!pool) pool = lower;
  // Use crypto for entropy
  const out: string[] = [];
  const cryptoObj = typeof window !== 'undefined' ? window.crypto : null;
  if (cryptoObj) {
    const arr = new Uint32Array(length);
    cryptoObj.getRandomValues(arr);
    for (let i = 0; i < length; i++) out.push(pool[arr[i] % pool.length]);
  } else {
    for (let i = 0; i < length; i++) out.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return out.join('');
}

function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string; color: string } {
  if (!pw) return { score: 0, label: '—', color: 'bg-gray-300' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const capped = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  const labels = ['Muito fraca', 'Fraca', 'Ok', 'Boa', 'Excelente'];
  const colors = ['bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500', 'bg-violet-500'];
  return { score: capped, label: labels[capped], color: colors[capped] };
}

function VaultTab() {
  const { user, business } = useAuth();
  const [entries, setEntries] = useState<VaultListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<VaultFormState>(EMPTY_VAULT_FORM);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  const [revealTimer, setRevealTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [revealing, setRevealing] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const REVEAL_TIMEOUT_MS = 15_000;
  const canEdit = ROLE_HIERARCHY[user?.role ?? 'viewer'] >= ROLE_HIERARCHY['admin'];

  // Fetch entries via API route — Admin SDK bypasses client-side Firestore rules,
  // avoiding "Missing or insufficient permissions" from the per-doc accessScope check.
  useEffect(() => {
    if (!business?.id) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { getAuth } = await import('firebase/auth');
        const token = await getAuth().currentUser?.getIdToken();
        if (!token || cancelled) return;
        const resp = await fetch('/api/vault', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'list', businessId: business.id, params: {} }),
        });
        const json = await resp.json();
        if (cancelled) return;
        if (resp.ok && json.ok) {
          const list: VaultListItem[] = json.data;
          list.sort((a, b) => a.title.localeCompare(b.title));
          setEntries(list);
        } else {
          console.error('[Vault] list error:', json?.error);
        }
      } catch (err) {
        if (!cancelled) console.error('[Vault] fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [business?.id, refreshKey]);

  // Auto-hide revealed password
  useEffect(() => {
    return () => { if (revealTimer) clearTimeout(revealTimer); };
  }, [revealTimer]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) if (e.category) s.add(e.category);
    return Array.from(s).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter(e => {
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.username?.toLowerCase().includes(q) ||
        e.category?.toLowerCase().includes(q) ||
        e.url?.toLowerCase().includes(q)
      );
    });
  }, [entries, search, categoryFilter]);

  const callApi = async (action: 'list' | 'save' | 'reveal' | 'delete', params: Record<string, unknown>) => {
    if (!business?.id) throw new Error('Sem business');
    const { getAuth } = await import('firebase/auth');
    const token = await getAuth().currentUser?.getIdToken();
    if (!token) throw new Error('Não autenticado');
    const resp = await fetch('/api/vault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, businessId: business.id, params }),
    });
    const json = await resp.json();
    if (!resp.ok || !json.ok) throw new Error(json.error || 'Erro na API');
    return json.data;
  };

  const openCreate = () => {
    if (!canEdit) return;
    setForm(EMPTY_VAULT_FORM);
    setEditing(false);
    setFormOpen(true);
  };

  const openEdit = (e: VaultListItem) => {
    if (!canEdit) return;
    setForm({
      id: e.id,
      title: e.title,
      username: e.username || '',
      password: '',
      url: e.url || '',
      notes: e.notes || '',
      category: e.category || '',
      accessScope: e.accessScope || 'admins',
      sharedWith: e.sharedWith || [],
    });
    setEditing(true);
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    if (!editing && !form.password) {
      toast.error('Defina uma senha');
      return;
    }
    setSaving(true);
    try {
      await callApi('save', {
        id: form.id,
        title: form.title.trim(),
        username: form.username.trim() || undefined,
        password: form.password || undefined,
        url: form.url.trim() || undefined,
        notes: form.notes.trim() || undefined,
        category: form.category.trim() || undefined,
        accessScope: form.accessScope,
        sharedWith: form.accessScope === 'specific' ? form.sharedWith : undefined,
      });
      toast.success(editing ? 'Entrada atualizada' : 'Senha salva no cofre');
      setFormOpen(false);
      setRefreshKey(k => k + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!canEdit) return;
    if (!confirm('Excluir esta senha do cofre? Esta ação não pode ser desfeita.')) return;
    setDeleting(id);
    try {
      await callApi('delete', { id });
      toast.info('Entrada removida');
      setRefreshKey(k => k + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir');
    } finally {
      setDeleting(null);
    }
  };

  const handleReveal = async (id: string) => {
    if (revealedId === id) {
      // Hide
      setRevealedId(null);
      setRevealedValue(null);
      if (revealTimer) { clearTimeout(revealTimer); setRevealTimer(null); }
      return;
    }
    setRevealing(id);
    try {
      const data = await callApi('reveal', { id });
      setRevealedId(id);
      setRevealedValue(data.password);
      if (revealTimer) clearTimeout(revealTimer);
      const t = setTimeout(() => {
        setRevealedId(null);
        setRevealedValue(null);
        setRevealTimer(null);
      }, REVEAL_TIMEOUT_MS);
      setRevealTimer(t);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao revelar');
    } finally {
      setRevealing(null);
    }
  };

  const copyRevealed = async () => {
    if (!revealedValue) return;
    try {
      await navigator.clipboard.writeText(revealedValue);
      toast.success('Senha copiada (limpa em 20s)');
      setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 20_000);
    } catch {
      toast.error('Falha ao copiar');
    }
  };

  const copyUsername = async (u: string) => {
    try { await navigator.clipboard.writeText(u); toast.success('Usuário copiado'); }
    catch { toast.error('Falha ao copiar'); }
  };

  return (
    <motion.div
      key="cofre"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      className="space-y-5"
    >
      {/* Header */}
      <div className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-500/10 dark:to-teal-500/5 border border-emerald-200/60 dark:border-emerald-500/20 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white dark:bg-gray-900 flex items-center justify-center shadow-sm">
            <Shield className="w-5 h-5 text-emerald-500" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-0.5">Cofre de Senhas da Empresa</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              Armazene credenciais compartilhadas (contas bancárias, emails, serviços) de forma segura.
              Senhas são criptografadas no servidor com AES-256-GCM. Acesso restrito a administradores.
            </p>
          </div>
        </div>
      </div>

      {/* Search + filters + new */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por título, usuário ou URL..."
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
          />
        </div>
        {categories.length > 0 && (
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="px-3 py-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none"
          >
            <option value="all">Todas categorias</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Nova Senha
        </button>
      </div>

      {/* Entries */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 rounded-xl shimmer" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center mb-4">
            <Lock className="w-7 h-7 text-emerald-500" />
          </div>
          <p className="text-gray-700 dark:text-gray-200 font-semibold">
            {entries.length === 0 ? 'Nenhuma senha salva ainda' : 'Nenhuma entrada corresponde à busca'}
          </p>
          {entries.length === 0 && (
            <p className="text-sm text-gray-500 mt-1">Clique em "Nova Senha" para criar a primeira</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map(e => {
            const isRevealed = revealedId === e.id;
            const canDelete = e.createdBy === user?.uid || user?.role === 'founder';
            return (
              <motion.div
                key={e.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="group bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{e.title}</h4>
                      {e.category && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">
                          {e.category}
                        </span>
                      )}
                      {e.accessScope === 'specific' && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 inline-flex items-center gap-0.5">
                          <Lock className="w-2.5 h-2.5" /> Restrita
                        </span>
                      )}
                    </div>
                    {e.username && (
                      <button
                        type="button"
                        onClick={() => copyUsername(e.username!)}
                        className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 truncate max-w-full"
                        title="Clique para copiar"
                      >
                        <span className="truncate">{e.username}</span>
                        <Copy className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 flex-shrink-0" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => openEdit(e)}
                      className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                      title="Editar"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDelete(e.id)}
                        disabled={deleting === e.id}
                        className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-30"
                        title="Excluir"
                      >
                        {deleting === e.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                </div>

                {/* URL */}
                {e.url && (
                  <a
                    href={e.url.startsWith('http') ? e.url : `https://${e.url}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-blue-500 hover:underline truncate max-w-full mb-2"
                  >
                    <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                    <span className="truncate">{e.url}</span>
                  </a>
                )}

                {/* Reveal button / revealed password */}
                <div className="flex items-center gap-2 mt-2">
                  {isRevealed && revealedValue ? (
                    <>
                      <div className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 font-mono text-xs text-gray-900 dark:text-gray-100 truncate">
                        {revealedValue}
                      </div>
                      <button
                        onClick={copyRevealed}
                        className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white"
                        title="Copiar"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleReveal(e.id)}
                        className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
                        title="Ocultar"
                      >
                        <EyeOff className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleReveal(e.id)}
                      disabled={revealing === e.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/[0.04] hover:bg-gray-200 dark:hover:bg-white/[0.08] text-xs font-semibold text-gray-700 dark:text-gray-300 disabled:opacity-50"
                    >
                      {revealing === e.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                      Revelar senha
                    </button>
                  )}
                </div>

                {/* Meta */}
                <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-[10px] text-gray-400 dark:text-gray-500">
                  <span>Criado por {e.createdByName}</span>
                  {e.accessCount ? <span>{e.accessCount} {e.accessCount === 1 ? 'consulta' : 'consultas'}</span> : <span>Nunca acessada</span>}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Form modal */}
      <AnimatePresence>
        {formOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget && !saving) setFormOpen(false); }}
          >
            <VaultForm
              form={form}
              setForm={setForm}
              editing={editing}
              saving={saving}
              onSave={handleSave}
              onClose={() => setFormOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function VaultForm({
  form, setForm, editing, saving, onSave, onClose,
}: {
  form: VaultFormState;
  setForm: (v: VaultFormState | ((prev: VaultFormState) => VaultFormState)) => void;
  editing: boolean;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const [showPw, setShowPw] = useState(false);
  const [genLength, setGenLength] = useState(20);
  const [genOpts, setGenOpts] = useState({ upper: true, lower: true, numbers: true, symbols: true });

  const strength = passwordStrength(form.password);
  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400';
  const labelCls = 'block text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.22 }}
      className="w-full max-w-2xl max-h-[90vh] overflow-hidden bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col"
    >
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Shield className="w-5 h-5 text-emerald-500" />
          {editing ? 'Editar senha' : 'Nova senha'}
        </h2>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div>
          <label className={labelCls}>Título *</label>
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="AWS Console, Stripe, Gmail..." className={inputCls} autoFocus />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Usuário / Email</label>
            <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              placeholder="admin@empresa.com" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Categoria</label>
            <input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              placeholder="Financeiro, Dev, Social..." className={inputCls} list="vault-categories" />
          </div>
        </div>

        {/* Password with generator */}
        <div>
          <label className={labelCls}>{editing ? 'Senha (vazio = manter atual)' : 'Senha *'}</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showPw ? 'text' : 'password'}
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder={editing ? 'Deixe em branco para manter' : 'Use o gerador ou digite'}
                className={cn(inputCls, 'pr-10 font-mono')}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, password: generatePassword(genLength, genOpts) }))}
              className="px-3 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 text-xs font-bold hover:bg-emerald-100 dark:hover:bg-emerald-500/20 inline-flex items-center gap-1"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Gerar
            </button>
          </div>
          {form.password && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <motion.div
                  className={cn('h-full rounded-full', strength.color)}
                  animate={{ width: `${(strength.score / 4) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">{strength.label}</span>
            </div>
          )}

          {/* Generator options */}
          <details className="mt-2 group">
            <summary className="cursor-pointer text-[11px] text-gray-500 dark:text-gray-400 hover:text-emerald-600 inline-flex items-center gap-1">
              <ChevronRight className="w-3 h-3 transition-transform group-open:rotate-90" />
              Opções do gerador
            </summary>
            <div className="mt-2 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 space-y-2">
              <div className="flex items-center gap-3">
                <label className="text-[11px] text-gray-600 dark:text-gray-400 flex-shrink-0 w-24">Tamanho: {genLength}</label>
                <input type="range" min={8} max={64} value={genLength} onChange={e => setGenLength(Number(e.target.value))}
                  className="flex-1 accent-emerald-500" />
              </div>
              <div className="flex flex-wrap gap-3 text-[11px]">
                {([
                  ['upper', 'Maiúsculas'],
                  ['lower', 'Minúsculas'],
                  ['numbers', 'Números'],
                  ['symbols', 'Símbolos'],
                ] as [keyof typeof genOpts, string][]).map(([k, label]) => (
                  <label key={k} className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={genOpts[k]} onChange={e => setGenOpts(o => ({ ...o, [k]: e.target.checked }))}
                      className="accent-emerald-500" />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </details>
        </div>

        <div>
          <label className={labelCls}>URL</label>
          <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
            placeholder="https://console.aws.amazon.com" className={inputCls} />
        </div>

        <div>
          <label className={labelCls}>Notas</label>
          <textarea rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            placeholder="MFA ativo, usar código do app, etc."
            className={cn(inputCls, 'resize-none')} />
        </div>

        {/* Access scope */}
        <div>
          <label className={labelCls}>Acesso</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, accessScope: 'admins' }))}
              className={cn(
                'text-left p-3 rounded-xl border-2 text-xs transition-all',
                form.accessScope === 'admins'
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10'
                  : 'border-gray-200 dark:border-gray-700',
              )}
            >
              <p className="font-bold text-gray-900 dark:text-gray-100">Todos admins</p>
              <p className="text-[10px] text-gray-500 mt-0.5">Visível para administradores e founder</p>
            </button>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, accessScope: 'specific' }))}
              className={cn(
                'text-left p-3 rounded-xl border-2 text-xs transition-all',
                form.accessScope === 'specific'
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10'
                  : 'border-gray-200 dark:border-gray-700',
              )}
            >
              <p className="font-bold text-gray-900 dark:text-gray-100">Apenas criador</p>
              <p className="text-[10px] text-gray-500 mt-0.5">Restrita — só você (e founder)</p>
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60 flex justify-end gap-2">
        <button onClick={onClose} disabled={saving}
          className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
          Cancelar
        </button>
        <button onClick={onSave} disabled={saving || !form.title.trim()}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Salvando...' : 'Salvar no cofre'}
        </button>
      </div>
    </motion.div>
  );
}

function AgenteToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-12 items-center rounded-full transition-colors',
        checked ? 'bg-violet-600' : 'bg-gray-300 dark:bg-gray-700',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white transition-transform shadow-sm',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}

function AgenteTab() {
  const { business, refreshUser } = useAuth();
  const current = business?.settings?.aiAgent;
  const useCase: UseCase = (business?.settings?.useCase as UseCase) || 'servicos';

  const [enabled, setEnabled] = useState<boolean>(current?.enabled ?? false);
  const [tone, setTone] = useState<'formal' | 'casual' | 'friendly'>(current?.tone || 'friendly');
  const [businessDescription, setBusinessDescription] = useState<string>(current?.businessDescription || '');

  // Pedidos-specific
  const [notifyOnStatusChange, setNotifyOnStatusChange] = useState<boolean>(current?.pedidos?.notifyOnStatusChange ?? true);
  const [acceptOrdersOffHours, setAcceptOrdersOffHours] = useState<boolean>(current?.pedidos?.acceptOrdersOffHours ?? false);
  const [deliveryFee, setDeliveryFee] = useState<number>(current?.pedidos?.deliveryFee ?? 0);

  // Agenda-specific
  const [sendReminder, setSendReminder] = useState<boolean>(current?.agenda?.sendReminder ?? true);
  const [reminderHoursBefore, setReminderHoursBefore] = useState<number>(current?.agenda?.reminderHoursBefore ?? 24);
  const [confirmationBeforeAppointment, setConfirmationBeforeAppointment] = useState<boolean>(current?.agenda?.confirmationBeforeAppointment ?? true);
  const [followUpAfter, setFollowUpAfter] = useState<boolean>(current?.agenda?.followUpAfter ?? false);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(current?.enabled ?? false);
    setTone(current?.tone || 'friendly');
    setBusinessDescription(current?.businessDescription || '');
    setNotifyOnStatusChange(current?.pedidos?.notifyOnStatusChange ?? true);
    setAcceptOrdersOffHours(current?.pedidos?.acceptOrdersOffHours ?? false);
    setDeliveryFee(current?.pedidos?.deliveryFee ?? 0);
    setSendReminder(current?.agenda?.sendReminder ?? true);
    setReminderHoursBefore(current?.agenda?.reminderHoursBefore ?? 24);
    setConfirmationBeforeAppointment(current?.agenda?.confirmationBeforeAppointment ?? true);
    setFollowUpAfter(current?.agenda?.followUpAfter ?? false);
  }, [current]);

  const handleSave = async () => {
    if (!business?.id) return;
    setSaving(true);
    try {
      // Build nested settings — keeps Firestore doc clean and lets server-side
      // prompt builder know exactly what user opted into.
      const pedidos = useCase === 'pedidos'
        ? { notifyOnStatusChange, acceptOrdersOffHours, deliveryFee: deliveryFee > 0 ? deliveryFee : null }
        : undefined;
      const agenda = useCase === 'servicos'
        ? { sendReminder, reminderHoursBefore, confirmationBeforeAppointment, followUpAfter }
        : undefined;

      const payload: Record<string, unknown> = {
        'settings.aiAgent': {
          enabled,
          tone,
          businessDescription: businessDescription.trim() || null,
          pedidos: pedidos || null,
          agenda: agenda || null,
          enabledAt: enabled && !current?.enabledAt ? new Date().toISOString() : (current?.enabledAt || null),
        },
        updatedAt: new Date().toISOString(),
      };
      await updateDoc(doc(db, 'businesses', business.id), payload);
      await refreshUser();
      toast.success('Configurações do agente salvas!');
    } catch (err) {
      console.error('[AI Agent Settings] Save failed:', err);
      toast.error('Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const tones = [
    { id: 'friendly', label: 'Amigável', emoji: '😊' },
    { id: 'casual', label: 'Casual', emoji: '👋' },
    { id: 'formal', label: 'Formal', emoji: '🎩' },
  ] as const;

  const modeLabel = useCase === 'pedidos' ? 'Pedidos' : useCase === 'servicos' ? 'Serviços' : USE_CASE_LABELS[useCase];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.25 }}
      className="space-y-6"
    >
      {/* Enable card */}
      <div className="bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-500/10 dark:to-purple-500/5 border border-violet-200/60 dark:border-violet-500/20 rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1">
            <div className="w-10 h-10 rounded-xl bg-white dark:bg-gray-900 flex items-center justify-center shadow-sm flex-shrink-0">
              <Sparkles className="w-5 h-5 text-violet-500" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-0.5">Agente Autônomo de Atendimento</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                IA responde automaticamente conversas no WhatsApp, Facebook e Instagram.
                O comportamento do agente adapta ao <strong>modo {modeLabel}</strong> configurado em Modo do Sistema.
              </p>
            </div>
          </div>
          <AgenteToggleSwitch checked={enabled} onChange={setEnabled} />
        </div>
      </div>

      {/* ── Lembretes automáticos — independente do Agente IA ── */}
      {useCase === 'servicos' && (
        <SectionCard title="Lembretes automáticos" icon={Bell}>
          {/* Info banner */}
          <div className="mb-4 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl p-3 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
              Funciona <strong>independente do Agente IA</strong>. As mensagens são enviadas automaticamente a cada hora via WhatsApp para clientes que já possuem conversa ativa no canal.
            </p>
          </div>

          <div className="space-y-4">
            {/* Lembrete antes */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Lembrete antes do agendamento
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Envia mensagem lembrando o cliente do horário marcado.
                </p>
                {sendReminder && (
                  <div className="mt-2 flex items-center gap-2">
                    <label className="text-xs text-gray-500">Quantas horas antes?</label>
                    <input
                      type="number"
                      min={1}
                      max={168}
                      value={reminderHoursBefore}
                      onChange={(e) => setReminderHoursBefore(Math.max(1, Math.min(168, Number(e.target.value) || 24)))}
                      className="w-16 px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-center"
                    />
                    <span className="text-xs text-gray-500">horas</span>
                  </div>
                )}
              </div>
              <AgenteToggleSwitch checked={sendReminder} onChange={setSendReminder} />
            </div>

            {/* Confirmação de presença */}
            <div className="flex items-start justify-between gap-4 pt-3 border-t border-gray-100 dark:border-gray-800">
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Pedir confirmação de presença
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Um dia antes, pergunta se o cliente confirma — resposta "confirmo" atualiza o status do agendamento.
                </p>
              </div>
              <AgenteToggleSwitch checked={confirmationBeforeAppointment} onChange={setConfirmationBeforeAppointment} />
            </div>

            {/* Follow-up pós-atendimento */}
            <div className="flex items-start justify-between gap-4 pt-3 border-t border-gray-100 dark:border-gray-800">
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Follow-up após o atendimento
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Agradecimento enviado 12–36h após a conclusão. Útil para medir satisfação e fidelizar.
                </p>
              </div>
              <AgenteToggleSwitch checked={followUpAfter} onChange={setFollowUpAfter} />
            </div>
          </div>
        </SectionCard>
      )}

      {/* ── Agente IA — configurações avançadas ── */}
      {enabled && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: 0.25 }}
          className="space-y-6"
        >
          {/* Tom */}
          <SectionCard title="Tom de voz" icon={MessageCircle}>
            <div className="flex gap-2 flex-wrap">
              {tones.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTone(t.id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border-2 text-sm font-medium transition-all',
                    tone === t.id
                      ? 'border-violet-500 bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400',
                  )}
                >
                  <span>{t.emoji}</span>
                  {t.label}
                </button>
              ))}
            </div>
          </SectionCard>

          {/* Contexto */}
          <SectionCard title="Contexto do negócio" icon={Info}>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              Descreva seu negócio: horário, especialidades, políticas, diferenciais. Vai direto no prompt do agente.
            </p>
            <textarea
              value={businessDescription}
              onChange={(e) => setBusinessDescription(e.target.value.slice(0, 2000))}
              rows={5}
              placeholder={
                useCase === 'pedidos'
                  ? 'Ex.: Pizzaria familiar, aberta ter–dom 18h–23h. Pizzas artesanais. Entrega em até 3km por R$ 8. PIX / cartão / dinheiro.'
                  : useCase === 'servicos'
                    ? 'Ex.: Clínica odontológica na Zona Sul, atendimento seg–sex 8h–18h, especialidade em ortodontia. Chegada 15min antes.'
                    : 'Descreva seu negócio em poucas linhas.'
              }
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            />
            <p className="text-[10px] text-gray-400 mt-1 text-right">{businessDescription.length}/2000</p>
          </SectionCard>

          {/* Automações de pedidos (modo pedidos) */}
          {useCase === 'pedidos' && (
            <SectionCard title="Automações de pedidos" icon={MessageCircle}>
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      Avisar cliente em cada mudança de status
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Pedido recebido, em preparo, pronto, saiu para entrega, entregue — cada transição envia uma
                      mensagem automática no canal original.
                    </p>
                  </div>
                  <AgenteToggleSwitch checked={notifyOnStatusChange} onChange={setNotifyOnStatusChange} />
                </div>
                <div className="flex items-start justify-between gap-4 pt-3 border-t border-gray-100 dark:border-gray-800">
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      Aceitar pedidos fora do horário
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Se desligado, a IA informa ao cliente que o estabelecimento está fechado e sugere retorno no próximo dia útil.
                    </p>
                  </div>
                  <AgenteToggleSwitch checked={acceptOrdersOffHours} onChange={setAcceptOrdersOffHours} />
                </div>
                <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Taxa de entrega padrão</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                    Valor cobrado pelo agente automaticamente em pedidos do tipo entrega. Use 0 para não cobrar ou variar por região.
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">R$</span>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={deliveryFee}
                      onChange={(e) => setDeliveryFee(Math.max(0, Number(e.target.value) || 0))}
                      className="w-24 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                    />
                  </div>
                </div>
              </div>
            </SectionCard>
          )}

          {useCase !== 'pedidos' && useCase !== 'servicos' && (
            <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
              <Info className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                  Automações específicas ficam disponíveis nos modos Pedidos ou Serviços
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Troque o modo em <strong>Modo do Sistema</strong> para habilitar lembretes de agenda ou notificações de pedidos.
                </p>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Save button is always visible so disabling the agent can be persisted */}
      {!enabled && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-bold shadow-md shadow-violet-500/20 transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Salvando...' : 'Salvar configurações'}
          </button>
        </div>
      )}
    </motion.div>
  );
}

// ─── Modo do Sistema Tab ──────────────────────────────────────────────────────

function ModoSistemaTab() {
  const { user, business, refreshUser } = useAuth();
  const [saving, setSaving] = useState<UseCase | null>(null);
  const currentUseCase: UseCase = (business?.settings?.useCase as UseCase) || 'servicos';
  const canEdit = ROLE_HIERARCHY[user?.role ?? 'viewer'] >= ROLE_HIERARCHY['admin'];

  const handleSelect = async (useCase: UseCase) => {
    if (!business?.id || useCase === currentUseCase || !canEdit) return;
    setSaving(useCase);
    try {
      await updateDoc(doc(db, 'businesses', business.id), {
        'settings.useCase': useCase,
        updatedAt: new Date().toISOString(),
      });
      await refreshUser();
      toast.success(`Modo alterado para ${USE_CASE_LABELS[useCase]}`);
    } catch (err) {
      console.error('[ModoSistema] Failed to update:', err);
      toast.error('Erro ao alterar modo do sistema');
    } finally {
      setSaving(null);
    }
  };

  const modes: { id: UseCase; icon: React.ElementType; accent: string; modules: string[] }[] = [
    {
      id: 'pedidos',
      icon: ShoppingBag,
      accent: 'from-orange-500 to-red-500',
      modules: ['Pedidos', 'Cardápio', 'Estoque', 'PDV', 'Kanban', 'Financeiro', 'Fiscal'],
    },
    {
      id: 'servicos',
      icon: Calendar,
      accent: 'from-blue-500 to-indigo-500',
      modules: ['Agenda', 'PDV', 'Estoque', 'Kanban', 'Financeiro', 'Fiscal'],
    },
    {
      id: 'simples',
      icon: Sparkles,
      accent: 'from-emerald-500 to-teal-500',
      modules: ['Clientes', 'CRM', 'Conversas', 'Kanban', 'Financeiro'],
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.25 }}
      className="space-y-6"
    >
      <div className="bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-500/10 dark:to-orange-500/5 border border-red-200/60 dark:border-red-500/20 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white dark:bg-gray-900 flex items-center justify-center shadow-sm">
            <Zap className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-0.5">Modo do Sistema</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Escolha o modo que melhor reflete o seu negócio. A interface se adapta automaticamente — módulos irrelevantes ficam ocultos e o dashboard mostra apenas métricas úteis.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {modes.map((mode, i) => {
          const Icon = mode.icon;
          const isActive = currentUseCase === mode.id;
          const isLoading = saving === mode.id;

          return (
            <motion.button
              key={mode.id}
              type="button"
              onClick={() => handleSelect(mode.id)}
              disabled={!!saving}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              whileHover={!isActive && !saving ? { y: -2 } : {}}
              whileTap={!saving ? { scale: 0.98 } : {}}
              className={cn(
                'group relative text-left p-5 rounded-2xl border-2 transition-all overflow-hidden',
                isActive
                  ? 'border-red-500 bg-red-50/50 dark:bg-red-500/10 shadow-lg shadow-red-500/10'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-600',
                saving && !isActive && 'opacity-40 pointer-events-none',
                saving === mode.id && 'opacity-80',
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="usecase-active-indicator"
                  className="absolute top-3 right-3 flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold shadow-sm"
                >
                  <CheckCircle className="w-3 h-3" />
                  ATIVO
                </motion.div>
              )}

              <div className="flex items-start gap-3 mb-3">
                <div
                  className={cn(
                    'w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm bg-gradient-to-br text-white',
                    mode.accent,
                  )}
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Icon className="w-6 h-6" />}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-0.5">{USE_CASE_LABELS[mode.id]}</h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                    {USE_CASE_DESCRIPTIONS[mode.id]}
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
                  Módulos principais
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {mode.modules.map(m => (
                    <span
                      key={m}
                      className={cn(
                        'px-2 py-0.5 rounded-md text-[10px] font-medium',
                        isActive
                          ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
                      )}
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>

      <div className="text-xs text-gray-500 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/40 rounded-xl p-4 flex items-start gap-2">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-gray-400" />
        <p>
          Mudar o modo não apaga dados — apenas ajusta a visibilidade dos módulos e do dashboard. Você pode trocar a qualquer momento sem perder nada.
        </p>
      </div>
    </motion.div>
  );
}

// ─── Sectors Tab ──────────────────────────────────────────────────────────────

function SectorsTab() {
  const { t } = useTranslation();
  const { user, business, refreshUser } = useAuth();
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [members, setMembers] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingSector, setEditingSector] = useState<Sector | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formColor, setFormColor] = useState<string>(SECTOR_COLORS[0]);
  const [formLeaderId, setFormLeaderId] = useState('');
  const [formMemberIds, setFormMemberIds] = useState<string[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<Sector | null>(null);
  const canEdit = ROLE_HIERARCHY[user?.role ?? 'viewer'] >= ROLE_HIERARCHY['admin'];

  // Load sectors and members
  useEffect(() => {
    if (!business?.id) return;
    const qSectors = query(collection(db, 'sectors'), where('businessId', '==', business.id));
    const unsub = onSnapshot(qSectors, (snap) => {
      setSectors(snap.docs.map(d => ({ ...d.data(), id: d.id } as Sector)));
      setLoading(false);
    });
    return () => unsub();
  }, [business?.id]);

  useEffect(() => {
    if (!business?.id) return;
    const qMembers = query(collection(db, 'users'), where('businessId', '==', business.id));
    const unsub = onSnapshot(qMembers, (snap) => {
      setMembers(snap.docs.map(d => ({ ...d.data(), id: d.id } as UserType)));
    });
    return () => unsub();
  }, [business?.id]);

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormColor(SECTOR_COLORS[0]);
    setFormLeaderId('');
    setFormMemberIds([]);
    setEditingSector(null);
    setShowForm(false);
  };

  const openEdit = (sector: Sector) => {
    setEditingSector(sector);
    setFormName(sector.name);
    setFormDescription(sector.description || '');
    setFormColor(sector.color);
    setFormLeaderId(sector.leaderId || '');
    setFormMemberIds(sector.memberIds || []);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!business?.id || !user || !formName.trim() || !canEdit) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const leader = members.find(m => m.uid === formLeaderId);
      const sectorData = {
        businessId: business.id,
        name: formName.trim(),
        description: formDescription.trim() || null,
        color: formColor,
        leaderId: formLeaderId || null,
        leaderName: leader?.name || null,
        memberIds: formMemberIds,
        isActive: true,
        updatedAt: now,
      };

      if (editingSector) {
        await updateDoc(doc(db, 'sectors', editingSector.id), sectorData);
        toast.success(t('settings.sectors.updatedSuccess', 'Setor atualizado'));
      } else {
        await addDoc(collection(db, 'sectors'), { ...sectorData, createdAt: now });
        toast.success(t('settings.sectors.savedSuccess', 'Setor criado'));
      }

      // Update sectorIds on each member
      for (const memberId of formMemberIds) {
        const memberDoc = members.find(m => m.uid === memberId || m.id === memberId);
        if (memberDoc) {
          const currentSectorIds = memberDoc.sectorIds || [];
          const sectorId = editingSector?.id;
          if (sectorId && !currentSectorIds.includes(sectorId)) {
            await setDoc(doc(db, 'users', memberDoc.id), {
              sectorIds: [...currentSectorIds, sectorId],
              updatedAt: now,
            }, { merge: true });
          }
        }
      }

      resetForm();
      refreshUser();
    } catch (err) {
      console.error('Error saving sector:', err);
      toast.error(t('settings.sectors.saveError', 'Erro ao salvar setor'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (sector: Sector) => {
    if (!business?.id || !canEdit) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, 'sectors', sector.id));
      // Remove sector from members' sectorIds
      for (const memberId of sector.memberIds) {
        const member = members.find(m => m.uid === memberId || m.id === memberId);
        if (member?.sectorIds?.includes(sector.id)) {
          await setDoc(doc(db, 'users', member.id), {
            sectorIds: member.sectorIds.filter(s => s !== sector.id),
            updatedAt: new Date().toISOString(),
          }, { merge: true });
        }
      }
      toast.success(t('settings.sectors.deletedSuccess', 'Setor excluído'));
      setDeleteConfirm(null);
      refreshUser();
    } catch (err) {
      console.error('Error deleting sector:', err);
      toast.error(t('settings.sectors.deleteError', 'Erro ao excluir setor'));
    } finally {
      setSaving(false);
    }
  };

  const toggleMember = (uid: string) => {
    setFormMemberIds(prev => prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]);
  };

  const activeSectors = sectors.filter(s => s.isActive);

  if (loading) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
        <div className="h-8 w-48 rounded-xl shimmer" />
        <div className="h-64 rounded-2xl shimmer" />
      </motion.div>
    );
  }

  return (
    <motion.div
      key="setores"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4, transition: { duration: 0.15 } }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-display">Setores / Departamentos</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('settings.sectors.description', 'Organize sua equipe em setores para controle de permissões')}</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-red-600 to-red-500 hover:from-red-700 hover:to-red-600 shadow-lg shadow-red-500/25 transition-all"
        >
          <Plus className="w-4 h-4" />
          Novo Setor
        </button>
      </div>

      {/* Sector List */}
      {activeSectors.length === 0 && !showForm ? (
        <div className="text-center py-16 bg-white dark:bg-[#111827] rounded-2xl border border-gray-200 dark:border-gray-700/50">
          <Layers className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <h4 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('settings.sectors.noSectors', 'Nenhum setor criado')}</h4>
          <p className="text-xs text-gray-400 dark:text-gray-500">{t('settings.sectors.noSectorsDesc', 'Crie setores para organizar sua equipe e controlar permissões')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeSectors.map((sector) => (
            <div
              key={sector.id}
              className="bg-white dark:bg-[#111827] rounded-2xl border border-gray-200 dark:border-gray-700/50 p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm"
                    style={{ backgroundColor: sector.color }}
                  >
                    {sector.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{sector.name}</h4>
                    {sector.description && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{sector.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {sector.memberIds.length} {sector.memberIds.length === 1 ? 'membro' : 'membros'}
                      </span>
                      {sector.leaderName && (
                        <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                          <Crown className="w-3 h-3 text-amber-500" />
                          {sector.leaderName}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => openEdit(sector)}
                    className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-all"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(sector)}
                    className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Member avatars */}
              {sector.memberIds.length > 0 && (
                <div className="flex items-center gap-1 mt-3 flex-wrap">
                  {sector.memberIds.slice(0, 8).map((uid) => {
                    const member = members.find(m => m.uid === uid || m.id === uid);
                    if (!member) return null;
                    return (
                      <div
                        key={uid}
                        className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[10px] font-semibold text-gray-600 dark:text-gray-300 border-2 border-white dark:border-[#111827]"
                        title={member.name}
                      >
                        {member.photoURL ? (
                          <CachedImage src={member.photoURL} alt={member.name} className="w-full h-full rounded-full object-cover" />
                        ) : (
                          (member.name || '?').split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
                        )}
                      </div>
                    );
                  })}
                  {sector.memberIds.length > 8 && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">+{sector.memberIds.length - 8}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Form Dialog */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] px-4 bg-black/40 backdrop-blur-[2px]"
            onClick={(e) => { if (e.target === e.currentTarget) resetForm(); }}
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.97 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200/80 dark:border-gray-700/50 overflow-hidden max-h-[80vh] flex flex-col"
            >
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between flex-shrink-0">
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-display">
                  {editingSector ? 'Editar Setor' : 'Novo Setor'}
                </h3>
                <button onClick={resetForm} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 space-y-5 overflow-y-auto">
                {/* Name */}
                <FormField label={t('settings.sectors.sectorName', 'Nome do Setor')} icon={Layers}>
                  <input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder={t('settings.sectors.sectorNamePlaceholder', 'Ex: Comercial, Suporte, Marketing...')}
                    className={inputClasses}
                  />
                </FormField>

                {/* Description */}
                <FormField label={t('settings.sectors.sectorDesc', 'Descrição')} icon={FileText}>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder={t('settings.sectors.sectorDescPlaceholder', 'Descrição opcional do setor...')}
                    rows={2}
                    className={cn(inputClasses, 'resize-none')}
                  />
                </FormField>

                {/* Color */}
                <FormField label={t('settings.sectors.color', 'Cor')} icon={Palette}>
                  <div className="flex items-center gap-2 flex-wrap">
                    {SECTOR_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setFormColor(c)}
                        className={cn(
                          'w-7 h-7 rounded-full transition-transform',
                          formColor === c && 'outline outline-2 outline-offset-2 scale-110'
                        )}
                        style={{ backgroundColor: c, outlineColor: c }}
                      />
                    ))}
                  </div>
                </FormField>

                {/* Leader */}
                <FormField label={t('settings.sectors.leader', 'Líder do Setor')} icon={Crown}>
                  <select
                    value={formLeaderId}
                    onChange={(e) => setFormLeaderId(e.target.value)}
                    className={selectClasses}
                  >
                    <option value="">{t('settings.sectors.noLeader', 'Sem líder definido')}</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.uid}>{m.name} ({ROLE_LABELS[m.role]})</option>
                    ))}
                  </select>
                </FormField>

                {/* Members */}
                <FormField label={t('settings.sectors.members', 'Membros')} icon={Users}>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700/50 p-2">
                    {members.map((m) => (
                      <label
                        key={m.id}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors',
                          formMemberIds.includes(m.uid)
                            ? 'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20'
                            : 'hover:bg-gray-50 dark:hover:bg-white/[0.04] border border-transparent'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={formMemberIds.includes(m.uid)}
                          onChange={() => toggleMember(m.uid)}
                          className="sr-only"
                        />
                        <div className={cn(
                          'w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all',
                          formMemberIds.includes(m.uid)
                            ? 'bg-red-500 border-red-500 text-white'
                            : 'border-gray-300 dark:border-gray-600'
                        )}>
                          {formMemberIds.includes(m.uid) && <Check className="w-3 h-3" />}
                        </div>
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[10px] font-semibold text-gray-600 dark:text-gray-300">
                            {m.photoURL ? (
                              <CachedImage src={m.photoURL} alt={m.name} className="w-full h-full rounded-full object-cover" />
                            ) : (
                              (m.name || '?').split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{m.name}</p>
                            <p className="text-[10px] text-gray-400 dark:text-gray-500">{ROLE_LABELS[m.role]}</p>
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                    {formMemberIds.length} {formMemberIds.length === 1 ? 'membro selecionado' : 'membros selecionados'}
                  </p>
                </FormField>
              </div>

              {/* Actions */}
              <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end gap-2 flex-shrink-0">
                <button
                  onClick={resetForm}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
                >
                  Cancelar
                </button>
                <SaveButton
                  onClick={handleSave}
                  loading={saving}
                  label={editingSector ? 'Salvar Alterações' : 'Criar Setor'}
                  disabled={!formName.trim()}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40 backdrop-blur-[2px]"
            onClick={(e) => { if (e.target === e.currentTarget) setDeleteConfirm(null); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm border border-gray-200/80 dark:border-gray-700/50 p-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">Excluir Setor</h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings.sectors.deleteWarning', 'Esta ação não pode ser desfeita')}</p>
                </div>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
                Deseja excluir o setor <strong>{deleteConfirm.name}</strong> e remover todos os {deleteConfirm.memberIds.length} membros?
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirm)}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-60"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Excluir
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function StatusBadge({ status }: { status: IntegrationStatus }) {
  const { t } = useTranslation();
  const cfg = {
    connected:    { label: t('settings.enterprise.integrationStatusConnected', 'Conectado'),    className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' },
    disconnected: { label: t('settings.enterprise.statusDisconnected',         'Desconectado'), className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
    error:        { label: t('settings.enterprise.statusError',                'Erro'),         className: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400' },
    pending:      { label: t('settings.enterprise.statusPending',              'Pendente'),     className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' },
  };
  const c = cfg[status];
  return <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', c.className)}>{c.label}</span>;
}

function EnterpriseTab() {
  const { t } = useTranslation();
  const { user, business, refreshUser } = useAuth();

  // ── Enterprise mode state ──
  const [isEnterprise, setIsEnterprise] = useState(false);
  const [loadingEnterprise, setLoadingEnterprise] = useState(true);

  // ── Integration state ──
  const [integrations, setIntegrations] = useState<Record<string, IntegrationConfig>>({});
  const [keyValues, setKeyValues] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  // ── API Key management state ──
  const [apiKeys, setApiKeys] = useState<SaasApiKey[]>([]);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<ApiKeyScope[]>([]);
  const [newKeyExpiration, setNewKeyExpiration] = useState('90');
  const [generatingKey, setGeneratingKey] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);

  // ── Load enterprise settings ──
  useEffect(() => {
    if (!business) return;
    const enterprise = (business as Business & { enterprise?: EnterpriseSettings }).enterprise;
    if (enterprise) {
      setIsEnterprise(enterprise.isEnabled || false);
      const intMap: Record<string, IntegrationConfig> = {};
      (enterprise.integrations || []).forEach(i => { intMap[i.provider] = i; });
      setIntegrations(intMap);

      // Pre-fill key values from existing integrations
      const vals: Record<string, string> = {};
      (enterprise.integrations || []).forEach(i => {
        const provider = INTEGRATION_PROVIDERS[i.provider];
        if (provider) {
          provider.fields.forEach(f => {
            vals[`${i.provider}_${f.key}`] = (i.metadata?.[f.key] as string) || (f.key === 'apiKey' ? i.apiKey : '');
          });
        }
      });
      setKeyValues(vals);
    }
    setLoadingEnterprise(false);
  }, [business]);

  // ── Load API keys ──
  useEffect(() => {
    if (!business?.id) return;
    const q = query(
      collection(db, 'saasApiKeys'),
      where('businessId', '==', business.id),
    );
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ ...d.data(), id: d.id }) as SaasApiKey);
      data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setApiKeys(data);
    });
    return () => unsub();
  }, [business?.id]);

  // ── Toggle enterprise mode ──
  const toggleEnterprise = async () => {
    if (!business) return;
    const newValue = !isEnterprise;
    setIsEnterprise(newValue);
    try {
      await updateDoc(doc(db, 'businesses', business.id), {
        'enterprise.isEnabled': newValue,
        'enterprise.enabledAt': newValue ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString(),
      });
      toast.success(newValue ? 'Modo Enterprise ativado!' : 'Modo Enterprise desativado');
    } catch {
      setIsEnterprise(!newValue);
      toast.error(t('settings.enterprise.toggleError', 'Erro ao alterar modo Enterprise'));
    }
  };

  // ── Integration handlers ──
  const handleKeyChange = (providerId: string, fieldKey: string, value: string) => {
    setKeyValues(prev => ({ ...prev, [`${providerId}_${fieldKey}`]: value }));
  };

  const toggleShowKey = (providerId: string) => {
    setShowKeys(prev => ({ ...prev, [providerId]: !prev[providerId] }));
  };

  const saveIntegration = async (providerId: string) => {
    if (!business) return;
    setSaving(providerId);
    try {
      const provider = INTEGRATION_PROVIDERS[providerId as IntegrationProvider];
      const apiKeyValue = keyValues[`${providerId}_apiKey`] || '';
      const metadata: Record<string, unknown> = {};
      provider.fields.forEach(f => {
        if (f.key !== 'apiKey') {
          metadata[f.key] = keyValues[`${providerId}_${f.key}`] || '';
        }
      });

      const config: IntegrationConfig = {
        provider: providerId as IntegrationProvider,
        apiKey: apiKeyValue,
        isActive: !!apiKeyValue,
        connectedAt: apiKeyValue ? new Date().toISOString() : undefined,
        status: apiKeyValue ? 'connected' : 'disconnected',
        metadata,
      };

      // Update the integrations array in enterprise settings
      const currentEnterprise = (business as Business & { enterprise?: EnterpriseSettings }).enterprise;
      const currentIntegrations = currentEnterprise?.integrations || [];
      const filteredIntegrations = currentIntegrations.filter(i => i.provider !== providerId);
      const newIntegrations = [...filteredIntegrations, config];

      await updateDoc(doc(db, 'businesses', business.id), {
        'enterprise.integrations': newIntegrations,
        updatedAt: new Date().toISOString(),
      });

      setIntegrations(prev => ({ ...prev, [providerId]: config }));
      await refreshUser();
      toast.success(`${provider.name} salvo com sucesso!`);
    } catch {
      toast.error('Erro ao salvar integração');
    } finally {
      setSaving(null);
    }
  };

  const testConnection = async (providerId: string) => {
    setTesting(providerId);
    try {
      // Simulate connection test
      await new Promise(resolve => setTimeout(resolve, 1500));
      const apiKey = keyValues[`${providerId}_apiKey`] || '';
      if (apiKey.length > 5) {
        toast.success('Conexão estabelecida com sucesso!');
      } else {
        toast.error('Falha na conexão. Verifique a API Key.');
      }
    } catch {
      toast.error(t('settings.enterprise.testFatal', 'Erro ao testar conexão'));
    } finally {
      setTesting(null);
    }
  };

  // ── API Key handlers ──
  const generateApiKey = (): string => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const prefix = 'sp_live_';
    const keyBody = Array.from({ length: 40 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return prefix + keyBody;
  };

  const hashKey = async (key: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(key);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleGenerateApiKey = async () => {
    if (!business || !user || !newKeyName.trim() || newKeyScopes.length === 0) {
      toast.error(t('settings.enterprise.validationError', 'Preencha o nome e selecione pelo menos um escopo'));
      return;
    }
    setGeneratingKey(true);
    try {
      const fullKey = generateApiKey();
      const keyHash = await hashKey(fullKey);
      const keyPrefix = fullKey.substring(0, 12);

      let expiresAt: string | undefined;
      if (newKeyExpiration !== 'never') {
        const days = parseInt(newKeyExpiration);
        expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
      }

      await addDoc(collection(db, 'saasApiKeys'), {
        name: newKeyName.trim(),
        keyPrefix,
        keyHash,
        scopes: newKeyScopes,
        createdAt: new Date().toISOString(),
        createdBy: user.uid,
        createdByName: user.name,
        status: 'active',
        businessId: business.id,
        ...(expiresAt && { expiresAt }),
      });

      setGeneratedKey(fullKey);
      toast.success(t('settings.enterprise.keySuccess', 'API Key gerada com sucesso!'));
    } catch {
      toast.error(t('settings.enterprise.keyError', 'Erro ao gerar API Key'));
    } finally {
      setGeneratingKey(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!confirm(t('settings.enterprise.revokeConfirm', 'Tem certeza que deseja revogar esta API Key? Esta ação não pode ser desfeita.'))) return;
    setRevokingKeyId(keyId);
    try {
      await deleteDoc(doc(db, 'saasApiKeys', keyId));
      toast.success(t('settings.enterprise.revokeSuccess', 'API Key revogada com sucesso'));
    } catch {
      toast.error(t('settings.enterprise.revokeErrorMsg', 'Erro ao revogar API Key'));
    } finally {
      setRevokingKeyId(null);
    }
  };

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key).then(() => {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    });
  };

  const closeGenerateModal = () => {
    setShowGenerateModal(false);
    setNewKeyName('');
    setNewKeyScopes([]);
    setNewKeyExpiration('90');
    setGeneratedKey(null);
    setCopiedKey(false);
  };

  const toggleScope = (scope: ApiKeyScope) => {
    setNewKeyScopes(prev =>
      prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]
    );
  };

  if (loadingEnterprise) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
        <div className="h-32 rounded-2xl shimmer" />
        <div className="h-64 rounded-2xl shimmer" />
      </motion.div>
    );
  }

  return (
    <motion.div
      key="enterprise"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      className="space-y-6"
    >
      {/* ── Enterprise Mode Toggle ── */}
      <div className="relative overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700/50 shadow-sm dark:shadow-black/10">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50 dark:from-violet-950/30 dark:via-purple-950/20 dark:to-fuchsia-950/10" />
        <div className="relative p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
                <Blocks className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white font-display">Modo Enterprise</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-md">
                  Ative para desbloquear integrações com provedores externos, gerenciamento de API Keys e funcionalidades avançadas para sua empresa.
                </p>
              </div>
            </div>
            <button
              onClick={toggleEnterprise}
              className={cn(
                'relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-300 flex-shrink-0',
                isEnterprise ? 'bg-gradient-to-r from-violet-500 to-purple-500' : 'bg-gray-300 dark:bg-gray-600'
              )}
            >
              <span className={cn(
                'inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform duration-300',
                isEnterprise ? 'translate-x-6' : 'translate-x-1'
              )} />
            </button>
          </div>
          {isEnterprise && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mt-4 flex items-center gap-2 text-sm"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span className="text-emerald-700 dark:text-emerald-400 font-medium">{t('settings.enterprise.active', 'Modo Enterprise ativo')}</span>
            </motion.div>
          )}
        </div>
      </div>

      {/* ── Integrations Section (only when enterprise is enabled) ── */}
      <AnimatePresence>
        {isEnterprise && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="space-y-6"
          >
            {/* Integration List */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Plug className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Integrações</h3>
                  <span className="text-[11px] text-gray-400 dark:text-gray-500 ml-1">
                    {Object.values(integrations).filter(i => i.isActive).length} de {Object.keys(INTEGRATION_PROVIDERS).length} conectadas
                  </span>
                </div>
              </div>
              <div className="rounded-2xl border border-gray-200 dark:border-gray-700/50 bg-white dark:bg-[#111827] overflow-hidden divide-y divide-gray-100 dark:divide-gray-800/60">
                {(Object.entries(INTEGRATION_PROVIDERS) as [IntegrationProvider, typeof INTEGRATION_PROVIDERS[IntegrationProvider]][]).map(([providerId, provider]) => (
                  <IntegrationRow
                    key={providerId}
                    providerId={providerId}
                    provider={provider}
                    config={integrations[providerId]}
                    keyValues={keyValues}
                    showKeys={showKeys}
                    saving={saving}
                    testing={testing}
                    onKeyChange={handleKeyChange}
                    onToggleShowKey={toggleShowKey}
                    onSave={saveIntegration}
                    onTest={testConnection}
                  />
                ))}
              </div>
            </div>

            {/* ── API Keys Section ── */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Key className="w-4.5 h-4.5 text-gray-500 dark:text-gray-400" />
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">API Keys do Aevo</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings.enterprise.apiKeysDesc', 'Gere chaves para agentes de IA operarem o sistema via REST API')}</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowGenerateModal(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 text-white text-xs font-semibold shadow-md shadow-violet-500/25 hover:from-violet-600 hover:to-purple-600 transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Nova API Key
                </button>
              </div>

              {/* Existing keys list */}
              {apiKeys.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center bg-white dark:bg-[#111827] rounded-2xl border border-gray-200 dark:border-gray-700/50">
                  <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
                    <Key className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                  </div>
                  <p className="text-sm text-gray-400 dark:text-gray-500">{t('settings.enterprise.noApiKeys', 'Nenhuma API Key gerada.')}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('settings.enterprise.noApiKeysDesc', 'Clique em "Nova API Key" para criar uma.')}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <AnimatePresence>
                    {apiKeys.map((ak, i) => (
                      <motion.div
                        key={ak.id}
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        transition={{ delay: i * 0.04, duration: 0.2 }}
                        className="bg-white dark:bg-[#111827] rounded-2xl border border-gray-200 dark:border-gray-700/50 shadow-sm dark:shadow-black/10 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-semibold text-gray-900 dark:text-white">{ak.name}</span>
                              <span className={cn(
                                'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                                ak.status === 'active'
                                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                                  : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
                              )}>
                                {ak.status === 'active' ? 'Ativa' : 'Revogada'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mb-2">
                              <code className="text-xs font-mono text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md">
                                {ak.keyPrefix}••••••••
                              </code>
                            </div>
                            <div className="flex flex-wrap gap-1 mb-2">
                              {ak.scopes.map(scope => (
                                <span key={scope} className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400">
                                  {API_KEY_SCOPES[scope]?.label || scope}
                                </span>
                              ))}
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-gray-400 dark:text-gray-500">
                              <span>Criada {formatDate(ak.createdAt)}</span>
                              {ak.lastUsedAt && <span>Usada {formatDate(ak.lastUsedAt)}</span>}
                              {ak.expiresAt && (
                                <span className={cn(
                                  new Date(ak.expiresAt).getTime() < Date.now() && 'text-red-500 dark:text-red-400 font-medium',
                                )}>
                                  Expira {formatDate(ak.expiresAt)}
                                </span>
                              )}
                              <span>por {ak.createdByName}</span>
                            </div>
                          </div>
                          {ak.status === 'active' && (
                            <button
                              onClick={() => handleRevokeKey(ak.id)}
                              disabled={revokingKeyId === ak.id}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50"
                            >
                              {revokingKeyId === ak.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                              Revogar
                            </button>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}

              {/* API Documentation Reference */}
              <div className="mt-6 p-4 rounded-2xl bg-gradient-to-br from-gray-50 to-gray-100/50 dark:from-gray-800/50 dark:to-gray-900/30 border border-gray-200 dark:border-gray-700/50">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                    <Zap className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white">REST API para Agentes de IA</h4>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Base URL: <code className="font-mono text-violet-600 dark:text-violet-400">/api/v1/</code></p>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[11px]">
                  {[
                    { method: 'GET/POST/PUT/DEL', path: '/clients', desc: 'Clientes' },
                    { method: 'GET/POST/PUT/DEL', path: '/appointments', desc: 'Agenda' },
                    { method: 'GET/POST/PUT/DEL', path: '/services', desc: 'Serviços' },
                    { method: 'GET/POST/PUT/DEL', path: '/products', desc: 'Produtos' },
                    { method: 'GET/POST', path: '/stock-movements', desc: 'Estoque' },
                    { method: 'GET/POST', path: '/sales', desc: 'Vendas (PDV)' },
                    { method: 'GET/POST/PUT/DEL', path: '/transactions', desc: 'Financeiro' },
                    { method: 'GET/POST/PUT/DEL', path: '/bank-accounts', desc: 'Contas' },
                    { method: 'GET/POST/PUT/DEL', path: '/kanban/boards', desc: 'Kanban Boards' },
                    { method: 'GET/POST/PUT/DEL', path: '/kanban/cards', desc: 'Kanban Cards' },
                    { method: 'GET/POST/PUT/DEL', path: '/crm/contacts', desc: 'CRM Contatos' },
                    { method: 'GET/POST/PUT/DEL', path: '/crm/deals', desc: 'CRM Deals' },
                    { method: 'GET/POST/PUT/DEL', path: '/crm/activities', desc: 'CRM Atividades' },
                    { method: 'GET/PUT', path: '/conversations', desc: 'Conversas' },
                    { method: 'GET', path: '/conversations/messages', desc: 'Mensagens' },
                    { method: 'POST', path: '/conversations/send', desc: 'Enviar msg' },
                    { method: 'GET', path: '/fiscal/documents', desc: 'Fiscal' },
                    { method: 'GET/POST/PUT/DEL', path: '/broadcasts', desc: 'Campanhas' },
                    { method: 'GET/POST/PUT/DEL', path: '/segments', desc: 'Segmentos' },
                    { method: 'GET/POST/PUT/DEL', path: '/snippets', desc: 'Respostas' },
                    { method: 'GET/POST/PUT/DEL', path: '/sectors', desc: 'Setores' },
                    { method: 'GET/PUT', path: '/users', desc: 'Usuários' },
                  ].map(ep => (
                    <div key={ep.path} className="px-2 py-1.5 rounded-lg bg-white dark:bg-white/[0.03] border border-gray-200 dark:border-gray-700/50">
                      <code className="font-mono text-violet-600 dark:text-violet-400">{ep.path}</code>
                      <p className="text-gray-500 dark:text-gray-400">{ep.desc}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 p-3 rounded-xl bg-gray-900 dark:bg-gray-800 border border-gray-700">
                  <p className="text-[10px] font-semibold text-gray-400 mb-1.5">{t('settings.enterprise.apiDocDesc', 'Exemplo de uso (cURL):')}</p>
                  <code className="text-[11px] font-mono text-emerald-400 leading-relaxed break-all">
                    {`curl -H "Authorization: Bearer sp_live_..." /api/v1/clients?limit=10`}
                  </code>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Generate API Key Modal ── */}
      <AnimatePresence>
        {showGenerateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={closeGenerateModal}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-lg bg-white dark:bg-[#111827] rounded-2xl border border-gray-200 dark:border-gray-700/50 shadow-2xl overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                    <Key className="w-4.5 h-4.5 text-white" />
                  </div>
                  <h3 className="text-base font-bold text-gray-900 dark:text-white font-display">
                    {generatedKey ? 'API Key Gerada' : 'Nova API Key'}
                  </h3>
                </div>
                <button onClick={closeGenerateModal} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal body */}
              <div className="p-6 space-y-5">
                {generatedKey ? (
                  // ── Show generated key (only once) ──
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/20 flex items-start gap-3">
                      <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-amber-700 dark:text-amber-300">
                        Copie esta chave agora. Ela não será exibida novamente.
                      </p>
                    </div>
                    <div className="relative">
                      <div className="p-3 rounded-xl bg-gray-900 dark:bg-gray-800 border border-gray-700 font-mono text-sm text-emerald-400 break-all">
                        {generatedKey}
                      </div>
                      <button
                        onClick={() => handleCopyKey(generatedKey)}
                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-gray-800 dark:bg-gray-700 text-gray-400 hover:text-white transition-colors"
                      >
                        {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    {copiedKey && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Copiado para a área de transferência
                      </p>
                    )}
                    <button
                      onClick={closeGenerateModal}
                      className="w-full py-2.5 text-sm font-semibold rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 text-white hover:from-violet-600 hover:to-purple-600 transition-all"
                    >
                      Concluído
                    </button>
                  </div>
                ) : (
                  // ── Key creation form ──
                  <>
                    {/* Name */}
                    <FormField label={t('settings.enterprise.keyName', 'Nome da chave')} icon={Key}>
                      <input
                        type="text"
                        value={newKeyName}
                        onChange={e => setNewKeyName(e.target.value)}
                        placeholder={t('settings.enterprise.keyNamePlaceholder', 'Ex: Integração ERP, App Mobile...')}
                        className={inputClasses}
                      />
                    </FormField>

                    {/* Scopes */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                          <Lock className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                          Escopos de acesso
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            const allScopes = Object.keys(API_KEY_SCOPES) as ApiKeyScope[];
                            setNewKeyScopes(newKeyScopes.length === allScopes.length ? [] : allScopes);
                          }}
                          className="text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:underline"
                        >
                          {newKeyScopes.length === Object.keys(API_KEY_SCOPES).length ? 'Desmarcar todos' : 'Selecionar todos'}
                        </button>
                      </div>
                      <div className="max-h-56 overflow-y-auto pr-1 space-y-3">
                        {API_KEY_SCOPE_GROUPS.map(group => (
                          <div key={group.label}>
                            <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">{group.label}</p>
                            <div className="grid grid-cols-2 gap-1.5">
                              {group.scopes.map(scope => {
                                const info = API_KEY_SCOPES[scope];
                                return (
                                  <button
                                    key={scope}
                                    type="button"
                                    onClick={() => toggleScope(scope)}
                                    className={cn(
                                      'text-left px-3 py-2 rounded-xl border text-xs transition-all',
                                      newKeyScopes.includes(scope)
                                        ? 'border-violet-400 dark:border-violet-500/50 bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300'
                                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-white/[0.03] text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600',
                                    )}
                                  >
                                    <span className="font-semibold">{info?.label || scope}</span>
                                    <p className="text-[10px] opacity-70 mt-0.5">{info?.description || ''}</p>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Expiration */}
                    <FormField label={t('settings.enterprise.expiration', 'Expiração')} icon={Clock}>
                      <select
                        value={newKeyExpiration}
                        onChange={e => setNewKeyExpiration(e.target.value)}
                        className={selectClasses}
                      >
                        <option value="30">{t('settings.enterprise.exp30', '30 dias')}</option>
                        <option value="90">{t('settings.enterprise.exp90', '90 dias')}</option>
                        <option value="180">{t('settings.enterprise.exp180', '180 dias')}</option>
                        <option value="never">{t('settings.enterprise.expNever', 'Nunca expira')}</option>
                      </select>
                    </FormField>

                    {/* Generate */}
                    <button
                      onClick={handleGenerateApiKey}
                      disabled={generatingKey || !newKeyName.trim() || newKeyScopes.length === 0}
                      className="w-full py-2.5 text-sm font-semibold rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 text-white hover:from-violet-600 hover:to-purple-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {generatingKey ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Gerando...</>
                      ) : (
                        <><Zap className="w-4 h-4" />{t('settings.enterprise.generateKey', 'Gerar API Key')}</>
                      )}
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CANAIS TAB
// ═══════════════════════════════════════════════════════════════════════════════

interface ChannelConfig {
  whatsapp?: {
    phoneNumberId?: string;
    businessAccountId?: string;
    accessToken?: string;
    displayPhoneNumber?: string;
    isConnected: boolean;
    connectedAt?: string;
    disconnectedAt?: string;
    connectedVia?: string;
  };
  facebook?: {
    pageId?: string;
    pageAccessToken?: string;
    pageName?: string;
    isConnected: boolean;
    connectedAt?: string;
    disconnectedAt?: string;
  };
  instagram?: {
    accountId?: string;
    accountName?: string;
    isConnected: boolean;
    connectedAt?: string;
    disconnectedAt?: string;
  };
  meta?: {
    appId?: string;
    appSecret?: string;
    webhookVerifyToken?: string;
  };
  connectedVia?: string;
}

function CanaisTab() {
  const { t } = useTranslation();
  const { business, refreshUser, firebaseUser } = useAuth();

  // ── Channel connection state ──
  const [waConnected, setWaConnected] = useState(false);
  const [fbConnected, setFbConnected] = useState(false);
  const [igConnected, setIgConnected] = useState(false);

  const [waPhoneNumber, setWaPhoneNumber] = useState('');
  const [fbPageName, setFbPageName] = useState('');
  const [igAccountName, setIgAccountName] = useState('');

  // ── UI state ──
  const [loading, setLoading] = useState(true);
  const [connectingChannel, setConnectingChannel] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [needsAttention, setNeedsAttention] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [forceReconnect, setForceReconnect] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [waConnecting, setWaConnecting] = useState(false);
  const [waStatus, setWaStatus] = useState<'idle' | 'connecting' | 'scanning' | 'connected'>('idle');

  // ── FB SDK loader (shared) ──
  const ensureFbSdk = async (): Promise<{ login: (cb: (r: { authResponse?: { accessToken?: string; code?: string } }) => void, opts: Record<string, unknown>) => void }> => {
    const metaAppId = process.env.NEXT_PUBLIC_META_APP_ID;
    if (!metaAppId) throw new Error('Meta App ID nao configurado');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    if (!win.FB) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://connect.facebook.net/en_US/sdk.js';
        script.async = true;
        script.defer = true;
        script.onload = () => {
          win.FB.init({ appId: metaAppId, cookie: true, xfbml: true, version: 'v21.0' });
          resolve();
        };
        script.onerror = () => reject(new Error('Failed to load FB SDK'));
        document.body.appendChild(script);
      });
    }
    return win.FB;
  };

  // ── Channel-specific OAuth ──
  const handleConnectChannel = async (channel: 'facebook' | 'instagram' | 'whatsapp') => {
    setConnectingChannel(channel);
    try {
      const FB = await ensureFbSdk();

      const scopes: Record<string, string[]> = {
        facebook: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'],
        instagram: ['instagram_business_basic', 'instagram_business_manage_messages', 'pages_show_list', 'pages_manage_metadata'],
        whatsapp: ['whatsapp_business_messaging'],
      };

      const channelLabels: Record<string, string> = {
        facebook: 'Facebook Messenger',
        instagram: 'Instagram',
        whatsapp: 'WhatsApp Cloud API',
      };

      FB.login(
        (response) => {
          (async () => {
            const accessToken = response.authResponse?.accessToken;
            if (accessToken) {
              try {
                const idToken = await firebaseUser?.getIdToken();
                const res = await fetch('/api/channels/meta-signup', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {}),
                  },
                  body: JSON.stringify({
                    accessToken,
                    businessId: business?.id,
                  }),
                });
                const data = await res.json();

                if (data.success && data.channels) {
                  if (data.channels.facebook) {
                    setFbConnected(true);
                    setFbPageName(data.channels.facebook.pageName || data.channels.facebook.pageId || '');
                  }
                  if (data.channels.instagram) {
                    setIgConnected(true);
                    setIgAccountName(data.channels.instagram.accountName || data.channels.instagram.accountId || '');
                  }
                  if (data.channels.whatsapp) {
                    setWaConnected(true);
                    setWaPhoneNumber(data.channels.whatsapp.displayPhoneNumber || data.channels.whatsapp.phoneNumberId || '');
                  }
                  await refreshUser();
                  toast.success(`${channelLabels[channel]} conectado!`);
                } else {
                  toast.error(data.error || 'Erro ao conectar canal');
                }
              } catch {
                toast.error('Erro ao processar a conexao');
              }
            } else {
              toast.info('Conexao cancelada pelo usuario');
            }
            setConnectingChannel(null);
          })();
        },
        {
          scope: scopes[channel].join(','),
        },
      );
    } catch (err) {
      console.error('Channel connect error:', err);
      toast.error('Erro ao iniciar a conexao');
      setConnectingChannel(null);
    }
  };

  // ── Disconnect channel ──
  const handleDisconnect = async (channel: 'whatsapp' | 'facebook' | 'instagram') => {
    if (!business) return;
    setDisconnecting(channel);
    try {
      await updateDoc(doc(db, 'businesses', business.id), {
        [`channels.${channel}.isConnected`]: false,
        [`channels.${channel}.disconnectedAt`]: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      if (channel === 'whatsapp') { setWaConnected(false); setWaPhoneNumber(''); }
      if (channel === 'facebook') { setFbConnected(false); setFbPageName(''); }
      if (channel === 'instagram') { setIgConnected(false); setIgAccountName(''); }
      await refreshUser();
      toast.success(`${channel === 'whatsapp' ? 'WhatsApp' : channel === 'facebook' ? 'Facebook' : 'Instagram'} desconectado`);
    } catch {
      toast.error('Erro ao desconectar canal');
    } finally {
      setDisconnecting(null);
    }
  };

  // ── Load existing channel config ──
  useEffect(() => {
    if (!business) return;
    const channels = (business as Business & { channels?: ChannelConfig }).channels;
    let attention = false;
    if (channels) {
      if (channels.whatsapp) {
        setWaConnected(channels.whatsapp.isConnected || false);
        setWaPhoneNumber(channels.whatsapp.displayPhoneNumber || channels.whatsapp.phoneNumberId || '');
      }
      if (channels.facebook) {
        const fb = channels.facebook;
        setFbConnected(fb.isConnected || false);
        setFbPageName(fb.pageName || fb.pageId || '');
        // Detect expired or missing token
        if (fb.isConnected && !fb.pageAccessToken) attention = true;
        const fbExpiry = (fb as unknown as Record<string, unknown>).tokenExpiresAt as string | undefined;
        if (fb.isConnected && fbExpiry && Date.now() > new Date(fbExpiry).getTime()) attention = true;
      }
      if (channels.instagram) {
        setIgConnected(channels.instagram.isConnected || false);
        setIgAccountName(channels.instagram.accountName || channels.instagram.accountId || '');
      }
    }
    setNeedsAttention(attention);
    setLoading(false);
  }, [business]);

  if (loading) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
        <div className="h-32 rounded-2xl shimmer" />
        <div className="h-64 rounded-2xl shimmer" />
      </motion.div>
    );
  }

  return (
    <motion.div
      key="canais"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      className="space-y-6"
    >
      {/* ── Header ── */}
      <div className="relative overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700/50 shadow-sm dark:shadow-black/10">
        <div className="absolute inset-0 bg-gradient-to-br from-red-50 via-rose-50 to-orange-50 dark:from-red-950/30 dark:via-rose-950/20 dark:to-orange-950/10" />
        <div className="relative p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-600 to-red-500 flex items-center justify-center shadow-lg shadow-red-500/25">
              <MessageCircle className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white font-display">{t('settings.channelsTab.title', 'Canais de Comunicação')}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-md">
                {t('settings.channelsTab.description', 'Conecte cada canal individualmente para centralizar o atendimento ao cliente.')}
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <span className={cn('w-2 h-2 rounded-full', fbConnected ? 'bg-emerald-400' : 'bg-gray-300 dark:bg-gray-600')} />
              <span className="text-gray-600 dark:text-gray-400">Messenger</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={cn('w-2 h-2 rounded-full', igConnected ? 'bg-emerald-400' : 'bg-gray-300 dark:bg-gray-600')} />
              <span className="text-gray-600 dark:text-gray-400">Instagram</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={cn('w-2 h-2 rounded-full', waConnected ? 'bg-emerald-400' : 'bg-gray-300 dark:bg-gray-600')} />
              <span className="text-gray-600 dark:text-gray-400">WhatsApp</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Attention Banner ── */}
      {needsAttention && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 p-4 rounded-2xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/[0.06]"
        >
          <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-500/15 flex items-center justify-center shrink-0 mt-0.5">
            <AlertTriangle className="w-4.5 h-4.5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">{t('settings.channelsTab.attention', 'Conexão precisa de atenção')}</p>
            <p className="text-xs text-amber-700/80 dark:text-amber-400/70 mt-0.5 leading-relaxed">
              <span dangerouslySetInnerHTML={{ __html: t('settings.channelsTab.attentionDesc', 'Sua conexão com o Meta expirou ou está incompleta. Clique em <strong>Reconectar</strong> no canal afetado para garantir o envio de mensagens.') }} />
            </p>
          </div>
        </motion.div>
      )}

      {/* ── Facebook Messenger Card ── */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700/50 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="p-5 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className={cn(
              'w-11 h-11 rounded-xl flex items-center justify-center',
              fbConnected
                ? 'bg-gradient-to-br from-[#0866FF] to-[#0052CC] shadow-sm shadow-blue-500/20'
                : 'bg-[#0866FF]/10'
            )}>
              <Facebook className={cn('w-5 h-5', fbConnected ? 'text-white' : 'text-[#0866FF]')} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Facebook Messenger</span>
                {fbConnected && !needsAttention && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
                    <Check className="w-2.5 h-2.5" /> {t('settings.channelsTab.connected', 'Conectado')}
                  </span>
                )}
                {fbConnected && needsAttention && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20">
                    <AlertTriangle className="w-2.5 h-2.5" /> {t('settings.channelsTab.requiresAttention', 'Requer atenção')}
                  </span>
                )}
              </div>
              {fbConnected && fbPageName ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('settings.channelsTab.page', 'Página')}: {fbPageName}</p>
              ) : (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t('settings.channelsTab.fbDesc', 'Receba e responda mensagens do Messenger')}</p>
              )}
            </div>
          </div>
          {fbConnected && needsAttention ? (
            <button
              onClick={() => handleConnectChannel('facebook')}
              disabled={connectingChannel === 'facebook'}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white transition-all',
                'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600',
                'shadow-sm shadow-amber-500/20 hover:shadow-md animate-pulse hover:animate-none',
                'disabled:opacity-60 disabled:cursor-not-allowed',
              )}
            >
              {connectingChannel === 'facebook' ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('settings.channelsTab.reconnecting', 'Reconectando...')}</>
              ) : (
                <><RefreshCw className="w-3.5 h-3.5" /> {t('settings.channelsTab.reconnect', 'Reconectar')}</>
              )}
            </button>
          ) : fbConnected ? (
            <button
              onClick={() => handleDisconnect('facebook')}
              disabled={disconnecting === 'facebook'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              {disconnecting === 'facebook' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('settings.channelsTab.disconnect', 'Desconectar')}
            </button>
          ) : (
            <button
              onClick={() => handleConnectChannel('facebook')}
              disabled={connectingChannel === 'facebook'}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white transition-all',
                'bg-[#0866FF] hover:bg-[#0052CC] shadow-sm shadow-blue-500/20 hover:shadow-md',
                'disabled:opacity-60 disabled:cursor-not-allowed',
              )}
            >
              {connectingChannel === 'facebook' ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('settings.channelsTab.connecting', 'Conectando...')}</>
              ) : (
                <><Facebook className="w-3.5 h-3.5" /> {t('settings.channelsTab.connectMessenger', 'Conectar Messenger')}</>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ── Instagram Direct Card ── */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700/50 bg-white dark:bg-[#111827] overflow-hidden relative">
        <div className="p-5 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className={cn(
              'w-11 h-11 rounded-xl flex items-center justify-center',
              igConnected
                ? 'bg-gradient-to-br from-[#E1306C] to-[#C13584] shadow-sm shadow-pink-500/20'
                : 'bg-[#E1306C]/10'
            )}>
              <Instagram className={cn('w-5 h-5', igConnected ? 'text-white' : 'text-[#E1306C]')} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Instagram Direct</span>
                {igConnected ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
                    <Check className="w-2.5 h-2.5" /> {t('settings.channelsTab.connected', 'Conectado')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-gray-400">
                    {t('settings.channelsTab.notConnected', 'Não conectado')}
                  </span>
                )}
              </div>
              {igConnected && igAccountName ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('settings.channelsTab.account', 'Conta')}: {igAccountName}</p>
              ) : (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t('settings.channelsTab.igDesc', 'DMs e comentários do Instagram')}</p>
              )}
            </div>
          </div>
          {igConnected ? (
            <button
              onClick={() => handleDisconnect('instagram')}
              disabled={disconnecting === 'instagram'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              {disconnecting === 'instagram' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('settings.channelsTab.disconnect', 'Desconectar')}
            </button>
          ) : (
            <button
              onClick={() => handleConnectChannel('instagram')}
              disabled={connectingChannel === 'instagram'}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-[#E1306C] to-[#C13584] hover:shadow-lg hover:shadow-[#E1306C]/25 transition-all disabled:opacity-60"
            >
              {connectingChannel === 'instagram' ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('settings.channelsTab.connecting', 'Conectando...')}</>
              ) : (
                <><Instagram className="w-3.5 h-3.5" /> {t('settings.channelsTab.connectIg', 'Conectar Instagram')}</>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ── WhatsApp Cloud API (Oficial) ── */}
      {(() => {
        const channels = (business as Business & { channels?: ChannelConfig }).channels;
        const waChannel = channels?.whatsapp;
        const isCloudApi = waChannel?.isConnected && !waChannel?.connectedVia;
        const isBaileys = waChannel?.isConnected && waChannel?.connectedVia === 'baileys';
        return (
          <>
            <div className={cn(
              'rounded-2xl border overflow-hidden bg-white dark:bg-[#111827]',
              isCloudApi ? 'border-emerald-200 dark:border-emerald-500/20' : 'border-gray-200 dark:border-gray-700/50',
            )}>
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3.5">
                    <div className={cn(
                      'w-11 h-11 rounded-xl flex items-center justify-center',
                      isCloudApi
                        ? 'bg-gradient-to-br from-[#25D366] to-[#128C7E] shadow-sm shadow-green-500/20'
                        : 'bg-[#25D366]/10',
                    )}>
                      <Cloud className={cn('w-5 h-5', isCloudApi ? 'text-white' : 'text-[#25D366]')} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">WhatsApp Oficial</span>
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">Cloud API</span>
                        {isCloudApi && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
                            <Check className="w-2.5 h-2.5" /> {t('settings.channelsTab.connected', 'Conectado')}
                          </span>
                        )}
                      </div>
                      {isCloudApi && waPhoneNumber ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{waPhoneNumber}</p>
                      ) : (
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t('settings.channelsTab.waCloudApiDesc', 'API oficial da Meta com suporte a templates e volume ilimitado')}</p>
                      )}
                    </div>
                  </div>
                  {isCloudApi && (
                    <button
                      onClick={() => handleDisconnect('whatsapp')}
                      disabled={disconnecting === 'whatsapp'}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                    >
                      {disconnecting === 'whatsapp' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('settings.channelsTab.disconnect', 'Desconectar')}
                    </button>
                  )}
                </div>
                {!isCloudApi && (
                  <button
                    onClick={() => handleConnectChannel('whatsapp')}
                    disabled={connectingChannel === 'whatsapp'}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold text-white bg-[#25D366] hover:bg-[#22c55e] transition-colors disabled:opacity-60"
                  >
                    {connectingChannel === 'whatsapp' ? (
                      <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> {t('settings.channelsTab.connecting', 'Conectando...')}</>
                    ) : (
                      <><Smartphone className="w-3.5 h-3.5" /> {t('settings.channelsTab.waConnectMeta', 'Conectar via Meta Business')}</>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* ── WhatsApp Web (QR Code / Baileys) ── */}
            <div className={cn(
              'rounded-2xl border overflow-hidden bg-white dark:bg-[#111827]',
              isBaileys ? 'border-emerald-200 dark:border-emerald-500/20' : 'border-gray-200 dark:border-gray-700/50',
            )}>
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3.5">
                    <div className={cn(
                      'w-11 h-11 rounded-xl flex items-center justify-center',
                      isBaileys
                        ? 'bg-gradient-to-br from-[#25D366] to-[#128C7E] shadow-sm shadow-green-500/20'
                        : 'bg-[#25D366]/10',
                    )}>
                      <QrCode className={cn('w-5 h-5', isBaileys ? 'text-white' : 'text-[#25D366]')} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('settings.channelsTab.waWeb', 'WhatsApp Web')}</span>
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[#25D366]/10 text-[#25D366]">{t('settings.channelsTab.qrCode', 'QR Code')}</span>
                        {isBaileys && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
                            <Check className="w-2.5 h-2.5" /> {t('settings.channelsTab.connected', 'Conectado')}
                          </span>
                        )}
                      </div>
                      {isBaileys && waPhoneNumber ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{waPhoneNumber}</p>
                      ) : (
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t('settings.channelsTab.qrCodeDesc', 'Conexão rápida via QR Code, ideal para testes')}</p>
                      )}
                    </div>
                  </div>
                  {isBaileys && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setForceReconnect(true);
                          setShowQrModal(true);
                          setQrDataUrl(null);
                          setWaStatus('connecting');
                          setWaConnecting(true);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#25D366] hover:bg-[#25D366]/10 transition-colors"
                        title="Se mensagens não estão chegando, force uma reconexão"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Reconectar
                      </button>
                      <button
                        onClick={() => handleDisconnect('whatsapp')}
                        disabled={disconnecting === 'whatsapp'}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                      >
                        {disconnecting === 'whatsapp' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('settings.channelsTab.disconnect', 'Desconectar')}
                      </button>
                    </div>
                  )}
                </div>
                {!isBaileys && (
                  <button
                    onClick={() => {
                      setShowQrModal(true);
                      setQrDataUrl(null);
                      setWaStatus('connecting');
                      setWaConnecting(true);
                    }}
                    disabled={waConnecting}
                    className={cn(
                      'w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold text-white transition-all',
                      'bg-[#25D366] hover:bg-[#128C7E] shadow-sm shadow-green-500/20 hover:shadow-md',
                      'disabled:opacity-60 disabled:cursor-not-allowed',
                    )}
                  >
                    {waConnecting ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('settings.channelsTab.connecting', 'Conectando...')}</>
                    ) : (
                      <><QrCode className="w-3.5 h-3.5" /> {t('settings.channelsTab.scanQr', 'Escanear QR Code')}</>
                    )}
                  </button>
                )}
              </div>
            </div>
          </>
        );
      })()}

      {/* ── WhatsApp QR Code Modal ── */}
      {showQrModal && (
        <WhatsAppQrModal
          businessId={business?.id || ''}
          forceReconnect={forceReconnect}
          onClose={() => {
            setShowQrModal(false);
            setWaConnecting(false);
            setWaStatus('idle');
            setQrDataUrl(null);
            setForceReconnect(false);
          }}
          onConnected={(phoneNumber) => {
            setWaConnected(true);
            setWaPhoneNumber(phoneNumber || '');
            setShowQrModal(false);
            setWaConnecting(false);
            setWaStatus('connected');
            setForceReconnect(false);
            refreshUser();
            toast.success(t('settings.channelsTab.connected', 'WhatsApp conectado com sucesso!'));
          }}
        />
      )}
    </motion.div>
  );
}

// ─── WhatsApp QR Code Modal ──────────────────────────────────────────────────

function WhatsAppQrModal({
  businessId,
  forceReconnect = false,
  onClose,
  onConnected,
}: {
  businessId: string;
  forceReconnect?: boolean;
  onClose: () => void;
  onConnected: (phoneNumber: string | null) => void;
}) {
  const { t } = useTranslation();
  const { firebaseUser } = useAuth();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'connecting' | 'scanning' | 'connected' | 'error'>('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();

    const connect = async () => {
      try {
        const token = await firebaseUser?.getIdToken();
        if (!token || cancelled) return;

        const qs = new URLSearchParams({ businessId });
        if (forceReconnect) qs.set('force', '1');
        const url = `/api/whatsapp/connect?${qs.toString()}`;

        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: abortController.signal,
        });

        if (!response.ok || !response.body) {
          if (!cancelled) {
            setStatus('error');
            setErrorMsg(t('settings.channelsTab.serverError', 'Falha ao conectar com o servidor'));
          }
          return;
        }

        const reader = response.body.getReader();
        readerRef.current = reader;
        const decoder = new TextDecoder();
        let buffer = '';

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'qr') {
                setQrDataUrl(data.qr);
                setStatus('scanning');
              } else if (data.type === 'connected') {
                setStatus('connected');
                setTimeout(() => onConnected(data.phoneNumber), 800);
              } else if (data.type === 'error') {
                setStatus('error');
                setErrorMsg(data.message || 'Erro desconhecido');
              } else if (data.type === 'disconnected') {
                if (data.reason === 'logged_out') {
                  setStatus('error');
                  setErrorMsg(t('settings.channelsTab.sessionRevoked', 'Sessão revogada. Tente novamente.'));
                }
              }
            } catch {
              // Skip malformed SSE lines
            }
          }
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && (err as DOMException).name === 'AbortError')) {
          setStatus('error');
          setErrorMsg(t('settings.channelsTab.connectionError', 'Erro de conexão com o servidor'));
          console.error('[WA QR Modal] SSE error:', err);
        }
      }
    };

    connect();

    return () => {
      cancelled = true;
      // Cancel the reader (triggers stream cancel on backend → cleanup)
      readerRef.current?.cancel().catch(() => {});
      readerRef.current = null;
      abortController.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-sm bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-black/[0.06] dark:border-white/[0.08] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#25D366]/15 flex items-center justify-center">
              <QrCode className="w-4.5 h-4.5 text-[#25D366]" />
            </div>
            <div>
              <h3 className="font-display font-bold text-gray-900 dark:text-white text-sm">{t('settings.channelsTab.waWeb', 'WhatsApp Web')}</h3>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">{t('settings.channelsTab.waModalSubtitle', 'Escaneie com seu celular')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* QR Area */}
        <div className="px-6 py-6 flex flex-col items-center">
          {status === 'connecting' && (
            <div className="w-[240px] h-[240px] rounded-2xl bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/[0.06] flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-8 h-8 text-[#25D366] animate-spin" />
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings.channelsTab.generatingQr', 'Gerando QR Code...')}</p>
            </div>
          )}

          {status === 'scanning' && qrDataUrl && (
            <div className="flex flex-col items-center gap-4">
              <div className="p-3 bg-white rounded-2xl shadow-lg border border-gray-100">
                <img src={qrDataUrl} alt="WhatsApp QR Code" className="w-[220px] h-[220px]" />
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <div className="w-1.5 h-1.5 rounded-full bg-[#25D366] animate-pulse" />
                Aguardando leitura do QR Code...
              </div>
            </div>
          )}

          {status === 'connected' && (
            <div className="w-[240px] h-[240px] rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex flex-col items-center justify-center gap-3">
              <div className="w-14 h-14 rounded-full bg-[#25D366] flex items-center justify-center">
                <Check className="w-7 h-7 text-white" />
              </div>
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{t('settings.channelsTab.connected', 'Conectado!')}</p>
            </div>
          )}

          {status === 'error' && (
            <div className="w-[240px] h-[240px] rounded-2xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 flex flex-col items-center justify-center gap-3 px-4">
              <AlertCircle className="w-8 h-8 text-red-500" />
              <p className="text-xs text-red-600 dark:text-red-400 text-center leading-relaxed">{errorMsg}</p>
              <button
                onClick={onClose}
                className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline"
              >
                Fechar e tentar novamente
              </button>
            </div>
          )}
        </div>

        {/* Instructions */}
        {status === 'scanning' && (
          <div className="px-6 pb-5">
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-white/[0.03] border border-gray-100 dark:border-white/[0.06]">
              <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                <strong className="text-gray-700 dark:text-gray-300">1.</strong> Abra o WhatsApp no celular{' '}
                <strong className="text-gray-700 dark:text-gray-300">2.</strong> Toque em <strong className="text-gray-700 dark:text-gray-300">Dispositivos conectados</strong>{' '}
                <strong className="text-gray-700 dark:text-gray-300">3.</strong> Escaneie este QR Code
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SETTINGS MODULE
// ═══════════════════════════════════════════════════════════════════════════════

export default function SettingsModule() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('perfil');

  // ── Scrollable tab bar ────────────────────────────────────────────────────
  const tabsRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft]   = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  const scrollTabsBy = useCallback((amount: number) => {
    tabsRef.current?.scrollBy({ left: amount, behavior: 'smooth' });
  }, []);

  // Non-passive wheel listener so we can call preventDefault
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
      checkScroll();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [checkScroll]);

  // Update arrows on resize and whenever the tab list changes
  useEffect(() => {
    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, [checkScroll]);

  const allTabs = [
    { id: 'perfil'     as Tab, label: t('settings.tabs.perfil',   'Meu Perfil'), icon: UserCircle },
    { id: 'modo'       as Tab, label: t('settings.tabs.modo',     'Modo do Sistema'), icon: Zap   },
    { id: 'agente'     as Tab, label: t('settings.tabs.agente',   'Agente IA'), icon: Sparkles },
    { id: 'cofre'      as Tab, label: t('settings.tabs.cofre',    'Cofre'),      icon: Shield    },
    { id: 'empresa'    as Tab, label: t('settings.tabs.empresa',  'Empresa'),    icon: Building2  },
    { id: 'fiscal'     as Tab, label: t('settings.tabs.fiscal',   'Fiscal'),     icon: FileText   },
    { id: 'usuarios'   as Tab, label: t('settings.tabs.usuarios', 'Usuários'),   icon: Users      },
    { id: 'setores'    as Tab, label: t('settings.tabs.setores',  'Setores'),    icon: Layers     },
    { id: 'canais'     as Tab, label: t('settings.tabs.canais',   'Canais'),     icon: Plug2      },
    { id: 'enterprise' as Tab, label: t('settings.tabs.enterprise', 'Enterprise'), icon: Blocks     },
  ];

  const tabs = allTabs;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
      className="max-w-7xl"
    >
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-50 to-red-100 dark:from-red-500/20 dark:to-red-500/10 flex items-center justify-center border border-red-200/50 dark:border-red-500/20">
            <Building2 className="w-5 h-5 text-red-500 dark:text-red-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 font-display">{t('settings.title', 'Configurações')}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('settings.desc', 'Gerencie as configurações da empresa e do seu perfil')}
            </p>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="relative mb-8">
        {/* Left fade + arrow */}
        <AnimatePresence>
          {canScrollLeft && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute left-0 top-0 bottom-0 w-14 z-10 flex items-center justify-start pointer-events-none rounded-l-2xl bg-gradient-to-r from-gray-50 dark:from-[#111827] to-transparent"
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

        {/* Scrollable container */}
        <div
          ref={tabsRef}
          onScroll={checkScroll}
          className="overflow-x-auto scrollbar-hide"
        >
          <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800/80 rounded-2xl w-max border border-gray-200 dark:border-gray-700/50">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className="relative px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-medium outline-none"
                >
                  {isActive && (
                    <motion.div
                      layoutId="settings-tab-pill"
                      className="absolute inset-0 rounded-xl bg-white dark:bg-[#1E293B] shadow-sm border border-gray-200 dark:border-gray-600/60"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                  <span className={cn(
                    'relative z-10 flex items-center gap-2 transition-colors duration-150',
                    isActive ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
                  )}>
                    <Icon className={cn('h-4 w-4', isActive && 'text-red-500 dark:text-red-400')} />
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right fade + arrow */}
        <AnimatePresence>
          {canScrollRight && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-0 bottom-0 w-14 z-10 flex items-center justify-end pointer-events-none rounded-r-2xl bg-gradient-to-l from-gray-50 dark:from-[#111827] to-transparent"
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

      {/* Tab Content */}
      <AnimatePresence mode="wait" initial={false}>
        {activeTab === 'perfil'     && <ProfileTab key="perfil" />}
        {activeTab === 'modo'       && <ModoSistemaTab key="modo" />}
        {activeTab === 'agente'     && <AgenteTab key="agente" />}
        {activeTab === 'cofre'      && <VaultTab key="cofre" />}
        {activeTab === 'empresa'    && <EmpresaTab key="empresa" />}
        {activeTab === 'fiscal'     && <FiscalTab key="fiscal" />}
        {activeTab === 'usuarios'   && <UsersTab key="usuarios" />}
        {activeTab === 'setores'    && <SectorsTab key="setores" />}

        {activeTab === 'canais'     && <CanaisTab key="canais" />}
        {activeTab === 'enterprise' && <EnterpriseTab key="enterprise" />}
      </AnimatePresence>
    </motion.div>
  );
}
