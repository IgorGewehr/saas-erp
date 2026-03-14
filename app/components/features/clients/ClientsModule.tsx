'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  Chip,
  IconButton,
  Tooltip,
  Select,
  MenuItem,
  FormControl,
  Skeleton,
} from '@mui/material';
import {
  Plus,
  Search,
  Users,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  UserPlus,
  Phone,
  Mail,
  MoreHorizontal,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { orderBy, where, QueryConstraint } from 'firebase/firestore';
import debounce from 'lodash.debounce';
import { toast } from 'react-toastify';

import { useAuth } from '@/app/components/providers/AuthProvider';
import { clientsService, appointmentsService, transactionsService } from '@/lib/services/api';
import type { Client, SortConfig, Appointment, Transaction } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  formatCPFCNPJ,
  formatPhone,
  formatCurrency,
  formatDate,
  getInitials,
} from '@/lib/utils/format';

import { ClientFormDialog } from './ClientFormDialog';
import { ClientDetailDrawer } from './ClientDetailDrawer';

// ---- Mock Data ----
const MOCK_CLIENTS: Client[] = [
  {
    id: '1',
    businessId: 'demo',
    tipo: 'pf',
    nome: 'Maria Silva Santos',
    cpfCnpj: '12345678901',
    email: 'maria@email.com',
    phone: '11999887766',
    birthDate: '1990-05-15',
    gender: 'F',
    tags: ['vip', 'mensal'],
    isActive: true,
    totalSpent: 4580.0,
    visitCount: 24,
    lastVisit: '2026-03-10',
    notes: 'Cliente preferencial. Gosta do horario da manha.',
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2026-03-10T14:30:00Z',
  },
  {
    id: '2',
    businessId: 'demo',
    tipo: 'pf',
    nome: 'Joao Pedro Oliveira',
    cpfCnpj: '98765432100',
    email: 'joao.pedro@email.com',
    phone: '11988776655',
    phone2: '1133445566',
    gender: 'M',
    isActive: true,
    totalSpent: 1250.0,
    visitCount: 8,
    lastVisit: '2026-02-28',
    createdAt: '2025-06-20T09:00:00Z',
    updatedAt: '2026-02-28T16:00:00Z',
  },
  {
    id: '3',
    businessId: 'demo',
    tipo: 'pj',
    nome: 'Tech Solutions Ltda',
    cpfCnpj: '12345678000199',
    email: 'contato@techsolutions.com',
    phone: '1140028922',
    endereco: {
      logradouro: 'Rua das Flores',
      numero: '123',
      complemento: 'Sala 5',
      bairro: 'Centro',
      municipio: 'Sao Paulo',
      codigoMunicipio: '3550308',
      uf: 'SP',
      cep: '01001000',
    },
    isActive: true,
    totalSpent: 12800.0,
    visitCount: 15,
    lastVisit: '2026-03-05',
    tags: ['empresa', 'contrato'],
    createdAt: '2024-11-01T08:00:00Z',
    updatedAt: '2026-03-05T11:00:00Z',
  },
  {
    id: '4',
    businessId: 'demo',
    tipo: 'pf',
    nome: 'Ana Beatriz Lima',
    cpfCnpj: '11122233344',
    phone: '21977665544',
    gender: 'F',
    isActive: false,
    totalSpent: 320.0,
    visitCount: 2,
    lastVisit: '2025-08-12',
    createdAt: '2025-07-01T12:00:00Z',
    updatedAt: '2025-08-12T15:00:00Z',
  },
  {
    id: '5',
    businessId: 'demo',
    tipo: 'pf',
    nome: 'Carlos Eduardo Mendes',
    cpfCnpj: '55566677788',
    email: 'carlos.mendes@email.com',
    phone: '31988554433',
    gender: 'M',
    birthDate: '1985-11-22',
    isActive: true,
    totalSpent: 2100.0,
    visitCount: 12,
    lastVisit: '2026-03-12',
    createdAt: '2025-03-10T14:00:00Z',
    updatedAt: '2026-03-12T09:00:00Z',
  },
  {
    id: '6',
    businessId: 'demo',
    tipo: 'pf',
    nome: 'Fernanda Costa Reis',
    cpfCnpj: '99988877766',
    email: 'fernanda.reis@email.com',
    phone: '41966778899',
    gender: 'F',
    isActive: true,
    totalSpent: 890.0,
    visitCount: 5,
    lastVisit: '2026-01-20',
    tags: ['novo'],
    createdAt: '2025-12-01T10:00:00Z',
    updatedAt: '2026-01-20T13:00:00Z',
  },
];

