/**
 * Backfill: Conversation.firstInboundLikelyBot.
 *
 * Razao: o flag e setado nos webhooks na PRIMEIRA inbound do contato — convs
 * pre-deploy ficam todas com false mesmo se o contato respondeu com
 * auto-reply. Sem backfill, o filtro "Cliente respondeu com bot" so funciona
 * pra trafego novo.
 *
 * Pra cada conv que ja tem firstInboundFromContactAt setado, busca:
 *   - A mensagem inbound que casa com esse timestamp (a "primeira inbound")
 *   - A mensagem outbound imediatamente anterior, se existir
 * Roda detectLikelyBotReply(content, msgTs, prevOutboundTs). Se positivo,
 * seta firstInboundLikelyBot=true. Se negativo, NAO escreve (ausente vale
 * como false na avaliacao do filtro).
 *
 * Idempotente — skipa convs sem firstInboundFromContactAt (precisa rodar
 * backfill-conversation-first-inbound.ts antes pra populacao plena).
 *
 * Como rodar:
 *   npx tsx scripts/backfill-conversation-likely-bot.ts --dry-run
 *   npx tsx scripts/backfill-conversation-likely-bot.ts
 *   npx tsx scripts/backfill-conversation-likely-bot.ts --business=<id>
 */

import { adminDb } from '@/lib/config/firebaseAdmin';
import { detectLikelyBotReply } from '@/lib/utils/botDetection';

const BATCH_SIZE = 400;

interface Stats {
  conversationsScanned: number;
  conversationsSkippedNoFirstInbound: number;
  conversationsAlreadyFlagged: number;
  conversationsFlaggedNow: number;
  conversationsNotBot: number;
  conversationsMissingMsg: number;
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

/** Acha a primeira inbound + o outbound imediatamente anterior a ela. */
async function findFirstInboundAndPrevOutbound(conversationId: string): Promise<{
  inbound: { content: string; ts: number } | null;
  prevOutboundTs: number | null;
}> {
  const PAGE = 200;
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let lastOutboundTs: number | null = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = adminDb.collection('conversationMessages')
      .where('conversationId', '==', conversationId)
      .orderBy('sentAt', 'asc')
      .limit(PAGE);
    if (lastDoc) q = q.startAfter(lastDoc);

    let snap: FirebaseFirestore.QuerySnapshot;
    try {
      snap = await q.get();
    } catch {
      try {
        let q2 = adminDb.collection('conversationMessages')
          .where('conversationId', '==', conversationId)
          .orderBy('createdAt', 'asc')
          .limit(PAGE);
        if (lastDoc) q2 = q2.startAfter(lastDoc);
        snap = await q2.get();
      } catch {
        return { inbound: null, prevOutboundTs: null };
      }
    }

    if (snap.empty) return { inbound: null, prevOutboundTs: lastOutboundTs };

    for (const doc of snap.docs) {
      const d = doc.data();
      const tsIso = (d.sentAt ?? d.createdAt) as string | undefined;
      if (!tsIso) continue;
      const ts = new Date(tsIso).getTime();
      if (Number.isNaN(ts)) continue;
      if (d.direction === 'inbound') {
        return {
          inbound: { content: (d.content as string) ?? '', ts },
          prevOutboundTs: lastOutboundTs,
        };
      }
      if (d.direction === 'outbound') {
        lastOutboundTs = ts;
      }
    }
    if (snap.size < PAGE) return { inbound: null, prevOutboundTs: lastOutboundTs };
    lastDoc = snap.docs[snap.docs.length - 1];
  }
}

async function main() {
  const opts = parseArgs();
  console.log('[backfill-likely-bot] options:', opts);

  const stats: Stats = {
    conversationsScanned: 0,
    conversationsSkippedNoFirstInbound: 0,
    conversationsAlreadyFlagged: 0,
    conversationsFlaggedNow: 0,
    conversationsNotBot: 0,
    conversationsMissingMsg: 0,
  };

  let convQuery: FirebaseFirestore.Query = adminDb.collection('conversations');
  if (opts.businessFilter) {
    convQuery = convQuery.where('businessId', '==', opts.businessFilter);
  }

  const convSnap = await convQuery.get();
  console.log(`[backfill-likely-bot] varrendo ${convSnap.size} conversas...`);

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
    const conv = doc.data();

    if (!conv.firstInboundFromContactAt) {
      stats.conversationsSkippedNoFirstInbound++;
      continue;
    }
    if (conv.firstInboundLikelyBot === true) {
      stats.conversationsAlreadyFlagged++;
      continue;
    }

    const { inbound, prevOutboundTs } = await findFirstInboundAndPrevOutbound(doc.id);
    if (!inbound) {
      // Conv tem firstInboundFromContactAt mas a msg nao foi achada — pode
      // ser corrupcao ou inbound apagado. Sem dados, nao classifica.
      stats.conversationsMissingMsg++;
      continue;
    }

    const isBot = detectLikelyBotReply({
      content: inbound.content,
      msgTimestampMs: inbound.ts,
      prevOutboundAtMs: prevOutboundTs,
    });

    if (!isBot) {
      stats.conversationsNotBot++;
      continue;
    }

    batch.update(doc.ref, {
      firstInboundLikelyBot: true,
      updatedAt: new Date().toISOString(),
    });
    batchCount++;
    stats.conversationsFlaggedNow++;

    if (batchCount >= BATCH_SIZE) await flushBatch();
  }
  await flushBatch();

  console.log('\n=== RESUMO ===');
  console.log(`Modo: ${opts.dryRun ? 'DRY-RUN (nada escrito)' : 'WRITE'}`);
  if (opts.businessFilter) console.log(`Business filter: ${opts.businessFilter}`);
  console.log(`Total varridas:                ${stats.conversationsScanned}`);
  console.log(`Sem firstInboundFromContactAt: ${stats.conversationsSkippedNoFirstInbound}`);
  console.log(`Ja tinham o flag:              ${stats.conversationsAlreadyFlagged}`);
  console.log(`Flagadas agora (bot):          ${stats.conversationsFlaggedNow}`);
  console.log(`Avaliadas e nao-bot:           ${stats.conversationsNotBot}`);
  console.log(`Sem msg encontrada:            ${stats.conversationsMissingMsg}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill-likely-bot] fatal:', err);
    process.exit(1);
  });
