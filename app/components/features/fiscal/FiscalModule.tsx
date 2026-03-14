'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  IconButton,
  Divider,
  CircularProgress,
  Pagination,
} from '@mui/material';
import {
  FileCheck2,
  Receipt,
  FileText,
  Eye,
  Download,
  XCircle,
  AlertTriangle,
  CheckCircle,
  Clock,
  Shield,
  Search,
  Plus,
  RefreshCw,
  X,
  Code,
  ChevronDown,
  ChevronUp,
  Send,
  FileCode,
  Printer,
} from 'lucide-react';
import { toast } from 'react-toastify';
import type { FiscalDocument, FiscalDocType, FiscalDocStatus, FiscalItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatCurrency, formatCPFCNPJ, formatDateTime, getStatusColor } from '@/lib/utils/format';
import EmitirNotaDialog from './EmitirNotaDialog';
import CertificateManager from './CertificateManager';

// ==============================================
// TYPES
// ==============================================

interface FiscalModuleProps {
  type: FiscalDocType;
}

type StatusTab = 'todas' | FiscalDocStatus;

// ==============================================
// MOCK DATA
// ==============================================

const mockDocuments: FiscalDocument[] = [
  {
    id: 'nf-001',
    businessId: 'biz-001',
    type: 'nfe',
    number: 1247,
    series: '1',
    accessKey: '35260312345678000190550010000012471000000001',
    protocol: '135260300012345',
    status: 'autorizada',
    clientId: 'c-001',
    clientName: 'Tech Solutions LTDA',
    clientCpfCnpj: '12345678000190',
    items: [
      { description: 'Shampoo Profissional 500ml', quantity: 10, unitPrice: 45.9, totalPrice: 459.0, ncm: '33051000', cfop: '5102', unit: 'UN' },
      { description: 'Condicionador Hidratante 500ml', quantity: 5, unitPrice: 42.5, totalPrice: 212.5, ncm: '33051000', cfop: '5102', unit: 'UN' },
    ],
    totalValue: 671.5,
    issueDate: '2026-03-13T10:30:00',
    xmlUrl: '/mock/xml/nf-001.xml',
    pdfUrl: '/mock/pdf/nf-001.pdf',
    createdAt: '2026-03-13T10:28:00',
    updatedAt: '2026-03-13T10:30:00',
  },
  {
    id: 'nf-002',
    businessId: 'biz-001',
    type: 'nfce',
    number: 4589,
    series: '1',
    accessKey: '35260312345678000190650010000045891000000002',
    protocol: '135260300012346',
    status: 'autorizada',
    clientId: 'c-002',
    clientName: 'Maria Silva',
    clientCpfCnpj: '12345678901',
    items: [
      { description: 'Corte Feminino', quantity: 1, unitPrice: 120.0, totalPrice: 120.0, unit: 'UN' },
    ],
    totalValue: 120.0,
    issueDate: '2026-03-12T15:45:00',
    xmlUrl: '/mock/xml/nf-002.xml',
    pdfUrl: '/mock/pdf/nf-002.pdf',
    createdAt: '2026-03-12T15:44:00',
    updatedAt: '2026-03-12T15:45:00',
  },
  {
    id: 'nf-003',
    businessId: 'biz-001',
    type: 'nfse',
    number: 892,
    series: 'U',
    status: 'autorizada',
    clientId: 'c-003',
    clientName: 'Comercio ABC EIRELI',
    clientCpfCnpj: '98765432000110',
    items: [
      { description: 'Consultoria em Marketing Digital', quantity: 1, unitPrice: 3500.0, totalPrice: 3500.0, unit: 'SV', taxes: { iss: { aliquota: 5, valor: 175 } } },
    ],
    totalValue: 3500.0,
    issueDate: '2026-03-11T09:00:00',
    xmlUrl: '/mock/xml/nf-003.xml',
    pdfUrl: '/mock/pdf/nf-003.pdf',
    createdAt: '2026-03-11T08:58:00',
    updatedAt: '2026-03-11T09:00:00',
  },
  {
    id: 'nf-004',
    businessId: 'biz-001',
    type: 'nfe',
    number: 1248,
    series: '1',
    status: 'processando',
    clientName: 'Joao Santos',
    clientCpfCnpj: '98765432109',
    items: [
      { description: 'Oleo Capilar 100ml', quantity: 20, unitPrice: 38.9, totalPrice: 778.0, ncm: '33059010', cfop: '5102', unit: 'UN' },
    ],
    totalValue: 778.0,
    issueDate: '2026-03-13T11:20:00',
    createdAt: '2026-03-13T11:20:00',
    updatedAt: '2026-03-13T11:20:00',
  },
  {
    id: 'nf-005',
    businessId: 'biz-001',
    type: 'nfce',
    number: 4590,
    series: '1',
    status: 'rejeitada',
    clientName: 'Ana Oliveira',
    clientCpfCnpj: '11122233344',
    items: [
      { description: 'Tintura Capilar 60g', quantity: 2, unitPrice: 28.0, totalPrice: 56.0, ncm: '33059090', cfop: '5102', unit: 'UN' },
    ],
    totalValue: 56.0,
    issueDate: '2026-03-12T16:30:00',
    statusMessage: 'Rejeicao: CNPJ do emitente nao cadastrado no ambiente de producao.',
    createdAt: '2026-03-12T16:30:00',
    updatedAt: '2026-03-12T16:31:00',
  },
  {
    id: 'nf-006',
    businessId: 'biz-001',
    type: 'nfe',
    number: 1245,
    series: '1',
    accessKey: '35260312345678000190550010000012451000000003',
    protocol: '135260300012340',
    status: 'cancelada',
    clientName: 'Pedro Ferreira',
    clientCpfCnpj: '44455566677',
    items: [
      { description: 'Creme de Tratamento 300g', quantity: 3, unitPrice: 55.0, totalPrice: 165.0, ncm: '33059090', cfop: '5102', unit: 'UN' },
    ],
    totalValue: 165.0,
    issueDate: '2026-03-10T14:00:00',
    canceledAt: '2026-03-10T16:00:00',
    cancelReason: 'Erro no valor dos itens',
    xmlUrl: '/mock/xml/nf-006.xml',
    pdfUrl: '/mock/pdf/nf-006.pdf',
    createdAt: '2026-03-10T13:58:00',
    updatedAt: '2026-03-10T16:00:00',
  },
  {
    id: 'nf-007',
    businessId: 'biz-001',
    type: 'nfse',
    status: 'rascunho',
    clientName: 'Carlos Mendes',
    clientCpfCnpj: '55566677788',
    items: [
      { description: 'Servico de Manutencao', quantity: 1, unitPrice: 800.0, totalPrice: 800.0, unit: 'SV', taxes: { iss: { aliquota: 3, valor: 24 } } },
    ],
    totalValue: 800.0,
    issueDate: '2026-03-13T08:00:00',
    createdAt: '2026-03-13T08:00:00',
    updatedAt: '2026-03-13T08:00:00',
  },
  {
    id: 'nf-008',
    businessId: 'biz-001',
    type: 'nfce',
    number: 4591,
    series: '1',
    status: 'erro',
    clientName: 'Fernanda Lima',
    clientCpfCnpj: '66677788899',
    items: [
      { description: 'Shampoo Profissional 500ml', quantity: 1, unitPrice: 45.9, totalPrice: 45.9, ncm: '33051000', cfop: '5102', unit: 'UN' },
    ],
    totalValue: 45.9,
    issueDate: '2026-03-12T18:00:00',
    statusMessage: 'Erro de comunicacao com o SEFAZ. Tente novamente.',
    createdAt: '2026-03-12T18:00:00',
    updatedAt: '2026-03-12T18:01:00',
  },
  {
    id: 'nf-009',
    businessId: 'biz-001',
    type: 'nfe',
    number: 1246,
    series: '1',
    accessKey: '35260312345678000190550010000012461000000004',
    protocol: '135260300012342',
    status: 'autorizada',
    clientName: 'Distribuidora Norte LTDA',
    clientCpfCnpj: '11222333000144',
    items: [
      { description: 'Shampoo Profissional 500ml', quantity: 50, unitPrice: 35.0, totalPrice: 1750.0, ncm: '33051000', cfop: '5102', unit: 'UN' },
      { description: 'Condicionador Hidratante 500ml', quantity: 50, unitPrice: 32.0, totalPrice: 1600.0, ncm: '33051000', cfop: '5102', unit: 'UN' },
      { description: 'Creme de Tratamento 300g', quantity: 30, unitPrice: 42.0, totalPrice: 1260.0, ncm: '33059090', cfop: '5102', unit: 'UN' },
    ],
    totalValue: 4610.0,
    issueDate: '2026-03-10T11:00:00',
    xmlUrl: '/mock/xml/nf-009.xml',
    pdfUrl: '/mock/pdf/nf-009.pdf',
    createdAt: '2026-03-10T10:58:00',
    updatedAt: '2026-03-10T11:00:00',
  },
  {
    id: 'nf-010',
    businessId: 'biz-001',
    type: 'nfse',
    number: 891,
    series: 'U',
    accessKey: '35260312345678000190990010000008911000000005',
    status: 'autorizada',
    clientName: 'Studio Design ME',
    clientCpfCnpj: '22333444000155',
    items: [
      { description: 'Design de Identidade Visual', quantity: 1, unitPrice: 5000.0, totalPrice: 5000.0, unit: 'SV', taxes: { iss: { aliquota: 5, valor: 250 } } },
    ],
    totalValue: 5000.0,
    issueDate: '2026-03-09T10:00:00',
    xmlUrl: '/mock/xml/nf-010.xml',
    pdfUrl: '/mock/pdf/nf-010.pdf',
    createdAt: '2026-03-09T09:58:00',
    updatedAt: '2026-03-09T10:00:00',
  },
];

