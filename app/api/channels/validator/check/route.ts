/**
 * POST /api/channels/validator/check
 *
 * Higieniza um batch de números antes de uma campanha em massa: pra cada
 * phone, consulta o chip validador (purpose='validator') via Baileys
 * `sock.onWhatsApp([jid])` e retorna se o número tem WhatsApp.
 *
 * Reduz `Message undeliverable` na hora do disparo real — números sem WA
 * são removidos da lista, preservando a reputação do chip principal.
 *
 * Throttling crítico:
 *  - Limite de 30 phones por request (evita serverless timeout de 60s)
 *  - 2s entre cada onWhatsApp dentro do batch (espelha o anti-detect do
 *    sendBaileysBroadcastMessage; sem isso o chip queima em horas)
 *  - Cache em phoneValidations/{businessId}_{phone} com TTL 30 dias
 *    (números BR mudam pouco; re-check só se passar do prazo)
 *
 * Body:  { businessId, phones: string[] }
 * Reply: { results: { [phone]: { exists, cached } }, stats }
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY } from '@/lib/types';
import { sessions } from '@/app/api/whatsapp/baileys-manager';
import type { ChannelConnection, UserRole } from '@/lib/types';

/** Tamanho máximo do batch por request. Calculado pra caber em 60s mesmo no
 *  pior caso (30 phones × 2s = 60s + margem de IO). Frontend chama em fatias. */
const MAX_BATCH_SIZE = 30;

/** Delay entre cada onWhatsApp. Mesmo valor do envio Baileys (linha 2013 do
 *  baileys-manager). Sob esse limite, o chip queima por padrão de scan. */
const ONWHATSAPP_DELAY_MS = 2_000;

/** TTL do cache de validação: 30 dias. Number de WhatsApp não some toda
 *  hora, então re-validação semanal/mensal é suficiente. Caso o número
 *  perca o WA nesse intervalo, vira `failed` no disparo (cobre o residual). */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface CheckBody {
  businessId: string;
  phones: string[];
}

interface PhoneValidationDoc {
  businessId: string;
  phone: string;
  exists: boolean;
  validatedAt: string;
  validatedBy: string; // connectionId do validator que checou
}

interface PhoneResult {
  exists: boolean;
  cached: boolean;
}

