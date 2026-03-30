import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';

// =============================================================================
// GET /api/v1/transactions — List transactions for the authenticated business
// =============================================================================
export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:financial']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;

    const type = searchParams.get('type') as 'receita' | 'despesa' | null;
    const status = searchParams.get('status') as 'pendente' | 'pago' | 'atrasado' | 'cancelado' | null;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const category = searchParams.get('category');
    const search = searchParams.get('search')?.toLowerCase().trim() || '';
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 200);
    const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);

    // Validate type
    if (type && !['receita', 'despesa'].includes(type)) {
      return apiError('Invalid type. Allowed: receita, despesa', 400);
    }

    // Validate status
    if (status && !['pendente', 'pago', 'atrasado', 'cancelado'].includes(status)) {
      return apiError('Invalid status. Allowed: pendente, pago, atrasado, cancelado', 400);
    }

    // Build Firestore query — always filter by businessId
    let query: FirebaseFirestore.Query = adminDb
      .collection('transactions')
      .where('businessId', '==', auth.businessId);

    if (type) {
      query = query.where('type', '==', type);
    }

    if (status) {
      query = query.where('status', '==', status);
    }

    if (category) {
      query = query.where('category', '==', category);
    }

    query = query.orderBy('createdAt', 'desc');

    const snapshot = await query.get();

    let transactions = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Apply date range filter in-memory (dueDate is YYYY-MM-DD string)
    if (startDate) {
      const start = startDate; // Already YYYY-MM-DD
      transactions = transactions.filter((t: any) => {
        return t.dueDate >= start;
      });
    }

    if (endDate) {
      const end = endDate; // Already YYYY-MM-DD
      transactions = transactions.filter((t: any) => {
        return t.dueDate <= end;
      });
    }

    // Apply text search filter in-memory (description, clientName)
    if (search) {
      transactions = transactions.filter((t: any) => {
        const description = (t.description || '').toLowerCase();
        const clientName = (t.clientName || '').toLowerCase();
        return description.includes(search) || clientName.includes(search);
      });
    }

    const total = transactions.length;
    const paginated = transactions.slice(offset, offset + limit);

    return apiSuccess({
      transactions: paginated,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (err) {
    console.error('[API] GET /api/v1/transactions error:', err);
    return apiError('Failed to fetch transactions', 500);
  }
}

// =============================================================================
// POST /api/v1/transactions — Create a new transaction
// =============================================================================
export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:financial']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return apiError('Invalid request body — expected JSON object', 400);
    }

    const { type, category, description, amount, dueDate } = body;

    // ── Validate required fields ──────────────────────────────────────────────
    if (!type || !['receita', 'despesa'].includes(type)) {
      return apiError('Field "type" is required. Allowed: receita, despesa', 400);
    }

    if (!category || typeof category !== 'string' || !category.trim()) {
      return apiError('Field "category" is required and must be a non-empty string', 400);
    }

    if (!description || typeof description !== 'string' || !description.trim()) {
      return apiError('Field "description" is required and must be a non-empty string', 400);
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return apiError('Field "amount" is required and must be a positive number', 400);
    }

    if (!dueDate || typeof dueDate !== 'string') {
      return apiError('Field "dueDate" is required and must be a date string (YYYY-MM-DD)', 400);
    }

    // Validate dueDate format
    const dueDateParsed = new Date(dueDate);
    if (isNaN(dueDateParsed.getTime())) {
      return apiError('Field "dueDate" is not a valid date', 400);
    }

    // ── Validate optional fields ──────────────────────────────────────────────
    const validStatuses = ['pendente', 'pago', 'atrasado', 'cancelado'];
    const validMethods = ['dinheiro', 'pix', 'credito', 'debito', 'boleto', 'outros'];

    if (body.status && !validStatuses.includes(body.status)) {
      return apiError(`Invalid status. Allowed: ${validStatuses.join(', ')}`, 400);
    }

    if (body.paymentMethod && !validMethods.includes(body.paymentMethod)) {
      return apiError(`Invalid paymentMethod. Allowed: ${validMethods.join(', ')}`, 400);
    }

    // ── Determine status ──────────────────────────────────────────────────────
    let finalStatus = body.status || 'pendente';
    if (body.paymentDate && finalStatus === 'pendente') {
      finalStatus = 'pago';
    }

    const now = new Date().toISOString();

    const transactionData: Record<string, any> = {
      businessId: auth.businessId,
      type,
      category: category.trim(),
      description: description.trim(),
      amount: Math.round(amount * 100) / 100,
      dueDate,
      status: finalStatus,
      createdAt: now,
      updatedAt: now,
    };

    // ── Optional fields ───────────────────────────────────────────────────────
    if (body.paymentDate) transactionData.paymentDate = body.paymentDate;
    if (body.paymentMethod) transactionData.paymentMethod = body.paymentMethod;
    if (body.clientId) transactionData.clientId = body.clientId;
    if (body.clientName) transactionData.clientName = body.clientName;
    if (body.saleId) transactionData.saleId = body.saleId;
    if (body.notes) transactionData.notes = body.notes;
    if (body.bankAccountId) transactionData.bankAccountId = body.bankAccountId;
    if (body.channelType) transactionData.channelType = body.channelType;
    if (body.conversationId) transactionData.conversationId = body.conversationId;
    if (body.contactId) transactionData.contactId = body.contactId;
    if (body.campaignId) transactionData.campaignId = body.campaignId;
    if (body.sectorId) transactionData.sectorId = body.sectorId;
    if (body.costCenter) transactionData.costCenter = body.costCenter;
    if (body.businessUnitId) transactionData.businessUnitId = body.businessUnitId;

    const docRef = await adminDb.collection('transactions').add(transactionData);

    return apiSuccess({ id: docRef.id, ...transactionData }, 201);
  } catch (err) {
    console.error('[API] POST /api/v1/transactions error:', err);
    return apiError('Failed to create transaction', 500);
  }
}

