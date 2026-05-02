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
  FileDown,
  AlertCircle,
  BookOpen,
  Hash,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { collection, query, where, orderBy, getDocs, doc as firestoreDoc, updateDoc } from 'firebase/firestore';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/config/firebase';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/app/components/providers/AuthProvider';
import type { FiscalDocument, FiscalDocType, FiscalDocStatus, FiscalItem } from '@/lib/types';
import { ROLE_HIERARCHY } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatCurrency, formatCPFCNPJ, formatDateTime, getStatusColor } from '@/lib/utils/format';
import { useTheme } from '@/app/components/providers/ThemeProvider';
import { useTranslation } from 'react-i18next';
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

const TYPE_ICONS: Record<FiscalDocType, React.ReactNode> = {
  nfse: <FileCheck2 className="w-6 h-6" />,
  nfce: <Receipt className="w-6 h-6" />,
  nfe: <FileText className="w-6 h-6" />,
};

const ITEMS_PER_PAGE = 10;

// ==============================================
// STATUS CHIP COMPONENT
// ==============================================

function StatusChip({ status }: { status: FiscalDocStatus }) {
  const { t } = useTranslation();
  const color = getStatusColor(status);

  const statusLabels: Record<FiscalDocStatus, string> = {
    rascunho: t('fiscal.status.rascunho', 'Rascunho'),
    processando: t('fiscal.status.processando', 'Processando'),
    autorizada: t('fiscal.status.autorizada', 'Autorizada'),
    rejeitada: t('fiscal.status.rejeitada', 'Rejeitada'),
    cancelada: t('fiscal.status.cancelada', 'Cancelada'),
    erro: t('fiscal.status.erro', 'Erro'),
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
      {statusLabels[status]}
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
  businessId: string | null;
  business: { razaoSocial: string; cnpj: string } | null;
  onPrintDanfe?: (document: FiscalDocument) => void;
  onCartaCorrecao?: (document: FiscalDocument) => void;
}

function DocumentDetailDialog({ open, onClose, document: doc, onDocumentUpdated, businessId, business, onPrintDanfe, onCartaCorrecao }: DocumentDetailDialogProps) {
  const { t } = useTranslation();
  const { firebaseUser } = useAuth();
  const [showXml, setShowXml] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [ccOpen, setCcOpen] = useState(false);
  const [ccText, setCcText] = useState('');

  if (!doc) return null;

  const items = doc.items ?? [];

  const statusTimeline = [
    {
      label: t('fiscal.detail.timeline.criado', 'Criado'),
      date: doc.createdAt,
      icon: <Clock className="w-4 h-4" />,
      completed: true,
    },
    {
      label: t('fiscal.detail.timeline.processando', 'Processando'),
      date: doc.status !== 'rascunho' ? doc.createdAt : null,
      icon: <RefreshCw className="w-4 h-4" />,
      completed: doc.status !== 'rascunho',
    },
    {
      label: doc.status === 'autorizada' ? t('fiscal.detail.timeline.autorizada', 'Autorizada') : doc.status === 'rejeitada' ? t('fiscal.detail.timeline.rejeitada', 'Rejeitada') : doc.status === 'cancelada' ? t('fiscal.detail.timeline.cancelada', 'Cancelada') : t('fiscal.detail.timeline.autorizada', 'Autorizada'),
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
      label: t('fiscal.detail.timeline.cancelada', 'Cancelada'),
      date: doc.canceledAt || doc.updatedAt,
      icon: <XCircle className="w-4 h-4" />,
      completed: true,
    });
  }

  async function handleCancel() {
    if (!doc) return;
    if (cancelReason.trim().length < 15) {
      toast.error(t('fiscal.cancel.minCharsError', 'A justificativa deve ter no mínimo 15 caracteres.'));
      return;
    }
    // Documentos antigos podem ter sido salvos sem chave de acesso (bug pré-fix).
    // Sem chave, o cancelamento na SEFAZ é impossível — orientar o usuário.
    if (!doc.accessKey || doc.accessKey.replace(/\D/g, '').length !== 44) {
      toast.error(t('fiscal.cancel.noAccessKey', 'Esta nota não tem chave de acesso registrada (registro antigo). Cancele direto no portal SEFAZ.'));
      return;
    }

    setIsCancelling(true);
    try {
      const response = await fetch('/api/fiscal/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(firebaseUser ? { Authorization: `Bearer ${await firebaseUser.getIdToken()}` } : {}) },
        body: JSON.stringify({
          type: doc.type,
          businessId,
          chaveAcesso: doc.accessKey,
          protocolo: doc.protocol,
          justificativa: cancelReason.trim(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        toast.error(result.error || t('fiscal.cancel.error', 'Erro ao cancelar nota fiscal.'));
        return;
      }

      // Update document status in Firestore
      await updateDoc(firestoreDoc(db, 'fiscalDocuments', doc.id), {
        status: 'cancelada' as const,
        canceledAt: new Date().toISOString(),
        cancelReason: cancelReason.trim(),
        updatedAt: new Date().toISOString(),
      });

      toast.success(t('fiscal.cancel.success', 'Nota fiscal cancelada com sucesso!'));
      setCancelOpen(false);
      setCancelReason('');
      onDocumentUpdated();
      onClose();
    } catch {
      toast.error(t('fiscal.cancel.connectionError', 'Erro de conexão. Tente novamente.'));
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
        headers: { 'Content-Type': 'application/json', ...(firebaseUser ? { Authorization: `Bearer ${await firebaseUser.getIdToken()}` } : {}) },
        body: JSON.stringify({
          type: doc.type,
          businessId,
          chaveAcesso: doc.accessKey,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        toast.error(result.error || t('fiscal.sync.error', 'Erro ao sincronizar status.'));
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

      toast.success(t('fiscal.sync.success', 'Status atualizado com sucesso!'));
      onDocumentUpdated();
    } catch {
      toast.error(t('fiscal.sync.error', 'Erro ao sincronizar status.'));
    } finally {
      setIsSyncing(false);
    }
  }

  function handleCartaCorrecao() {
    if (ccText.trim().length < 15) {
      toast.error(t('fiscal.cartaCorrecao.minCharsError', 'Texto da correção deve ter no mínimo 15 caracteres.'));
      return;
    }
    toast.success(t('fiscal.cartaCorrecao.success', 'Carta de correção enviada com sucesso!'));
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
                {doc.type.toUpperCase()} {doc.number ? `#${doc.number}` : t('fiscal.detail.rascunho', '(Rascunho)')}
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
                <p className="text-xs text-muted-foreground mb-1">{t('fiscal.detail.chaveAcesso', 'Chave de Acesso')}</p>
                <p className="text-xs font-mono font-medium text-foreground break-all">
                  {doc.accessKey}
                </p>
                {doc.protocol && (
                  <>
                    <p className="text-xs text-muted-foreground mb-1 mt-2">{t('fiscal.detail.protocolo', 'Protocolo')}</p>
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
                  {t('fiscal.detail.emitente', 'Emitente')}
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
                  {doc.type === 'nfse' ? t('fiscal.detail.tomador', 'Tomador') : t('fiscal.detail.destinatario', 'Destinatário')}
                </p>
                <p className="text-sm font-medium text-foreground">
                  {doc.clientName || t('fiscal.detail.consumidorNaoIdentificado', 'Consumidor não identificado')}
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
                {doc.type === 'nfse' ? t('fiscal.detail.servico', 'Serviço') : t('fiscal.detail.itens', 'Itens')}
              </p>
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-muted/30">
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">
                          {t('fiscal.detail.descricao', 'Descrição')}
                        </th>
                        <th className="text-center text-xs font-medium text-muted-foreground px-3 py-2.5">
                          {t('fiscal.detail.qtd', 'Qtd')}
                        </th>
                        <th className="text-right text-xs font-medium text-muted-foreground px-3 py-2.5">
                          {t('fiscal.detail.valorUnit', 'Valor Unit.')}
                        </th>
                        <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2.5">
                          {t('fiscal.detail.total', 'Total')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item: FiscalItem, idx: number) => (
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
                          {t('fiscal.detail.valorTotal', 'Valor Total')}
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
            {items.some((item) => item.taxes) && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  {t('fiscal.detail.impostos', 'Impostos')}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {items.some((i) => i.taxes?.icms) && (
                    <div className="p-3 rounded-lg bg-muted/30">
                      <p className="text-xs text-muted-foreground">ICMS</p>
                      <p className="text-sm font-semibold text-foreground">
                        {formatCurrency(
                          items.reduce((sum, i) => sum + (i.taxes?.icms?.valor || 0), 0),
                        )}
                      </p>
                    </div>
                  )}
                  {items.some((i) => i.taxes?.pis) && (
                    <div className="p-3 rounded-lg bg-muted/30">
                      <p className="text-xs text-muted-foreground">PIS</p>
                      <p className="text-sm font-semibold text-foreground">
                        {formatCurrency(
                          items.reduce((sum, i) => sum + (i.taxes?.pis?.valor || 0), 0),
                        )}
                      </p>
                    </div>
                  )}
                  {items.some((i) => i.taxes?.cofins) && (
                    <div className="p-3 rounded-lg bg-muted/30">
                      <p className="text-xs text-muted-foreground">COFINS</p>
                      <p className="text-sm font-semibold text-foreground">
                        {formatCurrency(
                          items.reduce((sum, i) => sum + (i.taxes?.cofins?.valor || 0), 0),
                        )}
                      </p>
                    </div>
                  )}
                  {items.some((i) => i.taxes?.iss) && (
                    <div className="p-3 rounded-lg bg-muted/30">
                      <p className="text-xs text-muted-foreground">ISS</p>
                      <p className="text-sm font-semibold text-foreground">
                        {formatCurrency(
                          items.reduce((sum, i) => sum + (i.taxes?.iss?.valor || 0), 0),
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
                {t('fiscal.detail.historico', 'Histórico')}
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
                  <p className="text-xs text-muted-foreground">{t('fiscal.detail.motivoCancelamento', 'Motivo do Cancelamento')}</p>
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
              {t('fiscal.actions.sincronizar', 'Sincronizar Status')}
            </Button>
          )}
          {doc.pdfUrl && (
            <Button
              startIcon={<Download size={16} />}
              size="small"
              sx={{ color: '#DC2626' }}
              onClick={() => window.open(doc.pdfUrl!, '_blank')}
            >
              {t('fiscal.actions.baixarPdf', 'Baixar PDF')}
            </Button>
          )}
          {doc.xmlUrl && (
            <Button
              startIcon={<FileCode size={16} />}
              size="small"
              sx={{ color: '#64748B' }}
              onClick={() => window.open(doc.xmlUrl!, '_blank')}
            >
              {t('fiscal.actions.baixarXml', 'Baixar XML')}
            </Button>
          )}
          {doc.xml && onPrintDanfe && (
            <button
              onClick={() => onPrintDanfe(doc)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              {t('fiscal.actions.imprimirDanfe', 'Imprimir DANFE')}
            </button>
          )}
          {doc.status === 'autorizada' && (
            <Button
              onClick={() => setCancelOpen(true)}
              startIcon={<XCircle size={16} />}
              size="small"
              sx={{ color: '#EF4444' }}
            >
              {t('fiscal.actions.cancelar', 'Cancelar')}
            </Button>
          )}
          {doc.type === 'nfe' && doc.status === 'autorizada' && onCartaCorrecao && (
            <button
              onClick={() => onCartaCorrecao(doc)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5" />
              {t('fiscal.actions.cartaCorrecao', 'Carta de Correção')}
            </button>
          )}
          {doc.type === 'nfe' && doc.status === 'autorizada' && !onCartaCorrecao && (
            <Button
              onClick={() => setCcOpen(true)}
              startIcon={<FileText size={16} />}
              size="small"
              sx={{ color: '#64748B' }}
            >
              {t('fiscal.actions.cartaCorrecao', 'Carta de Correção')}
            </Button>
          )}
          {(doc.status === 'rejeitada' || doc.status === 'erro') && (
            <Button
              startIcon={<Send size={16} />}
              size="small"
              sx={{ color: '#DC2626' }}
            >
              {t('fiscal.actions.reenviar', 'Reenviar')}
            </Button>
          )}
          <div className="flex-1" />
          <Button onClick={onClose} sx={{ color: '#64748B' }}>
            {t('fiscal.actions.fechar', 'Fechar')}
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
          {t('fiscal.cancel.title', 'Cancelar Nota Fiscal')}
        </DialogTitle>
        <DialogContent>
          <p className="text-sm text-muted-foreground mb-4">
            {t('fiscal.cancel.desc', 'Informe a justificativa para o cancelamento. O prazo legal para cancelamento é de até 24 horas após a autorização.')}
          </p>
          <TextField
            label={t('fiscal.cancel.justificativaLabel', 'Justificativa (min. 15 caracteres)')}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            fullWidth
            size="small"
            multiline
            rows={3}
            disabled={isCancelling}
            helperText={t('fiscal.cancel.charCount', '{{count}}/255 caracteres', { count: cancelReason.length })}
            inputProps={{ maxLength: 255 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button
            onClick={() => setCancelOpen(false)}
            disabled={isCancelling}
            sx={{ color: '#64748B' }}
          >
            {t('fiscal.actions.voltar', 'Voltar')}
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
              t('fiscal.actions.confirmarCancelamento', 'Confirmar Cancelamento')
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
          {t('fiscal.cartaCorrecao.title', 'Carta de Correção (CC-e)')}
        </DialogTitle>
        <DialogContent>
          <p className="text-sm text-muted-foreground mb-4">
            {t('fiscal.cartaCorrecao.desc', 'A carta de correção permite corrigir informações da nota fiscal sem necessidade de cancelamento. Não é possível alterar valores, impostos ou dados do destinatário.')}
          </p>
          <TextField
            label={t('fiscal.cartaCorrecao.textLabel', 'Texto da Correção (min. 15 caracteres)')}
            value={ccText}
            onChange={(e) => setCcText(e.target.value)}
            fullWidth
            size="small"
            multiline
            rows={4}
            helperText={t('fiscal.cartaCorrecao.charCount', '{{count}}/1000 caracteres', { count: ccText.length })}
            inputProps={{ maxLength: 1000 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setCcOpen(false)} sx={{ color: '#64748B' }}>
            {t('fiscal.actions.cancelar', 'Cancelar')}
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
            {t('fiscal.actions.enviarCarta', 'Enviar Carta')}
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
  const { business, user, firebaseUser } = useAuth();
  const isManager = ROLE_HIERARCHY[user?.role ?? 'viewer'] >= ROLE_HIERARCHY['manager'];
  const { isDark } = useTheme();
  const { t } = useTranslation();
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
  const [cartaCorrecaoOpen, setCartaCorrecaoOpen] = useState(false);
  const [cartaCorrecaoDoc, setCartaCorrecaoDoc] = useState<FiscalDocument | null>(null);
  const [cartaCorrecaoText, setCartaCorrecaoText] = useState('');
  const [isCartaCorrecaoSending, setIsCartaCorrecaoSending] = useState(false);
  const [inutilizarOpen, setInutilizarOpen] = useState(false);
  const [inutilizarNumInicial, setInutilizarNumInicial] = useState('');
  const [inutilizarNumFinal, setInutilizarNumFinal] = useState('');
  const [inutilizarJustificativa, setInutilizarJustificativa] = useState('');
  const [inutilizarModelo, setInutilizarModelo] = useState<'55' | '65'>('55');
  const [isInutilizarSending, setIsInutilizarSending] = useState(false);
  const [accountingOpen, setAccountingOpen] = useState(false);
  const [accountingMonth, setAccountingMonth] = useState(new Date().getMonth() + 1);
  const [accountingYear, setAccountingYear] = useState(new Date().getFullYear());
  const [isAccountingSending, setIsAccountingSending] = useState(false);

  const queryClient = useQueryClient();
  const typeConfig = useMemo(() => ({
    title: t(`fiscal.title.${type}`, type === 'nfse' ? 'Notas Fiscais de Serviço (NFSe)' : type === 'nfce' ? 'Nota Fiscal de Consumidor (NFCe)' : 'Nota Fiscal Eletrônica (NFe)'),
    icon: TYPE_ICONS[type],
  }), [t, type]);

  const STATUS_TABS = useMemo<{ value: StatusTab; label: string }[]>(() => [
    { value: 'todas', label: t('fiscal.tabs.todas', 'Todas') },
    { value: 'rascunho', label: t('fiscal.tabs.rascunho', 'Rascunho') },
    { value: 'processando', label: t('fiscal.tabs.processando', 'Processando') },
    { value: 'autorizada', label: t('fiscal.tabs.autorizada', 'Autorizadas') },
    { value: 'rejeitada', label: t('fiscal.tabs.rejeitada', 'Rejeitadas') },
    { value: 'cancelada', label: t('fiscal.tabs.cancelada', 'Canceladas') },
    { value: 'erro', label: t('fiscal.tabs.erro', 'Erros') },
  ], [t]);

  // Fetch documents from Firestore
  const fetchDocuments = useCallback(async (showRefreshIndicator = false) => {
    if (!business?.id || !isManager) return;

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
      toast.error(t('fiscal.sync.error', 'Erro ao carregar documentos fiscais.'));
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

  // ── DANFE Print ──
  const handlePrintDanfe = async (document: FiscalDocument) => {
    if (!document.xml) {
      toast.error(t('fiscal.danfe.noXml', 'XML não disponível para gerar DANFE.'));
      return;
    }
    try {
      const res = await fetch('/api/fiscal/danfe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(firebaseUser ? { Authorization: `Bearer ${await firebaseUser.getIdToken()}` } : {}) },
        body: JSON.stringify({ xml: document.xml, type: document.type }),
      });
      if (!res.ok) { toast.error(t('fiscal.danfe.error', 'Erro ao gerar DANFE.')); return; }
      const html = await res.text();
      const win = window.open('', '_blank');
      if (win) { win.document.write(html); win.document.close(); }
    } catch { toast.error(t('fiscal.danfe.error', 'Erro ao gerar DANFE.')); }
  };

  // ── Carta de Correção ──
  const handleCartaCorrecao = async () => {
    if (!cartaCorrecaoDoc || !business) return;
    if (cartaCorrecaoText.trim().length < 15) {
      toast.error(t('fiscal.cartaCorrecao.minCharsError', 'Texto da correção deve ter no mínimo 15 caracteres.'));
      return;
    }
    setIsCartaCorrecaoSending(true);
    try {
      const sequencia = (cartaCorrecaoDoc.cartaCorrecao?.length || 0) + 1;
      const res = await fetch('/api/fiscal/carta-correcao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(firebaseUser ? { Authorization: `Bearer ${await firebaseUser.getIdToken()}` } : {}) },
        body: JSON.stringify({
          businessId: business?.id,
          chaveAcesso: cartaCorrecaoDoc.accessKey,
          sequencia,
          textoCorrecao: cartaCorrecaoText.trim(),
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        toast.error(result.details?.motivoStatus || result.error || 'Erro na carta de correcao');
        return;
      }
      // Save to Firestore
      const existingCartas = cartaCorrecaoDoc.cartaCorrecao || [];
      await updateDoc(firestoreDoc(db, 'fiscalDocuments', cartaCorrecaoDoc.id), {
        cartaCorrecao: [...existingCartas, {
          sequencia,
          texto: cartaCorrecaoText.trim(),
          protocolo: result.data?.protocolo || null,
          dataEvento: new Date().toISOString(),
        }],
        updatedAt: new Date().toISOString(),
      });
      toast.success(t('fiscal.cartaCorrecao.success', 'Carta de correção enviada com sucesso!'));
      setCartaCorrecaoOpen(false);
      setCartaCorrecaoText('');
      queryClient.invalidateQueries({ queryKey: ['fiscalDocs'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('fiscal.cartaCorrecao.error', 'Erro ao enviar carta de correção'));
    } finally {
      setIsCartaCorrecaoSending(false);
    }
  };

  // ── Inutilização ──
  const handleInutilizar = async () => {
    if (!business) return;
    const numInicial = parseInt(inutilizarNumInicial);
    const numFinal = parseInt(inutilizarNumFinal);
    if (!numInicial || !numFinal || numInicial > numFinal) {
      toast.error(t('fiscal.inutilizar.invalidNumbers', 'Números inválidos.'));
      return;
    }
    if (inutilizarJustificativa.trim().length < 15) {
      toast.error(t('fiscal.inutilizar.minCharsError', 'Justificativa deve ter no mínimo 15 caracteres.'));
      return;
    }
    setIsInutilizarSending(true);
    try {
      const res = await fetch('/api/fiscal/inutilizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(firebaseUser ? { Authorization: `Bearer ${await firebaseUser.getIdToken()}` } : {}) },
        body: JSON.stringify({
          businessId: business?.id,
          ano: new Date().getFullYear(),
          serie: inutilizarModelo === '55'
            ? (business.fiscal?.nfeConfig?.series || '1')
            : (business.fiscal?.nfceConfig?.series || '1'),
          numeroInicial: numInicial,
          numeroFinal: numFinal,
          justificativa: inutilizarJustificativa.trim(),
          ufEmitente: business.endereco?.uf || 'SP',
          cnpj: business.cnpj || '',
          modelo: inutilizarModelo,
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        toast.error(result.details?.motivoStatus || result.error || 'Erro na inutilizacao');
        return;
      }
      toast.success(t('fiscal.inutilizar.success', 'Numeração inutilizada com sucesso!'));
      setInutilizarOpen(false);
      setInutilizarNumInicial('');
      setInutilizarNumFinal('');
      setInutilizarJustificativa('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('fiscal.inutilizar.error', 'Erro na inutilização'));
    } finally {
      setIsInutilizarSending(false);
    }
  };

  // ── Export to Accounting ──
  // Busca TODOS os tipos de docs (NFe + NFCe + NFSe) do mês — não só do tipo
  // da aba atual. Antes só enviava o tipo da aba ativa, então o operador
  // tinha que clicar 3x pra mandar tudo.
  // URL/key do notification-server vêm de env vars globais no backend.
  // SMTP per-business é resolvido no backend a partir de business.settings.notificationServer.smtp.
  const handleAccountingSend = async () => {
    if (!business) return;
    const accountingEmail = business.fiscal?.accountingEmail;
    if (!accountingEmail) {
      toast.error(t('fiscal.accounting.noEmail', 'Email do contador não configurado. Acesse Configurações → Fiscal.'));
      return;
    }
    type BusinessExt = NonNullable<typeof business> & {
      settings?: { notificationServer?: { isConfigured?: boolean; smtp?: { host?: string } } };
    };
    const nsCfg = (business as BusinessExt).settings?.notificationServer;
    if (!nsCfg?.isConfigured || !nsCfg?.smtp?.host) {
      toast.error(t('fiscal.accounting.smtpNotConfigured', 'SMTP do business não configurado. Acesse Configurações → Enterprise → SMTP de Email.'));
      return;
    }

    setIsAccountingSending(true);
    try {
      // Carrega TODOS os tipos (não só o tipo da aba). Query separada porque
      // `documents` em estado é filtrado por type (where('type', '==', type)).
      const allTypesQuery = query(
        collection(db, 'fiscalDocuments'),
        where('businessId', '==', business.id),
      );
      const allTypesSnap = await getDocs(allTypesQuery);
      const allDocs: FiscalDocument[] = allTypesSnap.docs.map((d) => ({
        ...d.data(),
        id: d.id,
      })) as FiscalDocument[];

      const monthDocs = allDocs.filter((d) => {
        if (d.status !== 'autorizada') return false;
        const date = new Date(d.issueDate || d.createdAt);
        return date.getMonth() + 1 === accountingMonth && date.getFullYear() === accountingYear;
      });

      if (monthDocs.length === 0) {
        toast.warn(t('fiscal.accounting.noDocsInPeriod', 'Nenhum documento autorizado encontrado no período selecionado.'));
        setIsAccountingSending(false);
        return;
      }

      const res = await fetch('/api/fiscal/accounting/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(firebaseUser ? { Authorization: `Bearer ${await firebaseUser.getIdToken()}` } : {}) },
        body: JSON.stringify({
          businessId: business.id,
          businessName: business.razaoSocial || business.nomeFantasia,
          businessCnpj: business.cnpj,
          month: accountingMonth,
          year: accountingYear,
          accountingEmail,
          documents: monthDocs.map((d) => ({
            type: d.type,
            number: d.number,
            series: d.series,
            accessKey: d.accessKey,
            totalValue: d.totalValue,
            issueDate: d.issueDate,
            clientName: d.clientName,
            xml: d.xml,
          })),
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        toast.error(result.error || 'Erro ao enviar para contabilidade');
        return;
      }
      toast.success(t('fiscal.accounting.success', 'Documentos enviados para {{email}} ({{count}} anexos)', { email: accountingEmail, count: result.attachmentsCount }));
      setAccountingOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('fiscal.accounting.error', 'Erro ao enviar para contabilidade'));
    } finally {
      setIsAccountingSending(false);
    }
  };

  // ── Get Certificate ──
  const getCertificate = async (): Promise<{ pfxBase64: string; password: string }> => {
    const cert = business?.fiscal?.certificate;
    const pwdEncoded = business?.fiscal?.certPasswordEncrypted;
    if (!cert?.storagePath || !pwdEncoded) throw new Error(t('fiscal.cert.selectFile', 'Certificado digital não configurado.'));
    const fileRef = storageRef(storage, cert.storagePath);
    const downloadUrl = await getDownloadURL(fileRef);
    const response = await fetch(downloadUrl);
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    // Tolerate older data with plain-text or invalid base64 password
    let password: string;
    try { password = atob(pwdEncoded); } catch { password = pwdEncoded; }
    return { pfxBase64: btoa(binary), password };
  };

  // Certificate warning
  const hasCertificate = !!business?.fiscal?.certificate?.serialNumber;
  const certExpired = business?.fiscal?.certificate?.expiresAt
    ? new Date(business.fiscal.certificate.expiresAt) < new Date()
    : false;

  return (
    <>
      <div className="space-y-6 max-w-6xl mx-auto">
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
                {certExpired ? t('fiscal.cert.expired', 'Certificado digital expirado') : t('fiscal.cert.notConfigured', 'Certificado digital não configurado')}
              </p>
              <p className={cn('text-xs mt-0.5', certExpired ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400')}>
                {certExpired
                  ? t('fiscal.cert.expiredDesc', 'Renove seu certificado A1 para continuar emitindo documentos fiscais.')
                  : t('fiscal.cert.notConfiguredDesc', 'Configure seu certificado digital A1 em Configurações > Fiscal para emitir notas.')}
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
              {certExpired ? t('fiscal.actions.renovar', 'Renovar') : t('fiscal.actions.configurar', 'Configurar')}
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
                  {t('fiscal.subtitle', 'Gerencie seus documentos fiscais eletrônicos')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <IconButton
                onClick={handleRefresh}
                disabled={isRefreshing}
                size="small"
                title={t('fiscal.actions.atualizar', 'Atualizar lista')}
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
                {t('fiscal.actions.certificado', 'Certificado')}
              </Button>
              <button
                onClick={() => setInutilizarOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                <Hash className="w-3.5 h-3.5" />
                {t('fiscal.actions.inutilizar', 'Inutilizar')}
              </button>
              <button
                onClick={() => setAccountingOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 rounded-xl hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                {t('fiscal.actions.contabilidade', 'Contabilidade')}
              </button>
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
                {t('fiscal.actions.emitirNova', 'Emitir Nova Nota')}
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
            label={t('fiscal.stats.totalEmitidas', 'Total Emitidas')}
            value={stats.total}
            icon={<FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
            iconBg="bg-blue-50 dark:bg-blue-500/10"
          />
          <StatCard
            label={t('fiscal.stats.autorizadas', 'Autorizadas')}
            value={stats.autorizadas}
            icon={<CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
            iconBg="bg-emerald-50 dark:bg-emerald-500/10"
          />
          <StatCard
            label={t('fiscal.stats.pendentes', 'Pendentes')}
            value={stats.pendentes}
            icon={<Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
            iconBg="bg-amber-50 dark:bg-amber-500/10"
          />
          <StatCard
            label={t('fiscal.stats.canceladas', 'Canceladas')}
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
                placeholder={t('fiscal.search.placeholder', 'Buscar por número, cliente ou CPF/CNPJ...')}
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
                      {t('fiscal.table.numero', 'Número')}
                    </th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-3 py-3">
                      {t('fiscal.table.serie', 'Série')}
                    </th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-3 py-3">
                      {t('fiscal.table.dataEmissao', 'Data Emissão')}
                    </th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-3 py-3">
                      {type === 'nfse' ? t('fiscal.table.tomador', 'Tomador') : t('fiscal.table.cliente', 'Cliente')}
                    </th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-3 py-3 hidden md:table-cell">
                      {t('fiscal.table.cpfCnpj', 'CPF/CNPJ')}
                    </th>
                    <th className="text-right text-xs font-medium text-muted-foreground px-3 py-3">
                      {t('fiscal.table.valorTotal', 'Valor Total')}
                    </th>
                    <th className="text-center text-xs font-medium text-muted-foreground px-3 py-3">
                      {t('fiscal.table.status', 'Status')}
                    </th>
                    <th className="text-center text-xs font-medium text-muted-foreground px-4 py-3">
                      {t('fiscal.table.acoes', 'Ações')}
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
                                {t('fiscal.empty.title', 'Nenhum documento encontrado')}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {searchQuery
                                  ? t('fiscal.empty.searchHint', 'Tente ajustar os filtros de busca.')
                                  : t('fiscal.empty.emitFirst', 'Emita sua primeira {{type}}.', { type: type.toUpperCase() })}
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
                                {t('fiscal.actions.emitir', 'Emitir {{type}}', { type: type.toUpperCase() })}
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
                              {fiscalDoc.clientName || t('fiscal.detail.consumidorNaoIdentificado', 'Consumidor não identificado')}
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
                                title={t('fiscal.table.verDetalhes', 'Ver detalhes')}
                              >
                                <Eye size={16} className="text-muted-foreground" />
                              </IconButton>
                              {fiscalDoc.xmlUrl && (
                                <IconButton
                                  size="small"
                                  title={t('fiscal.table.verXml', 'Ver XML')}
                                  onClick={() => window.open(fiscalDoc.xmlUrl!, '_blank')}
                                >
                                  <FileCode size={16} className="text-muted-foreground" />
                                </IconButton>
                              )}
                              {fiscalDoc.pdfUrl && (
                                <IconButton
                                  size="small"
                                  title={t('fiscal.table.downloadPdf', 'Download PDF')}
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
                {t('fiscal.pagination.showing', 'Mostrando {{from}} a {{to}} de {{total}} documentos', {
                  from: (page - 1) * ITEMS_PER_PAGE + 1,
                  to: Math.min(page * ITEMS_PER_PAGE, filteredDocuments.length),
                  total: filteredDocuments.length,
                })}
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
        businessId={business?.id ?? null}
        business={business ? { razaoSocial: business.razaoSocial, cnpj: business.cnpj } : null}
        onPrintDanfe={handlePrintDanfe}
        onCartaCorrecao={(doc) => { setCartaCorrecaoDoc(doc); setCartaCorrecaoOpen(true); }}
      />

      {/* Carta de Correção Dialog */}
      <Dialog open={cartaCorrecaoOpen} onClose={() => setCartaCorrecaoOpen(false)} maxWidth="sm" fullWidth PaperProps={{ className: 'dark:!bg-gray-900', sx: { borderRadius: '16px' } }}>
        <DialogTitle className="dark:!text-gray-100">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-amber-500" />
            {t('fiscal.cartaCorrecao.title', 'Carta de Correção')}
          </div>
        </DialogTitle>
        <DialogContent>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              NF-e: {cartaCorrecaoDoc?.number} | Chave: {cartaCorrecaoDoc?.accessKey?.substring(0, 20)}...
            </p>
            {cartaCorrecaoDoc?.cartaCorrecao?.length ? (
              <div className="bg-amber-50 dark:bg-amber-900/10 p-3 rounded-lg text-xs text-amber-700 dark:text-amber-400">
                {t('fiscal.cartaCorrecao.previousCards', '{{count}} carta(s) anteriores registrada(s). Próxima sequência: {{next}}', { count: cartaCorrecaoDoc.cartaCorrecao.length, next: cartaCorrecaoDoc.cartaCorrecao.length + 1 })}
              </div>
            ) : null}
            <textarea
              value={cartaCorrecaoText}
              onChange={(e) => setCartaCorrecaoText(e.target.value)}
              placeholder={t('fiscal.cartaCorrecao.placeholder', 'Descreva a correção (min. 15 caracteres, max. 1000)...')}
              rows={4}
              maxLength={1000}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500/20 resize-none"
            />
            <p className="text-xs text-gray-400">{t('fiscal.cartaCorrecao.charCount', '{{count}}/1000 caracteres', { count: cartaCorrecaoText.length })}</p>
          </div>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <button onClick={() => setCartaCorrecaoOpen(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">{t('fiscal.actions.cancelar', 'Cancelar')}</button>
          <button
            onClick={handleCartaCorrecao}
            disabled={isCartaCorrecaoSending || cartaCorrecaoText.trim().length < 15}
            className="px-4 py-2 text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-lg disabled:opacity-50 flex items-center gap-2"
          >
            {isCartaCorrecaoSending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {t('fiscal.actions.enviarCarta', 'Enviar Carta')}
          </button>
        </DialogActions>
      </Dialog>

      {/* Inutilização Dialog */}
      <Dialog open={inutilizarOpen} onClose={() => setInutilizarOpen(false)} maxWidth="sm" fullWidth PaperProps={{ className: 'dark:!bg-gray-900', sx: { borderRadius: '16px' } }}>
        <DialogTitle className="dark:!text-gray-100">
          <div className="flex items-center gap-2">
            <Hash className="w-5 h-5 text-gray-500" />
            {t('fiscal.inutilizar.title', 'Inutilizar Numeração')}
          </div>
        </DialogTitle>
        <DialogContent>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('fiscal.inutilizar.desc', 'Declare faixas de numeração que não serão utilizadas.')}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.inutilizar.modelo', 'Modelo')}</label>
                <select
                  value={inutilizarModelo}
                  onChange={(e) => setInutilizarModelo(e.target.value as '55' | '65')}
                  className="w-full h-10 px-3 rounded-xl border text-sm bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100"
                >
                  <option value="55">{t('fiscal.inutilizar.nfeModelo', 'NF-e (mod. 55)')}</option>
                  <option value="65">{t('fiscal.inutilizar.nfceModelo', 'NFC-e (mod. 65)')}</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.inutilizar.numInicial', 'Número Inicial')}</label>
                <input
                  type="number"
                  min={1}
                  value={inutilizarNumInicial}
                  onChange={(e) => setInutilizarNumInicial(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.inutilizar.numFinal', 'Número Final')}</label>
                <input
                  type="number"
                  min={1}
                  value={inutilizarNumFinal}
                  onChange={(e) => setInutilizarNumFinal(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.inutilizar.justificativaLabel', 'Justificativa (min. 15 caracteres)')}</label>
              <textarea
                value={inutilizarJustificativa}
                onChange={(e) => setInutilizarJustificativa(e.target.value)}
                placeholder={t('fiscal.inutilizar.justificativaPlaceholder', 'Justifique a inutilização...')}
                rows={3}
                maxLength={255}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 resize-none"
              />
            </div>
          </div>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <button onClick={() => setInutilizarOpen(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">{t('fiscal.actions.cancelar', 'Cancelar')}</button>
          <button
            onClick={handleInutilizar}
            disabled={isInutilizarSending || inutilizarJustificativa.trim().length < 15}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 flex items-center gap-2"
          >
            {isInutilizarSending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {t('fiscal.actions.inutilizar', 'Inutilizar')}
          </button>
        </DialogActions>
      </Dialog>

      {/* Contabilidade Dialog */}
      <Dialog open={accountingOpen} onClose={() => setAccountingOpen(false)} maxWidth="sm" fullWidth PaperProps={{ className: 'dark:!bg-gray-900', sx: { borderRadius: '16px' } }}>
        <DialogTitle className="dark:!text-gray-100">
          <div className="flex items-center gap-2">
            <Send className="w-5 h-5 text-purple-500" />
            {t('fiscal.accounting.title', 'Enviar para Contabilidade')}
          </div>
        </DialogTitle>
        <DialogContent>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('fiscal.accounting.desc', 'Envie XMLs e SPED do período selecionado para o email do contador.')}
            </p>
            {!business?.fiscal?.accountingEmail && (
              <div className="bg-amber-50 dark:bg-amber-900/10 p-3 rounded-lg text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {t('fiscal.accounting.noEmail', 'Email do contador não configurado. Acesse Configurações > Fiscal.')}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.accounting.mes', 'Mês')}</label>
                <select
                  value={accountingMonth}
                  onChange={(e) => setAccountingMonth(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-xl border text-sm bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100"
                >
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => (
                    <option key={m} value={m}>{t(`fiscal.accounting.months.${m}`, String(m))}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('fiscal.accounting.ano', 'Ano')}</label>
                <select
                  value={accountingYear}
                  onChange={(e) => setAccountingYear(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-xl border text-sm bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100"
                >
                  {[2024, 2025, 2026].map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
            {business?.fiscal?.accountingEmail && (
              <p className="text-xs text-gray-400">
                {t('fiscal.accounting.sendTo', 'Enviar para:')} <span className="font-medium text-gray-600 dark:text-gray-300">{business.fiscal.accountingEmail}</span>
              </p>
            )}
          </div>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <button onClick={() => setAccountingOpen(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">{t('fiscal.actions.cancelar', 'Cancelar')}</button>
          <button
            onClick={handleAccountingSend}
            disabled={isAccountingSending || !business?.fiscal?.accountingEmail}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg disabled:opacity-50 flex items-center gap-2"
          >
            {isAccountingSending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {t('fiscal.actions.enviar', 'Enviar')}
          </button>
        </DialogActions>
      </Dialog>
    </>
  );
}