const MOCK_XML = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe35260312345678000190550010000012471000000001" versao="4.00">
      <ide>
        <cUF>35</cUF>
        <cNF>00000001</cNF>
        <natOp>Venda de mercadoria</natOp>
        <mod>55</mod>
        <serie>1</serie>
        <nNF>1247</nNF>
        <dhEmi>2026-03-13T10:30:00-03:00</dhEmi>
        <tpNF>1</tpNF>
        <idDest>1</idDest>
        <cMunFG>3550308</cMunFG>
        <tpImp>1</tpImp>
        <tpEmis>1</tpEmis>
        <finNFe>1</finNFe>
      </ide>
      <emit>
        <CNPJ>12345678000190</CNPJ>
        <xNome>EMPRESA SERVICOS LTDA</xNome>
      </emit>
      <dest>
        <CNPJ>12345678000190</CNPJ>
        <xNome>Tech Solutions LTDA</xNome>
      </dest>
    </infNFe>
  </NFe>
</nfeProc>`;

// ==============================================
// ANIMATION VARIANTS
// ==============================================

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] },
  },
};

// ==============================================
// CONSTANTS
// ==============================================

const TYPE_CONFIG: Record<FiscalDocType, { title: string; icon: React.ReactNode }> = {
  nfse: { title: 'Notas Fiscais de Servico (NFSe)', icon: <FileCheck2 className="w-6 h-6" /> },
  nfce: { title: 'Nota Fiscal de Consumidor (NFCe)', icon: <Receipt className="w-6 h-6" /> },
  nfe: { title: 'Nota Fiscal Eletronica (NFe)', icon: <FileText className="w-6 h-6" /> },
};

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: 'todas', label: 'Todas' },
  { value: 'rascunho', label: 'Rascunho' },
  { value: 'processando', label: 'Processando' },
  { value: 'autorizada', label: 'Autorizadas' },
  { value: 'rejeitada', label: 'Rejeitadas' },
  { value: 'cancelada', label: 'Canceladas' },
  { value: 'erro', label: 'Erros' },
];

const ITEMS_PER_PAGE = 5;

// ==============================================
// STATUS CHIP COMPONENT
// ==============================================

function StatusChip({ status }: { status: FiscalDocStatus }) {
  const color = getStatusColor(status);

  const labels: Record<FiscalDocStatus, string> = {
    rascunho: 'Rascunho',
    processando: 'Processando',
    autorizada: 'Autorizada',
    rejeitada: 'Rejeitada',
    cancelada: 'Cancelada',
    erro: 'Erro',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full',
        status === 'cancelada' && 'line-through',
      )}
      style={{
        backgroundColor: `${color}14`,
        color: color,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {labels[status]}
    </span>
  );
}

// ==============================================
// STAT CARD
// ==============================================

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  iconBg: string;
}

function StatCard({ label, value, icon, iconBg }: StatCardProps) {
  return (
    <motion.div
      variants={itemVariants}
      className={cn(
        'relative overflow-hidden rounded-xl border border-border/60',
        'bg-white/70 backdrop-blur-sm p-5',
        'hover:shadow-sm transition-shadow duration-200',
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
          <p className="text-2xl font-bold tracking-tight text-foreground">{value}</p>
        </div>
        <div className={cn('flex items-center justify-center w-10 h-10 rounded-xl', iconBg)}>
          {icon}
        </div>
      </div>
    </motion.div>
  );
}

// ==============================================
// DOCUMENT DETAIL DIALOG
// ==============================================

interface DocumentDetailDialogProps {
  open: boolean;
  onClose: () => void;
  document: FiscalDocument | null;
}

function DocumentDetailDialog({ open, onClose, document: doc }: DocumentDetailDialogProps) {
  const [showXml, setShowXml] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [ccOpen, setCcOpen] = useState(false);
  const [ccText, setCcText] = useState('');

  if (!doc) return null;

  const statusTimeline = [
    {
      label: 'Criado',
      date: doc.createdAt,
      icon: <Clock className="w-4 h-4" />,
      completed: true,
    },
    {
      label: 'Processando',
      date: doc.status !== 'rascunho' ? doc.createdAt : null,
      icon: <RefreshCw className="w-4 h-4" />,
      completed: doc.status !== 'rascunho',
    },
    {
      label: doc.status === 'autorizada' ? 'Autorizada' : doc.status === 'rejeitada' ? 'Rejeitada' : doc.status === 'cancelada' ? 'Cancelada' : 'Autorizada',
      date: doc.status === 'autorizada' || doc.status === 'cancelada' ? doc.updatedAt : null,
      icon:
        doc.status === 'autorizada' ? (
          <CheckCircle className="w-4 h-4" />
        ) : doc.status === 'rejeitada' ? (
          <XCircle className="w-4 h-4" />
        ) : (
          <CheckCircle className="w-4 h-4" />
        ),
      completed: ['autorizada', 'rejeitada', 'cancelada', 'erro'].includes(doc.status),
    },
  ];

  if (doc.status === 'cancelada') {
    statusTimeline.push({
      label: 'Cancelada',
      date: doc.canceledAt || doc.updatedAt,
      icon: <XCircle className="w-4 h-4" />,
      completed: true,
    });
  }

  async function handleCancel() {
    if (!doc) return;
    if (cancelReason.trim().length < 15) {
      toast.error('A justificativa deve ter no minimo 15 caracteres.');
      return;
    }

    setIsCancelling(true);
    try {
      const response = await fetch('/api/fiscal/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chaveAcesso: doc.accessKey,
          justificativa: cancelReason.trim(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        toast.error(result.error || 'Erro ao cancelar nota fiscal.');
        return;
      }

      toast.success('Nota fiscal cancelada com sucesso!');
      setCancelOpen(false);
      setCancelReason('');
    } catch {
      toast.error('Erro de conexao. Tente novamente.');
    } finally {
      setIsCancelling(false);
    }
  }

  function handleCartaCorrecao() {
    if (ccText.trim().length < 15) {
      toast.error('O texto da carta de correcao deve ter no minimo 15 caracteres.');
      return;
    }
    toast.success('Carta de correcao enviada com sucesso!');
    setCcOpen(false);
    setCcText('');
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '16px',
            maxHeight: '90vh',
          },
        }}
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
          <div className="flex items-center gap-2">
            <div className="text-primary-600">
              {doc.type === 'nfse' ? (
                <FileCheck2 className="w-5 h-5" />
              ) : doc.type === 'nfce' ? (
                <Receipt className="w-5 h-5" />
              ) : (
                <FileText className="w-5 h-5" />
              )}
            </div>
            <div>
              <span className="block">
                {doc.type.toUpperCase()} {doc.number ? `#${doc.number}` : '(Rascunho)'}
              </span>
              <span className="block text-xs font-normal text-muted-foreground">
                Serie {doc.series || '-'} | {formatDateTime(doc.issueDate)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusChip status={doc.status} />
            <IconButton onClick={onClose} size="small">
              <X size={20} />
            </IconButton>
          </div>
        </DialogTitle>

        <Divider />

        <DialogContent sx={{ pt: 3 }}>
          <div className="space-y-6">
            {/* Status message */}
            {doc.statusMessage && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-100">
                <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700">{doc.statusMessage}</p>
              </div>
            )}

            {/* Chave de Acesso */}
            {doc.accessKey && (
              <div className="p-3 rounded-lg bg-muted/30">
                <p className="text-xs text-muted-foreground mb-1">Chave de Acesso</p>
                <p className="text-xs font-mono font-medium text-foreground break-all">
                  {doc.accessKey}
                </p>
                {doc.protocol && (
                  <>
                    <p className="text-xs text-muted-foreground mb-1 mt-2">Protocolo</p>
                    <p className="text-xs font-mono font-medium text-foreground">
                      {doc.protocol}
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Emitente / Destinatario */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg border border-border/60">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Emitente
                </p>
                <p className="text-sm font-medium text-foreground">EMPRESA SERVICOS LTDA</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  CNPJ: {formatCPFCNPJ('12345678000190')}
                </p>
              </div>
              <div className="p-4 rounded-lg border border-border/60">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  {doc.type === 'nfse' ? 'Tomador' : 'Destinatario'}
                </p>
                <p className="text-sm font-medium text-foreground">
                  {doc.clientName || 'Consumidor nao identificado'}
                </p>
                {doc.clientCpfCnpj && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {doc.clientCpfCnpj.length <= 11 ? 'CPF' : 'CNPJ'}:{' '}
                    {formatCPFCNPJ(doc.clientCpfCnpj)}
                  </p>
                )}
              </div>
            </div>

            {/* Items Table */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Itens
              </p>
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-muted/30">
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">
                          Descricao
                        </th>
                        <th className="text-center text-xs font-medium text-muted-foreground px-3 py-2.5">
                          Qtd
                        </th>
                        <th className="text-right text-xs font-medium text-muted-foreground px-3 py-2.5">
                          Valor Unit.
                        </th>
                        <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2.5">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.items.map((item: FiscalItem, idx: number) => (
                        <tr key={idx} className="border-t border-border/40">
                          <td className="text-sm text-foreground px-4 py-2.5">
                            <span className="font-medium">{item.description}</span>
                            {(item.ncm || item.cfop) && (
                              <span className="block text-xs text-muted-foreground mt-0.5">
                                {item.ncm && `NCM: ${item.ncm}`}
                                {item.ncm && item.cfop && ' | '}
                                {item.cfop && `CFOP: ${item.cfop}`}
                              </span>
                            )}
                          </td>
                          <td className="text-sm text-foreground text-center px-3 py-2.5">
                            {item.quantity} {item.unit}
                          </td>
                          <td className="text-sm text-foreground text-right px-3 py-2.5">
                            {formatCurrency(item.unitPrice)}
                          </td>
                          <td className="text-sm font-medium text-foreground text-right px-4 py-2.5">
                            {formatCurrency(item.totalPrice)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border/60 bg-muted/20">
                        <td colSpan={3} className="text-sm font-semibold text-foreground px-4 py-3 text-right">
                          Valor Total
                        </td>
                        <td className="text-sm font-bold text-primary-700 text-right px-4 py-3">
                          {formatCurrency(doc.totalValue)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>

            {/* Tax Breakdown */}
            {doc.items.some((item) => item.taxes) && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Impostos
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {doc.items.some((i) => i.taxes?.icms) && (
                    <div className="p-3 rounded-lg bg-muted/30">
                      <p className="text-xs text-muted-foreground">ICMS</p>
                      <p className="text-sm font-semibold text-foreground">
                        {formatCurrency(
                          doc.items.reduce((sum, i) => sum + (i.taxes?.icms?.valor || 0), 0),
                        )}
                      </p>
                    </div>
                  )}
                  {doc.items.some((i) => i.taxes?.pis) && (
                    <div className="p-3 rounded-lg bg-muted/30">
                      <p className="text-xs text-muted-foreground">PIS</p>
                      <p className="text-sm font-semibold text-foreground">
                        {formatCurrency(
                          doc.items.reduce((sum, i) => sum + (i.taxes?.pis?.valor || 0), 0),
                        )}
                      </p>
                    </div>
                  )}
                  {doc.items.some((i) => i.taxes?.cofins) && (
                    <div className="p-3 rounded-lg bg-muted/30">
                      <p className="text-xs text-muted-foreground">COFINS</p>
                      <p className="text-sm font-semibold text-foreground">
                        {formatCurrency(
                          doc.items.reduce((sum, i) => sum + (i.taxes?.cofins?.valor || 0), 0),
                        )}
                      </p>
                    </div>
                  )}
                  {doc.items.some((i) => i.taxes?.iss) && (
                    <div className="p-3 rounded-lg bg-muted/30">
                      <p className="text-xs text-muted-foreground">ISS</p>
                      <p className="text-sm font-semibold text-foreground">
                        {formatCurrency(
                          doc.items.reduce((sum, i) => sum + (i.taxes?.iss?.valor || 0), 0),
                        )}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Status Timeline */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Historico
              </p>
              <div className="space-y-0">
                {statusTimeline.map((step, idx) => (
                  <div key={idx} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className={cn(
                          'flex items-center justify-center w-8 h-8 rounded-full border-2',
                          step.completed
                            ? 'bg-primary-50 border-primary-500 text-primary-600'
                            : 'bg-muted border-border text-muted-foreground',
                        )}
                      >
                        {step.icon}
                      </div>
                      {idx < statusTimeline.length - 1 && (
                        <div
                          className={cn(
                            'w-0.5 h-8',
                            step.completed ? 'bg-primary-300' : 'bg-border',
                          )}
                        />
                      )}
                    </div>
                    <div className="pt-1">
                      <p
                        className={cn(
                          'text-sm font-medium',
                          step.completed ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      >
                        {step.label}
                      </p>
                      {step.date && (
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(step.date)}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Cancel info */}
            {doc.status === 'cancelada' && doc.cancelReason && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-gray-50 border border-gray-200">
                <XCircle className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Motivo do Cancelamento</p>
                  <p className="text-sm text-foreground">{doc.cancelReason}</p>
                </div>
              </div>
            )}

            {/* XML Viewer */}
            {doc.xmlUrl && (
              <div>
                <button
                  onClick={() => setShowXml(!showXml)}
                  className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Code className="w-4 h-4" />
                  <span>XML do Documento</span>
                  {showXml ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
                <AnimatePresence>
                  {showXml && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <pre className="mt-3 p-4 rounded-lg bg-slate-900 text-slate-100 text-xs font-mono overflow-x-auto max-h-64 leading-relaxed">
                        {MOCK_XML}
                      </pre>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </DialogContent>

        <Divider />

        <DialogActions sx={{ px: 3, py: 2, flexWrap: 'wrap', gap: 1 }}>
          {doc.pdfUrl && (
            <Button
              startIcon={<Download size={16} />}
              size="small"
              sx={{ color: '#DC2626' }}
            >
              Baixar PDF
            </Button>
          )}
          {doc.xmlUrl && (
            <Button
              startIcon={<FileCode size={16} />}
              size="small"
              sx={{ color: '#64748B' }}
            >
              Baixar XML
            </Button>
          )}
          {doc.status === 'autorizada' && (
            <Button
              onClick={() => setCancelOpen(true)}
              startIcon={<XCircle size={16} />}
              size="small"
              sx={{ color: '#EF4444' }}
            >
              Cancelar
            </Button>
          )}
          {doc.type === 'nfe' && doc.status === 'autorizada' && (
            <Button
              onClick={() => setCcOpen(true)}
              startIcon={<FileText size={16} />}
              size="small"
              sx={{ color: '#64748B' }}
            >
              Carta de Correcao
            </Button>
          )}
          {(doc.status === 'rejeitada' || doc.status === 'erro') && (
            <Button
              startIcon={<Send size={16} />}
              size="small"
              sx={{ color: '#DC2626' }}
            >
              Reenviar
            </Button>
          )}
          <div className="flex-1" />
          <Button onClick={onClose} sx={{ color: '#64748B' }}>
            Fechar
          </Button>
        </DialogActions>
      </Dialog>

      {/* Cancel confirmation dialog */}
      <Dialog
        open={cancelOpen}
        onClose={() => !isCancelling && setCancelOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: '16px' } }}
      >
        <DialogTitle
          sx={{
            fontFamily: '"Plus Jakarta Sans", sans-serif',
            fontWeight: 700,
          }}
        >
          Cancelar Nota Fiscal
        </DialogTitle>
        <DialogContent>
          <p className="text-sm text-muted-foreground mb-4">
            Informe a justificativa para o cancelamento. O prazo legal para cancelamento e de ate
            24 horas apos a autorizacao.
          </p>
          <TextField
            label="Justificativa (min. 15 caracteres)"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            fullWidth
            size="small"
            multiline
            rows={3}
            disabled={isCancelling}
            helperText={`${cancelReason.length}/255 caracteres`}
            inputProps={{ maxLength: 255 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button
            onClick={() => setCancelOpen(false)}
            disabled={isCancelling}
            sx={{ color: '#64748B' }}
          >
            Voltar
          </Button>
          <Button
            onClick={handleCancel}
            variant="contained"
            disabled={isCancelling || cancelReason.trim().length < 15}
            sx={{
              backgroundColor: '#EF4444',
              '&:hover': { backgroundColor: '#DC2626' },
            }}
          >
            {isCancelling ? (
              <CircularProgress size={20} sx={{ color: 'white' }} />
            ) : (
              'Confirmar Cancelamento'
            )}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Carta de Correcao dialog */}
      <Dialog
        open={ccOpen}
        onClose={() => setCcOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: '16px' } }}
      >
        <DialogTitle
          sx={{
            fontFamily: '"Plus Jakarta Sans", sans-serif',
            fontWeight: 700,
          }}
        >
          Carta de Correcao (CC-e)
        </DialogTitle>
        <DialogContent>
          <p className="text-sm text-muted-foreground mb-4">
            A carta de correcao permite corrigir informacoes da nota fiscal sem necessidade de
            cancelamento. Nao e possivel alterar valores, impostos ou dados do destinatario.
          </p>
          <TextField
            label="Texto da Correcao (min. 15 caracteres)"
            value={ccText}
            onChange={(e) => setCcText(e.target.value)}
            fullWidth
            size="small"
            multiline
            rows={4}
            helperText={`${ccText.length}/1000 caracteres`}
            inputProps={{ maxLength: 1000 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setCcOpen(false)} sx={{ color: '#64748B' }}>
            Cancelar
          </Button>
          <Button
            onClick={handleCartaCorrecao}
            variant="contained"
            disabled={ccText.trim().length < 15}
            sx={{
              backgroundColor: '#DC2626',
              '&:hover': { backgroundColor: '#B91C1C' },
            }}
          >
            Enviar Carta de Correcao
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ==============================================
// MAIN COMPONENT
// ==============================================

export default function FiscalModule({ type }: FiscalModuleProps) {
  const [activeTab, setActiveTab] = useState<StatusTab>('todas');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [emitirOpen, setEmitirOpen] = useState(false);
  const [certOpen, setCertOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<FiscalDocument | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const typeConfig = TYPE_CONFIG[type];

  // Filter documents by type and status
  const filteredDocuments = useMemo(() => {
    let docs = mockDocuments.filter((d) => d.type === type);

    if (activeTab !== 'todas') {
      docs = docs.filter((d) => d.status === activeTab);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      docs = docs.filter(
        (d) =>
          d.number?.toString().includes(q) ||
          d.clientName?.toLowerCase().includes(q) ||
          d.clientCpfCnpj?.includes(q) ||
          d.accessKey?.includes(q),
      );
    }

    return docs;
  }, [type, activeTab, searchQuery]);

  // Stats
  const stats = useMemo(() => {
    const docs = mockDocuments.filter((d) => d.type === type);
    return {
      total: docs.length,
      autorizadas: docs.filter((d) => d.status === 'autorizada').length,
      pendentes: docs.filter((d) => ['rascunho', 'processando'].includes(d.status)).length,
      canceladas: docs.filter((d) => d.status === 'cancelada').length,
    };
  }, [type]);

  // Pagination
  const totalPages = Math.ceil(filteredDocuments.length / ITEMS_PER_PAGE);
  const paginatedDocs = filteredDocuments.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE,
  );

  const handleOpenDetail = useCallback((doc: FiscalDocument) => {
    setSelectedDoc(doc);
    setDetailOpen(true);
  }, []);

  const handleTabChange = useCallback((tab: StatusTab) => {
    setActiveTab(tab);
    setPage(1);
  }, []);

  return (
    <>
      <div className="space-y-6">
        {/* Page Header */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary-50 text-primary-600">
                {typeConfig.icon}
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-foreground font-display">
                  {typeConfig.title}
                </h1>
                <p className="text-sm text-muted-foreground">
                  Gerencie seus documentos fiscais eletronicos
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setCertOpen(true)}
                startIcon={<Shield size={16} />}
                size="small"
                sx={{
                  color: '#64748B',
                  borderColor: '#E2E8F0',
                  '&:hover': { borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
                }}
                variant="outlined"
              >
                Certificado
              </Button>
              <Button
                onClick={() => setEmitirOpen(true)}
                variant="contained"
                startIcon={<Plus size={16} />}
                sx={{
                  backgroundColor: '#DC2626',
                  '&:hover': { backgroundColor: '#B91C1C' },
                  fontWeight: 600,
                }}
              >
                Emitir Nova Nota
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Stats Cards */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-2 lg:grid-cols-4 gap-4"
        >
          <StatCard
            label="Total Emitidas"
            value={stats.total}
            icon={<FileText className="w-5 h-5 text-blue-600" />}
            iconBg="bg-blue-50"
          />
          <StatCard
            label="Autorizadas"
            value={stats.autorizadas}
            icon={<CheckCircle className="w-5 h-5 text-emerald-600" />}
            iconBg="bg-emerald-50"
          />
          <StatCard
            label="Pendentes"
            value={stats.pendentes}
            icon={<Clock className="w-5 h-5 text-amber-600" />}
            iconBg="bg-amber-50"
          />
          <StatCard
            label="Canceladas"
            value={stats.canceladas}
            icon={<XCircle className="w-5 h-5 text-gray-500" />}
            iconBg="bg-gray-100"
          />
        </motion.div>

        {/* Search + Status Tabs */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          className="rounded-xl border border-border/60 bg-white/70 backdrop-blur-sm"
        >
          {/* Controls */}
          <div className="p-4 space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Buscar por numero, cliente ou CPF/CNPJ..."
                className={cn(
                  'w-full pl-10 pr-4 py-2.5 text-sm rounded-lg',
                  'border border-border/60 bg-white',
                  'text-foreground placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400',
                  'transition-all duration-200',
                )}
              />
            </div>

            {/* Status Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => handleTabChange(tab.value)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 whitespace-nowrap',
                    activeTab === tab.value
                      ? 'bg-primary-50 text-primary-700 shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Documents Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-t border-border/40 bg-muted/20">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                    Numero
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-3">
                    Serie
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-3">
                    Data Emissao
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-3">
                    Cliente
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-3 hidden md:table-cell">
                    CPF/CNPJ
                  </th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-3 py-3">
                    Valor Total
                  </th>
                  <th className="text-center text-xs font-medium text-muted-foreground px-3 py-3">
                    Status
                  </th>
                  <th className="text-center text-xs font-medium text-muted-foreground px-4 py-3">
                    Acoes
                  </th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence mode="popLayout">
                  {paginatedDocs.length === 0 ? (
                    <motion.tr
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      <td colSpan={8} className="text-center py-16 px-4">
                        <div className="flex flex-col items-center gap-3">
                          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-muted">
                            <FileText className="w-6 h-6 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              Nenhum documento encontrado
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {searchQuery
                                ? 'Tente ajustar os filtros de busca.'
                                : 'Emita sua primeira nota fiscal.'}
                            </p>
                          </div>
                        </div>
                      </td>
                    </motion.tr>
                  ) : (
                    paginatedDocs.map((doc) => (
                      <motion.tr
                        key={doc.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2 }}
                        onClick={() => handleOpenDetail(doc)}
                        className="border-t border-border/30 hover:bg-muted/30 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3">
                          <span className="text-sm font-semibold text-foreground">
                            {doc.number || '-'}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-sm text-muted-foreground">{doc.series || '-'}</span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-sm text-foreground">
                            {formatDateTime(doc.issueDate)}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-sm font-medium text-foreground truncate max-w-[180px] block">
                            {doc.clientName || 'Consumidor'}
                          </span>
                        </td>
                        <td className="px-3 py-3 hidden md:table-cell">
                          <span className="text-sm text-muted-foreground font-mono">
                            {doc.clientCpfCnpj ? formatCPFCNPJ(doc.clientCpfCnpj) : '-'}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <span className="text-sm font-semibold text-foreground">
                            {formatCurrency(doc.totalValue)}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <StatusChip status={doc.status} />
                        </td>
                        <td className="px-4 py-3">
                          <div
                            className="flex items-center justify-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <IconButton
                              size="small"
                              onClick={() => handleOpenDetail(doc)}
                              title="Ver detalhes"
                            >
                              <Eye size={16} className="text-muted-foreground" />
                            </IconButton>
                            {doc.xmlUrl && (
                              <IconButton size="small" title="Ver XML">
                                <FileCode size={16} className="text-muted-foreground" />
                              </IconButton>
                            )}
                            {doc.pdfUrl && (
                              <IconButton size="small" title="Download PDF">
                                <Printer size={16} className="text-muted-foreground" />
                              </IconButton>
                            )}
                            {(doc.status === 'rejeitada' || doc.status === 'erro') && (
                              <IconButton size="small" title="Reenviar">
                                <Send size={16} className="text-amber-500" />
                              </IconButton>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    ))
                  )}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
              <p className="text-xs text-muted-foreground">
                Mostrando {(page - 1) * ITEMS_PER_PAGE + 1} a{' '}
                {Math.min(page * ITEMS_PER_PAGE, filteredDocuments.length)} de{' '}
                {filteredDocuments.length} documentos
              </p>
              <Pagination
                count={totalPages}
                page={page}
                onChange={(_, p) => setPage(p)}
                size="small"
                sx={{
                  '& .MuiPaginationItem-root': {
                    fontSize: '0.75rem',
                  },
                  '& .Mui-selected': {
                    backgroundColor: '#FEF2F2 !important',
                    color: '#DC2626',
                    fontWeight: 600,
                  },
                }}
              />
            </div>
          )}
        </motion.div>
      </div>

      {/* Dialogs */}
      <EmitirNotaDialog
        open={emitirOpen}
        onClose={() => setEmitirOpen(false)}
        type={type}
      />

      <CertificateManager
        open={certOpen}
        onClose={() => setCertOpen(false)}
      />

      <DocumentDetailDialog
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setSelectedDoc(null);
        }}
        document={selectedDoc}
      />
    </>
  );
}
