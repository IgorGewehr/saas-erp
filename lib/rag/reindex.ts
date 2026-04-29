/**
 * Walks tenant collections and (re)indexes them into knowledgeChunks.
 *
 * Invoked:
 *   - Manually via admin endpoint /api/rag/reindex (Wave 3 MVP)
 *   - Auto-triggered (fire-and-forget) after AgenteTab save for business_desc + policy
 *   - On write via Firestore trigger (future — cloud function)
 *
 * Sources indexed:
 *   - products       → name + menuCategory + description + dietary
 *   - services       → name + category + description
 *   - snippets       → shortcode + content
 *   - business_desc  → single chunk from settings.aiAgent.businessDescription
 *   - policy         → cancellation + refund + privacy from settings.aiAgent.policies
 *
 * The returned stats are useful for the UI reindex button.
 */

import { adminDb } from '@/lib/config/firebaseAdmin';
import type { Product, Service, Snippet, Business } from '@/lib/types';
import { upsertChunk, pruneOrphans, type KnowledgeSource } from './store';

export interface ReindexStats {
  source: KnowledgeSource;
  upserted: number;
  pruned: number;
  skipped: number;    // unchanged content-hash
  errors: number;
  durationMs: number;
}

export async function reindexAll(businessId: string): Promise<ReindexStats[]> {
  const stats: ReindexStats[] = [];
  stats.push(await reindexProducts(businessId));
  stats.push(await reindexServices(businessId));
  stats.push(await reindexSnippets(businessId));
  stats.push(await reindexBusinessDesc(businessId));
  stats.push(await reindexPolicies(businessId));
  return stats;
}

export async function reindexProducts(businessId: string): Promise<ReindexStats> {
  const t0 = Date.now();
  const snap = await adminDb
    .collection('products')
    .where('businessId', '==', businessId)
    .where('isActive', '==', true)
    .get();

  let upserted = 0;
  let skipped = 0;
  let errors = 0;
  const active = new Set<string>();

  for (const doc of snap.docs) {
    const p = { ...(doc.data() as Product), id: doc.id };
    active.add(p.id);
    const text = buildProductText(p);
    if (!text) continue;
    try {
      const before = Date.now();
      const chunk = await upsertChunk({
        businessId,
        source: 'product',
        sourceId: p.id,
        text,
        metadata: { category: p.category, price: p.salePrice, hasStock: (p.currentStock ?? 0) > 0 || !!p.components?.length },
      });
      // Rough heuristic: if updatedAt == createdAt-ish it was just created; else skipped
      if (Date.now() - new Date(chunk.updatedAt).getTime() < 1500 && chunk.updatedAt >= new Date(before).toISOString()) {
        upserted += 1;
      } else {
        skipped += 1;
      }
    } catch (err) {
      console.warn('[reindex.products] error', p.id, (err as Error).message);
      errors += 1;
    }
  }

  const pruned = await pruneOrphans(businessId, 'product', active);
  return { source: 'product', upserted, pruned, skipped, errors, durationMs: Date.now() - t0 };
}

export async function reindexServices(businessId: string): Promise<ReindexStats> {
  const t0 = Date.now();
  const snap = await adminDb
    .collection('services')
    .where('businessId', '==', businessId)
    .where('isActive', '==', true)
    .get();

  let upserted = 0;
  let skipped = 0;
  let errors = 0;
  const active = new Set<string>();

  for (const doc of snap.docs) {
    const s = { ...(doc.data() as Service), id: doc.id };
    active.add(s.id);
    const text = buildServiceText(s);
    if (!text) continue;
    try {
      const before = Date.now();
      const chunk = await upsertChunk({
        businessId,
        source: 'service',
        sourceId: s.id,
        text,
        metadata: { category: s.category, price: s.price, duration: s.duration },
      });
      if (Date.now() - new Date(chunk.updatedAt).getTime() < 1500 && chunk.updatedAt >= new Date(before).toISOString()) {
        upserted += 1;
      } else {
        skipped += 1;
      }
    } catch (err) {
      console.warn('[reindex.services] error', s.id, (err as Error).message);
      errors += 1;
    }
  }

  const pruned = await pruneOrphans(businessId, 'service', active);
  return { source: 'service', upserted, pruned, skipped, errors, durationMs: Date.now() - t0 };
}

export async function reindexSnippets(businessId: string): Promise<ReindexStats> {
  const t0 = Date.now();
  const snap = await adminDb
    .collection('snippets')
    .where('businessId', '==', businessId)
    .get();

  let upserted = 0;
  let skipped = 0;
  let errors = 0;
  const active = new Set<string>();

  for (const doc of snap.docs) {
    const s = { ...(doc.data() as Snippet), id: doc.id };
    active.add(s.id);
    const text = buildSnippetText(s);
    if (!text) continue;
    try {
      const before = Date.now();
      const chunk = await upsertChunk({
        businessId,
        source: 'snippet',
        sourceId: s.id,
        text,
        metadata: { shortcode: s.shortcode, category: s.category },
      });
      if (Date.now() - new Date(chunk.updatedAt).getTime() < 1500 && chunk.updatedAt >= new Date(before).toISOString()) {
        upserted += 1;
      } else {
        skipped += 1;
      }
    } catch (err) {
      console.warn('[reindex.snippets] error', s.id, (err as Error).message);
      errors += 1;
    }
  }

  const pruned = await pruneOrphans(businessId, 'snippet', active);
  return { source: 'snippet', upserted, pruned, skipped, errors, durationMs: Date.now() - t0 };
}

