/**
 * Conversation Sync Engine
 *
 * POST /api/conversations/sync
 *
 * Pulls recent conversations and messages from Meta Graph API
 * (Facebook Messenger + Instagram) and saves them to Firestore.
 *
 * Uses externalMessageId (mid) for deduplication — safe to run multiple times.
 *
 * Body: { businessId: string, channel?: 'facebook' | 'instagram' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { decryptToken } from '@/lib/utils/encryption';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  doc,
  increment,
  limit as firestoreLimit,
} from 'firebase/firestore';

const META_GRAPH = 'https://graph.facebook.com/v21.0';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function getDb() {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getFirestore(app);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface MetaConversation {
  id: string;
  updated_time: string;
  participants?: { data: Array<{ id: string; name?: string; email?: string }> };
  messages?: {
    data: Array<{
      id: string;
      message: string;
      from: { id: string; name?: string };
      to: { data: Array<{ id: string; name?: string }> };
      created_time: string;
    }>;
    paging?: { next?: string };
  };
}

interface SyncStats {
  conversationsSynced: number;
  messagesImported: number;
  messagesDuplicate: number;
  errors: string[];
}

// ─── Profile cache (avoid re-fetching same user within one sync) ──────────────

const profileCache = new Map<string, { name: string; profilePic?: string }>();

async function fetchProfile(
  userId: string,
  token: string,
): Promise<{ name: string; profilePic?: string }> {
  const cached = profileCache.get(userId);
  if (cached) return cached;

  try {
    const res = await fetch(
      `${META_GRAPH}/${userId}?fields=name,profile_pic&access_token=${token}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const data = await res.json();
      const result = { name: data.name || userId, profilePic: data.profile_pic };
      profileCache.set(userId, result);
      return result;
    }
  } catch { /* fallback below */ }

  const fallback = { name: userId };
  profileCache.set(userId, fallback);
  return fallback;
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { businessId, channel } = body as {
    businessId?: string;
    channel?: 'facebook' | 'instagram';
  };

  if (!businessId) {
    return NextResponse.json({ error: 'businessId obrigatório' }, { status: 400 });
  }

  // Auth check
  const authResult = await verifyAuth(req, businessId);
  if (isAuthError(authResult)) return authResult;

  const db = getDb();

  // Get business document with channel credentials
  const bizRef = doc(db, 'businesses', businessId);
  const bizSnap = await getDoc(bizRef);

  if (!bizSnap.exists()) {
    return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 404 });
  }

  const bizData = bizSnap.data();
  const channels = bizData?.channels || {};

  // Determine which channels to sync
  const channelsToSync: Array<'facebook' | 'instagram'> = [];

  if (!channel || channel === 'facebook') {
    if (channels.facebook?.isConnected && channels.facebook?.pageAccessToken) {
      channelsToSync.push('facebook');
    }
  }
  if (!channel || channel === 'instagram') {
    if (channels.instagram?.isConnected && channels.facebook?.pageAccessToken) {
      channelsToSync.push('instagram');
    }
  }

  if (channelsToSync.length === 0) {
    return NextResponse.json(
      { error: 'Nenhum canal conectado para sincronizar' },
      { status: 400 },
    );
  }

  // Decrypt the page token once (Instagram uses same token)
  let pageAccessToken: string;
  try {
    pageAccessToken = await decryptToken(channels.facebook.pageAccessToken);
  } catch (err) {
    console.error('[Sync] Failed to decrypt page token:', err);
    return NextResponse.json({ error: 'Token inválido — reconecte o canal' }, { status: 401 });
  }

  const pageId = channels.facebook?.pageId || '';
  const stats: SyncStats = {
    conversationsSynced: 0,
    messagesImported: 0,
    messagesDuplicate: 0,
    errors: [],
  };

  // Clear profile cache for fresh sync
  profileCache.clear();

  for (const ch of channelsToSync) {
    try {
      await syncChannel(db, businessId, ch, pageId, pageAccessToken, stats);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Sync] Error syncing ${ch}:`, msg);
      stats.errors.push(`${ch}: ${msg}`);
    }
  }

  // Update last sync timestamp
  try {
    await updateDoc(bizRef, { 'channels.lastSyncAt': new Date().toISOString() });
  } catch { /* non-fatal */ }

  return NextResponse.json({
    success: true,
    stats,
    syncedAt: new Date().toISOString(),
  });
}

// ─── Channel sync logic ───────────────────────────────────────────────────────

async function syncChannel(
  db: ReturnType<typeof getFirestore>,
  businessId: string,
  channel: 'facebook' | 'instagram',
  pageId: string,
  token: string,
  stats: SyncStats,
) {
  // Step 1: Fetch recent conversations from Meta
  // For Facebook: /me/conversations
  // For Instagram: /{ig-account-id}/conversations (or /me/conversations with platform filter)
  const endpoint = `${META_GRAPH}/${pageId}/conversations?fields=participants,updated_time,messages.limit(25){message,from,to,created_time}&limit=20&platform=${channel === 'instagram' ? 'instagram' : 'messenger'}`;

  const res = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Graph API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const metaConversations: MetaConversation[] = data?.data || [];

  for (const metaConv of metaConversations) {
    try {
      await syncSingleConversation(db, businessId, channel, pageId, token, metaConv, stats);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Sync] Error syncing conversation ${metaConv.id}:`, msg);
      stats.errors.push(`conv ${metaConv.id}: ${msg}`);
    }
  }
}

