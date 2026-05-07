// ==========================================
// CORE TYPES - Service Provider Pro
// ==========================================

// ---- Auth & User Roles ----
export type UserRole = 'founder' | 'admin' | 'manager' | 'operator' | 'viewer';

// ---- User Status (manual presence mode) ----
export type UserStatus = 'online' | 'busy' | 'invisible' | 'offline';

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  online: 'Online',
  busy: 'Ocupado',
  invisible: 'Invisível',
  offline: 'Offline',
};

// ---- Working Hours (professional scheduling) ----
export interface DaySchedule {
  enabled: boolean;
  start: string;  // "08:00"
  end: string;    // "18:00"
}

export type WorkingHours = {
  [day: number]: DaySchedule;  // 0=Dom, 1=Seg, ..., 6=Sáb
};

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  0: { enabled: false, start: '09:00', end: '18:00' },
  1: { enabled: true,  start: '09:00', end: '18:00' },
  2: { enabled: true,  start: '09:00', end: '18:00' },
  3: { enabled: true,  start: '09:00', end: '18:00' },
  4: { enabled: true,  start: '09:00', end: '18:00' },
  5: { enabled: true,  start: '09:00', end: '18:00' },
  6: { enabled: false, start: '09:00', end: '18:00' },
};

// ---- Sidebar personalisation ----
export interface SidebarSectionPref {
  key: string;           // 'principal' | 'gestao' | 'fiscal' | 'sistema' | UUID for custom sections
  title: string;         // user-editable display name
  isCollapsed: boolean;  // per-section vertical collapse
  items: string[];       // ordered MenuPage IDs visible in this section
}

export interface SidebarPrefs {
  sections: SidebarSectionPref[];
  hiddenItems: string[]; // MenuPage IDs globally hidden (Dashboard & Configurações excluded)
}

export interface User {
  id: string;
  uid: string;
  email: string;
  name: string;
  phone?: string;
  photoURL?: string;
  role: UserRole;
  businessId: string;
  sectorIds?: string[];
  isProfessional?: boolean;         // true = bookable service provider; false = staff only (hidden from scheduling)
  serviceIds?: string[];            // Service IDs this professional offers
  workingHours?: WorkingHours;      // Weekly availability schedule
  commissionRate?: number;          // Commission percentage (0–100). e.g. 30 = 30% of appointment price
  sidebarPrefs?: SidebarPrefs;      // per-user sidebar customisation
  isActive: boolean;
  isOnline?: boolean;
  userStatus?: UserStatus;
  language?: string;           // i18n preference, e.g. 'pt-BR' | 'en-US'
  lastLoginAt?: string;
  lastSeenAt?: string;
  invitedBy?: string;
  profileAddress?: {
    logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    municipio?: string;
    uf?: string;
    cep?: string;
  };
  createdAt: string;
  updatedAt: string;
}

// Role hierarchy and permissions
export const ROLE_LABELS: Record<UserRole, string> = {
  founder: 'Fundador',
  admin: 'Administrador',
  manager: 'Gerente',
  operator: 'Operador',
  viewer: 'Visualizador',
};

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  founder: 100,
  admin: 80,
  manager: 60,
  operator: 40,
  viewer: 20,
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  founder: 'Acesso total. Pode excluir a empresa e gerenciar todos os usuários.',
  admin: 'Acesso total a configurações, usuários e todos os módulos.',
  manager: 'Gerencia clientes, agenda, financeiro, estoque. Sem acesso a configurações de empresa.',
  operator: 'Opera o PDV, agenda e cadastro de clientes. Sem acesso a financeiro.',
  viewer: 'Apenas visualiza dados. Sem permissão para criar ou editar.',
};

// ---- Business / Company ----
export interface Business {
  id: string;
  // Basic Info
  razaoSocial: string;
  nomeFantasia: string;
  slug?: string;           // URL-safe identifier for public booking page (e.g. "salao-da-ana")
  cnpj: string;
  cpf?: string;
  inscricaoEstadual?: string;
  inscricaoMunicipal?: string;
  // Tax Regime: 1=Simples Nacional, 2=SN Excesso, 3=Lucro Presumido, 4=Lucro Real
  crt: '1' | '2' | '3' | '4';
  // Company Type
  companyType?: 'mei' | 'me' | 'epp' | 'ltda' | 'eireli' | 'sa' | 'individual';
  endereco: Address;
  phone: string;
  email: string;
  logo?: string;
  // Multi-tenant
  ownerUserId: string;
  memberIds: string[];
  // Fiscal Configuration
  fiscal?: FiscalConfig;
  // Settings
  settings?: BusinessSettings;
  // Enterprise
  enterprise?: EnterpriseSettings;
  // Financial settings (notifications, etc.)
  financial?: {
    notificationSettings?: FinancialNotificationSettings;
  };
  // Omnichannel (WhatsApp, Facebook, Instagram)
  channels?: ChannelCredentials;
  // Status
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- Omnichannel Channel Credentials ----
/**
 * @deprecated Use `WhatsAppCloudConfig` ou `WhatsAppBaileysConfig`.
 * Mantido apenas para compatibilidade com dados legados em `channels.whatsapp`.
 * Novos writes vão para `channels.whatsappCloud` ou `channels.whatsappBaileys`.
 */
export interface WhatsAppChannelConfig {
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string; // btoa encrypted
  isConnected: boolean;
  wabaId?: string;
  displayName?: string;
  displayPhoneNumber?: string;
  phoneNumber?: string;
  tokenExpiresAt?: string;
  connectedAt?: string;
  disconnectedAt?: string;
  /** Runtime marker — só presente em conexões Baileys legadas. */
  connectedVia?: 'baileys' | 'embedded_signup';
}

/** WhatsApp Business Cloud API (Meta oficial via Embedded Signup). */
export interface WhatsAppCloudConfig {
  isConnected: boolean;
  phoneNumberId: string;
  accessToken: string; // btoa encrypted
  wabaId?: string;
  businessAccountId?: string;
  displayName?: string;
  displayPhoneNumber?: string;
  tokenExpiresAt?: string;
  connectedAt?: string;
  disconnectedAt?: string;
}

/** WhatsApp Web (Baileys / não-oficial). Não usa accessToken da Meta. */
export interface WhatsAppBaileysConfig {
  isConnected: boolean;
  phoneNumber: string;
  displayPhoneNumber?: string;
  connectedAt?: string;
  disconnectedAt?: string;
}

export interface FacebookChannelConfig {
  pageId: string;
  pageAccessToken: string; // btoa encrypted
  isConnected: boolean;
  pageName?: string;
  connectedAt?: string;
  disconnectedAt?: string;
}

export interface InstagramChannelConfig {
  accountId: string;
  isConnected: boolean;
  accountName?: string;
  accessToken?: string; // encrypted — set when connected via instagram_business_manage_messages scope directly
  connectedAt?: string;
  disconnectedAt?: string;
}

export interface MetaAppConfig {
  appId: string;
  appSecret: string; // btoa encrypted
  webhookVerifyToken: string;
}

export interface ChannelCredentials {
  /** @deprecated Campo legado. Novos writes vão para `whatsappCloud` ou `whatsappBaileys`. Leitores devem priorizar os novos campos. */
  whatsapp?: WhatsAppChannelConfig;
  /** WhatsApp Business Cloud API (oficial). */
  whatsappCloud?: WhatsAppCloudConfig;
  /** WhatsApp Web (Baileys, não-oficial). Pode coexistir com whatsappCloud. */
  whatsappBaileys?: WhatsAppBaileysConfig;
  facebook?: FacebookChannelConfig;
  instagram?: InstagramChannelConfig;
  meta?: MetaAppConfig;
  connectedVia?: 'embedded_signup' | 'manual';
}

// ─── Multi-canal: Channel Connections ─────────────────────────────────────
//
// Modelo novo (Fase 1 do refactor multi-canal). Substitui gradualmente o
// businesses.channels.* (que comporta só 1 conexão por tipo). Cada conexão
// vira um doc próprio em `channelConnections`, com ownerType definindo se é
// canal-empresa (compartilhado) ou canal-pessoal (Baileys do operador).
//
// Migração: cada `businesses/{id}.channels.{whatsappCloud,whatsappBaileys,
// facebook,instagram}` existente vira 1 ChannelConnection com ownerType=
// 'business' e isPrimary=true. Conversations recebem channelConnectionId
// via backfill. businesses.channels permanece como espelho leitura-only
// até a remoção total (planejada após Fase 2 estabilizar).

export type ChannelConnectionType =
  | 'whatsapp_cloud'
  | 'whatsapp_baileys'
  | 'facebook'
  | 'instagram';

/**
 * Quem é dono da conexão.
 *  - 'business': canal compartilhado da empresa (todo operator+ acessa).
 *    Cloud/FB/IG ficam SEMPRE com este ownerType (limitação do Embedded
 *    Signup do Meta — uma conta por business). Apenas Baileys pode ser 'user'.
 *  - 'user': canal pessoal de um operador específico. Visível pra ele +
 *    admin/founder. Outros operators não veem.
 */
export type ChannelOwnerType = 'business' | 'user';

export interface ChannelConnection {
  id: string;
  businessId: string;
  type: ChannelConnectionType;
  ownerType: ChannelOwnerType;
  /** UID do owner quando ownerType='user'. Vazio quando 'business'. */
  ownerId?: string;
  /** Nome amigável pro operador (ex: "Comercial WA", "Pedro WhatsApp"). */
  displayName: string;
  /** Telefone formatado pra exibição (E.164 sem +). Útil em todos os tipos WA. */
  phoneNumber?: string;
  // ── Cloud-specific ───────────────────────────────────────────────────
  phoneNumberId?: string;
  wabaId?: string;
  accessToken?: string;        // AES-256-GCM encrypted
  tokenExpiresAt?: string;
  // ── Facebook-specific ────────────────────────────────────────────────
  pageId?: string;
  pageAccessToken?: string;    // AES-256-GCM encrypted
  pageName?: string;
  // ── Instagram-specific ───────────────────────────────────────────────
  igAccountId?: string;
  igAccountName?: string;
  // ── Baileys-specific ─────────────────────────────────────────────────
  /** Auth state (creds + signal keys) é persistido cifrado no Firestore em
   *  baileysAuthStates/{id}. O id da conexão é a chave de sessão. */
  // ── Estado ───────────────────────────────────────────────────────────
  isConnected: boolean;
  isActive: boolean;
  /** Quando há múltiplas do mesmo tipo, qual é o "default" pra rotas que
   *  precisam decidir (ex: criar conversa vinda de fonte ambígua). */
  isPrimary?: boolean;
  connectedAt?: string;
  disconnectedAt?: string;
  /** Motivo da última desconexão — usado pra UI mostrar mensagem clara:
   *   - 'replaced':    outro dispositivo conectou com as mesmas creds
   *                    (limite multi-device do WhatsApp). Re-conectar aqui
   *                    vai derrubar o outro.
   *   - 'logged_out':  sessão revogada pelo telefone — re-pareamento via QR.
   *   - 'network':     rede caiu / restart do servidor — auto-reconnect tentando.
   *   - 'manual':      usuário clicou "desconectar". */
  disconnectReason?: 'replaced' | 'logged_out' | 'network' | 'manual';
  // ── Auditoria ────────────────────────────────────────────────────────
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  createdByName?: string;
}

export const COMPANY_TYPE_LABELS: Record<string, string> = {
  mei: 'MEI - Microempreendedor Individual',
  me: 'ME - Microempresa',
  epp: 'EPP - Empresa de Pequeno Porte',
  ltda: 'LTDA - Sociedade Limitada',
  eireli: 'EIRELI',
  sa: 'S/A - Sociedade Anônima',
  individual: 'Empresário Individual',
};

export type UseCase = 'pedidos' | 'servicos' | 'simples';

export const USE_CASE_LABELS: Record<UseCase, string> = {
  pedidos: 'Pedidos & Entregas',
  servicos: 'Prestador de Serviços',
  simples: 'Essencial',
};

export const USE_CASE_DESCRIPTIONS: Record<UseCase, string> = {
  pedidos: 'Para restaurantes, confeitarias e comércios que recebem pedidos para entrega. Inclui gerenciador de pedidos, cardápio e estoque com composições.',
  servicos: 'Para profissionais e clínicas com agendamentos. Inclui agenda com recorrência, controle de serviços e sincronização de métricas de clientes.',
  simples: 'Apenas o essencial: clientes, conversas, CRM e financeiro. Sem módulos operacionais.',
};

export interface BusinessHoursDay {
  isOpen: boolean;
  openTime: string;       // 'HH:mm'
  closeTime: string;      // 'HH:mm'
}

export type DeliveryFeeRule = { maxKm: number; fee: number };

export interface DeliveryConfig {
  radiusKm?: number;
  feeRules?: DeliveryFeeRule[];    // múltiplas faixas (0-3km = R$ 8, 3-7km = R$ 12)
  freeDeliveryMinValue?: number;    // acima desse valor, entrega grátis
  estimatedMinutes?: number;
  acceptOffHours?: boolean;         // espelha aiAgent.pedidos.acceptOrdersOffHours
}

export interface BusinessPromotion {
  id: string;
  code?: string;
  name: string;
  description?: string;
  type: 'percentage' | 'fixed' | 'free_shipping';
  value: number;
  minOrderValue?: number;
  validUntil?: string;
  isActive: boolean;
}

export interface LoyaltyTier {
  name: string;        // "Bronze", "Prata", "Ouro"
  minPoints: number;   // 0, 500, 2000
  color: string;       // hex color
  benefits?: string;   // "5% desconto em serviços"
}

export const DEFAULT_LOYALTY_TIERS: LoyaltyTier[] = [
  { name: 'Bronze', minPoints: 0,    color: '#CD7F32', benefits: '' },
  { name: 'Prata',  minPoints: 500,  color: '#9CA3AF', benefits: '' },
  { name: 'Ouro',   minPoints: 2000, color: '#F59E0B', benefits: '' },
];

export interface LoyaltyConfig {
  isEnabled: boolean;
  /** Quantos pontos o cliente ganha por R$1,00 gasto (ex: 1) */
  pointsPerReal: number;
  /** Valor em centavos de cada ponto no resgate (ex: 1 = R$0,01/ponto) */
  pointValueInCentavos: number;
  /** Mínimo de pontos para resgatar */
  minPointsToRedeem: number;
  /** Dias até expirar (null = não expira) */
  expirationDays?: number | null;
  /** Tiers de fidelidade configuráveis */
  tiers?: LoyaltyTier[];
}

export interface LoyaltyHistoryEntry {
  id: string;
  clientId: string;
  businessId: string;
  type: 'add' | 'subtract' | 'sale' | 'redeem' | 'expire' | 'manual';
  amount: number;        // positive = ganhou, negative = usou/expirou
  balance: number;       // saldo após a operação
  reason: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

export interface BusinessSettings {
  timezone?: string;
  currency?: string;
  language?: string;
  useCase?: UseCase;
  aiAgent?: AiAgentSettings;
  /** Horário de funcionamento — 7 posições (0=Domingo, 6=Sábado) */
  openingHours?: BusinessHoursDay[];
  /** Configuração de entrega (usada no modo pedidos e em prompts do agente) */
  delivery?: DeliveryConfig;
  /** Programa de fidelidade */
  loyalty?: LoyaltyConfig;
  /** Promoções ativas */
  promotions?: BusinessPromotion[];
  /** URL do Google Reviews para redirect pós-avaliação */
  googleReviewUrl?: string;
  /** TEF — Transferência Eletrônica de Fundos */
  tef?: TEFConfig;
  /** Gateway de pagamento (PIX, link, boleto) */
  paymentGateway?: PaymentGatewayConfig;
  /** Política de no-show */
  noShowPolicy?: NoShowPolicy;
  /** Pipeline do CRM (estágios customizáveis) */
  crmPipeline?: CRMPipelineConfig;
  /** SLA de conversas — tempo máximo de primeira resposta por prioridade */
  conversationSLA?: {
    enabled: boolean;
    urgentMinutes: number;  // padrão: 30
    highMinutes: number;    // padrão: 60
    mediumMinutes: number;  // padrão: 240 (4h)
    lowMinutes: number;     // padrão: 480 (8h)
    warningPercent: number; // % de tempo restante para alertar (padrão: 20)
  };
  csatEnabled?: boolean;  // Enviar pesquisa de satisfação ao resolver conversa
  routingRules?: RoutingRule[];
  /** Configuração do servidor de notificações externo (broadcasts de email, SMS, etc.) */
  notificationServer?: NotificationServerConfig;
}

/**
 * Configuração de SMTP por business para envio de email via notification-server.
 *
 * Arquitetura: a URL do notification-server e a apiKey de auth ficam em env vars
 * globais do saas-erp (NOTIFICATION_SERVER_URL e NOTIFICATION_SERVER_API_KEY),
 * compartilhadas entre todos os businesses. O que varia por business é apenas
 * o **SMTP** (cada cliente usa seu próprio remetente: Gmail, Outlook, SendGrid,
 * provedor próprio etc.).
 *
 * Saas-erp envia as credenciais SMTP no body do POST /api/send-email; o
 * notification-server é stateless (não armazena SMTP per-tenant no Firebase).
 *
 * `smtp.pass` é criptografada via `encryptToken` (AES-256-GCM com ENCRYPTION_KEY)
 * antes de gravar no Firestore. Decifrada server-side no momento do envio.
 */
export interface NotificationServerConfig {
  isConfigured: boolean;
  configuredAt?: string;
  smtp?: {
    host: string;            // ex: smtp.gmail.com
    port: number;            // ex: 587 (STARTTLS) ou 465 (SSL/TLS)
    secure: boolean;         // true para porta 465, false para 587
    user: string;            // usuário/email de auth
    pass: string;            // ENCRIPTADA — sempre passa por encryptToken antes de salvar
    from: string;            // remetente exibido (ex: "BJJEasy <contato@bjjeasy.com>")
  };
  lastTestedAt?: string;
  lastTestStatus?: 'ok' | 'failed';
  lastTestDetail?: string;
}

export interface RoutingRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: {
    channel?: string;       // 'whatsapp' | 'facebook' | 'instagram' | ''
    keyword?: string;       // keyword na primeira mensagem
    priority?: string;      // 'urgent' | 'high' | 'medium' | 'low' | ''
  };
  action: {
    type: 'assign_sector' | 'assign_user' | 'set_priority';
    sectorId?: string;
    sectorName?: string;
    userId?: string;
    userName?: string;
    priority?: string;
  };
  order: number;
}

/** Estágio customizável do pipeline de leads */
export interface CRMStageConfig {
  id: LeadStatus;          // ID canônico (igual ao valor de LeadStatus)
  name: string;            // nome exibido (editável pelo usuário)
  color: string;           // hex
  order: number;
  isVisible?: boolean;     // false = estágio oculto do kanban
  isWon?: boolean;         // marca este estágio como "convertido"
  isLost?: boolean;        // marca este estágio como "perdido"
}

export interface CRMPipelineConfig {
  stages: CRMStageConfig[];
}

export type CRMAuditAction =
  | 'contact_created' | 'contact_updated' | 'contact_deleted'
  | 'status_changed' | 'tags_changed'
  | 'deal_created' | 'deal_updated' | 'deal_deleted';

export interface CRMAuditEntry {
  id: string;
  businessId: string;
  contactId?: string;
  dealId?: string;
  action: CRMAuditAction;
  userId: string;
  userName: string;
  details?: string;
  createdAt: string;
}

export interface CRMSequenceStep {
  id: string;
  delayDays: number;
  action: 'send_whatsapp' | 'create_task' | 'send_email' | 'add_tag' | 'notify_team';
  content: string;
  label?: string;
}

export interface CRMSequence {
  id: string;
  businessId: string;
  name: string;
  description?: string;
  steps: CRMSequenceStep[];
  isActive: boolean;
  enrolledCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CRMSequenceEnrollment {
  id: string;
  businessId: string;
  sequenceId: string;
  sequenceName: string;
  contactId: string;
  contactName: string;
  status: 'active' | 'completed' | 'paused' | 'cancelled';
  currentStep: number;
  enrolledAt: string;
  nextStepAt?: string;
  completedAt?: string;
  enrolledByUserId: string;
  enrolledByUserName: string;
}

export interface AiAgentSettings {
  enabled: boolean;
  /** Contexto de negócio inserido no prompt do agente */
  businessDescription?: string;
  tone?: 'formal' | 'casual' | 'friendly';
  enabledAt?: string;