export async function reindexBusinessDesc(businessId: string): Promise<ReindexStats> {
  const t0 = Date.now();
  const snap = await adminDb.collection('businesses').doc(businessId).get();
  if (!snap.exists) return { source: 'business_desc', upserted: 0, pruned: 0, skipped: 0, errors: 0, durationMs: Date.now() - t0 };

  const biz = snap.data() as Business;
  const desc = biz.settings?.aiAgent?.businessDescription?.trim();

  if (!desc) {
    // Remove existing chunk if the description was cleared
    const pruned = await pruneOrphans(businessId, 'business_desc', new Set());
    return { source: 'business_desc', upserted: 0, pruned, skipped: 0, errors: 0, durationMs: Date.now() - t0 };
  }

  try {
    await upsertChunk({
      businessId,
      source: 'business_desc',
      sourceId: 'main',
      text: desc,
      metadata: { name: biz.nomeFantasia || biz.razaoSocial },
    });
    return { source: 'business_desc', upserted: 1, pruned: 0, skipped: 0, errors: 0, durationMs: Date.now() - t0 };
  } catch {
    return { source: 'business_desc', upserted: 0, pruned: 0, skipped: 0, errors: 1, durationMs: Date.now() - t0 };
  }
}

export async function reindexPolicies(businessId: string): Promise<ReindexStats> {
  const t0 = Date.now();
  const snap = await adminDb.collection('businesses').doc(businessId).get();
  if (!snap.exists) return { source: 'policy', upserted: 0, pruned: 0, skipped: 0, errors: 0, durationMs: Date.now() - t0 };

  const biz = snap.data() as Business;
  const policies = biz.settings?.aiAgent?.policies;

  // Build a single chunk per policy kind so the agent can filter by sourceId
  const entries: Array<{ sourceId: string; label: string; text: string | undefined }> = [
    { sourceId: 'cancellation', label: 'Política de cancelamento', text: policies?.cancellation?.trim() },
    { sourceId: 'refund',       label: 'Política de reembolso/estorno', text: policies?.refund?.trim() },
    { sourceId: 'privacy',      label: 'Política de privacidade (LGPD)', text: policies?.privacy?.trim() },
  ];

  const activeIds = new Set<string>();
  let upserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const entry of entries) {
    if (!entry.text) continue;
    activeIds.add(entry.sourceId);
    try {
      const before = Date.now();
      const chunk = await upsertChunk({
        businessId,
        source: 'policy',
        sourceId: entry.sourceId,
        text: `${entry.label}: ${entry.text}`,
        metadata: { kind: entry.sourceId },
      });
      if (Date.now() - new Date(chunk.updatedAt).getTime() < 1500 && chunk.updatedAt >= new Date(before).toISOString()) {
        upserted += 1;
      } else {
        skipped += 1;
      }
    } catch (err) {
      console.warn('[reindex.policies] error', entry.sourceId, (err as Error).message);
      errors += 1;
    }
  }

  const pruned = await pruneOrphans(businessId, 'policy', activeIds);
  return { source: 'policy', upserted, pruned, skipped, errors, durationMs: Date.now() - t0 };
}

// ─── Text builders ───────────────────────────────────────────────────────────

function buildProductText(p: Product): string {
  const parts: string[] = [p.name];
  if (p.menuDescription) parts.push(p.menuDescription);
  else if (p.description) parts.push(p.description);
  if (p.menuCategory || p.category) parts.push(`Categoria: ${p.menuCategory || p.category}`);
  if (p.dietary && p.dietary.length) parts.push(`Características: ${p.dietary.join(', ')}`);
  if (p.salePrice) parts.push(`Preço: R$ ${p.salePrice.toFixed(2)}`);
  if (p.preparationTime) parts.push(`Tempo de preparo: ${p.preparationTime}min`);
  return parts.join(' — ').trim();
}

function buildServiceText(s: Service): string {
  const parts: string[] = [s.name];
  if (s.description) parts.push(s.description);
  if (s.category) parts.push(`Categoria: ${s.category}`);
  if (s.price) parts.push(`Preço: R$ ${s.price.toFixed(2)}`);
  if (s.duration) parts.push(`Duração: ${s.duration}min`);
  return parts.join(' — ').trim();
}

function buildSnippetText(s: Snippet): string {
  const parts: string[] = [];
  if (s.shortcode) parts.push(`/${s.shortcode}`);
  parts.push(s.content);
  if (s.category) parts.push(`(categoria ${s.category})`);
  return parts.join(' — ').trim();
}
