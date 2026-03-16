'use client';

import React from 'react';
import {
  Drawer,
  IconButton,
  Chip,
  Button,
} from '@mui/material';
import {
  X,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Edit,
  UserX,
  UserCheck,
  Tag,
  FileText,
  Copy,
  Building2,
  User,
  Trash2,
  DollarSign,
  Eye,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'react-toastify';
import type { Client } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  formatCPFCNPJ,
  formatPhone,
  formatCurrency,
  formatDate,
  getInitials,
} from '@/lib/utils/format';
import { useTheme } from '@/app/components/providers/ThemeProvider';

interface ClientDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  client: Client | null;
  isLoading?: boolean;
  onEdit?: (client: Client) => void;
  onToggleActive?: (client: Client) => void;
  onDelete?: (client: Client) => void;
}

const stagger = {
  animate: {
    transition: { staggerChildren: 0.05 },
  },
};

const fadeInUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

export function ClientDetailDrawer({
  open,
  onClose,
  client,
  isLoading = false,
  onEdit,
  onToggleActive,
  onDelete,
}: ClientDetailDrawerProps) {
  const { isDark } = useTheme();
  if (!client && !isLoading) return null;

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado!`);
  }

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: 400 },
          maxWidth: '100vw',
        },
      }}
    >
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-gray-800">
          <h2 className="text-lg font-display font-bold text-slate-900 dark:text-gray-100">
            Detalhes do Cliente
          </h2>
          <IconButton onClick={onClose} size="small">
            <X size={20} />
          </IconButton>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <DrawerSkeleton />
          ) : client ? (
            <motion.div
              initial="initial"
              animate="animate"
              variants={stagger}
              className="p-5 space-y-5"
            >
              {/* Client Header */}
              <motion.div variants={fadeInUp} className="flex items-center gap-4">
                <div
                  className={cn(
                    'w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold text-white shrink-0',
                    client.isActive
                      ? 'bg-gradient-to-br from-red-500 to-red-700'
                      : 'bg-gradient-to-br from-slate-400 to-slate-600'
                  )}
                >
                  {getInitials(client.nome)}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-display font-bold text-slate-900 dark:text-gray-100 truncate">
                    {client.nome}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-gray-400 bg-slate-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                      {client.tipo === 'pf' ? <User size={10} /> : <Building2 size={10} />}
                      {client.tipo === 'pf' ? 'Pessoa Fisica' : 'Pessoa Juridica'}
                    </span>
                    <Chip
                      label={client.isActive ? 'Ativo' : 'Inativo'}
                      size="small"
                      sx={{
                        height: 22,
                        backgroundColor: client.isActive
                          ? (isDark ? 'rgba(34,197,94,0.1)' : '#DCFCE7')
                          : (isDark ? 'rgba(148,163,184,0.1)' : '#F1F5F9'),
                        color: client.isActive
                          ? (isDark ? '#4ADE80' : '#16A34A')
                          : (isDark ? '#94A3B8' : '#64748B'),
                        fontWeight: 600,
                        fontSize: '0.7rem',
                      }}
                    />
                  </div>
                </div>
              </motion.div>

              {/* Stats */}
              <motion.div variants={fadeInUp} className="grid grid-cols-3 gap-3">
                <div className="text-center p-3 rounded-xl bg-slate-50 dark:bg-gray-800/50">
                  <div className="flex items-center justify-center mb-1">
                    <DollarSign size={14} className="text-red-500" />
                  </div>
                  <p className="text-sm font-bold text-slate-800 dark:text-gray-200">
                    {formatCurrency(client.totalSpent)}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-0.5">Total gasto</p>
                </div>
                <div className="text-center p-3 rounded-xl bg-slate-50 dark:bg-gray-800/50">
                  <div className="flex items-center justify-center mb-1">
                    <Eye size={14} className="text-red-500" />
                  </div>
                  <p className="text-sm font-bold text-slate-800 dark:text-gray-200">
                    {client.visitCount}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-0.5">Visitas</p>
                </div>
                <div className="text-center p-3 rounded-xl bg-slate-50 dark:bg-gray-800/50">
                  <div className="flex items-center justify-center mb-1">
                    <Calendar size={14} className="text-red-500" />
                  </div>
                  <p className="text-sm font-bold text-slate-800 dark:text-gray-200">
                    {client.lastVisit ? formatDate(client.lastVisit) : '-'}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-0.5">Ultima visita</p>
                </div>
              </motion.div>

              {/* CPF/CNPJ */}
              <motion.div variants={fadeInUp}>
                <InfoRow
                  label={client.tipo === 'pf' ? 'CPF' : 'CNPJ'}
                  value={formatCPFCNPJ(client.cpfCnpj)}
                  mono
                  onCopy={() => copyToClipboard(client.cpfCnpj, client.tipo === 'pf' ? 'CPF' : 'CNPJ')}
                />
              </motion.div>

              {/* IE info for PJ */}
              {client.tipo === 'pj' && client.inscricaoEstadual && (
                <motion.div variants={fadeInUp}>
                  <InfoRow
                    label="Inscricao Estadual"
                    value={client.inscricaoEstadual}
                    mono
                  />
                </motion.div>
              )}

              {/* Contact Info */}
              <motion.div variants={fadeInUp} className="space-y-1">
                <h4 className="text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                  Contato
                </h4>
                <ContactRow
                  icon={<Phone size={15} />}
                  value={formatPhone(client.phone)}
                  onCopy={() => copyToClipboard(client.phone, 'Telefone')}
                />
                {client.phone2 && (
                  <ContactRow
                    icon={<Phone size={15} />}
                    value={formatPhone(client.phone2)}
                    onCopy={() => copyToClipboard(client.phone2!, 'Telefone 2')}
                  />
                )}
                {client.email && (
                  <ContactRow
                    icon={<Mail size={15} />}
                    value={client.email}
                    onCopy={() => copyToClipboard(client.email!, 'E-mail')}
                  />
                )}
                {client.birthDate && (
                  <ContactRow
                    icon={<Calendar size={15} />}
                    value={formatDate(client.birthDate)}
                  />
                )}
              </motion.div>

              {/* Address */}
              {client.endereco && client.endereco.logradouro && (
                <motion.div variants={fadeInUp}>
                  <h4 className="text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                    Endereco
                  </h4>
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-gray-800/50">
                    <MapPin size={15} className="text-slate-400 dark:text-gray-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-slate-700 dark:text-gray-300 leading-relaxed">
                      {client.endereco.logradouro}, {client.endereco.numero}
                      {client.endereco.complemento && ` - ${client.endereco.complemento}`}
                      <br />
                      {client.endereco.bairro}, {client.endereco.municipio}/{client.endereco.uf}
                      {client.endereco.cep && (
                        <span className="text-slate-400 dark:text-gray-500"> - CEP {client.endereco.cep}</span>
                      )}
                    </p>
                  </div>
                </motion.div>
              )}

              {/* Tags */}
              {client.tags && client.tags.length > 0 && (
                <motion.div variants={fadeInUp}>
                  <h4 className="text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Tag size={11} />
                    Tags
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {client.tags.map((tag) => (
                      <Chip
                        key={tag}
                        label={tag}
                        size="small"
                        sx={{
                          backgroundColor: isDark ? 'rgba(220,38,38,0.1)' : '#FEF2F2',
                          color: isDark ? '#F87171' : '#DC2626',
                          fontSize: '0.75rem',
                          fontWeight: 500,
                        }}
                      />
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Notes */}
              {client.notes && (
                <motion.div variants={fadeInUp}>
                  <h4 className="text-[11px] font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <FileText size={11} />
                    Observacoes
                  </h4>
                  <p className="text-sm text-slate-600 dark:text-gray-400 bg-slate-50 dark:bg-gray-800/50 rounded-xl p-3 whitespace-pre-wrap leading-relaxed">
                    {client.notes}
                  </p>
                </motion.div>
              )}

              {/* Metadata */}
              <motion.div variants={fadeInUp}>
                <div className="text-[11px] text-slate-400 dark:text-gray-500 space-y-0.5 pt-2 border-t border-slate-100 dark:border-gray-800">
                  <p>Cadastrado em {formatDate(client.createdAt)}</p>
                  <p>Atualizado em {formatDate(client.updatedAt)}</p>
                </div>
              </motion.div>
            </motion.div>
          ) : null}
        </div>

        {/* Action Buttons */}
        {client && !isLoading && (
          <div className="border-t border-slate-100 dark:border-gray-800 p-4 space-y-2">
            <div className="flex gap-2">
              <Button
                variant="outlined"
                size="small"
                fullWidth
                startIcon={<Edit size={16} />}
                onClick={() => onEdit?.(client)}
                sx={{
                  borderColor: isDark ? 'rgba(55,65,81,1)' : '#E2E8F0',
                  color: isDark ? '#D1D5DB' : '#475569',
                  borderRadius: '12px',
                  textTransform: 'none',
                  fontWeight: 600,
                  '&:hover': {
                    borderColor: isDark ? 'rgba(75,85,99,1)' : '#CBD5E1',
                    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                  },
                }}
              >
                Editar
              </Button>
              <Button
                variant="outlined"
                size="small"
                fullWidth
                startIcon={client.isActive ? <UserX size={16} /> : <UserCheck size={16} />}
                onClick={() => onToggleActive?.(client)}
                sx={{
                  borderColor: client.isActive
                    ? (isDark ? 'rgba(220,38,38,0.2)' : '#FEE2E2')
                    : (isDark ? 'rgba(34,197,94,0.2)' : '#DCFCE7'),
                  color: client.isActive
                    ? (isDark ? '#F87171' : '#DC2626')
                    : (isDark ? '#4ADE80' : '#16A34A'),
                  borderRadius: '12px',
                  textTransform: 'none',
                  fontWeight: 600,
                  '&:hover': {
                    borderColor: client.isActive
                      ? (isDark ? 'rgba(220,38,38,0.3)' : '#FECACA')
                      : (isDark ? 'rgba(34,197,94,0.3)' : '#BBF7D0'),
                    backgroundColor: client.isActive
                      ? (isDark ? 'rgba(220,38,38,0.1)' : '#FEF2F2')
                      : (isDark ? 'rgba(34,197,94,0.1)' : '#F0FDF4'),
                  },
                }}
              >
                {client.isActive ? 'Desativar' : 'Ativar'}
              </Button>
            </div>
            <Button
              variant="outlined"
              size="small"
              fullWidth
              startIcon={<Trash2 size={16} />}
              onClick={() => onDelete?.(client)}
              sx={{
                borderColor: isDark ? 'rgba(220,38,38,0.2)' : '#FEE2E2',
                color: isDark ? '#F87171' : '#DC2626',
                borderRadius: '12px',
                textTransform: 'none',
                fontWeight: 600,
                '&:hover': {
                  borderColor: isDark ? 'rgba(220,38,38,0.3)' : '#FECACA',
                  backgroundColor: isDark ? 'rgba(220,38,38,0.1)' : '#FEF2F2',
                },
              }}
            >
              Excluir Cliente
            </Button>
          </div>
        )}
      </div>
    </Drawer>
  );
}

/* ---- Sub-components ---- */

function InfoRow({
  label,
  value,
  mono = false,
  onCopy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onCopy?: () => void;
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-gray-800/50">
      <div>
        <p className="text-[11px] text-slate-400 dark:text-gray-500 font-medium">{label}</p>
        <p className={cn('text-sm text-slate-800 dark:text-gray-200', mono && 'font-mono')}>{value}</p>
      </div>
      {onCopy && (
        <IconButton size="small" onClick={onCopy} sx={{ color: '#94A3B8' }}>
          <Copy size={14} />
        </IconButton>
      )}
    </div>
  );
}

function ContactRow({
  icon,
  value,
  onCopy,
}: {
  icon: React.ReactNode;
  value: string;
  onCopy?: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors group">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-slate-400 dark:text-gray-500">{icon}</span>
        <p className="text-sm text-slate-700 dark:text-gray-300 truncate">{value}</p>
      </div>
      {onCopy && (
        <IconButton
          size="small"
          onClick={onCopy}
          sx={{ color: '#94A3B8', opacity: 0, '.group:hover &': { opacity: 1 } }}
        >
          <Copy size={13} />
        </IconButton>
      )}
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="p-5 space-y-5">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl shimmer shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-6 w-[60%] rounded-md shimmer" />
          <div className="h-4 w-[40%] rounded-md shimmer" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-[72px] rounded-xl shimmer" />
        ))}
      </div>
      <div className="h-14 rounded-xl shimmer" />
      {[...Array(3)].map((_, i) => (
        <div key={i} className="h-10 rounded-lg shimmer" />
      ))}
    </div>
  );
}
