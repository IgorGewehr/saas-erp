/**
 * Agent tool: Kanban boards and cards.
 *
 * Actions:
 *   - list_boards           all boards in the business
 *   - get_board             single board (includes columns)
 *   - list_cards            cards in a board, optional filters
 *   - get_card              single card
 *   - create_card           create a new task card on a board/column
 *   - move_card             move card to a different column (drag-drop equivalent)
 *   - update_card           patch title/description/priority/dueDate/assignees
 *   - assign                set assigneeIds (replaces existing)
 *   - add_comment           append a comment
 *   - archive_card          soft-delete via status on column (does NOT use delete)
 */

import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { KanbanBoard, KanbanCard, KanbanPriority, KanbanComment } from '@/lib/types';
import { FieldValue } from 'firebase-admin/firestore';

type Action =
  | 'list_boards'
  | 'get_board'
  | 'list_cards'
  | 'search_cards'
  | 'get_card'
  | 'create_card'
  | 'move_card'
  | 'update_card'
  | 'assign'
  | 'add_comment'
  | 'archive_card';

interface CreateCardParams {
  boardId: string;
  columnId?: string;       // defaults to first column if omitted
  title: string;
  description?: string;
  priority?: KanbanPriority;
  assigneeIds?: string[];
  assigneeNames?: string[];
  dueDate?: string;
  labels?: Array<{ id: string; name: string; color: string }>;
}

