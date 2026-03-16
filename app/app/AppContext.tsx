'use client';

import { createContext, useContext } from 'react';
import type { MenuPage } from '@/app/components/layout/Sidebar';

interface AppContextType {
  activePage: MenuPage;
  setActivePage: (page: MenuPage) => void;
  sidebarCollapsed: boolean;
}

export const AppContext = createContext<AppContextType>({
  activePage: 'Dashboard',
  setActivePage: () => {},
  sidebarCollapsed: false,
});

export const useAppContext = () => useContext(AppContext);
