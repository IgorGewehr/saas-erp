import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';

// =============================================================================
// GET /api/v1/kanban/cards — List kanban cards for a board
// =============================================================================
export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:kanban']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;
    const boardId = searchParams.get('boardId');
    const columnId = searchParams.get('columnId');
    const priority = searchParams.get('priority');
    const assigneeId = searchParams.get('assigneeId');
    const search = searchParams.get('search')?.toLowerCase().trim() || '';
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 100, 1), 500);
    const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);

    if (!boardId) {
      return apiError('Query parameter "boardId" is required', 400);
    }

    // Validate priority if provided
    const validPriorities = ['urgent', 'high', 'medium', 'low'];
    if (priority && !validPriorities.includes(priority)) {
      return apiError(`Invalid priority. Allowed: ${validPriorities.join(', ')}`, 400);
    }

    // Verify the board belongs to this business
    const boardRef = adminDb.collection('kanbanBoards').doc(boardId);
    const boardSnap = await boardRef.get();

    if (!boardSnap.exists || boardSnap.data()?.businessId !== auth.businessId) {
      return apiError('Board not found', 404);
    }

    let query: FirebaseFirestore.Query = adminDb
      .collection('kanbanCards')
      .where('businessId', '==', auth.businessId)
      .where('boardId', '==', boardId);

    // Apply columnId filter at Firestore level
    if (columnId) {
      query = query.where('columnId', '==', columnId);
    }

    // Apply priority filter at Firestore level
    if (priority) {
      query = query.where('priority', '==', priority);
    }

    query = query.orderBy('order', 'asc');

    const snapshot = await query.get();
    let cards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Apply assigneeId filter in-memory (Firestore array-contains can't combine with other inequality)
    if (assigneeId) {
      cards = cards.filter((card: any) => {
        return Array.isArray(card.assigneeIds) && card.assigneeIds.includes(assigneeId);
      });
    }

    // Apply text search filter in-memory
    if (search) {
      cards = cards.filter((card: any) => {
        const title = (card.title || '').toLowerCase();
        const description = (card.description || '').toLowerCase();
        return title.includes(search) || description.includes(search);
      });
    }

    const total = cards.length;
    const paginated = cards.slice(offset, offset + limit);

    return apiSuccess({
      cards: paginated,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error: any) {
    console.error('[API v1/kanban/cards GET]', error);
    return apiError(error.message || 'Failed to list kanban cards', 500);
  }
}

// =============================================================================
// POST /api/v1/kanban/cards — Create a new kanban card
// =============================================================================
export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:kanban']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return apiError('Invalid request body — expected JSON object', 400);
    }

    const { boardId, columnId, title } = body;

    // Validate required fields
    if (!boardId || typeof boardId !== 'string') {
      return apiError('Field "boardId" is required and must be a string', 400);
    }
    if (!columnId || typeof columnId !== 'string') {
      return apiError('Field "columnId" is required and must be a string', 400);
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      return apiError('Field "title" is required and must be a non-empty string', 400);
    }

    // Validate priority if provided
    const validPriorities = ['urgent', 'high', 'medium', 'low'];
    if (body.priority && !validPriorities.includes(body.priority)) {
      return apiError(`Field "priority" must be one of: ${validPriorities.join(', ')}`, 400);
    }

    // Verify the board exists and belongs to this business
    const boardRef = adminDb.collection('kanbanBoards').doc(boardId);
    const boardSnap = await boardRef.get();

    if (!boardSnap.exists || boardSnap.data()?.businessId !== auth.businessId) {
      return apiError('Board not found', 404);
    }

    // Verify the column exists in the board
    const boardData = boardSnap.data()!;
    const columnExists = Array.isArray(boardData.columns) &&
      boardData.columns.some((col: any) => col.id === columnId);
    if (!columnExists) {
      return apiError('Column not found in the specified board', 404);
    }

    // Count existing cards in the column to determine order
    const existingCardsSnap = await adminDb
      .collection('kanbanCards')
      .where('businessId', '==', auth.businessId)
      .where('boardId', '==', boardId)
      .where('columnId', '==', columnId)
      .get();
    const order = existingCardsSnap.size;

    // Build labels array
    let labels: Array<{ id: string; name: string; color: string }> = [];
    if (Array.isArray(body.labels)) {
      labels = body.labels.map((label: any) => ({
        id: label.id || crypto.randomUUID(),
        name: label.name || '',
        color: label.color || '#3B82F6',
      }));
    }

    // Build checklist array
    let checklist: Array<{ id: string; text: string; completed: boolean }> | undefined;
    if (Array.isArray(body.checklist)) {
      checklist = body.checklist.map((item: any) => ({
        id: crypto.randomUUID(),
        text: item.text || '',
        completed: item.completed ?? false,
      }));
    }

    const now = new Date().toISOString();

    const cardData: Record<string, any> = {
      businessId: auth.businessId,
      boardId,
      columnId,
      title: title.trim(),
      description: body.description ?? '',
      priority: body.priority ?? 'medium',
      labels,
      assigneeIds: Array.isArray(body.assigneeIds) ? body.assigneeIds : [],
      assigneeNames: Array.isArray(body.assigneeNames) ? body.assigneeNames : [],
      commentsCount: 0,
      attachmentsCount: 0,
      order,
      createdBy: 'api',
      createdAt: now,
      updatedAt: now,
    };

    // Optional fields
    if (body.dueDate !== undefined) cardData.dueDate = body.dueDate;
    if (checklist !== undefined) cardData.checklist = checklist;
    if (body.coverColor !== undefined) cardData.coverColor = body.coverColor;

    const docRef = await adminDb.collection('kanbanCards').add(cardData);

    return apiSuccess({ id: docRef.id, ...cardData }, 201);
  } catch (error: any) {
    console.error('[API v1/kanban/cards POST]', error);
    return apiError(error.message || 'Failed to create kanban card', 500);
  }
}

