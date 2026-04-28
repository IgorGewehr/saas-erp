'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useTabContext, type Tab } from '@/app/components/layout/TabContext';
import { useAppContext } from '@/app/app/AppContext';
import type { MenuPage } from '@/app/components/layout/Sidebar';

// Safari-inspired tab bar — sticky between TopBar and main content
export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, closeOtherTabs } = useTabContext();
  const { setActivePage } = useAppContext();

  const [ctxMenu, setCtxMenu] = React.useState<{ x: number; y: number; tabId: MenuPage } | null>(null);

  React.useEffect(() => {
    if (!ctxMenu) return;
    const handler = () => setCtxMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [ctxMenu]);

  const handleTabClick = React.useCallback((tab: Tab) => {
    if (tab.id === activeTabId) return;
    setActiveTab(tab.id);
    setActivePage(tab.id);
  }, [activeTabId, setActiveTab, setActivePage]);

  const handleClose = React.useCallback((e: React.MouseEvent, tabId: MenuPage) => {
    e.stopPropagation();
    if (tabId === activeTabId) {
      const idx = tabs.findIndex(t => t.id === tabId);
      const remaining = tabs.filter(t => t.id !== tabId);
      if (remaining.length > 0) {
        const newIdx = Math.min(idx, remaining.length - 1);
        setActivePage(remaining[newIdx].id);
      }
    }
    closeTab(tabId);
  }, [activeTabId, tabs, closeTab, setActivePage]);

  const handleContextMenu = React.useCallback((e: React.MouseEvent, tabId: MenuPage) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, tabId });
  }, []);

  const handleCloseOthers = React.useCallback((tabId: MenuPage) => {
    if (tabId !== activeTabId) {
      setActivePage(tabId);
      setActiveTab(tabId);
    }
    closeOtherTabs(tabId);
    setCtxMenu(null);
  }, [activeTabId, closeOtherTabs, setActivePage, setActiveTab]);

  if (tabs.length <= 1) return null;

  const activeIdx = tabs.findIndex(t => t.id === activeTabId);

  return (
    <>
      {/* ── Tab Bar ── */}
      <div className="relative z-[40] flex items-stretch h-[34px] bg-gray-100/80 dark:bg-[#080c14]/90 border-b border-gray-200/60 dark:border-gray-800/50 overflow-x-auto px-1 flex-shrink-0" style={{ scrollbarWidth: 'none' }}>
        <AnimatePresence initial={false} mode="popLayout">
          {tabs.map((tab, i) => {
            const isActive = tab.id === activeTabId;
            const isBeforeActive = i === activeIdx - 1;
            const isLast = i === tabs.length - 1;
            const showSeparator = !isActive && !isBeforeActive && !isLast;

            return (
              <motion.div
                key={tab.id}
                layout
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{
                  layout: { duration: 0.22, ease: [0.25, 1, 0.5, 1] },
                  opacity: { duration: 0.15 },
                  width: { duration: 0.22 },
                }}
                className={cn('relative flex-1 min-w-0', isActive ? 'z-10' : 'z-0')}
                style={{ maxWidth: `${100 / Math.min(tabs.length, 6)}%` }}
              >
                <button
                  onClick={() => handleTabClick(tab)}
                  onContextMenu={(e) => handleContextMenu(e, tab.id)}
                  title={tab.title}
                  className={cn(
                    'group relative flex items-center w-full h-full select-none transition-all duration-150',
                    isActive
                      ? 'rounded-t-[9px]'
                      : 'rounded-t-[9px] hover:bg-white/40 dark:hover:bg-white/[0.04] active:bg-white/60 dark:active:bg-white/[0.07]'
                  )}
                >
                  {/* Active tab card — Safari style */}
                  {isActive && (
                    <>
                      <div className="absolute inset-0 rounded-t-[9px] bg-white shadow-[0_-1px_3px_rgba(0,0,0,0.06),0_1px_0px_rgba(255,255,255,1)] dark:bg-[#0a0e17] dark:shadow-[0_-1px_4px_rgba(0,0,0,0.3)]" />
                      <div className="absolute inset-0 rounded-t-[9px] bg-red-500/[0.03] dark:bg-red-400/[0.06]" />
                      <div className="absolute inset-x-0 top-0 h-px bg-red-500/20 dark:bg-red-400/20 rounded-t-[9px]" />
                    </>
                  )}

                  {/* Content */}
                  <div className="relative flex items-center w-full h-full pl-3 pr-1.5 gap-1">
                    <span className={cn(
                      'truncate text-[12px] leading-none flex-1 text-center',
                      isActive
                        ? 'text-red-700 dark:text-red-400 font-semibold'
                        : 'text-gray-500 dark:text-gray-500 group-hover:text-gray-700 dark:group-hover:text-gray-400'
                    )}>
                      {tab.title}
                    </span>

                    {tabs.length > 1 && (
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => handleClose(e, tab.id)}
                        className={cn(
                          'flex items-center justify-center h-[16px] w-[16px] rounded-md shrink-0 ml-auto transition-all duration-100',
                          isActive
                            ? 'text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-500/10'
                            : 'text-gray-400 opacity-0 group-hover:opacity-70 hover:!opacity-100 hover:text-red-500 hover:bg-red-500/10'
                        )}
                      >
                        <X className="h-[10px] w-[10px]" strokeWidth={2.5} />
                      </span>
                    )}
                  </div>
                </button>

                {/* Separator (hidden adjacent to active) */}
                {showSeparator && (
                  <div className="absolute right-0 top-[7px] bottom-[3px] w-px bg-gray-300/60 dark:bg-gray-700/60" />
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* ── Context menu ── */}
      <AnimatePresence>
        {ctxMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.12 }}
            className="fixed z-[250] bg-white dark:bg-[#1e293b] border border-gray-200/80 dark:border-gray-700/50 rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.14)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.5)] p-1 min-w-[180px]"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <button
              onClick={() => { handleClose({ stopPropagation: () => {} } as React.MouseEvent, ctxMenu.tabId); setCtxMenu(null); }}
              disabled={tabs.length <= 1}
              className="w-full text-left px-3 py-1.5 text-sm rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              Fechar aba
            </button>
            <button
              onClick={() => handleCloseOthers(ctxMenu.tabId)}
              disabled={tabs.length <= 1}
              className="w-full text-left px-3 py-1.5 text-sm rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              Fechar outras abas
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
