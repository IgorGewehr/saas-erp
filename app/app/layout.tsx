'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { AIAgentProvider } from '@/app/components/providers/AIAgentProvider';
import { useNotificationAlerts } from '@/lib/hooks/useNotificationAlerts';
import { useConversationsAlerts } from '@/lib/hooks/useConversationsAlerts';
import Sidebar, { type MenuPage } from '@/app/components/layout/Sidebar';
import TopBar from '@/app/components/layout/TopBar';
import { TabProvider, useTabContext } from '@/app/components/layout/TabContext';
import { TabBar } from '@/app/components/layout/TabBar';
import { CommandPalette } from '@/app/components/layout/CommandPalette';
import { AppContext, type PendingNewConversation } from './AppContext';

// ─── Loading skeleton ────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div className="min-h-screen flex bg-gradient-to-br from-gray-50 to-gray-100 dark:from-[#0B0F19] dark:to-[#0d1117]">
      <div className="hidden lg:block w-[264px] bg-white dark:bg-[#0a0e17] border-r border-gray-100 dark:border-gray-800/60 flex-shrink-0">
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3 h-[60px]">
            <div className="w-8 h-8 rounded-xl shimmer" />
            <div className="w-24 h-4 rounded-lg shimmer" />
          </div>
          <div className="pt-3 space-y-1.5">
            {[80, 65, 70, 55, 75, 60, 68, 72].map((w, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl">
                <div className="w-[18px] h-[18px] rounded-lg shimmer flex-shrink-0" />
                <div className="h-3.5 rounded-lg shimmer" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1">
        <div className="h-[60px] bg-white/80 dark:bg-[#0a0e17]/80 backdrop-blur-xl border-b border-gray-100 dark:border-gray-800/50 flex items-center px-6 gap-4">
          <div className="w-36 h-5 rounded-lg shimmer" />
          <div className="ml-auto flex items-center gap-3">
            <div className="w-48 h-9 rounded-xl shimmer hidden md:block" />
            <div className="w-9 h-9 rounded-xl shimmer" />
            <div className="w-28 h-9 rounded-xl shimmer hidden sm:block" />
          </div>
        </div>
        <div className="p-6 space-y-6">
          <div className="h-8 w-48 rounded-lg shimmer" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 rounded-xl shimmer" />
            ))}
          </div>
          <div className="h-72 rounded-xl shimmer" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-48 rounded-xl shimmer" />
            <div className="h-48 rounded-xl shimmer" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Navigation progress bar ─────────────────────────────────────────────────
function NavProgress({ trigger }: { trigger: string }) {
  return (
    <motion.div
      key={trigger}
      initial={{ scaleX: 0, opacity: 1 }}
      animate={{ scaleX: 1, opacity: 0 }}
      transition={{
        scaleX: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
        opacity: { duration: 0.3, delay: 0.42 },
      }}
      style={{ transformOrigin: 'left center' }}
      className="absolute top-0 left-0 right-0 h-[2px] z-50 pointer-events-none nav-progress-bar"
    />
  );
}

