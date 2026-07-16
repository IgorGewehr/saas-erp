/**
 * Firestore-backed vector store for tenant knowledge base.
 *
 * Design choice: brute-force cosine similarity over in-memory arrays.
 * For typical tenants (products + services + snippets + policies = ~50-500
 * chunks per business), this is 20-100ms — faster than Firestore vector
 * search for small corpora, with zero index setup.
 *
 * For tenants crossing ~2000 chunks, switch to Firestore's native
 * findNearest() (requires declared vector index in firestore.indexes.json) —
 * no collection migration needed; both paths read the same doc shape.
 *
 * Source kinds (+ reindex priority):
 *   - product          — menu items (high-priority search target)
 *   - service          — service catalog
 *   - snippet          — quick-reply templates
 *   - faq              — business FAQ entries (future: dedicated collection)
 *   - business_desc    — tenant's business description from settings
 *   - policy           — policies (cancellation, refund, SLA) from settings
 *
 * Chunk granularity: one chunk per source document (no splitting yet — our
 * corpus items are short descriptions, not long docs). When we add policies
 * > 2KB we'll add paragraph-splitting here.
 */

import { adminDb } from '@/lib/config/firebaseAdmin';
import type { Firestore } from 'firebase-admin/firestore';
import { embedText, cosineSim, vectorToArray, arrayToVector } from './embed';
import crypto from 'node:crypto';

export type KnowledgeSource = 'product' | 'service' | 'snippet' | 'faq' | 'business_desc' | 'policy';

export interface KnowledgeChunk {
  id: string;
  businessId: string;
  source: KnowledgeSource;
  sourceId: string;         // id of the product/service/etc. (or synthetic like 'business_desc')
  text: string;             // the searchable content
  metadata?: Record<string, unknown>;
  contentHash: string;      // sha256 of text — skip re-embedding when unchanged
  embedding: number[];      // serialized Float32Array
  embeddingModel: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSearchResult {
  chunk: KnowledgeChunk;
  score: number;            // cosine similarity -1..1
}

/**
 * Upsert a chunk — skips re-embedding when contentHash matches existing.
 * Returns the final chunk (from DB or freshly written).
 */
export async function upsertChunk(params: {
  businessId: string;
  source: KnowledgeSource;
  sourceId: string;
  text: string;
  metadata?: Record<string, unknown>;
  model?: string;
}): Promise<KnowledgeChunk> {
  const { businessId, source, sourceId, text, metadata, model } = params;
  if (!text || !text.trim()) throw new Error('empty text');

  const id = `${source}_${sourceId}`;
  const contentHash = hashContent(text);
  const ref = adminDb.collection('knowledgeChunks').doc(`${businessId}__${id}`);

  // Check if we can skip re-embedding
  const existing = await ref.get();
  if (existing.exists) {
    const prev = existing.data() as KnowledgeChunk;
    if (prev.contentHash === contentHash) {
      return prev;  // no change
    }
  }

  const vec = await embedText(text);
  const now = new Date().toISOString();
  const chunk: KnowledgeChunk = {
    id: ref.id,
    businessId,
    source,
    sourceId,
    text: text.slice(0, 4000),
    metadata,
    contentHash,
    embedding: vectorToArray(vec),
    embeddingModel: model || process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small',
    createdAt: existing.exists ? (existing.data() as KnowledgeChunk).createdAt : now,
    updatedAt: now,
  };

  await ref.set(chunk);
  return chunk;
}

/**
 * Remove chunks that no longer exist in the source collection.
 * Called during reindex after upserting all active items.
 */
export async function pruneOrphans(
  businessId: string,
  source: KnowledgeSource,
  activeSourceIds: Set<string>,
): Promise<number> {
  const snap = await adminDb
    .collection('knowledgeChunks')
    .where('businessId', '==', businessId)
    .where('source', '==', source)
    .get();

  const batch = adminDb.batch();
  let count = 0;
  for (const doc of snap.docs) {
    const chunk = doc.data() as KnowledgeChunk;
    if (!activeSourceIds.has(chunk.sourceId)) {
      batch.delete(doc.ref);
      count += 1;
    }
  }
  if (count > 0) await batch.commit();
  return count;
}

/**
 * Search top-K most similar chunks to a query string.
 * When sourceFilter is set, restricts to that source kind.
 */
export async function searchKnowledge(params: {
  businessId: string;
  query: string;
  k?: number;
  sources?: KnowledgeSource[];
  minScore?: number;
  db?: Firestore;
}): Promise<KnowledgeSearchResult[]> {
  const { businessId, query, sources, minScore = 0.3 } = params;
  const k = Math.min(Math.max(params.k ?? 5, 1), 20);
  const db = params.db || adminDb;

  if (!query || !query.trim()) return [];

  // Embed query + pull candidate chunks
  const [queryVec, chunksSnap] = await Promise.all([
    embedText(query),
    (async () => {
      let q: FirebaseFirestore.Query = db.collection('knowledgeChunks').where('businessId', '==', businessId);
      if (sources && sources.length === 1) {
        q = q.where('source', '==', sources[0]);
      }
      return q.limit(2000).get();  // hard cap — tenant with >2K chunks should use native vector search
    })(),
  ]);

  const scored: KnowledgeSearchResult[] = [];
  for (const doc of chunksSnap.docs) {
    const chunk = doc.data() as KnowledgeChunk;
    // Filter in memory when multiple source kinds requested
    if (sources && sources.length > 1 && !sources.includes(chunk.source)) continue;
    const vec = arrayToVector(chunk.embedding);
    const score = cosineSim(queryVec, vec);
    if (score < minScore) continue;
    scored.push({ chunk, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

function hashContent(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
}
