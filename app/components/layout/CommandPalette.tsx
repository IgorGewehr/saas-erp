'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, LayoutDashboard, Calendar, ShoppingCart, DollarSign, Package,
  FileCheck2, Receipt, FileText, Settings, Kanban, Target, MessageSquare,
  Users, ClipboardList, ShoppingBag, ClipboardCheck, UtensilsCrossed,
  BarChart3, KeyRound, StickyNote, Plus, Navigation, Pencil, Clock, Hash,
  ArrowRight, Loader2, Contact, Tag,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { isActiveClient } from '@/lib/utils/clientFilters';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useTabContext } from '@/app/components/layout/TabContext';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import type { MenuPage } from '@/app/components/layout/Sidebar';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ElementType;
  page?: MenuPage;
  action?: () => void;
  category: 'navigate' | 'create' | 'search_result' | 'recent';
  keywords?: string[];
  badge?: string;
  status?: string;
}

interface FirestoreResult {
  id: string;
  type: string;
  label: string;
  sublabel?: string;
  page: MenuPage;
}

// ---------------------------------------------------------------------------
// Entity type metadata
// ---------------------------------------------------------------------------
const ENTITY_META: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  client:      { label: 'Cliente',      icon: Users,         color: 'text-cyan-600 dark:text-cyan-400',    bg: 'bg-cyan-50 dark:bg-cyan-500/10'    },
  product:     { label: 'Produto',      icon: Package,       color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-500/10' },
  appointment: { label: 'Agendamento',  icon: Calendar,      color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
  contact:     { label: 'Contato CRM',  icon: Contact,       color: 'text-blue-600 dark:text-blue-400',    bg: 'bg-blue-50 dark:bg-blue-500/10'    },
  transaction: { label: 'Transação',    icon: DollarSign,    color: 'text-amber-600 dark:text-amber-400',  bg: 'bg-amber-50 dark:bg-amber-500/10'  },
  kanban:      { label: 'Kanban',       icon: Kanban,        color: 'text-pink-600 dark:text-pink-400',    bg: 'bg-pink-50 dark:bg-pink-500/10'    },
  snippet:     { label: 'Resposta',     icon: Tag,           color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-500/10' },
};

// ---------------------------------------------------------------------------
// Static navigation commands
// ---------------------------------------------------------------------------
const NAV_COMMANDS: CommandItem[] = [
  { id: 'nav-dashboard',    label: 'Dashboard',    description: 'Visão geral do negócio',       icon: LayoutDashboard,  page: 'Dashboard',    category: 'navigate', keywords: ['inicio','home','painel','kpi'] },
  { id: 'nav-clientes',     label: 'Clientes',     description: 'Cadastro de clientes',         icon: Users,            page: 'Clientes',     category: 'navigate', keywords: ['clientes','cadastro','cpf','cnpj'] },
  { id: 'nav-crm',          label: 'CRM',          description: 'Leads e pipeline de vendas',   icon: Target,           page: 'CRM',          category: 'navigate', keywords: ['crm','leads','pipeline','contatos'] },
  { id: 'nav-agenda',       label: 'Agenda',       description: 'Agendamentos e serviços',      icon: Calendar,         page: 'Agenda',       category: 'navigate', keywords: ['agenda','agendamentos','horarios','calendario'] },
  { id: 'nav-conversas',    label: 'Conversas',    description: 'WhatsApp, Instagram, Facebook',icon: MessageSquare,    page: 'Conversas',    category: 'navigate', keywords: ['conversas','whatsapp','chat','mensagens','omnichannel'] },
  { id: 'nav-kanban',       label: 'Kanban',       description: 'Quadros e tarefas',            icon: Kanban,           page: 'Kanban',       category: 'navigate', keywords: ['kanban','tarefas','cards','boards'] },
  { id: 'nav-notas',        label: 'Notas',        description: 'Anotações rápidas',            icon: StickyNote,       page: 'Notas',        category: 'navigate', keywords: ['notas','anotacoes','lembretes'] },
  { id: 'nav-pdv',          label: 'PDV',          description: 'Ponto de Venda',               icon: ShoppingCart,     page: 'PDV',          category: 'navigate', keywords: ['pdv','ponto de venda','caixa','venda'] },
  { id: 'nav-vendas',       label: 'Vendas',       description: 'Histórico de vendas',          icon: ClipboardList,    page: 'Vendas',       category: 'navigate', keywords: ['vendas','pedidos','faturamento','comercial'] },
  { id: 'nav-compras',      label: 'Compras',      description: 'Pedidos de compra',            icon: ShoppingBag,      page: 'Compras',      category: 'navigate', keywords: ['compras','fornecedores','pedido compra'] },
  { id: 'nav-pedidos',      label: 'Pedidos',      description: 'Gestão de pedidos',            icon: ClipboardCheck,   page: 'Pedidos',      category: 'navigate', keywords: ['pedidos','delivery','encomendas'] },
  { id: 'nav-mesas',        label: 'Mesas',        description: 'Comandas do salão',            icon: ClipboardCheck,   page: 'Mesas',        category: 'navigate', keywords: ['mesas','comanda','salao','conta','garcom'] },
  { id: 'nav-cardapio',     label: 'Cardápio',     description: 'Itens e categorias',           icon: UtensilsCrossed,  page: 'Cardápio',     category: 'navigate', keywords: ['cardapio','menu','itens','pratos'] },
  { id: 'nav-financeiro',   label: 'Financeiro',   description: 'Contas a pagar e receber',     icon: DollarSign,       page: 'Financeiro',   category: 'navigate', keywords: ['financeiro','contas','caixa','receita','despesa','fluxo'] },
  { id: 'nav-relatorios',   label: 'Relatórios',   description: 'Análises e gráficos',          icon: BarChart3,        page: 'Relatórios',   category: 'navigate', keywords: ['relatorios','analise','dre','graficos','exportar'] },
  { id: 'nav-estoque',      label: 'Estoque',      description: 'Produtos e inventário',        icon: Package,          page: 'Estoque',      category: 'navigate', keywords: ['estoque','produtos','inventario','sku','barcode'] },
  { id: 'nav-nfse',         label: 'NFS-e',        description: 'Nota Fiscal de Serviço',       icon: FileCheck2,       page: 'NFSe',         category: 'navigate', keywords: ['nfse','nota fiscal servico','iss','servico'] },
  { id: 'nav-nfce',         label: 'NFC-e',        description: 'Nota Fiscal Consumidor',       icon: Receipt,          page: 'NFCe',         category: 'navigate', keywords: ['nfce','nota fiscal consumidor','cupom','pdv'] },
  { id: 'nav-nfe',          label: 'NF-e',         description: 'Nota Fiscal Eletrônica',       icon: FileText,         page: 'NFe',          category: 'navigate', keywords: ['nfe','nota fiscal','sefaz','danfe','xml'] },
  { id: 'nav-senhas',       label: 'Senhas',       description: 'Cofre de senhas da empresa',   icon: KeyRound,         page: 'Senhas',       category: 'navigate', keywords: ['senhas','cofre','passwords','credenciais'] },
  { id: 'nav-config',       label: 'Configurações',description: 'Empresa, usuários, fiscal',    icon: Settings,         page: 'Configurações',category: 'navigate', keywords: ['configuracoes','config','empresa','usuarios','perfil'] },
];

const CREATE_COMMANDS: CommandItem[] = [
  { id: 'create-cliente',     label: 'Novo Cliente',       description: 'Cadastrar novo cliente',          icon: Plus, page: 'Clientes',   category: 'create', keywords: ['novo cliente','cadastrar'] },
  { id: 'create-agendamento', label: 'Novo Agendamento',   description: 'Agendar atendimento',             icon: Plus, page: 'Agenda',     category: 'create', keywords: ['novo agendamento','agendar'] },
  { id: 'create-venda',       label: 'Nova Venda (PDV)',   description: 'Abrir PDV para nova venda',       icon: Plus, page: 'PDV',        category: 'create', keywords: ['nova venda','pdv','vender'] },
  { id: 'create-produto',     label: 'Novo Produto',       description: 'Cadastrar produto no estoque',    icon: Plus, page: 'Estoque',    category: 'create', keywords: ['novo produto','estoque','sku'] },
  { id: 'create-financeiro',  label: 'Nova Transação',     description: 'Lançar receita ou despesa',       icon: Plus, page: 'Financeiro', category: 'create', keywords: ['nova transacao','receita','despesa','lancamento'] },
];

// ---------------------------------------------------------------------------
// Category labels
// ---------------------------------------------------------------------------
const CATEGORY_META: Record<string, { label: string; icon: React.ElementType }> = {
  recent:        { label: 'Recentes',       icon: Clock      },
  search_result: { label: 'Registros',      icon: Hash       },
  navigate:      { label: 'Navegar',        icon: Navigation },
  create:        { label: 'Criar',          icon: Pencil     },
};

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------
function normalize(str: string): string {
  return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <span>{text}</span>;
  const normalizedText = normalize(text);
  const normalizedQuery = normalize(query);
  const index = normalizedText.indexOf(normalizedQuery);
  if (index === -1) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, index)}
      <mark className="bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 rounded-sm px-px font-semibold not-italic">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Recent searches (localStorage)
// ---------------------------------------------------------------------------
const RECENT_KEY = 'cmd-palette-recent-saas-erp';
const MAX_RECENT = 5;

function getRecentItems(): { label: string; page: MenuPage; type?: string }[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch { return []; }
}

function addRecentItem(item: { label: string; page: MenuPage; type?: string }) {
  try {
    const recent = getRecentItems().filter(r => r.page !== item.page || r.label !== item.label);
    recent.unshift(item);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Firestore search
// ---------------------------------------------------------------------------
async function searchFirestore(term: string, businessId: string): Promise<FirestoreResult[]> {
  const norm = normalize(term);
  const results: FirestoreResult[] = [];

  const [clientSnap, productSnap, appointmentSnap, contactSnap] = await Promise.all([
    getDocs(query(collection(db, 'clients'),      where('businessId','==',businessId), limit(60))),
    getDocs(query(collection(db, 'products'),     where('businessId','==',businessId), limit(60))),
    getDocs(query(collection(db, 'appointments'), where('businessId','==',businessId), limit(60))),
    getDocs(query(collection(db, 'crmContacts'),  where('businessId','==',businessId), limit(60))),
  ]);

  for (const d of clientSnap.docs) {
    if (results.filter(r=>r.type==='client').length >= 5) break;
    const v = d.data();
    // Pula soft-deleted/merged — não devem aparecer no command palette de busca rápida.
    if (!isActiveClient(v)) continue;
    if (normalize(v.name||'').includes(norm) || normalize(v.cpfCnpj||'').includes(norm) || (v.phone||'').includes(term)) {
      results.push({ id: d.id, type: 'client', label: v.name, sublabel: v.cpfCnpj || v.phone, page: 'Clientes' });
    }
  }
  for (const d of productSnap.docs) {
    if (results.filter(r=>r.type==='product').length >= 5) break;
    const v = d.data();
    if (normalize(v.name||'').includes(norm) || normalize(v.sku||'').includes(norm)) {
      results.push({ id: d.id, type: 'product', label: v.name, sublabel: v.sku, page: 'Estoque' });
    }
  }
  for (const d of appointmentSnap.docs) {
    if (results.filter(r=>r.type==='appointment').length >= 5) break;
    const v = d.data();
    if (normalize(v.clientName||'').includes(norm) || normalize(v.serviceName||'').includes(norm)) {
      results.push({ id: d.id, type: 'appointment', label: v.clientName, sublabel: v.serviceName, page: 'Agenda' });
    }
  }
  for (const d of contactSnap.docs) {
    if (results.filter(r=>r.type==='contact').length >= 5) break;
    const v = d.data();
    if (normalize(v.name||'').includes(norm) || normalize(v.email||'').includes(norm) || (v.phone||'').includes(term)) {
      results.push({ id: d.id, type: 'contact', label: v.name, sublabel: v.email || v.phone, page: 'CRM' });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function CommandPalette() {
  const { business } = useAuth();
  const { openTab } = useTabContext();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [firestoreResults, setFirestoreResults] = React.useState<FirestoreResult[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);
  const [recentItems, setRecentItems] = React.useState<CommandItem[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const abortControllerRef = React.useRef<AbortController | null>(null);

  // Load recent on open
  React.useEffect(() => {
    if (!open) return;
    const recent = getRecentItems();
    setRecentItems(
      recent.map((r, i) => ({
        id: `recent-${i}`,
        label: r.label,
        description: r.type ? ENTITY_META[r.type]?.label : undefined,
        icon: r.type ? (ENTITY_META[r.type]?.icon ?? Clock) : Clock,
        page: r.page,
        category: 'recent' as const,
      }))
    );
  }, [open]);

  // Cmd+K toggle
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setOpen(p => !p); }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Reset on open/close
  React.useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setFirestoreResults([]);
      setIsSearching(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortControllerRef.current?.abort();
    }
  }, [open]);

  // Debounced Firestore search
  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortControllerRef.current?.abort();

    const trimmed = query.trim();
    if (trimmed.length < 2) { setFirestoreResults([]); setIsSearching(false); return; }
    if (!business?.id) return;

    setIsSearching(true);

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      try {
        const res = await searchFirestore(trimmed, business.id);
        if (!controller.signal.aborted) setFirestoreResults(res);
      } catch {
        // ignore
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 300);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, business?.id]);

  // Build item list
  const allItems = React.useMemo<CommandItem[]>(() => {
    const trimmed = query.trim();
    const items: CommandItem[] = [];

    if (!trimmed) {
      if (recentItems.length > 0) items.push(...recentItems);
      items.push(...NAV_COMMANDS, ...CREATE_COMMANDS);
      return items;
    }

    // Firestore results
    for (const r of firestoreResults) {
      const meta = ENTITY_META[r.type];
      items.push({
        id: `fs-${r.type}-${r.id}`,
        label: r.label,
        description: r.sublabel,
        icon: meta?.icon ?? Search,
        page: r.page,
        category: 'search_result',
        badge: meta?.label,
      });
    }

    // Filtered static commands
    const q = normalize(trimmed);
    const matched = [...NAV_COMMANDS, ...CREATE_COMMANDS].filter(cmd =>
      normalize(cmd.label).includes(q) ||
      (cmd.description && normalize(cmd.description).includes(q)) ||
      cmd.keywords?.some(k => normalize(k).includes(q))
    );
    items.push(...matched);

    return items;
  }, [query, firestoreResults, recentItems]);

  // Group by category
  const grouped = React.useMemo(() => {
    const g: Record<string, CommandItem[]> = {};
    for (const item of allItems) {
      if (!g[item.category]) g[item.category] = [];
      g[item.category].push(item);
    }
    return g;
  }, [allItems]);

  const handleSelect = (item: CommandItem) => {
    if (item.page) {
      openTab(item.page);
      if (item.category !== 'navigate') {
        addRecentItem({ label: item.label, page: item.page, type: item.category === 'search_result' ? Object.entries(ENTITY_META).find(([,v])=>v.label===item.badge)?.[0] : undefined });
      }
    }
    if (item.action) item.action();
    setOpen(false);
  };

  const scrollIntoView = (index: number) => {
    if (!listRef.current) return;
    listRef.current.querySelectorAll('[data-cmd-item]')[index]?.scrollIntoView({ block: 'nearest' });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => { const n = Math.min(i+1, allItems.length-1); scrollIntoView(n); return n; }); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIndex(i => { const n = Math.max(i-1, 0); scrollIntoView(n); return n; }); }
    if (e.key === 'Enter' && allItems[selectedIndex]) handleSelect(allItems[selectedIndex]);
  };

  React.useEffect(() => { setSelectedIndex(0); }, [allItems.length]);

  // Category order
  const categoryOrder = ['recent', 'search_result', 'navigate', 'create'];
  const sortedGroups = Object.entries(grouped).sort(([a],[b]) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b));

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)}>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/50 dark:bg-black/65"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />

          {/* Modal */}
          <div
            className="fixed top-[13%] left-1/2 -translate-x-1/2 w-full max-w-2xl px-4"
            onClick={e => e.stopPropagation()}
          >
            <motion.div
              className="bg-white dark:bg-[#1a2234] border border-gray-200/80 dark:border-gray-700/50 rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.25)] dark:shadow-[0_25px_60px_rgba(0,0,0,0.6)] overflow-hidden"
              initial={{ opacity: 0, y: -16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.97 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            >
              {/* Search input */}
              <div className="flex items-center gap-3 px-4 border-b border-gray-200/60 dark:border-gray-700/50">
                {isSearching
                  ? <Loader2 className="h-4.5 w-4.5 text-red-500 flex-shrink-0 animate-spin" />
                  : <Search className="h-[18px] w-[18px] text-gray-400 dark:text-gray-500 flex-shrink-0" />
                }
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
                  onKeyDown={handleKeyDown}
                  placeholder="Buscar páginas, clientes, produtos, agendamentos..."
                  className="flex-1 h-14 bg-transparent text-gray-900 dark:text-gray-100 text-[15px] placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none"
                />
                <kbd className="hidden sm:inline-flex items-center px-2 py-0.5 text-[10px] font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-md">
                  ESC
                </kbd>
              </div>

              {/* Results */}
              <div ref={listRef} className="max-h-[420px] overflow-auto py-1.5">
                {allItems.length === 0 && !isSearching ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center gap-2 px-4 py-10 text-center"
                  >
                    <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-1">
                      <Search className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                    </div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Nenhum resultado para &ldquo;{query}&rdquo;</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">Tente outro termo</p>
                  </motion.div>
                ) : (
                  sortedGroups.map(([category, items]) => {
                    const meta = CATEGORY_META[category] ?? { label: category, icon: Search };
                    const CategoryIcon = meta.icon;
                    return (
                      <div key={category}>
                        <div className="flex items-center gap-2 px-4 py-1.5 mt-0.5">
                          <CategoryIcon className="h-3 w-3 text-gray-400 dark:text-gray-500" />
                          <span className="text-[10.5px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                            {meta.label}
                          </span>
                        </div>

                        {items.map(item => {
                          const globalIndex = allItems.indexOf(item);
                          const isSelected = globalIndex === selectedIndex;
                          const Icon = item.icon;
                          const entityMeta = item.badge ? Object.entries(ENTITY_META).find(([,v])=>v.label===item.badge)?.[1] : null;
                          const isSearchResult = item.category === 'search_result';

                          const iconColor = isSearchResult && entityMeta ? entityMeta.color : 'text-red-600 dark:text-red-400';
                          const iconBg    = isSearchResult && entityMeta ? entityMeta.bg    : 'bg-red-50 dark:bg-red-500/10';
                          const createIconBg = item.category === 'create' ? 'bg-amber-50 dark:bg-amber-500/10' : iconBg;
                          const createIconColor = item.category === 'create' ? 'text-amber-600 dark:text-amber-400' : iconColor;

                          return (
                            <button
                              key={item.id}
                              data-cmd-item
                              onClick={() => handleSelect(item)}
                              onMouseEnter={() => setSelectedIndex(globalIndex)}
                              className={cn(
                                'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all duration-100 relative',
                                isSelected
                                  ? 'bg-red-600 dark:bg-red-600 text-white'
                                  : 'text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                              )}
                            >
                              {isSelected && (
                                <motion.div
                                  layoutId="cmd-sel"
                                  className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-white/60"
                                  transition={{ duration: 0.12 }}
                                />
                              )}

                              <div className={cn(
                                'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors',
                                isSelected ? 'bg-white/20' : (item.category === 'create' ? createIconBg : iconBg)
                              )}>
                                <Icon className={cn('h-3.5 w-3.5', isSelected ? 'text-white' : (item.category === 'create' ? createIconColor : iconColor))} />
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={cn('text-sm font-medium leading-tight truncate', isSelected ? 'text-white' : '')}>
                                    <HighlightMatch text={item.label} query={isSelected ? '' : query} />
                                  </span>
                                  {item.badge && (
                                    <span className={cn('flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded', isSelected ? 'bg-white/20 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400')}>
                                      {item.badge}
                                    </span>
                                  )}
                                </div>
                                {item.description && (
                                  <span className={cn('block text-xs leading-tight mt-0.5 truncate', isSelected ? 'text-white/70' : 'text-gray-400 dark:text-gray-500')}>
                                    <HighlightMatch text={item.description} query={isSelected ? '' : query} />
                                  </span>
                                )}
                              </div>

                              <motion.div
                                animate={{ opacity: isSelected ? 1 : 0, x: isSelected ? 0 : -4 }}
                                transition={{ duration: 0.12 }}
                                className="flex-shrink-0"
                              >
                                <ArrowRight className="h-3.5 w-3.5" />
                              </motion.div>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })
                )}

                {isSearching && firestoreResults.length === 0 && query.trim().length >= 2 && (
                  <div className="flex items-center gap-2 px-4 py-3">
                    <Loader2 className="h-4 w-4 text-gray-400 dark:text-gray-500 animate-spin" />
                    <span className="text-sm text-gray-400 dark:text-gray-500">Buscando registros...</span>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="border-t border-gray-200/60 dark:border-gray-700/50 px-4 py-2 flex items-center gap-4 text-xs text-gray-400 dark:text-gray-500">
                <span className="flex items-center gap-1.5">
                  <kbd className="inline-flex items-center justify-center w-5 h-5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-[10px] font-medium">&uarr;&darr;</kbd>
                  <span>navegar</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <kbd className="inline-flex items-center justify-center w-5 h-5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-[10px] font-medium">&crarr;</kbd>
                  <span>abrir</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <kbd className="inline-flex items-center px-1.5 h-5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-[10px] font-medium">esc</kbd>
                  <span>fechar</span>
                </span>
                <span className="ml-auto">
                  {query.trim().length >= 2 && firestoreResults.length > 0
                    ? `${firestoreResults.length} registro${firestoreResults.length!==1?'s':''} · `
                    : ''}
                  {allItems.filter(f=>f.category!=='search_result'&&f.category!=='recent').length} comandos
                </span>
              </div>
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
}
