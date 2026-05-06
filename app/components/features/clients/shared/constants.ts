/**
 * Constantes de display do módulo Clientes.
 *
 * Compartilhadas entre ClientsModule (lista, filtros), ClientForm,
 * ExportModal/ImportModal e ClientDetailPanel pra que rótulos e cores fiquem
 * consistentes em todos os lugares. Movidas pra um módulo separado durante a
 * Fase 1 da modularização — antes estavam inline em ClientsModule.tsx mas
 * referenciadas em pelo menos 4 sub-componentes que agora vivem em arquivos
 * próprios.
 */

import type { LeadStatus, LeadSource } from '@/lib/types';

export const STATUS_CONFIG: Record<LeadStatus, { label: string; color: string; dot: string }> = {
  novo:         { label: 'Novo',        color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',     dot: 'bg-blue-400' },
  contatado:    { label: 'Contatado',   color: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300', dot: 'bg-purple-400' },
  qualificado:  { label: 'Qualificado', color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',     dot: 'bg-amber-400' },
  proposta:     { label: 'Proposta',    color: 'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300',         dot: 'bg-pink-400' },
  negociacao:   { label: 'Negociação',  color: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300', dot: 'bg-orange-400' },
  ganho:        { label: 'Cliente',     color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300', dot: 'bg-emerald-400' },
  perdido:      { label: 'Inativo',     color: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',           dot: 'bg-red-400' },
};

export const SOURCE_LABELS: Record<LeadSource, string> = {
  site: 'Site', indicacao: 'Indicação', whatsapp: 'WhatsApp',
  instagram: 'Instagram', facebook: 'Facebook', google_ads: 'Google Ads',
  linkedin: 'LinkedIn', evento: 'Evento', email: 'E-mail', telefone: 'Telefone', outro: 'Outro',
};

export const TIPO_LABELS = { pf: 'Pessoa Física', pj: 'Pessoa Jurídica' } as const;
