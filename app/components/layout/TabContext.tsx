'use client';

import * as React from 'react';
import type { MenuPage } from '@/app/components/layout/Sidebar';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface Tab {
  id: MenuPage;
  title: string;
}

export interface TabContextValue {
  tabs: Tab[];
  activeTabId: MenuPage | null;
  openTab: (page: MenuPage, title?: string) => void;
  closeTab: (page: MenuPage) => void;
  setActiveTab: (page: MenuPage) => void;
  closeOtherTabs: (page: MenuPage) => void;
}

// ---------------------------------------------------------------------------
// Page title lookup
// ---------------------------------------------------------------------------
export const PAGE_TITLES: Record<MenuPage, string> = {
  Dashboard: 'Dashboard',
  Clientes: 'Clientes',
  CRM: 'CRM',
  Agenda: 'Agenda',
  Conversas: 'Conversas',
  Kanban: 'Kanban',
  Notas: 'Notas',
  PDV: 'PDV',
  Vendas: 'Vendas',
  Compras: 'Compras',
  Financeiro: 'Financeiro',
  Estoque: 'Estoque',
  Pedidos: 'Pedidos',
  'Cardápio': 'Cardápio',
  NFSe: 'NFS-e',
  NFCe: 'NFC-e',
  NFe: 'NF-e',
  'Relatórios': 'Relatórios',
  Senhas: 'Senhas',
  'Configurações': 'Config.',
};

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
const MAX_TABS = 6;
const STORAGE_KEY = 'saas-erp-tabs';

function loadTabs(): { tabs: Tab[]; activeTabId: MenuPage | null } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (Array.isArray(d.tabs)) {
        // Deduplicate and strip tabs with empty/invalid ids
        const seen = new Set<string>();
        const valid = d.tabs.filter((t: Tab) => {
          if (!t.id || seen.has(t.id)) return false;
          seen.add(t.id);
          return true;
        });
        if (valid.length > 0) {
          const activeTabId = seen.has(d.activeTabId) ? d.activeTabId : valid[0].id;
          return { tabs: valid, activeTabId };
        }
      }
    }
  } catch { /* ignore */ }
  return { tabs: [], activeTabId: null };
}

function saveTabs(tabs: Tab[], activeTabId: MenuPage | null) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeTabId }));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
const TabContext = React.createContext<TabContextValue | null>(null);

export function TabProvider({ children }: { children: React.ReactNode }) {
  const [tabs, setTabs] = React.useState<Tab[]>([]);
  const [activeTabId, setActiveId] = React.useState<MenuPage | null>(null);
  const [hydrated, setHydrated] = React.useState(false);

  const activeIdRef = React.useRef<MenuPage | null>(null);
  React.useEffect(() => { activeIdRef.current = activeTabId; }, [activeTabId]);

  // Hydrate from sessionStorage on mount
  React.useEffect(() => {
    const stored = loadTabs();
    if (stored.tabs.length > 0) {
      setTabs(stored.tabs);
      setActiveId(stored.activeTabId ?? stored.tabs[0].id);
    } else {
      const initial: Tab = { id: 'Dashboard', title: PAGE_TITLES['Dashboard'] };
      setTabs([initial]);
      setActiveId('Dashboard');
    }
    setHydrated(true);
  }, []);

  // Persist on change
  React.useEffect(() => {
    if (hydrated) saveTabs(tabs, activeTabId);
  }, [tabs, activeTabId, hydrated]);

  // ── Actions ──

  const openTab = React.useCallback((page: MenuPage, title?: string) => {
    if (!page) return; // guard against empty page ids from stale sessionStorage
    const tabTitle = title ?? PAGE_TITLES[page] ?? page;
    setTabs(prev => {
      const existing = prev.find(t => t.id === page);
      if (existing) {
        setActiveId(existing.id);
        return prev;
      }
      let next = [...prev];
      while (next.length >= MAX_TABS) next.splice(0, 1);
      const tab: Tab = { id: page, title: tabTitle };
      setActiveId(tab.id);
      return [...next, tab];
    });
  }, []);

  const closeTab = React.useCallback((page: MenuPage) => {
    setTabs(prev => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex(t => t.id === page);
      if (idx === -1) return prev;
      const next = prev.filter(t => t.id !== page);
      if (page === activeIdRef.current) {
        const newIdx = Math.min(idx, next.length - 1);
        setActiveId(next[newIdx].id);
      }
      return next;
    });
  }, []);

  const setActiveTab = React.useCallback((page: MenuPage) => setActiveId(page), []);

  const closeOtherTabs = React.useCallback((page: MenuPage) => {
    setTabs(prev => {
      const tab = prev.find(t => t.id === page);
      return tab ? [tab] : prev;
    });
    setActiveId(page);
  }, []);

  const value = React.useMemo<TabContextValue>(() => ({
    tabs, activeTabId, openTab, closeTab, setActiveTab, closeOtherTabs,
  }), [tabs, activeTabId, openTab, closeTab, setActiveTab, closeOtherTabs]);

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>;
}

export function useTabContext() {
  const ctx = React.useContext(TabContext);
  if (!ctx) throw new Error('useTabContext must be inside TabProvider');
  return ctx;
}
