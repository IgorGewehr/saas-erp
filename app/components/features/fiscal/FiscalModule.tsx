'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
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
  Loader2,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { collection, query, where, orderBy, getDocs, doc as firestoreDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import type { FiscalDocument, FiscalDocType, FiscalDocStatus, FiscalItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatCurrency, formatCPFCNPJ, formatDateTime, getStatusColor } from '@/lib/utils/format';
import { useTheme } from '@/app/components/providers/ThemeProvider';
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

const ITEMS_PER_PAGE = 10;

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
        'surface stat-card-accent hover-lift rounded-xl p-5 overflow-hidden',
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
  onDocumentUpdated: () => void;
  business: { razaoSocial: string; cnpj: string } | null;
}

function DocumentDetailDialog({ open, onClose, document: doc, onDocumentUpdated, business }: DocumentDetailDialogProps) {
  const [showXml, setShowXml] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
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
          type: doc.type,
          chaveAcesso: doc.accessKey,
          protocolo: doc.protocol,
          justificativa: cancelReason.trim(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        toast.error(result.error || 'Erro ao cancelar nota fiscal.');
        return;
      }

      // Update document status in Firestore
      await updateDoc(firestoreDoc(db, 'fiscalDocuments', doc.id), {
        status: 'cancelada' as const,
        canceledAt: new Date().toISOString(),
        cancelReason: cancelReason.trim(),
        updatedAt: new Date().toISOString(),
      });

      toast.success('Nota fiscal cancelada com sucesso!');
      setCancelOpen(false);
      setCancelReason('');
      onDocumentUpdated();
      onClose();
    } catch {
      toast.error('Erro de conexao. Tente novamente.');
    } finally {
      setIsCancelling(false);
    }
  }

  async function handleSyncStatus() {
    if (!doc || !doc.accessKey) return;

    setIsSyncing(true);
    try {
      const response = await fetch('/api/fiscal/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: doc.type,
          chaveAcesso: doc.accessKey,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        toast.error(result.error || 'Erro ao consultar status.');
        return;
      }

      // Update Firestore with the latest status from SEFAZ
      const updateData: Record<string, string> = {
        updatedAt: new Date().toISOString(),
      };

      if (result.data?.status) {
        const statusMap: Record<string, FiscalDocStatus> = {
          autorizada: 'autorizada',
          authorized: 'autorizada',
          cancelada: 'cancelada',
          cancelled: 'cancelada',
          rejeitada: 'rejeitada',
          rejected: 'rejeitada',
          denied: 'rejeitada',
        };
        const mappedStatus = statusMap[result.data.status.toLowerCase()];
        if (mappedStatus) {
          updateData.status = mappedStatus;
        }
      }

      if (result.data?.protocolo) {
        updateData.protocol = result.data.protocolo;
      }

      await updateDoc(firestoreDoc(db, 'fiscalDocuments', doc.id), updateData);

      toast.success('Status atualizado com sucesso!');
      onDocumentUpdated();
    } catch {
      toast.error('Erro ao sincronizar status.');
    } finally {
      setIsSyncing(false);
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
          className: 'dark:!bg-gray-900 dark:!text-gray-100',
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
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20">
                <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700 dark:text-red-400">{doc.statusMessage}</p>
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
                <p className="text-sm font-medium text-foreground">
                  {business?.razaoSocial || 'Empresa'}
                </p>
                {business?.cnpj && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    CNPJ: {formatCPFCNPJ(business.cnpj)}
                  </p>
                )}
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
                {doc.type === 'nfse' ? 'Servico' : 'Itens'}
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
              <div className="flex items-start gap-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                <XCircle className="w-4 h-4 text-gray-500 dark:text-gray-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Motivo do Cancelamento</p>
                  <p className="text-sm text-foreground">{doc.cancelReason}</p>
                </div>
              </div>
            )}
          </div>
        </DialogContent>

        <Divider />

        <DialogActions sx={{ px: 3, py: 2, flexWrap: 'wrap', gap: 1 }}>
          {/* Sync status button for processing/pending docs */}
          {['processando', 'rascunho'].includes(doc.status) && doc.accessKey && (
            <Button
              onClick={handleSyncStatus}
              startIcon={isSyncing ? <CircularProgress size={14} sx={{ color: '#64748B' }} /> : <RefreshCw size={16} />}
              size="small"
              disabled={isSyncing}
              sx={{ color: '#3B82F6' }}
            >
              Sincronizar Status
            </Button>
          )}
          {doc.pdfUrl && (
            <Button
              startIcon={<Download size={16} />}
              size="small"
              sx={{ color: '#DC2626' }}
              onClick={() => window.open(doc.pdfUrl!, '_blank')}
            >
              Baixar PDF
            </Button>
          )}
          {doc.xmlUrl && (
            <Button
              startIcon={<FileCode size={16} />}
              size="small"
              sx={{ color: '#64748B' }}
              onClick={() => window.open(doc.xmlUrl!, '_blank')}
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
        PaperProps={{ className: 'dark:!bg-gray-900 dark:!text-gray-100', sx: { borderRadius: '16px' } }}
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
        PaperProps={{ className: 'dark:!bg-gray-900 dark:!text-gray-100', sx: { borderRadius: '16px' } }}
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
// LOADING SKELETON
// ==============================================

function TableSkeleton() {
  return (
    <div className="animate-pulse">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5 border-t border-border/30">
          <div className="h-4 w-12 bg-muted rounded" />
          <div className="h-4 w-8 bg-muted rounded" />
          <div className="h-4 w-28 bg-muted rounded" />
          <div className="h-4 w-32 bg-muted rounded flex-1" />
          <div className="h-4 w-24 bg-muted rounded hidden md:block" />
          <div className="h-4 w-20 bg-muted rounded" />
          <div className="h-5 w-20 bg-muted rounded-full" />
          <div className="h-6 w-16 bg-muted rounded" />
        </div>
      ))}
    </div>
  );
}

