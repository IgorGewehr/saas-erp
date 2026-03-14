'use client';

import { useState, useRef } from 'react';
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
import type { CertificateInfo } from '@/lib/types';
import { cn } from '@/lib/utils';

// ==============================================
// MOCK DATA
// ==============================================

const mockCertificate: CertificateInfo = {
  id: 'cert-001',
  businessId: 'biz-001',
  filename: 'certificado_empresa.pfx',
  subject: 'EMPRESA SERVICOS LTDA:12345678000190',
  serialNumber: '2A3B4C5D6E7F8A9B',
  validFrom: '2025-06-15',
  validUntil: '2026-06-15',
  isValid: true,
  daysUntilExpiry: 94,
};

// ==============================================
// TYPES
// ==============================================

interface CertificateManagerProps {
  open: boolean;
  onClose: () => void;
}

type CertStatus = 'valid' | 'expiring' | 'expired' | 'none';

// ==============================================
// HELPERS
// ==============================================

function getCertStatus(cert: CertificateInfo | null): CertStatus {
  if (!cert) return 'none';
  if (!cert.isValid || cert.daysUntilExpiry <= 0) return 'expired';
  if (cert.daysUntilExpiry <= 30) return 'expiring';
  return 'valid';
}

function getStatusConfig(status: CertStatus) {
  const configs = {
    valid: {
      label: 'Valido',
      color: '#10B981',
      bgColor: 'bg-emerald-50',
      textColor: 'text-emerald-700',
      borderColor: 'border-emerald-200',
      icon: <CheckCircle className="w-5 h-5 text-emerald-500" />,
    },
    expiring: {
      label: 'Expirando',
      color: '#F59E0B',
      bgColor: 'bg-amber-50',
      textColor: 'text-amber-700',
      borderColor: 'border-amber-200',
      icon: <AlertTriangle className="w-5 h-5 text-amber-500" />,
    },
    expired: {
      label: 'Expirado',
      color: '#EF4444',
      bgColor: 'bg-red-50',
      textColor: 'text-red-700',
      borderColor: 'border-red-200',
      icon: <XCircle className="w-5 h-5 text-red-500" />,
    },
    none: {
      label: 'Nenhum',
      color: '#6B7280',
      bgColor: 'bg-gray-50',
      textColor: 'text-gray-700',
      borderColor: 'border-gray-200',
      icon: <Shield className="w-5 h-5 text-gray-400" />,
    },
  };
  return configs[status];
}

function formatCertDate(dateStr: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(dateStr + 'T00:00:00'));
}

// ==============================================
// MAIN COMPONENT
// ==============================================