// ─── Ambient background ───────────────────────────────────────────────────────
function AmbientBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0" aria-hidden>
      <motion.div
        className="absolute rounded-full"
        style={{ width: 700, height: 700, top: '-15%', right: '-10%', background: 'radial-gradient(circle, rgba(220,38,38,1) 0%, transparent 68%)', opacity: 0 }}
        animate={{ opacity: [0.03, 0.055, 0.03], x: [0, 28, -12, 0], y: [0, -18, 26, 0] }}
        transition={{ duration: 28, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute rounded-full"
        style={{ width: 500, height: 500, bottom: '5%', left: '10%', background: 'radial-gradient(circle, rgba(244,63,94,1) 0%, transparent 68%)', opacity: 0 }}
        animate={{ opacity: [0.02, 0.04, 0.02], x: [0, -18, 10, 0], y: [0, 14, -22, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut', delay: 9 }}
      />
      <div
        className="absolute inset-0 opacity-[0.018] dark:opacity-[0.035]"
        style={{ backgroundImage: 'radial-gradient(circle, #94a3b8 1px, transparent 1px)', backgroundSize: '32px 32px' }}
      />
    </div>
  );
}

// ─── Inner layout — uses TabContext ───────────────────────────────────────────
function AppLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthReady, isLoading, business, firebaseUser } = useAuth();
  const { openTab, activeTabId } = useTabContext();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const waRestored = useRef(false);

  // Mountados em UM lugar só — duplicar dispararia dings duplos.
  useNotificationAlerts();
  useConversationsAlerts();

  // activePage is always derived from the active tab
  const activePage = (activeTabId ?? 'Dashboard') as MenuPage;

  useEffect(() => {
    if (isAuthReady && !firebaseUser) router.replace('/login');
  }, [isAuthReady, firebaseUser, router]);

  // Auto-restore WhatsApp Baileys session after server restart.
  // Verifica AMBOS os campos:
  //   - channels.whatsappBaileys (campo atual, escrito pelo baileys-manager)
  //   - channels.whatsapp + connectedVia==='baileys' (legado, manter compat)
  // Sem isso, restart do dev server deixa a sessão fora da memória e
  // qualquer envio falha com "WhatsApp Web não está conectado".
  useEffect(() => {
    if (!firebaseUser || !business?.id || waRestored.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const channels = (business as any)?.channels as Record<string, { isConnected?: boolean; connectedVia?: string }> | undefined;
    const baileys = channels?.whatsappBaileys;
    const legacy = channels?.whatsapp;
    const isBaileysConnected = baileys?.isConnected === true
      || (legacy?.isConnected === true && legacy?.connectedVia === 'baileys');
    if (!isBaileysConnected) return;
    waRestored.current = true;
    (async () => {
      try {
        const token = await firebaseUser.getIdToken();
        await fetch('/api/whatsapp/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ businessId: business.id }),
        });
      } catch { /* silent — restore is best-effort */ }
    })();
  }, [firebaseUser, business]);

  const handleMenuSelect = (page: MenuPage) => {
    openTab(page);
    setMobileMenuOpen(false);
  };

  // Intents de navegação cross-module — ChannelsTab seta, ConversasModule consome.
  // One-shot: ConversasModule limpa após processar pra evitar re-trigger em re-renders.
  const [pendingOpenConversationId, setPendingOpenConversationId] = useState<string | null>(null);
  const [pendingNewConversation, setPendingNewConversation] = useState<PendingNewConversation | null>(null);

  if (!isAuthReady || isLoading || !firebaseUser) return <LoadingSkeleton />;

  return (
    <AppContext.Provider value={{
      activePage,
      setActivePage: handleMenuSelect,
      sidebarCollapsed,
      pendingOpenConversationId,
      setPendingOpenConversationId,
      pendingNewConversation,
      setPendingNewConversation,
    }}>
      <AIAgentProvider>
      <AmbientBackground />

      {/* Global command palette — listens to Cmd+K globally */}
      <CommandPalette />

      <div className="relative h-screen flex overflow-hidden bg-gradient-to-br from-gray-50/90 to-gray-100/90 dark:from-[#0B0F19]/95 dark:to-[#0d1117]/95 z-10">
        <Sidebar
          activePage={activePage}
          onMenuSelect={handleMenuSelect}
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(v => !v)}
          isMobileOpen={mobileMenuOpen}
          onMobileClose={() => setMobileMenuOpen(false)}
        />

        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <TopBar
            onMobileMenuToggle={() => setMobileMenuOpen(!mobileMenuOpen)}
            onNavigate={handleMenuSelect}
          />

          {/* Safari-inspired tab bar */}
          <TabBar />

          <main className="relative flex-1 min-h-0 overflow-hidden">
            <NavProgress trigger={activePage} />
            {children}
          </main>
        </div>
      </div>
      </AIAgentProvider>
    </AppContext.Provider>
  );
}

// ─── Root layout — provides TabContext ────────────────────────────────────────
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <TabProvider>
      <AppLayoutContent>{children}</AppLayoutContent>
    </TabProvider>
  );
}
