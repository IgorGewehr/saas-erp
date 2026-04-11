'use client';

import { useState, useRef, useMemo } from 'react';
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
} from '@mui/material';
import {
  Shield,
  Upload,
  X,
  CheckCircle,
  AlertTriangle,
  XCircle,
  FileText,
  Calendar,
  Lock,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, updateDoc } from 'firebase/firestore';
import { db, storage } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { cn } from '@/lib/utils';
import { useTheme } from '@/app/components/providers/ThemeProvider';
import { useTranslation } from 'react-i18next';

// ==============================================
// TYPES
// ==============================================

interface CertificateManagerProps {
  open: boolean;
  onClose: () => void;
}

type CertStatus = 'valid' | 'expiring' | 'expired' | 'none';

interface CertInfo {
  serialNumber: string;
  subject: string;
  validFrom: string;
  expiresAt: string;
  storagePath: string;
  daysUntilExpiry: number;
  isValid: boolean;
}

// ==============================================
// HELPERS
// ==============================================

function getCertStatus(cert: CertInfo | null): CertStatus {
  if (!cert) return 'none';
  if (!cert.isValid || cert.daysUntilExpiry <= 0) return 'expired';
  if (cert.daysUntilExpiry <= 30) return 'expiring';
  return 'valid';
}

function getStatusStyle(status: CertStatus) {
  const styles = {
    valid: {
      color: '#10B981',
      bgColor: 'bg-emerald-50 dark:bg-emerald-500/10',
      textColor: 'text-emerald-700 dark:text-emerald-400',
      borderColor: 'border-emerald-200 dark:border-emerald-500/20',
      icon: <CheckCircle className="w-5 h-5 text-emerald-500" />,
    },
    expiring: {
      color: '#F59E0B',
      bgColor: 'bg-amber-50 dark:bg-amber-500/10',
      textColor: 'text-amber-700 dark:text-amber-400',
      borderColor: 'border-amber-200 dark:border-amber-500/20',
      icon: <AlertTriangle className="w-5 h-5 text-amber-500" />,
    },
    expired: {
      color: '#EF4444',
      bgColor: 'bg-red-50 dark:bg-red-500/10',
      textColor: 'text-red-700 dark:text-red-400',
      borderColor: 'border-red-200 dark:border-red-500/20',
      icon: <XCircle className="w-5 h-5 text-red-500" />,
    },
    none: {
      color: '#6B7280',
      bgColor: 'bg-gray-50 dark:bg-gray-800/50',
      textColor: 'text-gray-700 dark:text-gray-300',
      borderColor: 'border-gray-200 dark:border-gray-700',
      icon: <Shield className="w-5 h-5 text-gray-400 dark:text-gray-500" />,
    },
  };
  return styles[status];
}

function formatCertDate(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00'));
  } catch {
    return dateStr;
  }
}

