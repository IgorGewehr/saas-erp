/**
 * POST /api/admin/sectors/[id]/resync-visibility
 *
 * M13: recalcula `visibleToUserIds` de toda `Conversation` já restrita a
 * este setor (composição de membros mudou, ou o setor foi apagado — nesse
 * caso `memberIds: []`) E propaga (fan-out) o novo valor pras mensagens
 * JÁ EXISTENTES de cada uma dessas conversas.
 *
 * Movido pro servidor porque isto é um fan-out DENTRO de outro fan-out
 * (N conversas × M mensagens cada) — a versão anterior
 * (`cascadeConversationVisibilityForSector`, ainda em SettingsModule.tsx,
 * só recalcula a conversa) rodava inteira no navegador; estender pra
 * também reescrever mensagens não é seguro sem retry/timeout de servidor —
 * uma aba fechada no meio deixaria um subconjunto de conversas/mensagens
 * com visibilidade desatualizada, sem sinal nenhum de que ficou pela metade.
 *
 * Chamado por SettingsModule.tsx (SectorsTab) ao invés de rodar
 * `cascadeConversationVisibilityForSector` direto no cliente.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { ROLE_HIERARCHY } from '@/lib/types';
import { computeVisibleToUserIds, type SectorMembersLookup } from '@/lib/services/conversationVisibility';
import { fanOutMessageFields } from '@/lib/services/conversationMessageOwnershipFanOut';
import type { Conversation } from '@/lib/types';

const ADMIN_MIN_ROLE = 'admin';
const CHUNK_SIZE = 400; // margem sob o limite de 500 ops/batch do Firestore

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`sectors-resync-visibility:${clientIp}`, 5, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Aguarde antes de tentar novamente.' }, { status: 429 });
  }

  try {
    const { id: sectorId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const businessId = body.businessId as string | undefined;
    const memberIds = Array.isArray(body.memberIds) ? (body.memberIds as string[]) : undefined;

    if (!sectorId || !businessId || !memberIds) {
      return NextResponse.json({ error: 'sectorId (na URL), businessId e memberIds (array) são obrigatórios' }, { status: 400 });
    }

    const auth = await verifyAuth(req, businessId);
    if (isAuthError(auth)) return auth;
    if (ROLE_HIERARCHY[auth.role as keyof typeof ROLE_HIERARCHY] < ROLE_HIERARCHY[ADMIN_MIN_ROLE]) {
      return NextResponse.json({ error: 'Forbidden — apenas admin/founder' }, { status: 403 });
    }

    const snap = await adminDb.collection('conversations')
      .where('businessId', '==', businessId)
      .where('sectorIds', 'array-contains', sectorId)
      .get();

    if (snap.empty) {
      return NextResponse.json({ ok: true, conversationsUpdated: 0, messagesFannedOut: 0 });
    }

    const sectorsById = new Map<string, SectorMembersLookup>([[sectorId, { memberIds }]]);
    const now = new Date().toISOString();
    const docs = snap.docs;

    // Fase 1: recalcula e grava visibleToUserIds em cada conversation
    // (batch, mesmo chunk da versão client anterior).
    const changed: Array<{ id: string; visibleToUserIds: string[] | null }> = [];
    for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
      const batch = adminDb.batch();
      for (const d of docs.slice(i, i + CHUNK_SIZE)) {
        const conv = d.data() as Conversation;
        const visibleToUserIds = computeVisibleToUserIds({
          sectorIds: conv.sectorIds,
          isPrivate: conv.isPrivate,
          assignedTo: conv.assignedTo,
          sectorsById,
        });
        batch.update(d.ref, { visibleToUserIds, updatedAt: now });
        changed.push({ id: d.id, visibleToUserIds });
      }
      await batch.commit();
    }

    // Fase 2: fan-out pras mensagens de cada conversa que mudou — sequencial
    // (ação rara/admin, prioriza não sobrecarregar o Firestore com paralelismo
    // alto sobre velocidade). Falha isolada numa conversa não aborta as demais.
    let messagesFannedOut = 0;
    for (const { id, visibleToUserIds } of changed) {
      try {
        await fanOutMessageFields(id, { visibleToUserIds });
        messagesFannedOut++;
      } catch (err) {
        console.error(`[admin/sectors/resync-visibility] fan-out falhou pra conversa ${id}:`, err);
      }
    }

    return NextResponse.json({
      ok: true,
      conversationsUpdated: changed.length,
      messagesFannedOut,
    });
  } catch (err) {
    console.error('[admin/sectors/resync-visibility] error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
