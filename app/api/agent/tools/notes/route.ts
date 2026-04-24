/**
 * Agent tool: Notes (personal + team shared notes).
 *
 * Mirrors the shape used by components/features/notas/NotasModule.tsx.
 * Collection: `notes/{id}` with `businessId`, `authorId`, `scope` fields.
 *
 * Actions:
 *   - list                  list notes by scope (personal requires authorId)
 *   - get                   single note
 *   - create                new note
 *   - update                patch title/content/color/pinned
 *   - delete                hard delete (notes are cheap; no soft delete today)
 *   - search                keyword search on title + content
 */

import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';

type NoteColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple' | 'orange' | 'red' | 'neutral';
type NoteScope = 'personal' | 'team';

interface Note {
  id: string;
  businessId: string;
  authorId: string;
  authorName: string;
  authorInitials: string;
  title: string;
  content: string;
  color: NoteColor;
  scope: NoteScope;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

const ALLOWED_COLORS: NoteColor[] = ['yellow', 'green', 'blue', 'pink', 'purple', 'orange', 'red', 'neutral'];
const ALLOWED_SCOPES: NoteScope[] = ['personal', 'team'];

type Action = 'list' | 'get' | 'create' | 'update' | 'delete' | 'search';

interface CreateParams {
  title: string;
  content: string;
  color?: NoteColor;
  scope?: NoteScope;
  isPinned?: boolean;
  authorId?: string;        // defaults to 'agent'
  authorName?: string;      // defaults to 'Agente IA'
}

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
      case 'list':
        return NextResponse.json({ ok: true, data: await listNotes(businessId, body.params as { scope?: NoteScope; authorId?: string; limit?: number; onlyPinned?: boolean }) });
      case 'get':
        return NextResponse.json({ ok: true, data: await getNote(businessId, body.params.id as string) });
      case 'create':
        return NextResponse.json({ ok: true, data: await createNote(businessId, body.params as unknown as CreateParams) });
      case 'update':
        return NextResponse.json({ ok: true, data: await updateNote(businessId, body.params.id as string, body.params.patch as Partial<Note>) });
      case 'delete':
        return NextResponse.json({ ok: true, data: await deleteNote(businessId, body.params.id as string) });
      case 'search':
        return NextResponse.json({ ok: true, data: await searchNotes(businessId, body.params as { query: string; scope?: NoteScope; authorId?: string; limit?: number }) });
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[agent.notes] error', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function listNotes(
  businessId: string,
  p: { scope?: NoteScope; authorId?: string; limit?: number; onlyPinned?: boolean },
): Promise<Note[]> {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
  let q: FirebaseFirestore.Query = adminDb.collection('notes').where('businessId', '==', businessId);

  if (p.scope && ALLOWED_SCOPES.includes(p.scope)) q = q.where('scope', '==', p.scope);
  if (p.authorId) q = q.where('authorId', '==', p.authorId);
  if (p.onlyPinned) q = q.where('isPinned', '==', true);

  const snap = await q.orderBy('updatedAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => ({ ...(d.data() as Note), id: d.id }));
}

async function getNote(businessId: string, id: string): Promise<Note | null> {
  if (!id) throw new Error('id required');
  const doc = await adminDb.collection('notes').doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() as Note;
  if (data.businessId !== businessId) throw new Error('Cross-tenant access denied');
  return { ...data, id: doc.id };
}

async function createNote(businessId: string, p: CreateParams): Promise<Note> {
  if (!p.title || typeof p.title !== 'string') throw new Error('title required');
  if (!p.content || typeof p.content !== 'string') throw new Error('content required');

  const now = new Date().toISOString();
  const color: NoteColor = p.color && ALLOWED_COLORS.includes(p.color) ? p.color : 'yellow';
  const scope: NoteScope = p.scope && ALLOWED_SCOPES.includes(p.scope) ? p.scope : 'team';
  const authorName = p.authorName || 'Agente IA';
  const authorInitials = computeInitials(authorName);

  const ref = adminDb.collection('notes').doc();
  const note: Note = {
    id: ref.id,
    businessId,
    authorId: p.authorId || 'agent',
    authorName,
    authorInitials,
    title: p.title.slice(0, 200),
    content: p.content.slice(0, 10000),
    color,
    scope,
    isPinned: !!p.isPinned,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(note);
  return note;
}

async function updateNote(businessId: string, id: string, patch: Partial<Note>): Promise<Note> {
  if (!id || !patch) throw new Error('id and patch required');
  const ref = adminDb.collection('notes').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Note not found');
  const note = snap.data() as Note;
  if (note.businessId !== businessId) throw new Error('Cross-tenant access denied');

  const clean: Partial<Note> = {};
  if (typeof patch.title === 'string') clean.title = patch.title.slice(0, 200);
  if (typeof patch.content === 'string') clean.content = patch.content.slice(0, 10000);
  if (patch.color && ALLOWED_COLORS.includes(patch.color)) clean.color = patch.color;
  if (patch.scope && ALLOWED_SCOPES.includes(patch.scope)) clean.scope = patch.scope;
  if (typeof patch.isPinned === 'boolean') clean.isPinned = patch.isPinned;

  clean.updatedAt = new Date().toISOString();
  await ref.update(clean);
  return { ...note, ...clean, id: snap.id };
}

async function deleteNote(businessId: string, id: string): Promise<{ id: string; deleted: true }> {
  if (!id) throw new Error('id required');
  const ref = adminDb.collection('notes').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Note not found');
  const note = snap.data() as Note;
  if (note.businessId !== businessId) throw new Error('Cross-tenant access denied');
  await ref.delete();
  return { id, deleted: true };
}

async function searchNotes(
  businessId: string,
  p: { query: string; scope?: NoteScope; authorId?: string; limit?: number },
): Promise<Note[]> {
  if (!p.query) throw new Error('query required');
  const limit = Math.min(Math.max(p.limit ?? 20, 1), 50);

  // Fetch broadly (Firestore has no full-text index) then filter in memory.
  // Keep the candidate set small to stay within reasonable cost.
  const candidates = await listNotes(businessId, { scope: p.scope, authorId: p.authorId, limit: 200 });
  const q = p.query.toLowerCase().trim();
  if (!q) return candidates.slice(0, limit);

  const scored = candidates
    .map((n) => {
      const hay = `${n.title} ${n.content}`.toLowerCase();
      const idx = hay.indexOf(q);
      if (idx < 0) return { note: n, score: 0 };
      // crude scoring: earlier match + title hit bonus
      const titleHit = n.title.toLowerCase().includes(q) ? 50 : 0;
      return { note: n, score: 100 - Math.min(idx, 99) + titleHit };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.note);

  return scored;
}

function computeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