// ==============================================
// MAIN COMPONENT
// ==============================================

export default function FiscalModule({ type }: FiscalModuleProps) {
  const { business } = useAuth();
  const { isDark } = useTheme();
  const [documents, setDocuments] = useState<FiscalDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<StatusTab>('todas');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [emitirOpen, setEmitirOpen] = useState(false);
  const [certOpen, setCertOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<FiscalDocument | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const typeConfig = TYPE_CONFIG[type];

  // Fetch documents from Firestore
  const fetchDocuments = useCallback(async (showRefreshIndicator = false) => {
    if (!business?.id) return;

    if (showRefreshIndicator) {
      setIsRefreshing(true);
    }

    try {
      const q = query(
        collection(db, 'fiscalDocuments'),
        where('businessId', '==', business.id),
        where('type', '==', type),
        orderBy('createdAt', 'desc'),
      );

      const snapshot = await getDocs(q);
      const docs: FiscalDocument[] = snapshot.docs.map((d) => ({
        ...d.data(),
        id: d.id,
      })) as FiscalDocument[];

      setDocuments(docs);
    } catch (error) {
      console.error('[FiscalModule] Error fetching documents:', error);
      toast.error('Erro ao carregar documentos fiscais.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [business?.id, type]);

  // Load documents on mount and when type changes
  useEffect(() => {
    setIsLoading(true);
    setDocuments([]);
    setActiveTab('todas');
    setSearchQuery('');
    setPage(1);
    fetchDocuments();
  }, [fetchDocuments]);

  // Filter documents by status and search
  const filteredDocuments = useMemo(() => {
    let docs = documents;

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
  }, [documents, activeTab, searchQuery]);

  // Stats from all documents (not filtered)
  const stats = useMemo(() => {
    return {
      total: documents.length,
      autorizadas: documents.filter((d) => d.status === 'autorizada').length,
      pendentes: documents.filter((d) => ['rascunho', 'processando'].includes(d.status)).length,
      canceladas: documents.filter((d) => d.status === 'cancelada').length,
    };
  }, [documents]);

  // Pagination
  const totalPages = Math.ceil(filteredDocuments.length / ITEMS_PER_PAGE);
  const paginatedDocs = filteredDocuments.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE,
  );

  const handleOpenDetail = useCallback((fiscalDoc: FiscalDocument) => {
    setSelectedDoc(fiscalDoc);
    setDetailOpen(true);
  }, []);

  const handleTabChange = useCallback((tab: StatusTab) => {
    setActiveTab(tab);
    setPage(1);
  }, []);

  const handleRefresh = useCallback(() => {
    fetchDocuments(true);
  }, [fetchDocuments]);

  const handleEmitSuccess = useCallback(() => {
    fetchDocuments(true);
  }, [fetchDocuments]);

  // Certificate warning
  const hasCertificate = !!business?.fiscal?.certificate?.serialNumber;
  const certExpired = business?.fiscal?.certificate?.expiresAt
    ? new Date(business.fiscal.certificate.expiresAt) < new Date()
    : false;

  return (
    <>
      <div className="space-y-6">
        {/* Certificate Warning Banner */}
        {(!hasCertificate || certExpired) && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              'flex items-center gap-3 p-4 rounded-xl border',
              certExpired
                ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20'
                : 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20',
            )}
          >
            <AlertTriangle className={cn('w-5 h-5 shrink-0', certExpired ? 'text-red-500' : 'text-amber-500')} />
            <div className="flex-1">
              <p className={cn('text-sm font-semibold', certExpired ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400')}>
                {certExpired ? 'Certificado digital expirado' : 'Certificado digital nao configurado'}
              </p>
              <p className={cn('text-xs mt-0.5', certExpired ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400')}>
                {certExpired
                  ? 'Renove seu certificado A1 para continuar emitindo documentos fiscais.'
                  : 'Configure seu certificado digital A1 em Configuracoes > Fiscal para emitir notas.'}
              </p>
            </div>
            <Button
              size="small"
              onClick={() => setCertOpen(true)}
              sx={{
                color: certExpired ? '#DC2626' : '#D97706',
                borderColor: certExpired ? '#FCA5A5' : '#FCD34D',
                '&:hover': {
                  borderColor: certExpired ? '#EF4444' : '#F59E0B',
                  backgroundColor: certExpired
                    ? (isDark ? 'rgba(220, 38, 38, 0.1)' : '#FEF2F2')
                    : (isDark ? 'rgba(217, 119, 6, 0.1)' : '#FFFBEB'),
                },
              }}
              variant="outlined"
            >
              {certExpired ? 'Renovar' : 'Configurar'}
            </Button>
          </motion.div>
        )}

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
              <IconButton
                onClick={handleRefresh}
                disabled={isRefreshing}
                size="small"
                title="Atualizar lista"
              >
                <RefreshCw size={18} className={cn('text-muted-foreground', isRefreshing && 'animate-spin')} />
              </IconButton>
              <Button
                onClick={() => setCertOpen(true)}
                startIcon={<Shield size={16} />}
                size="small"
                sx={{
                  color: isDark ? '#94A3B8' : '#64748B',
                  borderColor: isDark ? '#374151' : '#E2E8F0',
                  '&:hover': { borderColor: isDark ? '#4B5563' : '#CBD5E1', backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC' },
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
            icon={<FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
            iconBg="bg-blue-50 dark:bg-blue-500/10"
          />
          <StatCard
            label="Autorizadas"
            value={stats.autorizadas}
            icon={<CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
            iconBg="bg-emerald-50 dark:bg-emerald-500/10"
          />
          <StatCard
            label="Pendentes"
            value={stats.pendentes}
            icon={<Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
            iconBg="bg-amber-50 dark:bg-amber-500/10"
          />
          <StatCard
            label="Canceladas"
            value={stats.canceladas}
            icon={<XCircle className="w-5 h-5 text-gray-500 dark:text-gray-400" />}
            iconBg="bg-gray-100 dark:bg-gray-800"
          />
        </motion.div>

        {/* Search + Status Tabs */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          className="surface rounded-xl"
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
                  'border border-border/60 bg-white dark:bg-gray-900',
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
            {isLoading ? (
              <TableSkeleton />
            ) : (
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
                      {type === 'nfse' ? 'Tomador' : 'Cliente'}
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
                              {type === 'nfse' ? (
                                <FileCheck2 className="w-6 h-6 text-muted-foreground" />
                              ) : type === 'nfce' ? (
                                <Receipt className="w-6 h-6 text-muted-foreground" />
                              ) : (
                                <FileText className="w-6 h-6 text-muted-foreground" />
                              )}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                Nenhum documento encontrado
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {searchQuery
                                  ? 'Tente ajustar os filtros de busca.'
                                  : `Emita sua primeira ${type.toUpperCase()}.`}
                              </p>
                            </div>
                            {!searchQuery && (
                              <Button
                                onClick={() => setEmitirOpen(true)}
                                variant="contained"
                                size="small"
                                startIcon={<Plus size={14} />}
                                sx={{
                                  mt: 1,
                                  backgroundColor: '#DC2626',
                                  '&:hover': { backgroundColor: '#B91C1C' },
                                  fontSize: '0.75rem',
                                }}
                              >
                                Emitir {type.toUpperCase()}
                              </Button>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    ) : (
                      paginatedDocs.map((fiscalDoc) => (
                        <motion.tr
                          key={fiscalDoc.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.2 }}
                          onClick={() => handleOpenDetail(fiscalDoc)}
                          className="border-t border-border/30 hover:bg-muted/30 transition-colors cursor-pointer"
                        >
                          <td className="px-4 py-3">
                            <span className="text-sm font-semibold text-foreground">
                              {fiscalDoc.number || '-'}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span className="text-sm text-muted-foreground">{fiscalDoc.series || '-'}</span>
                          </td>
                          <td className="px-3 py-3">
                            <span className="text-sm text-foreground">
                              {formatDateTime(fiscalDoc.issueDate)}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span className="text-sm font-medium text-foreground truncate max-w-[180px] block">
                              {fiscalDoc.clientName || 'Consumidor'}
                            </span>
                          </td>
                          <td className="px-3 py-3 hidden md:table-cell">
                            <span className="text-sm text-muted-foreground font-mono">
                              {fiscalDoc.clientCpfCnpj ? formatCPFCNPJ(fiscalDoc.clientCpfCnpj) : '-'}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span className="text-sm font-semibold text-foreground">
                              {formatCurrency(fiscalDoc.totalValue)}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <StatusChip status={fiscalDoc.status} />
                          </td>
                          <td className="px-4 py-3">
                            <div
                              className="flex items-center justify-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <IconButton
                                size="small"
                                onClick={() => handleOpenDetail(fiscalDoc)}
                                title="Ver detalhes"
                              >
                                <Eye size={16} className="text-muted-foreground" />
                              </IconButton>
                              {fiscalDoc.xmlUrl && (
                                <IconButton
                                  size="small"
                                  title="Ver XML"
                                  onClick={() => window.open(fiscalDoc.xmlUrl!, '_blank')}
                                >
                                  <FileCode size={16} className="text-muted-foreground" />
                                </IconButton>
                              )}
                              {fiscalDoc.pdfUrl && (
                                <IconButton
                                  size="small"
                                  title="Download PDF"
                                  onClick={() => window.open(fiscalDoc.pdfUrl!, '_blank')}
                                >
                                  <Printer size={16} className="text-muted-foreground" />
                                </IconButton>
                              )}
                              {(fiscalDoc.status === 'rejeitada' || fiscalDoc.status === 'erro') && (
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
            )}
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
                    backgroundColor: isDark ? 'rgba(220, 38, 38, 0.15) !important' : '#FEF2F2 !important',
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
        onSuccess={handleEmitSuccess}
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
        onDocumentUpdated={handleRefresh}
        business={business ? { razaoSocial: business.razaoSocial, cnpj: business.cnpj } : null}
      />
    </>
  );
}
