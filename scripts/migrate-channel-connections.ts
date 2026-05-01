/**
 * Migração: businesses.channels.* → channelConnections + backfill de
 * Conversation.channelConnectionId.
 *
 * Idempotente — pode rodar múltiplas vezes sem corromper dados.
 *
 * Como rodar:
 *   npx tsx scripts/migrate-channel-connections.ts
 *
 * Pré-requisitos:
 *   - Variáveis de ambiente do firebase-admin no .env.local (ou GOOGLE_APPLICATION_CREDENTIALS)
 *   - Conexão de rede com Firestore
 *
 * Output:
 *   - Para cada business: cria 0+ channelConnections (uma por canal configurado)
 *   - Para cada conversation sem channelConnectionId: vincula à connection
 *     que match o canal/connectedVia
 *   - Imprime resumo (N businesses, N connections criadas, N conversations
 *     atualizadas)
 *
 * Não toca:
 *   - businesses.channels.* — preserva como espelho leitura-only durante a
 *     transição. Removível em uma migração futura, depois que UI tiver
 *     migrado pra ler exclusivamente de channelConnections.
 */

import { adminDb } from '@/lib/config/firebaseAdmin';
import { ensureBusinessConnectionsFromLegacy } from '@/lib/services/channels/channelConnections';
import type { Conversation, ChannelConnection } from '@/lib/types';

interface Stats {
  businesses: number;
  connectionsCreated: number;
  connectionsAlreadyExisted: number;
  conversationsBackfilled: number;
  conversationsSkipped: number;
}

async function main() {
  const stats: Stats = {
    businesses: 0,
    connectionsCreated: 0,
    connectionsAlreadyExisted: 0,
    conversationsBackfilled: 0,
    conversationsSkipped: 0,
  };

  console.log('[migrate] Iniciando migração de channelConnections...');

  // 1. Itera todos os businesses
  const bizSnap = await adminDb.collection('businesses').get();
  console.log(`[migrate] ${bizSnap.size} businesses encontrados`);

  for (const bizDoc of bizSnap.docs) {
    stats.businesses++;
    const businessId = bizDoc.id;
    try {
      const results = await ensureBusinessConnectionsFromLegacy(businessId);
      const newOnes = results.filter(r => r.wasCreated);
      stats.connectionsCreated += newOnes.length;
      stats.connectionsAlreadyExisted += results.length - newOnes.length;
      if (newOnes.length > 0) {
        console.log(`[migrate]   ${businessId}: ${newOnes.length} new, ${results.length - newOnes.length} já existentes`);
      }
    } catch (err) {
      console.error(`[migrate] ❌ ${businessId}:`, err);
    }
  }

  // 2. Backfill de conversations sem channelConnectionId
  console.log('[migrate] Backfill de conversations...');
  // Mapa businessId → { 'whatsapp_cloud': connId, 'whatsapp_baileys': connId, ...}
  const connByBiz = new Map<string, Map<string, string>>();

  const allConnsSnap = await adminDb.collection('channelConnections')
    .where('isPrimary', '==', true)
    .where('isActive', '==', true)
    .get();
  for (const d of allConnsSnap.docs) {
    const c = { ...(d.data() as ChannelConnection), id: d.id };
    if (!connByBiz.has(c.businessId)) connByBiz.set(c.businessId, new Map());
    connByBiz.get(c.businessId)!.set(c.type, c.id);
  }

  const convSnap = await adminDb.collection('conversations').get();
  console.log(`[migrate] ${convSnap.size} conversations totais`);
  let processed = 0;
  for (const d of convSnap.docs) {
    processed++;
    if (processed % 500 === 0) console.log(`[migrate]   ${processed}/${convSnap.size}...`);
    const conv = d.data() as Conversation;
    if (conv.channelConnectionId) {
      stats.conversationsSkipped++;
      continue;
    }
    const bizConns = connByBiz.get(conv.businessId);
    if (!bizConns) {
      stats.conversationsSkipped++;
      continue;
    }
    let typeKey: string | null = null;
    if (conv.channel === 'whatsapp') {
      typeKey = conv.connectedVia === 'baileys' ? 'whatsapp_baileys' : 'whatsapp_cloud';
    } else if (conv.channel === 'facebook') {
      typeKey = 'facebook';
    } else if (conv.channel === 'instagram') {
      typeKey = 'instagram';
    }
    if (!typeKey) {
      stats.conversationsSkipped++;
      continue;
    }
    const connId = bizConns.get(typeKey);
    if (!connId) {
      stats.conversationsSkipped++;
      continue;
    }
    try {
      await d.ref.update({ channelConnectionId: connId });
      stats.conversationsBackfilled++;
    } catch (err) {
      console.error(`[migrate] Failed to update conversation ${d.id}:`, err);
      stats.conversationsSkipped++;
    }
  }

  console.log('[migrate] ✅ Concluído.');
  console.log('[migrate] Resumo:', stats);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[migrate] Erro fatal:', err);
    process.exit(1);
  });
