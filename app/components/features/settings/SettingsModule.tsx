'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { doc, setDoc } from 'firebase/firestore';
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
} from 'lucide-react';
import type { Business } from '@/lib/types';
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

type Tab = 'empresa' | 'fiscal' | 'usuarios';

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

function UsersTab() {
  return (
    <motion.div
      key="users"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      className="space-y-6"
    >
      <SectionCard title="Gerenciamento de Equipe" icon={Users}>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
            <Users className="w-8 h-8 text-gray-400 dark:text-gray-500" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Em breve
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md">
            O gerenciamento de equipe, convites e permissões estará disponível em uma atualização futura.
            Por enquanto, utilize as abas Empresa e Fiscal para configurar seu negócio.
          </p>
        </div>
      </SectionCard>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SETTINGS MODULE
// ═══════════════════════════════════════════════════════════════════════════════

export default function SettingsModule() {
  const [activeTab, setActiveTab] = useState<Tab>('empresa');

  const tabs = [
    { id: 'empresa' as Tab, label: 'Empresa', icon: Building2 },
    { id: 'fiscal' as Tab, label: 'Fiscal', icon: FileText },
    { id: 'usuarios' as Tab, label: 'Usuários', icon: Users },
  ];

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
            <p className="text-sm text-gray-500 dark:text-gray-400">Gerencie os dados da empresa, configurações fiscais e equipe</p>
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
        {activeTab === 'empresa' && <EmpresaTab key="empresa" />}
        {activeTab === 'fiscal' && <FiscalTab key="fiscal" />}
        {activeTab === 'usuarios' && <UsersTab key="usuarios" />}
      </AnimatePresence>
    </motion.div>
  );
}
