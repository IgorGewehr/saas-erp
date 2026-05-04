/**
 * Backfill: ConversationMessage.connectedVia + Conversation.connectedVia.
 *
 * Razão: até a Fase 1 do refactor de UI (Cloud × Baileys), nem todas as
 * conversas/mensagens tinham o campo `connectedVia` populado. Mensagens
 * herdam da conversa, e conversas legadas eram inferidas em runtime via
 * fallback no send/route.ts. Esse script materializa o transporte pra
 * todas as conversas e mensagens que ainda estão sem, de forma idempotente.
 *
 * Idempotente — pode rodar múltiplas vezes sem corromper dados (skipa
 * docs que já têm connectedVia).
 *
 * Como rodar:
 *   npx tsx scripts/backfill-message-connected-via.ts
 *   npx tsx scripts/backfill-message-connected-via.ts --dry-run    # só conta, não escreve
 *   npx tsx scripts/backfill-message-connected-via.ts --business=<id>  # só um tenant
 *
 * Lógica de inferência da conversa:
 *   1. Se conv.connectedVia já existe → ok, herda pras mensagens.
 *   2. Senão, lê conv.channelConnectionId → channelConnections/{id}.type:
 *        'whatsapp_baileys' → 'baileys'
 *        'whatsapp_cloud'   → 'embedded_signup'
 *   3. Senão (legado puro), olha business.channels.whatsapp.connectedVia.
 *   4. Se ainda inconclusivo → marca como inferred=null (skip), reporta total.
 *
 * Output:
 *   Resumo com (a) conversas atualizadas, (b) mensagens atualizadas,
 *   (c) conversas que ficaram sem inferência, (d) mensagens órfãs.
 */

import { adminDb } from '@/lib/config/firebaseAdmin';
import type { Conversation, ChannelConnection } from '@/lib/types';

const BATCH_SIZE = 400; // limite seguro abaixo dos 500 ops/batch do Firestore

interface Stats {
  conversationsScanned: number;
  conversationsAlreadyHaveVia: number;
  conversationsBackfilled: number;
  conversationsInconclusive: number;
  messagesScanned: number;
  messagesAlreadyHaveVia: number;
  messagesBackfilled: number;
  messagesInconclusive: number;
}

interface CliOpts {
  dryRun: boolean;
  businessFilter: string | null;
}

function parseArgs(): CliOpts {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const bizArg = args.find((a) => a.startsWith('--business='));
  const businessFilter = bizArg ? bizArg.split('=')[1] : null;
  return { dryRun, businessFilter };
}

function inferFromConnectionType(type: string | undefined): 'baileys' | 'embedded_signup' | null {
  if (type === 'whatsapp_baileys') return 'baileys';
  if (type === 'whatsapp_cloud') return 'embedded_signup';
  return null;
}

