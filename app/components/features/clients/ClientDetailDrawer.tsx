'use client';

import React from 'react';
import {
  Drawer,
  IconButton,
  Chip,
  Button,
  Divider,
  Skeleton,
} from '@mui/material';
import {
  X,
  Phone,
  Mail,
  MapPin,
  Calendar,
  DollarSign,
  TrendingUp,
  Clock,
  Edit,
  CalendarPlus,
  ShoppingCart,
  UserX,
  UserCheck,
  Tag,
  FileText,
} from 'lucide-react';
import { motion } from 'framer-motion';
import type { Client, Appointment, Transaction } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  formatCPFCNPJ,
  formatPhone,
  formatCurrency,
  formatDate,
  formatDateTime,
  getInitials,
  getStatusColor,
  getStatusLabel,
} from '@/lib/utils/format';

interface ClientDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  client: Client | null;
  recentAppointments?: Appointment[];
  recentTransactions?: Transaction[];
  isLoading?: boolean;
  onEdit?: (client: Client) => void;
  onSchedule?: (client: Client) => void;
  onNewSale?: (client: Client) => void;
  onToggleActive?: (client: Client) => void;
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
  recentAppointments = [],
  recentTransactions = [],
  isLoading = false,
  onEdit,
  onSchedule,
  onNewSale,
  onToggleActive,
}: ClientDetailDrawerProps) {
  if (!client && !isLoading) return null;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: 420 },
          maxWidth: '100vw',
        },
      }}
    >
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <h2 className="text-lg font-display font-bold text-slate-900">
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
              className="p-4 space-y-6"
            >
              {/* Client Header */}
              <motion.div variants={fadeInUp} className="flex items-center gap-4">
                <div
                  className={cn(
                    'w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold text-white shrink-0',
                    client.isActive
                      ? 'bg-gradient-to-br from-red-500 to-red-700'
                      : 'bg-gradient-to-br from-slate-400 to-slate-600'
                  )}
                >
                  {getInitials(client.nome)}
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-display font-bold text-slate-900 truncate">
                    {client.nome}
                  </h3>
                  <p className="text-sm text-slate-500">
                    {client.tipo === 'pf' ? 'Pessoa Fisica' : 'Pessoa Juridica'} &middot;{' '}
                    {formatCPFCNPJ(client.cpfCnpj)}
                  </p>
                  <Chip
                    label={client.isActive ? 'Ativo' : 'Inativo'}
                    size="small"
                    sx={{
                      mt: 0.5,
                      backgroundColor: client.isActive ? '#DCFCE7' : '#F1F5F9',
                      color: client.isActive ? '#16A34A' : '#64748B',
                      fontWeight: 600,
                      fontSize: '0.75rem',
                    }}
                  />
                </div>
              </motion.div>

              {/* Contact Info */}
              <motion.div variants={fadeInUp} className="space-y-3">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Contato
                </h4>
                <div className="space-y-2">
                  <ContactRow icon={<Phone size={16} />} label="Telefone" value={formatPhone(client.phone)} />
                  {client.phone2 && (
                    <ContactRow icon={<Phone size={16} />} label="Telefone 2" value={formatPhone(client.phone2)} />
                  )}
                  {client.email && (
                    <ContactRow icon={<Mail size={16} />} label="E-mail" value={client.email} />
                  )}
                  {client.endereco && client.endereco.logradouro && (
                    <ContactRow
                      icon={<MapPin size={16} />}
                      label="Endereco"
                      value={`${client.endereco.logradouro}, ${client.endereco.numero}${client.endereco.complemento ? ` - ${client.endereco.complemento}` : ''}, ${client.endereco.bairro}, ${client.endereco.municipio}/${client.endereco.uf}`}
                    />
                  )}
                  {client.birthDate && (
                    <ContactRow icon={<Calendar size={16} />} label="Nascimento" value={formatDate(client.birthDate)} />
                  )}
                </div>
              </motion.div>

              <Divider />

              {/* Stats */}
              <motion.div variants={fadeInUp}>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Resumo
                </h4>
                <div className="grid grid-cols-3 gap-3">
                  <StatCard
                    icon={<DollarSign size={18} />}
                    label="Total Gasto"
                    value={formatCurrency(client.totalSpent)}
                    color="#DC2626"
                  />
                  <StatCard
                    icon={<TrendingUp size={18} />}
                    label="Visitas"
                    value={String(client.visitCount)}
                    color="#3B82F6"
                  />
                  <StatCard
                    icon={<Clock size={18} />}
                    label="Ultima Visita"
                    value={client.lastVisit ? formatDate(client.lastVisit) : '-'}
                    color="#10B981"
                  />
                </div>
              </motion.div>

              <Divider />

              {/* Recent Appointments */}
              <motion.div variants={fadeInUp}>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Agendamentos Recentes
                </h4>
                {recentAppointments.length > 0 ? (
                  <div className="space-y-2">
                    {recentAppointments.slice(0, 5).map((apt) => (
                      <div
                        key={apt.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">
                            {apt.serviceName}
                          </p>
                          <p className="text-xs text-slate-500">
                            {formatDate(apt.date)} as {apt.startTime}
                          </p>
                        </div>
                        <Chip
                          label={getStatusLabel(apt.status)}
                          size="small"
                          sx={{
                            backgroundColor: `${getStatusColor(apt.status)}15`,
                            color: getStatusColor(apt.status),
                            fontWeight: 600,
                            fontSize: '0.7rem',
                          }}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptySection text="Nenhum agendamento recente" />
                )}
              </motion.div>

              <Divider />

              {/* Recent Transactions */}
              <motion.div variants={fadeInUp}>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Transacoes Recentes
                </h4>
                {recentTransactions.length > 0 ? (
                  <div className="space-y-2">
                    {recentTransactions.slice(0, 5).map((tx) => (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">
                            {tx.description}
                          </p>
                          <p className="text-xs text-slate-500">
                            {formatDate(tx.dueDate)}
                          </p>
                        </div>
                        <span
                          className={cn(
                            'text-sm font-semibold',
                            tx.type === 'receita' ? 'text-emerald-600' : 'text-red-600'
                          )}
                        >
                          {tx.type === 'receita' ? '+' : '-'}
                          {formatCurrency(tx.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptySection text="Nenhuma transacao recente" />
                )}
              </motion.div>

              {/* Tags & Notes */}
              {((client.tags && client.tags.length > 0) || client.notes) && (
                <>
                  <Divider />
                  <motion.div variants={fadeInUp}>
                    {client.tags && client.tags.length > 0 && (
                      <div className="mb-4">
                        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <Tag size={12} />
                          Tags
                        </h4>
                        <div className="flex flex-wrap gap-1.5">
                          {client.tags.map((tag) => (
                            <Chip
                              key={tag}
                              label={tag}
                              size="small"
                              sx={{
                                backgroundColor: '#FEF2F2',
                                color: '#DC2626',
                                fontSize: '0.75rem',
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    {client.notes && (
                      <div>
                        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <FileText size={12} />
                          Observacoes
                        </h4>
                        <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">
                          {client.notes}
                        </p>
                      </div>
                    )}
                  </motion.div>
                </>
              )}
            </motion.div>
          ) : null}
        </div>

        {/* Action Buttons */}
        {client && !isLoading && (
          <div className="border-t border-slate-100 p-4">
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outlined"
                size="small"
                startIcon={<Edit size={16} />}
                onClick={() => onEdit?.(client)}
                sx={{
                  borderColor: '#E2E8F0',
                  color: '#475569',
                  '&:hover': { borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
                }}
              >
                Editar
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<CalendarPlus size={16} />}
                onClick={() => onSchedule?.(client)}
                sx={{
                  borderColor: '#E2E8F0',
                  color: '#475569',
                  '&:hover': { borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
                }}
              >
                Agendar
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<ShoppingCart size={16} />}
                onClick={() => onNewSale?.(client)}
                sx={{
                  borderColor: '#E2E8F0',
                  color: '#475569',
                  '&:hover': { borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
                }}
              >
                Nova Venda
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={client.isActive ? <UserX size={16} /> : <UserCheck size={16} />}
                onClick={() => onToggleActive?.(client)}
                sx={{
                  borderColor: client.isActive ? '#FEE2E2' : '#DCFCE7',
                  color: client.isActive ? '#DC2626' : '#16A34A',
                  '&:hover': {
                    borderColor: client.isActive ? '#FECACA' : '#BBF7D0',
                    backgroundColor: client.isActive ? '#FEF2F2' : '#F0FDF4',
                  },
                }}
              >
                {client.isActive ? 'Desativar' : 'Ativar'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

/* ---- Sub-components ---- */

function ContactRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors">
      <span className="text-slate-400 mt-0.5">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-slate-400">{label}</p>
        <p className="text-sm text-slate-800 break-all">{value}</p>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="text-center p-3 rounded-xl bg-slate-50">
      <div className="flex justify-center mb-1" style={{ color }}>
        {icon}
      </div>
      <p className="text-sm font-bold text-slate-800">{value}</p>
      <p className="text-[10px] text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}

function EmptySection({ text }: { text: string }) {
  return (
    <div className="py-4 text-center">
      <p className="text-sm text-slate-400">{text}</p>
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton variant="circular" width={64} height={64} />
        <div className="flex-1">
          <Skeleton width="60%" height={24} />
          <Skeleton width="40%" height={18} />
        </div>
      </div>
      {[...Array(4)].map((_, i) => (
        <Skeleton key={i} variant="rounded" height={48} />
      ))}
    </div>
  );
}
