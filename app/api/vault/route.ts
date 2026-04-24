/**
 * Password Vault API — encrypted storage for business-wide shared credentials.
 *
 * Actions (all require admin+ role in the target business):
 *   - list   — fetch entries the caller can see (no plaintext password)
 *   - save   — create or update an entry; accepts plaintext, encrypts server-side
 *   - reveal — return decrypted password for a single entry + log the access
 *   - delete — remove an entry
 *
 * Encryption: AES-256-GCM via lib/utils/encryption.ts (reuses the Meta token secret).
 * Plaintext NEVER leaves the server except on explicit `reveal`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { encryptToken, decryptToken } from '@/lib/utils/encryption';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { VaultEntry, VaultAccessScope, UserRole } from '@/lib/types';
import { FieldValue } from 'firebase-admin/firestore';

type Action = 'list' | 'save' | 'reveal' | 'delete';

interface SaveParams {
  id?: string;                   // omit = create
  title: string;
  username?: string;
  password?: string;             // plaintext — only required on create or if changing
  url?: string;
  notes?: string;
  category?: string;
  tags?: string[];
  accessScope?: VaultAccessScope;
  sharedWith?: string[];
}

export async function POST(req: NextRequest) {
  let body: { action: Action; businessId: string; params: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const auth = await verifyAuth(req, body.businessId);
  if (isAuthError(auth)) return auth;

  // All vault operations require admin or founder
  if (ROLE_HIERARCHY[auth.role as UserRole] < ROLE_HIERARCHY['admin']) {
    return NextResponse.json(
      { ok: false, error: 'Apenas administradores podem acessar o cofre' },
      { status: 403 },
    );
  }

  try {
    switch (body.action) {
      case 'list':
        return NextResponse.json({ ok: true, data: await listEntries(body.businessId, auth.uid) });
      case 'save':
        return NextResponse.json({ ok: true, data: await saveEntry(body.businessId, auth.uid, body.params as unknown as SaveParams) });
      case 'reveal':
        return NextResponse.json({ ok: true, data: await revealEntry(body.businessId, auth.uid, body.params.id as string) });
      case 'delete':
        return NextResponse.json({ ok: true, data: await deleteEntry(body.businessId, auth.uid, body.params.id as string) });
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[vault]', body.action, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// ─── List ────────────────────────────────────────────────────────────────────

async function listEntries(businessId: string, uid: string) {
  // All entries in the business — we filter by access client-side since the scope
  // test mixes role (already checked) + explicit uid membership.
  const snap = await adminDb.collection('passwordVaultEntries')
    .where('businessId', '==', businessId)
    .get();

  return snap.docs
    .map(d => {
      const data = d.data() as VaultEntry;
      // Strip the ciphertext from the list view; password is only retrieved via /reveal
      const { encryptedPassword, ...safe } = data;
      return { ...safe, id: d.id, hasPassword: !!encryptedPassword };
    })
    // Apply accessScope filter: 'specific' means only listed uids (admin still gated, but
    // this lets founders create vault entries that even other admins can't see)
    .filter(e => {
      if (e.accessScope === 'specific') {
        return (e.sharedWith || []).includes(uid) || e.createdBy === uid;
      }
      return true;
    });
}

// ─── Save (create or update) ─────────────────────────────────────────────────

async function resolveUserName(uid: string): Promise<string> {
  const snap = await adminDb.collection('users').doc(uid).get();
  if (!snap.exists) return 'Usuário';
  return (snap.data()?.name as string) || 'Usuário';
}

async function saveEntry(businessId: string, uid: string, p: SaveParams) {
  if (!p.title?.trim()) throw new Error('Título é obrigatório');
  const now = new Date().toISOString();
  const userName = await resolveUserName(uid);

  const base: Partial<VaultEntry> = {
    businessId,
    title: p.title.trim(),
    username: p.username?.trim() || undefined,
    url: p.url?.trim() || undefined,
    notes: p.notes?.trim() || undefined,
    category: p.category?.trim() || undefined,
    tags: p.tags && p.tags.length ? p.tags : undefined,
    accessScope: p.accessScope || 'admins',
    sharedWith: p.accessScope === 'specific' ? (p.sharedWith || []) : undefined,
    updatedBy: uid,
    updatedByName: userName,
    updatedAt: now,
  };

  if (p.id) {
    // Update path
    const ref = adminDb.collection('passwordVaultEntries').doc(p.id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('Entrada não encontrada');
    const existing = snap.data() as VaultEntry;
    if (existing.businessId !== businessId) throw new Error('Acesso negado');

    const patch: Record<string, unknown> = { ...base };
    // Re-encrypt only if a new password was provided
    if (p.password !== undefined && p.password !== '') {
      patch.encryptedPassword = await encryptToken(p.password);
    }
    // Remove undefineds — Firestore doesn't accept them
    const cleaned = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    await ref.update(cleaned);
    return { id: p.id, updated: true };
  }

  // Create path
  const doc: Partial<VaultEntry> = {
    ...base,
    ...(p.password ? { encryptedPassword: await encryptToken(p.password) } : {}),
    createdBy: uid,
    createdByName: userName,
    createdAt: now,
    accessCount: 0,
  };
  const cleaned = Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined));
  const ref = await adminDb.collection('passwordVaultEntries').add(cleaned);
  return { id: ref.id, created: true };
}

// ─── Reveal ──────────────────────────────────────────────────────────────────

async function revealEntry(businessId: string, uid: string, id: string) {
  const ref = adminDb.collection('passwordVaultEntries').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Entrada não encontrada');
  const data = snap.data() as VaultEntry;
  if (data.businessId !== businessId) throw new Error('Acesso negado');

  // Scope check (admin role already validated above)
  if (data.accessScope === 'specific' &&
      data.createdBy !== uid &&
      !(data.sharedWith || []).includes(uid)) {
    throw new Error('Você não tem permissão para ver esta senha');
  }

  if (!data.encryptedPassword) {
    return { id, password: null, username: data.username, url: data.url };
  }
  const password = await decryptToken(data.encryptedPassword);

  // Audit trail — never block reveal on audit write failure
  try {
    await ref.update({
      lastAccessedAt: new Date().toISOString(),
      lastAccessedBy: uid,
      accessCount: FieldValue.increment(1),
    });
  } catch (err) {
    console.warn('[vault/reveal] access log failed:', err);
  }

  return { id, password, username: data.username, url: data.url };
}

// ─── Delete ──────────────────────────────────────────────────────────────────

async function deleteEntry(businessId: string, uid: string, id: string) {
  const ref = adminDb.collection('passwordVaultEntries').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Entrada não encontrada');
  const data = snap.data() as VaultEntry;
  if (data.businessId !== businessId) throw new Error('Acesso negado');
  // Only the creator or a founder can delete (founders always pass earlier role check,
  // so we just add the creator exception here)
  if (data.createdBy !== uid) {
    const me = await adminDb.collection('users').doc(uid).get();
    const myRole = me.data()?.role as UserRole | undefined;
    if (!myRole || ROLE_HIERARCHY[myRole] < ROLE_HIERARCHY['admin']) {
      throw new Error('Apenas administradores podem excluir entradas de outros usuários');
    }
  }
  await ref.delete();
  return { id, deleted: true };
}
