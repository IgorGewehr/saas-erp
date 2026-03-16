'use client';

import { createContext, useContext, useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import { createTheme, ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

// ─── Types ─────────────────────────────────────────────
export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextType {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  mode: 'system',
  setMode: () => {},
  isDark: false,
});

export const useTheme = () => useContext(ThemeContext);

// ─── Shared MUI Config ─────────────────────────────────
const typography = {
  fontFamily: '"Inter", "Helvetica", "Arial", sans-serif',
  h1: { fontFamily: '"Plus Jakarta Sans", sans-serif', fontWeight: 700 },
  h2: { fontFamily: '"Plus Jakarta Sans", sans-serif', fontWeight: 700 },
  h3: { fontFamily: '"Plus Jakarta Sans", sans-serif', fontWeight: 600 },
  h4: { fontFamily: '"Plus Jakarta Sans", sans-serif', fontWeight: 600 },
  h5: { fontFamily: '"Plus Jakarta Sans", sans-serif', fontWeight: 600 },
  h6: { fontFamily: '"Plus Jakarta Sans", sans-serif', fontWeight: 600 },
  button: { textTransform: 'none' as const, fontWeight: 500 },
};

const baseComponents = {
  MuiButton: {
    styleOverrides: {
      root: {
        borderRadius: 10,
        padding: '8px 20px',
        boxShadow: 'none',
        '&:hover': { boxShadow: 'none' },
      },
    },
  },
  MuiTextField: {
    styleOverrides: {
      root: {
        '& .MuiOutlinedInput-root': { borderRadius: 10 },
      },
    },
  },
  MuiDialog: {
    styleOverrides: {
      paper: { borderRadius: 16 },
    },
  },
  MuiChip: {
    styleOverrides: {
      root: { borderRadius: 8, fontWeight: 500 },
    },
  },
};

// ─── Light Theme ────────────────────────────────────────
const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#DC2626', light: '#EF4444', dark: '#B91C1C', contrastText: '#ffffff' },
    secondary: { main: '#6366F1', light: '#818CF8', dark: '#4F46E5' },
    error: { main: '#EF4444' },
    warning: { main: '#F59E0B' },
    success: { main: '#10B981' },
    info: { main: '#3B82F6' },
    background: { default: '#F8FAFC', paper: '#FFFFFF' },
    text: { primary: '#0F172A', secondary: '#64748B' },
  },
  typography,
  shape: { borderRadius: 12 },
  components: {
    ...baseComponents,
    MuiPaper: {
      styleOverrides: {
        root: {
          boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
        },
      },
    },
  },
});

// ─── Dark Theme ─────────────────────────────────────────
const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#EF4444', light: '#F87171', dark: '#DC2626', contrastText: '#ffffff' },
    secondary: { main: '#818CF8', light: '#A5B4FC', dark: '#6366F1' },
    error: { main: '#F87171' },
    warning: { main: '#FBBF24' },
    success: { main: '#34D399' },
    info: { main: '#60A5FA' },
    background: { default: '#0B0F19', paper: '#111827' },
    text: { primary: '#F1F5F9', secondary: '#94A3B8' },
    divider: 'rgba(148, 163, 184, 0.12)',
  },
  typography,
  shape: { borderRadius: 12 },
  components: {
    ...baseComponents,
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.3), 0 1px 2px -1px rgb(0 0 0 / 0.2)',
          border: '1px solid rgba(148, 163, 184, 0.08)',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 16,
          backgroundImage: 'none',
          backgroundColor: '#111827',
          border: '1px solid rgba(148, 163, 184, 0.1)',
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          backgroundImage: 'none',
          backgroundColor: '#1E293B',
          border: '1px solid rgba(148, 163, 184, 0.1)',
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#1E293B',
          border: '1px solid rgba(148, 163, 184, 0.1)',
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(148, 163, 184, 0.15)',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(148, 163, 184, 0.25)',
          },
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        icon: { color: '#94A3B8' },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottomColor: 'rgba(148, 163, 184, 0.08)',
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: 'rgba(148, 163, 184, 0.1)',
        },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        track: {
          backgroundColor: '#334155',
        },
      },
    },
  },
});

// ─── Provider ───────────────────────────────────────────
function getInitialMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  const saved = localStorage.getItem('theme-mode') as ThemeMode | null;
  return saved && ['light', 'dark', 'system'].includes(saved) ? saved : 'system';
}

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(getInitialMode);
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const [mounted, setMounted] = useState(false);

  // Listen for system preference changes + mark mounted
  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mq.matches);
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const isDark = mode === 'dark' || (mode === 'system' && systemDark);

  // Apply .dark class and persist preference
  useEffect(() => {
    if (!mounted) return;
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('theme-mode', mode);
  }, [isDark, mode, mounted]);

  const handleSetMode = useCallback((m: ThemeMode) => setMode(m), []);

  const ctx = useMemo<ThemeContextType>(
    () => ({ mode, setMode: handleSetMode, isDark }),
    [mode, handleSetMode, isDark],
  );

  return (
    <ThemeContext.Provider value={ctx}>
      <MuiThemeProvider theme={isDark ? darkTheme : lightTheme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
}
