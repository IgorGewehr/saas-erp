/**
 * Backfill: popular `unreadCounters/{businessId}` a partir das conversas ATIVAS.
 *
 * Razao (ver docs/audit/PLANO_LOTE_B_custo_firebase.md §2.5): os badges de
 * nao-lidas (TopBar/Sidebar) vao deixar de assinar a colecao `conversations`
 * inteira e passar a ler 1 doc denormalizado por tenant em `unreadCounters`.
 * As escritas correntes (incremento inbound + decremento markAsRead) ja mantem
 * esse doc dali pra frente (lib/services/unreadCounter.ts). Este script popula
 * os VALORES HISTORICOS uma vez, varrendo as conversas existentes.
 *
 * Escopo (espelha lib/services/unreadCounter.ts → scopeField):
 *   - channelOwnerType === 'user' COM channelOwnerId → byUser[channelOwnerId] + total
 *   - channelOwnerType === 'user' SEM channelOwnerId  → ignorada (nao da pra atribuir)
 *   - qualquer outro caso (inclui legado sem channelOwnerType) → business + total
 *
 * "Ativa" = sem `deletedAt` e sem `mergedInto` (espelha
 * lib/utils/recordFilters.ts → isActiveRecord). Conversas soft-deleted/merged
 * nao contam pro badge, entao tambem nao entram no contador.
 *
 * Idempotente: usa `set` (sobrescreve o doc inteiro por tenant). Reexecutavel a
 * qualquer momento — o resultado e funcao apenas do estado atual das conversas.
 *
 * Credenciais: usa lib/config/firebaseAdmin (mesma config dos demais backfills).
 * Garanta GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_* no ambiente (.env.local).
 *
 * Como rodar:
 *   npx tsx --env-file=.env.local scripts/backfill-unread-counters.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/backfill-unread-counters.ts
 *   npx tsx --env-file=.env.local scripts/backfill-unread-counters.ts --business=<id>
 */

import { adminDb } from '@/lib/config/firebaseAdmin';

interface CliOpts {
  dryRun: boolean;
  businessFilter: string | null;
}

interface TenantAcc {
  business: number;
  byUser: Record<string, number>;
  total: number;
}

function parseArgs(): CliOpts {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const bizArg = args.find((a) => a.startsWith('--business='));
  const businessFilter = bizArg ? bizArg.split('=')[1] : null;
  return { dryRun, businessFilter };
}

/** Espelha isActiveRecord (lib/utils/recordFilters.ts) — sem importar UI utils. */
function isActive(data: FirebaseFirestore.DocumentData): boolean {
  if (typeof data.deletedAt === 'string' && data.deletedAt.length > 0) return false;
  if (typeof data.mergedInto === 'string' && data.mergedInto.length > 0) return false;
  return true;
}

async function main() {
  const opts = parseArgs();
  console.log('[backfill-unread-counters] options:', opts);

  let q: FirebaseFirestore.Query = adminDb.collection('conversations');
  if (opts.businessFilter) {
    q = q.where('businessId', '==', opts.businessFilter);
  }

  const snap = await q.get();
  console.log(`[backfill-unread-counters] varrendo ${snap.size} conversas...`);

  const tenants = new Map<string, TenantAcc>();
  let scanned = 0;
  let skippedInactive = 0;
  let skippedNoBusiness = 0;
  let skippedUserNoOwnerId = 0;
  let counted = 0;

  for (const doc of snap.docs) {
    scanned++;
    const data = doc.data();

    const businessId = typeof data.businessId === 'string' ? data.businessId : '';
    if (!businessId) {
      skippedNoBusiness++;
      continue;
    }

    if (!isActive(data)) {
      skippedInactive++;
      continue;
    }

    const unread = Number(data.unreadCount ?? 0);
    if (!Number.isFinite(unread) || unread <= 0) {
      // unread 0 ou ausente nao contribui — mas o tenant ainda precisa do doc.
      if (!tenants.has(businessId)) tenants.set(businessId, { business: 0, byUser: {}, total: 0 });
      continue;
    }

    const channelOwnerType = data.channelOwnerType;
    const channelOwnerId = typeof data.channelOwnerId === 'string' ? data.channelOwnerId : '';

    if (channelOwnerType === 'user' && !channelOwnerId) {
      // Espelha scopeField → null: sem owner nao da pra atribuir, pula tudo.
      skippedUserNoOwnerId++;
      continue;
    }

    const acc = tenants.get(businessId) ?? { business: 0, byUser: {}, total: 0 };

    if (channelOwnerType === 'user') {
      acc.byUser[channelOwnerId] = (acc.byUser[channelOwnerId] ?? 0) + unread;
    } else {
      acc.business += unread;
    }
    acc.total += unread;

    tenants.set(businessId, acc);
    counted++;
  }

  console.log(`[backfill-unread-counters] tenants encontrados: ${tenants.size}`);

  const now = new Date().toISOString();
  let written = 0;

  for (const [businessId, acc] of tenants) {
    const payload = {
      businessId,
      business: acc.business,
      byUser: acc.byUser,
      total: acc.total,
      updatedAt: now,
    };
    console.log(
      `[backfill-unread-counters] ${businessId}: business=${acc.business} total=${acc.total} byUserKeys=${Object.keys(acc.byUser).length}`,
    );
    if (!opts.dryRun) {
      await adminDb.doc(`unreadCounters/${businessId}`).set(payload);
      written++;
    }
  }

  console.log('\n=== RESUMO ===');
  console.log(`Modo: ${opts.dryRun ? 'DRY-RUN (nada escrito)' : 'WRITE'}`);
  if (opts.businessFilter) console.log(`Business filter: ${opts.businessFilter}`);
  console.log(`Conversas varridas:              ${scanned}`);
  console.log(`Puladas (inativas):              ${skippedInactive}`);
  console.log(`Puladas (sem businessId):        ${skippedNoBusiness}`);
  console.log(`Puladas (user sem ownerId):      ${skippedUserNoOwnerId}`);
  console.log(`Conversas contadas (unread>0):   ${counted}`);
  console.log(`Tenants (docs unreadCounters):   ${tenants.size}`);
  console.log(`Docs escritos:                   ${opts.dryRun ? 0 : written}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill-unread-counters] fatal:', err);
    process.exit(1);
  });
