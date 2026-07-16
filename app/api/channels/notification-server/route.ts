/**
 * Notification Server SMTP Configuration API
 *
 * Arquitetura: a URL e API key do notification-server são GLOBAIS, vivem em
 * env vars (NOTIFICATION_SERVER_URL + NOTIFICATION_SERVER_API_KEY) e
 * compartilhadas entre todos os businesses. Esta API gerencia apenas as
 * credenciais SMTP por business — cada cliente usa seu próprio remetente
 * (Gmail/Outlook/SendGrid/etc.).
 *
 * - POST /api/channels/notification-server  → salva SMTP do business (pass criptografada)
 * - GET  /api/channels/notification-server  → testa NS (auth + envio fake) e retorna SMTP atual
 * - DELETE /api/channels/notification-server → remove SMTP do business
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { encryptToken } from '@/lib/utils/encryption';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { UserRole } from '@/lib/types';

const VALID_PORTS = new Set([25, 465, 587, 2525]);
const MAX_HOST_LEN = 255;
const MAX_USER_LEN = 320; // RFC 5321 max email
const MAX_FROM_LEN = 320;

function requireAdmin(role: string): NextResponse | null {
  if ((ROLE_HIERARCHY[role as UserRole] || 0) < ROLE_HIERARCHY['admin']) {
    return NextResponse.json({ error: 'Forbidden — admin role required' }, { status: 403 });
  }
  return null;
}

/** Lê config global do servidor a partir das env vars. Lança se ausente. */
function readGlobalNotificationServerConfig(): { url: string; apiKey: string } {
  const url = (process.env.NOTIFICATION_SERVER_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.NOTIFICATION_SERVER_API_KEY || '';
  if (!url) throw new Error('NOTIFICATION_SERVER_URL não configurada no servidor');
  if (!apiKey) throw new Error('NOTIFICATION_SERVER_API_KEY não configurada no servidor');
  if (!/^https?:\/\//i.test(url)) throw new Error('NOTIFICATION_SERVER_URL deve começar com http:// ou https://');
  return { url, apiKey };
}

export async function POST(req: NextRequest) {
  // Rate limit: 10 saves/min por IP (defensivo)
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`ns-config:${clientIp}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Aguarde antes de salvar novamente.' }, { status: 429 });
  }

  try {
    const body = await req.json();
    const { businessId, smtp } = body;
    if (!businessId) {
      return NextResponse.json({ error: 'businessId é obrigatório' }, { status: 400 });
    }
    if (!smtp || typeof smtp !== 'object') {
      return NextResponse.json({ error: 'smtp é obrigatório' }, { status: 400 });
    }

    // Validações dos campos SMTP
    const host = typeof smtp.host === 'string' ? smtp.host.trim() : '';
    const portRaw = typeof smtp.port === 'number' ? smtp.port : parseInt(smtp.port);
    const secure = !!smtp.secure;
    const user = typeof smtp.user === 'string' ? smtp.user.trim() : '';
    const pass = typeof smtp.pass === 'string' ? smtp.pass : '';
    const from = typeof smtp.from === 'string' ? smtp.from.trim() : '';

    if (!host || host.length > MAX_HOST_LEN) {
      return NextResponse.json({ error: 'smtp.host inválido (vazio ou muito longo)' }, { status: 400 });
    }
    if (!Number.isFinite(portRaw) || !VALID_PORTS.has(portRaw)) {
      return NextResponse.json({
        error: `smtp.port inválido — use 25, 465, 587 ou 2525`,
      }, { status: 400 });
    }
    if (!user || user.length > MAX_USER_LEN) {
      return NextResponse.json({ error: 'smtp.user inválido' }, { status: 400 });
    }
    if (!from || from.length > MAX_FROM_LEN) {
      return NextResponse.json({ error: 'smtp.from inválido' }, { status: 400 });
    }

    const authResult = await verifyAuth(req, businessId);
    if (isAuthError(authResult)) return authResult;
    const adminCheck = requireAdmin(authResult.role);
    if (adminCheck) return adminCheck;

    // pass: aceita reenvio em branco para preservar a anterior (UX comum em
    // telas de credenciais — operador edita user/from sem ter que digitar
    // a senha de novo). Se primeira config, exige pass.
    const bizSnap = await adminDb.collection('businesses').doc(businessId).get();
    const currentPass = bizSnap.data()?.settings?.notificationServer?.smtp?.pass;
    if (!pass && !currentPass) {
      return NextResponse.json({ error: 'smtp.pass é obrigatória na primeira configuração' }, { status: 400 });
    }
    const encryptedPass = pass ? await encryptToken(pass) : currentPass;

    const now = new Date().toISOString();
    await adminDb.collection('businesses').doc(businessId).set({
      settings: {
        notificationServer: {
          isConfigured: true,
          configuredAt: now,
          smtp: {
            host,
            port: portRaw,
            secure,
            user,
            pass: encryptedPass,
            from,
          },
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
    // Não exige admin para ler status — qualquer membro vê

    // Valida env vars globais
    let globalCfg: { url: string; apiKey: string };
    try {
      globalCfg = readGlobalNotificationServerConfig();
    } catch (envErr) {
      return NextResponse.json({
        ok: false,
        status: 'failed',
        detail: envErr instanceof Error ? envErr.message : 'Server misconfigured',
      }, { status: 500 });
    }

    // Verifica se o business tem SMTP configurado
    const bizSnap = await adminDb.collection('businesses').doc(businessId).get();
    const config = bizSnap.data()?.settings?.notificationServer;
    if (!config?.isConfigured || !config?.smtp?.host) {
      return NextResponse.json({ ok: false, status: 'failed', detail: 'SMTP do business não configurado' }, { status: 400 });
    }

    // Ping no /api/status do notification-server (auth check)
    let status: 'ok' | 'failed';
    let detail: string | undefined;
    try {
      const res = await fetch(`${globalCfg.url}/api/status`, {
        headers: { 'x-api-key': globalCfg.apiKey },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        status = 'ok';
        detail = `Servidor reachable (HTTP ${res.status})`;
      } else {
        status = 'failed';
        detail = `HTTP ${res.status}`;
      }
    } catch (err) {
      status = 'failed';
      detail = err instanceof Error ? err.message : 'Network error';
    }

    // Salva resultado do teste (best-effort)
    if (ROLE_HIERARCHY[authResult.role as UserRole] >= ROLE_HIERARCHY['admin']) {
      await adminDb.collection('businesses').doc(businessId).update({
        'settings.notificationServer.lastTestedAt': new Date().toISOString(),
        'settings.notificationServer.lastTestStatus': status,
        'settings.notificationServer.lastTestDetail': detail || null,
      }).catch(() => { /* não-crítico */ });
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
