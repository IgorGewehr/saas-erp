'use client';

import { useState, useEffect, FormEvent } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { cn } from '@/lib/utils';
import {
  Building2,
  Save,
  Loader2,
  Phone,
  Mail,
  MapPin,
  FileText,
  Hash,
  Store,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';

interface BusinessFormData {
  nomeFantasia: string;
  razaoSocial: string;
  cnpj: string;
  inscricaoEstadual: string;
  inscricaoMunicipal: string;
  phone: string;
  email: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
}

function FormField({
  label,
  icon: Icon,
  children,
  className,
}: {
  label: string;
  icon?: React.ElementType;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
        {Icon && <Icon className="w-3.5 h-3.5 text-gray-400" />}
        {label}
      </label>
      {children}
    </div>
  );
}

export default function SettingsPlaceholder() {
  const { business, refreshUser } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<BusinessFormData>({
    nomeFantasia: '',
    razaoSocial: '',
    cnpj: '',
    inscricaoEstadual: '',
    inscricaoMunicipal: '',
    phone: '',
    email: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    municipio: '',
    uf: '',
    cep: '',
  });

  useEffect(() => {
    if (business) {
      setFormData({
        nomeFantasia: business.nomeFantasia || '',
        razaoSocial: business.razaoSocial || '',
        cnpj: business.cnpj || '',
        inscricaoEstadual: business.inscricaoEstadual || '',
        inscricaoMunicipal: business.inscricaoMunicipal || '',
        phone: business.phone || '',
        email: business.email || '',
        logradouro: business.endereco?.logradouro || '',
        numero: business.endereco?.numero || '',
        complemento: business.endereco?.complemento || '',
        bairro: business.endereco?.bairro || '',
        municipio: business.endereco?.municipio || '',
        uf: business.endereco?.uf || '',
        cep: business.endereco?.cep || '',
      });
    }
  }, [business]);

  const handleChange = (field: keyof BusinessFormData) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setFormData((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!business) return;

    setIsSaving(true);
    try {
      await setDoc(
        doc(db, 'businesses', business.id),
        {
          nomeFantasia: formData.nomeFantasia,
          razaoSocial: formData.razaoSocial,
          cnpj: formData.cnpj,
          inscricaoEstadual: formData.inscricaoEstadual,
          inscricaoMunicipal: formData.inscricaoMunicipal,
          phone: formData.phone,
          email: formData.email,
          endereco: {
            logradouro: formData.logradouro,
            numero: formData.numero,
            complemento: formData.complemento,
            bairro: formData.bairro,
            municipio: formData.municipio,
            uf: formData.uf,
            cep: formData.cep,
            codigoMunicipio: business.endereco?.codigoMunicipio || '',
          },
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      await refreshUser();
      toast.success('Configurações salvas com sucesso!');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Erro ao salvar configurações. Tente novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  const inputClasses = cn(
    'w-full px-3.5 py-2.5 rounded-xl border border-gray-200',
    'bg-white text-sm text-gray-900 placeholder:text-gray-400',
    'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-300',
    'transition-all duration-200'
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
      className="max-w-3xl mx-auto"
    >
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center border border-red-200/50">
            <Building2 className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 font-display">Perfil da Empresa</h2>
            <p className="text-sm text-gray-500">
              Gerencie as informações do seu negócio
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Business Info Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Store className="w-4 h-4 text-gray-500" />
              Dados da Empresa
            </h3>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Nome Fantasia" icon={Store}>
              <input
                type="text"
                value={formData.nomeFantasia}
                onChange={handleChange('nomeFantasia')}
                placeholder="Nome fantasia da empresa"
                className={inputClasses}
              />
            </FormField>

            <FormField label="Razão Social" icon={Building2}>
              <input
                type="text"
                value={formData.razaoSocial}
                onChange={handleChange('razaoSocial')}
                placeholder="Razão social completa"
                className={inputClasses}
              />
            </FormField>

            <FormField label="CNPJ" icon={FileText}>
              <input
                type="text"
                value={formData.cnpj}
                onChange={handleChange('cnpj')}
                placeholder="00.000.000/0001-00"
                className={inputClasses}
              />
            </FormField>

            <FormField label="Inscrição Estadual (IE)" icon={Hash}>
              <input
                type="text"
                value={formData.inscricaoEstadual}
                onChange={handleChange('inscricaoEstadual')}
                placeholder="Inscrição Estadual"
                className={inputClasses}
              />
            </FormField>

            <FormField label="Inscrição Municipal (IM)" icon={Hash}>
              <input
                type="text"
                value={formData.inscricaoMunicipal}
                onChange={handleChange('inscricaoMunicipal')}
                placeholder="Inscrição Municipal"
                className={inputClasses}
              />
            </FormField>
          </div>
        </div>

        {/* Contact Info Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Phone className="w-4 h-4 text-gray-500" />
              Contato
            </h3>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Telefone" icon={Phone}>
              <input
                type="tel"
                value={formData.phone}
                onChange={handleChange('phone')}
                placeholder="(00) 00000-0000"
                className={inputClasses}
              />
            </FormField>

            <FormField label="E-mail" icon={Mail}>
              <input
                type="email"
                value={formData.email}
                onChange={handleChange('email')}
                placeholder="contato@empresa.com"
                className={inputClasses}
              />
            </FormField>
          </div>
        </div>

        {/* Address Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-gray-500" />
              Endereço
            </h3>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="CEP" className="md:col-span-1">
              <input
                type="text"
                value={formData.cep}
                onChange={handleChange('cep')}
                placeholder="00000-000"
                className={inputClasses}
              />
            </FormField>

            <FormField label="Logradouro" className="md:col-span-1">
              <input
                type="text"
                value={formData.logradouro}
                onChange={handleChange('logradouro')}
                placeholder="Rua, Avenida, etc."
                className={inputClasses}
              />
            </FormField>

            <FormField label="Número">
              <input
                type="text"
                value={formData.numero}
                onChange={handleChange('numero')}
                placeholder="Nº"
                className={inputClasses}
              />
            </FormField>

            <FormField label="Complemento">
              <input
                type="text"
                value={formData.complemento}
                onChange={handleChange('complemento')}
                placeholder="Sala, Andar, etc."
                className={inputClasses}
              />
            </FormField>

            <FormField label="Bairro">
              <input
                type="text"
                value={formData.bairro}
                onChange={handleChange('bairro')}
                placeholder="Bairro"
                className={inputClasses}
              />
            </FormField>

            <FormField label="Município">
              <input
                type="text"
                value={formData.municipio}
                onChange={handleChange('municipio')}
                placeholder="Cidade"
                className={inputClasses}
              />
            </FormField>

            <FormField label="UF">
              <input
                type="text"
                value={formData.uf}
                onChange={handleChange('uf')}
                placeholder="SP"
                maxLength={2}
                className={cn(inputClasses, 'uppercase')}
              />
            </FormField>
          </div>
        </div>

        {/* Save button */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isSaving}
            className={cn(
              'flex items-center gap-2 px-6 py-2.5 rounded-xl',
              'bg-gradient-to-r from-red-600 to-red-500',
              'text-white text-sm font-semibold',
              'hover:from-red-700 hover:to-red-600',
              'shadow-lg shadow-red-500/25',
              'transition-all duration-200',
              'disabled:opacity-60 disabled:cursor-not-allowed',
              'focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:ring-offset-2'
            )}
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Salvar Alterações
              </>
            )}
          </button>
        </div>
      </form>
    </motion.div>
  );
}
