// ==========================================
// CORE TYPES - Service Provider Pro
// ==========================================

// ---- Auth & User Roles ----
export type UserRole = 'founder' | 'admin' | 'manager' | 'operator' | 'viewer';

export interface User {
  id: string;
  uid: string;
  email: string;
  name: string;
  phone?: string;
  photoURL?: string;
  role: UserRole;
  businessId: string;
  isActive: boolean;
  lastLoginAt?: string;
  invitedBy?: string;
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
  // Status
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
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

export interface BusinessSettings {
  timezone?: string;
  currency?: string;
  language?: string;
}

// ---- Fiscal Configuration ----
export interface FiscalConfig {
  // Certificate
  certificate?: CertificateConfig;
  certPasswordEncrypted?: string;
  // Environment
  environment?: 'homologation' | 'production';
  // Tax Regime
  taxRegime?: 'simples_nacional' | 'simples_nacional_excesso' | 'lucro_presumido' | 'lucro_real';
  operationType?: 'saida' | 'entrada';
  sellsInterstate?: boolean;
  ibgeCodigoMunicipio?: string;
  inscricaoEstadual?: string;
  // NF-e Config
  nfeConfig?: {
    series: string;
    nextNumber: number;
    environment?: 'homologation' | 'production';
  };
  // NFC-e Config
  nfceConfig?: {
    series: string;
    nextNumber: number;
    cscId?: string;
    cscToken?: string;
    environment?: 'homologation' | 'production';
  };
  // NFSe Config
  nfseConfig?: {
    series: string;
    nextNumber: number;
  };
  // Default Taxation
  taxation?: {
    icms: { cstCsosn: string; rate: number };
    pis: { cst: string; rate: number };
    cofins: { cst: string; rate: number };
  };
  // Default CFOPs
  cfops?: {
    defaultSales: string;
    defaultPurchases: string;
  };
}

export interface CertificateConfig {
  serialNumber: string;
  expiresAt: string;
  validFrom?: string;
  subject?: string;
  storagePath: string;
  uploadedAt?: string;
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
export interface Client {
  id: string;
  businessId: string;
  tipo: 'pf' | 'pj';
  nome: string;
  cpfCnpj: string;
  email?: string;
  phone: string;
  phone2?: string;
  birthDate?: string;
  gender?: 'M' | 'F' | 'O';
  endereco?: Address;
  notes?: string;
  tags?: string[];
  isActive: boolean;
  totalSpent: number;
  visitCount: number;
  lastVisit?: string;
  createdAt: string;
  updatedAt: string;
}

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
  createdAt: string;
  updatedAt: string;
}

export interface Service {
  id: string;
  businessId: string;
  name: string;
  description?: string;
  duration: number; // minutes
  price: number;
  category?: string;
  color: string;
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
  category: string;
  description: string;
  amount: number;
  dueDate: string;
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
  createdAt: string;
  updatedAt: string;
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
  isActive: boolean;
  imageUrl?: string;
  createdAt: string;
  updatedAt: string;
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

export interface KanbanBoard {
  id: string;
  businessId: string;
  name: string;
  description?: string;
  color: string;
  columns: KanbanColumn[];
  memberIds: string[];
  createdBy: string;
  isArchived: boolean;
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

export interface KanbanCard {
  id: string;
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

// ---- CRM ----
export type LeadStatus = 'novo' | 'contatado' | 'qualificado' | 'proposta' | 'negociacao' | 'ganho' | 'perdido';
export type LeadSource = 'site' | 'indicacao' | 'whatsapp' | 'instagram' | 'facebook' | 'google_ads' | 'linkedin' | 'evento' | 'email' | 'telefone' | 'outro';
export type CRMActivityType = 'ligacao' | 'email' | 'reuniao' | 'whatsapp' | 'tarefa' | 'nota' | 'proposta';
export type IntegrationStatus = 'connected' | 'disconnected' | 'error' | 'pending';
export type IntegrationCategory = 'messaging' | 'social' | 'payment' | 'email' | 'analytics' | 'automation' | 'calendar';

export interface CRMContact {
  id: string;
  businessId: string;
  name: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  company?: string;
  role?: string;
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
  clientId?: string;
  createdAt: string;
  updatedAt: string;
}

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
