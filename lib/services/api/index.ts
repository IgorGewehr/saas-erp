import { FirebaseService } from './firebaseService';
import type {
  Client,
  Appointment,
  Service,
  Sale,
  Transaction,
  FinancialCategory,
  Product,
  StockMovement,
  FiscalDocument,
  User,
  Business,
} from '@/lib/types';

// Service instances
export const clientsService = new FirebaseService<Client>('clients');
export const appointmentsService = new FirebaseService<Appointment>('appointments');
export const servicesService = new FirebaseService<Service>('services');
export const salesService = new FirebaseService<Sale>('sales');
export const transactionsService = new FirebaseService<Transaction>('transactions');
export const categoriesService = new FirebaseService<FinancialCategory>('financial_categories');
export const productsService = new FirebaseService<Product>('products');
export const stockMovementsService = new FirebaseService<StockMovement>('stock_movements');
export const fiscalDocsService = new FirebaseService<FiscalDocument>('fiscal_documents');
export const usersService = new FirebaseService<User>('users');
export const businessService = new FirebaseService<Business>('businesses');

export { FirebaseService };