  /** === Modo: pedidos === */
  pedidos?: {
    /** Notificar cliente automaticamente em cada mudança de status do pedido */
    notifyOnStatusChange?: boolean;
    /** Aceitar novos pedidos fora do horário (ou mostrar mensagem de fechado) */
    acceptOrdersOffHours?: boolean;
    /** Tempo máximo de espera antes do agente sugerir alternativas (min) */
    maxWaitMinutes?: number;
    /** Taxa de entrega padrão (R$) — usada pelo agente ao criar pedido do tipo entrega */
    deliveryFee?: number;
  };

  /** === Modo: serviços (agenda) === */
  agenda?: {
    /** Enviar lembrete algumas horas antes da consulta */
    sendReminder?: boolean;
    reminderHoursBefore?: number; // ex: 24
    /** Pedir confirmação de presença via IA 1 dia antes */
    confirmationBeforeAppointment?: boolean;
    /** Follow-up depois da consulta (pesquisa de satisfação leve) */
    followUpAfter?: boolean;
  };

  /** === Modo: operador (dashboard chat) === */
  operator?: {
    /**
     * When true, the agent executes destructive actions (create/update/delete)
     * without asking for confirmation in the chat. Always shows a preview
     * before, and the result after. Reserved for admin/founder who want
     * hands-free control. Default false (confirm required).
     */
    autonomousMode?: boolean;
    /** Daily spend cap for the operator chat specifically (USD). */
    dailyBudgetUsd?: number;
  };

  /** === Policies — agent cites these verbatim on relevant questions. === */
  policies?: {
    /** Cancellation terms (e.g., "sem multa até 2h antes"). */
    cancellation?: string;
    /** Refund policy text. */
    refund?: string;
    /** Privacy / LGPD summary the agent can quote. */
    privacy?: string;
  };

  /** === SLAs — target durations used by the agent to set expectations. === */
  sla?: {
    /** Max preparation time before order is ready (pedidos mode). Minutes. */
    prepMaxMinutes?: number;
    /** Max total delivery time (order → doorstep). Minutes. */
    deliveryMaxMinutes?: number;
    /** First-response SLA on customer messages. Minutes. */
    firstResponseMinutes?: number;
  };

  /** === Calendar exceptions — holidays + seasonal hour overrides. === */
  calendar?: {
    /** Dates when the business is closed (ISO YYYY-MM-DD). Overrides openingHours. */
    holidays?: string[];
    /** Date-range overrides with specific opening hours. */
    seasonalHours?: Array<{
      fromDate: string;
      toDate: string;
      label?: string;
      hours: BusinessHoursDay[];
    }>;
  };

  /** === Delivery zones + payment method whitelist (pedidos mode). === */
  deliveryZones?: Array<{
    name: string;
    type: 'radius' | 'neighborhood' | 'polygon';
    value: string;
    fee?: number;
    estimatedMinutes?: number;
  }>;

  /** Payment methods the business accepts — agent never offers one outside this list. */
  acceptedPaymentMethods?: Array<'dinheiro' | 'pix' | 'credito' | 'debito' | 'boleto' | 'pontos' | 'gift_card' | 'voucher' | 'outros'>;

  /** === Team capacity — upper bound the agent won't exceed. === */
  teamCapacity?: {
    maxConcurrentOrders?: number;
    maxDailyAppointments?: number;
  };

  /** === Upsell rules — agent suggests X when Y matches. === */
  upsellRules?: Array<{
    id: string;
    trigger: string;
    suggestion: string;
    isActive: boolean;
  }>;

