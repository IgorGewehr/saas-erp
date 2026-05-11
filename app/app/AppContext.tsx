'use client';

import { createContext, useContext } from 'react';
import type { MenuPage } from '@/app/components/layout/Sidebar';

/**
 * Intent de abrir uma conversa NOVA com pré-fill — usado quando o operador
 * clica em "Iniciar conversa" no card de canal do detalhe do cliente.
 */
export interface PendingNewConversation {
  clientId: string;
  channel: 'whatsapp' | 'facebook' | 'instagram';
  /** Só quando channel='whatsapp' — qual transporte foi escolhido. */
  whatsappMode?: 'cloud' | 'baileys';
}

interface AppContextType {
  activePage: MenuPage;
  setActivePage: (page: MenuPage) => void;
  sidebarCollapsed: boolean;
  /**
   * Quando setado, ConversasModule abre essa conversa existente automaticamente
   * no mount/load. ConversasModule limpa o valor após consumir (uso one-shot).
   */
  pendingOpenConversationId: string | null;
  setPendingOpenConversationId: (id: string | null) => void;
  /**
   * Quando setado, ConversasModule abre o NewConversationDialog pré-preenchido
   * com cliente + canal + modo WA. Limpa após consumir.
   */
  pendingNewConversation: PendingNewConversation | null;
  setPendingNewConversation: (v: PendingNewConversation | null) => void;
  /**
   * Quando setado, ClientsModule abre o painel de detalhe do cliente
   * automaticamente. Usado pelo "Vincular cliente" do header da conversa
   * (clicar no card do cliente vinculado pula pro detalhe). Limpa após consumir.
   */
  pendingOpenClientId: string | null;
  setPendingOpenClientId: (id: string | null) => void;
}

export const AppContext = createContext<AppContextType>({
  activePage: 'Dashboard',
  setActivePage: () => {},
  sidebarCollapsed: false,
  pendingOpenConversationId: null,
  setPendingOpenConversationId: () => {},
  pendingNewConversation: null,
  setPendingNewConversation: () => {},
  pendingOpenClientId: null,
  setPendingOpenClientId: () => {},
});

export const useAppContext = () => useContext(AppContext);
