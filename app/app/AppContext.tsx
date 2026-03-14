'use client';

import { createContext, useContext } from 'react';
import type { MenuPage } from '@/app/components/layout/Sidebar';

interface AppContextType {
  activePage: MenuPage;
  setActivePage: (page: MenuPage) => void;
}

export const AppContext = createContext<AppContextType>({
  activePage: 'Dashboard',
  setActivePage: () => {},
});

export const useAppContext = () => useContext(AppContext);