type FilterStatus = 'todos' | 'ativos' | 'inativos';

const ITEMS_PER_PAGE_OPTIONS = [10, 25, 50];

export default function ClientsModule() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const businessId = user?.businessId || '';

  // ---- State ----
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('todos');
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: 'nome', direction: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  // ---- Debounced search ----
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSetSearch = useCallback(
    debounce((value: string) => {
      setDebouncedSearch(value);
      setPage(1);
    }, 300),
    []
  );

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearchTerm(e.target.value);
    debouncedSetSearch(e.target.value);
  }

  // ---- Fetch clients ----
  const {
    data: clients = [],
    isLoading,
    isError,
  } = useQuery<Client[]>({
    queryKey: ['clients', businessId],
    queryFn: async () => {
      if (!businessId) return MOCK_CLIENTS;
      try {
        const constraints: QueryConstraint[] = [orderBy('nome', 'asc')];
        const result = await clientsService.getAll(businessId, constraints);
        return result.length > 0 ? result : MOCK_CLIENTS;
      } catch {
        return MOCK_CLIENTS;
      }
    },
    enabled: true,
  });

  // ---- Fetch related data for selected client ----
  const { data: recentAppointments = [] } = useQuery<Appointment[]>({
    queryKey: ['clientAppointments', selectedClient?.id],
    queryFn: async () => {
      if (!selectedClient || !businessId) return [];
      try {
        const constraints: QueryConstraint[] = [
          where('clientId', '==', selectedClient.id),
          orderBy('date', 'desc'),
        ];
        return await appointmentsService.getAll(businessId, constraints);
      } catch {
        return [];
      }
    },
    enabled: !!selectedClient && isDrawerOpen,
  });

  const { data: recentTransactions = [] } = useQuery<Transaction[]>({
    queryKey: ['clientTransactions', selectedClient?.id],
    queryFn: async () => {
      if (!selectedClient || !businessId) return [];
      try {
        const constraints: QueryConstraint[] = [
          where('clientId', '==', selectedClient.id),
          orderBy('dueDate', 'desc'),
        ];
        return await transactionsService.getAll(businessId, constraints);
      } catch {
        return [];
      }
    },
    enabled: !!selectedClient && isDrawerOpen,
  });

  // ---- Filter + Search + Sort ----
  const filteredClients = useMemo(() => {
    let result = [...clients];

    // Status filter
    if (filterStatus === 'ativos') result = result.filter((c) => c.isActive);
    if (filterStatus === 'inativos') result = result.filter((c) => !c.isActive);

    // Search filter
    if (debouncedSearch) {
      const term = debouncedSearch.toLowerCase();
      result = result.filter(
        (c) =>
          c.nome.toLowerCase().includes(term) ||
          c.cpfCnpj.includes(term.replace(/\D/g, '')) ||
          c.phone.includes(term.replace(/\D/g, '')) ||
          (c.email && c.email.toLowerCase().includes(term))
      );
    }

    // Sort
    result.sort((a, b) => {
      const field = sortConfig.field as keyof Client;
      const aVal = a[field];
      const bVal = b[field];

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      let comparison = 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        comparison = aVal.localeCompare(bVal, 'pt-BR');
      } else if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal;
      }

      return sortConfig.direction === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [clients, filterStatus, debouncedSearch, sortConfig]);

  // ---- Pagination ----
  const totalPages = Math.max(1, Math.ceil(filteredClients.length / pageSize));
  const paginatedClients = filteredClients.slice(
    (page - 1) * pageSize,
    page * pageSize
  );

  // ---- Handlers ----
  function handleSort(field: string) {
    setSortConfig((prev) => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  }

  function handleOpenForm(client?: Client) {
    setEditingClient(client || null);
    setIsFormOpen(true);
  }

  function handleOpenDrawer(client: Client) {
    setSelectedClient(client);
    setIsDrawerOpen(true);
  }

  async function handleSaveClient(
    data: Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'totalSpent' | 'visitCount' | 'lastVisit'>
  ) {
    const saveData = { ...data, businessId };

    if (editingClient) {
      await clientsService.update(editingClient.id, saveData);
    } else {
      await clientsService.create({
        ...saveData,
        totalSpent: 0,
        visitCount: 0,
      } as Omit<Client, 'id'>);
    }

    queryClient.invalidateQueries({ queryKey: ['clients'] });
  }

  async function handleToggleActive(client: Client) {
    try {
      await clientsService.update(client.id, { isActive: !client.isActive });
      toast.success(client.isActive ? 'Cliente desativado' : 'Cliente ativado');
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      setIsDrawerOpen(false);
    } catch {
      toast.error('Erro ao atualizar status do cliente');
    }
  }

  function handleEditFromDrawer(client: Client) {
    setIsDrawerOpen(false);
    setTimeout(() => handleOpenForm(client), 200);
  }

  function getSortIcon(field: string) {
    if (sortConfig.field !== field)
      return <ArrowUpDown size={14} className="text-slate-300" />;
    return sortConfig.direction === 'asc' ? (
      <ArrowUp size={14} className="text-red-500" />
    ) : (
      <ArrowDown size={14} className="text-red-500" />
    );
  }

  const activeCount = clients.filter((c) => c.isActive).length;
  const inactiveCount = clients.filter((c) => !c.isActive).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
            <Users size={22} className="text-red-600" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-slate-900">
              Clientes
            </h1>
            <p className="text-sm text-slate-500">
              {filteredClients.length} cliente{filteredClients.length !== 1 ? 's' : ''} encontrado{filteredClients.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => handleOpenForm()}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-xl font-medium text-sm hover:bg-red-700 transition-colors shadow-sm"
        >
          <Plus size={18} />
          Novo Cliente
        </motion.button>
      </motion.div>

      {/* Search + Filters */}
      <motion.div
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="flex flex-col sm:flex-row gap-3"
      >
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por nome, CPF/CNPJ, telefone, e-mail..."
            value={searchTerm}
            onChange={handleSearchChange}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 transition-all"
          />
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-2">
          {[
            { key: 'todos' as FilterStatus, label: 'Todos', count: clients.length },
            { key: 'ativos' as FilterStatus, label: 'Ativos', count: activeCount },
            { key: 'inativos' as FilterStatus, label: 'Inativos', count: inactiveCount },
          ].map((filter) => (
            <Chip
              key={filter.key}
              label={`${filter.label} (${filter.count})`}
              onClick={() => {
                setFilterStatus(filter.key);
                setPage(1);
              }}
              variant={filterStatus === filter.key ? 'filled' : 'outlined'}
              sx={{
                fontWeight: 500,
                fontSize: '0.8rem',
                ...(filterStatus === filter.key
                  ? {
                      backgroundColor: '#DC2626',
                      color: '#fff',
                      '&:hover': { backgroundColor: '#B91C1C' },
                    }
                  : {
                      borderColor: '#E2E8F0',
                      color: '#64748B',
                      '&:hover': { borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
                    }),
              }}
            />
          ))}
        </div>
      </motion.div>

      {/* Table / Cards */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
      >
        {isLoading ? (
          <LoadingSkeleton />
        ) : isError ? (
          <ErrorState />
        ) : paginatedClients.length === 0 ? (
          <EmptyState
            hasSearch={!!debouncedSearch || filterStatus !== 'todos'}
            onClearFilters={() => {
              setSearchTerm('');
              setDebouncedSearch('');
              setFilterStatus('todos');
            }}
            onAddClient={() => handleOpenForm()}
          />
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    {[
                      { key: 'nome', label: 'Cliente' },
                      { key: 'cpfCnpj', label: 'CPF/CNPJ' },
                      { key: 'phone', label: 'Telefone' },
                      { key: 'email', label: 'E-mail' },
                      { key: 'lastVisit', label: 'Ultima Visita' },
                      { key: 'totalSpent', label: 'Total Gasto' },
                      { key: 'isActive', label: 'Status' },
                    ].map((col) => (
                      <th
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700 transition-colors"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {col.label}
                          {getSortIcon(col.key)}
                        </span>
                      </th>
                    ))}
                    <th className="px-4 py-3 w-10" />
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence mode="popLayout">
                    {paginatedClients.map((client, index) => (
                      <motion.tr
                        key={client.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2, delay: index * 0.03 }}
                        onClick={() => handleOpenDrawer(client)}
                        className="border-b border-slate-50 cursor-pointer hover:bg-slate-50/80 transition-colors group"
                      >
                        {/* Avatar + Nome */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                'w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0',
                                client.isActive
                                  ? 'bg-gradient-to-br from-red-500 to-red-700'
                                  : 'bg-gradient-to-br from-slate-400 to-slate-500'
                              )}
                            >
                              {getInitials(client.nome)}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-800 truncate group-hover:text-red-600 transition-colors">
                                {client.nome}
                              </p>
                              <p className="text-xs text-slate-400">
                                {client.tipo === 'pf' ? 'PF' : 'PJ'}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* CPF/CNPJ */}
                        <td className="px-4 py-3">
                          <span className="text-sm text-slate-600 font-mono">
                            {formatCPFCNPJ(client.cpfCnpj)}
                          </span>
                        </td>

                        {/* Telefone */}
                        <td className="px-4 py-3">
                          <span className="text-sm text-slate-600">
                            {formatPhone(client.phone)}
                          </span>
                        </td>

                        {/* Email */}
                        <td className="px-4 py-3">
                          <span className="text-sm text-slate-600 truncate block max-w-[180px]">
                            {client.email || '-'}
                          </span>
                        </td>

                        {/* Ultima Visita */}
                        <td className="px-4 py-3">
                          <span className="text-sm text-slate-600">
                            {client.lastVisit ? formatDate(client.lastVisit) : '-'}
                          </span>
                        </td>

                        {/* Total Gasto */}
                        <td className="px-4 py-3">
                          <span className="text-sm font-semibold text-slate-800">
                            {formatCurrency(client.totalSpent)}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          <Chip
                            label={client.isActive ? 'Ativo' : 'Inativo'}
                            size="small"
                            sx={{
                              backgroundColor: client.isActive ? '#DCFCE7' : '#F1F5F9',
                              color: client.isActive ? '#16A34A' : '#64748B',
                              fontWeight: 600,
                              fontSize: '0.7rem',
                            }}
                          />
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <Tooltip title="Opcoes">
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenDrawer(client);
                              }}
                            >
                              <MoreHorizontal size={16} className="text-slate-400" />
                            </IconButton>
                          </Tooltip>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-slate-100">
              <AnimatePresence mode="popLayout">
                {paginatedClients.map((client, index) => (
                  <motion.div
                    key={client.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2, delay: index * 0.03 }}
                    onClick={() => handleOpenDrawer(client)}
                    className="p-4 cursor-pointer hover:bg-slate-50/80 transition-colors active:bg-slate-100"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          'w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0',
                          client.isActive
                            ? 'bg-gradient-to-br from-red-500 to-red-700'
                            : 'bg-gradient-to-br from-slate-400 to-slate-500'
                        )}
                      >
                        {getInitials(client.nome)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-slate-800 truncate">
                            {client.nome}
                          </p>
                          <Chip
                            label={client.isActive ? 'Ativo' : 'Inativo'}
                            size="small"
                            sx={{
                              backgroundColor: client.isActive ? '#DCFCE7' : '#F1F5F9',
                              color: client.isActive ? '#16A34A' : '#64748B',
                              fontWeight: 600,
                              fontSize: '0.65rem',
                              height: 20,
                            }}
                          />
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5 font-mono">
                          {formatCPFCNPJ(client.cpfCnpj)}
                        </p>
                        <div className="flex items-center gap-4 mt-2">
                          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                            <Phone size={12} />
                            {formatPhone(client.phone)}
                          </span>
                          {client.email && (
                            <span className="inline-flex items-center gap-1 text-xs text-slate-500 truncate">
                              <Mail size={12} />
                              {client.email}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs text-slate-400">
                            {client.lastVisit ? `Ultima visita: ${formatDate(client.lastVisit)}` : 'Sem visitas'}
                          </span>
                          <span className="text-sm font-semibold text-slate-800">
                            {formatCurrency(client.totalSpent)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </>
        )}

        {/* Pagination */}
        {!isLoading && filteredClients.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span>Exibindo</span>
              <FormControl size="small" sx={{ minWidth: 70 }}>
                <Select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  sx={{
                    fontSize: '0.875rem',
                    '& .MuiSelect-select': { py: 0.5, px: 1 },
                  }}
                >
                  {ITEMS_PER_PAGE_OPTIONS.map((opt) => (
                    <MenuItem key={opt} value={opt}>
                      {opt}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <span>
                de {filteredClients.length} resultado{filteredClients.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <IconButton
                size="small"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                sx={{ color: '#64748B' }}
              >
                <ChevronLeft size={18} />
              </IconButton>

              {generatePageNumbers(page, totalPages).map((p, i) =>
                p === '...' ? (
                  <span key={`ellipsis-${i}`} className="px-1 text-slate-400 text-sm">
                    ...
                  </span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p as number)}
                    className={cn(
                      'w-8 h-8 rounded-lg text-sm font-medium transition-colors',
                      page === p
                        ? 'bg-red-600 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                    )}
                  >
                    {p}
                  </button>
                )
              )}

              <IconButton
                size="small"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                sx={{ color: '#64748B' }}
              >
                <ChevronRight size={18} />
              </IconButton>
            </div>
          </div>
        )}
      </motion.div>

      {/* Form Dialog */}
      <ClientFormDialog
        open={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditingClient(null);
        }}
        onSave={handleSaveClient}
        client={editingClient}
      />

      {/* Detail Drawer */}
      <ClientDetailDrawer
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        client={selectedClient}
        recentAppointments={recentAppointments}
        recentTransactions={recentTransactions}
        onEdit={handleEditFromDrawer}
        onSchedule={(client) => {
          toast.info(`Agendar para ${client.nome} - funcionalidade em desenvolvimento`);
        }}
        onNewSale={(client) => {
          toast.info(`Nova venda para ${client.nome} - funcionalidade em desenvolvimento`);
        }}
        onToggleActive={handleToggleActive}
      />
    </div>
  );
}

/* ---- Helper: Page number generation ---- */
function generatePageNumbers(
  current: number,
  total: number
): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | '...')[] = [1];

  if (current > 3) pages.push('...');

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) pages.push(i);

  if (current < total - 2) pages.push('...');

  pages.push(total);

  return pages;
}

/* ---- Sub-components ---- */

function LoadingSkeleton() {
  return (
    <div className="p-4 space-y-4">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton variant="circular" width={36} height={36} />
          <div className="flex-1 space-y-2">
            <Skeleton variant="text" width="30%" height={18} />
            <Skeleton variant="text" width="20%" height={14} />
          </div>
          <Skeleton variant="text" width="15%" height={18} />
          <Skeleton variant="rounded" width={60} height={24} />
        </div>
      ))}
    </div>
  );
}

