/**
 * WhatsApp Web (Baileys) — SSE Connection + QR Code Stream
 *
 * GET /api/whatsapp/connect?businessId=xxx
 *   → Server-Sent Events stream: QR codes, status updates
 *
 * Isolated from Facebook/Instagram Meta API routes.
 */

import { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SESSIONS_DIR = path.join(process.cwd(), 'whatsapp-sessions');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activeSock: any = null;

function clearSessionDir(sessionDir: string) {
  try {
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      console.log('[Baileys] Sessao corrompida removida:', sessionDir);
    }
  } catch (err) {
    console.error('[Baileys] Erro ao limpar sessao:', err);
  }
  fs.mkdirSync(sessionDir, { recursive: true });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get('businessId');

  if (!businessId) {
    return new Response('data: {"type":"error","message":"businessId required"}\n\n', {
      status: 400,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  // Verify auth
  const authResult = await verifyAuth(req);
  if (isAuthError(authResult)) return authResult;

  // Kill previous socket if exists
  if (activeSock) {
    try { activeSock.end(undefined); } catch { /* ignore */ }
    activeSock = null;
  }

  const sessionDir = path.join(SESSIONS_DIR, businessId);

  // Clear corrupted session — force fresh QR login
  clearSessionDir(sessionDir);

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  // Use Baileys built-in version fetch (more reliable than fetchLatestWaWebVersion)
  let version: [number, number, number] | undefined;
  try {
    const v = await fetchLatestBaileysVersion();
    version = v.version;
    console.log('[Baileys] Versao:', version);
  } catch (err) {
    console.warn('[Baileys] Nao conseguiu buscar versao, usando default:', err);
  }

  console.log('[SSE] Stream iniciada. Ligando Baileys...');

  // Create socket with hardened config
  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }) as any,
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    markOnlineOnConnect: false,
    defaultQueryTimeoutMs: 60_000,
  });
  activeSock = sock;

  console.log('[Baileys] Socket criado. Aguardando connection.update...');

  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController | null = null;
  let closed = false;
  let retryCount = 0;
  const MAX_RETRIES = 3;

  const send = (data: Record<string, unknown>) => {
    if (closed || !controllerRef) return;
    try {
      controllerRef.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {
      closed = true;
    }
  };

  // Wire up Baileys events
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    console.log('[Baileys] connection.update:', {
      connection,
      hasQr: !!qr,
      retryCount,
    });

    // QR code generated — send to client
    if (qr) {
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
        send({ type: 'qr', qr: qrDataUrl });
        console.log('[Baileys] QR code enviado para o frontend');
      } catch (err) {
        console.error('[Baileys] QR generation error:', err);
      }
    }

    if (connection === 'open') {
      retryCount = 0;
      const phoneNumber = sock.user?.id?.split(':')[0] || sock.user?.id?.split('@')[0] || null;
      console.log('[Baileys] Conectado! Telefone:', phoneNumber);

      send({ type: 'connected', phoneNumber, status: 'connected' });

      // Update Firestore
      try {
        const { initializeApp, getApps, getApp } = await import('firebase/app');
        const { getFirestore, doc, updateDoc } = await import('firebase/firestore');

        const firebaseConfig = {
          apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
          authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
          storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
          messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
          appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
        };
        const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
        const db = getFirestore(app);

        await updateDoc(doc(db, 'businesses', businessId), {
          'channels.whatsapp': {
            isConnected: true,
            connectedAt: new Date().toISOString(),
            connectedVia: 'baileys',
            displayPhoneNumber: phoneNumber,
            phoneNumberId: phoneNumber,
          },
          updatedAt: new Date().toISOString(),
        });
        console.log('[Baileys] Firestore atualizado');
      } catch (err) {
        console.error('[Baileys] Firestore update error:', err);
      }

      // Close SSE stream — frontend got what it needs
      setTimeout(() => {
        if (!closed) {
          closed = true;
          try { controllerRef?.close(); } catch { /* ignore */ }
        }
      }, 1000);
    }

    if (connection === 'close') {
      const error = lastDisconnect?.error;
      const statusCode = (error as any)?.output?.statusCode;

      // Log the REAL error for debugging
      console.error('[Baileys Error] Conexao fechada:', {
        statusCode,
        message: error?.message,
        stack: error?.stack?.split('\n').slice(0, 3).join(' | '),
      });

      if (statusCode === DisconnectReason.loggedOut) {
        send({ type: 'disconnected', reason: 'logged_out' });
        clearSessionDir(sessionDir);
        activeSock = null;
        if (!closed) {
          closed = true;
          try { controllerRef?.close(); } catch { /* ignore */ }
        }
      } else if (retryCount < MAX_RETRIES) {
        // Retry — connection might have failed transiently
        retryCount++;
        console.log(`[Baileys] Tentativa de reconexao ${retryCount}/${MAX_RETRIES} em 3s...`);
        send({ type: 'status', status: 'reconnecting', attempt: retryCount });

        setTimeout(async () => {
          try {
            // Clean slate
            clearSessionDir(sessionDir);
            const { state: newState, saveCreds: newSaveCreds } = await useMultiFileAuthState(sessionDir);

            const retrySock = makeWASocket({
              version,
              auth: newState,
              logger: pino({ level: 'silent' }) as any,
              browser: Browsers.ubuntu('Chrome'),
              printQRInTerminal: false,
              syncFullHistory: false,
              generateHighQualityLinkPreview: false,
              markOnlineOnConnect: false,
              defaultQueryTimeoutMs: 60_000,
            });

            activeSock = retrySock;

            retrySock.ev.on('creds.update', newSaveCreds);
            retrySock.ev.on('connection.update', async (retryUpdate) => {
              const { connection: rc, lastDisconnect: rld, qr: rqr } = retryUpdate;
              console.log('[Baileys Retry] connection.update:', { connection: rc, hasQr: !!rqr });

              if (rqr) {
                try {
                  const qrData = await QRCode.toDataURL(rqr, { width: 280, margin: 2 });
                  send({ type: 'qr', qr: qrData });
                  console.log('[Baileys Retry] QR code enviado');
                } catch (err) {
                  console.error('[Baileys Retry] QR error:', err);
                }
              }

              if (rc === 'open') {
                const phone = retrySock.user?.id?.split(':')[0] || null;
                console.log('[Baileys Retry] Conectado! Tel:', phone);
                send({ type: 'connected', phoneNumber: phone, status: 'connected' });

                try {
                  const { initializeApp, getApps, getApp } = await import('firebase/app');
                  const { getFirestore, doc, updateDoc } = await import('firebase/firestore');
                  const fbc = {
                    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
                    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
                    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
                    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
                    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
                    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
                  };
                  const a = getApps().length ? getApp() : initializeApp(fbc);
                  await updateDoc(doc(getFirestore(a), 'businesses', businessId), {
                    'channels.whatsapp': {
                      isConnected: true,
                      connectedAt: new Date().toISOString(),
                      connectedVia: 'baileys',
                      displayPhoneNumber: phone,
                      phoneNumberId: phone,
                    },
                    updatedAt: new Date().toISOString(),
                  });
                } catch { /* non-critical */ }

                setTimeout(() => {
                  if (!closed) { closed = true; try { controllerRef?.close(); } catch { /* */ } }
                }, 1000);
              }

              if (rc === 'close') {
                const sc = (rld?.error as any)?.output?.statusCode;
                console.error('[Baileys Retry] Fechou novamente. StatusCode:', sc, rld?.error?.message);
                send({ type: 'error', message: `Conexao falhou (tentativa ${retryCount}). Tente novamente.` });
                activeSock = null;
                if (!closed) { closed = true; try { controllerRef?.close(); } catch { /* */ } }
              }
            });
          } catch (retryErr) {
            console.error('[Baileys Retry] Erro ao reconectar:', retryErr);
            send({ type: 'error', message: 'Falha ao reconectar. Tente novamente.' });
            if (!closed) { closed = true; try { controllerRef?.close(); } catch { /* */ } }
          }
        }, 3000);
      } else {
        send({ type: 'error', message: 'Conexao falhou apos multiplas tentativas. Tente novamente.' });
        activeSock = null;
        if (!closed) {
          closed = true;
          try { controllerRef?.close(); } catch { /* ignore */ }
        }
      }
    }
  });

  // Create the stream — start() is synchronous
  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller;
      send({ type: 'status', status: 'connecting' });
    },
    cancel() {
      console.log('[SSE] Cliente desconectou');
      closed = true;
      if (activeSock && !activeSock.user) {
        try { activeSock.end(undefined); } catch { /* ignore */ }
        activeSock = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
