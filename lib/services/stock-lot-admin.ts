import type { Firestore } from 'firebase-admin/firestore';
import { StockLotSchema } from '@/lib/contracts/domain/stockLot';
import type { StockLot, StockLotExpiryStatus, StockLotSummary } from '@/lib/types';

function dateOnlyToUtc(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function brazilDateOnly(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = new Map(parts.map((part) => [part.type, part.value]));
  return `${value.get('year')}-${value.get('month')}-${value.get('day')}`;
}

export function stockLotExpiryStatus(
  expiresAt: string | undefined,
  warningDays: number,
  today = brazilDateOnly(),
): { status: StockLotExpiryStatus; daysUntilExpiry?: number } {
  if (!expiresAt) return { status: 'none' };
  const daysUntilExpiry = Math.round((dateOnlyToUtc(expiresAt) - dateOnlyToUtc(today)) / 86_400_000);
  if (daysUntilExpiry < 0) return { status: 'expired', daysUntilExpiry };
  if (daysUntilExpiry <= 7) return { status: 'critical', daysUntilExpiry };
  if (daysUntilExpiry <= warningDays) return { status: 'warning', daysUntilExpiry };
  return { status: 'ok', daysUntilExpiry };
}

export async function listStockLotsAdmin(params: {
  db: Firestore;
  businessId: string;
  productId?: string;
  includeDepleted?: boolean;
  today?: string;
}): Promise<{ lots: StockLot[]; summary: StockLotSummary }> {
  let query: FirebaseFirestore.Query = params.db
    .collection('stockLots')
    .where('businessId', '==', params.businessId);
  if (params.productId) query = query.where('productId', '==', params.productId);
  const [snapshot, productSnapshot] = await Promise.all([
    query.get(),
    params.db.collection('products').where('businessId', '==', params.businessId).get(),
  ]);
  const warningDaysByProduct = new Map(productSnapshot.docs.map((doc) => [
    doc.id,
    Number(doc.data().expiryWarningDays) || 30,
  ]));
  const lots = snapshot.docs
    .map((doc) => StockLotSchema.parse({ ...doc.data(), id: doc.id }))
    .filter((lot) => params.includeDepleted || lot.currentQuantity > 0)
    .map((lot): StockLot => {
      const expiryWarningDays = warningDaysByProduct.get(lot.productId) ?? lot.expiryWarningDays;
      const expiry = stockLotExpiryStatus(lot.expiresAt, expiryWarningDays, params.today);
      return {
        ...lot,
        expiryWarningDays,
        expiryStatus: expiry.status,
        ...(expiry.daysUntilExpiry !== undefined ? { daysUntilExpiry: expiry.daysUntilExpiry } : {}),
      };
    })
    .sort((left, right) => {
      const expiry = (left.expiresAt ?? '9999-12-31').localeCompare(right.expiresAt ?? '9999-12-31');
      return expiry || left.productName.localeCompare(right.productName) || left.code.localeCompare(right.code);
    });
  const summary: StockLotSummary = {
    total: lots.length,
    active: lots.filter((lot) => lot.currentQuantity > 0).length,
    expired: lots.filter((lot) => lot.currentQuantity > 0 && lot.expiryStatus === 'expired').length,
    critical: lots.filter((lot) => lot.currentQuantity > 0 && lot.expiryStatus === 'critical').length,
    warning: lots.filter((lot) => lot.currentQuantity > 0 && lot.expiryStatus === 'warning').length,
  };
  return { lots, summary };
}
