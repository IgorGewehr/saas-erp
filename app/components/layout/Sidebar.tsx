'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useTranslation } from 'react-i18next';
import { collection, query, where, doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import type { SidebarPrefs, SidebarSectionPref } from '@/lib/types';
import {
  LayoutDashboard,
  Calendar,
  ShoppingCart,
  DollarSign,
  Package,
  FileCheck2,
  Receipt,
  FileText,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  X,
  Kanban,
  Target,
  MessageSquare,
  Users,
  ClipboardList,
  ShoppingBag,
  ClipboardCheck,
  UtensilsCrossed,
  BarChart3,
  KeyRound,
  StickyNote,
  FileSpreadsheet,
} from 'lucide-react';
import type { UseCase, UserRole } from '@/lib/types';
import { ROLE_HIERARCHY } from '@/lib/types';

export type MenuPage =
  | 'Dashboard'
  | 'Clientes'
  | 'CRM'
  | 'Agenda'
  | 'Conversas'
  | 'Kanban'
  | 'Notas'
  | 'PDV'
  | 'Vendas'
  | 'Compras'
  | 'Financeiro'
  | 'Estoque'
  | 'Pedidos'
  | 'Cardápio'
  | 'NFSe'
  | 'NFCe'
  | 'NFe'
  | 'Relatórios'
  | 'Senhas'
  | 'Planilhas'
  | 'Configurações';

// Which use cases each module appears under. `undefined` means "always visible".
const ALL_USE_CASES: UseCase[] = ['pedidos', 'servicos', 'simples'];

interface MenuItemConfig {
  id: MenuPage;
  label: string;
  icon: React.ElementType;
  comingSoon?: boolean;
  enterpriseOnly?: boolean;
  useCases?: UseCase[];
  minRole?: UserRole;
  badgeCount?: number;
}

interface MenuSection {
  key: string;
  title: string;
  items: MenuItemConfig[];
}

function useMenuSections(): MenuSection[] {
  const { t } = useTranslation();
  return [
    {
      key: 'principal',
      title: t('sidebar.sections.principal'),
      items: [
        { id: 'Dashboard', label: t('sidebar.dashboard'), icon: LayoutDashboard },
        { id: 'Clientes', label: t('sidebar.clientes'), icon: Users },
        { id: 'CRM', label: t('sidebar.crm'), icon: Target, enterpriseOnly: true, useCases: ['pedidos', 'servicos', 'simples'] },
        { id: 'Agenda', label: t('sidebar.agenda'), icon: Calendar, useCases: ['servicos'] },
        { id: 'Conversas', label: t('sidebar.conversas'), icon: MessageSquare },
        { id: 'Notas', label: 'Notas', icon: StickyNote },
        { id: 'PDV', label: t('sidebar.pdv'), icon: ShoppingCart, useCases: ['pedidos', 'servicos', 'simples'] },
      ],
    },
    {
      key: 'gestao',
      title: t('sidebar.sections.gestao'),
      items: [
        { id: 'Pedidos', label: t('sidebar.pedidos', 'Pedidos'), icon: ClipboardCheck, useCases: ['pedidos'] },
        { id: 'Cardápio', label: t('sidebar.cardapio', 'Cardápio'), icon: UtensilsCrossed, useCases: ['pedidos'] },
        { id: 'Vendas', label: t('sidebar.vendas'), icon: ClipboardList, useCases: ['pedidos', 'servicos', 'simples'] },
        { id: 'Kanban', label: t('sidebar.kanban'), icon: Kanban, enterpriseOnly: true },
        { id: 'Financeiro', label: t('sidebar.financeiro'), icon: DollarSign, useCases: ['pedidos', 'servicos', 'simples'] },
        { id: 'Relatórios', label: t('sidebar.relatorios', 'Relatórios'), icon: BarChart3, useCases: ['pedidos', 'servicos', 'simples'] },
        { id: 'Estoque', label: t('sidebar.estoque'), icon: Package, useCases: ['pedidos', 'servicos', 'simples'] },
        { id: 'Compras', label: t('sidebar.compras'), icon: ShoppingBag, useCases: ['pedidos', 'servicos', 'simples'] },
        { id: 'Senhas', label: 'Senhas', icon: KeyRound, minRole: 'admin' as UserRole },
        { id: 'Planilhas', label: 'Planilhas', icon: FileSpreadsheet },
      ],
    },
    {
      key: 'fiscal',
      title: t('sidebar.sections.fiscal'),
      items: [
        { id: 'NFSe', label: t('sidebar.nfse'), icon: FileCheck2, useCases: ['pedidos', 'servicos', 'simples'], minRole: 'manager' },
        { id: 'NFCe', label: t('sidebar.nfce'), icon: Receipt, useCases: ['pedidos', 'servicos', 'simples'], minRole: 'manager' },
        { id: 'NFe', label: t('sidebar.nfe'), icon: FileText, useCases: ['pedidos', 'servicos', 'simples'], minRole: 'manager' },
      ],
    },
    {
      key: 'sistema',
      title: t('sidebar.sections.sistema'),
      items: [
        { id: 'Configurações', label: t('sidebar.configuracoes'), icon: Settings },
      ],
    },
  ];
}

interface SidebarProps {
  activePage: MenuPage;
  onMenuSelect: (page: MenuPage) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen: boolean;
  onMobileClose: () => void;
}

function MenuItem({
  item,
  isActive,
  isCollapsed,
  onSelect,
}: {
  item: MenuItemConfig;
  isActive: boolean;
  isCollapsed: boolean;
  onSelect: () => void;
}) {
  const [clicked, setClicked] = useState(false);
  const Icon = item.icon;

  const handleClick = () => {
    setClicked(true);
    setTimeout(() => setClicked(false), 560);
    onSelect();
  };

  return (
    <div className="relative">
      <motion.button
        whileTap={{ scale: 0.93 }}
        onClick={handleClick}
        title={isCollapsed ? item.label : undefined}
        className={cn(
          'group relative flex items-center w-full rounded-xl transition-all duration-200 focus-visible:outline-none',
          isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5',
          isActive
            ? 'text-white'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
        )}
      >
        {isActive && (
          <motion.div
            layoutId="sidebar-active-pill"
            className="absolute inset-0 rounded-xl bg-gradient-to-r from-red-600 to-red-500 shadow-md shadow-red-500/25"
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
          />
        )}
        {!isActive && (
          <div className="absolute inset-0 rounded-xl bg-gray-100 dark:bg-white/[0.04] opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
        )}

        {/* Click ripple burst */}
        <AnimatePresence>
          {clicked && (
            <motion.span
              initial={{ opacity: 0.45, scale: 0.3 }}
              animate={{ opacity: 0, scale: 2.5 }}
              exit={{}}
              transition={{ duration: 0.52, ease: [0.2, 0, 0.3, 1] }}
              className="absolute inset-0 rounded-xl bg-red-400/20 pointer-events-none"
            />
          )}
        </AnimatePresence>

        <Icon
          className={cn(
            'relative z-10 flex-shrink-0 transition-all duration-200',
            isCollapsed ? 'w-[19px] h-[19px]' : 'w-[18px] h-[18px]',
            isActive
              ? 'text-white'
              : 'text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300 group-hover:scale-110'
          )}
        />

        {!isCollapsed && (
          <span
            className={cn(
              'relative z-10 text-[15px] font-medium truncate leading-none flex-1 text-left',
              isActive ? 'text-white' : ''
            )}
          >
            {item.label}
          </span>
        )}

        {!isCollapsed && item.comingSoon && (
          <span
            className={cn(
              'relative z-10 text-[10px] font-semibold px-1.5 py-0.5 rounded-md',
              isActive
                ? 'bg-white/20 text-white'
                : 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-200/80 dark:border-amber-500/20'
            )}
          >
            Beta
          </span>
        )}

        <AnimatePresence initial={false}>
          {(item.badgeCount ?? 0) > 0 && (
            <motion.span
              key="count-badge"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className={cn(
                'relative z-10 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center leading-none',
                isCollapsed ? 'absolute -top-1 -right-1' : '',
                isActive ? 'bg-white/30 text-white' : 'bg-amber-500 text-white'
              )}
            >
              {item.badgeCount}
            </motion.span>
          )}
        </AnimatePresence>

        {/* Tooltip for collapsed state */}
        {isCollapsed && (
          <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-700 text-white text-[13px] font-medium whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-all duration-150 z-50 shadow-xl translate-x-1 group-hover:translate-x-0">
            {item.label}
            <div className="absolute right-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-r-gray-900 dark:border-r-gray-700" />
          </div>
        )}
      </motion.button>
    </div>
  );
}

function SectionHeader({
  title,
  isCollapsed,
  isSectionCollapsed,
  onToggle,
}: {
  title: string;
  isCollapsed: boolean;
  isSectionCollapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className={cn(
      'flex items-center',
      isCollapsed ? 'mx-3 my-2' : 'gap-1.5 px-2 pt-1 pb-2'
    )}>
      {!isCollapsed && (
        <span className="text-[11px] font-bold tracking-[0.1em] text-red-500 dark:text-red-400 uppercase select-none whitespace-nowrap">
          {title}
        </span>
      )}
      <div
        className="flex-1 h-px"
        style={{
          background: isCollapsed
            ? 'linear-gradient(to right, transparent, rgba(239,68,68,0.22), transparent)'
            : 'linear-gradient(to right, rgba(239,68,68,0.38) 0%, rgba(239,68,68,0.1) 45%, transparent 100%)',
        }}
      />
      {/* Per-section collapse toggle — only in expanded sidebar */}
      {!isCollapsed && onToggle && (
        <button
          onClick={onToggle}
          className="ml-1 p-0.5 text-red-400/50 hover:text-red-500 dark:hover:text-red-400 transition-colors rounded"
          title={isSectionCollapsed ? 'Expandir seção' : 'Recolher seção'}
        >
          <ChevronRight
            size={11}
            className={cn('transition-transform duration-200', !isSectionCollapsed && 'rotate-90')}
          />
        </button>
      )}
    </div>
  );
}

function SidebarContent({
  activePage,
  onMenuSelect,
  isCollapsed,
  onToggleCollapse,
  isMobile,
  onMobileClose,
}: SidebarProps & { isMobile?: boolean }) {
  const { signOut, business, user } = useAuth();
  const { t } = useTranslation();
  const menuSections = useMenuSections();
  const collapsed = isCollapsed && !isMobile;
  const isEnterprise = !!business?.enterprise?.isEnabled;
  const currentUseCase: UseCase = (business?.settings?.useCase as UseCase) || 'servicos';
  const userRoleValue = ROLE_HIERARCHY[user?.role ?? 'viewer'];

  // Urgent recurring transactions count for Financial badge — onSnapshot.
  // ANTES: useQuery + getDocs com refetchInterval 10min. Recurrence vencendo
  // hoje só aparecia no badge até 10min depois do operador adicioná-la.
  // AGORA: real-time via single-field filter + client-side range/active
  // checks. Tentei usar where('recurrence.nextDueDate', '>=' / '<=') no
  // server, mas Firestore exige composite index pra (businessId,
  // recurrence.nextDueDate) — link do console é gerado dinamicamente e
  // exige user clicar pra criar. Filtrar client-side é simples (volume
  // típico < 5k transactions por tenant) e robusto sem dependência de
  // setup manual de índice.
  const [urgentRecurringCount, setUrgentRecurringCount] = useState(0);
  useEffect(() => {
    if (!business?.id) { setUrgentRecurringCount(0); return; }
    const q = query(
      collection(db, 'transactions'),
      where('businessId', '==', business.id),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const todayStr = new Date().toISOString().slice(0, 10);
        const in3d = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
        const count = snap.docs.filter(d => {
          const data = d.data();
          const rec = data.recurrence;
          if (!rec || rec.isActive !== true) return false;
          const next = rec.nextDueDate;
          if (typeof next !== 'string') return false;
          return next >= todayStr && next <= in3d;
        }).length;
        setUrgentRecurringCount(count);
      },
      (err) => console.error('[Sidebar] urgent recurring snapshot error:', err),
    );
    return () => unsub();
  }, [business?.id]);

  // Badge de Conversas: conta quantas conversas têm mensagens NÃO LIDAS
  // visíveis pro usuário atual. Real-time via onSnapshot — zera assim
  // que operador abre/marca como lida.
  //
  // Visibilidade replicada: admin/founder vê tudo do tenant; demais veem
  // canais 'business' + canais pessoais que são deles. Soneca ativa é
  // sempre escondida (operador silenciou propositalmente).
  //
  // Query: filtra só por businessId (single-field, sem composite index).
  // Volume típico: 50-500 conversations no tenant — cheap pra subscribe.
  const [myAwaitingCount, setMyAwaitingCount] = useState(0);
  const sidebarUserRoleValue = ROLE_HIERARCHY[user?.role ?? 'viewer'];
  const sidebarIsAdmin = sidebarUserRoleValue >= ROLE_HIERARCHY['admin'];
  useEffect(() => {
    if (!business?.id || !user?.uid) {
      setMyAwaitingCount(0);
      return;
    }
    const q = query(
      collection(db, 'conversations'),
      where('businessId', '==', business.id),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const now = Date.now();
        const count = snap.docs.reduce((acc, d) => {
          const c = d.data();
          // Conversas soft-deletadas: somem da lista do operador (filtro em
          // ConversasModule), então não devem inflar o badge. Sem este check
          // o badge mostrava "3" enquanto a UI reportava 0 não lidas — o
          // operador não conseguia clicar pra zerar (a conversa nem aparecia).
          if (c.isDeleted) return acc;
          // Sem mensagens não lidas — não conta
          if (!c.unreadCount || c.unreadCount <= 0) return acc;
          // Soneca ativa — operador silenciou, não deveria notificar
          if (c.snoozedUntil) {
            const until = new Date(c.snoozedUntil).getTime();
            if (Number.isFinite(until) && until > now) return acc;
          }
          // Visibilidade — espelha a lógica de ConversasModule.
          // Admin vê tudo; demais veem business OU canais pessoais próprios.
          if (sidebarIsAdmin) return acc + 1;
          if (c.channelOwnerType === 'business') return acc + 1;
          if (c.channelOwnerId === user.uid) return acc + 1;
          // Conversa legada (sem channelOwnerType) — fica oculta pra non-admin
          // por segurança. Após backfill, esse caminho some.
          return acc;
        }, 0);
        setMyAwaitingCount(count);
      },
      (err) => {
        // Fail-soft: índice ausente / rules / rede — mantém último valor
        // visível pro operador. Loga só warn pra não poluir o console em
        // outage curta.
        console.warn('[Sidebar] mine-awaiting snapshot error:', err);
      },
    );
    return () => unsub();
  }, [business?.id, user?.uid, sidebarIsAdmin]);

  const filterItems = useCallback((items: MenuItemConfig[]) =>
    items.filter((item) => {
      if (item.enterpriseOnly && !isEnterprise) return false;
      if (item.useCases && !item.useCases.includes(currentUseCase)) return false;
      if (item.minRole && userRoleValue < ROLE_HIERARCHY[item.minRole]) return false;
      return true;
    }).map(item => {
      if (item.id === 'Financeiro' && urgentRecurringCount > 0) {
        return { ...item, badgeCount: urgentRecurringCount };
      }
      if (item.id === 'Conversas' && myAwaitingCount > 0) {
        return { ...item, badgeCount: myAwaitingCount };
      }
      return item;
    }), [isEnterprise, currentUseCase, userRoleValue, urgentRecurringCount, myAwaitingCount]);

  // ── Build effective sections from prefs + hardcoded defaults ─────────────
  const PROTECTED = useMemo(() => new Set<string>(['Dashboard', 'Configurações']), []);

  const effectiveSections = useMemo(() => {
    // All items the user can actually see (role/useCase/enterprise filtered)
    const allVisibleMap = new Map<string, MenuItemConfig>();
    for (const s of menuSections) {
      for (const item of filterItems(s.items)) {
        allVisibleMap.set(item.id, item);
      }
    }

    const prefs = user?.sidebarPrefs;

    // No prefs saved at all — use hardcoded defaults
    if (!prefs) {
      return menuSections.map(s => ({
        key: s.key,
        title: s.title,
        isCollapsed: false,
        items: filterItems(s.items),
      })).filter(s => s.items.length > 0);
    }

    const hiddenSet = new Set(prefs.hiddenItems ?? []);

    // Prefs exist but sections not set yet — use defaults with hidden filter applied
    if (!prefs.sections?.length) {
      return menuSections.map(s => ({
        key: s.key,
        title: s.title,
        isCollapsed: false,
        items: filterItems(s.items).filter(item => PROTECTED.has(item.id) || !hiddenSet.has(item.id)),
      })).filter(s => s.items.length > 0);
    }

    const assignedIds = new Set<string>();

    const sections = prefs.sections.map(ps => {
      const items = ps.items
        .map(id => allVisibleMap.get(id))
        .filter((item): item is MenuItemConfig =>
          item !== undefined && (PROTECTED.has(item.id) || !hiddenSet.has(item.id))
        );
      items.forEach(item => assignedIds.add(item.id));
      return { key: ps.key, title: ps.title, isCollapsed: ps.isCollapsed, items };
    });

    // Items visible but not assigned to any section (added after prefs were saved).
    // Place each item in its original menuSections section so the sidebar matches the editor.
    const unassigned = [...allVisibleMap.values()].filter(
      item => !assignedIds.has(item.id) && !hiddenSet.has(item.id)
    );
    for (const item of unassigned) {
      const originalKey = menuSections.find(s => s.items.some(i => i.id === item.id))?.key;
      const target = sections.find(s => s.key === originalKey) ?? sections[0];
      if (target) target.items.push(item);
      else sections.push({ key: '__other__', title: 'Outros', isCollapsed: false, items: [item] });
    }

    return sections.filter(s => s.items.length > 0);
  }, [menuSections, filterItems, user?.sidebarPrefs, PROTECTED]);

  // Toggle per-section collapse and persist to Firestore
  const handleToggleSectionCollapse = useCallback(async (sectionKey: string) => {
    if (!user?.uid) return;
    const prefs = user.sidebarPrefs;

    let updatedSections: SidebarSectionPref[];
    if (!prefs?.sections?.length) {
      // Bootstrap prefs from defaults, toggling the target section
      updatedSections = menuSections
        .map(s => ({
          key: s.key,
          title: s.title,
          isCollapsed: s.key === sectionKey,
          items: filterItems(s.items).map(item => item.id),
        }))
        .filter(s => s.items.length > 0);
    } else {
      updatedSections = prefs.sections.map((s: SidebarSectionPref) =>
        s.key === sectionKey ? { ...s, isCollapsed: !s.isCollapsed } : s
      );
    }

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        'sidebarPrefs.sections': updatedSections,
        updatedAt: new Date().toISOString(),
      });
    } catch { /* ignore */ }
  }, [user?.uid, user?.sidebarPrefs, menuSections, filterItems]);

  return (
    <div
      className={cn(
        'flex flex-col h-full',
        'bg-white dark:bg-[#0a0e17]',
        'border-r border-gray-200/60 dark:border-gray-800/60',
        'transition-[width] duration-300 ease-in-out',
        collapsed ? 'w-[64px]' : 'w-[264px]'
      )}
      style={{ contain: 'layout', willChange: 'width' }}
    >
      {/* ── Header ── */}
      {collapsed ? (
        /* Collapsed: full-area expand button */
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={onToggleCollapse}
          className="group flex items-center justify-center h-[60px] w-full border-b border-gray-100 dark:border-gray-800/80 flex-shrink-0 hover:bg-red-50/60 dark:hover:bg-red-500/[0.07] transition-all duration-200"
          title={t('sidebar.expandMenu')}
        >
          <ChevronRight className="w-5 h-5 text-red-500 dark:text-red-400 group-hover:translate-x-0.5 transition-transform duration-200" />
        </motion.button>
      ) : (
        /* Expanded: logo + collapse button */
        <div className="flex items-center justify-between h-[60px] px-4 border-b border-gray-100 dark:border-gray-800/80 flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src="/icon.png" alt="Aevo" className="w-8 h-8 rounded-xl object-contain flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[14px] font-bold text-gray-900 dark:text-gray-100 font-display tracking-tight leading-tight">Aevo</p>
              <p className="text-[10.5px] text-gray-400 dark:text-gray-500 font-medium leading-tight">{t('sidebar.smartManagement')}</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {isMobile ? (
              <button
                onClick={onMobileClose}
                className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <motion.button
                whileTap={{ scale: 0.85 }}
                onClick={onToggleCollapse}
                className="group p-1.5 rounded-lg hover:bg-red-50/60 dark:hover:bg-red-500/[0.07] transition-all duration-150"
                title={t('sidebar.collapseMenu')}
              >
                <ChevronLeft className="w-4 h-4 text-red-500 dark:text-red-400 group-hover:-translate-x-0.5 transition-transform duration-200" />
              </motion.button>
            )}
          </div>
        </div>
      )}

      {/* ── Navigation ── */}
      <nav
        className={cn(
          'flex-1 overflow-y-auto overflow-x-hidden py-3',
          collapsed ? 'px-1.5' : 'px-2.5'
        )}
        style={{ scrollbarWidth: 'none' }}
      >
        {effectiveSections.map((section, sectionIdx) => (
          <div key={section.key} className={cn(sectionIdx > 0 && 'mt-1')}>
            <SectionHeader
              title={section.title}
              isCollapsed={collapsed}
              isSectionCollapsed={section.isCollapsed}
              onToggle={() => handleToggleSectionCollapse(section.key)}
            />

            <AnimatePresence initial={false}>
              {!section.isCollapsed && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-0.5">
                    {section.items.map((item) => (
                      <MenuItem
                        key={item.id}
                        item={item}
                        isActive={activePage === item.id}
                        isCollapsed={collapsed}
                        onSelect={() => {
                          onMenuSelect(item.id);
                          if (isMobile) onMobileClose();
                        }}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </nav>

      {/* ── Footer ── */}
      <div className={cn(
        'border-t border-gray-100 dark:border-gray-800/80 flex-shrink-0 p-2'
      )}>
        <button
          onClick={signOut}
          className={cn(
            'group flex items-center w-full rounded-xl px-3 py-2.5',
            'text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50/80 dark:hover:bg-red-500/[0.08]',
            'transition-all duration-200',
            collapsed ? 'justify-center' : 'gap-3'
          )}
          title={collapsed ? t('sidebar.logout') : undefined}
        >
          <LogOut className="w-[17px] h-[17px] group-hover:translate-x-0.5 transition-transform duration-150 flex-shrink-0" />
          {!collapsed && (
            <span className="text-[15px] font-medium">
              {t('sidebar.logout')}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

export default function Sidebar(props: SidebarProps) {
  const { isMobileOpen, onMobileClose } = props;

  useEffect(() => {
    document.body.style.overflow = isMobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isMobileOpen]);

  return (
    <>
      {/* Desktop */}
      <div className="hidden lg:block flex-shrink-0 h-screen sticky top-0">
        <SidebarContent {...props} isMobile={false} />
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {isMobileOpen && (
          <>
            <motion.div
              key="overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={onMobileClose}
              className="fixed inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-[2px] z-40 lg:hidden"
            />
            <motion.div
              key="drawer"
              initial={{ x: -280, opacity: 0.5 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -280, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed inset-y-0 left-0 z-50 lg:hidden shadow-2xl"
            >
              <SidebarContent
                {...props}
                isMobile={true}
                isCollapsed={false}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
