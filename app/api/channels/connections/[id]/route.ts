/**
 * Channel Connections — single doc operations.
 *
 * PATCH  /api/channels/connections/[id]
 *        Body: { displayName?, isPrimary?, ownerType?, ownerId? }
 *        - operator: pode editar apenas displayName na própria 'user' connection
 *        - admin: pode tudo, incluindo ownership transfer (operador saiu, etc)
 *
 * DELETE /api/channels/connections/[id]
 *        Apaga a conexão. Mata sessão Baileys em memória + arquivos no disco.
 *        - operator: só apaga próprio 'user'
 *        - admin: apaga qualquer
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY } from '@/lib/types';
import {
  canUserManageConnection,
  updateConnection,
} from '@/lib/services/channels/channelConnections';
import { sessions, destroySession } from '@/app/api/whatsapp/baileys-manager';
import { deleteFirestoreAuthState } from '@/lib/services/baileys/firestore-auth-state';
import type { ChannelConnection, UserRole } from '@/lib/types';

async function loadConnection(id: string): Promise<ChannelConnection | null> {
  const snap = await adminDb.collection('channelConnections').doc(id).get();
  if (!snap.exists) return null;
  return { ...(snap.data() as ChannelConnection), id: snap.id };
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const conn = await loadConnection(id);
  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

  const authResult = await verifyAuth(req, conn.businessId);
  if (isAuthError(authResult)) return authResult;
  const role = (authResult.role || 'viewer') as UserRole;
  const uid = authResult.uid;
  if ((ROLE_HIERARCHY[role] || 0) < ROLE_HIERARCHY['operator']) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!canUserManageConnection(conn, { uid, role: role as string })) {
    return NextResponse.json({ error: 'Forbidden — você não pode gerenciar esta conexão' }, { status: 403 });
  }

  let body: Partial<ChannelConnection>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const isAdmin = (ROLE_HIERARCHY[role as UserRole] ?? 0) >= ROLE_HIERARCHY['admin'];
  const patch: Partial<ChannelConnection> = {};

  // Imutável: purpose nasce com a connection e nunca muda. Permitir conversão
  // sender→validator surpreendia um operador (ex: número parou de enviar de
  // repente sem aviso); validator→sender desfazia o isolamento de segurança
  // do chip validador. Se precisar trocar, delete e recrie com purpose certo.
  if (body.purpose !== undefined && body.purpose !== conn.purpose) {
    return NextResponse.json({
      error: 'Não é permitido alterar o purpose (sender/validator) de uma conexão. Delete e crie outra com o purpose desejado.',
    }, { status: 400 });
  }

  // Campos que qualquer operator+ pode mudar na própria connection
  if (typeof body.displayName === 'string' && body.displayName.trim()) {
    patch.displayName = body.displayName.trim();
  }

  // Campos restritos a admin
  if (isAdmin) {
    if (typeof body.isPrimary === 'boolean') {
      // Phase 3 audit P0.1: isPrimary=true só faz sentido em business connections.
      // Sem este guard, admin (intencional ou bug de UI) podia marcar canal 'user'
      // como primary, criando 2 primaries simultâneas e quebrando findPrimary.
      // Considera tanto o type atual da connection (quando ownerType não muda)
      // quanto o type-no-update (quando admin transfer ownership na mesma chamada).
      const finalOwnerType = (body.ownerType && (body.ownerType === 'business' || body.ownerType === 'user'))
        ? body.ownerType
        : conn.ownerType;
      if (body.isPrimary === true && finalOwnerType !== 'business') {
        return NextResponse.json({
          error: 'Apenas canais da empresa (ownerType=business) podem ser marcados como principal.',
        }, { status: 400 });
      }
      // Validator nunca pode virar primary — primary alimenta lookups de
      // "canal default pra enviar" e validator é justamente o oposto disso.
      if (body.isPrimary === true && conn.purpose === 'validator') {
        return NextResponse.json({
          error: 'Chip validador não pode ser marcado como principal — ele nunca envia mensagens.',
        }, { status: 400 });
      }
      patch.isPrimary = body.isPrimary;
    }
    if (typeof body.isActive === 'boolean') patch.isActive = body.isActive;
    if (body.ownerType && (body.ownerType === 'business' || body.ownerType === 'user')) {
      patch.ownerType = body.ownerType;
      // Quando virar 'business', ownerId vai vazio
      if (body.ownerType === 'business') {
        patch.ownerId = '';
      } else if (typeof body.ownerId === 'string' && body.ownerId) {
        patch.ownerId = body.ownerId;
      }
    } else if (typeof body.ownerId === 'string') {
      patch.ownerId = body.ownerId;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nenhum campo válido pra atualizar' }, { status: 400 });
  }

  try {
    // Phase 3.1: promover a primary requer demote da primary atual.
    // Sem isso, business pode ter 2 primary ao mesmo tempo — findPrimaryConnection
    // retorna inconsistente, send pode pegar a errada.
    if (patch.isPrimary === true && conn.ownerType === 'business') {
      const currentPrimarySnap = await adminDb.collection('channelConnections')
        .where('businessId', '==', conn.businessId)
        .where('type', '==', conn.type)
        .where('ownerType', '==', 'business')
        .where('isPrimary', '==', true)
        .get();
      // Demote todas as outras primary do mesmo tipo (deveria ser só 1, mas
      // anti-corrupção em caso de estado inconsistente prévio)
      for (const d of currentPrimarySnap.docs) {
        if (d.id !== id) {
          await d.ref.update({ isPrimary: false, updatedAt: new Date().toISOString() });
        }
      }
    }

    await updateConnection(id, patch);
    const updated = await loadConnection(id);
    return NextResponse.json({ success: true, connection: sanitize(updated) });
  } catch (err) {
    console.error('[connections PATCH] Error:', err);
    return NextResponse.json({ error: 'Falha ao atualizar' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const conn = await loadConnection(id);
  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

  const authResult = await verifyAuth(req, conn.businessId);
  if (isAuthError(authResult)) return authResult;
  const role = (authResult.role || 'viewer') as UserRole;
  const uid = authResult.uid;
  if ((ROLE_HIERARCHY[role] || 0) < ROLE_HIERARCHY['operator']) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!canUserManageConnection(conn, { uid, role: role as string })) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Mata sessão em memória + apaga auth state do Firestore (se for Baileys).
    if (conn.type === 'whatsapp_baileys') {
      try {
        await destroySession(conn.businessId, id);
      } catch (destroyErr) {
        console.warn('[connections DELETE] destroySession failed:', destroyErr);
      }
      try {
        await deleteFirestoreAuthState(id);
      } catch (deleteErr) {
        console.warn('[connections DELETE] deleteFirestoreAuthState failed:', deleteErr);
      }
    }

    // Antes de apagar/desativar, trata conversations apontando pra esta
    // connection. Sem isso ficam órfãs com channelConnectionId pra doc
    // inexistente, e send/route.ts cai pro fallback silencioso — risco de
    // mensagens irem pelo canal errado.
    //
    // Estratégia (canal pessoal removido, ex: operador saiu da empresa):
    //   1. Procura primary baileys do business como destino de fallback.
    //   2. Se existe: repointar `channelConnectionId` pra primary. As novas
    //      mensagens saem pelo número da empresa (com connectedVia='baileys').
    //      O histórico (mensagens antigas) preserva o transporte original.
    //   3. Se não existe primary baileys: limpa `channelConnectionId` E
    //      `connectedVia` da conversa — força o admin a escolher canal
    //      explicitamente na próxima resposta (em vez de envio silencioso).
    try {
      const { FieldValue } = await import('firebase-admin/firestore');
      const orphanSnap = await adminDb.collection('conversations')
        .where('businessId', '==', conn.businessId)
        .where('channelConnectionId', '==', id)
        .get();

      // Resolve fallback de canal (apenas pra Baileys; Cloud não tem múltiplas connections do mesmo type).
      let fallbackConnectionId: string | null = null;
      if (conn.type === 'whatsapp_baileys' && orphanSnap.size > 0) {
        try {
          const primarySnap = await adminDb.collection('channelConnections')
            .where('businessId', '==', conn.businessId)
            .where('type', '==', 'whatsapp_baileys')
            .where('ownerType', '==', 'business')
            .where('isPrimary', '==', true)
            .where('isActive', '==', true)
            .limit(1)
            .get();
          // Não promove pra primary desconectada — operador veria badge "Conectado"
          // sem socket atrás (envio falharia).
          const primary = primarySnap.docs.find(d => d.data().isConnected);
          if (primary && primary.id !== id) {
            fallbackConnectionId = primary.id;
          }
        } catch (lookupErr) {
          console.warn('[connections DELETE] Falha ao buscar primary baileys de fallback:', lookupErr);
        }
      }

      const now = new Date().toISOString();
      const isBaileysDelete = conn.type === 'whatsapp_baileys';

      // Chunk em batches (Firestore: 500 ops max)
      for (let i = 0; i < orphanSnap.docs.length; i += 400) {
        const slice = orphanSnap.docs.slice(i, i + 400);
        const batch = adminDb.batch();
        for (const d of slice) {
          if (isBaileysDelete && fallbackConnectionId) {
            // Baileys com fallback: repointa pra primary; mantém connectedVia
            // (transporte real preservado). Conversa permanece 'open' — operador
            // continua atendendo pelo número da empresa.
            batch.update(d.ref, {
              channelConnectionId: fallbackConnectionId,
              updatedAt: now,
            });
          } else if (isBaileysDelete) {
            // Baileys sem fallback: arquiva como 'resolved' pra sair da inbox.
            // Sem isso o operador veria a conversa "viva" e responderia, mas a
            // resposta sairia pelo Cloud (canal-empresa diferente do original) —
            // cliente recebe num thread separado e fica confuso.
            //
            // Limpa channelConnectionId/connectedVia pra forçar escolha explícita
            // se o admin reabrir e tentar responder. closedReason documenta o
            // motivo pra auditoria/futuro UI banner. Mantém status original se já
            // estava 'resolved' (não desfaz CSAT etc — só adiciona closedReason).
            const wasAlreadyResolved = d.data().status === 'resolved';
            batch.update(d.ref, {
              channelConnectionId: FieldValue.delete(),
              connectedVia: FieldValue.delete(),
              ...(wasAlreadyResolved ? {} : { status: 'resolved' }),
              closedReason: 'channel_removed',
              updatedAt: now,
            });
          } else {
            // Não-Baileys (Cloud/FB/IG): só desvincula channelConnectionId. NÃO
            // arquiva (Cloud é singleton por business — sua remoção é evento
            // administrativo, não impacta histórico de conversa) e NÃO toca
            // connectedVia (preserva o transporte original pra UI render).
            batch.update(d.ref, {
              channelConnectionId: FieldValue.delete(),
              updatedAt: now,
            });
          }
        }
        await batch.commit();
      }
      if (orphanSnap.size > 0) {
        if (!isBaileysDelete) {
          console.log(`[connections DELETE] Desvinculou ${orphanSnap.size} conversa(s) do canal ${conn.type} ${id} (não-Baileys: sem arquivamento auto)`);
        } else if (fallbackConnectionId) {
          console.log(`[connections DELETE] Repontou ${orphanSnap.size} conversa(s) do canal Baileys ${id} pra primary ${fallbackConnectionId}`);
        } else {
          console.log(`[connections DELETE] ${orphanSnap.size} conversa(s) do canal Baileys ${id} arquivadas como 'resolved' (sem fallback disponível)`);
        }
      }
    } catch (unlinkErr) {
      console.error('[connections DELETE] Failed to unlink conversations:', unlinkErr);
      return NextResponse.json({
        error: 'Falha ao desvincular conversações. Tente novamente.',
      }, { status: 500 });
    }

    // Fase 4 do plano de soft-delete: TODAS as connections viram soft-delete
    // unificado (deletedAt + audit + isActive: false). Antes hard-deletava
    // non-primary — agora preserva pra restore via Lixeira E manter referencias
    // historicas (conversationMessages Tier 1 podem citar channelConnectionId
    // mesmo apos delete).
    //
    // `isActive: false` mantido por compat com queries existentes (varias
    // rotas filtram `where('isActive', '==', true)` — cleanup pra usar
    // deletedAt fica como Deploy C, ver memoria [[soft-delete-deploy-c-cleanup]]).
    const nowIso = new Date().toISOString();
    const softDeleteFields = {
      isConnected: false,
      isActive: false,
      disconnectedAt: nowIso,
      deletedAt: nowIso,
      deletedBy: authResult.uid,
      deletedByName: authResult.uid, // verifyAuth nao retorna name
      updatedAt: nowIso,
    };
    await updateConnection(id, softDeleteFields);

    // Auto-promote replacement primary (so quando a deletada era primary).
    // Phase 3.1: ao desativar a primary, promove outra business connection
    // do mesmo type a primary se houver. Sem isso, send/route.ts cai no
    // lazy migration e cria primary nova vazia (estado confuso).
    if (conn.ownerType === 'business' && conn.isPrimary) {
      try {
        const candidatesSnap = await adminDb.collection('channelConnections')
          .where('businessId', '==', conn.businessId)
          .where('type', '==', conn.type)
          .where('ownerType', '==', 'business')
          .where('isActive', '==', true)
          .get();
        const candidates = candidatesSnap.docs
          .filter((d) => d.id !== id && !d.data().isPrimary);
        // Phase 3 audit P1.3: APENAS promove uma connected. Promover desconectada
        // criava UX confuso (PRINCIPAL + Desconectado simultâneos) e send fallback
        // pegava sessão morta. Se nenhuma connected, deixa sem primary; o
        // ensurePrimaryBusinessConnection cria fresh quando necessário.
        const promoted = candidates.find((d) => d.data().isConnected);
        if (promoted) {
          await promoted.ref.update({
            isPrimary: true,
            updatedAt: nowIso,
          });
          console.log(`[connections DELETE] Auto-promoted ${promoted.id} to primary after disabling ${id}`);
        } else if (candidates.length > 0) {
          console.warn(`[connections DELETE] ${candidates.length} candidate(s) disponíveis mas nenhuma conectada — sem auto-promote (admin precisa promover manualmente após reconectar)`);
        }
      } catch (promoteErr) {
        console.warn('[connections DELETE] Failed to auto-promote replacement primary:', promoteErr);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[connections DELETE] Error:', err);
    return NextResponse.json({ error: 'Falha ao remover' }, { status: 500 });
  }
}

function sanitize(c: ChannelConnection | null) {
  if (!c) return null;
  const { accessToken: _a, pageAccessToken: _p, ...rest } = c;
  void _a; void _p;
  return rest;
}

// Para reuso no DELETE acima — sessions é exportado mas não usado diretamente
void sessions;
