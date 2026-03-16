'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  Chip,
  IconButton,
  Tooltip,
  Select,
  MenuItem,
  FormControl,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
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
  Trash2,
  Filter,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import debounce from 'lodash.debounce';
import { toast } from 'react-toastify';

import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import type { Client, SortConfig } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  formatCPFCNPJ,
  formatPhone,
  formatCurrency,
  formatDate,
  getInitials,
} from '@/lib/utils/format';

import { useTheme } from '@/app/components/providers/ThemeProvider';
import { ClientFormDialog } from './ClientFormDialog';
import { ClientDetailDrawer } from './ClientDetailDrawer';

type FilterStatus = 'todos' | 'ativos' | 'inativos';
type FilterTipo = 'todos' | 'pf' | 'pj';

const ITEMS_PER_PAGE_OPTIONS = [10, 25, 50];

export default function ClientsModule() {
  const { user, business } = useAuth();
  const { isDark } = useTheme();
  const queryClient = useQueryClient();
  const businessId = business?.id || '';

  // ---- State ----
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('todos');
  const [filterTipo, setFilterTipo] = useState<FilterTipo>('todos');
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: 'nome', direction: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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

  // ---- Fetch clients from Firestore ----
  const {
    data: clients = [],
    isLoading,
    isError,
  } = useQuery<Client[]>({
    queryKey: ['clients', businessId],
    queryFn: async () => {
      if (!businessId) return [];
      const q = query(
        collection(db, 'clients'),
        where('businessId', '==', businessId),
        orderBy('nome', 'asc')
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Client));
    },
    enabled: !!businessId,
    staleTime: 5 * 60 * 1000,
  });

  // ---- Filter + Search + Sort ----
  const filteredClients = useMemo(() => {
    let result = [...clients];

    // Status filter
    if (filterStatus === 'ativos') result = result.filter((c) => c.isActive);
    if (filterStatus === 'inativos') result = result.filter((c) => !c.isActive);

    // Tipo filter
    if (filterTipo === 'pf') result = result.filter((c) => c.tipo === 'pf');
    if (filterTipo === 'pj') result = result.filter((c) => c.tipo === 'pj');

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
  }, [clients, filterStatus, filterTipo, debouncedSearch, sortConfig]);

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
    if (!businessId) {
      toast.error('Erro: empresa nao identificada.');
      return;
    }

    const now = new Date().toISOString();

    if (editingClient) {
      // UPDATE
      const docRef = doc(db, 'clients', editingClient.id);
      await updateDoc(docRef, {
        ...data,
        businessId,
        updatedAt: now,
      });
    } else {
      // CREATE
      await addDoc(collection(db, 'clients'), {
        ...data,
        businessId,
        totalSpent: 0,
        visitCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    queryClient.invalidateQueries({ queryKey: ['clients', businessId] });
  }

  async function handleToggleActive(client: Client) {
    if (!businessId) return;
    try {
      const docRef = doc(db, 'clients', client.id);
      await updateDoc(docRef, {
        isActive: !client.isActive,
        updatedAt: new Date().toISOString(),
      });
      toast.success(client.isActive ? 'Cliente desativado' : 'Cliente ativado');
      queryClient.invalidateQueries({ queryKey: ['clients', businessId] });
      setIsDrawerOpen(false);
    } catch {
      toast.error('Erro ao atualizar status do cliente');
    }
  }

  async function handleDeleteClient() {
    if (!deleteTarget || !businessId) return;
    setIsDeleting(true);
    try {
      const docRef = doc(db, 'clients', deleteTarget.id);
      await deleteDoc(docRef);
      toast.success('Cliente excluido com sucesso');
      queryClient.invalidateQueries({ queryKey: ['clients', businessId] });
      setDeleteTarget(null);
      setIsDrawerOpen(false);
    } catch {
      toast.error('Erro ao excluir cliente');
    } finally {
      setIsDeleting(false);
    }
  }

  function handleDeleteFromDrawer(client: Client) {
    setDeleteTarget(client);
  }

  function handleEditFromDrawer(client: Client) {
    setIsDrawerOpen(false);
    setTimeout(() => handleOpenForm(client), 200);
  }

  function getSortIcon(field: string) {
    if (sortConfig.field !== field)
      return <ArrowUpDown size={14} className="text-slate-300 dark:text-gray-600" />;
    return sortConfig.direction === 'asc' ? (
      <ArrowUp size={14} className="text-red-500" />
    ) : (
      <ArrowDown size={14} className="text-red-500" />
    );
  }

  const activeCount = clients.filter((c) => c.isActive).length;
  const inactiveCount = clients.filter((c) => !c.isActive).length;
  const pfCount = clients.filter((c) => c.tipo === 'pf').length;
  const pjCount = clients.filter((c) => c.tipo === 'pj').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.3 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
            <Users size={22} className="text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-gray-100">
              Clientes
            </h1>
            <p className="text-sm text-slate-500 dark:text-gray-400">
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
        initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="flex flex-col gap-3"
      >
        {/* Search + Tipo filter row */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder="Buscar por nome, CPF/CNPJ, telefone, e-mail..."
              value={searchTerm}
              onChange={handleSearchChange}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-slate-800 dark:text-gray-200 placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 transition-all"
            />
          </div>

          {/* Tipo filter */}
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-slate-400 dark:text-gray-500 shrink-0" />
            {[
              { key: 'todos' as FilterTipo, label: 'Todos', count: clients.length },
              { key: 'pf' as FilterTipo, label: 'PF', count: pfCount },
              { key: 'pj' as FilterTipo, label: 'PJ', count: pjCount },
            ].map((filter) => (
              <Chip
                key={filter.key}
                label={`${filter.label} (${filter.count})`}
                onClick={() => {
                  setFilterTipo(filter.key);
                  setPage(1);
                }}
                variant={filterTipo === filter.key ? 'filled' : 'outlined'}
                size="small"
                sx={{
                  fontWeight: 500,
                  fontSize: '0.75rem',
                  ...(filterTipo === filter.key
                    ? {
                        backgroundColor: isDark ? 'rgba(220, 38, 38, 0.15)' : '#FEE2E2',
                        color: isDark ? '#F87171' : '#DC2626',
                        '&:hover': { backgroundColor: isDark ? 'rgba(220, 38, 38, 0.2)' : '#FECACA' },
                      }
                    : {
                        borderColor: isDark ? 'rgba(55, 65, 81, 1)' : '#E2E8F0',
                        color: isDark ? '#9CA3AF' : '#64748B',
                        '&:hover': {
                          borderColor: isDark ? 'rgba(75, 85, 99, 1)' : '#CBD5E1',
                          backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                        },
                      }),
                }}
              />
            ))}
          </div>
        </div>

        {/* Status filter chips */}
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
                      borderColor: isDark ? 'rgba(55, 65, 81, 1)' : '#E2E8F0',
                      color: isDark ? '#9CA3AF' : '#64748B',
                      '&:hover': {
                        borderColor: isDark ? 'rgba(75, 85, 99, 1)' : '#CBD5E1',
                        backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                      },
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
        className="surface rounded-2xl overflow-hidden"
      >
        {isLoading ? (
          <LoadingSkeleton />
        ) : isError ? (
          <ErrorState />
        ) : paginatedClients.length === 0 ? (
          <EmptyState
            hasSearch={!!debouncedSearch || filterStatus !== 'todos' || filterTipo !== 'todos'}
            onClearFilters={() => {
              setSearchTerm('');
              setDebouncedSearch('');
              setFilterStatus('todos');
              setFilterTipo('todos');
            }}
            onAddClient={() => handleOpenForm()}
          />
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-gray-800">
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
                        className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700 dark:hover:text-gray-300 transition-colors"
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
                        className="border-b border-slate-50 dark:border-gray-800/50 cursor-pointer hover:bg-slate-50/80 dark:hover:bg-white/[0.04] transition-colors group"
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
                              <p className="text-sm font-medium text-slate-800 dark:text-gray-200 truncate group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">
                                {client.nome}
                              </p>
                              <p className="text-xs text-slate-400 dark:text-gray-500">
                                {client.tipo === 'pf' ? 'PF' : 'PJ'}
                                {client.visitCount > 0 && (
                                  <span className="ml-2">{client.visitCount} visita{client.visitCount !== 1 ? 's' : ''}</span>
                                )}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* CPF/CNPJ */}
                        <td className="px-4 py-3">
                          <span className="text-sm text-slate-600 dark:text-gray-400 font-mono">
                            {formatCPFCNPJ(client.cpfCnpj)}
                          </span>
                        </td>

                        {/* Telefone */}
                        <td className="px-4 py-3">
                          <span className="text-sm text-slate-600 dark:text-gray-400">
                            {formatPhone(client.phone)}
                          </span>
                        </td>

                        {/* Email */}
                        <td className="px-4 py-3">
                          <span className="text-sm text-slate-600 dark:text-gray-400 truncate block max-w-[180px]">
                            {client.email || '-'}
                          </span>
                        </td>

                        {/* Ultima Visita */}
                        <td className="px-4 py-3">
                          <span className="text-sm text-slate-600 dark:text-gray-400">
                            {client.lastVisit ? formatDate(client.lastVisit) : '-'}
                          </span>
                        </td>

                        {/* Total Gasto */}
                        <td className="px-4 py-3">
                          <span className="text-sm font-semibold text-slate-800 dark:text-gray-200">
                            {formatCurrency(client.totalSpent)}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          <Chip
                            label={client.isActive ? 'Ativo' : 'Inativo'}
                            size="small"
                            sx={{
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
                              <MoreHorizontal size={16} className="text-slate-400 dark:text-gray-500" />
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
            <div className="md:hidden divide-y divide-slate-100 dark:divide-gray-800">
              <AnimatePresence mode="popLayout">
                {paginatedClients.map((client, index) => (
                  <motion.div
                    key={client.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2, delay: index * 0.03 }}
                    onClick={() => handleOpenDrawer(client)}
                    className="p-4 cursor-pointer hover:bg-slate-50/80 dark:hover:bg-white/[0.04] transition-colors active:bg-slate-100 dark:active:bg-white/[0.06]"
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
                          <p className="text-sm font-medium text-slate-800 dark:text-gray-200 truncate">
                            {client.nome}
                          </p>
                          <Chip
                            label={client.isActive ? 'Ativo' : 'Inativo'}
                            size="small"
                            sx={{
                              backgroundColor: client.isActive
                                ? (isDark ? 'rgba(34,197,94,0.1)' : '#DCFCE7')
                                : (isDark ? 'rgba(148,163,184,0.1)' : '#F1F5F9'),
                              color: client.isActive
                                ? (isDark ? '#4ADE80' : '#16A34A')
                                : (isDark ? '#94A3B8' : '#64748B'),
                              fontWeight: 600,
                              fontSize: '0.65rem',
                              height: 20,
                            }}
                          />
                        </div>
                        <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5 font-mono">
                          {formatCPFCNPJ(client.cpfCnpj)}
                        </p>
                        <div className="flex items-center gap-4 mt-2">
                          <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-gray-400">
                            <Phone size={12} />
                            {formatPhone(client.phone)}
                          </span>
                          {client.email && (
                            <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-gray-400 truncate">
                              <Mail size={12} />
                              {client.email}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs text-slate-400 dark:text-gray-500">
                            {client.lastVisit ? `Ultima visita: ${formatDate(client.lastVisit)}` : 'Sem visitas'}
                          </span>
                          <span className="text-sm font-semibold text-slate-800 dark:text-gray-200">
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
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 dark:border-gray-800 bg-slate-50/50 dark:bg-white/[0.02]">
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-gray-400">
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
                  <span key={`ellipsis-${i}`} className="px-1 text-slate-400 dark:text-gray-500 text-sm">
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
                        : 'text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-white/[0.06]'
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
        onEdit={handleEditFromDrawer}
        onToggleActive={handleToggleActive}
        onDelete={handleDeleteFromDrawer}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteTarget}
        onClose={() => !isDeleting && setDeleteTarget(null)}
        PaperProps={{
          sx: {
            borderRadius: '16px',
            maxWidth: 420,
          },
        }}
      >
        <DialogTitle
          sx={{
            fontFamily: '"Plus Jakarta Sans", sans-serif',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
          }}
        >
          <Trash2 size={20} className="text-red-500" />
          Excluir Cliente
        </DialogTitle>
        <DialogContent>
          <p className="text-sm text-slate-600 dark:text-gray-400">
            Tem certeza que deseja excluir o cliente{' '}
            <strong className="text-slate-800 dark:text-gray-200">{deleteTarget?.nome}</strong>?
          </p>
          <p className="text-xs text-slate-400 dark:text-gray-500 mt-2">
            Esta acao nao pode ser desfeita. Todos os dados do cliente serao removidos permanentemente.
          </p>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setDeleteTarget(null)}
            disabled={isDeleting}
            sx={{ color: '#64748B' }}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleDeleteClient}
            variant="contained"
            disabled={isDeleting}
            sx={{
              backgroundColor: '#DC2626',
              '&:hover': { backgroundColor: '#B91C1C' },
            }}
          >
            {isDeleting ? 'Excluindo...' : 'Excluir'}
          </Button>
        </DialogActions>
      </Dialog>
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
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: i * 0.07 }}
          className="flex items-center gap-4"
        >
          <div className="w-9 h-9 rounded-full shimmer shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-[30%] rounded-md shimmer" />
            <div className="h-3 w-[20%] rounded-md shimmer" />
          </div>
          <div className="h-4 w-[15%] rounded-md shimmer" />
          <div className="h-6 w-[60px] rounded-full shimmer" />
        </motion.div>
      ))}
    </div>
  );
}

function ErrorState() {
  return (
    <div className="py-16 text-center">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
        <Users size={28} className="text-red-400" />
      </div>
      <p className="text-slate-600 dark:text-gray-400 font-medium">Erro ao carregar clientes</p>
      <p className="text-sm text-slate-400 dark:text-gray-500 mt-1">
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
      <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-slate-50 dark:bg-gray-800/50 flex items-center justify-center">
        <UserPlus size={36} className="text-slate-300 dark:text-gray-600" />
      </div>
      {hasSearch ? (
        <>
          <p className="text-slate-600 dark:text-gray-400 font-medium">Nenhum cliente encontrado</p>
          <p className="text-sm text-slate-400 dark:text-gray-500 mt-1">
            Tente alterar os filtros ou o termo de busca.
          </p>
          <button
            onClick={onClearFilters}
            className="mt-4 px-4 py-2 text-sm text-red-600 dark:text-red-400 font-medium hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
          >
            Limpar filtros
          </button>
        </>
      ) : (
        <>
          <p className="text-slate-600 dark:text-gray-400 font-medium">Nenhum cliente cadastrado</p>
          <p className="text-sm text-slate-400 dark:text-gray-500 mt-1">
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