async function main() {
  const opts = parseArgs();
  console.log('[backfill] options:', opts);

  const stats: Stats = {
    conversationsScanned: 0,
    conversationsAlreadyHaveVia: 0,
    conversationsBackfilled: 0,
    conversationsInconclusive: 0,
    messagesScanned: 0,
    messagesAlreadyHaveVia: 0,
    messagesBackfilled: 0,
    messagesInconclusive: 0,
  };

  // Carrega channelConnections em memória — leitura única, lookup local.
  const connectionsByBiz = new Map<string, Map<string, ChannelConnection>>();
  let connQuery = adminDb.collection('channelConnections');
  if (opts.businessFilter) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connQuery = connQuery.where('businessId', '==', opts.businessFilter) as any;
  }
  const connSnap = await connQuery.get();
  for (const d of connSnap.docs) {
    const data = d.data() as ChannelConnection;
    if (!connectionsByBiz.has(data.businessId)) connectionsByBiz.set(data.businessId, new Map());
    connectionsByBiz.get(data.businessId)!.set(d.id, { ...data, id: d.id });
  }
  console.log(`[backfill] loaded ${connSnap.size} channelConnections em ${connectionsByBiz.size} businesses`);

  // Cache business.channels.whatsapp.connectedVia (legado) pra fallback final.
  const legacyViaByBiz = new Map<string, 'baileys' | 'embedded_signup' | null>();
  // Mapa final conversaId → connectedVia inferido (pra propagar nas mensagens depois).
  const conversationViaResolved = new Map<string, 'baileys' | 'embedded_signup'>();

  // ── Pass 1: conversations ──────────────────────────────────────────────────
  let convQuery = adminDb.collection('conversations').where('channel', '==', 'whatsapp');
  if (opts.businessFilter) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    convQuery = convQuery.where('businessId', '==', opts.businessFilter) as any;
  }

  const convSnap = await convQuery.get();
  console.log(`[backfill] varrendo ${convSnap.size} conversas WhatsApp...`);

  let batch = adminDb.batch();
  let batchCount = 0;

  const flushBatch = async () => {
    if (batchCount === 0) return;
    if (!opts.dryRun) await batch.commit();
    batch = adminDb.batch();
    batchCount = 0;
  };

  for (const doc of convSnap.docs) {
    stats.conversationsScanned++;
    const conv = doc.data() as Conversation;

    if (conv.connectedVia) {
      stats.conversationsAlreadyHaveVia++;
      conversationViaResolved.set(doc.id, conv.connectedVia);
      continue;
    }

    // 1. Tenta via channelConnections.type
    let inferred: 'baileys' | 'embedded_signup' | null = null;
    if (conv.channelConnectionId) {
      const conn = connectionsByBiz.get(conv.businessId)?.get(conv.channelConnectionId);
      inferred = inferFromConnectionType(conn?.type);
    }

    // 2. Fallback: lê business.channels.whatsapp.connectedVia (cacheado por business)
    if (!inferred) {
      let cached = legacyViaByBiz.get(conv.businessId);
      if (cached === undefined) {
        const bizSnap = await adminDb.collection('businesses').doc(conv.businessId).get();
        const legacy = bizSnap.data()?.channels?.whatsapp as { connectedVia?: string } | undefined;
        cached = legacy?.connectedVia === 'baileys' ? 'baileys'
          : legacy?.connectedVia === 'embedded_signup' ? 'embedded_signup'
          : null;
        legacyViaByBiz.set(conv.businessId, cached);
      }
      if (cached) inferred = cached;
    }

    if (!inferred) {
      stats.conversationsInconclusive++;
      console.warn(`[backfill] inconclusive: conv ${doc.id} (biz ${conv.businessId.slice(-8)}) — sem connectionId nem legado.`);
      continue;
    }

    conversationViaResolved.set(doc.id, inferred);
    batch.update(doc.ref, { connectedVia: inferred, updatedAt: new Date().toISOString() });
    batchCount++;
    stats.conversationsBackfilled++;

    if (batchCount >= BATCH_SIZE) await flushBatch();
  }
  await flushBatch();

  console.log(`[backfill] conversas: ${stats.conversationsBackfilled} atualizadas, ${stats.conversationsAlreadyHaveVia} já tinham, ${stats.conversationsInconclusive} sem inferência.`);

  // ── Pass 2: messages ────────────────────────────────────────────────────────
  let msgQuery = adminDb.collection('conversationMessages').where('channel', '==', 'whatsapp');
  if (opts.businessFilter) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    msgQuery = msgQuery.where('businessId', '==', opts.businessFilter) as any;
  }

  // Streaming pra evitar carregar tudo em memória — scans podem ser grandes.
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let pageQuery = msgQuery.orderBy('__name__').limit(1000);
    if (lastDoc) pageQuery = pageQuery.startAfter(lastDoc);
    const pageSnap = await pageQuery.get();
    if (pageSnap.empty) break;

    for (const doc of pageSnap.docs) {
      stats.messagesScanned++;
      const data = doc.data();

      if (data.connectedVia === 'baileys' || data.connectedVia === 'embedded_signup') {
        stats.messagesAlreadyHaveVia++;
        continue;
      }

      const inferredFromConv = conversationViaResolved.get(data.conversationId);
      if (!inferredFromConv) {
        stats.messagesInconclusive++;
        continue;
      }

      batch.update(doc.ref, { connectedVia: inferredFromConv });
      batchCount++;
      stats.messagesBackfilled++;

      if (batchCount >= BATCH_SIZE) await flushBatch();
    }

    if (pageSnap.size < 1000) break;
    lastDoc = pageSnap.docs[pageSnap.docs.length - 1];
  }
  await flushBatch();

  console.log(`[backfill] mensagens: ${stats.messagesBackfilled} atualizadas, ${stats.messagesAlreadyHaveVia} já tinham, ${stats.messagesInconclusive} sem inferência (conversa parent inconclusiva).`);

  // ── Resumo ─────────────────────────────────────────────────────────────────
  console.log('\n=== RESUMO ===');
  console.log(`Modo: ${opts.dryRun ? 'DRY-RUN (nada escrito)' : 'WRITE'}`);
  if (opts.businessFilter) console.log(`Business filter: ${opts.businessFilter}`);
  console.log('Conversas:');
  console.log(`  Total varridas:      ${stats.conversationsScanned}`);
  console.log(`  Já tinham via:       ${stats.conversationsAlreadyHaveVia}`);
  console.log(`  Atualizadas:         ${stats.conversationsBackfilled}`);
  console.log(`  Inconclusivas:       ${stats.conversationsInconclusive}`);
  console.log('Mensagens:');
  console.log(`  Total varridas:      ${stats.messagesScanned}`);
  console.log(`  Já tinham via:       ${stats.messagesAlreadyHaveVia}`);
  console.log(`  Atualizadas:         ${stats.messagesBackfilled}`);
  console.log(`  Inconclusivas:       ${stats.messagesInconclusive}`);

  if (stats.conversationsInconclusive > 0 || stats.messagesInconclusive > 0) {
    console.log('\n⚠ Itens inconclusivos: docs sem channelConnectionId E sem business.channels.whatsapp.connectedVia.');
    console.log('  Provavelmente são conversas muito antigas — podem ser inspecionadas manualmente ou ignoradas.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill] fatal:', err);
    process.exit(1);
  });