  /** ISO timestamp of last successful knowledgeChunks reindex. Persisted to Firestore. */
  lastReindexAt?: string;
}

// ---- Fiscal Configuration ----
export type TaxRegime = 'simples_nacional' | 'simples_nacional_excesso' | 'lucro_presumido' | 'lucro_real';

export interface FiscalCertificate {
  serialNumber: string;
  subject: string;
  issuer?: string;
  thumbprint?: string;
  validFrom: string;
  expiresAt: string;
  storagePath: string;
  uploadedAt: string;
}

export interface NFeConfig {
  series: string;
  nextNumber: number;
  environment: 'producao' | 'homologacao';
}

export interface NFCeConfig {
  series: string;
  nextNumber: number;
  cscId: string;
  cscToken: string;
  environment: 'producao' | 'homologacao';
}

export interface NFSeConfig {
  series: string;
  nextNumber: number;
  environment: 'producao' | 'homologacao';
}

export interface FiscalConfig {
  certificate?: FiscalCertificate;
  certPasswordEncrypted?: string;
  nfeConfig?: NFeConfig;
  nfceConfig?: NFCeConfig;
  nfseConfig?: NFSeConfig;
  inscricaoEstadual?: string;
  inscricaoMunicipal?: string;
  ibgeCodigoMunicipio?: string;
  taxRegime?: TaxRegime;
  accountingEmail?: string;
}

/** @deprecated Use FiscalCertificate instead */
export interface CertificateConfig {
  serialNumber: string;
  expiresAt: string;
  validFrom?: string;
  subject?: string;
  storagePath: string;
  uploadedAt?: string;
}

// ---- Invite Codes ----
export interface InviteCode {
  id: string;          // the 6-char code (document ID)
  businessId: string;
  code: string;
  role: UserRole;
  sectorId?: string;
  createdBy: string;       // uid
  createdByName: string;
  usedBy?: string;
  usedByName?: string;
  usedAt?: string;
  expiresAt: string;
  isActive: boolean;
  createdAt: string;
}

// ---- Invitations ----
export type InvitationStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

export interface Invitation {
  id: string;
  businessId: string;
  businessName: string;
  email: string;
  role: UserRole;
  invitedBy: string;
  invitedByName: string;
  status: InvitationStatus;
  expiresAt: string;
  acceptedAt?: string;
  createdAt: string;
}

// ---- Address ----
export interface Address {
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  municipio: string;
  codigoMunicipio: string;
  uf: string;
  cep: string;
  pais?: string;
  codigoPais?: string;
}

// ---- Clients ----
// Client interface removed — unified into CRMContact
// The `Client` type alias above provides backward compatibility

// ---- Appointments / Agenda ----
export type AppointmentStatus =
  | 'agendado'
  | 'confirmado'
  | 'em_andamento'
  | 'concluido'
  | 'cancelado'
  | 'nao_compareceu';

export interface Appointment {
  id: string;
  businessId: string;
  clientId: string;
  clientName: string;
  clientPhone?: string;
  serviceId?: string;
  serviceName: string;
  professionalId?: string;
  professionalName?: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  duration: number; // minutes
  status: AppointmentStatus;
  price: number;
  notes?: string;
  color?: string;
  recurrenceId?: string;
  // Origem (rastreabilidade quando criado via webhook/agent)
  channelType?: 'whatsapp' | 'whatsapp_baileys' | 'facebook' | 'instagram' | 'web' | 'manual';
  conversationId?: string;
  // Idempotência para evitar duplicate bookings em retry/race
  idempotencyKey?: string;
  // Agent-driven automation tracking (idempotência)
  reminderSentAt?: string;
  confirmationRequestedAt?: string;
  followUpSentAt?: string;
  // Commission tracking — set when appointment is marked concluido
  commissionTransactionId?: string; // Firestore ID of the linked Transaction (category: 'Comissoes')
  googleCalendarEventId?: string;   // Google Calendar event ID for sync
  createdAt: string;
  updatedAt: string;
}

export interface Service {
  id: string;
  businessId: string;
  userId?: string;      // uid do usuario dono (opcional — sem userId = servico global do tenant)
  userName?: string;     // nome do dono
  name: string;
  description?: string;
  duration: number; // minutes
  price: number;
  category?: string;
  color: string;
  commissionRate?: number; // Commission % override for this service (0–100). Takes precedence over professional's commissionRate
  formTemplateId?: string; // Intake form auto-requested when this service is booked
  operatorIds?: string[];  // UIDs autorizados a executar o serviço (vazio = todos profissionais ativos)
  sectorId?: string;       // Setor responsável (visibility/atribuição)
  deletedAt?: string;      // Soft-delete timestamp (ISO) — preenchido em vez de deleteDoc
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkSchedule {
  dayOfWeek: number; // 0=Sun, 6=Sat
  startTime: string;
  endTime: string;
  breakStart?: string;
  breakEnd?: string;
  isActive: boolean;
}

// ---- PDV (Point of Sale) ----
export interface SaleItem {
  id: string;
  productId?: string;
  serviceId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
}

export type PaymentMethod =
  | 'dinheiro'
  | 'pix'
  | 'credito'
  | 'debito'
  | 'boleto'
  | 'creditoLoja'
  | 'semPagamento'
  | 'pontos'
  | 'gift_card'
  | 'outros';

export interface Payment {
  method: PaymentMethod;
  amount: number;
  installments?: number;
  cardBrand?: string;
}

export interface Sale {
  id: string;
  businessId: string;
  clientId?: string;
  clientName?: string;
  items: SaleItem[];
  payments: Payment[];
  subtotal: number;
  discount: number;
  tip?: number;
  total: number;
  status: 'aberta' | 'finalizada' | 'cancelada';
  fiscalDocId?: string;
  notes?: string;
  operatorId: string;
  operatorName: string;
  channelType?: ConversationChannel;
  conversationId?: string;
  sectorId?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Financial ----
export type TransactionType = 'receita' | 'despesa';
export type TransactionStatus = 'pendente' | 'pago' | 'atrasado' | 'cancelado';

export type RecurrenceFrequency = 'weekly' | 'biweekly' | 'biweekly_fixed' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly';

export interface TransactionRecurrenceEntry {
  dueDate: string;   // nextDueDate at time of payment (ISO date)
  paidDate: string;  // actual payment date (ISO date)
  amount: number;    // amount paid
  attachments?: Array<{ id: string; name: string; url: string; path: string; uploadedAt: string }>; // FIN-R25
}

export interface TransactionRecurrence {
  frequency: RecurrenceFrequency;
  nextDueDate: string;       // ISO date — when the next copy should be generated
  endDate?: string;          // optional end date — stops generating after this
  isActive: boolean;
  parentTransactionId?: string; // original transaction that spawned this
  dayOfMonth?: number;       // fixed day of month for next occurrences (1-28)
  secondDayOfMonth?: number; // second fixed day for 'biweekly_fixed' (1-28)
  holidayAdjust?: 'none' | 'before' | 'after'; // FIN-R17: adjust nextDueDate to business day
  lateFeePct?: number;       // FIN-R18: flat late fee % (e.g. 2 = 2%)
  interestPctMonth?: number; // FIN-R18: monthly interest % pro-rata (e.g. 1 = 1%/month)
  label?: string;            // user-friendly name (e.g. "Aluguel")
  history?: TransactionRecurrenceEntry[]; // log of past paid occurrences
}

export interface TransactionAttachment {
  id: string;
  name: string;
  url: string;
  /** Firebase Storage path (e.g. businesses/{id}/financial_attachments/{file}) — used for deletion */
  path: string;
  size: number;
  type: string;
  createdAt: string;
}

export interface Transaction {
  id: string;
  businessId: string;
  type: TransactionType;
  category?: string;
  description: string;
  amount: number;
  dueDate?: string;
  paymentDate?: string;
  status: TransactionStatus;
  clientId?: string;
  clientName?: string;
  saleId?: string;
  paymentMethod?: PaymentMethod;
  recurrenceId?: string;
  bankAccountId?: string;
  businessUnitId?: string;
  costCenter?: string;
  notes?: string;
  channelType?: ConversationChannel;
  conversationId?: string;
  contactId?: string;
  campaignId?: string;
  sectorId?: string;
  appointmentId?: string; // Link back to the originating appointment (for commission transactions)
  /** Parcelamento: grupo compartilhado entre todas as parcelas */
  installmentGroupId?: string;
  installmentNumber?: number;   // ex: 1 de 3
  installmentTotal?: number;
  /** Recorrência automática */
  recurrence?: TransactionRecurrence;
  /** Anexos (recibos, NFs, etc) */
  attachments?: TransactionAttachment[];
  /** Lock fiscal: true quando existe NF-e/NFC-e/NFSe autorizada vinculada via saleId */
  isLocked?: boolean;
  lockedReason?: string;
  /** Auditoria: identidade de quem criou/modificou. Preenchido nas mutações. */
  createdBy?: string;
  createdByName?: string;
  updatedBy?: string;
  updatedByName?: string;
  /** Idempotência de notificações — preenchido pelo cron ao enviar alerta */
  dueSoonNotifiedAt?: string;
  overdueNotifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Reconciliation Rules (2.5) ----
export interface ReconciliationRule {
  id: string;
  businessId: string;
  /** Case-insensitive substring matched against bank statement description */
  pattern: string;
  category: string;
  type?: 'receita' | 'despesa';
  /** If set, rule only applies when this bank account is selected */
  bankAccountId?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Payment Provider Config (3.5/3.6/3.8) ----
export type PaymentProvider = 'asaas' | 'gerencianet' | 'pagseguro' | 'iugu' | 'mercadopago';
export type OpenBankingProvider = 'pluggy' | 'belvo' | 'quanto';

export interface PixConfig {
  provider: PaymentProvider;
  apiKey: string;     // stored encrypted
  pixKey: string;     // chave PIX da empresa (CPF/CNPJ/email/phone/random)
  pixKeyType: 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';
  isEnabled: boolean;
  sandboxMode: boolean;
  connectedAt?: string;
}

export interface BoletoConfig {
  provider: PaymentProvider;
  apiKey: string;     // stored encrypted
  walletNumber?: string;
  cedente?: string;   // nome do cedente
  isEnabled: boolean;
  sandboxMode: boolean;
  connectedAt?: string;
}

export interface OpenBankingConfig {
  provider: OpenBankingProvider;
  clientId: string;
  clientSecret: string; // stored encrypted
  isEnabled: boolean;
  connectedBankIds: string[]; // external bank connection IDs
  lastSyncAt?: string;
  connectedAt?: string;
}

// Add to Business.financial when these are configured:
// financial.pixConfig, financial.boletoConfig, financial.openBankingConfig

// ---- Financial Notification Settings ----
export interface FinancialNotificationSettings {
  enabled: boolean;
  /** Days before due date to send reminder (1, 2, 3, or 7) */
  dueSoonDays: number;
  sendEmail: boolean;
  sendWhatsApp: boolean;
  notifyPayable: boolean;    // contas a pagar
  notifyReceivable: boolean; // contas a receber (cobrança)
}

// ---- Budget (Orçamento por categoria/mês) ----
export interface Budget {
  id: string;
  businessId: string;
  year: number;
  month: number;      // 1-12
  category: string;
  type: 'receita' | 'despesa';
  amount: number;     // meta orçada
  createdAt: string;
  updatedAt: string;
}

// ---- DAS / Simples Nacional ----
export type DasStatus = 'pendente' | 'pago' | 'atrasado';
export type SimplesAnexo = 'I' | 'II' | 'III' | 'IV' | 'V';

export interface DasRecord {
  id: string;
  businessId: string;
  /** Referência no formato AAAAMM, ex: "202604" */
  competencia: string;
  receitaBruta: number;   // receita bruta do mês de competência
  rbt12: number;          // receita bruta acumulada nos últimos 12 meses
  anexo: SimplesAnexo;
  aliquotaEfetiva: number;  // % calculada
  valorDas: number;
  /** Vencimento: sempre dia 20 do mês seguinte à competência */
  vencimento: string;
  status: DasStatus;
  pagoEm?: string;
  recibo?: string;      // Storage download URL
  reciboPath?: string;  // Storage path (for deletion)
  createdAt: string;
  updatedAt: string;
}

// ---- Audit log (alterações em entidades financeiras) ----
export type AuditAction = 'create' | 'update' | 'delete' | 'pay' | 'cancel' | 'restore';

export interface FinancialAuditLog {
  id: string;
  businessId: string;
  entity: 'transaction' | 'bankAccount';
  entityId: string;
  action: AuditAction;
  actorUid: string;
  actorName: string;
  /** Snapshot de campos relevantes antes da mudança (para update/delete) */
  before?: Record<string, unknown>;
  /** Snapshot depois (para create/update) */
  after?: Record<string, unknown>;
  /** Diff resumido: lista de campos que mudaram */
  changedFields?: string[];
  amount?: number;               // denormalizado para facilitar filtros/relatórios
  description?: string;          // snapshot do texto da transação para exibição histórica
  createdAt: string;
}

export interface FinancialCategory {
  id: string;
  businessId: string;
  name: string;
  type: TransactionType;
  color: string;
  icon?: string;
}

export interface CashFlowSummary {
  period: string;
  totalReceitas: number;
  totalDespesas: number;
  saldo: number;
  receitasPendentes: number;
  despesasPendentes: number;
}

// ---- Financial: Business Units (SaaS Products) ----
export interface BusinessUnit {
  id: string;
  businessId: string;
  name: string;
  niche: string;
  description?: string;
  color: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- Financial: Bank Accounts ----
export type BankAccountType = 'corrente' | 'poupanca' | 'investimento' | 'caixa';

export interface BankAccount {
  id: string;
  businessId: string;
  name: string;
  bankName: string;
  bankCode?: string;
  accountType: BankAccountType;
  agency?: string;
  accountNumber?: string;
  balance: number;
  color: string;
  isMain: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- Bank Reconciliation ----

export type ReconciliationStatus = 'matched' | 'pending' | 'divergent' | 'ignored';

export interface BankStatementEntry {
  date: string;           // YYYY-MM-DD
  description: string;
  amount: number;         // positive = credit, negative = debit
  balance?: number;
  reference?: string;     // bank reference / doc number
}

export interface ReconciliationItem {
  id: string;
  businessId: string;
  bankAccountId: string;
  importId: string;           // groups items from same upload
  // Statement side
  statementDate: string;
  statementDescription: string;
  statementAmount: number;
  statementReference?: string;
  // Match side
  transactionId?: string;     // linked transaction ID when matched
  status: ReconciliationStatus;
  matchConfidence?: number;   // 0-100 auto-match score
  reconciledBy?: string;
  reconciledAt?: string;
  createdAt: string;
}

export interface BankStatementImport {
  id: string;
  businessId: string;
  bankAccountId: string;
  fileName: string;
  format: 'csv' | 'ofx';
  totalEntries: number;
  matched: number;
  pending: number;
  divergent: number;
  importedAt: string;
  importedBy: string;
}

// ---- Financial: Employees ----
export interface Employee {
  id: string;
  businessId: string;
  name: string;
  role: string;
  department?: string;
  salary: number;
  benefits?: number;
  startDate: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- Financial: Partners ----
export interface Partner {
  id: string;
  businessId: string;
  name: string;
  cpf?: string;
  email?: string;
  sharePercentage: number;
  role: string;
  investedAmount?: number;
  createdAt: string;
  updatedAt: string;
}

// ---- Inventory / Stock ----
export interface Product {
  id: string;
  businessId: string;
  name: string;
  description?: string;
  sku?: string;
  barcode?: string;
  category: string;
  unit: string; // UN, KG, L, etc.
  costPrice: number;
  salePrice: number;
  currentStock: number;
  minStock: number;
  maxStock?: number;
  ncm?: string;
  cfop?: string;
  cest?: string;              // Código Especificador da Substituição Tributária
  icmsOrigem?: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7'; // Origem da mercadoria
  gtin?: string;              // GTIN/EAN barcode
  gtinTrib?: string;          // GTIN tributável
  unidadeTrib?: string;       // Unidade tributável
  // Per-product tax overrides (when different from business defaults)
  fiscalTax?: {
    icms?: { cst?: string; csosn?: string; rate?: number };
    pis?: { cst?: string; rate?: number };
    cofins?: { cst?: string; rate?: number };
    ipi?: { cst?: string; rate?: number; cEnq?: string };
  };
  isActive: boolean;
  imageUrl?: string;
  // Delivery / Cardápio (used when business.settings.useCase === 'pedidos')
  isDeliverable?: boolean;
  menuCategory?: string;        // Ex: "Pizzas" — legado (string livre) | continua suportado
  menuCategoryId?: string;      // Referência formal para MenuCategory (prioridade sobre menuCategory)
  menuDescription?: string;     // Short description for the menu card
  preparationTime?: number;     // Minutes — for delivery ETA
  /** Dietary markers — usados no cardápio e pelo agente para filtrar */
  dietary?: Array<'vegan' | 'vegetarian' | 'glutenfree' | 'lactosefree' | 'organic' | 'picante' | 'alcool' | 'kids'>;
  /** Personalização / modificadores — quando presente, catálogo abre wizard de montagem */
  modifierGroups?: ProductModifierGroup[];
  hasModifiers?: boolean;       // atalho p/ queries
  // Composite / BOM — when set, parent product deducts each component on sale,
  // and parent itself carries no stock of its own.
  components?: ProductComponent[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductComponent {
  productId: string;
  productName: string;  // denormalized for display
  quantity: number;
}

// ---- Menu Categories (cardápio online — pedidos mode) ----
export interface MenuCategory {
  id: string;
  businessId: string;
  name: string;                 // "Pizzas", "Bebidas", "Sobremesas"
  description?: string;
  imageUrl?: string;
  color?: string;               // hex for category accent
  icon?: string;                // lucide icon name (optional)
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- Product Modifiers (personalização no cardápio) ----
/**
 * Selection types:
 *  - single:   radio (maxSelections = 1)
 *  - multiple: checkbox (each option selected 0 or 1 time)
 *  - quantity: each option has a +/- counter (extras com quantidade)
 */
export type ModifierSelectionType = 'single' | 'multiple' | 'quantity';

/**
 * How the final price is computed from the selected options:
 *  - sum:  total = base + sum(selectedOptions.additionalPrice * qty)
 *  - max:  total = base + max(selectedOptions.additionalPrice)  (p.ex. pizza c/ 2 sabores usa o mais caro)
 *  - avg:  total = base + avg(selectedOptions.additionalPrice)
 */
export type ModifierPriceStrategy = 'sum' | 'max' | 'avg';

export interface ProductModifierOption {
  id: string;                   // uuid curto
  name: string;                 // "Pequena", "Calabresa"
  description?: string;
  additionalPrice: number;      // 0 se incluso
  imageUrl?: string;
  isDefault?: boolean;          // pré-selecionado
  maxQuantity?: number;         // for 'quantity' type; default 1
  available: boolean;
  sortOrder: number;
}

export interface ProductModifierGroup {
  id: string;                   // uuid curto
  name: string;                 // "Tamanho", "Sabores", "Borda", "Extras"
  description?: string;
  required: boolean;
  minSelections: number;        // 0 = opcional
  maxSelections: number;        // 1 para radio, N para checkbox, 99 para livre
  selectionType: ModifierSelectionType;
  priceStrategy: ModifierPriceStrategy;
  options: ProductModifierOption[];
  sortOrder: number;
}

/**
 * Seleção escolhida pelo cliente — vai no CartItem e no DeliveryOrderItem.
 * Fica denormalizado (nomes + preços) para sobreviver a edições futuras.
 */
export interface SelectedModifierOption {
  optionId: string;
  optionName: string;
  additionalPrice: number;
  quantity: number;             // sempre ≥ 1; relevante p/ 'quantity'
}

export interface SelectedModifier {
  groupId: string;
  groupName: string;
  priceStrategy: ModifierPriceStrategy;
  selectedOptions: SelectedModifierOption[];
}

export interface StockMovement {
  id: string;
  businessId: string;
  productId: string;
  productName: string;
  type: 'entrada' | 'saida' | 'ajuste';
  quantity: number;
  previousStock: number;
  newStock: number;
  reason: string;
  saleId?: string;
  purchaseId?: string;
  operatorId: string;
  operatorName: string;
  createdAt: string;
}

// ---- Password Vault (cofre de senhas compartilhado com admins) ----
export type VaultAccessScope = 'admins' | 'specific';

export interface VaultAccessLogEntry {
  uid: string;
  userName: string;
  action: 'revealed' | 'copied' | 'created' | 'updated' | 'deleted';
  at: string;
}

export interface VaultEntry {
  id: string;
  businessId: string;
  title: string;
  username?: string;
  /** Ciphertext (AES-256-GCM, base64). Never sent to client as plaintext. */
  encryptedPassword: string;
  url?: string;
  notes?: string;
  category?: string;
  tags?: string[];
  /**
   * Access scope — default 'admins' means every admin/founder of the business
   * can view/edit. 'specific' restricts to a curated list of uids.
   */
  accessScope: VaultAccessScope;
  sharedWith?: string[]; // uids when accessScope === 'specific'
  createdBy: string;
  createdByName: string;
  updatedBy?: string;
  updatedByName?: string;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string;
  lastAccessedBy?: string;
  accessCount?: number;
}

// ---- AI Agent (LangGraph orchestration) ----
export type AgentRunStatus = 'running' | 'success' | 'error' | 'skipped';

export interface AgentToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
  latencyMs: number;
  startedAt: string;
}

export interface AgentNodeTrace {
  node: string;                  // 'router' | 'planner' | 'executor' | 'evaluator' | 'responder'
  input?: unknown;
  output?: unknown;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs: number;
  startedAt: string;
}

export interface AgentRun {
  id: string;
  businessId: string;
  conversationId: string;
  messageId: string;            // id da mensagem inbound que disparou a run
  userMessage: string;
  status: AgentRunStatus;
  finalResponse?: string;        // mensagem efetivamente enviada ao contato
  intent?: string;               // pedido | agenda | info | outro
  nodes: AgentNodeTrace[];
  tools: AgentToolCall[];
  iterations: number;
  totalLatencyMs: number;
  totalTokensIn: number;
  totalTokensOut: number;
  costUsd: number;
  model: string;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}

// ---- Delivery Orders (Pedidos — modo "pedidos", distinto do Order de Vendas B2B) ----
export type DeliveryOrderStatus =
  | 'recebido'
  | 'preparando'
  | 'pronto'
  | 'saiu_entrega'
  | 'entregue'
  | 'cancelado';

export type DeliveryOrderPaymentStatus = 'pendente' | 'pago' | 'estornado';

export type DeliveryOrderChannel = 'whatsapp' | 'facebook' | 'instagram' | 'manual' | 'site';

export type DeliveryType = 'entrega' | 'retirada';

export type DeliveryOrderPaymentMethod =
  | 'dinheiro'
  | 'cartao_credito'
  | 'cartao_debito'
  | 'pix'
  | 'voucher'
  | 'outro';

export interface DeliveryOrderItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;            // preço unitário final (base + modificadores calculados)
  total: number;                // unitPrice * quantity
  notes?: string;
  imageUrl?: string;
  /** Modificadores selecionados (pizza c/ sabores, borda, extras). */
  selectedModifiers?: SelectedModifier[];
  basePrice?: number;           // preço base do produto antes dos modificadores
}

export interface DeliveryOrderAddress {
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  reference?: string;
}

export interface DeliveryOrder {
  id: string;
  businessId: string;
  number: number;
  status: DeliveryOrderStatus;

