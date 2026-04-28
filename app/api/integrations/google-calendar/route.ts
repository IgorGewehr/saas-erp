/**
 * POST /api/integrations/google-calendar
 *
 * Sync appointments to Google Calendar.
 * Actions: create, update, delete
 *
 * Requires Firebase Auth token (Bearer).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { decryptToken, encryptToken } from '@/lib/utils/encryption';

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

type Action = 'create' | 'update' | 'delete';

interface SyncRequest {
  action: Action;
  appointment: {
    id: string;
    title: string;
    description?: string;
    date: string;        // YYYY-MM-DD
    startTime: string;   // HH:mm
    endTime: string;     // HH:mm
    googleCalendarEventId?: string;
  };
}

/**
 * Get a valid access token, refreshing if expired.
 */
async function getValidAccessToken(uid: string): Promise<string | null> {
  const docRef = adminDb.collection('calendarSyncTokens').doc(uid);
  const snap = await docRef.get();
  if (!snap.exists) return null;

  const data = snap.data()!;
  if (!data.isActive) return null;

  const expiresAt = new Date(data.expiresAt).getTime();
  const now = Date.now();

  // If token is still valid (with 5 min buffer), decrypt and return
  if (expiresAt - now > 5 * 60 * 1000) {
    return decryptToken(data.accessToken);
  }

  // Token expired — refresh it
  if (!data.refreshToken) return null;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const refreshToken = await decryptToken(data.refreshToken);

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    console.error('[GCal] Token refresh failed:', await res.text());
    // Mark as inactive
    await docRef.update({ isActive: false });
    return null;
  }

  const tokens = await res.json();
  const newExpiresAt = new Date(now + (tokens.expires_in || 3600) * 1000).toISOString();

  await docRef.update({
    accessToken: await encryptToken(tokens.access_token),
    expiresAt: newExpiresAt,
  });

  return tokens.access_token;
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (isAuthError(auth)) return auth;

  let body: SyncRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { action, appointment } = body;
  if (!action || !appointment) {
    return NextResponse.json({ error: 'action and appointment required' }, { status: 400 });
  }

  const accessToken = await getValidAccessToken(auth.uid);
  if (!accessToken) {
    return NextResponse.json({ error: 'Google Calendar not connected or token expired' }, { status: 401 });
  }

  const calendarId = 'primary';
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  // Build event body for Google Calendar
  const startDateTime = `${appointment.date}T${appointment.startTime}:00`;
  const endDateTime = `${appointment.date}T${appointment.endTime}:00`;

  const eventBody = {
    summary: appointment.title,
    description: appointment.description || '',
    start: { dateTime: startDateTime, timeZone: 'America/Sao_Paulo' },
    end: { dateTime: endDateTime, timeZone: 'America/Sao_Paulo' },
    source: { title: 'Aevo', url: process.env.NEXT_PUBLIC_APP_URL || '' },
  };

  try {
    switch (action) {
      case 'create': {
        const res = await fetch(
          `${GOOGLE_CALENDAR_API}/calendars/${calendarId}/events`,
          { method: 'POST', headers, body: JSON.stringify(eventBody) },
        );
        if (!res.ok) {
          const err = await res.text();
          console.error('[GCal] Create event failed:', err);
          return NextResponse.json({ error: 'Failed to create event' }, { status: 502 });
        }
        const event = await res.json();
        return NextResponse.json({ ok: true, eventId: event.id });
      }

      case 'update': {
        if (!appointment.googleCalendarEventId) {
          return NextResponse.json({ error: 'googleCalendarEventId required for update' }, { status: 400 });
        }
        const res = await fetch(
          `${GOOGLE_CALENDAR_API}/calendars/${calendarId}/events/${appointment.googleCalendarEventId}`,
          { method: 'PUT', headers, body: JSON.stringify(eventBody) },
        );
        if (!res.ok) {
          const err = await res.text();
          console.error('[GCal] Update event failed:', err);
          return NextResponse.json({ error: 'Failed to update event' }, { status: 502 });
        }
        const event = await res.json();
        return NextResponse.json({ ok: true, eventId: event.id });
      }

      case 'delete': {
        if (!appointment.googleCalendarEventId) {
          return NextResponse.json({ ok: true }); // nothing to delete
        }
        const res = await fetch(
          `${GOOGLE_CALENDAR_API}/calendars/${calendarId}/events/${appointment.googleCalendarEventId}`,
          { method: 'DELETE', headers },
        );
        if (!res.ok && res.status !== 404 && res.status !== 410) {
          const err = await res.text();
          console.error('[GCal] Delete event failed:', err);
          return NextResponse.json({ error: 'Failed to delete event' }, { status: 502 });
        }
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[GCal] Sync error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * GET /api/integrations/google-calendar
 *
 * Check if the current user has Google Calendar connected.
 */
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (isAuthError(auth)) return auth;

  const snap = await adminDb.collection('calendarSyncTokens').doc(auth.uid).get();
  if (!snap.exists) {
    return NextResponse.json({ connected: false });
  }

  const data = snap.data()!;
  return NextResponse.json({
    connected: data.isActive,
    connectedAt: data.connectedAt,
    lastSyncAt: data.lastSyncAt,
    calendarId: data.calendarId,
  });
}

/**
 * DELETE /api/integrations/google-calendar
 *
 * Disconnect Google Calendar for the current user.
 */
export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (isAuthError(auth)) return auth;

  const docRef = adminDb.collection('calendarSyncTokens').doc(auth.uid);
  await docRef.delete();

  return NextResponse.json({ ok: true, disconnected: true });
}
