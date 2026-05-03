/**
 * Backfill: Conversation.channelOwnerType + channelOwnerId.
 *
 * Razão: o isolamento server-side de canais Baileys pessoais (ownerType='user')
 * depende desses campos denormalizados na conversa. Conversas criadas antes do
 * fix não têm os campos populados — Firestore rules e queries do frontend não
 * conseguem decidir quem tem acesso. Resultado prático antes do backfill:
 *   - Frontend non-admin: conversas legadas ficam invisíveis (a query `or()`
 *     em ConversasModule não casa com nenhum branch quando o campo é nulo).
 *   - Rules: caem no fallback que faz get() no channelConnections — funciona,
 *     mas com custo extra de read por avaliação. O backfill remove esse custo.
 *
 * Idempotente — pode rodar múltiplas vezes (skipa docs que já têm ownerType).
 *
 * Como rodar:
 *   npx tsx scripts/backfill-conversation-ownership.ts
 *   npx tsx scripts/backfill-conversation-ownership.ts --dry-run
 *   npx tsx scripts/backfill-conversation-ownership.ts --business=<id>
 *
 * Lógica de inferência:
 *   1. Se conv.channelOwnerType já existe → ok, skip.
 *   2. Senão lê conv.channelConnectionId → channelConnections/{id}:
 *        ownerType='user'     → channelOwnerType='user', channelOwnerId=conn.ownerId
 *        ownerType='business' → channelOwnerType='business' (sem ownerId)
 *   3. Sem channelConnectionId → default 'business' (regra do produto: canais
 *      'user' só existem em Baileys e SEMPRE com connectionId. Cloud/FB/IG são
 *      sempre 'business'). Conversa legada sem connectionId é necessariamente
 *      Cloud/FB/IG → 'business'.
 *
 * Output: resumo com total varrido, atualizado, já populado e inconclusivo.
 */

import { adminDb } from '@/lib/config/firebaseAdmin';
import type { Conversation, ChannelConnection } from '@/lib/types';

const BATCH_SIZE = 400;

interface Stats {
  scanned: number;
  alreadyHave: number;
  backfilledBusiness: number;
  backfilledUser: number;
  inconclusive: number;
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

async function main() {
  const opts = parseArgs();
  console.log('[backfill-ownership] options:', opts);

  const stats: Stats = {
    scanned: 0,
    alreadyHave: 0,
    backfilledBusiness: 0,
    backfilledUser: 0,
    inconclusive: 0,
  };

  // Carrega channelConnections em memória (read único, lookup local).
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
  console.log(`[backfill-ownership] loaded ${connSnap.size} channelConnections em ${connectionsByBiz.size} businesses`);

  // Varre conversations
  let convQuery = adminDb.collection('conversations');
  if (opts.businessFilter) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    convQuery = convQuery.where('businessId', '==', opts.businessFilter) as any;
  }

  let batch = adminDb.batch();
  let batchCount = 0;

  const flushBatch = async () => {
    if (batchCount === 0) return;
    if (!opts.dryRun) await batch.commit();
    batch = adminDb.batch();
    batchCount = 0;
  };

  // Streaming pra não carregar tudo em memória.
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let pageQuery = convQuery.orderBy('__name__').limit(1000);
    if (lastDoc) pageQuery = pageQuery.startAfter(lastDoc);
    const pageSnap = await pageQuery.get();
    if (pageSnap.empty) break;

    for (const doc of pageSnap.docs) {
      stats.scanned++;
      const conv = doc.data() as Conversation;

      if (conv.channelOwnerType) {
        stats.alreadyHave++;
        continue;
      }

      let inferredOwnerType: 'business' | 'user' = 'business';
      let inferredOwnerId: string | undefined;

      if (conv.channelConnectionId) {
        const conn = connectionsByBiz.get(conv.businessId)?.get(conv.channelConnectionId);
        if (conn) {
          if (conn.ownerType === 'user' && conn.ownerId) {
            inferredOwnerType = 'user';
            inferredOwnerId = conn.ownerId;
          } else {
            inferredOwnerType = 'business';
          }
        } else {
          // Connection referenciada não existe mais (deletada). Conservador: assume
          // business e loga pra revisão manual — perda de privacidade < perda de acesso.
          stats.inconclusive++;
          console.warn(`[backfill-ownership] conn ${conv.channelConnectionId.slice(-8)} não encontrada (conv ${doc.id.slice(-6)} biz ${conv.businessId.slice(-8)}) — defaulting business.`);
          inferredOwnerType = 'business';
        }
      }
      // Sem channelConnectionId → 'business' por regra do produto (FB/IG/Cloud).

      const update: Record<string, unknown> = {
        channelOwnerType: inferredOwnerType,
        updatedAt: new Date().toISOString(),
      };
      if (inferredOwnerId) update.channelOwnerId = inferredOwnerId;

      batch.update(doc.ref, update);
      batchCount++;
      if (inferredOwnerType === 'user') stats.backfilledUser++;
      else stats.backfilledBusiness++;

      if (batchCount >= BATCH_SIZE) await flushBatch();
    }

    if (pageSnap.size < 1000) break;
    lastDoc = pageSnap.docs[pageSnap.docs.length - 1];
  }
  await flushBatch();

  // Resumo
  console.log('\n=== RESUMO ===');
  console.log(`Modo: ${opts.dryRun ? 'DRY-RUN (nada escrito)' : 'WRITE'}`);
  if (opts.businessFilter) console.log(`Business filter: ${opts.businessFilter}`);
  console.log(`Conversas varridas:               ${stats.scanned}`);
  console.log(`Já tinham channelOwnerType:       ${stats.alreadyHave}`);
  console.log(`Backfilled como 'business':       ${stats.backfilledBusiness}`);
  console.log(`Backfilled como 'user':           ${stats.backfilledUser}`);
  console.log(`Inconclusivas (conn deletada):    ${stats.inconclusive}`);

  if (stats.inconclusive > 0) {
    console.log('\n⚠ Conversas com channelConnectionId apontando pra connection deletada foram defaulted pra business.');
    console.log('  Se essas conversas vieram de canal pessoal, agora ficam visíveis pra o business todo. Revise se necessário.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill-ownership] fatal:', err);
    process.exit(1);
  });