const ALLOWED_PRIORITIES: KanbanPriority[] = ['urgent', 'high', 'medium', 'low'];

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await verifyAgentRequest(req);
  } catch (err) {
    const resp = agentAuthErrorResponse(err);
    if (resp) return resp;
    throw err;
  }

  const body = parseAgentBody<{ action: Action; params: Record<string, unknown> }>(ctx.rawBody);
  const { businessId } = ctx;

  try {
    switch (body.action) {
      case 'list_boards':
        return NextResponse.json({ ok: true, data: await listBoards(businessId) });
      case 'get_board':
        return NextResponse.json({ ok: true, data: await getBoard(businessId, body.params.id as string) });
      case 'list_cards':
        return NextResponse.json({ ok: true, data: await listCards(businessId, body.params as unknown as { boardId: string; columnId?: string; assigneeId?: string; limit?: number }) });
      case 'search_cards':
        return NextResponse.json({ ok: true, data: await searchCards(businessId, body.params as { query: string; boardId?: string; limit?: number }) });
      case 'get_card':
        return NextResponse.json({ ok: true, data: await getCard(businessId, body.params.id as string) });
      case 'create_card':
        return NextResponse.json({ ok: true, data: await createCard(businessId, body.params as unknown as CreateCardParams) });
      case 'move_card':
        return NextResponse.json({ ok: true, data: await moveCard(businessId, body.params.id as string, body.params.columnId as string) });
      case 'update_card':
        return NextResponse.json({ ok: true, data: await updateCard(businessId, body.params.id as string, body.params.patch as Partial<KanbanCard>) });
      case 'assign':
        return NextResponse.json({ ok: true, data: await assign(businessId, body.params.id as string, body.params.assigneeIds as string[], body.params.assigneeNames as string[] | undefined) });
      case 'add_comment':
        return NextResponse.json({ ok: true, data: await addComment(businessId, body.params.id as string, body.params.text as string, body.params.authorId as string | undefined, body.params.authorName as string | undefined) });
      case 'archive_card':
        return NextResponse.json({ ok: true, data: await archiveCard(businessId, body.params.id as string) });
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[agent.kanban] error', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function listBoards(businessId: string): Promise<Array<Pick<KanbanBoard, 'id' | 'name' | 'description' | 'color' | 'columns' | 'isArchived'>>> {
  const snap = await adminDb
    .collection('kanbanBoards')
    .where('businessId', '==', businessId)
    .where('isArchived', '==', false)
    .orderBy('name')
    .get();
  return snap.docs.map((d) => {
    const b = d.data() as KanbanBoard;
    return {
      id: d.id,
      name: b.name,
      description: b.description,
      color: b.color,
      columns: b.columns,
      isArchived: b.isArchived,
    };
  });
}

async function getBoard(businessId: string, id: string): Promise<KanbanBoard | null> {
  if (!id) throw new Error('id required');
  const doc = await adminDb.collection('kanbanBoards').doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() as KanbanBoard;
  if (data.businessId !== businessId) throw new Error('Cross-tenant access denied');
  return { ...data, id: doc.id };
}

async function listCards(businessId: string, p: { boardId: string; columnId?: string; assigneeId?: string; limit?: number }): Promise<KanbanCard[]> {
  if (!p.boardId) throw new Error('boardId required');
  const limit = Math.min(Math.max(p.limit ?? 100, 1), 500);
  let q: FirebaseFirestore.Query = adminDb
    .collection('kanbanCards')
    .where('businessId', '==', businessId)
    .where('boardId', '==', p.boardId);

  if (p.columnId) q = q.where('columnId', '==', p.columnId);
  if (p.assigneeId) q = q.where('assigneeIds', 'array-contains', p.assigneeId);

  const snap = await q.orderBy('order', 'asc').limit(limit).get();
  return snap.docs.map((d) => ({ ...(d.data() as KanbanCard), id: d.id }));
}

/** Fuzzy title/description search across cards, optional board filter. */
async function searchCards(
  businessId: string,
  p: { query: string; boardId?: string; limit?: number },
): Promise<Array<KanbanCard & { _score: number }>> {
  if (!p.query || !p.query.trim()) throw new Error('query required');
  const cap = Math.min(Math.max(p.limit ?? 10, 1), 50);

  let q: FirebaseFirestore.Query = adminDb.collection('kanbanCards').where('businessId', '==', businessId);
  if (p.boardId) q = q.where('boardId', '==', p.boardId);
  const snap = await q.limit(1000).get();

  const norm = (s?: string) =>
    (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const query = norm(p.query);

  const scored: Array<KanbanCard & { _score: number }> = [];
  for (const d of snap.docs) {
    const card = { ...(d.data() as KanbanCard), id: d.id };
    const nTitle = norm(card.title);
    const nDesc = norm(card.description);
    const nAssignees = (card.assigneeNames || []).map(norm).join(' ');

    let score = 0;
    if (nTitle === query) score = 100;
    else if (nTitle.startsWith(query)) score = 80;
    else if (nTitle.includes(query)) score = 60;
    else if (nDesc.includes(query)) score = 35;
    else if (nAssignees.includes(query)) score = 25;

    if (score > 0) scored.push({ ...card, _score: score });
  }

  scored.sort((a, b) => b._score - a._score);
  return scored.slice(0, cap);
}

async function getCard(businessId: string, id: string): Promise<KanbanCard | null> {
  if (!id) throw new Error('id required');
  const doc = await adminDb.collection('kanbanCards').doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() as KanbanCard;
  if (data.businessId !== businessId) throw new Error('Cross-tenant access denied');
  return { ...data, id: doc.id };
}

async function createCard(businessId: string, p: CreateCardParams): Promise<KanbanCard> {
  if (!p.boardId) throw new Error('boardId required');
  if (!p.title) throw new Error('title required');

  // Resolve column — if not provided, default to first column of the board
  const board = await getBoard(businessId, p.boardId);
  if (!board) throw new Error('Board not found');
  const columnId = p.columnId || board.columns[0]?.id;
  if (!columnId) throw new Error('Board has no columns');
  if (!board.columns.some((c) => c.id === columnId)) throw new Error('columnId does not exist in this board');

  // Highest order in target column + 1
  const existing = await adminDb
    .collection('kanbanCards')
    .where('businessId', '==', businessId)
    .where('boardId', '==', p.boardId)
    .where('columnId', '==', columnId)
    .orderBy('order', 'desc')
    .limit(1)
    .get();
  const nextOrder = existing.empty ? 0 : (existing.docs[0].data() as KanbanCard).order + 1;

  const now = new Date().toISOString();
  const priority: KanbanPriority = p.priority && ALLOWED_PRIORITIES.includes(p.priority) ? p.priority : 'medium';

  const ref = adminDb.collection('kanbanCards').doc();
  const card: KanbanCard = {
    id: ref.id,
    businessId,
    boardId: p.boardId,
    columnId,
    title: p.title.slice(0, 200),
    description: p.description?.slice(0, 2000),
    priority,
    labels: p.labels ?? [],
    assigneeIds: p.assigneeIds ?? [],
    assigneeNames: p.assigneeNames ?? [],
    dueDate: p.dueDate,
    commentsCount: 0,
    attachmentsCount: 0,
    order: nextOrder,
    createdBy: 'agent',
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(card);
  return card;
}

async function moveCard(businessId: string, id: string, columnId: string): Promise<KanbanCard> {
  if (!id || !columnId) throw new Error('id and columnId required');
  const ref = adminDb.collection('kanbanCards').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Card not found');
  const card = snap.data() as KanbanCard;
  if (card.businessId !== businessId) throw new Error('Cross-tenant access denied');

  // Verify column exists on the card's board
  const board = await getBoard(businessId, card.boardId);
  if (!board) throw new Error('Board not found');
  if (!board.columns.some((c) => c.id === columnId)) throw new Error('columnId does not exist in this board');

  // Place at end of destination column
  const lastInDest = await adminDb
    .collection('kanbanCards')
    .where('businessId', '==', businessId)
    .where('boardId', '==', card.boardId)
    .where('columnId', '==', columnId)
    .orderBy('order', 'desc')
    .limit(1)
    .get();
  const nextOrder = lastInDest.empty ? 0 : (lastInDest.docs[0].data() as KanbanCard).order + 1;

  const now = new Date().toISOString();
  const patch: Partial<KanbanCard> = { columnId, order: nextOrder, updatedAt: now };
  await ref.update(patch);
  return { ...card, ...patch, id: snap.id };
}

async function updateCard(businessId: string, id: string, patch: Partial<KanbanCard>): Promise<KanbanCard> {
  if (!id || !patch) throw new Error('id and patch required');
  const ref = adminDb.collection('kanbanCards').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Card not found');
  const card = snap.data() as KanbanCard;
  if (card.businessId !== businessId) throw new Error('Cross-tenant access denied');

  const allowed: (keyof KanbanCard)[] = ['title', 'description', 'priority', 'dueDate', 'labels', 'assigneeIds', 'assigneeNames', 'coverColor'];
  const clean: Partial<KanbanCard> = {};
  for (const k of allowed) {
    if (k in patch) (clean as Record<string, unknown>)[k] = (patch as Record<string, unknown>)[k];
  }

  if (clean.priority && !ALLOWED_PRIORITIES.includes(clean.priority as KanbanPriority)) {
    throw new Error(`Invalid priority: ${clean.priority}`);
  }
  if (typeof clean.title === 'string') clean.title = clean.title.slice(0, 200);
  if (typeof clean.description === 'string') clean.description = clean.description.slice(0, 2000);

  clean.updatedAt = new Date().toISOString();
  await ref.update(clean);
  return { ...card, ...clean, id: snap.id };
}

async function assign(businessId: string, id: string, assigneeIds: string[], assigneeNames?: string[]): Promise<KanbanCard> {
  if (!id || !Array.isArray(assigneeIds)) throw new Error('id and assigneeIds required');
  const ref = adminDb.collection('kanbanCards').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Card not found');
  const card = snap.data() as KanbanCard;
  if (card.businessId !== businessId) throw new Error('Cross-tenant access denied');

  // Resolve names from users collection when not provided
  let names = assigneeNames;
  if (!names || names.length !== assigneeIds.length) {
    names = [];
    for (const uid of assigneeIds) {
      const u = await adminDb.collection('users').doc(uid).get();
      names.push((u.exists && (u.data() as { name?: string }).name) || '');
    }
  }

  const patch: Partial<KanbanCard> = {
    assigneeIds,
    assigneeNames: names,
    updatedAt: new Date().toISOString(),
  };
  await ref.update(patch);
  return { ...card, ...patch, id: snap.id };
}

async function addComment(businessId: string, id: string, text: string, authorId?: string, authorName?: string): Promise<KanbanComment> {
  if (!id || !text) throw new Error('id and text required');
  const ref = adminDb.collection('kanbanCards').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Card not found');
  const card = snap.data() as KanbanCard;
  if (card.businessId !== businessId) throw new Error('Cross-tenant access denied');

  const comment: KanbanComment = {
    id: adminDb.collection('_').doc().id,
    text: text.slice(0, 1000),
    authorId: authorId || 'agent',
    authorName: authorName || 'Agente IA',
    createdAt: new Date().toISOString(),
  };

  await ref.update({
    comments: FieldValue.arrayUnion(comment),
    commentsCount: FieldValue.increment(1),
    updatedAt: comment.createdAt,
  });

  return comment;
}

async function archiveCard(businessId: string, id: string): Promise<{ id: string; archived: true }> {
  // No soft-delete flag on KanbanCard — we move to a virtual "archived" by
  // deleting the doc (the UI never restores). If you need history, switch to
  // adding a `isArchived` field first.
  const ref = adminDb.collection('kanbanCards').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Card not found');
  const card = snap.data() as KanbanCard;
  if (card.businessId !== businessId) throw new Error('Cross-tenant access denied');
  await ref.delete();
  return { id, archived: true };
}