  clientId?: string;
  clientName: string;
  clientPhone?: string;

  channel?: DeliveryOrderChannel;
  conversationId?: string;
  contactExternalId?: string;

  items: DeliveryOrderItem[];
  subtotal: number;
  deliveryFee?: number;
  discount?: number;
  total: number;

  deliveryType: DeliveryType;
  deliveryAddress?: DeliveryOrderAddress;
  deliveryPersonId?: string;
  deliveryPersonName?: string;
  estimatedDeliveryAt?: string;
  deliveredAt?: string;

  paymentMethod?: DeliveryOrderPaymentMethod;
  paymentStatus: DeliveryOrderPaymentStatus;
  changeFor?: number;

  customerNotes?: string;
  internalNotes?: string;

  // Tracks when stock was deducted so transitions stay idempotent.
  stockDeductedAt?: string;

  createdAt: string;
  updatedAt: string;
  sectorId?: string;
}

export const DELIVERY_ORDER_STATUS_FLOW: DeliveryOrderStatus[] = [
  'recebido',
  'preparando',
  'pronto',
  'saiu_entrega',
  'entregue',
];

export const DELIVERY_ORDER_STATUS_LABELS: Record<DeliveryOrderStatus, string> = {
  recebido: 'Recebido',
  preparando: 'Preparando',
  pronto: 'Pronto',
  saiu_entrega: 'Saiu para Entrega',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};

// ---- Fiscal ----
export type FiscalDocType = 'nfse' | 'nfce' | 'nfe';
export type FiscalDocStatus =
  | 'rascunho'
  | 'processando'
  | 'autorizada'
  | 'rejeitada'
  | 'cancelada'
  | 'erro';

export interface FiscalDocument {
  id: string;
  businessId: string;
  type: FiscalDocType;
  number?: number;
  series?: string;
  accessKey?: string;
  protocol?: string;
  status: FiscalDocStatus;
  clientId?: string;
  clientName?: string;
  clientCpfCnpj?: string;
  saleId?: string;
  items: FiscalItem[];
  totalValue: number;
  issueDate: string;
  statusMessage?: string;
  xmlUrl?: string;
  pdfUrl?: string;
  canceledAt?: string;
  cancelReason?: string;
  naturezaOperacao?: string;  // Natureza da operação
  informacoesAdicionais?: string; // Additional info
  xml?: string;               // Signed XML content
  cartaCorrecao?: {           // Correction letter history
    sequencia: number;
    texto: string;
    protocolo?: string;
    dataEvento: string;
  }[];
  createdAt: string;
  updatedAt: string;
}

export interface FiscalItem {
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  ncm?: string;
  cfop?: string;
  unit: string;
  codigo?: string;            // Product code
  cest?: string;              // CEST
  gtin?: string;              // GTIN/EAN
  icmsOrigem?: string;        // Origin code
  taxes?: {
    icms?: { cst?: string; csosn?: string; aliquota?: number; valor?: number };
    pis?: { cst?: string; aliquota?: number; valor?: number };
    cofins?: { cst?: string; aliquota?: number; valor?: number };
    iss?: { aliquota?: number; valor?: number };
  };
}

export interface CertificateInfo {
  id: string;
  businessId: string;
  filename: string;
  subject: string;
  serialNumber: string;
  validFrom: string;
  validUntil: string;
  isValid: boolean;
  daysUntilExpiry: number;
}

// ---- Dashboard ----
export interface DashboardMetrics {
  todayRevenue: number;
  monthRevenue: number;
  todayAppointments: number;
  activeClients: number;
  pendingPayments: number;
  lowStockItems: number;
  revenueByMonth: { month: string; receita: number; despesa: number }[];
  topServices: { name: string; count: number; revenue: number }[];
  appointmentsByStatus: { status: string; count: number }[];
}

// ---- Kanban ----
export type KanbanPriority = 'urgent' | 'high' | 'medium' | 'low';

export type KanbanVisibility = 'all' | 'members' | 'sectors';

export interface KanbanBoard {
  id: string;
  businessId: string;
  name: string;
  description?: string;
  color: string;
  columns: KanbanColumn[];
  memberIds: string[];
  sectorIds?: string[];
  visibility: KanbanVisibility;
  createdBy: string;
  isArchived: boolean;
  automations?: KanbanAutomation[];
  createdAt: string;
  updatedAt: string;
}

export interface KanbanColumn {
  id: string;
  title: string;
  color: string;
  cardLimit?: number;
  order: number;
}

export interface KanbanComment {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

export type KanbanRecurrence = 'daily' | 'weekly' | 'monthly';

export interface KanbanAttachment {
  id: string;
  name: string;
  url: string;
  storagePath: string;
  type: string;
  size: number;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: string;
}

export interface KanbanCard {
  id: string;
  businessId: string;
  boardId: string;
  columnId: string;
  title: string;
  description?: string;
  priority: KanbanPriority;
  labels: KanbanLabel[];
  assigneeIds: string[];
  assigneeNames: string[];
  dueDate?: string;
  checklist?: KanbanChecklistItem[];
  comments?: KanbanComment[];
  attachments?: KanbanAttachment[];
  recurrence?: KanbanRecurrence;
  commentsCount: number;
  attachmentsCount: number;
  coverColor?: string;
  order: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanLabel {
  id: string;
  name: string;
  color: string;
}

export interface KanbanChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface KanbanCardTemplate {
  id: string;
  businessId: string;
  name: string;
  title: string;
  description?: string;
  priority: KanbanPriority;
  labels: KanbanLabel[];
  checklist?: KanbanChecklistItem[];
  createdBy: string;
  createdAt: string;
}

export type KanbanAutomationTrigger = 'move_to_column' | 'due_date_passed';
export type KanbanAutomationActionType = 'set_priority' | 'add_label' | 'assign_user';

export interface KanbanAutomationAction {
  type: KanbanAutomationActionType;
  value: string;
}

export interface KanbanAutomation {
  id: string;
  trigger: KanbanAutomationTrigger;
  triggerColumnId?: string;
  actions: KanbanAutomationAction[];
  isEnabled: boolean;
}

// ---- CRM ----
export type LeadStatus = 'novo' | 'contatado' | 'qualificado' | 'proposta' | 'negociacao' | 'ganho' | 'perdido';
export type LeadSource = 'site' | 'indicacao' | 'whatsapp' | 'instagram' | 'facebook' | 'google_ads' | 'linkedin' | 'evento' | 'email' | 'telefone' | 'outro';
export type CRMActivityType = 'ligacao' | 'email' | 'reuniao' | 'whatsapp' | 'tarefa' | 'nota' | 'proposta';
export type IntegrationStatus = 'connected' | 'disconnected' | 'error' | 'pending';
export type IntegrationCategory = 'messaging' | 'social' | 'payment' | 'email' | 'analytics' | 'automation' | 'calendar';

export type LifecycleStage = 'new_lead' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'customer' | 'churned';
export type ContactProfile = 'vip' | 'regular' | 'sporadic' | 'new' | 'at_risk' | 'churned';
export type ConversationTone = 'satisfied' | 'neutral' | 'irritated';
export type PriceSensitivity = 'low' | 'medium' | 'high';

export interface RelationshipHistory {
  firstContactDate?: string;
  totalAppointments?: number;
  completedAppointments?: number;
  cancelledAppointments?: number;
  noShowCount?: number;
  attendanceRate?: number;
  avgDaysBetweenVisits?: number;
  lastVisitDate?: string;
  lastServiceName?: string;
  totalSpent?: number;
  servicesContracted?: string[];
  avgTicket?: number;
}

export interface BehavioralInsights {
  cancellationReasons?: string[];
  recurringObjections?: string[];
  priceSensitivity?: PriceSensitivity;
  preferredTimes?: string[];
  preferredProfessional?: string;
  uncontractedServices?: string[];
  conversationTone?: ConversationTone;
  preferences?: string[];
  inquiredButNotBooked?: string[];
  lastToneDate?: string;
}

export interface ContactScores {
  loyalty: number;
  value: number;
  churnRisk: number;
  engagement: number;
  overall: number;
  lastCalculatedAt?: string;
}

// Flexible address for client profiles (all fields optional, vs. the strict fiscal Address)
export interface ClientAddress {
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  codigoMunicipio?: string;
  pais?: string;
  codigoPais?: string;
}

// ---- Client (primary entity — replaces CRMContact) ----
export interface Client {
  id: string;
  businessId: string;
  name: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  company?: string;
  role?: string;

