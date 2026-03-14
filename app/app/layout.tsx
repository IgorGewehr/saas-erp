'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/app/components/providers/AuthProvider';
import Sidebar, { type MenuPage } from '@/app/components/layout/Sidebar';
import TopBar from '@/app/components/layout/TopBar';
import { AppContext } from './AppContext';

function LoadingSkeleton() {
  return (
    <div className="min-h-screen flex bg-gray-50">
      <div className="hidden lg:block w-[260px] bg-white border-r border-gray-200 flex-shrink-0">
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gray-200 animate-pulse" />
            <div className="w-24 h-4 rounded bg-gray-200 animate-pulse" />
          </div>
          <div className="border-t border-gray-100 pt-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                <div className="w-5 h-5 rounded bg-gray-200 animate-pulse" />
                <div
                  className="h-3.5 rounded bg-gray-200 animate-pulse"
                  style={{ width: `${60 + Math.random() * 40}%` }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1">
        <div className="h-16 bg-white border-b border-gray-200 flex items-center px-6">
          <div className="w-32 h-5 rounded bg-gray-200 animate-pulse" />
          <div className="ml-auto flex items-center gap-3">
            <div className="w-56 h-9 rounded-xl bg-gray-100 animate-pulse hidden md:block" />
            <div className="w-9 h-9 rounded-xl bg-gray-100 animate-pulse" />
            <div className="w-9 h-9 rounded-lg bg-gray-200 animate-pulse" />
          </div>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-28 rounded-xl bg-white border border-gray-200 animate-pulse" />
            ))}
          </div>
          <div className="h-64 rounded-xl bg-white border border-gray-200 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activePage, setActivePage] = useState<MenuPage>('Dashboard');

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  const handleMenuSelect = (page: MenuPage) => {
    setActivePage(page);
    setMobileMenuOpen(false);
  };

  if (isLoading || !isAuthenticated) {
    return <LoadingSkeleton />;
  }

  return (
    <AppContext.Provider value={{ activePage, setActivePage: handleMenuSelect }}>
      <div className="min-h-screen flex bg-gray-50/50">
        <Sidebar
          activePage={activePage}
          onMenuSelect={handleMenuSelect}
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          isMobileOpen={mobileMenuOpen}
          onMobileClose={() => setMobileMenuOpen(false)}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <TopBar
            activePage={activePage}
            onMobileMenuToggle={() => setMobileMenuOpen(!mobileMenuOpen)}
            onNavigate={handleMenuSelect}
          />

          <main className="flex-1 overflow-x-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={activePage}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="h-full"
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </AppContext.Provider>
  );
}
