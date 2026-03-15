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
    <div className="min-h-screen flex bg-gradient-to-br from-gray-50 to-gray-100 dark:from-[#0B0F19] dark:to-[#0d1117]">
      <div className="hidden lg:block w-[260px] bg-white dark:bg-[#0a0e17] border-r border-gray-100 dark:border-gray-800/60 flex-shrink-0">
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3 h-[60px]">
            <div className="w-8 h-8 rounded-xl shimmer" />
            <div className="w-24 h-4 rounded-lg shimmer" />
          </div>
          <div className="w-full h-10 rounded-xl shimmer" />
          <div className="pt-3 space-y-1.5">
            {[80, 65, 70, 55, 75, 60].map((w, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl">
                <div className="w-5 h-5 rounded-lg shimmer flex-shrink-0" />
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
      <div className="min-h-screen flex bg-gradient-to-br from-gray-50 to-gray-100 dark:from-[#0B0F19] dark:to-[#0d1117]">
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
                initial={{ opacity: 0, y: 10, filter: 'blur(2px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -6, filter: 'blur(2px)' }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
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
