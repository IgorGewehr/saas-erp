/**
 * Loyalty Program Service
 * Handles point accumulation and redemption for the fidelidade program.
 */
import {
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  runTransaction,
  Firestore,
} from 'firebase/firestore';
import type { LoyaltyConfig, LoyaltyTransaction } from '@/lib/types';

/**
 * Calculate how many points a purchase earns.
 */
export function calculateEarnedPoints(totalAmount: number, config: LoyaltyConfig): number {
  if (!config.isEnabled || config.pointsPerReal <= 0) return 0;
  return Math.floor(totalAmount * config.pointsPerReal);
}

/**
 * Calculate the monetary value (in R$) of a given number of points.
 */
export function pointsToReais(points: number, config: LoyaltyConfig): number {
  return (points * config.pointValueInCentavos) / 100;
}

/**
 * Calculate how many points are needed to redeem a given amount (in R$).
 */
export function reaisToPoints(reais: number, config: LoyaltyConfig): number {
  if (config.pointValueInCentavos <= 0) return 0;
  return Math.ceil((reais * 100) / config.pointValueInCentavos);
}

/**
 * Add loyalty points to a client after a sale or appointment.
 * Uses a Firestore transaction to safely update the client's balance.
 */
export async function addLoyaltyPoints(
  db: Firestore,
  params: {
    businessId: string;
    clientId: string;
    clientName: string;
    pointsEarned: number;
    config: LoyaltyConfig;
    sourceId: string;
    sourceType: 'sale' | 'appointment' | 'order';
    description: string;
  }
): Promise<void> {
  const { businessId, clientId, clientName, pointsEarned, config, sourceId, sourceType, description } = params;
  if (pointsEarned <= 0) return;

  const clientRef = doc(db, 'clients', clientId);

  const newTxRef = doc(collection(db, 'loyaltyTransactions'));

  await runTransaction(db, async (tx) => {
    const clientSnap = await tx.get(clientRef);
    if (!clientSnap.exists()) return;

    const currentPoints = (clientSnap.data().loyaltyPoints as number) || 0;
    const balanceAfter = currentPoints + pointsEarned;

    const loyaltyTx: Omit<LoyaltyTransaction, 'id'> = {
      businessId,
      clientId,
      clientName,
      type: 'acumulo',
      points: pointsEarned,
      balanceAfter,
      description,
      sourceId,
      sourceType,
      createdAt: new Date().toISOString(),
      ...(config.expirationDays
        ? {
            expiresAt: new Date(
              Date.now() + config.expirationDays * 24 * 60 * 60 * 1000
            ).toISOString(),
          }
        : {}),
    };

    tx.update(clientRef, {
      loyaltyPoints: balanceAfter,
      updatedAt: new Date().toISOString(),
    });

    tx.set(newTxRef, loyaltyTx);
  });
}

/**
 * Redeem loyalty points for a client (subtract from their balance).
 * Returns the actual points redeemed or throws if insufficient balance.
 */
export async function redeemLoyaltyPoints(
  db: Firestore,
  params: {
    businessId: string;
    clientId: string;
    clientName: string;
    pointsToRedeem: number;
    config: LoyaltyConfig;
    sourceId: string;
    description: string;
  }
): Promise<{ pointsRedeemed: number; reaisValue: number }> {
  const { businessId, clientId, clientName, pointsToRedeem, config, sourceId, description } = params;

  if (pointsToRedeem < config.minPointsToRedeem) {
    throw new Error(`Mínimo de ${config.minPointsToRedeem} pontos para resgatar.`);
  }

  const clientRef = doc(db, 'clients', clientId);
  const newTxRef = doc(collection(db, 'loyaltyTransactions'));

  let balanceAfter = 0;
  await runTransaction(db, async (tx) => {
    const clientSnap = await tx.get(clientRef);
    if (!clientSnap.exists()) throw new Error('Cliente não encontrado.');

    const currentPoints = (clientSnap.data().loyaltyPoints as number) || 0;
    if (currentPoints < pointsToRedeem) {
      throw new Error(`Saldo insuficiente. Cliente possui ${currentPoints} pontos.`);
    }

    balanceAfter = currentPoints - pointsToRedeem;

    const loyaltyTx: Omit<LoyaltyTransaction, 'id'> = {
      businessId,
      clientId,
      clientName,
      type: 'resgate',
      points: -pointsToRedeem,
      balanceAfter,
      description,
      sourceId,
      sourceType: 'sale',
      createdAt: new Date().toISOString(),
    };

    tx.update(clientRef, {
      loyaltyPoints: balanceAfter,
      updatedAt: new Date().toISOString(),
    });

    tx.set(newTxRef, loyaltyTx);
  });

  return {
    pointsRedeemed: pointsToRedeem,
    reaisValue: pointsToReais(pointsToRedeem, config),
  };
}

/**
 * Fetch recent loyalty transactions for a client.
 */
export async function getClientLoyaltyHistory(
  db: Firestore,
  businessId: string,
  clientId: string,
  maxItems = 20
): Promise<LoyaltyTransaction[]> {
  const q = query(
    collection(db, 'loyaltyTransactions'),
    where('businessId', '==', businessId),
    where('clientId', '==', clientId),
    orderBy('createdAt', 'desc'),
    limit(maxItems)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ ...d.data(), id: d.id } as LoyaltyTransaction));
}
