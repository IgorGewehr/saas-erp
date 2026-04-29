/**
 * Notification Server Configuration API
 *
 * - POST /api/channels/notification-server  → salva URL + API key (criptografada)
 * - GET  /api/channels/notification-server  → testa conexão (faz GET no /api/status do server)
 * - DELETE /api/channels/notification-server → desconecta (limpa config)
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { encryptToken, decryptToken } from '@/lib/utils/encryption';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { UserRole } from '@/lib/types';

function requireAdmin(role: string): NextResponse | null {
  if ((ROLE_HIERARCHY[role as UserRole] || 0) < ROLE_HIERARCHY['admin']) {
    return NextResponse.json({ error: 'Forbidden — admin role required' }, { status: 403 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { businessId, url, apiKey, appId } = body;
    if (!businessId || !url || !apiKey) {
      return NextResponse.json({ error: 'businessId, url e apiKey são obrigatórios' }, { status: 400 });
    }
    // Valida URL
    try { new URL(url); } catch {
      return NextResponse.json({ error: 'URL inválida' }, { status: 400 });
    }

    const authResult = await verifyAuth(req, businessId);
    if (isAuthError(authResult)) return authResult;
    const adminCheck = requireAdmin(authResult.role);
    if (adminCheck) return adminCheck;

    const now = new Date().toISOString();
    const encryptedKey = await encryptToken(apiKey);

    await adminDb.collection('businesses').doc(businessId).set({
      settings: {
        notificationServer: {
          url: url.replace(/\/$/, ''), // remove trailing slash
          apiKey: encryptedKey,
          appId: appId || businessId,
          isConfigured: true,
          configuredAt: now,
        },
      },
      updatedAt: now,
    }, { merge: true });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[NotificationServer] Save error:', err);
    return NextResponse.json({ error: 'Erro ao salvar configuração' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const businessId = req.nextUrl.searchParams.get('businessId');
    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
    }

    const authResult = await verifyAuth(req, businessId);
    if (isAuthError(authResult)) return authResult;
    // Não exige admin para ler status — qualquer membro pode ver

    const bizSnap = await adminDb.collection('businesses').doc(businessId).get();
    const config = bizSnap.data()?.settings?.notificationServer;
    if (!config?.isConfigured || !config?.url || !config?.apiKey) {
      return NextResponse.json({ ok: false, error: 'Not configured' }, { status: 400 });
    }

    let apiKey: string;
    try {
      apiKey = await decryptToken(config.apiKey);
    } catch {
      return NextResponse.json({ ok: false, error: 'Erro ao descriptografar API key' }, { status: 500 });
    }

    // Faz ping no /api/status do notification-server
    let status: 'ok' | 'failed';
    let detail: string | undefined;
    try {
      const res = await fetch(`${config.url}/api/status`, {
        headers: { 'x-api-key': apiKey },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        status = 'ok';
        detail = `HTTP ${res.status}`;
      } else {
        status = 'failed';
        detail = `HTTP ${res.status}`;
      }
    } catch (err) {
      status = 'failed';
      detail = err instanceof Error ? err.message : 'Network error';
    }

    // Salva resultado do teste
    const adminCheck = requireAdmin(authResult.role);
    if (!adminCheck) {
      // Só admin atualiza o lastTestStatus (evita gravações por viewer)
      await adminDb.collection('businesses').doc(businessId).update({
        'settings.notificationServer.lastTestedAt': new Date().toISOString(),
        'settings.notificationServer.lastTestStatus': status,
      }).catch(() => {/* não-crítico */});
    }

    return NextResponse.json({ ok: status === 'ok', status, detail });
  } catch (err) {
    console.error('[NotificationServer] Test error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const businessId = req.nextUrl.searchParams.get('businessId');
    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
    }

    const authResult = await verifyAuth(req, businessId);
    if (isAuthError(authResult)) return authResult;
    const adminCheck = requireAdmin(authResult.role);
    if (adminCheck) return adminCheck;

    const { FieldValue } = await import('firebase-admin/firestore');
    await adminDb.collection('businesses').doc(businessId).update({
      'settings.notificationServer': FieldValue.delete(),
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[NotificationServer] Delete error:', err);
    return NextResponse.json({ error: 'Erro ao desconectar' }, { status: 500 });
  }
}
