/**
 * Gift Card Service
 */
import {
  collection,
  doc,
  getDocs,
  query,
  where,
  runTransaction,
  Firestore,
} from 'firebase/firestore';
import type { GiftCard } from '@/lib/types';

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Generate a unique 8-char gift card code. */
export function generateGiftCardCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }
  return code;
}

/**
 * Create a new gift card document.
 * Returns the created GiftCard (with id).
 */
export async function createGiftCard(
  db: Firestore,
  params: {
    businessId: string;
    originalValue: number;
    recipientName?: string;
    recipientPhone?: string;
    purchasedBySaleId?: string;
    expiresAt?: string;
  }
): Promise<GiftCard> {
  const code = generateGiftCardCode();
  const now = new Date().toISOString();

  const giftCardRef = doc(collection(db, 'giftCards'));
  const giftCard: Omit<GiftCard, 'id'> = {
    businessId: params.businessId,
    code,
    originalValue: params.originalValue,
    remainingValue: params.originalValue,
    status: 'active',
    recipientName: params.recipientName,
    recipientPhone: params.recipientPhone,
    purchasedBySaleId: params.purchasedBySaleId,
    expiresAt: params.expiresAt,
    purchasedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  // Remove undefined fields
  const clean = Object.fromEntries(
    Object.entries(giftCard).filter(([, v]) => v !== undefined)
  ) as Omit<GiftCard, 'id'>;

  await runTransaction(db, async (tx) => {
    tx.set(giftCardRef, clean);
  });

  return { ...clean, id: giftCardRef.id };
}

/**
 * Look up a gift card by code and businessId.
 */
export async function findGiftCard(
  db: Firestore,
  businessId: string,
  code: string
): Promise<GiftCard | null> {
  const q = query(
    collection(db, 'giftCards'),
    where('businessId', '==', businessId),
    where('code', '==', code.toUpperCase().trim())
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { ...d.data(), id: d.id } as GiftCard;
}

/**
 * Redeem a gift card for a given amount (partial redemption supported).
 * Returns the actual amount redeemed.
 */
export async function redeemGiftCard(
  db: Firestore,
  params: {
    giftCardId: string;
    amountToRedeem: number;
    saleId: string;
  }
): Promise<{ amountRedeemed: number; remainingValue: number }> {
  const { giftCardId, amountToRedeem, saleId } = params;
  const giftCardRef = doc(db, 'giftCards', giftCardId);

  let amountRedeemed = 0;
  let newRemainingValue = 0;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(giftCardRef);
    if (!snap.exists()) throw new Error('Gift card não encontrado.');

    const gc = snap.data() as Omit<GiftCard, 'id'>;
    if (gc.status !== 'active') throw new Error(`Gift card ${gc.status === 'used' ? 'já utilizado' : 'inativo'}.`);

    const now = new Date().toISOString();
    if (gc.expiresAt && gc.expiresAt < now) {
      tx.update(giftCardRef, { status: 'expired', updatedAt: now });
      throw new Error('Gift card expirado.');
    }

    amountRedeemed = Math.min(amountToRedeem, gc.remainingValue);
    newRemainingValue = gc.remainingValue - amountRedeemed;
    const newStatus = newRemainingValue <= 0 ? 'used' : 'active';

    tx.update(giftCardRef, {
      remainingValue: newRemainingValue,
      status: newStatus,
      usedBySaleId: saleId,
      usedAt: now,
      updatedAt: now,
    });
  });

  return { amountRedeemed, remainingValue: newRemainingValue };
}
