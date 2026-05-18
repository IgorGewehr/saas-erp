/**
 * Backfill: Conversation.firstInboundFromContactAt.
 *
 * Razão: o campo foi adicionado nos webhooks (meta/baileys/facebook) pra
 * habilitar o filtro "Cliente não respondeu" em Conversas. Sem backfill,
 * conversas pré-deploy onde o contato JÁ respondeu aparecem como "sem
 * resposta" — falso positivo que zera a utilidade do filtro.
 *
 * Estratégia: pra cada conversa sem o campo, busca a mensagem inbound mais
 * antiga em conversationMessages (orderBy sentAt asc, limit 1, where
 * direction='inbound'). Se existe, seta firstInboundFromContactAt = sentAt.
 * Se nao existe inbound nenhum, seta nada (o estado "vazio" eh exatamente
 * o que o filtro quer capturar).
 *
 * Idempotente — skipa convs que ja tem o campo.
 *
 * Como rodar:
 *   npx tsx scripts/backfill-conversation-first-inbound.ts
 *   npx tsx scripts/backfill-conversation-first-inbound.ts --dry-run
 *   npx tsx scripts/backfill-conversation-first-inbound.ts --business=<id>
 */

import { adminDb } from '@/lib/config/firebaseAdmin';

const BATCH_SIZE = 400;

interface Stats {
  conversationsScanned: number;
  conversationsAlreadyHaveField: number;
  conversationsBackfilled: number;
  conversationsNoInboundFound: number;
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

async function findEarliestInboundAt(conversationId: string): Promise<string | null> {
  // Usa o indice existente (conversationId + sentAt asc) e filtra direction
  // em memoria. Adicionar um indice (conversationId + direction + sentAt) so
  // pro backfill seria overkill — conversas tipicas tem dezenas de msgs,
  // o trade-off de trazer alguns extras vs criar/deletar indice e mais limpo.
  // Pagina pra conversas absurdamente grandes nao estourarem memoria.
  const PAGE = 200;
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
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
      // Sem indice / mensagem sem sentAt — fallback pra createdAt.
      try {
        let q2 = adminDb.collection('conversationMessages')
          .where('conversationId', '==', conversationId)
          .orderBy('createdAt', 'asc')
          .limit(PAGE);
        if (lastDoc) q2 = q2.startAfter(lastDoc);
        snap = await q2.get();
      } catch {
        return null;
      }
    }

    if (snap.empty) return null;
    for (const doc of snap.docs) {
      if (doc.data().direction === 'inbound') {
        return (doc.data().sentAt ?? doc.data().createdAt) as string;
      }
    }
    if (snap.size < PAGE) return null;
    lastDoc = snap.docs[snap.docs.length - 1];
  }
}

async function main() {
  const opts = parseArgs();
  console.log('[backfill-first-inbound] options:', opts);

  const stats: Stats = {
    conversationsScanned: 0,
    conversationsAlreadyHaveField: 0,
    conversationsBackfilled: 0,
    conversationsNoInboundFound: 0,
  };

  let convQuery: FirebaseFirestore.Query = adminDb.collection('conversations');
  if (opts.businessFilter) {
    convQuery = convQuery.where('businessId', '==', opts.businessFilter);
  }

  const convSnap = await convQuery.get();
  console.log(`[backfill-first-inbound] varrendo ${convSnap.size} conversas...`);

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

    if (conv.firstInboundFromContactAt) {
      stats.conversationsAlreadyHaveField++;
      continue;
    }

    const earliestInboundAt = await findEarliestInboundAt(doc.id);
    if (!earliestInboundAt) {
      // Conv sem nenhum inbound — estado correto pro filtro. Nao escreve.
      stats.conversationsNoInboundFound++;
      continue;
    }

    batch.update(doc.ref, {
      firstInboundFromContactAt: earliestInboundAt,
      updatedAt: new Date().toISOString(),
    });
    batchCount++;
    stats.conversationsBackfilled++;

    if (batchCount >= BATCH_SIZE) await flushBatch();
  }
  await flushBatch();

  console.log('\n=== RESUMO ===');
  console.log(`Modo: ${opts.dryRun ? 'DRY-RUN (nada escrito)' : 'WRITE'}`);
  if (opts.businessFilter) console.log(`Business filter: ${opts.businessFilter}`);
  console.log(`Total varridas:           ${stats.conversationsScanned}`);
  console.log(`Ja tinham o campo:        ${stats.conversationsAlreadyHaveField}`);
  console.log(`Atualizadas (com inbound):${stats.conversationsBackfilled}`);
  console.log(`Sem nenhum inbound:       ${stats.conversationsNoInboundFound}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill-first-inbound] fatal:', err);
    process.exit(1);
  });
