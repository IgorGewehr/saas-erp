import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';

// ─── GET /api/v1/clients ──────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:clients']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;

    const search = searchParams.get('search')?.toLowerCase().trim() || '';
    const tipo = searchParams.get('tipo') as 'pf' | 'pj' | null;
    const activeParam = searchParams.get('active');
    const sort = searchParams.get('sort') || 'nome';
    const order = (searchParams.get('order') || 'asc') as 'asc' | 'desc';
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);
    const offset = Number(searchParams.get('offset')) || 0;

    // Validate sort field
    const allowedSorts = ['nome', 'createdAt', 'totalSpent'];
    if (!allowedSorts.includes(sort)) {
      return apiError(`Invalid sort field. Allowed: ${allowedSorts.join(', ')}`, 400);
    }

    // Validate order
    if (!['asc', 'desc'].includes(order)) {
      return apiError('Invalid order. Allowed: asc, desc', 400);
    }

    // Validate tipo
    if (tipo && !['pf', 'pj'].includes(tipo)) {
      return apiError('Invalid tipo. Allowed: pf, pj', 400);
    }

    // Build Firestore query — always filter by businessId
    let query: FirebaseFirestore.Query = adminDb
      .collection('clients')
      .where('businessId', '==', auth.businessId);

    // Server-side filters (Firestore-level)
    if (tipo) {
      query = query.where('tipo', '==', tipo);
    }

    if (activeParam !== null && activeParam !== undefined && activeParam !== '') {
      query = query.where('isActive', '==', activeParam === 'true');
    }

    // Apply sort
    query = query.orderBy(sort, order);

    // Fetch all matching documents (search filtering is done in-memory)
    const snapshot = await query.get();

    let clients = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Client-side search filter (case-insensitive contains across multiple fields)
    if (search) {
      clients = clients.filter((c: any) => {
        const nome = (c.nome || '').toLowerCase();
        const cpfCnpj = (c.cpfCnpj || '').toLowerCase();
        const phone = (c.phone || '').toLowerCase();
        const email = (c.email || '').toLowerCase();
        return (
          nome.includes(search) ||
          cpfCnpj.includes(search) ||
          phone.includes(search) ||
          email.includes(search)
        );
      });
    }

    const total = clients.length;
    const paginated = clients.slice(offset, offset + limit);

    return apiSuccess({
      clients: paginated,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error: any) {
    console.error('[API v1/clients GET]', error);
    return apiError(error.message || 'Failed to list clients', 500);
  }
}

// ─── POST /api/v1/clients ─────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:clients']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json();
    const { nome, phone, tipo } = body;

    // Validate required fields
    if (!nome || typeof nome !== 'string' || !nome.trim()) {
      return apiError('Field "nome" is required and must be a non-empty string', 400);
    }
    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      return apiError('Field "phone" is required and must be a non-empty string', 400);
    }
    if (!tipo || !['pf', 'pj'].includes(tipo)) {
      return apiError('Field "tipo" is required and must be "pf" or "pj"', 400);
    }

    // Validate optional enum fields
    if (body.gender && !['M', 'F', 'O'].includes(body.gender)) {
      return apiError('Field "gender" must be "M", "F", or "O"', 400);
    }
    if (body.indicadorIE && !['1', '2', '9'].includes(body.indicadorIE)) {
      return apiError('Field "indicadorIE" must be "1", "2", or "9"', 400);
    }

    const now = new Date().toISOString();

    const clientData: Record<string, any> = {
      businessId: auth.businessId,
      nome: nome.trim(),
      phone: phone.trim(),
      tipo,
      isActive: true,
      totalSpent: 0,
      visitCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    // Optional string fields — only include if provided
    const optionalStrings = [
      'cpfCnpj', 'email', 'phone2', 'birthDate', 'gender',
      'inscricaoEstadual', 'indicadorIE', 'inscricaoMunicipal',
      'suframa', 'nomeFantasia', 'notes',
    ];
    for (const field of optionalStrings) {
      if (body[field] !== undefined && body[field] !== null) {
        clientData[field] = typeof body[field] === 'string' ? body[field].trim() : body[field];
      }
    }

    // Optional object: endereco
    if (body.endereco && typeof body.endereco === 'object') {
      clientData.endereco = body.endereco;
    }

    // Optional array: tags
    if (Array.isArray(body.tags)) {
      clientData.tags = body.tags.filter((t: string) => typeof t === 'string' && t.trim());
    }

    const docRef = await adminDb.collection('clients').add(clientData);

    return apiSuccess({ id: docRef.id, ...clientData }, 201);
  } catch (error: any) {
    console.error('[API v1/clients POST]', error);
    return apiError(error.message || 'Failed to create client', 500);
  }
}

// ─── PUT /api/v1/clients ──────────────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:clients']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json();
    const { id, ...updates } = body;

    if (!id || typeof id !== 'string') {
      return apiError('Field "id" is required and must be a string', 400);
    }

    // Verify the client exists and belongs to this business
    const docRef = adminDb.collection('clients').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Client not found', 404);
    }

    if (docSnap.data()?.businessId !== auth.businessId) {
      return apiError('Client not found', 404);
    }

    // Prevent overwriting system fields
    delete updates.businessId;
    delete updates.createdAt;
    delete updates.id;

    if (Object.keys(updates).length === 0) {
      return apiError('No fields to update — provide at least one field besides "id"', 400);
    }

    // Validate enum fields if provided
    if (updates.tipo && !['pf', 'pj'].includes(updates.tipo)) {
      return apiError('Field "tipo" must be "pf" or "pj"', 400);
    }
    if (updates.gender && !['M', 'F', 'O'].includes(updates.gender)) {
      return apiError('Field "gender" must be "M", "F", or "O"', 400);
    }
    if (updates.indicadorIE && !['1', '2', '9'].includes(updates.indicadorIE)) {
      return apiError('Field "indicadorIE" must be "1", "2", or "9"', 400);
    }

    updates.updatedAt = new Date().toISOString();

    await docRef.update(updates);

    const updated = await docRef.get();

    return apiSuccess({ id: updated.id, ...updated.data() });
  } catch (error: any) {
    console.error('[API v1/clients PUT]', error);
    return apiError(error.message || 'Failed to update client', 500);
  }
}

// ─── DELETE /api/v1/clients ───────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:clients']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;
    const id = searchParams.get('id');

    if (!id) {
      return apiError('Query parameter "id" is required', 400);
    }

    const docRef = adminDb.collection('clients').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Client not found', 404);
    }

    if (docSnap.data()?.businessId !== auth.businessId) {
      return apiError('Client not found', 404);
    }

    await docRef.delete();

    return apiSuccess({ id, deleted: true });
  } catch (error: any) {
    console.error('[API v1/clients DELETE]', error);
    return apiError(error.message || 'Failed to delete client', 500);
  }
}