  // ── CRM / Pipeline ─────────────────────────────────
  source: LeadSource;
  status: LeadStatus;
  score: number;
  assignedTo?: string;
  assignedToName?: string;
  tags?: string[];
  socialMedia?: {
    instagram?: string;
    facebook?: string;
    linkedin?: string;
  };
  notes?: string;
  lastContactDate?: string;
  lifecycleStage?: LifecycleStage;
  channelIdentities?: {
    whatsapp?: string;
    facebook?: string;
    instagram?: string;
  };
  preferredChannel?: ConversationChannel;
  lastConversationId?: string;
  lastConversationAt?: string;
  customFields?: Record<string, string | number | boolean>;
  sectorId?: string;
  optInMarketing?: boolean;
  optInAt?: string;

  // ── Aquisição / atribuição (Fase 4 do módulo Clientes) ─────────────────────
  // Diferencia "veio da campanha X" de "comprou produto Y" — o source genérico
  // (LeadSource: whatsapp/site/etc) só captura canal, não a oferta específica.
  // Estes campos são manuais (operador preenche no cadastro). Iteração futura
  // (opção C do plano) modela `offers/{id}` como entidade própria com agregação.
  /** Produto/serviço que originou o cadastro deste cliente — usado pra
   *  filtrar "clientes que vieram da oferta Black Friday Rinoplastia". */
  acquisitionProductId?: string;
  /** Label livre da oferta apresentada — útil quando não há produto formal
   *  (ex: "promo aniversário 30% off", "indicação parceiro X"). */
  acquisitionOfferLabel?: string;

  // ── Dados Cadastrais / Fiscal ───────────────────────
  tipo?: 'pf' | 'pj';
  cpfCnpj?: string;
  phone2?: string;
  birthDate?: string;
  gender?: 'M' | 'F' | 'O';
  endereco?: ClientAddress;
  inscricaoEstadual?: string;
  indicadorIE?: '1' | '2' | '9';
  inscricaoMunicipal?: string;
  suframa?: string;
  nomeFantasia?: string;
  isActive?: boolean;
  avatarUrl?: string;
  totalSpent?: number;
  visitCount?: number;
  lastVisit?: string;
  /** Saldo de pontos de fidelidade */
  loyaltyPoints?: number;

  // ── Merge de duplicatas ────────────────────────────
  mergedInto?: string;   // ID do cliente primário que absorveu este
  mergedAt?: string;     // ISO timestamp do merge

  // ── Inteligência & AI Agent ────────────────────────
  profile?: ContactProfile;
  relationshipHistory?: RelationshipHistory;
  behavioralInsights?: BehavioralInsights;
  scores?: ContactScores;
  suggestedAction?: string;
  aiSummary?: string;