async function syncSingleConversation(
  db: ReturnType<typeof getFirestore>,
  businessId: string,
  channel: 'facebook' | 'instagram',
  pageId: string,
  token: string,
  metaConv: MetaConversation,
  stats: SyncStats,
) {
  const messages = metaConv.messages?.data || [];
  if (messages.length === 0) return;

  // Find the external participant (not the page)
  const participants = metaConv.participants?.data || [];
  const externalParticipant = participants.find((p) => p.id !== pageId);

  if (!externalParticipant) return;

  const externalId = externalParticipant.id;
  const fallbackName = channel === 'facebook' ? 'Usuário do Facebook' : 'Usuário do Instagram';

  // Fetch profile
  const profile = await fetchProfile(externalId, token);
  const contactName = profile.name !== externalId ? profile.name : (externalParticipant.name || fallbackName);

  // Find or create our Firestore conversation
  const convQuery = query(
    collection(db, 'conversations'),
    where('businessId', '==', businessId),
    where('channel', '==', channel),
    where('contactExternalId', '==', externalId),
    firestoreLimit(1),
  );

  const convSnap = await getDocs(convQuery);
  let conversationId: string;
  const now = new Date().toISOString();

  // Sort messages oldest first
  const sortedMsgs = [...messages].sort(
    (a, b) => new Date(a.created_time).getTime() - new Date(b.created_time).getTime(),
  );

  const latestMsg = sortedMsgs[sortedMsgs.length - 1];
  const latestIsInbound = latestMsg.from.id !== pageId;

  if (convSnap.empty) {
    // Create new conversation
    const newRef = await addDoc(collection(db, 'conversations'), {
      businessId,
      channel,
      contactName,
      contactExternalId: externalId,
      ...(profile.profilePic ? { contactAvatarUrl: profile.profilePic } : {}),
      status: 'open',
      lastMessage: latestMsg.message || '[Mídia]',
      lastMessageAt: new Date(latestMsg.created_time).toISOString(),
      lastMessageDirection: latestIsInbound ? 'inbound' : 'outbound',
      unreadCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    conversationId = newRef.id;
  } else {
    conversationId = convSnap.docs[0].id;
    const existingData = convSnap.docs[0].data();

    // Soft-delete guard: skip conversations deleted after the latest synced message
    if (existingData.isDeleted) {
      const deletedAt = existingData.deletedAt ? new Date(existingData.deletedAt).getTime() : 0;
      const latestMsgAt = new Date(latestMsg.created_time).getTime();
      if (latestMsgAt <= deletedAt) {
        // All synced messages are older than delete — skip
        return;
      }
      // Newer message exists — resurrect
      console.log('[Sync] Resurrecting soft-deleted conversation:', conversationId);
    }

    // Enrich name/avatar if still numeric ID
    const enrichUpdate: Record<string, unknown> = {
      updatedAt: now,
      // Always clear soft-delete flags during sync (if new msgs exist)
      isDeleted: false,
      deletedAt: null,
    };
    if (contactName !== externalId && (!existingData.contactName || /^\d+$/.test(existingData.contactName))) {
      enrichUpdate.contactName = contactName;
    }
    if (profile.profilePic && !existingData.contactAvatarUrl) {
      enrichUpdate.contactAvatarUrl = profile.profilePic;
    }

    // Update last message if synced one is newer
    const existingLastAt = existingData.lastMessageAt || '';
    const syncedLastAt = new Date(latestMsg.created_time).toISOString();
    if (syncedLastAt > existingLastAt) {
      enrichUpdate.lastMessage = latestMsg.message || '[Mídia]';
      enrichUpdate.lastMessageAt = syncedLastAt;
      enrichUpdate.lastMessageDirection = latestIsInbound ? 'inbound' : 'outbound';
    }

    if (Object.keys(enrichUpdate).length > 1) {
      await updateDoc(doc(db, 'conversations', conversationId), enrichUpdate);
    }
  }

  stats.conversationsSynced++;

  // Import messages with deduplication via externalMessageId (mid)
  for (const msg of sortedMsgs) {
    const mid = msg.id;

    // Check if message already exists
    const dupQuery = query(
      collection(db, 'conversationMessages'),
      where('externalMessageId', '==', mid),
      where('businessId', '==', businessId),
      firestoreLimit(1),
    );
    const dupSnap = await getDocs(dupQuery);

    if (!dupSnap.empty) {
      stats.messagesDuplicate++;
      continue;
    }

    const isOutbound = msg.from.id === pageId;

    await addDoc(collection(db, 'conversationMessages'), {
      conversationId,
      businessId,
      channel,
      direction: isOutbound ? 'outbound' : 'inbound',
      content: msg.message || '',
      status: 'read', // Historical messages are already read
      externalMessageId: mid,
      senderName: isOutbound ? 'Atendente' : contactName,
      sentAt: new Date(msg.created_time).toISOString(),
      createdAt: now,
    });

    stats.messagesImported++;
  }
}
