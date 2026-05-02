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
import path from 'path';
import fs from 'fs';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY } from '@/lib/types';
import {
  canUserAccessConnection,
  canUserManageConnection,
  updateConnection,
} from '@/lib/services/channels/channelConnections';
import { sessions, destroySession } from '@/app/api/whatsapp/baileys-manager';
import type { ChannelConnection, UserRole } from '@/lib/types';

const SESSIONS_DIR = path.join(process.cwd(), 'whatsapp-sessions');

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

  const isAdmin = role === 'founder' || role === 'admin';
  const patch: Partial<ChannelConnection> = {};

  // Campos que qualquer operator+ pode mudar na própria connection
  if (typeof body.displayName === 'string' && body.displayName.trim()) {
    patch.displayName = body.displayName.trim();
  }

  // Campos restritos a admin
  if (isAdmin) {
    if (typeof body.isPrimary === 'boolean') patch.isPrimary = body.isPrimary;
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
    // Mata sessão em memória + arquivos do disco (se for Baileys).
    // destroySession é await aqui — sem ele, o Baileys ainda mantém handles
    // abertos no sessionDir. Em Windows, rmSync logo após dispara EBUSY.
    // Pequeno delay extra cobre handles assíncronos do useMultiFileAuthState
    // que talvez ainda estejam fechando.
    if (conn.type === 'whatsapp_baileys') {
      try {
        await destroySession(conn.businessId, id);
      } catch (destroyErr) {
        console.warn('[connections DELETE] destroySession failed:', destroyErr);
      }
      // Aguarda 100ms pra handles do Baileys auth state liberarem
      await new Promise((r) => setTimeout(r, 100));
      const dir = path.join(SESSIONS_DIR, id);
      // Retry-on-EBUSY: 3 tentativas com backoff curto (cobre Windows)
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!fs.existsSync(dir)) break;
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          break;
        } catch (rmErr) {
          const isLast = attempt === 2;
          if (isLast) {
            console.warn('[connections DELETE] rmSync failed after retries:', rmErr);
            break;
          }
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
      }
    }

    // Antes de apagar/desativar, desvincula conversations apontando pra esta
    // connection — senão ficam órfãs com channelConnectionId pra doc inexistente,
    // o que faz send/route.ts cair pro fallback legacy silencioso e mensagens
    // podem ir pelo canal-empresa por engano.
    try {
      const { FieldValue } = await import('firebase-admin/firestore');
      const orphanSnap = await adminDb.collection('conversations')
        .where('businessId', '==', conn.businessId)
        .where('channelConnectionId', '==', id)
        .get();
      // Chunk em batches (Firestore: 500 ops max)
      for (let i = 0; i < orphanSnap.docs.length; i += 400) {
        const slice = orphanSnap.docs.slice(i, i + 400);
        const batch = adminDb.batch();
        for (const d of slice) {
          batch.update(d.ref, {
            channelConnectionId: FieldValue.delete(),
            updatedAt: new Date().toISOString(),
          });
        }
        await batch.commit();
      }
      if (orphanSnap.size > 0) {
        console.log(`[connections DELETE] Unlinked ${orphanSnap.size} conversation(s) from connection ${id}`);
      }
    } catch (unlinkErr) {
      console.error('[connections DELETE] Failed to unlink conversations:', unlinkErr);
      return NextResponse.json({
        error: 'Falha ao desvincular conversações. Tente novamente.',
      }, { status: 500 });
    }

    // Para business-primary connections, NÃO apaga o doc — apenas marca
    // isActive=false e isConnected=false. Senão, perderíamos referência
    // histórica de conversations vinculadas a ele.
    // Para 'user' connections, apaga o doc inteiro (conversations já foram
    // desvinculadas acima, então sem órfãos).
    if (conn.ownerType === 'business' && conn.isPrimary) {
      await updateConnection(id, {
        isConnected: false,
        isActive: false,
        disconnectedAt: new Date().toISOString(),
      });

      // Phase 3.1: ao desativar a primary, promove outra business connection
      // do mesmo type a primary se houver. Sem isso, send/route.ts cai no
      // lazy migration e cria primary nova vazia (estado confuso).
      try {
        const candidatesSnap = await adminDb.collection('channelConnections')
          .where('businessId', '==', conn.businessId)
          .where('type', '==', conn.type)
          .where('ownerType', '==', 'business')
          .where('isActive', '==', true)
          .get();
        const candidates = candidatesSnap.docs
          .filter((d) => d.id !== id && !d.data().isPrimary);
        // Prefere conexões connected; senão primeira ativa
        const promoted = candidates.find((d) => d.data().isConnected) || candidates[0];
        if (promoted) {
          await promoted.ref.update({
            isPrimary: true,
            updatedAt: new Date().toISOString(),
          });
          console.log(`[connections DELETE] Auto-promoted ${promoted.id} to primary after disabling ${id}`);
        }
      } catch (promoteErr) {
        console.warn('[connections DELETE] Failed to auto-promote replacement primary:', promoteErr);
      }
    } else {
      await adminDb.collection('channelConnections').doc(id).delete();
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