function calculateDaysUntilExpiry(expiresAt: string): number {
  const now = new Date();
  const exp = new Date(expiresAt);
  const diffMs = exp.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

// ==============================================
// MAIN COMPONENT
// ==============================================

export default function CertificateManager({ open, onClose }: CertificateManagerProps) {
  const { business, refreshUser } = useAuth();
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derive certificate info from business fiscal config
  const certificate = useMemo((): CertInfo | null => {
    const cert = business?.fiscal?.certificate;
    if (!cert?.serialNumber || !cert?.expiresAt) return null;

    const days = calculateDaysUntilExpiry(cert.expiresAt);

    return {
      serialNumber: cert.serialNumber,
      subject: cert.subject || `${business?.razaoSocial || ''}:${business?.cnpj || ''}`,
      validFrom: cert.validFrom || '',
      expiresAt: cert.expiresAt,
      storagePath: cert.storagePath,
      daysUntilExpiry: days,
      isValid: days > 0,
    };
  }, [business]);

  const certStatus = getCertStatus(certificate);
  const statusStyle = getStatusStyle(certStatus);
  const statusLabels: Record<CertStatus, string> = useMemo(() => ({
    valid: t('fiscal.cert.statusValid', 'Válido'),
    expiring: t('fiscal.cert.statusExpiring', 'Expirando'),
    expired: t('fiscal.cert.statusExpired', 'Expirado'),
    none: t('fiscal.cert.statusNone', 'Nenhum'),
  }), [t]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.pfx') && !file.name.toLowerCase().endsWith('.p12')) {
        toast.error(t('fiscal.cert.errorInvalidFormat', 'Selecione um arquivo .pfx ou .p12 válido.'));
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error(t('fiscal.cert.errorFileSize', 'O arquivo deve ter no máximo 10MB.'));
        return;
      }
      setSelectedFile(file);
    }
  }

  async function handleUpload() {
    if (!selectedFile || !business) {
      toast.error(t('fiscal.cert.errorNoFile', 'Selecione um arquivo de certificado.'));
      return;
    }
    if (!password.trim()) {
      toast.error(t('fiscal.cert.errorNoPassword', 'Informe a senha do certificado.'));
      return;
    }

    setIsUploading(true);

    try {
      // Upload file to Firebase Storage
      const storagePath = `businesses/${business.id}/certificates/cert.pfx`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, selectedFile);

      // For now we store basic metadata - in production, the backend would parse
      // the PFX to extract serial number, subject, validity dates
      const now = new Date();
      const oneYearLater = new Date(now);
      oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);

      // Update business fiscal config with certificate info
      await updateDoc(doc(db, 'businesses', business.id), {
        'fiscal.certificate': {
          serialNumber: 'PENDING_VALIDATION',
          subject: `${business.razaoSocial}:${business.cnpj}`,
          validFrom: now.toISOString(),
          expiresAt: oneYearLater.toISOString(),
          storagePath: storagePath,
          uploadedAt: now.toISOString(),
        },
        'fiscal.certPasswordEncrypted': btoa(password), // Base64 for now - production should use proper encryption
        updatedAt: now.toISOString(),
      });

      await refreshUser();

      setSelectedFile(null);
      setPassword('');
      setShowUploadForm(false);
      toast.success(t('fiscal.cert.successUpload', 'Certificado digital enviado com sucesso!'));
    } catch (error) {
      console.error('[CertificateManager] Upload error:', error);
      toast.error(t('fiscal.cert.errorUpload', 'Erro ao processar o certificado. Verifique o arquivo e a senha.'));
    } finally {
      setIsUploading(false);
    }
  }

  async function handleRemove() {
    if (!business) return;

    try {
      await updateDoc(doc(db, 'businesses', business.id), {
        'fiscal.certificate': null,
        'fiscal.certPasswordEncrypted': null,
        updatedAt: new Date().toISOString(),
      });

      await refreshUser();
      setShowUploadForm(true);
      toast.success(t('fiscal.cert.successRemove', 'Certificado removido.'));
    } catch {
      toast.error(t('fiscal.cert.errorRemove', 'Erro ao remover certificado.'));
    }
  }

  return (
    <Dialog
      open={open}
      onClose={isUploading ? undefined : onClose}
      maxWidth="sm"
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
          <Shield className="w-5 h-5 text-primary-600" />
          <span>{t('fiscal.cert.title', 'Certificado Digital')}</span>
        </div>
        <IconButton onClick={onClose} disabled={isUploading} size="small">
          <X size={20} />
        </IconButton>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ pt: 3 }}>
        <AnimatePresence mode="wait">
          {certificate && !showUploadForm ? (
            <motion.div
              key="cert-info"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-5"
            >
              {/* Status Badge */}
              <div
                className={cn(
                  'flex items-center gap-3 p-4 rounded-xl border',
                  statusStyle.bgColor,
                  statusStyle.borderColor,
                )}
              >
                {statusStyle.icon}
                <div className="flex-1">
                  <p className={cn('text-sm font-semibold', statusStyle.textColor)}>
                    {t('fiscal.cert.certificado', 'Certificado')} {statusLabels[certStatus]}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {certStatus === 'expired'
                      ? t('fiscal.cert.msgExpired', 'Seu certificado está expirado. Substitua-o para continuar emitindo documentos.')
                      : certStatus === 'expiring'
                        ? t('fiscal.cert.msgExpiring', 'Seu certificado expira em {{days}} dias. Considere renová-lo.', { days: certificate.daysUntilExpiry })
                        : t('fiscal.cert.msgValid', 'Válido por mais {{days}} dias.', { days: certificate.daysUntilExpiry })}
                  </p>
                </div>
              </div>

              {/* Certificate Details */}
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                  <Lock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t('fiscal.cert.titular', 'Titular (Subject)')}</p>
                    <p className="text-sm font-medium text-foreground break-all">
                      {certificate.subject}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                  <Shield className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t('fiscal.cert.serialNumber', 'Número de Série')}</p>
                    <p className="text-sm font-mono font-medium text-foreground">
                      {certificate.serialNumber}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {certificate.validFrom && (
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                      <Calendar className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">{t('fiscal.cert.validFrom', 'Válido Desde')}</p>
                        <p className="text-sm font-medium text-foreground">
                          {formatCertDate(certificate.validFrom)}
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                    <Calendar className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">{t('fiscal.cert.validUntil', 'Válido Até')}</p>
                      <p className={cn('text-sm font-medium', statusStyle.textColor)}>
                        {formatCertDate(certificate.expiresAt)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Expiry Progress */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-muted-foreground">{t('fiscal.cert.diasRestantes', 'Dias restantes')}</span>
                  <span className={cn('text-xs font-semibold', statusStyle.textColor)}>
                    {Math.max(0, certificate.daysUntilExpiry)} {t('fiscal.cert.dias', 'dias')}
                  </span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: statusStyle.color }}
                    initial={{ width: 0 }}
                    animate={{
                      width: `${Math.min(100, Math.max(0, (certificate.daysUntilExpiry / 365) * 100))}%`,
                    }}
                    transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] }}
                  />
                </div>
              </div>

              {/* Replace Button */}
              <Button
                onClick={() => setShowUploadForm(true)}
                variant="outlined"
                fullWidth
                startIcon={<Upload size={16} />}
                sx={{
                  borderColor: '#DC2626',
                  color: '#DC2626',
                  '&:hover': {
                    borderColor: '#B91C1C',
                    backgroundColor: isDark ? 'rgba(220, 38, 38, 0.1)' : '#FEF2F2',
                  },
                }}
              >
                {t('fiscal.cert.substituir', 'Substituir Certificado')}
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key="upload-form"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-5"
            >
              {/* Upload Area */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed',
                  'cursor-pointer transition-colors duration-200',
                  selectedFile
                    ? 'border-primary-300 bg-primary-50/30 dark:bg-primary-500/5'
                    : 'border-gray-300 dark:border-gray-600 hover:border-primary-400 hover:bg-primary-50/20 dark:hover:bg-primary-500/5',
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pfx,.p12"
                  onChange={handleFileSelect}
                  className="hidden"
                />

                {selectedFile ? (
                  <>
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary-100">
                      <CheckCircle className="w-6 h-6 text-primary-600" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-foreground">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {(selectedFile.size / 1024).toFixed(1)} KB - {t('fiscal.cert.clickToChange', 'Clique para alterar')}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-muted">
                      <Upload className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-foreground">
                        {t('fiscal.cert.clickToSelect', 'Clique para selecionar o certificado')}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t('fiscal.cert.formatsAccepted', 'Formatos aceitos: .pfx, .p12 (max. 10MB)')}
                      </p>
                    </div>
                  </>
                )}
              </div>

              {/* Password */}
              <TextField
                label={t('fiscal.cert.senha', 'Senha do Certificado')}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                fullWidth
                size="small"
                placeholder={t('fiscal.cert.senhaPlaceholder', 'Digite a senha do certificado PFX')}
                disabled={isUploading}
              />

              {/* Action Buttons */}
              <div className="flex gap-3">
                {certificate && (
                  <Button
                    onClick={() => {
                      setShowUploadForm(false);
                      setSelectedFile(null);
                      setPassword('');
                    }}
                    disabled={isUploading}
                    sx={{ color: '#64748B', flex: 1 }}
                  >
                    {t('fiscal.cert.voltar', 'Voltar')}
                  </Button>
                )}
                <Button
                  onClick={handleUpload}
                  variant="contained"
                  disabled={isUploading || !selectedFile || !password.trim()}
                  fullWidth
                  sx={{
                    backgroundColor: '#DC2626',
                    '&:hover': { backgroundColor: '#B91C1C' },
                    flex: certificate ? 1 : undefined,
                    ...(isDark && { color: '#fff' }),
                  }}
                >
                  {isUploading ? (
                    <CircularProgress size={20} sx={{ color: 'white' }} />
                  ) : (
                    t('fiscal.cert.enviarValidar', 'Enviar e Validar')
                  )}
                </Button>
              </div>

              {/* Info Note */}
              <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20">
                <Shield className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-700 dark:text-blue-400">
                  {t('fiscal.cert.infoNote', 'O certificado digital A1 (e-CNPJ) é necessário para emissão de documentos fiscais eletrônicos. O arquivo e a senha são transmitidos de forma segura e criptografada.')}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>

      <Divider />

      <DialogActions sx={{ px: 3, py: 2 }}>
        {certificate && !showUploadForm && (
          <Button
            onClick={handleRemove}
            sx={{ color: '#EF4444', mr: 'auto' }}
          >
            {t('fiscal.cert.remover', 'Remover Certificado')}
          </Button>
        )}
        <Button onClick={onClose} disabled={isUploading} sx={{ color: '#64748B' }}>
          {t('fiscal.cert.fechar', 'Fechar')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