function ErrorState() {
  return (
    <div className="py-16 text-center">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center">
        <Users size={28} className="text-red-400" />
      </div>
      <p className="text-slate-600 font-medium">Erro ao carregar clientes</p>
      <p className="text-sm text-slate-400 mt-1">
        Verifique sua conexao e tente novamente.
      </p>
    </div>
  );
}

function EmptyState({
  hasSearch,
  onClearFilters,
  onAddClient,
}: {
  hasSearch: boolean;
  onClearFilters: () => void;
  onAddClient: () => void;
}) {
  return (
    <div className="py-16 text-center">
      <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-slate-50 flex items-center justify-center">
        <UserPlus size={36} className="text-slate-300" />
      </div>
      {hasSearch ? (
        <>
          <p className="text-slate-600 font-medium">Nenhum cliente encontrado</p>
          <p className="text-sm text-slate-400 mt-1">
            Tente alterar os filtros ou o termo de busca.
          </p>
          <button
            onClick={onClearFilters}
            className="mt-4 px-4 py-2 text-sm text-red-600 font-medium hover:bg-red-50 rounded-lg transition-colors"
          >
            Limpar filtros
          </button>
        </>
      ) : (
        <>
          <p className="text-slate-600 font-medium">Nenhum cliente cadastrado</p>
          <p className="text-sm text-slate-400 mt-1">
            Comece adicionando seu primeiro cliente.
          </p>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onAddClient}
            className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-xl font-medium text-sm hover:bg-red-700 transition-colors"
          >
            <Plus size={18} />
            Adicionar Cliente
          </motion.button>
        </>
      )}
    </div>
  );
}
