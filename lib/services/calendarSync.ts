/**
 * Client-side Google Calendar sync helper.
 * Fire-and-forget — errors are logged but never block the appointment flow.
 */

import { getAuth } from 'firebase/auth';

interface SyncAppointment {
  id: string;
  title: string;
  description?: string;
  date: string;
  startTime: string;
  endTime: string;
  googleCalendarEventId?: string;
}

async function getToken(): Promise<string | null> {
  const user = getAuth().currentUser;
  if (!user) return null;
  return user.getIdToken();
}

async function callSync(action: 'create' | 'update' | 'delete', appointment: SyncAppointment): Promise<string | null> {
  const token = await getToken();
  if (!token) return null;

  try {
    const res = await fetch('/api/integrations/google-calendar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action, appointment }),
    });

    if (!res.ok) {
      // 401 = not connected — silently ignore
      if (res.status === 401) return null;
      console.warn(`[GCal] ${action} failed:`, res.status);
      return null;
    }

    const data = await res.json();
    return data.eventId || null;
  } catch (err) {
    console.warn('[GCal] sync error:', err);
    return null;
  }
}

/**
 * Create a Google Calendar event for an appointment.
 * Returns the GCal event ID (or null if not connected).
 */
export function syncToGoogleCalendar(
  action: 'create' | 'update' | 'delete',
  appointment: SyncAppointment,
): Promise<string | null> {
  return callSync(action, appointment);
}
