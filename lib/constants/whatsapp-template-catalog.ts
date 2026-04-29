/**
 * Catálogo de templates Aevo recomendados para aprovação no WhatsApp Business.
 *
 * Como funciona: o cliente copia nome + conteúdo daqui, vai ao WhatsApp Manager
 * (https://business.facebook.com/wa/manage/message-templates/) e submete para
 * aprovação na própria WABA. Templates utility costumam ser aprovados em minutos.
 *
 * Esses templates não dependem de scope `whatsapp_business_management` (que a Meta
 * negou no app review). Após aprovação, aparecem automaticamente em
 * `/api/channels/whatsapp-templates` e ficam utilizáveis no envio.
 */

export type TemplateCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';

export interface RecommendedTemplate {
  /** Nome em snake_case que será usado no WhatsApp Manager. */
  name: string;
  category: TemplateCategory;
  language: string;
  body: string;
  description: string;
  /** Exemplos para preencher o preview localmente. */
  variableExamples: string[];
}

export const WHATSAPP_TEMPLATE_CATALOG: RecommendedTemplate[] = [
  {
    name: 'aevo_boas_vindas',
    category: 'UTILITY',
    language: 'pt_BR',
    body: 'Olá {{1}}! Bem-vindo(a) à {{2}}. Como podemos ajudar você hoje?',
    description: 'Mensagem inicial para novos contatos',
    variableExamples: ['João', 'Empresa X'],
  },
  {
    name: 'aevo_confirmacao_agendamento',
    category: 'UTILITY',
    language: 'pt_BR',
    body: 'Olá {{1}}! Seu agendamento foi confirmado para {{2}} às {{3}}.',
    description: 'Confirmação automática de agendamento',
    variableExamples: ['Maria', '15/05/2026', '14:30'],
  },
  {
    name: 'aevo_lembrete_agendamento',
    category: 'UTILITY',
    language: 'pt_BR',
    body: 'Lembrete: você tem um agendamento {{1}} às {{2}}. Em caso de imprevisto, nos avise.',
    description: 'Lembrete automático 24h antes do horário',
    variableExamples: ['amanhã', '10:00'],
  },
  {
    name: 'aevo_confirmacao_pedido',
    category: 'UTILITY',
    language: 'pt_BR',
    body: 'Pedido #{{1}} confirmado. Total: {{2}}. Você receberá atualizações sobre o status em breve.',
    description: 'Confirmação de pedido criado',
    variableExamples: ['12345', 'R$ 89,90'],
  },
  {
    name: 'aevo_status_pedido',
    category: 'UTILITY',
    language: 'pt_BR',
    body: 'Atualização do pedido #{{1}}: {{2}}.',
    description: 'Notificação de mudança de status',
    variableExamples: ['12345', 'A caminho'],
  },
  {
    name: 'aevo_pesquisa_satisfacao',
    category: 'UTILITY',
    language: 'pt_BR',
    body: 'Olá {{1}}, como foi sua experiência conosco? Sua opinião nos ajuda a melhorar.',
    description: 'Pesquisa de satisfação pós-atendimento (CSAT)',
    variableExamples: ['Ana'],
  },
  {
    name: 'aevo_cobranca_amigavel',
    category: 'UTILITY',
    language: 'pt_BR',
    body: 'Olá {{1}}, identificamos uma fatura em aberto: {{2}} (vence {{3}}). Caso já tenha pago, desconsidere.',
    description: 'Lembrete de cobrança amigável',
    variableExamples: ['Carlos', 'R$ 150,00', '20/05'],
  },
  {
    name: 'aevo_recuperacao_atendimento',
    category: 'UTILITY',
    language: 'pt_BR',
    body: 'Olá {{1}}, notamos que sua conversa ficou sem resposta. Ainda podemos ajudar com algo?',
    description: 'Reabertura de atendimento inativo',
    variableExamples: ['Pedro'],
  },
];

/** Renderiza preview do template substituindo {{N}} por valores. */
export function renderTemplatePreview(
  body: string,
  values: string[],
): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, idx) => values[Number(idx) - 1] ?? `{{${idx}}}`);
}

/** Conta variáveis únicas em um body de template. */
export function countTemplateVariables(body: string): number {
  const matches = body.match(/\{\{(\d+)\}\}/g) ?? [];
  return new Set(matches.map(m => m.replace(/[{}]/g, ''))).size;
}
