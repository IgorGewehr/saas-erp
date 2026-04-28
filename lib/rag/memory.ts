/**
 * Agent memory tier-2 — semantic facts per (business, contact).
 *
 * Unlike `Client.aiSummary` (a free-form rolling string, tier-1), this is
 * a structured list of atomic facts the agent has gathered and can recall:
 *
 *   { text: "Cliente pediu sem cebola nas últimas 3 vezes", evidence: "order:abc", confidence: 0.9, validUntil?: "2026-12-31" }
 *   { text: "Prefere receber entregas após 19h", evidence: "conv:xyz", confidence: 0.8 }
 *   { text: "Alérgico a lactose", evidence: "explicit:user-said", confidence: 1.0 }
 *
 * Storage: `businesses/{businessId}/agentMemory/{contactId}` — subcollection
 * path gives natural multi-tenant isolation (no businessId filter needed).
 *
 * Facts are NOT vectorized for retrieval. They're small (< 20 per contact),
 * the agent reads all of them on each turn and filters by relevance. If a
 * contact ever exceeds 30 facts, we start evicting the oldest/lowest-confidence.
 */

import { adminDb } from '@/lib/config/firebaseAdmin';

const MAX_FACTS_PER_CONTACT = 30;

export interface MemoryFact {
  id: string;
  /** Human-readable fact, 1 sentence pt-BR. */
  text: string;
  /** How the agent came to know this (conv id, order id, or "explicit"). */
  evidence?: string;
  /** 0-1. Lower if the agent inferred rather than saw it stated. */
  confidence: number;
  /** Optional: iso date when the fact expires (promo window, seasonal pref). */
  validUntil?: string;
  /** Categories to filter/retrieve by. */
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MemoryDoc {
  businessId: string;
  contactId: string;
  facts: MemoryFact[];
  updatedAt: string;
  version: number;
}

export async function getMemory(businessId: string, contactId: string): Promise<MemoryDoc | null> {
  const ref = adminDb
    .collection('businesses').doc(businessId)
    .collection('agentMemory').doc(contactId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return snap.data() as MemoryDoc;
}

/**
 * Render the fact list as a compact pt-BR block for the agent prompt.
 * Filters out expired facts. Sorted by confidence DESC then recency.
 */
export async function getMemorySummary(
  businessId: string,
  contactId: string,
  opts: { maxChars?: number; maxFacts?: number } = {},
): Promise<string> {
  const doc = await getMemory(businessId, contactId);
  if (!doc || !doc.facts?.length) return '';

  const now = new Date().toISOString();
  const active = doc.facts
    .filter((f) => !f.validUntil || f.validUntil > now)
    .sort((a, b) => {
      const c = b.confidence - a.confidence;
      if (Math.abs(c) > 0.01) return c;
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    })
    .slice(0, opts.maxFacts ?? 15);

  if (!active.length) return '';

  const max = opts.maxChars ?? 800;
  const lines: string[] = [];
  let total = 0;
  for (const f of active) {
    const bullet = `- ${f.text}`;
    if (total + bullet.length + 1 > max) break;
    lines.push(bullet);
    total += bullet.length + 1;
  }
  return lines.join('\n');
}

export async function addFact(params: {
  businessId: string;
  contactId: string;
  text: string;
  evidence?: string;
  confidence?: number;
  validUntil?: string;
  tags?: string[];
}): Promise<MemoryFact> {
  const { businessId, contactId, text, evidence, tags } = params;
  if (!text || !text.trim()) throw new Error('text required');
  const confidence = clampConfidence(params.confidence ?? 0.7);

  const ref = adminDb
    .collection('businesses').doc(businessId)
    .collection('agentMemory').doc(contactId);

  const now = new Date().toISOString();
  const fact: MemoryFact = {
    id: adminDb.collection('_').doc().id,
    text: text.trim().slice(0, 500),
    evidence,
    confidence,
    validUntil: params.validUntil,
    tags: tags?.slice(0, 10),
    createdAt: now,
    updatedAt: now,
  };

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing: MemoryFact[] = snap.exists ? (snap.data() as MemoryDoc).facts || [] : [];

    // De-dup: if a fact with the same text (case-insensitive) already exists, bump updatedAt + confidence
    const norm = fact.text.toLowerCase();
    const idx = existing.findIndex((f) => f.text.toLowerCase() === norm);
    let merged: MemoryFact[];
    if (idx >= 0) {
      const prev = existing[idx];
      merged = [...existing];
      merged[idx] = {
        ...prev,
        confidence: Math.min(1, Math.max(prev.confidence, confidence)),
        evidence: evidence || prev.evidence,
        validUntil: params.validUntil || prev.validUntil,
        updatedAt: now,
      };
    } else {
      merged = [...existing, fact];
    }

    // Eviction: keep top MAX by (confidence, recency)
    if (merged.length > MAX_FACTS_PER_CONTACT) {
      merged = merged
        .sort((a, b) => {
          const c = b.confidence - a.confidence;
          if (Math.abs(c) > 0.01) return c;
          return (b.updatedAt || '').localeCompare(a.updatedAt || '');
        })
        .slice(0, MAX_FACTS_PER_CONTACT);
    }

    const data: MemoryDoc = {
      businessId,
      contactId,
      facts: merged,
      updatedAt: now,
      version: ((snap.exists && (snap.data() as MemoryDoc).version) || 0) + 1,
    };
    tx.set(ref, data);
  });

  return fact;
}

export async function removeFact(businessId: string, contactId: string, factId: string): Promise<boolean> {
  const ref = adminDb
    .collection('businesses').doc(businessId)
    .collection('agentMemory').doc(contactId);
  let removed = false;
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const doc = snap.data() as MemoryDoc;
    const next = (doc.facts || []).filter((f) => f.id !== factId);
    removed = next.length !== (doc.facts || []).length;
    if (!removed) return;
    tx.update(ref, {
      facts: next,
      updatedAt: new Date().toISOString(),
      version: (doc.version || 0) + 1,
    });
  });
  return removed;
}

export async function clearMemory(businessId: string, contactId: string): Promise<void> {
  const ref = adminDb
    .collection('businesses').doc(businessId)
    .collection('agentMemory').doc(contactId);
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.delete();
}

function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return 0.7;
  return Math.min(1, Math.max(0, n));
}
