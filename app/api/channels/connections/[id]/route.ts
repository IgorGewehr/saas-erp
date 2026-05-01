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
    // Mata sessão em memória + arquivos do disco (se for Baileys)
    if (conn.type === 'whatsapp_baileys') {
      try {
        await destroySession(conn.businessId, id);
      } catch (destroyErr) {
        console.warn('[connections DELETE] destroySession failed:', destroyErr);
      }
      const dir = path.join(SESSIONS_DIR, id);
      if (fs.existsSync(dir)) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch (rmErr) {
          console.warn('[connections DELETE] rmSync failed:', rmErr);
        }
      }
    }

    // Para business-primary connections, NÃO apaga o doc — apenas marca
    // isActive=false e isConnected=false. Senão, perderíamos referência
    // histórica de conversations vinculadas a ele.
    // Para 'user' connections, podemos apagar o doc inteiro porque conversations
    // nunca foram criadas via canal pessoal antes da Phase 2.
    if (conn.ownerType === 'business' && conn.isPrimary) {
      await updateConnection(id, {
        isConnected: false,
        isActive: false,
        disconnectedAt: new Date().toISOString(),
      });
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
