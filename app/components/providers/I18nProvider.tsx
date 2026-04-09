'use client';

import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/lib/i18n/i18n';
import { useAuth } from './AuthProvider';

export default function I18nProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  // Sync language from user profile on mount / user change
  useEffect(() => {
    const savedLang = user?.language;
    if (savedLang && i18n.language !== savedLang) {
      i18n.changeLanguage(savedLang);
    }
  }, [user?.language]);

  return (
    <I18nextProvider i18n={i18n}>
      {children}
    </I18nextProvider>
  );
}