// =============================================================================
// PUT /api/v1/transactions — Update a transaction (or mark as paid via ?action=)
// =============================================================================
export async function PUT(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:financial']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;
    const action = searchParams.get('action');

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return apiError('Invalid request body — expected JSON object', 400);
    }

    const { id, ...updateFields } = body;

    if (!id || typeof id !== 'string') {
      return apiError('Field "id" is required and must be a string', 400);
    }

    // Verify the document exists and belongs to this business
    const docRef = adminDb.collection('transactions').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Transaction not found', 404);
    }

    const existingData = docSnap.data();
    if (existingData?.businessId !== auth.businessId) {
      return apiError('Transaction not found', 404);
    }

    const now = new Date().toISOString();

    // ── Handle ?action=mark-paid shortcut ─────────────────────────────────────
    if (action === 'mark-paid') {
      await docRef.update({
        status: 'pago',
        paymentDate: now.split('T')[0],
        updatedAt: now,
      });

      const updated = await docRef.get();
      return apiSuccess({ id: updated.id, ...updated.data() });
    }

    // ── Standard update ───────────────────────────────────────────────────────
    // Remove protected fields
    delete updateFields.businessId;
    delete updateFields.createdAt;
    delete updateFields.id;

    if (Object.keys(updateFields).length === 0) {
      return apiError('No fields to update — provide at least one field besides "id"', 400);
    }

    // Validate fields if provided
    if (updateFields.type && !['receita', 'despesa'].includes(updateFields.type)) {
      return apiError('Field "type" must be "receita" or "despesa"', 400);
    }

    if (updateFields.status && !['pendente', 'pago', 'atrasado', 'cancelado'].includes(updateFields.status)) {
      return apiError('Field "status" must be: pendente, pago, atrasado, or cancelado', 400);
    }

    if (updateFields.paymentMethod) {
      const validMethods = ['dinheiro', 'pix', 'credito', 'debito', 'boleto', 'outros'];
      if (!validMethods.includes(updateFields.paymentMethod)) {
        return apiError(`Invalid paymentMethod. Allowed: ${validMethods.join(', ')}`, 400);
      }
    }

    // Auto-set status to 'pago' if paymentDate is being set and status is not explicitly provided
    if (updateFields.paymentDate && !updateFields.status) {
      updateFields.status = 'pago';
    }

    updateFields.updatedAt = now;

    await docRef.update(updateFields);

    const updated = await docRef.get();

    return apiSuccess({ id: updated.id, ...updated.data() });
  } catch (err) {
    console.error('[API] PUT /api/v1/transactions error:', err);
    return apiError('Failed to update transaction', 500);
  }
}

// =============================================================================
// DELETE /api/v1/transactions?id=xxx — Delete a transaction
// =============================================================================
export async function DELETE(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:financial']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;
    const id = searchParams.get('id');

    if (!id) {
      return apiError('Query parameter "id" is required', 400);
    }

    // Verify the document exists and belongs to this business
    const docRef = adminDb.collection('transactions').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Transaction not found', 404);
    }

    const existingData = docSnap.data();
    if (existingData?.businessId !== auth.businessId) {
      return apiError('Transaction not found', 404);
    }

    await docRef.delete();

    return apiSuccess({ id, deleted: true });
  } catch (err) {
    console.error('[API] DELETE /api/v1/transactions error:', err);
    return apiError('Failed to delete transaction', 500);
  }
}
