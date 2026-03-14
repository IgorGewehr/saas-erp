// ==========================================
// CORE TYPES - Service Provider Pro
// ==========================================

// ---- Auth & User ----
export interface User {
  id: string;
  uid: string;
  email: string;
  name: string;
  phone?: string;
  photoURL?: string;
  role: 'admin' | 'operator' | 'viewer';
  businessId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Business {
  id: string;
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  inscricaoEstadual?: string;
  inscricaoMunicipal?: string;
  crt: '1' | '2' | '3'; // 1=SN, 2=SN Excess, 3=Normal
  endereco: Address;
  phone: string;
  email: string;
  logo?: string;
  createdAt: string;
  updatedAt: string;
}

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
