/**
 * Agent tool: Conversations metadata, messages and snippets.
 *
 * Intentionally SEPARATE from `/api/conversations/send` (which is the outbound
 * channel) — this endpoint is for agent-driven READ operations on threads plus
 * the snippet library.
 *
 * Actions:
 *   - list                  list conversations (filters: channel/status/priority/label)
 *   - get                   single conversation
 *   - list_messages         messages in a conversation (paginated)
 *   - set_label             add/remove label
 *   - set_priority          set priority
 *   - set_status            change status (open/waiting/resolved)
 *   - list_snippets         snippet library (optionally filtered by category)
 *   - search_snippets       keyword search in snippet content
 */

import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { Conversation, ConversationMessage, Snippet, ConversationChannel, ConversationStatus } from '@/lib/types';
import { FieldValue } from 'firebase-admin/firestore';

type Action =
  | 'list'
  | 'get'
  | 'list_messages'
  | 'set_label'
  | 'set_priority'
  | 'set_status'
  | 'list_snippets'
  | 'search_snippets';

const VALID_CHANNELS: ConversationChannel[] = ['whatsapp', 'facebook', 'instagram'];
const VALID_STATUS: ConversationStatus[] = ['open', 'waiting', 'resolved'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

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
        return NextResponse.json({ ok: true, data: await listConversations(businessId, body.params as { channel?: ConversationChannel; status?: ConversationStatus; priority?: string; limit?: number }) });
      case 'get':
        return NextResponse.json({ ok: true, data: await getConversation(businessId, body.params.id as string) });
      case 'list_messages':
        return NextResponse.json({ ok: true, data: await listMessages(businessId, body.params.conversationId as string, body.params.limit as number | undefined) });
      case 'set_label':
        return NextResponse.json({ ok: true, data: await setLabel(businessId, body.params.id as string, body.params.label as string, body.params.remove as boolean | undefined) });
      case 'set_priority':
        return NextResponse.json({ ok: true, data: await setPriority(businessId, body.params.id as string, body.params.priority as string) });
      case 'set_status':
        return NextResponse.json({ ok: true, data: await setStatus(businessId, body.params.id as string, body.params.status as ConversationStatus) });
      case 'list_snippets':
        return NextResponse.json({ ok: true, data: await listSnippets(businessId, body.params as { category?: string; sectorId?: string; limit?: number }) });
      case 'search_snippets':
        return NextResponse.json({ ok: true, data: await searchSnippets(businessId, body.params.query as string, body.params.limit as number | undefined) });
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[agent.conversations] error', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

// ─── Conversations ───────────────────────────────────────────────────────────

async function listConversations(
  businessId: string,
  p: { channel?: ConversationChannel; status?: ConversationStatus; priority?: string; limit?: number },
): Promise<Conversation[]> {
  const limit = Math.min(Math.max(p.limit ?? 30, 1), 100);
  let q: FirebaseFirestore.Query = adminDb.collection('conversations').where('businessId', '==', businessId);
  if (p.channel && VALID_CHANNELS.includes(p.channel)) q = q.where('channel', '==', p.channel);
  if (p.status && VALID_STATUS.includes(p.status)) q = q.where('status', '==', p.status);
  if (p.priority) q = q.where('priority', '==', p.priority);

  const snap = await q.orderBy('lastMessageAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => ({ ...(d.data() as Conversation), id: d.id }));
}

async function getConversation(businessId: string, id: string): Promise<Conversation | null> {
  if (!id) throw new Error('id required');
  const doc = await adminDb.collection('conversations').doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() as Conversation;
  if (data.businessId !== businessId) throw new Error('Cross-tenant access denied');
  return { ...data, id: doc.id };
}

async function listMessages(businessId: string, conversationId: string, limit?: number): Promise<ConversationMessage[]> {
  if (!conversationId) throw new Error('conversationId required');
  const cap = Math.min(Math.max(limit ?? 50, 1), 200);

  // Verify conversation belongs to tenant
  const conv = await getConversation(businessId, conversationId);
  if (!conv) throw new Error('Conversation not found');

  const snap = await adminDb
    .collection('conversationMessages')
    .where('conversationId', '==', conversationId)
    .where('businessId', '==', businessId)
    .orderBy('sentAt', 'desc')
    .limit(cap)
    .get();

  // Return in chronological order (oldest first)
  return snap.docs
    .map((d) => ({ ...(d.data() as ConversationMessage), id: d.id }))
    .reverse();
}

async function setLabel(businessId: string, id: string, label: string, remove?: boolean): Promise<Conversation> {
  if (!id || !label) throw new Error('id and label required');
  const ref = adminDb.collection('conversations').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Conversation not found');
  const c = snap.data() as Conversation;
  if (c.businessId !== businessId) throw new Error('Cross-tenant access denied');

  const now = new Date().toISOString();
  const patch = {
    labels: remove ? FieldValue.arrayRemove(label) : FieldValue.arrayUnion(label),
    updatedAt: now,
  };
  await ref.update(patch);
  return { ...c, labels: remove ? (c.labels || []).filter((l) => l !== label) : [...new Set([...(c.labels || []), label])], updatedAt: now, id: snap.id };
}

async function setPriority(businessId: string, id: string, priority: string): Promise<Conversation> {
  if (!id) throw new Error('id required');
  if (!VALID_PRIORITIES.includes(priority as (typeof VALID_PRIORITIES)[number])) {
    throw new Error(`priority must be one of ${VALID_PRIORITIES.join(',')}`);
  }

  const ref = adminDb.collection('conversations').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Conversation not found');
  const c = snap.data() as Conversation;
  if (c.businessId !== businessId) throw new Error('Cross-tenant access denied');

  const now = new Date().toISOString();
  const patch = { priority, updatedAt: now };
  await ref.update(patch);
  return { ...c, ...patch, id: snap.id } as Conversation;
}

async function setStatus(businessId: string, id: string, status: ConversationStatus): Promise<Conversation> {
  if (!id) throw new Error('id required');
  if (!VALID_STATUS.includes(status)) throw new Error(`status must be one of ${VALID_STATUS.join(',')}`);

  const ref = adminDb.collection('conversations').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Conversation not found');
  const c = snap.data() as Conversation;
  if (c.businessId !== businessId) throw new Error('Cross-tenant access denied');

  const now = new Date().toISOString();
  // Reabertura: resolved → open. Track via reopenedCount + lastReopenedAt
  // pra que analytics exiba taxa de reabertura sem precisar de status history.
  const isReopening = c.status === 'resolved' && status === 'open';
  const patch: Record<string, unknown> = { status, updatedAt: now };
  if (isReopening) {
    patch.reopenedCount = (c.reopenedCount ?? 0) + 1;
    patch.lastReopenedAt = now;
  }
  await ref.update(patch);
  return { ...c, ...patch, id: snap.id } as Conversation;
}

// ─── Snippets ────────────────────────────────────────────────────────────────

async function listSnippets(
  businessId: string,
  p: { category?: string; sectorId?: string; limit?: number },
): Promise<Snippet[]> {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
  let q: FirebaseFirestore.Query = adminDb.collection('snippets').where('businessId', '==', businessId);
  if (p.category) q = q.where('category', '==', p.category);
  if (p.sectorId) q = q.where('sectorId', '==', p.sectorId);

  const snap = await q.orderBy('shortcode').limit(limit).get();
  return snap.docs.map((d) => ({ ...(d.data() as Snippet), id: d.id }));
}

async function searchSnippets(businessId: string, query: string, limit?: number): Promise<Snippet[]> {
  if (!query) throw new Error('query required');
  const cap = Math.min(Math.max(limit ?? 20, 1), 50);

  const snap = await adminDb.collection('snippets').where('businessId', '==', businessId).limit(500).get();
  const candidates = snap.docs.map((d) => ({ ...(d.data() as Snippet), id: d.id }));

  const q = query.toLowerCase().trim();
  const scored = candidates
    .map((s) => {
      const shortcodeHit = s.shortcode.toLowerCase().includes(q) ? 100 : 0;
      const hay = s.content.toLowerCase();
      const idx = hay.indexOf(q);
      const contentScore = idx >= 0 ? 50 - Math.min(idx / 10, 50) : 0;
      const score = shortcodeHit + contentScore;
      return { snippet: s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map((x) => x.snippet);

  return scored;
}
