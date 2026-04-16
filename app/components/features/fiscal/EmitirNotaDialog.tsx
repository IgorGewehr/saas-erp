'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  Autocomplete,
} from '@mui/material';
import {
  X,
  Plus,
  Trash2,
  FileCheck2,
  Receipt,
  FileText,
  Search,
  Calculator,
  Loader2,
  AlertTriangle,
  Info,
  User,
  Building2,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { collection, getDocs, query, where, doc, setDoc, updateDoc, increment } from 'firebase/firestore';
import { db, storage } from '@/lib/config/firebase';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { useAuth } from '@/app/components/providers/AuthProvider';
import type { FiscalDocType, PaymentMethod, CRMContact } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatCurrency, formatCPFCNPJ } from '@/lib/utils/format';
import { useTranslation } from 'react-i18next';

// ─── Types ───────────────────────────────────────────────────────────────────

interface EmitirNotaDialogProps {
  open: boolean;
  onClose: () => void;
  type: FiscalDocType;
  onSuccess?: () => void;
}

interface NFSeFormData {
  // Tomador
  tomadorTipo: 'cpf' | 'cnpj';
  tomadorDocumento: string;
  tomadorNome: string;
  tomadorEmail: string;
  tomadorPhone: string;
  // Servico
  discriminacao: string;
  codigoTributacaoNacional: string;
  codigoTributacaoMunicipal: string;
  // Valores
  valorServicos: number;
  valorDeducoes: number;
  valorDescontoIncondicionado: number;
  // ISSQN
  tipoRetencaoISSQN: '1' | '2' | '3';
  aliquotaISS: number;
  // Extras
  informacoesAdicionais: string;
}

interface NFCeItemForm {
  id: string;
  description: string;
  ncm: string;
  cfop: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  cest?: string;
  gtin?: string;
  icmsOrigem?: string;
  productId?: string;
}