  createdAt: string;
  updatedAt: string;
}

/** @deprecated Use Client instead — unified client model */
export type CRMContact = Client;

export interface CRMDeal {
  id: string;
  businessId: string;
  contactId: string;
  contactName: string;
  title: string;
  value: number;
  stage: string;
  probability: number;
  expectedCloseDate?: string;
  closedDate?: string;
  businessUnitId?: string;
  businessUnitName?: string;
  assignedTo?: string;
  assignedToName?: string;
  lostReason?: string;
  notes?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CRMPipelineStage {
  id: string;
  name: string;
  color: string;
  order: number;
  probability: number;
}

export interface CRMActivity {
  id: string;
  businessId: string;
  contactId?: string;
  contactName?: string;
  dealId?: string;
  dealTitle?: string;
  type: CRMActivityType;
  title: string;
  description?: string;
  scheduledAt?: string;
  completedAt?: string;
  isCompleted: boolean;
  assignedTo?: string;
  assignedToName?: string;
  duration?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CRMIntegration {
  id: string;
  businessId: string;
  platform: string;
  name: string;
  description: string;
  status: IntegrationStatus;
  color: string;
  category: IntegrationCategory;
  lastSync?: string;
  config?: Record<string, unknown>;
  features: string[];
  createdAt: string;
  updatedAt: string;
}

// ---- Conversations / Unified Inbox ----
export type ConversationChannel = 'whatsapp' | 'facebook' | 'instagram';
export type ConversationStatus = 'open' | 'waiting' | 'resolved';
export type MessageDirection = 'inbound' | 'outbound';
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Conversation {
  id: string;
  businessId: string;
  channel: ConversationChannel;
  /**
   * Para canal 'whatsapp', subdivide em dois transportes com labels distintos na UI:
   *   'embedded_signup' → WhatsApp Business (Meta Cloud API, oficial)
   *   'baileys'         → WhatsApp Web (conexão via app do celular)
   * Outros canais (facebook/instagram) ignoram este campo.
   */
  connectedVia?: 'embedded_signup' | 'baileys';
  /**
   * ID do `channelConnections/{id}` que recebeu/envia esta conversa.
   * Adicionado na Fase 1 do refactor multi-canal. Nas conversas legadas (pré-
   * refactor) pode estar undefined até o backfill rodar — leitores devem
   * resolver por (businessId, channel, connectedVia, isPrimary=true) como
   * fallback enquanto o campo não está populado.
   */
  channelConnectionId?: string;
  /**
   * Denormalização de `channelConnections/{channelConnectionId}.ownerType`.
   * Usado pelas Firestore rules e queries pra isolar canais pessoais
   * (ownerType='user') do operador-dono — sem isso, qualquer operator+ do
   * mesmo business consegue ler/escrever conversas de canal pessoal alheio.
   * Vazio em conversas legadas até o backfill (`backfill-conversation-ownership`).
   */
  channelOwnerType?: 'business' | 'user';
  /**
   * Denormalização de `channelConnections/{channelConnectionId}.ownerId`.
   * Só populado quando `channelOwnerType === 'user'`. Vazio em canais business.
   */
  channelOwnerId?: string;
  status: ConversationStatus;
  contactName: string;
  contactPhone?: string;
  contactExternalId?: string;
  contactAvatarUrl?: string;
  customContactName?: string;
  crmContactId?: string;
  aiEnabled?: boolean;            // toggle do agente IA — default: herda de business.settings.aiAgent.enabled
  lastMessage: string;
  lastMessageAt: string;
  lastMessageDirection: MessageDirection;
  unreadCount: number;
  assignedTo?: string;
  assignedToName?: string;
  sectorIds?: string[];
  assignedToSectorId?: string;
  isPrivate?: boolean;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  labels?: string[];
  internalNotes?: number;
  tags?: string[];
  firstResponseAt?: string;  // ISO — quando o primeiro msg outbound não-interna foi enviada
  slaBreached?: boolean;     // true quando SLA venceu sem firstResponseAt
  csatRating?: 1 | 2 | 3 | 4 | 5;  // avaliação de satisfação registrada pelo contato
  csatSentAt?: string;       // ISO — quando a pesquisa CSAT foi enviada
  /**
   * ISO timestamp até quando a conversa está silenciada ("soneca"). Quando
   * presente E > now, a conversa some de todas as smart views EXCETO da view
   * 'snoozed' (que mostra justamente as soneca ativas). Não afeta o status
   * (continua 'open'/'waiting') — é um sinal complementar de "não me lembre
   * agora". Quando o tempo passa, o filtro deixa de casar e a conversa
   * reaparece naturalmente nas views ativas — sem cron necessário.
   */
  snoozedUntil?: string;
  /** UID do operador que ativou a soneca (audit trail). */
  snoozedBy?: string;
  snoozedByName?: string;
  assignmentHistory?: Array<{
    assignedTo?: string;
    assignedToName?: string;
    assignedToSectorId?: string;
    sectorName?: string;
    changedBy: string;
    changedByName: string;
    changedAt: string;
  }>;
  /**
   * Motivo do fechamento (status='resolved') quando foi automático pelo sistema.
   * Diferente de uma resolução manual pelo operador. Hoje só usamos
   * 'channel_removed' (admin removeu o canal pessoal que sustentava a conversa
   * e não havia fallback Baileys disponível).
   */
  closedReason?: 'channel_removed';
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
  deletedAt?: string;
}

export interface CSATResponse {
  id: string;
  businessId: string;
  conversationId: string;
  contactName: string;
  channel: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comment?: string;
  assignedTo?: string;
  assignedToName?: string;
  respondedAt: string;
}

export interface ConversationView {
  id: string;
  businessId: string;
  name: string;
  emoji?: string;
  filters: {
    channel?: string;
    /** @deprecated Mantido para compat de views antigas — novas views usam smartView. */
    status?: string;
    /**
     * Smart view atual (post-refactor de filtros). Substitui o campo `status`
     * com semântica mais rica (ex: 'awaiting_reply' = open + last msg do
     * cliente). Quando ausente em views legadas, o `status` é mapeado pra
     * smart view equivalente em runtime.
     */
    smartView?: string;
    sectorId?: string;
    assignedTo?: string;
    priority?: string;
    label?: string;
    slaStatus?: string;
    unreadOnly?: boolean;
  };
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  businessId: string;
  channel: ConversationChannel;
  /**
   * Para canal 'whatsapp', subdivide em dois transportes (paralelo a
   * `Conversation.connectedVia`). Denormalizado na mensagem pra que a UI
   * possa renderizar distinto por bolha — útil quando uma conversa muda
   * de transporte (ex: failover, troca de número), preservando o histórico
   * fiel de qual canal recebeu/enviou cada mensagem.
   *   'embedded_signup' → WhatsApp Business (Meta Cloud API, oficial)
   *   'baileys'         → WhatsApp Web (conexão via app do celular)
   */
  connectedVia?: 'embedded_signup' | 'baileys';
  direction: MessageDirection;
  content: string;
  status: MessageStatus;
  externalMessageId?: string; // Meta API message ID (wamid, mid)
  senderName?: string;
  senderAvatarUrl?: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'audio' | 'video' | 'document';
  /** Nome do arquivo original para documentos. Renderizado no card; preserva
   *  o filename real ao invés de virar caption duplicada na bolha de texto. */
  fileName?: string;
  isInternal?: boolean;
  mentionedUserIds?: string[];
  sentAt: string;
  deliveredAt?: string;
  readAt?: string;
  createdAt?: string;
}

// ---- Pagination & Filters ----
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DateRange {
  startDate: string;
  endDate: string;
}

export interface SortConfig {
  field: string;
  direction: 'asc' | 'desc';
}

// ============================================
// Enterprise Mode & Integrations
// ============================================

export type IntegrationProvider =
  | 'stripe'
  | 'vercel'
  | 'resend'
  | 'sentry'
  | 'cloudflare'
  | 'aws'
  | 'supabase'
  | 'godaddy';

export interface IntegrationConfig {
  provider: IntegrationProvider;
  apiKey: string; // stored encrypted in Firestore
  isActive: boolean;
  connectedAt?: string;
  lastSyncAt?: string;
  status: IntegrationStatus;
  metadata?: Record<string, unknown>;
}

export interface EnterpriseSettings {
  isEnabled: boolean;
  enabledAt?: string;
  integrations: IntegrationConfig[];
  apiKeys: SaasApiKey[];
}

export interface SaasApiKey {
  id: string;
  name: string;
  keyPrefix: string; // first 8 chars for display (e.g., "sp_live_a3")
  keyHash: string; // SHA-256 hash of full key
  scopes: ApiKeyScope[];
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  createdBy: string;
  createdByName: string;
  status: 'active' | 'revoked';
  businessId: string;
}

export type ApiKeyScope =
  | 'read:clients'
  | 'write:clients'
  | 'read:appointments'
  | 'write:appointments'
  | 'read:services'
  | 'write:services'
  | 'read:financial'
  | 'write:financial'
  | 'read:products'
  | 'write:products'
  | 'read:kanban'
  | 'write:kanban'
  | 'read:crm'
  | 'write:crm'
  | 'read:sales'
  | 'write:sales'
  | 'read:conversations'
  | 'write:conversations'
  | 'read:fiscal'
  | 'write:fiscal'
  | 'read:broadcasts'
  | 'write:broadcasts'
  | 'read:segments'
  | 'write:segments'
  | 'read:snippets'
  | 'write:snippets'
  | 'read:sectors'
  | 'write:sectors'
  | 'read:users'
  | 'write:users'
  | 'admin:all';

export const API_KEY_SCOPE_LABELS: Record<ApiKeyScope, string> = {
  'read:clients': 'Ler clientes',
  'write:clients': 'Criar/editar clientes',
  'read:appointments': 'Ler agendamentos',
  'write:appointments': 'Criar/editar agendamentos',
  'read:services': 'Ler serviços',
  'write:services': 'Criar/editar serviços',
  'read:financial': 'Ler transações financeiras',
  'write:financial': 'Criar/editar transações',
  'read:products': 'Ler produtos/estoque',
  'write:products': 'Criar/editar produtos',
  'read:kanban': 'Ler boards e cards',
  'write:kanban': 'Criar/editar boards e cards',
  'read:crm': 'Ler contatos, deals e atividades CRM',
  'write:crm': 'Criar/editar contatos, deals e atividades',
  'read:sales': 'Ler vendas',
  'write:sales': 'Criar vendas',
  'read:conversations': 'Ler conversas e mensagens',
  'write:conversations': 'Enviar mensagens',
  'read:fiscal': 'Ler documentos fiscais',
  'write:fiscal': 'Emitir/cancelar documentos fiscais',
  'read:broadcasts': 'Ler campanhas',
  'write:broadcasts': 'Criar/enviar campanhas',
  'read:segments': 'Ler segmentos',
  'write:segments': 'Criar/editar segmentos',
  'read:snippets': 'Ler respostas rápidas',
  'write:snippets': 'Criar/editar respostas rápidas',
  'read:sectors': 'Ler setores',
  'write:sectors': 'Criar/editar setores',
  'read:users': 'Ler membros da equipe',
  'write:users': 'Editar membros da equipe',
  'admin:all': 'Acesso total a todos os recursos',
};

export const API_KEY_SCOPE_GROUPS: { label: string; scopes: ApiKeyScope[] }[] = [
  { label: 'Clientes', scopes: ['read:clients', 'write:clients'] },
  { label: 'Agenda', scopes: ['read:appointments', 'write:appointments'] },
  { label: 'Serviços', scopes: ['read:services', 'write:services'] },
  { label: 'Financeiro', scopes: ['read:financial', 'write:financial'] },
  { label: 'Produtos & Estoque', scopes: ['read:products', 'write:products'] },
  { label: 'Vendas (PDV)', scopes: ['read:sales', 'write:sales'] },
  { label: 'Kanban', scopes: ['read:kanban', 'write:kanban'] },
  { label: 'CRM', scopes: ['read:crm', 'write:crm'] },
  { label: 'Conversas', scopes: ['read:conversations', 'write:conversations'] },
  { label: 'Fiscal', scopes: ['read:fiscal', 'write:fiscal'] },
  { label: 'Campanhas', scopes: ['read:broadcasts', 'write:broadcasts'] },
  { label: 'Segmentos', scopes: ['read:segments', 'write:segments'] },
  { label: 'Respostas Rápidas', scopes: ['read:snippets', 'write:snippets'] },
  { label: 'Setores', scopes: ['read:sectors', 'write:sectors'] },
  { label: 'Usuários', scopes: ['read:users', 'write:users'] },
  { label: 'Admin Total', scopes: ['admin:all'] },
];

export const INTEGRATION_PROVIDERS: Record<IntegrationProvider, {
  name: string;
  description: string;
  icon: string;
  color: string;
  bgColor: string;
  darkBgColor: string;
  fields: { key: string; label: string; placeholder: string; help?: string }[];
}> = {
  stripe: {
    name: 'Stripe',
    description: 'Pagamentos, assinaturas e receita',
    icon: 'CreditCard',
    color: '#635BFF',
    bgColor: 'bg-[#635BFF]/10',
    darkBgColor: 'dark:bg-[#635BFF]/20',
    fields: [
      { key: 'apiKey', label: 'Secret Key', placeholder: 'sk_live_...', help: 'Encontre em Stripe Dashboard → Developers → API Keys' },
    ],
  },
  vercel: {
    name: 'Vercel',
    description: 'Deploys, domínios e performance',
    icon: 'Triangle',
    color: '#000000',
    bgColor: 'bg-black/10',
    darkBgColor: 'dark:bg-white/10',
    fields: [
      { key: 'apiKey', label: 'Access Token', placeholder: 'Bearer token...', help: 'Gere em Vercel Dashboard → Settings → Tokens' },
    ],
  },
  resend: {
    name: 'Resend',
    description: 'E-mails transacionais e delivery',
    icon: 'Mail',
    color: '#000000',
    bgColor: 'bg-black/10',
    darkBgColor: 'dark:bg-white/10',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 're_...', help: 'Encontre em Resend Dashboard → API Keys' },
    ],
  },
  sentry: {
    name: 'Sentry',
    description: 'Monitoramento de erros e release health',
    icon: 'Bug',
    color: '#362D59',
    bgColor: 'bg-[#362D59]/10',
    darkBgColor: 'dark:bg-[#362D59]/20',
    fields: [
      { key: 'apiKey', label: 'Auth Token', placeholder: 'sntrys_...', help: 'Gere em Sentry → Settings → Auth Tokens (escopo: project:read, org:read)' },
      { key: 'org', label: 'Organization Slug', placeholder: 'minha-org', help: 'Slug da organização visível na URL do Sentry' },
    ],
  },
  cloudflare: {
    name: 'Cloudflare',
    description: 'CDN, DNS, tráfego e segurança',
    icon: 'Shield',
    color: '#F6821F',
    bgColor: 'bg-[#F6821F]/10',
    darkBgColor: 'dark:bg-[#F6821F]/20',
    fields: [
      { key: 'apiKey', label: 'API Token', placeholder: 'Bearer token...', help: 'Crie em Cloudflare → My Profile → API Tokens (permissão: Zone Analytics)' },
    ],
  },
  aws: {
    name: 'AWS',
    description: 'Custos cloud, forecast e anomalias',
    icon: 'Cloud',
    color: '#FF9900',
    bgColor: 'bg-[#FF9900]/10',
    darkBgColor: 'dark:bg-[#FF9900]/20',
    fields: [
      { key: 'apiKey', label: 'Access Key ID', placeholder: 'AKIA...', help: 'Crie em AWS IAM → Users → Security Credentials (permissão: ce:*)' },
      { key: 'secretKey', label: 'Secret Access Key', placeholder: 'wJalrXUtnFEMI/...', help: 'Gerado junto com o Access Key ID' },
    ],
  },
  supabase: {
    name: 'Supabase',
    description: 'Banco de dados, auth e API health',
    icon: 'Database',
    color: '#3ECF8E',
    bgColor: 'bg-[#3ECF8E]/10',
    darkBgColor: 'dark:bg-[#3ECF8E]/20',
    fields: [
      { key: 'apiKey', label: 'Access Token', placeholder: 'sbp_...', help: 'Gere em Supabase → Account → Access Tokens' },
    ],
  },
  godaddy: {
    name: 'GoDaddy',
    description: 'Domínios, DNS e renovações',
    icon: 'Globe',
    color: '#1BDBDB',
    bgColor: 'bg-[#1BDBDB]/10',
    darkBgColor: 'dark:bg-[#1BDBDB]/20',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'API key...', help: 'Gere em GoDaddy Developer Portal → API Keys' },
      { key: 'apiSecret', label: 'API Secret', placeholder: 'Secret...', help: 'Gerado junto com a API Key' },
    ],
  },
};

export const API_KEY_SCOPES: Record<ApiKeyScope, { label: string; description: string }> = {
  'read:clients': { label: 'Ler Clientes', description: 'Acessar lista e dados de clientes' },
  'write:clients': { label: 'Escrever Clientes', description: 'Criar e editar clientes' },
  'read:appointments': { label: 'Ler Agenda', description: 'Acessar agendamentos' },
  'write:appointments': { label: 'Escrever Agenda', description: 'Criar e editar agendamentos' },
  'read:services': { label: 'Ler Serviços', description: 'Acessar serviços cadastrados' },
  'write:services': { label: 'Escrever Serviços', description: 'Criar e editar serviços' },
  'read:financial': { label: 'Ler Financeiro', description: 'Acessar transações e contas bancárias' },
  'write:financial': { label: 'Escrever Financeiro', description: 'Criar e editar transações e contas' },
  'read:products': { label: 'Ler Produtos', description: 'Acessar catálogo e estoque' },
  'write:products': { label: 'Escrever Produtos', description: 'Criar/editar produtos e movimentar estoque' },
  'read:kanban': { label: 'Ler Kanban', description: 'Acessar boards e cards' },
  'write:kanban': { label: 'Escrever Kanban', description: 'Criar e editar boards e cards' },
  'read:crm': { label: 'Ler CRM', description: 'Acessar contatos, deals e atividades' },
  'write:crm': { label: 'Escrever CRM', description: 'Criar/editar contatos, deals e atividades' },
  'read:sales': { label: 'Ler Vendas', description: 'Acessar histórico de vendas' },
  'write:sales': { label: 'Escrever Vendas', description: 'Criar vendas (PDV)' },
  'read:conversations': { label: 'Ler Conversas', description: 'Acessar conversas e mensagens omnichannel' },
  'write:conversations': { label: 'Enviar Mensagens', description: 'Enviar mensagens via WhatsApp/FB/IG' },
  'read:fiscal': { label: 'Ler Fiscal', description: 'Acessar NF-e, NFC-e e NFSe' },
  'write:fiscal': { label: 'Escrever Fiscal', description: 'Emitir e cancelar documentos fiscais' },
  'read:broadcasts': { label: 'Ler Campanhas', description: 'Acessar broadcasts e campanhas' },
  'write:broadcasts': { label: 'Escrever Campanhas', description: 'Criar e enviar campanhas em massa' },
  'read:segments': { label: 'Ler Segmentos', description: 'Acessar segmentos de audiência' },
  'write:segments': { label: 'Escrever Segmentos', description: 'Criar e editar segmentos' },
  'read:snippets': { label: 'Ler Respostas Rápidas', description: 'Acessar snippets/respostas rápidas' },
  'write:snippets': { label: 'Escrever Respostas', description: 'Criar e editar respostas rápidas' },
  'read:sectors': { label: 'Ler Setores', description: 'Acessar setores/departamentos' },
  'write:sectors': { label: 'Escrever Setores', description: 'Criar e editar setores' },
  'read:users': { label: 'Ler Usuários', description: 'Acessar membros da equipe' },
  'write:users': { label: 'Escrever Usuários', description: 'Editar membros da equipe' },
  'admin:all': { label: 'Admin Total', description: 'Acesso total a todos os recursos' },
};

// ============================================
// Sectors / Departments
// ============================================

export interface Sector {
  id: string;
  businessId: string;
  name: string;
  description?: string;
  color: string;
  icon?: string;
  leaderId?: string;
  leaderName?: string;
  memberIds: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const SECTOR_COLORS = [
  '#DC2626', '#EA580C', '#D97706', '#CA8A04',
  '#65A30D', '#16A34A', '#0D9488', '#0891B2',
  '#2563EB', '#4F46E5', '#7C3AED', '#9333EA',
  '#C026D3', '#DB2777', '#E11D48', '#64748B',
] as const;

export const SECTOR_ICONS = [
  'Briefcase', 'HeadphonesIcon', 'Megaphone', 'Code',
  'DollarSign', 'Heart', 'Truck', 'ShoppingCart',
  'Users', 'Settings', 'Shield', 'Zap',
] as const;

// ============================================
// Quick Replies / Snippets
// ============================================

export interface Snippet {
  id: string;
  businessId: string;
  shortcode: string;
  content: string;
  category?: string;
  sectorId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Team Chat (chat interno entre membros)
// ============================================
//
// Coleções dedicadas — separadas de `conversations` (omnichannel externo) pra
// não poluir filtros/relatórios. Fluxo:
//   • Global: 1 doc por business, ID determinístico `global_{businessId}`,
//     visível para todos os membros do tenant. memberIds fica vazio.
//   • DM: ID determinístico `dm_{[uidA,uidB].sort().join('_')}` pra evitar
//     duplicatas; visível apenas pelos 2 participantes.
//
// Unread = `lastMessageAt > lastReadAt[uid]`. Boolean é suficiente pra badge;
// contagem exata sai mais barata se evoluirmos pra contador no doc depois.

export type TeamChatType = 'dm' | 'global';

export interface TeamChat {
  id: string;
  businessId: string;
  type: TeamChatType;
  /** DM: [uidA, uidB] ordenados; global: vazio (todos do business têm acesso). */
  memberIds: string[];
  lastMessage?: {
    text: string;
    senderId: string;
    senderName: string;
    sentAt: string;
  };
  /** ISO duplicado de lastMessage.sentAt — usado pra ordenar e pra unread. */
  lastMessageAt?: string;
  /** uid → ISO da última leitura. Comparado com lastMessageAt. */
  lastReadAt: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface TeamChatMessage {
  id: string;
  businessId: string;
  chatId: string;
  senderId: string;
  senderName: string;
  senderInitials: string;
  senderPhotoURL?: string;
  text: string;
  createdAt: string;
}

// ============================================
// AI Chat Messages (histórico persistente do AIAgentProvider)
// ============================================
//
// Coleção `aiChatMessages` — uma mensagem por doc. Histórico per-user (cada
// pessoa tem sua conversa privada com o agente). Sem update — mensagens
// imutáveis após create. Delete só pra clear-all.

export type AIChatMessageRole = 'user' | 'assistant';
export type AIChatMessageMode = 'operator' | 'analyst';

export interface AIChatMessageDoc {
  id: string;
  businessId: string;
  userId: string;
  mode: AIChatMessageMode;
  role: AIChatMessageRole;
  content: string;
  /** ISO. Timestamp do client — usado pra ordenação e exibição. */
  createdAt: string;
  // Metadados do agente (só presentes em mensagens de assistant).
  runId?: string;
  toolCalls?: Array<{ name: string; args?: unknown; error?: string }>;
  costUsd?: number;
  durationMs?: number;
  isFallback?: boolean;
}

// ============================================
// CRM Segments
// ============================================

export type SegmentFilterOperator = 'eq' | 'neq' | 'contains' | 'not_contains' | 'gt' | 'lt' | 'in' | 'not_in';

export interface SegmentFilter {
  field: string;
  operator: SegmentFilterOperator;
  value: string | string[] | number | boolean;
}

/** Grupo de filtros — condições AND dentro do grupo; grupos combinados com OR */
export interface SegmentFilterGroup {
  id: string;
  filters: SegmentFilter[];
}

export interface Segment {
  id: string;
  businessId: string;
  name: string;
  description?: string;
  /** @deprecated use filterGroups. Treated as a single AND group. */
  filters: SegmentFilter[];
  /** OR entre grupos; AND dentro de cada grupo */
  filterGroups?: SegmentFilterGroup[];
  contactCount?: number;
  lastCalculatedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Broadcasts / Campaigns
// ============================================

export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'failed';
export type BroadcastAudienceType = 'segment' | 'tags' | 'all_contacts' | 'manual' | 'list';

/** Recipiente direto de uma lista (paste/CSV) — não exige contato CRM. */
export interface BroadcastRecipient {
  /** Auto-vinculado se número/email bater com cliente CRM existente. */
  contactId?: string;
  name?: string;
  /** Telefone em formato E.164 (apenas dígitos). Para canais WhatsApp. */
  phoneNumber?: string;
  email?: string;
  /**
   * Colunas extras vindas de CSV importado (5.8). Chaves são nomes de
   * coluna normalizados (lowercase), valores são strings cruas. Disponível
   * para mapear `{{N}}` em templates Meta via `BroadcastTemplateParam.csvColumn`.
   */
  customColumns?: Record<string, string>;
}

/**
 * Mapeamento de variável de template WhatsApp ({{1}}, {{2}}, etc.) para um valor
 * resolvido por recipiente no momento do envio.
 *
 * - `literal`: valor fixo igual para todos (ex: "R$ 100" ou "BlackFriday2026")
 * - `field`: lê do recipiente — name / phoneNumber / email
 * - `csvColumn`: lê de uma coluna extra do CSV importado (ex: "produto", "desconto").
 *   `column` é o nome da coluna normalizado (lowercase). Resolvido via
 *   `recipient.customColumns[column]` no backend; vai vazio se ausente.
 */
export type BroadcastTemplateParam =
  | { kind: 'literal'; value: string }
  | { kind: 'field'; field: 'name' | 'phoneNumber' | 'email' }
  | { kind: 'csvColumn'; column: string };

export interface BroadcastStats {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  replied: number;
}

/** Canais suportados em broadcasts — inclui email (não disponível em conversations). */
export type BroadcastChannel = ConversationChannel | 'email';

/**
 * Base legal do envio (LGPD art. 7º). Persistido em cada `Broadcast` para
 * que, em caso de auditoria/multa, o tenant possa justificar por que
 * enviou para aquele recipiente.
 *
 * - `explicit`: opt-in explícito (formulário com checkbox, double opt-in).
 *   Mais forte, recomendado para listas frias.
 * - `legitimate-interest`: relação prévia (cliente que comprou recentemente,
 *   lead que pediu cotação). Aceitável para comunicações relacionadas ao
 *   produto/serviço já contratado.
 * - `transactional`: notificação operacional (confirmação de pedido,
 *   alteração de status, fatura). Não é "marketing" — sem opt-out exigido.
 */
export type ConsentBasis = 'explicit' | 'legitimate-interest' | 'transactional';

export const CONSENT_BASIS_LABELS: Record<ConsentBasis, string> = {
  'explicit': 'Opt-in explícito (formulário/checkbox)',
  'legitimate-interest': 'Interesse legítimo (cliente/lead com relação prévia)',
  'transactional': 'Comunicação transacional (não-marketing)',
};

/**
 * Configuração de throttling/anti-spam para o envio de broadcasts.
 *
 * Substitui o `sendRate` fixo (mensagens/segundo) por delays aleatórios que
 * simulam comportamento humano e batches com pausas longas para reduzir
 * detecção de spam (especialmente em Baileys, onde envio uniforme rápido é
 * sinal claro de bot).
 *
 *   delayMin/MaxMs: delay aleatório entre cada mensagem (em ms).
 *     Picked uniformly. Ex: min=5000, max=15000 → 5–15s humanizado.
 *
 *   batchSize: quantas msgs em cada lote antes de pausa longa.
 *     0/undefined = sem batching. Ex: 30 → pausa a cada 30 msgs.
 *
 *   batchPauseMin/MaxMs: pausa aleatória entre lotes (em ms).
 *     Ex: min=120000, max=300000 → pausa de 2–5min entre grupos.
 */
export interface SendThrottle {
  delayMinMs: number;
  delayMaxMs: number;
  batchSize?: number;
  batchPauseMinMs?: number;
  batchPauseMaxMs?: number;
}

/** Presets prontos — usuário escolhe o perfil ou customiza valores. */
export const THROTTLE_PRESETS = {
  fast: {
    label: 'Rápido (Cloud — sem risco)',
    description: 'Sem delay simulado. Use só com WhatsApp Cloud / Email.',
    throttle: { delayMinMs: 100, delayMaxMs: 500 } satisfies SendThrottle,
  },
  human: {
    label: 'Humano (recomendado)',
    description: 'Simula digitação humana. Pausa longa a cada 30 msgs.',
    throttle: {
      delayMinMs: 5_000, delayMaxMs: 15_000,
      batchSize: 30,
      batchPauseMinMs: 120_000, batchPauseMaxMs: 300_000,
    } satisfies SendThrottle,
  },
  conservative: {
    label: 'Conservador (Baileys — alto risco)',
    description: 'Mais lento, batches menores. Indicado pra Baileys em volume.',
    throttle: {
      delayMinMs: 15_000, delayMaxMs: 45_000,
      batchSize: 20,
      batchPauseMinMs: 300_000, batchPauseMaxMs: 900_000,
    } satisfies SendThrottle,
  },
} as const;

export type ThrottlePresetKey = keyof typeof THROTTLE_PRESETS;

export interface Broadcast {
  id: string;
  businessId: string;
  name: string;
  channel: BroadcastChannel;
  audienceType: BroadcastAudienceType;
  audienceSegmentId?: string;
  audienceTags?: string[];
  audienceContactIds?: string[];
  /** Lista direta de recipientes (paste/CSV) — usado quando audienceType === 'list'. */
  recipients?: BroadcastRecipient[];
  /** ID do broadcast original quando este é um retry — auditoria. */
  retryOf?: string;
  /** Quando true e channel === 'whatsapp', envia via Baileys (WhatsApp Web) em vez de Cloud API. */
  viaBaileys?: boolean;
  /**
   * ID da `channelConnections/{id}` específica que vai disparar o broadcast.
   *
   * Quando presente, o backend `/api/broadcasts/send` usa essa connection
   * exata — permite ao operador escolher entre múltiplas Baileys (empresa ou
   * pessoal) ou múltiplas Cloud (raro). Quando ausente (broadcast antigo ou
   * UI básica), o backend faz fallback pra primary 'business' do tipo.
   *
   * Regra: se `viaBaileys=true` e o operador quer usar seu Baileys pessoal,
   * este campo precisa estar setado — sem ele, o backend cai em `business`.
   */
  channelConnectionId?: string;
  messageType: 'template' | 'text';
  templateName?: string;
  templateLanguage?: string;
  /** Mapeamento de variáveis ({{1}}, {{2}}, ...) — resolvido per-recipiente no envio. */
  templateParams?: BroadcastTemplateParam[];
  /**
   * Corpo cru do template (body com `{{N}}` placeholders) capturado do
   * TemplateSelector na criação. Persistido pra que /api/broadcasts/send
   * consiga renderizar conteúdo real por destinatário ao criar registro
   * em conversationMessages — sem isso, a aba Conversas mostrava só
   * "[Template: nome]" no lugar do texto enviado.
   */
  templateBody?: string;
  messageContent?: string;
  /** Assunto para canal email (broadcasts via notification-server). */
  emailSubject?: string;
  scheduledAt?: string;
  /** @deprecated Use `throttle` em vez disso. Mantido pra compatibilidade. */
  sendRate?: number;
  /**
   * Configuração de delay/batch entre envios. Quando presente, sobrepõe
   * `sendRate` no backend. Permite simular digitação humana (delays
   * aleatórios) e batches com pausas longas para reduzir detecção de spam.
   */
  throttle?: SendThrottle;
  status: BroadcastStatus;
  stats: BroadcastStats;
  /** Base legal LGPD do envio. Obrigatório a partir de 5.12. */
  consentBasis?: ConsentBasis;
  /** Descrição livre da fonte do consentimento (ex: "Form X 2026-01", "Importado de Mailchimp"). */
  consentSource?: string;
  /** Timestamp ISO em que o operador confirmou ter base legal antes de criar a campanha. */
  consentAcknowledgedAt?: string;
  /** UID do operador que confirmou — auditoria de quem aprovou cada envio. */
  consentAcknowledgedBy?: string;
  createdBy: string;
  createdByName: string;
  startedAt?: string;
  completedAt?: string;
  /** Mensagem de erro última (ex: campanha legada sem consentBasis, falha geral). */
  errorMessage?: string;
  /** Timestamp ISO do último reset manual (auditoria). */
  lastResetAt?: string;
  /** UID do admin que resetou (auditoria). */
  lastResetBy?: string;
  /**
   * Sessões de envio. Cada vez que o operador dispara (parcial ou total),
   * cria-se uma sessão. Permite split de campanha em batches escalonados
   * (25% agora, 50% depois, etc) com tracking individual por sessão.
   * BroadcastMessage.sessionIndex referencia o `index` daqui.
   * Vazio em broadcasts criados antes desta feature (legado).
   */
  sessions?: BroadcastSession[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Metadado de uma sessão de envio dentro de um broadcast. Stats por sessão
 * são derivadas client-side filtrando broadcastMessages por sessionIndex —
 * não duplicamos contadores aqui pra evitar drift entre cache e fonte real.
 */
export interface BroadcastSession {
  /** Sequencial: 1 = primeiro dispatch, 2 = primeira retomada, etc. */
  index: number;
  /** ISO — quando o operador clicou Disparar/Retomar pra esta sessão. */
  dispatchedAt: string;
  /** Quantidade pedida pelo operador (recipients realmente processados nesta sessão). */
  recipientCount: number;
  /** UID e nome de quem disparou — auditoria por sessão. */
  dispatchedBy?: string;
  dispatchedByName?: string;
}

/**
 * Campanha recorrente de aniversário. Diferente de Broadcast (one-shot,
 * lista fixa de recipients): é uma REGRA que o cron varre diariamente
 * pra encontrar clientes cujo `birthDate` bate com hoje + daysBefore, e
 * dispara mensagem personalizada pra cada um.
 *
 * Idempotência por (campaignId, clientId, ano) evita disparos duplicados
 * quando cron roda múltiplas vezes — implementado em PR-C como sub-coleção
 * `birthdayCampaignLogs`.
 */
export interface BirthdayCampaign {
  id: string;
  businessId: string;
  name: string;                            // ex: "Promoção 10% no aniversário"
  enabled: boolean;                        // toggle pausa/ativa

  // ── Quando dispara ─────────────────────────────
  /** Dias ANTES do aniversário pra disparar. 0 = no dia, 7 = uma semana antes. */
  daysBeforeBirthday: number;
  /** Hora do envio (0-23) no fuso do business. PR-C respeita timezone. */
  sendAtHour: number;

  // ── Canal ──────────────────────────────────────
  /** Hoje só WhatsApp; estrutura prevê email/outros no futuro. */
  channel: 'whatsapp';
  viaBaileys: boolean;
  channelConnectionId?: string;

  // ── Conteúdo ───────────────────────────────────
  /** Pra Baileys (texto livre). Suporta placeholders {{name}}, {{phone}}. */
  messageContent?: string;
  /** Pra Cloud — template name aprovado na Meta. */
  templateName?: string;
  templateLanguage?: string;
  /** Mapeamento de variáveis do template (mesma estrutura de Broadcast). */
  templateParams?: BroadcastTemplateParam[];
  /** Body cru do template — usado pra renderizar preview na conversa. */
  templateBody?: string;

  // ── Filtro de quem entra ───────────────────────
  filters?: {
    tipo?: 'pf' | 'pj' | 'all';
    /** Lista de status que são elegíveis. Vazio/undefined = todos. */
    status?: LeadStatus[];
    /** Cliente precisa ter TODAS essas tags. */
    tags?: string[];
    /** Restringe a um setor. */
    sectorId?: string;
  };

  // ── Stats acumulados (cron incrementa) ─────────
  stats: {
    totalSent: number;
    totalDelivered: number;
    totalRead: number;
    totalFailed: number;
    /** ISO da última execução do cron pra esta campanha. */
    lastRanAt?: string;
    /** Quantos clientes elegíveis foram encontrados na última run. */
    lastRunMatched?: number;
  };

  // ── LGPD ───────────────────────────────────────
  /** Base legal — aniversário tipicamente é 'legitimate-interest'
   *  (relacionamento de cliente) ou 'transactional'. */
  consentBasis: ConsentBasis;
  consentSource?: string;
  consentAcknowledgedAt?: string;
  consentAcknowledgedBy?: string;

  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export type BroadcastMessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface BroadcastMessage {
  id: string;
  broadcastId: string;
  businessId: string;
  /** Opcional — só preenchido quando recipiente foi vinculado a um cliente CRM. */
  contactId?: string;
  /** Opcional — pode vir do CRM, da lista importada ou ficar vazio. */
  contactName?: string;
  /** Identificador externo do recipiente (telefone E.164 para WA, endereço para email). */
  recipientId: string;
  /** Email do recipiente — preenchido em broadcasts de canal email. */
  email?: string;
  status: BroadcastMessageStatus;
  externalMessageId?: string;
  errorMessage?: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  /** Snapshot da base legal LGPD no momento do envio (rastreabilidade per-msg). */
  consentBasis?: ConsentBasis;
  /** Snapshot das colunas extras do CSV (5.8) para reconstrução em resume/retry. */
  customColumns?: Record<string, string>;
  /**
   * Sessão de envio à qual esta mensagem pertence. 1 = primeiro dispatch
   * da campanha, 2 = primeira retomada parcial, etc. Tagado pelo /send
   * no pre-create dos broadcastMessages. Vazio em broadcasts antigos
   * (legado) — UI lida graciosamente como "sem sessão".
   */
  sessionIndex?: number;
  createdAt: string;
}

/**
 * Lista de recipientes salva e reusável em campanhas futuras.
 * Útil quando o usuário quer reaproveitar a mesma lista (ex: clientes inativos,
 * leads de webinar) sem precisar colar/importar a cada nova campanha.
 *
 * Tipo (`phone` | `email` | `mixed`) é derivado do conteúdo na criação para
 * permitir filtrar listas compatíveis com o canal escolhido na UI.
 */
export type BroadcastListType = 'phone' | 'email' | 'mixed';

export interface BroadcastList {
  id: string;
  businessId: string;
  name: string;
  description?: string;
  type: BroadcastListType;
  recipients: BroadcastRecipient[];
  /** Cache do tamanho — atualizado junto com `recipients`. */
  recipientCount: number;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Registro de opt-out de marketing por contato. Compartilhado entre canais —
 * uma entrada `email|john@x.com` bloqueia também eventuais campanhas para o
 * mesmo email no futuro, mesmo que o contato CRM seja apagado/recriado.
 *
 * Document ID = `${businessId}_${channel}_${identifier_normalizado}` para
 * lookup O(1) sem query (e idempotência — múltiplos opt-outs do mesmo email
 * sobrescrevem o mesmo doc).
 */
export type OptOutChannel = 'email' | 'whatsapp' | 'all';
export type OptOutSource = 'unsubscribe-link' | 'whatsapp-keyword' | 'manual' | 'bounce' | 'complaint';

export interface MarketingOptOut {
  id: string;
  businessId: string;
  channel: OptOutChannel;
  /** Email lowercase OU phoneNumber E.164 (sem +). */
  identifier: string;
  source: OptOutSource;
  optedOutAt: string;
  /** ID do broadcast/campanha que originou o opt-out (rastreabilidade). */
  broadcastId?: string;
  /** Texto da resposta do usuário quando source='whatsapp-keyword'. */
  reasonText?: string;
}

export const LIFECYCLE_STAGE_LABELS: Record<LifecycleStage, string> = {
  new_lead: 'Novo Lead',
  contacted: 'Contatado',
  qualified: 'Qualificado',
  proposal: 'Proposta',
  negotiation: 'Negociação',
  customer: 'Cliente',
  churned: 'Perdido',
};

export const LIFECYCLE_STAGE_COLORS: Record<LifecycleStage, string> = {
  new_lead: '#3B82F6',
  contacted: '#8B5CF6',
  qualified: '#F59E0B',
  proposal: '#EC4899',
  negotiation: '#F97316',
  customer: '#10B981',
  churned: '#EF4444',
};

// ============================================
// Vendas (B2B Orders)
// ============================================

export type OrderStatus =
  | 'pendente'
  | 'confirmado'
  | 'condicional'
  | 'faturado'
  | 'enviado'
  | 'entregue'
  | 'cancelado';

export type OrderType = 'pdv' | 'b2b' | 'condicional';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pendente:    'Pendente',
  confirmado:  'Confirmado',
  condicional: 'Condicional',
  faturado:    'Faturado',
  enviado:     'Enviado',
  entregue:    'Entregue',
  cancelado:   'Cancelado',
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  pendente:    'bg-gray-100 text-gray-700 dark:bg-gray-700/40 dark:text-gray-300',
  confirmado:  'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  condicional: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  faturado:    'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
  enviado:     'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300',
  entregue:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  cancelado:   'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
};

export interface OrderItem {
  productId?: string;
  productName: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  total: number;
  unit?: string;
  ncm?: string;
  cfop?: string;
}

export interface OrderStatusHistoryEntry {
  status: OrderStatus;
  timestamp: string;
  note?: string;
  userId: string;
  userName: string;
}

export interface Order {
  id: string;
  businessId: string;
  type: OrderType;
  status: OrderStatus;
  // Client
  clientId?: string;
  clientName?: string;
  clientCpfCnpj?: string;
  // Items & pricing
  items: OrderItem[];
  subtotal: number;
  discount: number;
  total: number;
  // Payment
  payments?: Payment[];
  paymentTerms?: string;        // ex: "30/60/90 dias"
  paymentMethod?: PaymentMethod;
  // Delivery
  deliveryDate?: string;
  deliveryAddress?: Address;
  // Fiscal
  fiscalDocId?: string;
  naturezaOperacao?: string;
  // Conditional sale
  conditionalExpiresAt?: string; // data limite para o cliente confirmar
  conditionalReturnDate?: string; // data de retorno do produto se não confirmar
  // Notes
  notes?: string;
  internalNotes?: string;
  // Tracking
  statusHistory?: OrderStatusHistoryEntry[];
  operatorId: string;
  operatorName: string;
  sectorId?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Compras / Purchase Notes
// ============================================

export type PurchaseNoteStatus = 'pendente' | 'importada' | 'cancelada';

export type PurchaseNoteItemAction = 'match' | 'create' | 'skip';

export interface PurchaseNoteItem {
  productId?: string;          // matched product in our catalog
  productName: string;
  cProd?: string;              // supplier product code
  ncm?: string;
  cfop?: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  total: number;
  // Taxes
  icms?: number;
  ipi?: number;
  pis?: number;
  cofins?: number;
  // Import action
  importAction?: PurchaseNoteItemAction;
}

export interface PurchaseNote {
  id: string;
  businessId: string;
  accessKey: string;            // chave de acesso 44 digits
  numero: string;
  serie: string;
  issueDate: string;
  // Supplier
  supplierName: string;
  supplierCnpj: string;
  supplierId?: string;
  // Items & totals
  items: PurchaseNoteItem[];
  totalProducts: number;
  totalTaxes: number;
  totalValue: number;
  // Status
  status: PurchaseNoteStatus;
  // Files
  xmlUrl?: string;
  xml?: string;
  // Notes
  notes?: string;
  importedAt?: string;
  // Stock import tracking — set when items are pushed to inventory as stockMovements.
  // Once present, re-importing is blocked (idempotency).
  stockImportedAt?: string;
  stockMovementIds?: string[];          // ids of stockMovements created for this note
  unmatchedItems?: Array<{ productName: string; quantity: number; cProd?: string }>;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Suppliers
// ============================================

export interface Supplier {
  id: string;
  businessId: string;
  razaoSocial: string;
  nomeFantasia?: string;
  cnpj: string;
  inscricaoEstadual?: string;
  phone?: string;
  email?: string;
  endereco?: Address;
  notes?: string;
  isActive: boolean;
  totalPurchases?: number;
  lastPurchaseAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Loyalty Program
// ============================================

export type LoyaltyTransactionType = 'acumulo' | 'resgate' | 'expiracao' | 'ajuste';

export interface LoyaltyTransaction {
  id: string;
  businessId: string;
  clientId: string;
  clientName: string;
  type: LoyaltyTransactionType;
  /** Positivo = ganho, negativo = resgate/expiração */
  points: number;
  balanceAfter: number;
  description: string;
  /** ID da venda ou agendamento que originou o movimento */
  sourceId?: string;
  sourceType?: 'sale' | 'appointment';
  expiresAt?: string;
  createdAt: string;
}

// ============================================
// Gift Cards
// ============================================

export type GiftCardStatus = 'active' | 'used' | 'expired' | 'cancelled';

export interface GiftCard {
  id: string;
  businessId: string;
  /** Código único de 8 caracteres (uppercase, sem caracteres ambíguos) */
  code: string;
  originalValue: number;
  remainingValue: number;
  status: GiftCardStatus;
  /** Nome ou email do presenteado (opcional) */
  recipientName?: string;
  recipientPhone?: string;
  /** ID da venda de compra do gift card */
  purchasedBySaleId?: string;
  /** ID da venda de resgate */
  usedBySaleId?: string;
  expiresAt?: string;
  purchasedAt: string;
  usedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Notifications ----

export type NotificationType =
  | 'task_assigned'
  | 'task_due_soon'
  | 'task_overdue'
  | 'task_mentioned'
  | 'appointment_reminder'
  | 'review_received'
  | 'conversation_assigned';

export interface AppNotification {
  id: string;
  businessId: string;
  userId: string;           // recipient
  type: NotificationType;
  title: string;
  body: string;
  isRead: boolean;
  link?: string;            // e.g. 'Kanban' to navigate to module
  relatedId?: string;       // card id, appointment id, etc.
  actorId?: string;         // who triggered (for assigned/mentioned)
  actorName?: string;
  createdAt: string;
}

// ---- CRM Automations ----

export type CRMAutomationTrigger =
  | 'client_inactive'       // no visit/contact in X days
  | 'client_birthday'       // birthday today
  | 'post_appointment'      // X hours after a completed appointment
  | 'lifecycle_change'      // lifecycle stage changed to X
  | 'high_churn_risk'       // churn risk score > threshold
  | 'new_lead';             // new contact created

export type CRMAutomationActionType =
  | 'send_whatsapp'         // send WhatsApp message
  | 'create_task'           // create Kanban card
  | 'add_tag'               // add tag to contact
  | 'change_lifecycle'      // change lifecycle stage
  | 'notify_team';          // send in-app notification to team

export interface CRMAutomationCondition {
  field: string;            // e.g. 'totalSpent', 'visitCount', 'tags', 'lifecycleStage'
  operator: 'gt' | 'lt' | 'eq' | 'contains' | 'not_contains';
  value: string | number;
}

export interface CRMAutomationAction {
  type: CRMAutomationActionType;
  value: string;            // message template, tag name, stage, task title, etc.
  metadata?: Record<string, unknown>;  // e.g. { boardId, columnId } for create_task
}

export interface CRMAutomationRule {
  id: string;
  businessId: string;
  name: string;
  trigger: CRMAutomationTrigger;
  triggerConfig: Record<string, unknown>;  // e.g. { inactiveDays: 30 }, { hoursAfter: 24 }, { stage: 'customer' }
  conditions: CRMAutomationCondition[];    // AND conditions — all must match
  actions: CRMAutomationAction[];
  isActive: boolean;
  lastRunAt?: string;
  totalExecutions: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Intake / Anamnese Forms ----

export type FormFieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'radio' | 'checkbox' | 'file';

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  placeholder?: string;
  required: boolean;
  options?: string[];         // for select, radio, checkbox
  helperText?: string;
}

export interface FormTemplate {
  id: string;
  businessId: string;
  name: string;               // "Anamnese Facial", "Ficha Capilar"
  description?: string;
  serviceId?: string;         // optional — auto-trigger when this service is booked
  fields: FormField[];
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface FormResponse {
  id: string;
  businessId: string;
  templateId: string;
  templateName: string;       // denormalized for display
  clientId: string;
  clientName: string;         // denormalized
  appointmentId?: string;     // optional link to appointment
  responses: Record<string, unknown>;  // fieldId → value
  submittedAt: string;
  submittedVia: 'link' | 'operator' | 'booking';
}

// ---- Reviews & NPS ----

export type ReviewSource = 'internal' | 'google' | 'whatsapp';

export interface Review {
  id: string;
  businessId: string;
  clientId?: string;
  clientName?: string;
  professionalId?: string;
  professionalName?: string;
  serviceId?: string;
  serviceName?: string;
  appointmentId?: string;
  rating: number;             // 1-5 stars
  comment?: string;
  source: ReviewSource;
  createdAt: string;
}

// ---- TEF (Transferência Eletrônica de Fundos) ----

export type TEFProvider = 'stone' | 'cielo' | 'rede' | 'getnet' | 'safrapay' | 'pagseguro';
export type TEFTransactionStatus = 'pending' | 'approved' | 'declined' | 'cancelled' | 'error';

export interface TEFConfig {
  provider: TEFProvider;
  terminalId: string;
  merchantId: string;
  isActive: boolean;
  connectedAt?: string;
}

export interface TEFTransaction {
  id: string;
  businessId: string;
  saleId: string;
  amount: number;
  installments: number;
  cardBrand?: string;
  authCode?: string;
  nsu?: string;
  status: TEFTransactionStatus;
  receipt?: string;       // comprovante text
  createdAt: string;
}

// ---- Payment Gateway (PIX QR + Link) ----

export type PaymentGatewayProvider = 'asaas' | 'pagarme' | 'mercadopago' | 'stripe';
export type PaymentIntentStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'cancelled' | 'expired';

export interface PaymentGatewayConfig {
  provider: PaymentGatewayProvider;
  apiKey: string;          // encrypted
  webhookSecret?: string;  // encrypted
  isActive: boolean;
  sandbox: boolean;
  connectedAt?: string;
}

export interface PaymentIntent {
  id: string;
  businessId: string;
  saleId?: string;
  amount: number;
  method: 'pix' | 'credit' | 'debit' | 'boleto';
  status: PaymentIntentStatus;
  qrCode?: string;         // PIX QR code (base64 or copia-e-cola)
  paymentUrl?: string;      // link de pagamento
  gatewayId?: string;       // ID no gateway
  paidAt?: string;
  expiresAt?: string;
  createdAt: string;
}

// ---- Memberships / Assinaturas ----

export type MembershipBillingCycle = 'monthly' | 'quarterly' | 'yearly';
export type MembershipStatus = 'active' | 'paused' | 'cancelled' | 'expired';

export interface Membership {
  id: string;
  businessId: string;
  name: string;
  description?: string;
  serviceIds: string[];     // services included in the plan
  price: number;
  billingCycle: MembershipBillingCycle;
  maxUsesPerCycle?: number; // null = unlimited
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClientMembership {
  id: string;
  businessId: string;
  clientId: string;
  clientName: string;
  membershipId: string;
  membershipName: string;   // denormalized
  status: MembershipStatus;
  startDate: string;
  nextBillingDate?: string;
  usesThisCycle: number;
  createdAt: string;
  updatedAt: string;
}

// ---- No-show Protection ----

export interface NoShowPolicy {
  isEnabled: boolean;
  requireDeposit: boolean;
  depositPercentage?: number;      // % of service price
  depositFixedAmount?: number;     // fixed amount in BRL
  cancellationDeadlineHours: number; // hours before appointment
  noShowFeePercentage?: number;    // % charged on no-show
}

// ---- Google Calendar Sync ----

export interface CalendarSyncToken {
  id: string;
  uid: string;              // Firebase Auth uid
  businessId: string;
  provider: 'google';
  accessToken: string;      // encrypted
  refreshToken: string;     // encrypted
  expiresAt: string;        // ISO — when accessToken expires
  calendarId: string;       // usually 'primary'
  isActive: boolean;
  connectedAt: string;
  lastSyncAt?: string;
}
