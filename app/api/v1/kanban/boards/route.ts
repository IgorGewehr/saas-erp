import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';

// =============================================================================
// GET /api/v1/kanban/boards — List kanban boards for the authenticated business
// =============================================================================
export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:kanban']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;
    const archived = searchParams.get('archived') === 'true';
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 200);
    const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);

    let query: FirebaseFirestore.Query = adminDb
      .collection('kanbanBoards')
      .where('businessId', '==', auth.businessId)
      .where('isArchived', '==', archived)
      .orderBy('createdAt', 'desc');

    const snapshot = await query.get();
    const boards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const total = boards.length;
    const paginated = boards.slice(offset, offset + limit);

    return apiSuccess({
      boards: paginated,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error: any) {
    console.error('[API v1/kanban/boards GET]', error);
    return apiError(error.message || 'Failed to list kanban boards', 500);
  }
}

// =============================================================================
// POST /api/v1/kanban/boards — Create a new kanban board
// =============================================================================
export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:kanban']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return apiError('Invalid request body — expected JSON object', 400);
    }

    const { name } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return apiError('Field "name" is required and must be a non-empty string', 400);
    }

    // Validate visibility
    const validVisibilities = ['all', 'members', 'sectors'];
    if (body.visibility && !validVisibilities.includes(body.visibility)) {
      return apiError(`Field "visibility" must be one of: ${validVisibilities.join(', ')}`, 400);
    }

    // Build columns — use provided or defaults
    let columns: Array<{ id: string; title: string; color: string; order: number }>;

    if (Array.isArray(body.columns) && body.columns.length > 0) {
      columns = body.columns.map((col: any, index: number) => {
        if (!col.title || typeof col.title !== 'string') {
          throw new Error(`Column at index ${index} requires a "title" string`);
        }
        return {
          id: crypto.randomUUID(),
          title: col.title.trim(),
          color: col.color || '#3B82F6',
          order: index,
        };
      });
    } else {
      // Default columns
      columns = [
        { id: crypto.randomUUID(), title: 'A Fazer', color: '#3B82F6', order: 0 },
        { id: crypto.randomUUID(), title: 'Em Progresso', color: '#F59E0B', order: 1 },
        { id: crypto.randomUUID(), title: 'Concluído', color: '#22C55E', order: 2 },
      ];
    }

    const now = new Date().toISOString();

    const boardData: Record<string, any> = {
      businessId: auth.businessId,
      name: name.trim(),
      description: body.description ?? '',
      color: body.color ?? '#3B82F6',
      columns,
      memberIds: Array.isArray(body.memberIds) ? body.memberIds : [],
      sectorIds: Array.isArray(body.sectorIds) ? body.sectorIds : [],
      visibility: body.visibility ?? 'all',
      isArchived: false,
      createdBy: 'api',
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await adminDb.collection('kanbanBoards').add(boardData);

    return apiSuccess({ id: docRef.id, ...boardData }, 201);
  } catch (error: any) {
    console.error('[API v1/kanban/boards POST]', error);
    return apiError(error.message || 'Failed to create kanban board', 500);
  }
}

// =============================================================================
// PUT /api/v1/kanban/boards — Update an existing kanban board
// =============================================================================
export async function PUT(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:kanban']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return apiError('Invalid request body — expected JSON object', 400);
    }

    const { id, ...updates } = body;

    if (!id || typeof id !== 'string') {
      return apiError('Field "id" is required and must be a string', 400);
    }

    // Verify the board exists and belongs to this business
    const docRef = adminDb.collection('kanbanBoards').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Board not found', 404);
    }

    if (docSnap.data()?.businessId !== auth.businessId) {
      return apiError('Board not found', 404);
    }

    // Prevent overwriting system fields
    delete updates.businessId;
    delete updates.createdAt;
    delete updates.createdBy;
    delete updates.id;

    // Validate visibility if provided
    if (updates.visibility !== undefined) {
      const validVisibilities = ['all', 'members', 'sectors'];
      if (!validVisibilities.includes(updates.visibility)) {
        return apiError(`Field "visibility" must be one of: ${validVisibilities.join(', ')}`, 400);
      }
    }

    // Validate columns if provided — ensure each has required fields
    if (updates.columns !== undefined) {
      if (!Array.isArray(updates.columns)) {
        return apiError('Field "columns" must be an array', 400);
      }
      updates.columns = updates.columns.map((col: any, index: number) => ({
        id: col.id || crypto.randomUUID(),
        title: col.title || `Column ${index + 1}`,
        color: col.color || '#3B82F6',
        order: col.order ?? index,
        ...(col.cardLimit !== undefined ? { cardLimit: col.cardLimit } : {}),
      }));
    }

    if (Object.keys(updates).length === 0) {
      return apiError('No fields to update — provide at least one field besides "id"', 400);
    }

    updates.updatedAt = new Date().toISOString();

    await docRef.update(updates);

    const updated = await docRef.get();

    return apiSuccess({ id: updated.id, ...updated.data() });
  } catch (error: any) {
    console.error('[API v1/kanban/boards PUT]', error);
    return apiError(error.message || 'Failed to update kanban board', 500);
  }
}

// =============================================================================
// DELETE /api/v1/kanban/boards?id=xxx — Delete a kanban board
// =============================================================================
export async function DELETE(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:kanban']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;
    const id = searchParams.get('id');

    if (!id) {
      return apiError('Query parameter "id" is required', 400);
    }

    const docRef = adminDb.collection('kanbanBoards').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Board not found', 404);
    }

    if (docSnap.data()?.businessId !== auth.businessId) {
      return apiError('Board not found', 404);
    }

    await docRef.delete();

    return apiSuccess({ id, deleted: true });
  } catch (error: any) {
    console.error('[API v1/kanban/boards DELETE]', error);
    return apiError(error.message || 'Failed to delete kanban board', 500);
  }
}