interface PaymentForm {
  id: string;
  method: PaymentMethod;
  amount: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PAYMENT_SEFAZ_CODES: Record<PaymentMethod, string> = {
  dinheiro: '01',
  pix: '17',
  credito: '03',
  debito: '04',
  boleto: '15',
  outros: '99',
};

const inputClasses = cn(
  'w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700',
  'bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
  'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-300 dark:focus:border-red-500/40',
  'transition-all duration-200'
);

const selectClasses = cn(
  'w-full h-10 px-3 rounded-xl border text-sm appearance-none cursor-pointer',
  'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100',
  'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-300 dark:focus:border-red-500/40',
  'transition-all duration-150'
);

const TYPE_ICONS_EMIT: Record<FiscalDocType, { icon: React.ReactNode; color: string }> = {
  nfse: { icon: <FileCheck2 className="w-5 h-5" />, color: 'text-emerald-500' },
  nfce: { icon: <Receipt className="w-5 h-5" />, color: 'text-blue-500' },
  nfe: { icon: <FileText className="w-5 h-5" />, color: 'text-red-500' },
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function EmitirNotaDialog({ open, onClose, type, onSuccess }: EmitirNotaDialogProps) {
  const { business, user } = useAuth();
  const { t } = useTranslation();
  const config = useMemo(() => ({
    title: t(`fiscal.emit.title.${type}`, type === 'nfse' ? 'Emitir NFSe' : type === 'nfce' ? 'Emitir NFCe' : 'Emitir NFe'),
    subtitle: t(`fiscal.emit.subtitle.${type}`, type === 'nfse' ? 'Nota Fiscal de Serviço Eletrônica' : type === 'nfce' ? 'Nota Fiscal de Consumidor Eletrônica' : 'Nota Fiscal Eletrônica'),
    icon: TYPE_ICONS_EMIT[type].icon,
    color: TYPE_ICONS_EMIT[type].color,
  }), [t, type]);

  const PAYMENT_METHOD_LABELS = useMemo<Record<PaymentMethod, string>>(() => ({
    dinheiro: t('fiscal.emit.paymentDinheiro', 'Dinheiro'),
    pix: t('fiscal.emit.paymentPix', 'PIX'),
    credito: t('fiscal.emit.paymentCredito', 'Cartão de Crédito'),
    debito: t('fiscal.emit.paymentDebito', 'Cartão de Débito'),
    boleto: t('fiscal.emit.paymentBoleto', 'Boleto'),
    outros: t('fiscal.emit.paymentOutros', 'Outros'),
  }), [t]);

  const RETENCAO_ISS_LABELS = useMemo<Record<string, string>>(() => ({
    '1': t('fiscal.emit.retencaoNaoRetido', 'Não Retido'),
    '2': t('fiscal.emit.retencaoTomador', 'Retido pelo Tomador'),
    '3': t('fiscal.emit.retencaoIntermediario', 'Retido pelo Intermediário'),
  }), [t]);

  const [isEmitting, setIsEmitting] = useState(false);
  const [clients, setClients] = useState<CRMContact[]>([]);

  // ── NFSe State ──
  const [nfseForm, setNfseForm] = useState<NFSeFormData>({
    tomadorTipo: 'cpf',
    tomadorDocumento: '',
    tomadorNome: '',
    tomadorEmail: '',
    tomadorPhone: '',
    discriminacao: '',
    codigoTributacaoNacional: '',
    codigoTributacaoMunicipal: '',
    valorServicos: 0,
    valorDeducoes: 0,
    valorDescontoIncondicionado: 0,
    tipoRetencaoISSQN: '1',
    aliquotaISS: 5,
    informacoesAdicionais: '',
  });

  // ── NFCe State ──
  const [nfceConsumidorCpf, setNfceConsumidorCpf] = useState('');
  const [nfceConsumidorNome, setNfceConsumidorNome] = useState('');
  const [nfceItems, setNfceItems] = useState<NFCeItemForm[]>([createEmptyNFCeItem()]);
  const [nfcePayments, setNfcePayments] = useState<PaymentForm[]>([{ id: '1', method: 'dinheiro', amount: 0 }]);

  // ── NFe State (same items/payment structure as NFCe + recipient details) ──
  const [nfeRecipientDoc, setNfeRecipientDoc] = useState('');
  const [nfeRecipientName, setNfeRecipientName] = useState('');
  const [nfeRecipientIE, setNfeRecipientIE] = useState('');
  const [nfeNatureza, setNfeNatureza] = useState('Venda de mercadoria');
  const [nfeItems, setNfeItems] = useState<NFCeItemForm[]>([createEmptyNFCeItem()]);
  const [nfePayments, setNfePayments] = useState<PaymentForm[]>([{ id: '1', method: 'dinheiro', amount: 0 }]);

  // ── NFe recipient address ──
  const [nfeRecipientAddress, setNfeRecipientAddress] = useState({
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    municipio: '',
    codigoMunicipio: '',
    uf: '',
    cep: '',
  });
  const [nfeRecipientIndicadorIE, setNfeRecipientIndicadorIE] = useState<'1' | '2' | '9'>('9');

  // Load clients from Firestore
  useEffect(() => {
    if (!open || !business) return;
    const loadClients = async () => {
      try {
        const q = query(collection(db, 'clients'), where('businessId', '==', business.id));
        const snapshot = await getDocs(q);
        setClients(snapshot.docs.map(d => ({ ...d.data(), id: d.id }) as CRMContact));
      } catch { /* silent */ }
    };
    loadClients();
  }, [open, business]);

  // ── NFSe Computed Values ──
  const nfseBaseCalculo = useMemo(() => {
    return Math.max(0, nfseForm.valorServicos - nfseForm.valorDeducoes - nfseForm.valorDescontoIncondicionado);
  }, [nfseForm.valorServicos, nfseForm.valorDeducoes, nfseForm.valorDescontoIncondicionado]);

  const nfseValorISS = useMemo(() => {
    return parseFloat((nfseBaseCalculo * (nfseForm.aliquotaISS / 100)).toFixed(2));
  }, [nfseBaseCalculo, nfseForm.aliquotaISS]);

  const nfseValorLiquido = useMemo(() => {
    return nfseForm.tipoRetencaoISSQN === '1'
      ? nfseForm.valorServicos - nfseForm.valorDescontoIncondicionado
      : nfseForm.valorServicos - nfseForm.valorDescontoIncondicionado - nfseValorISS;
  }, [nfseForm.valorServicos, nfseForm.valorDescontoIncondicionado, nfseForm.tipoRetencaoISSQN, nfseValorISS]);

  // ── NFCe/NFe Computed ──
  const itemsTotal = (items: NFCeItemForm[]) => items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const paymentsTotal = (payments: PaymentForm[]) => payments.reduce((sum, p) => sum + p.amount, 0);

  // ── Client Selection ──
  const handleClientSelect = (client: CRMContact | null) => {
    if (!client) return;
    if (type === 'nfse') {
      setNfseForm(prev => ({
        ...prev,
        tomadorTipo: client.tipo === 'pj' ? 'cnpj' : 'cpf',
        tomadorDocumento: client.cpfCnpj || '',
        tomadorNome: client.name,
        tomadorEmail: client.email || '',
        tomadorPhone: client.phone || '',
      }));
    } else if (type === 'nfce') {
      setNfceConsumidorCpf(client.cpfCnpj || '');
      setNfceConsumidorNome(client.name);
    } else {
      setNfeRecipientDoc(client.cpfCnpj || '');
      setNfeRecipientName(client.name);
      setNfeRecipientIE(client.inscricaoEstadual || '');
      setNfeRecipientIndicadorIE(client.indicadorIE || (client.tipo === 'pj' ? '1' : '9'));
      if (client.endereco) {
        setNfeRecipientAddress({
          logradouro: client.endereco.logradouro || '',
          numero: client.endereco.numero || '',
          complemento: client.endereco.complemento || '',
          bairro: client.endereco.bairro || '',
          municipio: client.endereco.municipio || '',
          codigoMunicipio: client.endereco.codigoMunicipio || '',
          uf: client.endereco.uf || '',
          cep: client.endereco.cep || '',
        });
      }
    }
  };

  // ── Get certificate from Firebase Storage ──
  const getCertificate = async (): Promise<{ pfxBase64: string; password: string }> => {
    const cert = business?.fiscal?.certificate;
    const pwdEncoded = business?.fiscal?.certPasswordEncrypted;
    if (!cert?.storagePath || !pwdEncoded) {
      throw new Error(t('fiscal.emit.errors.certRequired', 'Certificado digital não configurado. Acesse Configurações > Fiscal.'));
    }
    const fileRef = storageRef(storage, cert.storagePath);
    const downloadUrl = await getDownloadURL(fileRef);
    const response = await fetch(downloadUrl);
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const pfxBase64 = btoa(binary);
    const password = atob(pwdEncoded);
    return { pfxBase64, password };
  };

  // ── Emit Handlers ──

  const handleEmitNFSe = async () => {
    if (!business || !user) return;

    // Validate
    if (!nfseForm.tomadorNome.trim()) { toast.error(t('fiscal.emit.errors.tomadorNomeRequired', 'Nome do tomador é obrigatório')); return; }
    if (!nfseForm.tomadorDocumento.trim()) { toast.error(t('fiscal.emit.errors.tomadorDocRequired', 'CPF/CNPJ do tomador é obrigatório')); return; }
    if (!nfseForm.discriminacao.trim()) { toast.error(t('fiscal.emit.errors.discriminacaoRequired', 'Descrição do serviço é obrigatória')); return; }
    if (nfseForm.valorServicos <= 0) { toast.error(t('fiscal.emit.errors.valorPositivo', 'Valor do serviço deve ser maior que zero')); return; }
    if (!business.endereco?.codigoMunicipio) { toast.error(t('fiscal.emit.errors.ibgeRequired', 'Configure o código IBGE do município nas configurações da empresa')); return; }

    if (!business.fiscal?.certificate) { toast.error(t('fiscal.emit.errors.certRequired', 'Certificado digital não configurado. Acesse Configurações > Fiscal.')); return; }

    setIsEmitting(true);
    try {
      const fiscalConfig = business.fiscal;
      const nextNumber = fiscalConfig?.nfseConfig?.nextNumber || 1;
      const cleanDoc = nfseForm.tomadorDocumento.replace(/\D/g, '');

      const payload = {
        serie: fiscalConfig?.nfseConfig?.series || 'NFSE',
        numeroDPS: nextNumber,
        codigoMunicipioEmissao: business.endereco.codigoMunicipio,
        prestador: {
          cnpj: (business.cnpj || business.cpf || '').replace(/\D/g, ''),
          inscricaoMunicipal: business.inscricaoMunicipal || '',
          nome: business.razaoSocial || business.nomeFantasia,
          nomeFantasia: business.nomeFantasia || undefined,
          simplesNacional: business.crt === '1' || business.crt === '4' ? '1' : '2',
        },
        tomador: {
          [nfseForm.tomadorTipo === 'cnpj' ? 'cnpj' : 'cpf']: cleanDoc,
          nome: nfseForm.tomadorNome,
        },
        servico: {
          codigoTributacaoNacional: nfseForm.codigoTributacaoNacional || '0107',
          codigoTributacaoMunicipal: nfseForm.codigoTributacaoMunicipal || undefined,
          discriminacao: nfseForm.discriminacao,
          localPrestacao: {
            codigoMunicipio: business.endereco.codigoMunicipio,
          },
        },
        valores: {
          valorServicos: nfseForm.valorServicos,
          valorDeducoes: nfseForm.valorDeducoes || undefined,
          valorDescontoIncondicionado: nfseForm.valorDescontoIncondicionado || undefined,
        },
        issqn: {
          tipoRetencaoISSQN: nfseForm.tipoRetencaoISSQN,
          baseCalculo: nfseBaseCalculo,
          aliquota: nfseForm.aliquotaISS,
          valorISS: nfseValorISS,
          valorISSRetido: nfseForm.tipoRetencaoISSQN !== '1' ? nfseValorISS : undefined,
        },
        certificado: {
          pfxBase64: 'FROM_STORAGE',
          password: 'FROM_STORAGE',
        },
      };

      const res = await fetch('/api/fiscal/emit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'nfse', data: payload }),
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        const errorMsg = result.details?.motivoStatus || result.details?.erros?.[0] || result.error || 'Erro ao emitir NFSe';
        toast.error(errorMsg);
        // Save as rejected
        await saveFiscalDoc('nfse', nextNumber, 'rejeitada', result, payload);
        return;
      }

      // Success - save to Firestore
      const sefazData = result.data;
      await saveFiscalDoc('nfse', nextNumber, sefazData.status === 'autorizado' ? 'autorizada' : 'processando', sefazData, payload);

      // Increment next number
      if (business.fiscal?.nfseConfig) {
        await setDoc(doc(db, 'businesses', business.id), {
          fiscal: { nfseConfig: { ...business.fiscal.nfseConfig, nextNumber: nextNumber + 1 } },
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }

      toast.success(sefazData.status === 'autorizado' ? t('fiscal.emit.success.nfseAutorizada', 'NFSe emitida com sucesso!') : t('fiscal.emit.success.nfseAguardando', 'NFSe enviada, aguardando autorização'));
      onSuccess?.();
      onClose();
    } catch (error) {
      console.error('Emit NFSe error:', error);
      toast.error(t('fiscal.emit.errors.genericNfse', 'Erro ao emitir NFSe. Verifique os dados e tente novamente.'));
    } finally {
      setIsEmitting(false);
    }
  };

  const handleEmitNFCe = async () => {
    if (!business || !user) return;
    if (nfceItems.every(i => !i.description.trim())) { toast.error(t('fiscal.emit.errors.addItem', 'Adicione pelo menos um item')); return; }
    if (!business.fiscal?.certificate) { toast.error(t('fiscal.emit.errors.certRequired', 'Certificado digital não configurado.')); return; }

    const total = itemsTotal(nfceItems);
    if (total <= 0) { toast.error(t('fiscal.emit.errors.valorTotalPositivo', 'Valor total deve ser maior que zero')); return; }

    setIsEmitting(true);
    try {
      const certificado = await getCertificate();
      const fiscalConfig = business.fiscal;
      const nextNumber = fiscalConfig?.nfceConfig?.nextNumber || 1;
      const cleanCnpj = (business.cnpj || '').replace(/\D/g, '');
      const crtBusiness = business.crt as '1' | '2' | '3' | '4';
      const crtSefaz = (crtBusiness === '3' || crtBusiness === '4') ? '3' : crtBusiness as '1' | '2';
      const isSimples = crtBusiness === '1' || crtBusiness === '2';
      const emitEndereco = business.endereco;
      const ibgeCod = emitEndereco?.codigoMunicipio || fiscalConfig?.ibgeCodigoMunicipio || '';

      const payload = {
        emitente: {
          cnpj: cleanCnpj,
          nome: business.razaoSocial || business.nomeFantasia,
          nomeFantasia: business.nomeFantasia || undefined,
          inscricaoEstadual: (fiscalConfig?.inscricaoEstadual || business.inscricaoEstadual || '').replace(/\D/g, ''),
          crt: crtSefaz,
          endereco: {
            logradouro: emitEndereco?.logradouro || '',
            numero: emitEndereco?.numero || 'S/N',
            complemento: emitEndereco?.complemento || undefined,
            bairro: emitEndereco?.bairro || '',
            codigoMunicipio: ibgeCod,
            municipio: emitEndereco?.municipio || '',
            uf: emitEndereco?.uf || 'SP',
            cep: (emitEndereco?.cep || '').replace(/\D/g, ''),
          },
        },
        consumidor: nfceConsumidorCpf ? {
          cpf: nfceConsumidorCpf.replace(/\D/g, ''),
          nome: nfceConsumidorNome || undefined,
        } : undefined,
        numero: nextNumber,
        serie: String(fiscalConfig?.nfceConfig?.series || '1'),
        ufEmitente: emitEndereco?.uf || 'SP',
        itens: nfceItems.filter(i => i.description.trim()).map((item, idx) => ({
          numero: idx + 1,
          produto: {
            codigo: String(idx + 1),
            cEAN: item.gtin || 'SEM GTIN',
            descricao: item.description,
            ncm: item.ncm || '00000000',
            cest: item.cest || undefined,
            cfop: item.cfop || '5102',
            unidade: item.unit || 'UN',
            quantidade: item.quantity,
            valorUnitario: item.unitPrice,
            valorTotal: parseFloat((item.quantity * item.unitPrice).toFixed(2)),
            cEANTrib: item.gtin || 'SEM GTIN',
            unidadeTrib: item.unit || 'UN',
            quantidadeTrib: item.quantity,
            valorUnitarioTrib: item.unitPrice,
            indTot: '1',
          },
          imposto: {
            icms: isSimples
              ? { orig: item.icmsOrigem || '0', csosn: '400' }
              : { orig: item.icmsOrigem || '0', cst: '00', modBC: '3', valorBC: parseFloat((item.quantity * item.unitPrice).toFixed(2)), aliquota: 18, valor: 0 },
            pis: { cst: isSimples ? '07' : '01' },
            cofins: { cst: isSimples ? '07' : '01' },
          },
        })),
        pagamento: {
          indicadorPagamento: '0',
          formas: nfcePayments.map(p => ({
            tipo: PAYMENT_SEFAZ_CODES[p.method],
            valor: p.amount || total,
          })),
        },
        transporte: { modFrete: '9' },
        ...(fiscalConfig?.nfceConfig?.cscId ? {
          csc: {
            id: fiscalConfig.nfceConfig.cscId,
            token: fiscalConfig.nfceConfig.cscToken || '',
          },
        } : {}),
        certificado,
      };

      const res = await fetch('/api/fiscal/emit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'nfce', data: payload }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        toast.error(result.details?.motivoStatus || result.details?.erros?.[0] || result.error || 'Erro ao emitir NFCe');
        await saveFiscalDoc('nfce', nextNumber, 'rejeitada', result, payload);
        return;
      }

      await saveFiscalDoc('nfce', nextNumber, result.data.status === 'autorizado' ? 'autorizada' : 'processando', result.data, payload);

      if (business.fiscal?.nfceConfig) {
        await setDoc(doc(db, 'businesses', business.id), {
          fiscal: { nfceConfig: { ...business.fiscal.nfceConfig, nextNumber: nextNumber + 1 } },
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }

      toast.success(t('fiscal.emit.success.nfce', 'NFCe emitida com sucesso!'));
      onSuccess?.();
      onClose();
    } catch (error) {
      console.error('Emit NFCe error:', error);
      toast.error(error instanceof Error ? error.message : t('fiscal.emit.errors.genericNfce', 'Erro ao emitir NFCe.'));
    } finally {
      setIsEmitting(false);
    }
  };

  const handleEmitNFe = async () => {
    if (!business || !user) return;
    if (!nfeRecipientDoc.trim()) { toast.error(t('fiscal.emit.errors.destDocRequired', 'CPF/CNPJ do destinatário é obrigatório')); return; }
    if (!nfeRecipientName.trim()) { toast.error(t('fiscal.emit.errors.destNomeRequired', 'Nome do destinatário é obrigatório')); return; }
    if (nfeItems.every(i => !i.description.trim())) { toast.error(t('fiscal.emit.errors.addItem', 'Adicione pelo menos um item')); return; }
    if (!business.fiscal?.certificate) { toast.error(t('fiscal.emit.errors.certRequired', 'Certificado digital não configurado.')); return; }

    const cleanDestDoc = nfeRecipientDoc.replace(/\D/g, '');
    const isDestPJ = cleanDestDoc.length === 14;

    // For B2B (CNPJ recipient), address is required
    if (isDestPJ && !nfeRecipientAddress.codigoMunicipio) {
      toast.error(t('fiscal.emit.errors.destEnderecoRequired', 'Endereço do destinatário com código IBGE é obrigatório para NF-e B2B (CNPJ)'));
      return;
    }

    setIsEmitting(true);
    try {
      const certificado = await getCertificate();
      const fiscalConfig = business.fiscal;
      const nextNumber = fiscalConfig?.nfeConfig?.nextNumber || 1;
      const cleanCnpj = (business.cnpj || '').replace(/\D/g, '');
      const crtBusiness = business.crt as '1' | '2' | '3' | '4';
      const crtSefaz = (crtBusiness === '3' || crtBusiness === '4') ? '3' : crtBusiness as '1' | '2';
      const isSimples = crtBusiness === '1' || crtBusiness === '2';
      const emitEndereco = business.endereco;
      const ibgeCod = emitEndereco?.codigoMunicipio || fiscalConfig?.ibgeCodigoMunicipio || '';

      const destinatarioEndereco = nfeRecipientAddress.logradouro && nfeRecipientAddress.codigoMunicipio
        ? {
            logradouro: nfeRecipientAddress.logradouro,
            numero: nfeRecipientAddress.numero || 'S/N',
            complemento: nfeRecipientAddress.complemento || undefined,
            bairro: nfeRecipientAddress.bairro,
            codigoMunicipio: nfeRecipientAddress.codigoMunicipio,
            municipio: nfeRecipientAddress.municipio,
            uf: nfeRecipientAddress.uf,
            cep: nfeRecipientAddress.cep.replace(/\D/g, ''),
          }
        : undefined;

      const payload = {
        emitente: {
          cnpj: cleanCnpj,
          nome: business.razaoSocial || business.nomeFantasia,
          nomeFantasia: business.nomeFantasia || undefined,
          inscricaoEstadual: (fiscalConfig?.inscricaoEstadual || business.inscricaoEstadual || '').replace(/\D/g, ''),
          crt: crtSefaz,
          endereco: {
            logradouro: emitEndereco?.logradouro || '',
            numero: emitEndereco?.numero || 'S/N',
            complemento: emitEndereco?.complemento || undefined,
            bairro: emitEndereco?.bairro || '',
            codigoMunicipio: ibgeCod,
            municipio: emitEndereco?.municipio || '',
            uf: emitEndereco?.uf || 'SP',
            cep: (emitEndereco?.cep || '').replace(/\D/g, ''),
          },
        },
        destinatario: {
          ...(isDestPJ ? { cnpj: cleanDestDoc } : { cpf: cleanDestDoc }),
          nome: nfeRecipientName,
          inscricaoEstadual: nfeRecipientIE || undefined,
          indicadorIE: nfeRecipientIndicadorIE,
          ...(destinatarioEndereco ? { endereco: destinatarioEndereco } : {}),
        },
        numero: nextNumber,
        serie: String(fiscalConfig?.nfeConfig?.series || '1'),
        naturezaOperacao: nfeNatureza,
        tipoOperacao: '1',
        finalidade: '1',
        consumidorFinal: isDestPJ ? '0' : '1',
        presencaComprador: '9',
        ufEmitente: emitEndereco?.uf || 'SP',
        itens: nfeItems.filter(i => i.description.trim()).map((item, idx) => ({
          numero: idx + 1,
          produto: {
            codigo: String(idx + 1),
            cEAN: item.gtin || 'SEM GTIN',
            descricao: item.description,
            ncm: item.ncm || '00000000',
            cest: item.cest || undefined,
            cfop: item.cfop || '5102',
            unidade: item.unit || 'UN',
            quantidade: item.quantity,
            valorUnitario: item.unitPrice,
            valorTotal: parseFloat((item.quantity * item.unitPrice).toFixed(2)),
            cEANTrib: item.gtin || 'SEM GTIN',
            unidadeTrib: item.unit || 'UN',
            quantidadeTrib: item.quantity,
            valorUnitarioTrib: item.unitPrice,
            indTot: '1',
          },
          imposto: {
            icms: isSimples
              ? { orig: item.icmsOrigem || '0', csosn: '400' }
              : { orig: item.icmsOrigem || '0', cst: '00', modBC: '3', valorBC: parseFloat((item.quantity * item.unitPrice).toFixed(2)), aliquota: 18, valor: 0 },
            pis: { cst: isSimples ? '07' : '01' },
            cofins: { cst: isSimples ? '07' : '01' },
          },
        })),
        transporte: { modFrete: '9' },
        pagamento: {
          indicadorPagamento: '0',
          formas: nfePayments.map(p => ({
            tipo: PAYMENT_SEFAZ_CODES[p.method],
            valor: p.amount || itemsTotal(nfeItems),
          })),
        },
        certificado,
      };

      const res = await fetch('/api/fiscal/emit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'nfe', data: payload }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        toast.error(result.details?.motivoStatus || result.details?.erros?.[0] || result.error || 'Erro ao emitir NFe');
        await saveFiscalDoc('nfe', nextNumber, 'rejeitada', result, payload);
        return;
      }

      await saveFiscalDoc('nfe', nextNumber, result.data.status === 'autorizado' ? 'autorizada' : 'processando', result.data, payload);

      if (business.fiscal?.nfeConfig) {
        await setDoc(doc(db, 'businesses', business.id), {
          fiscal: { nfeConfig: { ...business.fiscal.nfeConfig, nextNumber: nextNumber + 1 } },
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }

      toast.success(result.data.status === 'autorizado' ? t('fiscal.emit.success.nfeAutorizada', 'NFe emitida com sucesso!') : t('fiscal.emit.success.nfeAguardando', 'NFe enviada, aguardando autorização'));
      onSuccess?.();
      onClose();
    } catch (error) {
      console.error('Emit NFe error:', error);
      toast.error(error instanceof Error ? error.message : t('fiscal.emit.errors.genericNfe', 'Erro ao emitir NFe.'));
    } finally {
      setIsEmitting(false);
    }
  };

  // ── Save fiscal doc to Firestore ──
  const saveFiscalDoc = async (
    docType: FiscalDocType,
    number: number,
    status: string,
    sefazResponse: Record<string, unknown>,
    originalPayload: Record<string, unknown>,
  ) => {
    if (!business) return;
    const docRef = doc(collection(db, 'fiscalDocuments'));
    const sefazData = (sefazResponse as Record<string, unknown>).data as Record<string, unknown> | undefined;

    await setDoc(docRef, {
      businessId: business.id,
      type: docType,
      number,
      series: docType === 'nfse' ? 'NFSE' : '1',
      accessKey: sefazData?.chaveAcesso || null,
      protocol: sefazData?.protocolo || null,
      status,
      statusMessage: sefazData?.motivoStatus || null,
      totalValue: docType === 'nfse'
        ? (originalPayload as { valores?: { valorServicos?: number } }).valores?.valorServicos || 0
        : (originalPayload as { itens?: { produto?: { valorTotal?: number } }[] }).itens?.reduce(
            (sum: number, i: { produto?: { valorTotal?: number } }) => sum + (i.produto?.valorTotal || 0), 0
          ) || 0,
      clientName: docType === 'nfse'
        ? (originalPayload as { tomador?: { nome?: string } }).tomador?.nome
        : (originalPayload as { destinatario?: { nome?: string } }).destinatario?.nome
          || (originalPayload as { consumidor?: { nome?: string } }).consumidor?.nome
          || 'Consumidor',
      issueDate: new Date().toISOString(),
      xml: sefazData?.xml || null,
      sefazResponse: sefazData || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleEmit = () => {
    if (type === 'nfse') handleEmitNFSe();
    else if (type === 'nfce') handleEmitNFCe();
    else handleEmitNFe();
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        className: 'dark:!bg-gray-900 dark:!text-gray-100',
        sx: {
          borderRadius: '16px',
          maxHeight: '90vh',
        },
      }}
    >
      {/* Header */}
      <DialogTitle sx={{ p: 0 }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center bg-gray-100 dark:bg-gray-800', config.color)}>
              {config.icon}
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-display">{config.title}</h2>
              <p className="text-xs text-gray-400 dark:text-gray-500">{config.subtitle}</p>
            </div>
          </div>
          <IconButton onClick={onClose} size="small">
            <X className="w-5 h-5 text-gray-400 dark:text-gray-500" />
          </IconButton>
        </div>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        <div className="px-6 py-5 space-y-6">
          {/* ══════════════════════ NFSe FORM ══════════════════════ */}
          {type === 'nfse' && (
            <div className="space-y-6">
              {/* Tomador */}
              <div className="bg-gray-50/80 dark:bg-white/[0.02] rounded-xl p-5 border border-gray-100 dark:border-gray-800 space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  <User className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                  {t('fiscal.emit.tomador', 'Tomador do Serviço')}
                </div>

                {/* Client search */}
                <Autocomplete
                  options={clients}
                  getOptionLabel={(opt) => `${opt.name}${opt.cpfCnpj ? ` — ${formatCPFCNPJ(opt.cpfCnpj)}` : ''}`}
                  onChange={(_, val) => handleClientSelect(val)}
                  size="small"
                  noOptionsText={t('fiscal.emit.noClient', 'Nenhum cliente encontrado')}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      placeholder={t('fiscal.emit.searchClient', 'Buscar cliente cadastrado...')}
                      size="small"
                      InputProps={{
                        ...params.InputProps,
                        startAdornment: <><Search size={14} className="text-gray-400 dark:text-gray-500 mr-1" />{params.InputProps.startAdornment}</>,
                      }}
                    />
                  )}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.tipo', 'Tipo')}</label>
                    <select
                      value={nfseForm.tomadorTipo}
                      onChange={(e) => setNfseForm(prev => ({ ...prev, tomadorTipo: e.target.value as 'cpf' | 'cnpj' }))}
                      className={selectClasses}
                    >
                      <option value="cpf">{t('fiscal.emit.pfOption', 'Pessoa Física (CPF)')}</option>
                      <option value="cnpj">{t('fiscal.emit.pjOption', 'Pessoa Jurídica (CNPJ)')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">
                      {nfseForm.tomadorTipo === 'cpf' ? 'CPF' : 'CNPJ'}
                    </label>
                    <input
                      value={nfseForm.tomadorDocumento}
                      onChange={(e) => setNfseForm(prev => ({ ...prev, tomadorDocumento: e.target.value }))}
                      placeholder={nfseForm.tomadorTipo === 'cpf' ? '000.000.000-00' : '00.000.000/0001-00'}
                      className={inputClasses}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.nomeRazaoSocial', 'Nome / Razão Social')}</label>
                  <input
                    value={nfseForm.tomadorNome}
                    onChange={(e) => setNfseForm(prev => ({ ...prev, tomadorNome: e.target.value }))}
                    placeholder={t('fiscal.emit.nomeRazaoPlaceholder', 'Nome completo ou razão social')}
                    className={inputClasses}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Email</label>
                    <input
                      type="email"
                      value={nfseForm.tomadorEmail}
                      onChange={(e) => setNfseForm(prev => ({ ...prev, tomadorEmail: e.target.value }))}
                      placeholder="email@exemplo.com"
                      className={inputClasses}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.telefone', 'Telefone')}</label>
                    <input
                      value={nfseForm.tomadorPhone}
                      onChange={(e) => setNfseForm(prev => ({ ...prev, tomadorPhone: e.target.value }))}
                      placeholder="(00) 00000-0000"
                      className={inputClasses}
                    />
                  </div>
                </div>
              </div>

              {/* Servico */}
              <div className="bg-gray-50/80 dark:bg-white/[0.02] rounded-xl p-5 border border-gray-100 dark:border-gray-800 space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  <FileCheck2 className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                  {t('fiscal.emit.servicoPrestado', 'Serviço Prestado')}
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.discriminacao', 'Discriminação do Serviço *')}</label>
                  <textarea
                    value={nfseForm.discriminacao}
                    onChange={(e) => setNfseForm(prev => ({ ...prev, discriminacao: e.target.value }))}
                    placeholder={t('fiscal.emit.discriminacaoPlaceholder', 'Descreva detalhadamente o serviço prestado...')}
                    rows={3}
                    className={cn(inputClasses, 'resize-none')}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
                      {t('fiscal.emit.codTribNacional', 'Cod. Tributação Nacional (cTribNac)')}
                      <span className="group relative">
                        <Info className="w-3 h-3 text-gray-300 dark:text-gray-600 cursor-help" />
                        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs text-white bg-gray-900 dark:bg-gray-700 rounded-lg whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
                          {t('fiscal.emit.codTribTooltip', 'Código NBS/LC 116 do serviço')}
                        </span>
                      </span>
                    </label>
                    <input
                      value={nfseForm.codigoTributacaoNacional}
                      onChange={(e) => setNfseForm(prev => ({ ...prev, codigoTributacaoNacional: e.target.value }))}
                      placeholder="0107"
                      className={inputClasses}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.codTribMunicipal', 'Cod. Tributação Municipal')}</label>
                    <input
                      value={nfseForm.codigoTributacaoMunicipal}
                      onChange={(e) => setNfseForm(prev => ({ ...prev, codigoTributacaoMunicipal: e.target.value }))}
                      placeholder={t('fiscal.emit.codTribMunicipalPlaceholder', 'Opcional')}
                      className={inputClasses}
                    />
                  </div>
                </div>
              </div>

              {/* Valores + ISSQN */}
              <div className="bg-gray-50/80 dark:bg-white/[0.02] rounded-xl p-5 border border-gray-100 dark:border-gray-800 space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  <Calculator className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                  {t('fiscal.emit.valoresIssqn', 'Valores e ISSQN')}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.valorServico', 'Valor do Serviço *')}</label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={nfseForm.valorServicos || ''}
                      onChange={(e) => setNfseForm(prev => ({ ...prev, valorServicos: Number(e.target.value) }))}
                      placeholder="0,00"
                      className={inputClasses}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.deducoes', 'Deduções')}</label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={nfseForm.valorDeducoes || ''}
                      onChange={(e) => setNfseForm(prev => ({ ...prev, valorDeducoes: Number(e.target.value) }))}
                      placeholder="0,00"
                      className={inputClasses}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.desconto', 'Desconto')}</label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={nfseForm.valorDescontoIncondicionado || ''}
                      onChange={(e) => setNfseForm(prev => ({ ...prev, valorDescontoIncondicionado: Number(e.target.value) }))}
                      placeholder="0,00"
                      className={inputClasses}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.retencaoISS', 'Retenção ISS')}</label>
                    <select
                      value={nfseForm.tipoRetencaoISSQN}
                      onChange={(e) => setNfseForm(prev => ({ ...prev, tipoRetencaoISSQN: e.target.value as '1' | '2' | '3' }))}
                      className={selectClasses}
                    >
                      {Object.entries(RETENCAO_ISS_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.aliquotaISS', 'Alíquota ISS (%)')}</label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      max={100}
                      value={nfseForm.aliquotaISS}
                      onChange={(e) => setNfseForm(prev => ({ ...prev, aliquotaISS: Number(e.target.value) }))}
                      className={inputClasses}
                    />
                  </div>
                </div>

                {/* Calculated summary */}
                <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-700 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">{t('fiscal.emit.baseCalculo', 'Base de Cálculo')}</span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(nfseBaseCalculo)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">ISS ({nfseForm.aliquotaISS}%)</span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(nfseValorISS)}</span>
                  </div>
                  {nfseForm.tipoRetencaoISSQN !== '1' && (
                    <div className="flex justify-between text-sm text-amber-600 dark:text-amber-400">
                      <span>{t('fiscal.emit.issRetido', 'ISS Retido')}</span>
                      <span className="font-medium">-{formatCurrency(nfseValorISS)}</span>
                    </div>
                  )}
                  <hr className="border-gray-100 dark:border-gray-800" />
                  <div className="flex justify-between text-base font-bold">
                    <span className="text-gray-700 dark:text-gray-300">{t('fiscal.emit.valorLiquido', 'Valor Líquido')}</span>
                    <span className="text-emerald-600 dark:text-emerald-400">{formatCurrency(nfseValorLiquido)}</span>
                  </div>
                </div>
              </div>

              {/* Additional Info */}
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.infoAdicionais', 'Informações Adicionais')}</label>
                <textarea
                  value={nfseForm.informacoesAdicionais}
                  onChange={(e) => setNfseForm(prev => ({ ...prev, informacoesAdicionais: e.target.value }))}
                  placeholder={t('fiscal.emit.infoAdicionaisPlaceholder', 'Observações opcionais...')}
                  rows={2}
                  className={cn(inputClasses, 'resize-none')}
                />
              </div>
            </div>
          )}

          {/* ══════════════════════ NFCe FORM ══════════════════════ */}
          {type === 'nfce' && (
            <div className="space-y-6">
              {/* Consumer */}
              <div className="bg-gray-50/80 dark:bg-white/[0.02] rounded-xl p-5 border border-gray-100 dark:border-gray-800 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  <User className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                  {t('fiscal.emit.consumidor', 'Consumidor (Opcional)')}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.cpfLabel', 'CPF')}</label>
                    <input value={nfceConsumidorCpf} onChange={(e) => setNfceConsumidorCpf(e.target.value)} placeholder={t('fiscal.emit.opcionalPlaceholder', 'Opcional')} className={inputClasses} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.nomeLabel', 'Nome')}</label>
                    <input value={nfceConsumidorNome} onChange={(e) => setNfceConsumidorNome(e.target.value)} placeholder={t('fiscal.emit.opcionalPlaceholder', 'Opcional')} className={inputClasses} />
                  </div>
                </div>
              </div>

              {/* Items */}
              <ItemsSection
                items={nfceItems}
                onUpdate={(id, field, value) => setNfceItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i))}
                onAdd={() => setNfceItems(prev => [...prev, createEmptyNFCeItem()])}
                onRemove={(id) => setNfceItems(prev => prev.filter(i => i.id !== id))}
              />

              {/* Payment */}
              <PaymentsSection
                payments={nfcePayments}
                total={itemsTotal(nfceItems)}
                onUpdate={(id, field, value) => setNfcePayments(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p))}
                onAdd={() => setNfcePayments(prev => [...prev, { id: Math.random().toString(36).substring(2), method: 'dinheiro', amount: 0 }])}
                onRemove={(id) => setNfcePayments(prev => prev.filter(p => p.id !== id))}
                paymentLabels={PAYMENT_METHOD_LABELS}
              />
            </div>
          )}

          {/* ══════════════════════ NFe FORM ══════════════════════ */}
          {type === 'nfe' && (
            <div className="space-y-6">
              {/* Recipient */}
              <div className="bg-gray-50/80 dark:bg-white/[0.02] rounded-xl p-5 border border-gray-100 dark:border-gray-800 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  <Building2 className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                  {t('fiscal.emit.destinatario', 'Destinatário')}
                </div>
                <Autocomplete
                  options={clients}
                  getOptionLabel={(opt) => `${opt.name}${opt.cpfCnpj ? ` — ${formatCPFCNPJ(opt.cpfCnpj)}` : ''}`}
                  onChange={(_, val) => handleClientSelect(val)}
                  size="small"
                  noOptionsText={t('fiscal.emit.noClient', 'Nenhum cliente encontrado')}
                  renderInput={(params) => (
                    <TextField {...params} placeholder={t('fiscal.emit.searchClientShort', 'Buscar cliente...')} size="small"
                      InputProps={{ ...params.InputProps, startAdornment: <><Search size={14} className="text-gray-400 dark:text-gray-500 mr-1" />{params.InputProps.startAdornment}</> }}
                    />
                  )}
                />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">CPF/CNPJ *</label>
                    <input value={nfeRecipientDoc} onChange={(e) => setNfeRecipientDoc(e.target.value)} className={inputClasses} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Nome/Razao Social *</label>
                    <input value={nfeRecipientName} onChange={(e) => setNfeRecipientName(e.target.value)} className={inputClasses} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.ie', 'IE')}</label>
                    <input value={nfeRecipientIE} onChange={(e) => setNfeRecipientIE(e.target.value)} placeholder={t('fiscal.emit.opcionalPlaceholder', 'Opcional')} className={inputClasses} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.indicadorIE', 'Indicador IE')}</label>
                    <select
                      value={nfeRecipientIndicadorIE}
                      onChange={(e) => setNfeRecipientIndicadorIE(e.target.value as '1' | '2' | '9')}
                      className={selectClasses}
                    >
                      <option value="9">{t('fiscal.emit.indicadorIE9', '9 - Não Contribuinte')}</option>
                      <option value="1">{t('fiscal.emit.indicadorIE1', '1 - Contribuinte ICMS')}</option>
                      <option value="2">{t('fiscal.emit.indicadorIE2', '2 - Contribuinte Isento')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.naturezaOperacao', 'Natureza da Operação')}</label>
                    <select value={nfeNatureza} onChange={(e) => setNfeNatureza(e.target.value)} className={selectClasses}>
                      {[
                        t('fiscal.emit.naturezas.venda', 'Venda de mercadoria'),
                        t('fiscal.emit.naturezas.servico', 'Prestação de serviço'),
                        t('fiscal.emit.naturezas.devolucao', 'Devolução de mercadoria'),
                        t('fiscal.emit.naturezas.transferencia', 'Transferência'),
                        t('fiscal.emit.naturezas.remessa', 'Remessa para conserto'),
                      ].map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="bg-blue-50/50 dark:bg-blue-500/5 rounded-xl p-4 border border-blue-100 dark:border-blue-500/20 space-y-3">
                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide">{t('fiscal.emit.enderecoDestinatario', 'Endereço do Destinatário')}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.logradouro', 'Logradouro')}</label>
                      <input value={nfeRecipientAddress.logradouro} onChange={(e) => setNfeRecipientAddress(prev => ({ ...prev, logradouro: e.target.value }))} placeholder={t('fiscal.emit.logradouroPlaceholder', 'Rua, Av...')} className={inputClasses} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.numero', 'Número')}</label>
                      <input value={nfeRecipientAddress.numero} onChange={(e) => setNfeRecipientAddress(prev => ({ ...prev, numero: e.target.value }))} placeholder="123" className={inputClasses} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.bairro', 'Bairro')}</label>
                      <input value={nfeRecipientAddress.bairro} onChange={(e) => setNfeRecipientAddress(prev => ({ ...prev, bairro: e.target.value }))} placeholder="Centro" className={inputClasses} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.municipio', 'Município')}</label>
                      <input value={nfeRecipientAddress.municipio} onChange={(e) => setNfeRecipientAddress(prev => ({ ...prev, municipio: e.target.value }))} placeholder="São Paulo" className={inputClasses} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.codIbge', 'Cod. IBGE *')}</label>
                      <input value={nfeRecipientAddress.codigoMunicipio} onChange={(e) => setNfeRecipientAddress(prev => ({ ...prev, codigoMunicipio: e.target.value }))} placeholder="3550308" className={inputClasses} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.uf', 'UF')}</label>
                      <input value={nfeRecipientAddress.uf} onChange={(e) => setNfeRecipientAddress(prev => ({ ...prev, uf: e.target.value.toUpperCase().slice(0, 2) }))} placeholder="SP" maxLength={2} className={inputClasses} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.cep', 'CEP')}</label>
                      <input value={nfeRecipientAddress.cep} onChange={(e) => setNfeRecipientAddress(prev => ({ ...prev, cep: e.target.value }))} placeholder="00000-000" className={inputClasses} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.emit.complemento', 'Complemento')}</label>
                      <input value={nfeRecipientAddress.complemento} onChange={(e) => setNfeRecipientAddress(prev => ({ ...prev, complemento: e.target.value }))} placeholder={t('fiscal.emit.opcionalPlaceholder', 'Opcional')} className={inputClasses} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Items */}
              <ItemsSection
                items={nfeItems}
                onUpdate={(id, field, value) => setNfeItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i))}
                onAdd={() => setNfeItems(prev => [...prev, createEmptyNFCeItem()])}
                onRemove={(id) => setNfeItems(prev => prev.filter(i => i.id !== id))}
              />

              {/* Payment */}
              <PaymentsSection
                payments={nfePayments}
                total={itemsTotal(nfeItems)}
                onUpdate={(id, field, value) => setNfePayments(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p))}
                onAdd={() => setNfePayments(prev => [...prev, { id: Math.random().toString(36).substring(2), method: 'dinheiro', amount: 0 }])}
                onRemove={(id) => setNfePayments(prev => prev.filter(p => p.id !== id))}
                paymentLabels={PAYMENT_METHOD_LABELS}
              />
            </div>
          )}

          {/* Certificate warning */}
          {!business?.fiscal?.certificate && (
            <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-500/10 rounded-xl border border-amber-200 dark:border-amber-500/20">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">{t('fiscal.emit.certNotConfigured', 'Certificado digital não configurado')}</p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                  {t('fiscal.emit.certNotConfiguredDesc', 'Acesse Configurações > Fiscal para fazer upload do certificado A1 antes de emitir documentos fiscais.')}
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>

      {/* Footer */}
      <DialogActions sx={{ p: 0 }}>
        <div className="flex items-center justify-between w-full px-6 py-4 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            {t('fiscal.emit.cancelar', 'Cancelar')}
          </button>
          <button
            onClick={handleEmit}
            disabled={isEmitting || !business?.fiscal?.certificate}
            className={cn(
              'flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all',
              'bg-gradient-to-r from-red-600 to-red-500 text-white',
              'hover:from-red-700 hover:to-red-600 shadow-lg shadow-red-500/25',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {isEmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('fiscal.emit.emitindo', 'Emitindo...')}
              </>
            ) : (
              <>
                <FileCheck2 className="w-4 h-4" />
                {t('fiscal.actions.emitir', 'Emitir {{type}}', { type: type.toUpperCase() })}
              </>
            )}
          </button>
        </div>
      </DialogActions>
    </Dialog>
  );
}

// ─── Shared Sub-components ───────────────────────────────────────────────────

function createEmptyNFCeItem(): NFCeItemForm {
  return {
    id: Math.random().toString(36).substring(2),
    description: '',
    ncm: '',
    cfop: '',
    unit: 'UN',
    quantity: 1,
    unitPrice: 0,
  };
}

function ItemsSection({
  items,
  onUpdate,
  onAdd,
  onRemove,
}: {
  items: NFCeItemForm[];
  onUpdate: (id: string, field: string, value: string | number) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  const total = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('fiscal.emit.itens', 'Itens')}</span>
        <button onClick={onAdd} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">
          <Plus className="w-3.5 h-3.5" /> {t('fiscal.emit.adicionarItem', 'Adicionar Item')}
        </button>
      </div>
      <AnimatePresence>
        {items.map((item, idx) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-gray-50/80 dark:bg-white/[0.02] rounded-xl p-4 border border-gray-100 dark:border-gray-800 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">{t('fiscal.emit.item', 'Item {{num}}', { num: idx + 1 })}</span>
              {items.length > 1 && (
                <button onClick={() => onRemove(item.id)} className="p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-12 sm:col-span-5">
                <input value={item.description} onChange={(e) => onUpdate(item.id, 'description', e.target.value)} placeholder={t('fiscal.emit.descricaoProduto', 'Descrição do produto/serviço')} className={inputClasses} />
              </div>
              <div className="col-span-4 sm:col-span-2">
                <input value={item.ncm} onChange={(e) => onUpdate(item.id, 'ncm', e.target.value)} placeholder="NCM" className={inputClasses} />
              </div>
              <div className="col-span-4 sm:col-span-2">
                <input value={item.cfop} onChange={(e) => onUpdate(item.id, 'cfop', e.target.value)} placeholder="CFOP" className={inputClasses} />
              </div>
              <div className="col-span-4 sm:col-span-1">
                <input type="number" min={1} value={item.quantity} onChange={(e) => onUpdate(item.id, 'quantity', Number(e.target.value))} placeholder="Qtd" className={inputClasses} />
              </div>
              <div className="col-span-12 sm:col-span-2">
                <input type="number" step="0.01" min={0} value={item.unitPrice || ''} onChange={(e) => onUpdate(item.id, 'unitPrice', Number(e.target.value))} placeholder="Valor" className={inputClasses} />
              </div>
            </div>
            <div className="text-right text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('fiscal.emit.subtotal', 'Subtotal: {{value}}', { value: formatCurrency(item.quantity * item.unitPrice) })}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      <div className="text-right text-base font-bold text-gray-900 dark:text-gray-100">
        {t('fiscal.emit.total', 'Total: {{value}}', { value: formatCurrency(total) })}
      </div>
    </div>
  );
}

function PaymentsSection({
  payments,
  total,
  onUpdate,
  onAdd,
  onRemove,
  paymentLabels,
}: {
  payments: PaymentForm[];
  total: number;
  onUpdate: (id: string, field: string, value: string | number) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  paymentLabels: Record<PaymentMethod, string>;
}) {
  const { t } = useTranslation();
  const paidTotal = payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="bg-gray-50/80 dark:bg-white/[0.02] rounded-xl p-5 border border-gray-100 dark:border-gray-800 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('fiscal.emit.pagamento', 'Pagamento')}</span>
        <button onClick={onAdd} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">
          <Plus className="w-3.5 h-3.5" /> {t('fiscal.emit.adicionarForma', 'Forma')}
        </button>
      </div>
      {payments.map((payment) => (
        <div key={payment.id} className="flex items-center gap-3">
          <select
            value={payment.method}
            onChange={(e) => onUpdate(payment.id, 'method', e.target.value)}
            className={cn(selectClasses, 'flex-1')}
          >
            {Object.entries(paymentLabels).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <input
            type="number"
            step="0.01"
            min={0}
            value={payment.amount || ''}
            onChange={(e) => onUpdate(payment.id, 'amount', Number(e.target.value))}
            placeholder={formatCurrency(total)}
            className={cn(inputClasses, 'w-36')}
          />
          {payments.length > 1 && (
            <button onClick={() => onRemove(payment.id)} className="p-1.5 rounded text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ))}
      {paidTotal > 0 && paidTotal !== total && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t('fiscal.emit.diferenca', 'Diferença')}: {formatCurrency(Math.abs(total - paidTotal))} {paidTotal > total ? `(${t('fiscal.emit.troco', 'troco')})` : `(${t('fiscal.emit.faltante', 'faltante')})`}
        </p>
      )}
    </div>
  );
}
