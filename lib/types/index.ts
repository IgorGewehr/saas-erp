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
  serviceIds?: string[];            // Service IDs this professional offers
  workingHours?: WorkingHours;      // Weekly availability schedule
  commissionRate?: number;          // Commission percentage (0–100). e.g. 30 = 30% of appointment price
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
  // Omnichannel (WhatsApp, Facebook, Instagram)
  channels?: ChannelCredentials;
  // Status
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- Omnichannel Channel Credentials ----
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
  // Uses Facebook pageAccessToken
  accountName?: string;
  connectedAt?: string;
  disconnectedAt?: string;
}

export interface MetaAppConfig {
  appId: string;
  appSecret: string; // btoa encrypted
  webhookVerifyToken: string;
}

export interface ChannelCredentials {
  whatsapp?: WhatsAppChannelConfig;
  facebook?: FacebookChannelConfig;
  instagram?: InstagramChannelConfig;
  meta?: MetaAppConfig;
  connectedVia?: 'embedded_signup' | 'manual';
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

export type UseCase = 'pedidos' | 'servicos' | 'times' | 'simples';

export const USE_CASE_LABELS: Record<UseCase, string> = {
  pedidos: 'Pedidos & Entregas',
  servicos: 'Prestador de Serviços',
  times: 'Gestão de Times',
  simples: 'Essencial',
};

export const USE_CASE_DESCRIPTIONS: Record<UseCase, string> = {
  pedidos: 'Para restaurantes, confeitarias e comércios que recebem pedidos para entrega. Inclui gerenciador de pedidos, cardápio e estoque com composições.',
  servicos: 'Para profissionais e clínicas com agendamentos. Inclui agenda com recorrência, controle de serviços e sincronização de métricas de clientes.',
  times: 'Para equipes que organizam trabalho em quadros Kanban. Foco em produtividade, atribuição e fluxo de tarefas.',
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
  /** Promoções ativas */
  promotions?: BusinessPromotion[];
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
  // Agent-driven automation tracking (idempotência)
  reminderSentAt?: string;
  confirmationRequestedAt?: string;
  followUpSentAt?: string;
  // Commission tracking — set when appointment is marked concluido
  commissionTransactionId?: string; // Firestore ID of the linked Transaction (category: 'Comissoes')
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
  /** Auditoria: identidade de quem criou/modificou. Preenchido nas mutações. */
  createdBy?: string;
  createdByName?: string;
  updatedBy?: string;
  updatedByName?: string;
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
  menuCategory?: string;        // Ex: "Pizzas", "Bebidas", "Sobremesas"
  menuDescription?: string;     // Short description for the menu card
  preparationTime?: number;     // Minutes — for delivery ETA
  /** Dietary markers — usados no cardápio e pelo agente para filtrar */
  dietary?: Array<'vegan' | 'vegetarian' | 'glutenfree' | 'lactosefree' | 'organic' | 'picante' | 'alcool' | 'kids'>;
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
  unitPrice: number;
  total: number;
  notes?: string;
  imageUrl?: string;
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
  totalSpent?: number;
  visitCount?: number;
  lastVisit?: string;

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
  status: ConversationStatus;
  contactName: string;
  contactPhone?: string;
  contactExternalId?: string;
  contactAvatarUrl?: string;
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
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
  deletedAt?: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  businessId: string;
  channel: ConversationChannel;
  direction: MessageDirection;
  content: string;
  status: MessageStatus;
  externalMessageId?: string; // Meta API message ID (wamid, mid)
  senderName?: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'audio' | 'video' | 'document';
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
// CRM Segments
// ============================================

export type SegmentFilterOperator = 'eq' | 'neq' | 'contains' | 'not_contains' | 'gt' | 'lt' | 'in' | 'not_in';

export interface SegmentFilter {
  field: string;
  operator: SegmentFilterOperator;
  value: string | string[] | number | boolean;
}

export interface Segment {
  id: string;
  businessId: string;
  name: string;
  description?: string;
  filters: SegmentFilter[];
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
export type BroadcastAudienceType = 'segment' | 'tags' | 'all_contacts' | 'manual';

export interface BroadcastStats {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  replied: number;
}

export interface Broadcast {
  id: string;
  businessId: string;
  name: string;
  channel: ConversationChannel;
  audienceType: BroadcastAudienceType;
  audienceSegmentId?: string;
  audienceTags?: string[];
  audienceContactIds?: string[];
  messageType: 'template' | 'text';
  templateName?: string;
  templateLanguage?: string;
  templateParams?: unknown[];
  messageContent?: string;
  scheduledAt?: string;
  sendRate?: number;
  status: BroadcastStatus;
  stats: BroadcastStats;
  createdBy: string;
  createdByName: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type BroadcastMessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface BroadcastMessage {
  id: string;
  broadcastId: string;
  businessId: string;
  contactId: string;
  contactName: string;
  recipientId: string;
  status: BroadcastMessageStatus;
  externalMessageId?: string;
  errorMessage?: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  createdAt: string;
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
