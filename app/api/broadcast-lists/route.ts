/**
 * GET  /api/broadcast-lists?businessId=xxx
 * POST /api/broadcast-lists
 *
 * CRUD de listas reusáveis de recipientes para campanhas (BroadcastList).
 * Permite ao usuário salvar uma lista (paste/CSV processada) e reaproveitá-la
 * em campanhas futuras sem precisar reimportar.
 *
 * GET — retorna todas as listas do tenant ordenadas por updatedAt desc.
 * POST — cria uma nova lista. Body: { businessId, name, description?, recipients[] }.
 *
 * Auth: Bearer token do Firebase. Role mínimo: operator.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { ROLE_HIERARCHY } from '@/lib/types';
import type {
  BroadcastList,
  BroadcastListType,
  BroadcastRecipient,
  UserRole,
} from '@/lib/types';

const MAX_RECIPIENTS_PER_LIST = 10_000;
const MAX_NAME_LEN = 120;
const MAX_DESC_LEN = 500;

function sanitizeRecipients(input: unknown): BroadcastRecipient[] {
  if (!Array.isArray(input)) return [];
  const out: BroadcastRecipient[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const phone = typeof r.phoneNumber === 'string' ? r.phoneNumber.trim() : undefined;
    const email = typeof r.email === 'string' ? r.email.trim().toLowerCase() : undefined;
    if (!phone && !email) continue; // recipiente sem identidade — descarta
    const rec: BroadcastRecipient = {};
    if (phone) rec.phoneNumber = phone;
    if (email) rec.email = email;
    if (typeof r.name === 'string' && r.name.trim()) rec.name = r.name.trim().slice(0, 120);
    if (typeof r.contactId === 'string' && r.contactId.trim()) rec.contactId = r.contactId.trim();
    out.push(rec);
  }
  return out;
}

function deriveType(recipients: BroadcastRecipient[]): BroadcastListType {
  let hasPhone = false;
  let hasEmail = false;
  for (const r of recipients) {
    if (r.phoneNumber) hasPhone = true;
    if (r.email) hasEmail = true;
    if (hasPhone && hasEmail) return 'mixed';
  }
  if (hasPhone && hasEmail) return 'mixed';
  if (hasEmail) return 'email';
  return 'phone';
}

export async function GET(req: NextRequest) {
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`broadcast-lists-get:${clientIp}`, 60, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get('businessId');
  if (!businessId) {
    return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
  }

  const authResult = await verifyAuth(req, businessId);
  if (isAuthError(authResult)) return authResult;

  try {
    const snap = await adminDb.collection('broadcastLists')
      .where('businessId', '==', businessId)
      .orderBy('updatedAt', 'desc')
      .limit(200)
      .get();

    const lists: BroadcastList[] = snap.docs.map(d => ({
      ...(d.data() as BroadcastList),
      id: d.id,
    }));

    return NextResponse.json({ lists });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('index')) {
      // Composite index ausente (broadcastLists: businessId ASC, updatedAt DESC).
      // Fallback: query sem orderBy e ordena em memória — degradação graciosa.
      try {
        const snap = await adminDb.collection('broadcastLists')
          .where('businessId', '==', businessId)
          .limit(200)
          .get();
        const lists: BroadcastList[] = snap.docs
          .map(d => ({ ...(d.data() as BroadcastList), id: d.id }))
          .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        return NextResponse.json({ lists, _indexMissing: true });
      } catch (fallbackErr) {
        console.error('[broadcast-lists GET] fallback error:', fallbackErr);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
      }
    }
    console.error('[broadcast-lists GET] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`broadcast-lists-post:${clientIp}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests — aguarde antes de criar outra lista.' }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const businessId = typeof body.businessId === 'string' ? body.businessId : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';

  if (!businessId) {
    return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (name.length > MAX_NAME_LEN) {
    return NextResponse.json({ error: `name must be ≤ ${MAX_NAME_LEN} chars` }, { status: 400 });
  }
  if (description.length > MAX_DESC_LEN) {
    return NextResponse.json({ error: `description must be ≤ ${MAX_DESC_LEN} chars` }, { status: 400 });
  }

  const recipients = sanitizeRecipients(body.recipients);
  if (recipients.length === 0) {
    return NextResponse.json({ error: 'recipients must contain at least one valid entry' }, { status: 400 });
  }
  if (recipients.length > MAX_RECIPIENTS_PER_LIST) {
    return NextResponse.json({
      error: `recipients limit exceeded (max ${MAX_RECIPIENTS_PER_LIST}). Divida em listas menores.`,
    }, { status: 400 });
  }

  const authResult = await verifyAuth(req, businessId);
  if (isAuthError(authResult)) return authResult;

  const role = authResult.role as UserRole;
  if ((ROLE_HIERARCHY[role] || 0) < ROLE_HIERARCHY['operator']) {
    return NextResponse.json({ error: 'Forbidden — operator role required' }, { status: 403 });
  }

  try {
    // Busca nome do criador (best-effort — fallback para uid se falhar)
    let createdByName = authResult.uid;
    try {
      const userDoc = await adminDb.collection('users').doc(authResult.uid).get();
      const data = userDoc.data();
      if (data?.name) createdByName = data.name as string;
    } catch {
      // ignore — usa uid
    }

    const now = new Date().toISOString();
    const docRef = adminDb.collection('broadcastLists').doc();
    const list: BroadcastList = {
      id: docRef.id,
      businessId,
      name,
      type: deriveType(recipients),
      recipients,
      recipientCount: recipients.length,
      createdBy: authResult.uid,
      createdByName,
      createdAt: now,
      updatedAt: now,
      ...(description ? { description } : {}),
    };

    await docRef.set(list);
    return NextResponse.json({ list }, { status: 201 });
  } catch (err) {
    console.error('[broadcast-lists POST] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