export default function CertificateManager({ open, onClose }: CertificateManagerProps) {
  const [certificate, setCertificate] = useState<CertificateInfo | null>(mockCertificate);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const certStatus = getCertStatus(certificate);
  const statusConfig = getStatusConfig(certStatus);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.pfx') && !file.name.toLowerCase().endsWith('.p12')) {
        toast.error('Selecione um arquivo .pfx ou .p12 valido.');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error('O arquivo deve ter no maximo 10MB.');
        return;
      }
      setSelectedFile(file);
    }
  }

  async function handleUpload() {
    if (!selectedFile) {
      toast.error('Selecione um arquivo de certificado.');
      return;
    }
    if (!password.trim()) {
      toast.error('Informe a senha do certificado.');
      return;
    }

    setIsUploading(true);

    try {
      // Simulate upload and validation
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const newCert: CertificateInfo = {
        id: 'cert-' + Date.now(),
        businessId: 'biz-001',
        filename: selectedFile.name,
        subject: 'EMPRESA SERVICOS LTDA:12345678000190',
        serialNumber: Math.random().toString(16).substring(2, 18).toUpperCase(),
        validFrom: '2026-01-15',
        validUntil: '2027-01-15',
        isValid: true,
        daysUntilExpiry: 365,
      };

      setCertificate(newCert);
      setSelectedFile(null);
      setPassword('');
      setShowUploadForm(false);
      toast.success('Certificado digital enviado e validado com sucesso!');
    } catch {
      toast.error('Erro ao processar o certificado. Verifique o arquivo e a senha.');
    } finally {
      setIsUploading(false);
    }
  }

  function handleRemove() {
    setCertificate(null);
    setSelectedFile(null);
    setPassword('');
    setShowUploadForm(true);
  }

  return (
    <Dialog
      open={open}
      onClose={isUploading ? undefined : onClose}
      maxWidth="sm"
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
          <Shield className="w-5 h-5 text-primary-600" />
          <span>Certificado Digital</span>
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
                  statusConfig.bgColor,
                  statusConfig.borderColor,
                )}
              >
                {statusConfig.icon}
                <div className="flex-1">
                  <p className={cn('text-sm font-semibold', statusConfig.textColor)}>
                    Certificado {statusConfig.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {certStatus === 'expired'
                      ? 'Seu certificado esta expirado. Substitua-o para continuar emitindo documentos.'
                      : certStatus === 'expiring'
                        ? `Seu certificado expira em ${certificate.daysUntilExpiry} dias. Considere renova-lo.`
                        : `Valido por mais ${certificate.daysUntilExpiry} dias.`}
                  </p>
                </div>
              </div>

              {/* Certificate Details */}
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                  <FileText className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Arquivo</p>
                    <p className="text-sm font-medium text-foreground">{certificate.filename}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                  <Lock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Titular (Subject)</p>
                    <p className="text-sm font-medium text-foreground break-all">
                      {certificate.subject}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                  <Shield className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Numero de Serie</p>
                    <p className="text-sm font-mono font-medium text-foreground">
                      {certificate.serialNumber}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                    <Calendar className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Valido Desde</p>
                      <p className="text-sm font-medium text-foreground">
                        {formatCertDate(certificate.validFrom)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                    <Calendar className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Valido Ate</p>
                      <p className={cn('text-sm font-medium', statusConfig.textColor)}>
                        {formatCertDate(certificate.validUntil)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Expiry Progress */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-muted-foreground">Dias restantes</span>
                  <span className={cn('text-xs font-semibold', statusConfig.textColor)}>
                    {certificate.daysUntilExpiry} dias
                  </span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: statusConfig.color }}
                    initial={{ width: 0 }}
                    animate={{
                      width: `${Math.min(100, (certificate.daysUntilExpiry / 365) * 100)}%`,
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
                    backgroundColor: '#FEF2F2',
                  },
                }}
              >
                Substituir Certificado
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
                    ? 'border-primary-300 bg-primary-50/30'
                    : 'border-gray-300 hover:border-primary-400 hover:bg-primary-50/20',
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
                        {(selectedFile.size / 1024).toFixed(1)} KB - Clique para alterar
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
                        Clique para selecionar o certificado
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Formatos aceitos: .pfx, .p12 (max. 10MB)
                      </p>
                    </div>
                  </>
                )}
              </div>

              {/* Password */}
              <TextField
                label="Senha do Certificado"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                fullWidth
                size="small"
                placeholder="Digite a senha do certificado PFX"
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
                    Voltar
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
                  }}
                >
                  {isUploading ? (
                    <CircularProgress size={20} sx={{ color: 'white' }} />
                  ) : (
                    'Enviar e Validar'
                  )}
                </Button>
              </div>

              {/* Info Note */}
              <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-100">
                <Shield className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-700">
                  O certificado digital A1 (e-CNPJ) e necessario para emissao de documentos
                  fiscais eletronicos. O arquivo e a senha sao transmitidos de forma segura e
                  criptografada.
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
            Remover Certificado
          </Button>
        )}
        <Button onClick={onClose} disabled={isUploading} sx={{ color: '#64748B' }}>
          Fechar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
