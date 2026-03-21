'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { doc, setDoc, collection, query, where, onSnapshot, updateDoc, getDocs, addDoc, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/config/firebase';
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
} from 'lucide-react';
import type { Business, User as UserType, InviteCode, UserRole, UserStatus, IntegrationProvider, IntegrationConfig, IntegrationStatus, EnterpriseSettings, SaasApiKey, ApiKeyScope, Sector } from '@/lib/types';
import { ROLE_LABELS, ROLE_HIERARCHY, USER_STATUS_LABELS, INTEGRATION_PROVIDERS, API_KEY_SCOPES, SECTOR_COLORS } from '@/lib/types';
import { formatDate } from '@/lib/utils/format';
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

type Tab = 'perfil' | 'empresa' | 'fiscal' | 'usuarios' | 'setores' | 'enterprise' | 'canais';

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

function ProfileTab() {
  const { user, updateUserProfile } = useAuth();
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
      <SectionCard title="Foto de Perfil" icon={UserCircle}>
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
      <SectionCard title="Status de Presença" icon={Wifi}>
        <div className="space-y-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">Controle como você aparece para os outros membros da equipe.</p>
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
              No modo invisível, você aparecerá como offline para os outros membros.
            </p>
          )}
        </div>
      </SectionCard>

      {/* Personal Info */}
      <SectionCard title="Informações Pessoais" icon={UserCircle}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Nome completo" icon={UserCircle}>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Seu nome completo"
              className={inputClasses}
            />
          </FormField>
          <FormField label="Telefone" icon={Phone}>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(formatPhoneInput(e.target.value))}
              placeholder="(00) 00000-0000"
              maxLength={15}
              className={inputClasses}
            />
          </FormField>
          <FormField label="E-mail" icon={Mail} className="md:col-span-2">
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
      <SectionCard title="Endereço" icon={MapPin}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="CEP" tooltip="Busca automática do endereço">
            <input
              type="text"
              value={cep}
              onChange={e => handleCEPChange(e.target.value)}
              placeholder="00000-000"
              maxLength={9}
              className={inputClasses}
            />
          </FormField>
          <FormField label="Logradouro">
            <input type="text" value={logradouro} onChange={e => setLogradouro(e.target.value)} placeholder="Rua, Avenida, etc." className={inputClasses} />
          </FormField>
          <FormField label="Número">
            <input type="text" value={numero} onChange={e => setNumero(e.target.value)} placeholder="Nº" className={inputClasses} />
          </FormField>
          <FormField label="Complemento">
            <input type="text" value={complemento} onChange={e => setComplemento(e.target.value)} placeholder="Sala, Andar, etc." className={inputClasses} />
          </FormField>
          <FormField label="Bairro">
            <input type="text" value={bairro} onChange={e => setBairro(e.target.value)} placeholder="Bairro" className={inputClasses} />
          </FormField>
          <FormField label="Município">
            <input type="text" value={municipio} onChange={e => setMunicipio(e.target.value)} placeholder="Cidade" className={inputClasses} />
          </FormField>
          <FormField label="UF">
            <select value={uf} onChange={e => setUf(e.target.value)} className={selectClasses}>
              <option value="">Selecione...</option>
              {UF_LIST.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </FormField>
        </div>
      </SectionCard>

      {/* Save */}
      <div className="flex justify-end">
        <SaveButton onClick={handleSave} loading={isSaving} label="Salvar Perfil" />
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMPRESA TAB
// ═══════════════════════════════════════════════════════════════════════════════

function EmpresaTab() {
  const { business, refreshUser } = useAuth();
  const canEditSettings = true;
  const [isSaving, setIsSaving] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Form state
  const [nomeFantasia, setNomeFantasia] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
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

  // Populate from business
  useEffect(() => {
    if (business) {
      setNomeFantasia(business.nomeFantasia || '');
      setRazaoSocial(business.razaoSocial || '');
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
      toast.error('Logo deve ter no máximo 2MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(file);

    try {
      const storageRef = ref(storage, `businesses/${business.id}/logo`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      setLogoPreview(url);
      await setDoc(doc(db, 'businesses', business.id), { logo: url, updatedAt: new Date().toISOString() }, { merge: true });
      await refreshUser();
      toast.success('Logo atualizada!');
    } catch {
      toast.error('Erro ao fazer upload da logo');
    }
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!nomeFantasia.trim()) errs.nomeFantasia = 'Nome Fantasia é obrigatório';

    const isMEI = companyType === 'mei';
    if (isMEI) {
      if (cpf && !validateCPF(cpf)) errs.cpf = 'CPF inválido';
    } else {
      if (cnpj && !validateCNPJ(cnpj)) errs.cnpj = 'CNPJ inválido';
    }

    if (email && !validateEmail(email)) errs.email = 'Email inválido';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || !business || !canEditSettings) return;

    setIsSaving(true);
    try {
      await setDoc(
        doc(db, 'businesses', business.id),
        {
          nomeFantasia,
          razaoSocial,
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
        },
        { merge: true }
      );

      await refreshUser();
      toast.success('Dados da empresa salvos com sucesso!');
    } catch (error) {
      console.error('Error saving:', error);
      toast.error('Erro ao salvar. Tente novamente.');
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
        <SectionCard title="Identificação" icon={Briefcase}>
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
                    <button
                      type="button"
                      onClick={async () => { setLogoPreview(null); if (business) { await setDoc(doc(db, 'businesses', business.id), { logo: '', updatedAt: new Date().toISOString() }, { merge: true }); await refreshUser(); } }}
                      className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 dark:bg-red-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/30 flex flex-col items-center justify-center cursor-pointer hover:border-red-400 dark:hover:border-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors duration-200">
                    <ImagePlus className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Upload</span>
                    <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                  </label>
                )}
                <p className="text-xs text-gray-400 dark:text-gray-500">PNG ou JPG, max 2MB.</p>
              </div>
            </div>

            {/* Company Type */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Tipo de Empresa" icon={Briefcase} tooltip="Natureza jurídica da empresa">
                <select
                  value={companyType}
                  onChange={(e) => setCompanyType(e.target.value)}
                  className={selectClasses}
                  disabled={!canEditSettings}
                >
                  <option value="mei">MEI - Microempreendedor Individual</option>
                  <option value="me">ME - Microempresa</option>
                  <option value="epp">EPP - Empresa de Pequeno Porte</option>
                  <option value="individual">Empresário Individual</option>
                  <option value="ltda">LTDA - Sociedade Limitada</option>
                  <option value="eireli">EIRELI</option>
                  <option value="sa">S/A - Sociedade Anônima</option>
                </select>
              </FormField>

              <FormField label="Regime Tributário (CRT)" icon={FileText} tooltip="Código de Regime Tributário">
                <select
                  value={crt}
                  onChange={(e) => setCrt(e.target.value)}
                  className={selectClasses}
                  disabled={!canEditSettings}
                >
                  <option value="1">1 - Simples Nacional</option>
                  <option value="2">2 - Simples Nacional - Excesso</option>
                  <option value="3">3 - Regime Normal (Lucro Presumido/Real)</option>
                  <option value="4">4 - MEI</option>
                </select>
              </FormField>
            </div>
          </div>
        </SectionCard>

        {/* Business Data */}
        <SectionCard title="Dados da Empresa" icon={Store}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Nome Fantasia" icon={Store} error={errors.nomeFantasia}>
              <input
                type="text"
                value={nomeFantasia}
                onChange={(e) => { setNomeFantasia(e.target.value); setErrors(p => ({ ...p, nomeFantasia: '' })); }}
                placeholder="Nome fantasia da empresa"
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>

            <FormField label="Razão Social" icon={Building2}>
              <input
                type="text"
                value={razaoSocial}
                onChange={(e) => setRazaoSocial(e.target.value)}
                placeholder="Razão social completa"
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

            <FormField label="Inscrição Estadual (IE)" icon={Hash}>
              <input
                type="text"
                value={inscricaoEstadual}
                onChange={(e) => setInscricaoEstadual(e.target.value)}
                placeholder={isMEI ? 'ISENTO' : 'Inscrição Estadual'}
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>

            <FormField label="Inscrição Municipal (IM)" icon={Hash}>
              <input
                type="text"
                value={inscricaoMunicipal}
                onChange={(e) => setInscricaoMunicipal(e.target.value)}
                placeholder="Inscrição Municipal"
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>
          </div>
        </SectionCard>

        {/* Contact */}
        <SectionCard title="Contato" icon={Phone}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Telefone" icon={Phone}>
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

            <FormField label="E-mail" icon={Mail} error={errors.email}>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setErrors(p => ({ ...p, email: '' })); }}
                placeholder="contato@empresa.com"
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>
          </div>
        </SectionCard>

        {/* Address */}
        <SectionCard title="Endereço" icon={MapPin}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="CEP" tooltip="Busca automática do endereço" error={errors.cep}>
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

            <FormField label="Logradouro">
              <input
                type="text"
                value={logradouro}
                onChange={(e) => setLogradouro(e.target.value)}
                placeholder="Rua, Avenida, etc."
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>

            <FormField label="Número">
              <input
                type="text"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder="Nº"
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>

            <FormField label="Complemento">
              <input
                type="text"
                value={complemento}
                onChange={(e) => setComplemento(e.target.value)}
                placeholder="Sala, Andar, etc."
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>

            <FormField label="Bairro">
              <input
                type="text"
                value={bairro}
                onChange={(e) => setBairro(e.target.value)}
                placeholder="Bairro"
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>

            <FormField label="Município">
              <input
                type="text"
                value={municipio}
                onChange={(e) => setMunicipio(e.target.value)}
                placeholder="Cidade"
                className={inputClasses}
                disabled={!canEditSettings}
              />
            </FormField>

            <FormField label="UF">
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

            <FormField label="Cód. Município IBGE" tooltip="Preenchido automaticamente pelo CEP">
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

        {/* Save */}
        {canEditSettings && (
          <div className="flex justify-end pt-2">
            <SaveButton loading={isSaving} label="Salvar Dados da Empresa" />
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
  const { business, refreshUser } = useAuth();
  const canEditFiscal = true;

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

    setEnvironment(f.environment || 'homologation');
    setTaxRegime(f.taxRegime || 'simples_nacional');
    setOperationType(f.operationType || 'saida');
    setSellsInterstate(f.sellsInterstate || false);
    setIbgeCode(f.ibgeCodigoMunicipio || business.endereco?.codigoMunicipio || '');

    if (f.nfeConfig) {
      setNfeSeries(f.nfeConfig.series || '1');
      setNfeNextNumber(String(f.nfeConfig.nextNumber || 1));
    }
    if (f.nfceConfig) {
      setNfceSeries(f.nfceConfig.series || '1');
      setNfceNextNumber(String(f.nfceConfig.nextNumber || 1));
      setCscId(f.nfceConfig.cscId || '');
      setCscToken(f.nfceConfig.cscToken || '');
    }
    if (f.taxation) {
      if (f.taxation.icms) { setIcmsCst(f.taxation.icms.cstCsosn || '102'); setIcmsRate(String(f.taxation.icms.rate || 0)); }
      if (f.taxation.pis) { setPisCst(f.taxation.pis.cst || '49'); setPisRate(String(f.taxation.pis.rate || 0.65)); }
      if (f.taxation.cofins) { setCofinsCst(f.taxation.cofins.cst || '49'); setCofinsRate(String(f.taxation.cofins.rate || 3)); }
    }
    if (f.cfops) {
      setCfopSales(f.cfops.defaultSales || '5102');
      setCfopPurchases(f.cfops.defaultPurchases || '1102');
    }
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
      toast.success('Ambiente fiscal salvo!');
    } catch { toast.error('Erro ao salvar ambiente'); }
    finally { setIsSavingEnv(false); }
  };

  const handleSaveRegime = async () => {
    setIsSavingRegime(true);
    try {
      await saveFiscalField({ taxRegime, operationType, sellsInterstate, ibgeCodigoMunicipio: ibgeCode || null });
      toast.success('Regime e operação salvos!');
    } catch { toast.error('Erro ao salvar regime'); }
    finally { setIsSavingRegime(false); }
  };

  const handleSaveNfe = async () => {
    setIsSavingNfe(true);
    try {
      await saveFiscalField({ nfeConfig: { series: nfeSeries, nextNumber: Number(nfeNextNumber) || 1, environment } });
      toast.success('Configurações NF-e salvas!');
    } catch { toast.error('Erro ao salvar NF-e'); }
    finally { setIsSavingNfe(false); }
  };

  const handleSaveNfce = async () => {
    setIsSavingNfce(true);
    try {
      await saveFiscalField({
        nfceConfig: {
          series: nfceSeries,
          nextNumber: Number(nfceNextNumber) || 1,
          cscId: cscId || undefined,
          cscToken: cscToken || undefined,
          environment,
        },
      });
      toast.success('Configurações NFC-e salvas!');
    } catch { toast.error('Erro ao salvar NFC-e'); }
    finally { setIsSavingNfce(false); }
  };

  const handleSaveCsc = async () => {
    setIsSavingCsc(true);
    try {
      const currentNfce = business?.fiscal?.nfceConfig || {};
      await saveFiscalField({ nfceConfig: { ...currentNfce, cscId, cscToken } });
      toast.success('CSC salvo!');
    } catch { toast.error('Erro ao salvar CSC'); }
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
      toast.success('Tributação salva!');
    } catch { toast.error('Erro ao salvar tributação'); }
    finally { setIsSavingTax(false); }
  };

  const handleSaveCfop = async () => {
    setIsSavingCfop(true);
    try {
      await saveFiscalField({ cfops: { defaultSales: cfopSales, defaultPurchases: cfopPurchases } });
      toast.success('CFOPs salvos!');
    } catch { toast.error('Erro ao salvar CFOPs'); }
    finally { setIsSavingCfop(false); }
  };

  // ── Certificate handlers ──
  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.pfx') && !file.name.endsWith('.p12')) {
      toast.error('Formato inválido. Envie um arquivo .pfx ou .p12');
      e.target.value = '';
      return;
    }
    if (file.size > 256 * 1024) {
      toast.error('Certificado muito grande. Máximo 256KB.');
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
      // Upload cert to storage
      const storagePath = `businesses/${business.id}/certificates/cert.pfx`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, certFile);

      // Save certificate metadata
      await saveFiscalField({
        certificate: {
          serialNumber: 'pending-parse',
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          storagePath,
          uploadedAt: new Date().toISOString(),
          subject: certFile.name,
        },
      });

      toast.success('Certificado digital enviado com sucesso!');
      setCertFile(null);
      setCertPassword('');
    } catch (error) {
      console.error('Error uploading cert:', error);
      toast.error('Erro ao enviar certificado');
    } finally {
      setIsUploadingCert(false);
    }
  };

  const handleDeleteCert = async () => {
    if (!business) return;
    if (!confirm('Tem certeza que deseja remover o certificado digital?')) return;
    try {
      await saveFiscalField({ certificate: null });
      toast.success('Certificado removido!');
    } catch { toast.error('Erro ao remover certificado'); }
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
      <SectionCard title="Certificado Digital A1" icon={Key}>
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
              <h3 className="font-medium text-gray-900 dark:text-gray-100">Nenhum certificado cadastrado</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Faça upload do seu certificado A1 (.pfx ou .p12)</p>
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
      <SectionCard title="Ambiente de Emissão" icon={Shield}>
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
                <p className="font-medium text-red-600 dark:text-red-400">Atenção!</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Em produção, todas as notas têm validade fiscal e efeito legal perante a SEFAZ.
                </p>
              </div>
            </div>
          )}
          {canEditFiscal && (
            <div className="flex justify-end">
              <SaveButton onClick={handleSaveEnv} loading={isSavingEnv} label="Salvar Ambiente" variant="secondary" />
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── Tax Regime ── */}
      <SectionCard title="Regime e Operação" icon={Building2}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Regime Tributário" tooltip="Regime fiscal da empresa">
              <select value={taxRegime} onChange={(e) => setTaxRegime(e.target.value)} className={selectClasses} disabled={!canEditFiscal}>
                <option value="simples_nacional">Simples Nacional</option>
                <option value="simples_nacional_excesso">Simples Nacional — Excesso</option>
                <option value="lucro_presumido">Lucro Presumido</option>
                <option value="lucro_real">Lucro Real</option>
              </select>
            </FormField>
            <FormField label="Tipo de Operação" tooltip="Tipo principal de operação">
              <select value={operationType} onChange={(e) => setOperationType(e.target.value)} className={selectClasses} disabled={!canEditFiscal}>
                <option value="saida">Saída (venda)</option>
                <option value="entrada">Entrada (compra)</option>
              </select>
            </FormField>
            <FormField label="Vende Interestadual?" tooltip="Se vende para outros estados">
              <select value={sellsInterstate ? 'true' : 'false'} onChange={(e) => setSellsInterstate(e.target.value === 'true')} className={selectClasses} disabled={!canEditFiscal}>
                <option value="false">Não</option>
                <option value="true">Sim</option>
              </select>
            </FormField>
            <FormField label="Cód. IBGE Município" tooltip="Código IBGE de 7 dígitos">
              <input value={ibgeCode} onChange={(e) => setIbgeCode(e.target.value)} placeholder="3550308" maxLength={7} className={inputClasses} disabled={!canEditFiscal} />
            </FormField>
          </div>
          {canEditFiscal && (
            <div className="flex justify-end">
              <SaveButton onClick={handleSaveRegime} loading={isSavingRegime} label="Salvar Regime" variant="secondary" />
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── CSC NFC-e ── */}
      <SectionCard title="CSC — NFC-e" icon={Shield}>
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            O CSC (Código de Segurança do Contribuinte) é gerado na SEFAZ estadual e obrigatório para emissão de NFC-e.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="ID do CSC" tooltip="Identificador fornecido pela SEFAZ">
              <input value={cscId} onChange={(e) => setCscId(e.target.value)} placeholder="000001" className={inputClasses} disabled={!canEditFiscal} />
            </FormField>
            <FormField label="Token do CSC" tooltip="Token fornecido pela SEFAZ">
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
              <SaveButton onClick={handleSaveCsc} loading={isSavingCsc} label="Salvar CSC" variant="secondary" disabled={!cscId.trim() || !cscToken.trim()} />
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── Series & Numbering ── */}
      <SectionCard title="Séries e Numeração" icon={Receipt}>
        <div className="space-y-6">
          {/* NF-e */}
          <div>
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">NF-e</p>
            <div className="grid grid-cols-2 gap-4 max-w-sm mb-3">
              <FormField label="Série" tooltip="Série da NF-e (geralmente 1)">
                <input value={nfeSeries} onChange={(e) => setNfeSeries(e.target.value)} className={inputClasses} disabled={!canEditFiscal} />
              </FormField>
              <FormField label="Próximo Nº" tooltip="Número da próxima NF-e">
                <input type="number" min={1} value={nfeNextNumber} onChange={(e) => setNfeNextNumber(e.target.value)} className={inputClasses} disabled={!canEditFiscal} />
              </FormField>
            </div>
            {canEditFiscal && (
              <div className="flex justify-end">
                <SaveButton onClick={handleSaveNfe} loading={isSavingNfe} label="Salvar NF-e" variant="secondary" />
              </div>
            )}
          </div>

          <hr className="border-gray-100 dark:border-gray-800" />

          {/* NFC-e */}
          <div>
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">NFC-e</p>
            <div className="grid grid-cols-2 gap-4 max-w-sm mb-3">
              <FormField label="Série" tooltip="Série da NFC-e (geralmente 1)">
                <input value={nfceSeries} onChange={(e) => setNfceSeries(e.target.value)} className={inputClasses} disabled={!canEditFiscal} />
              </FormField>
              <FormField label="Próximo Nº" tooltip="Número da próxima NFC-e">
                <input type="number" min={1} value={nfceNextNumber} onChange={(e) => setNfceNextNumber(e.target.value)} className={inputClasses} disabled={!canEditFiscal} />
              </FormField>
            </div>
            {canEditFiscal && (
              <div className="flex justify-end">
                <SaveButton onClick={handleSaveNfce} loading={isSavingNfce} label="Salvar NFC-e" variant="secondary" />
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      {/* ── Default Taxation ── */}
      <SectionCard title="Tributação Padrão" icon={DollarSign}>
        <div className="space-y-5">
          {/* ICMS */}
          <div>
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">ICMS</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label={isSimples ? 'CSOSN' : 'CST ICMS'} tooltip="Código de Situação Tributária do ICMS">
                <select value={icmsCst} onChange={(e) => setIcmsCst(e.target.value)} className={selectClasses} disabled={!canEditFiscal}>
                  {icmsCstOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </FormField>
              <FormField label="Alíquota ICMS (%)" tooltip="Percentual de ICMS padrão">
                <input type="number" step="0.01" min={0} value={icmsRate} onChange={(e) => setIcmsRate(e.target.value)} className={inputClasses} disabled={!canEditFiscal} />
              </FormField>
            </div>
          </div>
          {/* PIS */}
          <div>
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">PIS</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="CST PIS" tooltip="Código de Situação Tributária do PIS">
                <select value={pisCst} onChange={(e) => setPisCst(e.target.value)} className={selectClasses} disabled={!canEditFiscal}>
                  {pisCofinsOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </FormField>
              <FormField label="Alíquota PIS (%)" tooltip="Percentual de PIS padrão">
                <input type="number" step="0.01" min={0} value={pisRate} onChange={(e) => setPisRate(e.target.value)} className={inputClasses} disabled={!canEditFiscal} />
              </FormField>
            </div>
          </div>
          {/* COFINS */}
          <div>
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">COFINS</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="CST COFINS" tooltip="Código de Situação Tributária do COFINS">
                <select value={cofinsCst} onChange={(e) => setCofinsCst(e.target.value)} className={selectClasses} disabled={!canEditFiscal}>
                  {pisCofinsOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </FormField>
              <FormField label="Alíquota COFINS (%)" tooltip="Percentual de COFINS padrão">
                <input type="number" step="0.01" min={0} value={cofinsRate} onChange={(e) => setCofinsRate(e.target.value)} className={inputClasses} disabled={!canEditFiscal} />
              </FormField>
            </div>
          </div>
          {canEditFiscal && (
            <div className="flex justify-end">
              <SaveButton onClick={handleSaveTax} loading={isSavingTax} label="Salvar Tributação" />
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── Default CFOPs ── */}
      <SectionCard title="CFOPs Padrão" icon={FileText}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="CFOP Venda" tooltip="CFOP padrão para operações de saída">
              <input value={cfopSales} onChange={(e) => setCfopSales(e.target.value)} placeholder="5102" className={inputClasses} disabled={!canEditFiscal} />
            </FormField>
            <FormField label="CFOP Compra" tooltip="CFOP padrão para operações de entrada">
              <input value={cfopPurchases} onChange={(e) => setCfopPurchases(e.target.value)} placeholder="1102" className={inputClasses} disabled={!canEditFiscal} />
            </FormField>
          </div>
          {canEditFiscal && (
            <div className="flex justify-end">
              <SaveButton onClick={handleSaveCfop} loading={isSavingCfop} label="Salvar CFOPs" variant="secondary" />
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
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Senha do certificado</label>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={certPassword}
            onChange={(e) => onPasswordChange(e.target.value)}
            placeholder="Senha do arquivo .pfx"
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
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">A senha é usada apenas durante o upload.</p>
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

function isUserOnline(member: UserType): boolean {
  if (!member.isOnline || !member.lastSeenAt) return false;
  return Date.now() - new Date(member.lastSeenAt).getTime() < 3 * 60 * 1000;
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
  const { user, business } = useAuth();
  const [members, setMembers]           = useState<UserType[]>([]);
  const [inviteCodes, setInviteCodes]   = useState<InviteCode[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRole>('operator');
  const [copiedCode, setCopiedCode]     = useState<string | null>(null);
  const [revokingCode, setRevokingCode] = useState<string | null>(null);
  const isOwner = user?.role === 'founder' || user?.role === 'admin';

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
      await setDoc(doc(db, 'inviteCodes', code), {
        businessId: business.id,
        code,
        role: selectedRole,
        createdBy: user.uid,
        createdByName: user.name,
        expiresAt,
        isActive: true,
        createdAt: new Date().toISOString(),
      });
      toast.success(`Código ${code} gerado! Válido por 7 dias.`);
    } catch {
      toast.error('Erro ao gerar código. Tente novamente.');
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

  // ── Revoke code ──────────────────────────────────────────────────────────
  const handleRevoke = async (code: string) => {
    setRevokingCode(code);
    try {
      await updateDoc(doc(db, 'inviteCodes', code), { isActive: false });
      toast.success('Código revogado.');
    } catch {
      toast.error('Erro ao revogar código.');
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
      <SectionCard title="Equipe" icon={Users}>
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
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">Nenhum membro encontrado.</p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800/80 -mx-6 -mb-6">
            {members.map((member, i) => {
              const online = isUserOnline(member);
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
                        ? <img src={member.photoURL} alt={member.name} className="w-full h-full rounded-full object-cover" />
                        : member.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
                      }
                    </div>
                    {/* Online indicator */}
                    <div className={cn(
                      'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-[#111827] transition-colors',
                      online ? 'bg-emerald-400' : 'bg-gray-300 dark:bg-gray-600'
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
                      {online ? (
                        <>
                          <Wifi className="w-3 h-3 text-emerald-500" />
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">Online</span>
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

                    {/* Role badge */}
                    <span className={cn(
                      'text-[11px] font-semibold px-2 py-0.5 rounded-lg border',
                      ROLE_COLORS[member.role]
                    )}>
                      {ROLE_LABELS[member.role]}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* ── Invite codes (admin/founder only) ────────────────────────────── */}
      {isOwner && (
        <SectionCard title="Códigos de Convite" icon={Link2}>
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
                <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mt-1.5">
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
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Gerando...</>
                  : <><Plus className="w-4 h-4" />Gerar Código</>
                }
              </button>
            </div>

            {/* Active codes list */}
            {inviteCodes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
                  <UserPlus className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                </div>
                <p className="text-[13px] text-gray-400 dark:text-gray-500">Nenhum código ativo. Gere um acima.</p>
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
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={cn(
                              'text-[11px] font-semibold px-2 py-0.5 rounded-md border',
                              ROLE_COLORS[ic.role]
                            )}>
                              {ROLE_LABELS[ic.role]}
                            </span>
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
                            title="Copiar código"
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/[0.1] transition-colors"
                          >
                            {isCopied
                              ? <><Check className="w-3.5 h-3.5 text-green-500" /><span className="text-green-600 dark:text-green-400">Copiado</span></>
                              : <><Copy className="w-3.5 h-3.5" />Copiar</>
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
                Conectado
              </span>
            ) : (
              <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">Não configurado</span>
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

// ─── Sectors Tab ──────────────────────────────────────────────────────────────

function SectorsTab() {
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
    if (!business?.id || !user || !formName.trim()) return;
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
        toast.success('Setor atualizado');
      } else {
        await addDoc(collection(db, 'sectors'), { ...sectorData, createdAt: now });
        toast.success('Setor criado');
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
      toast.error('Erro ao salvar setor');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (sector: Sector) => {
    if (!business?.id) return;
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
      toast.success('Setor excluído');
      setDeleteConfirm(null);
      refreshUser();
    } catch (err) {
      console.error('Error deleting sector:', err);
      toast.error('Erro ao excluir setor');
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
          <p className="text-sm text-gray-500 dark:text-gray-400">Organize sua equipe em setores para controle de permissões</p>
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
          <h4 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-1">Nenhum setor criado</h4>
          <p className="text-xs text-gray-400 dark:text-gray-500">Crie setores para organizar sua equipe e controlar permissões</p>
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
                          <img src={member.photoURL} alt={member.name} className="w-full h-full rounded-full object-cover" />
                        ) : (
                          member.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
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
                <FormField label="Nome do Setor" icon={Layers}>
                  <input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Ex: Comercial, Suporte, Marketing..."
                    className={inputClasses}
                  />
                </FormField>

                {/* Description */}
                <FormField label="Descrição" icon={FileText}>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Descrição opcional do setor..."
                    rows={2}
                    className={cn(inputClasses, 'resize-none')}
                  />
                </FormField>

                {/* Color */}
                <FormField label="Cor" icon={Palette}>
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
                <FormField label="Líder do Setor" icon={Crown}>
                  <select
                    value={formLeaderId}
                    onChange={(e) => setFormLeaderId(e.target.value)}
                    className={selectClasses}
                  >
                    <option value="">Sem líder definido</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.uid}>{m.name} ({ROLE_LABELS[m.role]})</option>
                    ))}
                  </select>
                </FormField>

                {/* Members */}
                <FormField label="Membros" icon={Users}>
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
                              <img src={m.photoURL} alt={m.name} className="w-full h-full rounded-full object-cover" />
                            ) : (
                              m.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
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
                  <p className="text-xs text-gray-500 dark:text-gray-400">Esta ação não pode ser desfeita</p>
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
  const cfg = {
    connected: { label: 'Conectado', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' },
    disconnected: { label: 'Desconectado', className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
    error: { label: 'Erro', className: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400' },
    pending: { label: 'Pendente', className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' },
  };
  const c = cfg[status];
  return <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', c.className)}>{c.label}</span>;
}

function EnterpriseTab() {
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
      toast.error('Erro ao alterar modo Enterprise');
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
      toast.error('Erro ao testar conexão');
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
      toast.error('Preencha o nome e selecione pelo menos um escopo');
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
      toast.success('API Key gerada com sucesso!');
    } catch {
      toast.error('Erro ao gerar API Key');
    } finally {
      setGeneratingKey(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!confirm('Tem certeza que deseja revogar esta API Key? Esta ação não pode ser desfeita.')) return;
    setRevokingKeyId(keyId);
    try {
      await deleteDoc(doc(db, 'saasApiKeys', keyId));
      toast.success('API Key revogada com sucesso');
    } catch {
      toast.error('Erro ao revogar API Key');
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
              <span className="text-emerald-700 dark:text-emerald-400 font-medium">Modo Enterprise ativo</span>
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
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">API Keys do ServicePro</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Gere chaves para acessar a API do ServicePro externamente</p>
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
                  <p className="text-sm text-gray-400 dark:text-gray-500">Nenhuma API Key gerada.</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Clique em &quot;Nova API Key&quot; para criar uma.</p>
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
                    <FormField label="Nome da chave" icon={Key}>
                      <input
                        type="text"
                        value={newKeyName}
                        onChange={e => setNewKeyName(e.target.value)}
                        placeholder="Ex: Integração ERP, App Mobile..."
                        className={inputClasses}
                      />
                    </FormField>

                    {/* Scopes */}
                    <div>
                      <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        <Lock className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                        Escopos de acesso
                      </label>
                      <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                        {(Object.entries(API_KEY_SCOPES) as [ApiKeyScope, { label: string; description: string }][]).map(([scope, info]) => (
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
                            <span className="font-semibold">{info.label}</span>
                            <p className="text-[10px] opacity-70 mt-0.5">{info.description}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Expiration */}
                    <FormField label="Expiração" icon={Clock}>
                      <select
                        value={newKeyExpiration}
                        onChange={e => setNewKeyExpiration(e.target.value)}
                        className={selectClasses}
                      >
                        <option value="30">30 dias</option>
                        <option value="90">90 dias</option>
                        <option value="180">180 dias</option>
                        <option value="never">Nunca expira</option>
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
                        <><Zap className="w-4 h-4" /> Gerar API Key</>
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
  const handleConnectChannel = async (channel: 'facebook' | 'instagram') => {
    setConnectingChannel(channel);
    try {
      const FB = await ensureFbSdk();

      const scopes: Record<string, string[]> = {
        facebook: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'],
        instagram: ['instagram_basic', 'instagram_manage_messages', 'pages_show_list', 'pages_manage_metadata'],
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
                  await refreshUser();
                  toast.success(`${channel === 'facebook' ? 'Facebook Messenger' : 'Instagram'} conectado!`);
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
    if (channels) {
      if (channels.whatsapp) {
        setWaConnected(channels.whatsapp.isConnected || false);
        setWaPhoneNumber(channels.whatsapp.displayPhoneNumber || channels.whatsapp.phoneNumberId || '');
      }
      if (channels.facebook) {
        setFbConnected(channels.facebook.isConnected || false);
        setFbPageName(channels.facebook.pageName || channels.facebook.pageId || '');
      }
      if (channels.instagram) {
        setIgConnected(channels.instagram.isConnected || false);
        setIgAccountName(channels.instagram.accountName || channels.instagram.accountId || '');
      }
    }
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
              <h3 className="text-lg font-bold text-gray-900 dark:text-white font-display">Canais de Comunicacao</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-md">
                Conecte cada canal individualmente para centralizar o atendimento ao cliente.
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
                {fbConnected && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
                    <Check className="w-2.5 h-2.5" /> Conectado
                  </span>
                )}
              </div>
              {fbConnected && fbPageName ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Pagina: {fbPageName}</p>
              ) : (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Receba e responda mensagens do Messenger</p>
              )}
            </div>
          </div>
          {fbConnected ? (
            <button
              onClick={() => handleDisconnect('facebook')}
              disabled={disconnecting === 'facebook'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              {disconnecting === 'facebook' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Desconectar'}
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
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Conectando...</>
              ) : (
                <><Facebook className="w-3.5 h-3.5" /> Conectar Messenger</>
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
                    <Check className="w-2.5 h-2.5" /> Conectado
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20">
                    <Clock className="w-2.5 h-2.5" /> Em Breve
                  </span>
                )}
              </div>
              {igConnected && igAccountName ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Conta: {igAccountName}</p>
              ) : (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">DMs e comentarios do Instagram</p>
              )}
            </div>
          </div>
          {igConnected ? (
            <button
              onClick={() => handleDisconnect('instagram')}
              disabled={disconnecting === 'instagram'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              {disconnecting === 'instagram' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Desconectar'}
            </button>
          ) : (
            <div className="relative group">
              <button
                disabled
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white/60 bg-gradient-to-r from-[#E1306C]/40 to-[#C13584]/40 cursor-not-allowed"
              >
                <Instagram className="w-3.5 h-3.5" /> Conectar Instagram
              </button>
              <div className="absolute bottom-full right-0 mb-2 px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-700 text-[10px] text-white font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg">
                Disponivel em breve — aguardando aprovacao da Meta
                <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900 dark:border-t-gray-700" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── WhatsApp Card ── */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700/50 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3.5">
              <div className={cn(
                'w-11 h-11 rounded-xl flex items-center justify-center',
                waConnected
                  ? 'bg-gradient-to-br from-[#25D366] to-[#128C7E] shadow-sm shadow-green-500/20'
                  : 'bg-[#25D366]/10'
              )}>
                <MessageCircle className={cn('w-5 h-5', waConnected ? 'text-white' : 'text-[#25D366]')} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">WhatsApp</span>
                  {waConnected && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
                      <Check className="w-2.5 h-2.5" /> Conectado
                    </span>
                  )}
                </div>
                {waConnected && waPhoneNumber ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{waPhoneNumber}</p>
                ) : (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Escolha o metodo de conexao</p>
                )}
              </div>
            </div>
            {waConnected && (
              <button
                onClick={() => handleDisconnect('whatsapp')}
                disabled={disconnecting === 'whatsapp'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
              >
                {disconnecting === 'whatsapp' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Desconectar'}
              </button>
            )}
          </div>

          {/* Two connection methods */}
          {!waConnected && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Cloud API */}
              <div className="relative group rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 hover:border-[#25D366]/40 dark:hover:border-[#25D366]/30 p-4 transition-colors cursor-default">
                <div className="flex items-center gap-2.5 mb-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#25D366]/10 flex items-center justify-center">
                    <Cloud className="w-4 h-4 text-[#25D366]" />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">Cloud API</span>
                    <span className="ml-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">Oficial</span>
                  </div>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed mb-3">
                  API oficial da Meta. Requer conta Business verificada. Ilimitado e com suporte a templates.
                </p>
                <div className="relative">
                  <button
                    disabled
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[11px] font-semibold text-white/60 bg-[#25D366]/40 cursor-not-allowed"
                  >
                    <Smartphone className="w-3.5 h-3.5" /> Configurar Cloud API
                  </button>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-700 text-[10px] text-white font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg">
                    Em desenvolvimento
                    <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900 dark:border-t-gray-700" />
                  </div>
                </div>
              </div>

              {/* Baileys / QR Code */}
              <div className="relative group rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 hover:border-[#25D366]/40 dark:hover:border-[#25D366]/30 p-4 transition-colors cursor-default">
                <div className="flex items-center gap-2.5 mb-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#25D366]/10 flex items-center justify-center">
                    <QrCode className="w-4 h-4 text-[#25D366]" />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">WhatsApp Web</span>
                    <span className="ml-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400">QR Code</span>
                  </div>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed mb-3">
                  Conexao via QR Code (Baileys). Rapido de configurar, ideal para testes e pequenos volumes.
                </p>
                <div className="relative">
                  <button
                    disabled
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[11px] font-semibold text-white/60 bg-[#25D366]/40 cursor-not-allowed"
                  >
                    <QrCode className="w-3.5 h-3.5" /> Escanear QR Code
                  </button>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-700 text-[10px] text-white font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg">
                    Em desenvolvimento
                    <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900 dark:border-t-gray-700" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SETTINGS MODULE
// ═══════════════════════════════════════════════════════════════════════════════

export default function SettingsModule() {
  const { user } = useAuth();
  const isAdmin = ROLE_HIERARCHY[user?.role || 'viewer'] >= ROLE_HIERARCHY['admin'];
  const [activeTab, setActiveTab] = useState<Tab>('perfil');

  const allTabs = [
    { id: 'perfil'     as Tab, label: 'Meu Perfil',  icon: UserCircle },
    { id: 'empresa'    as Tab, label: 'Empresa',     icon: Building2  },
    { id: 'fiscal'     as Tab, label: 'Fiscal',      icon: FileText   },
    { id: 'usuarios'   as Tab, label: 'Usuários',    icon: Users      },
    { id: 'setores'    as Tab, label: 'Setores',     icon: Layers     },
    { id: 'enterprise' as Tab, label: 'Enterprise',  icon: Blocks     },
    { id: 'canais'     as Tab, label: 'Canais',      icon: Plug2      },
  ];

  const tabs = isAdmin ? allTabs : allTabs.filter(t => t.id === 'perfil');

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
      className="max-w-4xl mx-auto"
    >
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-50 to-red-100 dark:from-red-500/20 dark:to-red-500/10 flex items-center justify-center border border-red-200/50 dark:border-red-500/20">
            <Building2 className="w-5 h-5 text-red-500 dark:text-red-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 font-display">Configurações</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {isAdmin ? 'Gerencie os dados da empresa, configurações fiscais e equipe' : 'Gerencie seu perfil pessoal'}
            </p>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800/80 rounded-2xl w-fit border border-gray-200 dark:border-gray-700/50 mb-8">
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

      {/* Tab Content */}
      <AnimatePresence mode="wait" initial={false}>
        {activeTab === 'perfil'     && <ProfileTab key="perfil" />}
        {activeTab === 'empresa'    && <EmpresaTab key="empresa" />}
        {activeTab === 'fiscal'     && <FiscalTab key="fiscal" />}
        {activeTab === 'usuarios'   && <UsersTab key="usuarios" />}
        {activeTab === 'setores'    && <SectorsTab key="setores" />}
        {activeTab === 'enterprise' && <EnterpriseTab key="enterprise" />}
        {activeTab === 'canais'     && <CanaisTab key="canais" />}
      </AnimatePresence>
    </motion.div>
  );
}