export async function POST(req: NextRequest) {
  let body: CheckBody;
  try {
    body = await req.json() as CheckBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { businessId, phones } = body;
  if (!businessId || !Array.isArray(phones) || phones.length === 0) {
    return NextResponse.json({ error: 'businessId e phones (array não-vazio) requeridos' }, { status: 400 });
  }
  if (phones.length > MAX_BATCH_SIZE) {
    return NextResponse.json({
      error: `Batch máximo: ${MAX_BATCH_SIZE} números por request. Quebre em chunks.`,
    }, { status: 400 });
  }

  const authResult = await verifyAuth(req, businessId);
  if (isAuthError(authResult)) return authResult;
  const role = (authResult.role || 'viewer') as UserRole;
  if ((ROLE_HIERARCHY[role] || 0) < ROLE_HIERARCHY['operator']) {
    return NextResponse.json({ error: 'Forbidden — operator role required' }, { status: 403 });
  }

  // Normaliza/dedupe phones (apenas dígitos). Se algum vier malformado, sai
  // do batch (frontend já deveria ter filtrado, mas defensivo).
  const uniquePhones = Array.from(new Set(
    phones
      .map(p => String(p || '').replace(/\D/g, ''))
      .filter(p => p.length >= 8 && p.length <= 15)
  ));
  if (uniquePhones.length === 0) {
    return NextResponse.json({ error: 'Nenhum phone válido no batch' }, { status: 400 });
  }

  const results: Record<string, PhoneResult> = {};
  const phonesToCheck: string[] = [];

  // ─── 1) Cache lookup ───────────────────────────────────────────────────
  // Doc id composto = `${businessId}_${phone}` pra evitar query + faz fetch
  // direto por getAll(). Cache hits voltam instantâneo, só miss vai pro chip.
  const cacheRefs = uniquePhones.map(p =>
    adminDb.collection('phoneValidations').doc(`${businessId}_${p}`)
  );
  const cacheSnaps = await adminDb.getAll(...cacheRefs);
  const now = Date.now();
  for (let i = 0; i < uniquePhones.length; i++) {
    const phone = uniquePhones[i];
    const snap = cacheSnaps[i];
    if (snap.exists) {
      const data = snap.data() as PhoneValidationDoc;
      const ageMs = now - new Date(data.validatedAt).getTime();
      if (ageMs < CACHE_TTL_MS) {
        results[phone] = { exists: data.exists, cached: true };
        continue;
      }
    }
    phonesToCheck.push(phone);
  }

  // ─── 2) Live check via validator chip (se algum miss) ──────────────────
  if (phonesToCheck.length > 0) {
    // Acha o chip validador (purpose='validator', mesma business)
    const validatorSnap = await adminDb.collection('channelConnections')
      .where('businessId', '==', businessId)
      .where('purpose', '==', 'validator')
      .where('isConnected', '==', true)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (validatorSnap.empty) {
      return NextResponse.json({
        error: 'Chip validador não configurado ou desconectado. Conecte em Configurações → Canais.',
        // Retorna o que veio do cache mesmo assim — operador pode aproveitar.
        results,
        stats: { total: uniquePhones.length, cached: uniquePhones.length - phonesToCheck.length, checked: 0, errors: 0 },
      }, { status: 503 });
    }

    const validatorDoc = validatorSnap.docs[0];
    const validatorConnection = { ...(validatorDoc.data() as ChannelConnection), id: validatorDoc.id };
    const session = sessions.get(validatorConnection.id);

    if (!session || !session.sock) {
      // Validator está marcado como conectado no Firestore mas a sessão
      // em memória sumiu (server reiniciou e ainda não reabriu o socket).
      // Não força reconnect aqui — devolve erro pro user reabrir o chip.
      return NextResponse.json({
        error: 'Chip validador conectado no banco mas sessão indisponível. Reabra em Configurações → Canais.',
        results,
        stats: { total: uniquePhones.length, cached: uniquePhones.length - phonesToCheck.length, checked: 0, errors: 0 },
      }, { status: 503 });
    }

    let errors = 0;
    const batchWrite = adminDb.batch();
    let batchOps = 0;

    for (let i = 0; i < phonesToCheck.length; i++) {
      const phone = phonesToCheck[i];
      // Throttle: aguarda antes de fazer o ping (exceto no 1°). Pula no
      // primeiro pra reduzir latência percebida.
      if (i > 0) await sleep(ONWHATSAPP_DELAY_MS);

      const candidateJid = `${phone}@s.whatsapp.net`;
      try {
        // onWhatsApp aceita array; passamos um por vez pra simplificar
        // tratamento de erro por phone (lib batched falha tudo se 1 falha).
        const arr = await session.sock.onWhatsApp(candidateJid);
        const r = Array.isArray(arr) ? arr[0] : undefined;
        const exists = !!r?.exists;
        results[phone] = { exists, cached: false };

        // Grava no cache. validatedBy = connectionId pra rastreio.
        const cacheData: PhoneValidationDoc = {
          businessId,
          phone,
          exists,
          validatedAt: new Date().toISOString(),
          validatedBy: validatorConnection.id,
        };
        batchWrite.set(
          adminDb.collection('phoneValidations').doc(`${businessId}_${phone}`),
          cacheData,
          { merge: false } // sobrescreve cache antigo expirado
        );
        batchOps++;
      } catch (err) {
        console.warn(`[validator/check] onWhatsApp falhou pra ${phone}:`, err);
        errors++;
        // Sem resultado pra esse phone — frontend trata como "incerto" e
        // pode tentar de novo numa próxima rodada.
      }
    }

    // Commit do cache em lote (Firestore aceita até 500 ops)
    if (batchOps > 0) {
      try {
        await batchWrite.commit();
      } catch (err) {
        console.error('[validator/check] Cache batch commit falhou:', err);
        // Não trava o response — resultados em memória já estão prontos.
      }
    }

    return NextResponse.json({
      results,
      stats: {
        total: uniquePhones.length,
        cached: uniquePhones.length - phonesToCheck.length,
        checked: phonesToCheck.length - errors,
        errors,
      },
    });
  }

  // Todos vieram do cache
  return NextResponse.json({
    results,
    stats: {
      total: uniquePhones.length,
      cached: uniquePhones.length,
      checked: 0,
      errors: 0,
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
