import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';

export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:financial']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;
    const active = searchParams.get('active');
    const accountType = searchParams.get('type');
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);
    const offset = Number(searchParams.get('offset')) || 0;

    let query: FirebaseFirestore.Query = adminDb
      .collection('bankAccounts')
      .where('businessId', '==', auth.businessId);

    if (active !== null) {
      query = query.where('isActive', '==', active === 'true');
    }
    if (accountType) {
      query = query.where('accountType', '==', accountType);
    }

    query = query.orderBy('createdAt', 'desc');

    const snapshot = await query.get();
    const accounts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const paginated = accounts.slice(offset, offset + limit);

    return apiSuccess({
      bankAccounts: paginated,
      pagination: { total: accounts.length, limit, offset, hasMore: offset + limit < accounts.length },
    });
  } catch (err: unknown) {
    console.error('[API] GET /v1/bank-accounts error:', err);
    return apiError('Failed to fetch bank accounts', 500);
  }
}

export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:financial']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json();
    const { name, bankName } = body;

    if (!name?.trim()) return apiError('Field "name" is required', 400);
    if (!bankName?.trim()) return apiError('Field "bankName" is required', 400);

    const now = new Date().toISOString();
    const data: Record<string, unknown> = {
      businessId: auth.businessId,
      name: name.trim(),
      bankName: bankName.trim(),
      bankCode: body.bankCode || '',
      accountType: body.accountType || 'corrente',
      agency: body.agency || '',
      accountNumber: body.accountNumber || '',
      balance: Number(body.balance) || 0,
      color: body.color || '#3B82F6',
      isMain: body.isMain === true,
      isActive: body.isActive !== false,
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await adminDb.collection('bankAccounts').add(data);
    return apiSuccess({ id: docRef.id, ...data }, 201);
  } catch (err: unknown) {
    console.error('[API] POST /v1/bank-accounts error:', err);
    return apiError('Failed to create bank account', 500);
  }
}

export async function PUT(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:financial']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json();
    const { id, ...fields } = body;

    if (!id) return apiError('Field "id" is required', 400);

    const docRef = adminDb.collection('bankAccounts').doc(id);
    const doc = await docRef.get();

    if (!doc.exists || doc.data()?.businessId !== auth.businessId) {
      return apiError('Bank account not found', 404);
    }

    const allowed = ['name', 'bankName', 'bankCode', 'accountType', 'agency', 'accountNumber', 'balance', 'color', 'isMain', 'isActive'];
    const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    for (const key of allowed) {
      if (fields[key] !== undefined) {
        update[key] = key === 'balance' ? Number(fields[key]) : fields[key];
      }
    }

    await docRef.update(update);
    return apiSuccess({ id, ...doc.data(), ...update });
  } catch (err: unknown) {
    console.error('[API] PUT /v1/bank-accounts error:', err);
    return apiError('Failed to update bank account', 500);
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:financial']);
  if (isApiKeyError(auth)) return auth;

  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return apiError('Query param "id" is required', 400);

    const docRef = adminDb.collection('bankAccounts').doc(id);
    const doc = await docRef.get();

    if (!doc.exists || doc.data()?.businessId !== auth.businessId) {
      return apiError('Bank account not found', 404);
    }

    await docRef.delete();
    return apiSuccess({ id, deleted: true });
  } catch (err: unknown) {
    console.error('[API] DELETE /v1/bank-accounts error:', err);
    return apiError('Failed to delete bank account', 500);
  }
}
