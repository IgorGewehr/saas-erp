import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { cleanContactName } from '@/lib/utils/contactName';

/**
 * Admin-only migration: repara nomes de contato corrompidos com lixo nas
 * pontas (ex: "(- Daia Salão de Beleza") em conversations / crmContacts /
 * broadcastMessages do tenant chamador.
 *
 * Bug original: parser de RecipientListInput não removia parens nas pontas.
 * Quando o user colava lista de contatos com phone entre parênteses, o nome
 * no Firestore vinha com o "(" sobrando + traço de separador.
 *
 * Estratégia: itera cada coleção por businessId, aplica cleanContactName,
 * só grava se o resultado for diferente. Idempotente — pode rodar quantas
 * vezes precisar sem duplicar trabalho.
 *
 * Chamada típica:
 *   POST /api/admin/repair-contact-names
 *   Authorization: Bearer <idToken>
 *   Body: {} (opcional dryRun: true)
 *
 * Retorna { conversations: { scanned, fixed }, crmContacts: ..., broadcastMessages: ... }.
 */

const ADMIN_ROLES = new Set(['admin', 'founder']);

interface RepairResult {
  scanned: number;
  fixed: number;
  examples: Array<{ id: string; before: string; after: string }>;
}

const MAX_EXAMPLES = 10;

/** Itera uma coleção por businessId, aplica fix em fields[]. Cada `field`
 *  é um path (ex: 'contactName'). Doc só é updateado se algum field mudar.
 *  Retorna {scanned, fixed, examples}. */
async function repairCollection({
  collectionName,
  businessId,
  fields,
  dryRun,
}: {
  collectionName: string;
  businessId: string;
  fields: string[];
  dryRun: boolean;
}): Promise<RepairResult> {
  const result: RepairResult = { scanned: 0, fixed: 0, examples: [] };
  const snap = await adminDb
    .collection(collectionName)
    .where('businessId', '==', businessId)
    .get();

  // Quebra em batches de 400 (limite Firestore = 500 ops, margem de segurança).
  const BATCH_LIMIT = 400;
  let batch = adminDb.batch();
  let batchOps = 0;

  for (const doc of snap.docs) {
    result.scanned++;
    const data = doc.data();
    const updates: Record<string, string> = {};
    for (const field of fields) {
      const current = data[field];
      if (typeof current !== 'string' || !current) continue;
      const cleaned = cleanContactName(current);
      // Se cleanContactName retorna undefined (nome inteiramente lixo),
      // evita gravar — preserva o original e deixa pro user resolver
      // manualmente. Casos de undefined aqui são extremamente raros.
      if (cleaned && cleaned !== current) {
        updates[field] = cleaned;
        if (result.examples.length < MAX_EXAMPLES) {
          result.examples.push({ id: doc.id, before: current, after: cleaned });
        }
      }
    }
    if (Object.keys(updates).length === 0) continue;
    result.fixed++;
    if (dryRun) continue;
    batch.update(doc.ref, updates);
    batchOps++;
    if (batchOps >= BATCH_LIMIT) {
      await batch.commit();
      batch = adminDb.batch();
      batchOps = 0;
    }
  }

  if (!dryRun && batchOps > 0) await batch.commit();
  return result;
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (isAuthError(auth)) return auth;

  if (!ADMIN_ROLES.has(auth.role)) {
    return NextResponse.json(
      { error: 'Forbidden — apenas admin/founder podem rodar migrations' },
      { status: 403 },
    );
  }

  let dryRun = false;
  try {
    const body = await req.json().catch(() => ({}));
    dryRun = body.dryRun === true;
  } catch { /* body opcional */ }

  try {
    // 3 coleções afetadas. crmContacts NA — coleção 'clients' que armazena
    // contatos do CRM (campo `name`).
    const [conversations, clients, broadcastMessages] = await Promise.all([
      repairCollection({
        collectionName: 'conversations',
        businessId: auth.businessId,
        fields: ['contactName', 'customContactName'],
        dryRun,
      }),
      repairCollection({
        collectionName: 'clients',
        businessId: auth.businessId,
        fields: ['name'],
        dryRun,
      }),
      repairCollection({
        collectionName: 'broadcastMessages',
        businessId: auth.businessId,
        fields: ['contactName'],
        dryRun,
      }),
    ]);

    return NextResponse.json({
      ok: true,
      dryRun,
      businessId: auth.businessId,
      conversations,
      clients,
      broadcastMessages,
    });
  } catch (err) {
    console.error('[repair-contact-names] error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