// =============================================================================
// PUT /api/v1/kanban/cards — Update an existing kanban card
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

    // Verify the card exists and belongs to this business
    const docRef = adminDb.collection('kanbanCards').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Card not found', 404);
    }

    if (docSnap.data()?.businessId !== auth.businessId) {
      return apiError('Card not found', 404);
    }

    // Prevent overwriting system fields
    delete updates.businessId;
    delete updates.boardId;
    delete updates.createdAt;
    delete updates.createdBy;
    delete updates.id;
    delete updates.commentsCount;
    delete updates.attachmentsCount;

    // Validate priority if provided
    if (updates.priority !== undefined) {
      const validPriorities = ['urgent', 'high', 'medium', 'low'];
      if (!validPriorities.includes(updates.priority)) {
        return apiError(`Field "priority" must be one of: ${validPriorities.join(', ')}`, 400);
      }
    }

    // If moving to a different column, verify it exists in the board
    if (updates.columnId !== undefined) {
      const cardData = docSnap.data()!;
      const boardRef = adminDb.collection('kanbanBoards').doc(cardData.boardId);
      const boardSnap = await boardRef.get();

      if (boardSnap.exists) {
        const boardData = boardSnap.data()!;
        const columnExists = Array.isArray(boardData.columns) &&
          boardData.columns.some((col: any) => col.id === updates.columnId);
        if (!columnExists) {
          return apiError('Target column not found in the board', 404);
        }
      }
    }

    // Validate and normalize labels if provided
    if (updates.labels !== undefined) {
      if (!Array.isArray(updates.labels)) {
        return apiError('Field "labels" must be an array', 400);
      }
      updates.labels = updates.labels.map((label: any) => ({
        id: label.id || crypto.randomUUID(),
        name: label.name || '',
        color: label.color || '#3B82F6',
      }));
    }

    // Validate and normalize checklist if provided
    if (updates.checklist !== undefined) {
      if (!Array.isArray(updates.checklist)) {
        return apiError('Field "checklist" must be an array', 400);
      }
      updates.checklist = updates.checklist.map((item: any) => ({
        id: item.id || crypto.randomUUID(),
        text: item.text || '',
        completed: item.completed ?? false,
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
    console.error('[API v1/kanban/cards PUT]', error);
    return apiError(error.message || 'Failed to update kanban card', 500);
  }
}

// =============================================================================
// DELETE /api/v1/kanban/cards?id=xxx — Delete a kanban card
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

    const docRef = adminDb.collection('kanbanCards').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Card not found', 404);
    }

    if (docSnap.data()?.businessId !== auth.businessId) {
      return apiError('Card not found', 404);
    }

    await docRef.delete();

    return apiSuccess({ id, deleted: true });
  } catch (error: any) {
    console.error('[API v1/kanban/cards DELETE]', error);
    return apiError(error.message || 'Failed to delete kanban card', 500);
  }
}
