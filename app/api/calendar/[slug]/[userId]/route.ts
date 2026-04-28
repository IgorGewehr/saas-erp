/**
 * GET /api/calendar/[slug]/[userId]
 *
 * Public iCalendar (.ics) feed for a professional's appointments.
 * Designed for Apple Calendar / Outlook / any CalDAV-compatible client.
 *
 * - No authentication required (subscribe via URL)
 * - Read-only — changes in Aevo auto-reflect on next poll (~15-60 min in most clients)
 * - Only includes future and recent (last 7 days) appointments
 * - Only includes appointments assigned to this professional
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';

function escapeICS(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function formatICSDate(date: string, time: string): string {
  // date: YYYY-MM-DD, time: HH:mm → 20260423T103000
  return date.replace(/-/g, '') + 'T' + time.replace(':', '') + '00';
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; userId: string }> },
) {
  const { slug, userId } = await params;

  if (!slug || !userId) {
    return new NextResponse('Not found', { status: 404 });
  }

  // Resolve business by slug
  const bizSnap = await adminDb.collection('businesses')
    .where('slug', '==', slug)
    .limit(1)
    .get();

  if (bizSnap.empty) {
    return new NextResponse('Business not found', { status: 404 });
  }

  const business = bizSnap.docs[0];
  const businessId = business.id;
  const businessName = business.data().nomeFantasia || business.data().razaoSocial || 'Aevo';

  // Verify user belongs to this business
  const userDoc = await adminDb.collection('users').doc(userId).get();
  if (!userDoc.exists || userDoc.data()?.businessId !== businessId) {
    return new NextResponse('User not found', { status: 404 });
  }
  const userName = userDoc.data()?.name || 'Profissional';

  // Fetch appointments for this professional (last 7 days + future)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const apptSnap = await adminDb.collection('appointments')
    .where('businessId', '==', businessId)
    .where('professionalId', '==', userId)
    .where('date', '>=', sevenDaysAgo)
    .get();

  // Build .ics content
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Aevo//${escapeICS(businessName)}//PT`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICS(userName)} — ${escapeICS(businessName)}`,
    'X-WR-TIMEZONE:America/Sao_Paulo',
  ];

  for (const doc of apptSnap.docs) {
    const a = doc.data();
    if (a.status === 'cancelado') continue;

    const dtStart = formatICSDate(a.date, a.startTime);
    const dtEnd = formatICSDate(a.date, a.endTime);
    const summary = a.serviceName
      ? `${a.serviceName} — ${a.clientName || 'Cliente'}`
      : `Agendamento — ${a.clientName || 'Cliente'}`;

    const descParts: string[] = [];
    if (a.clientName) descParts.push(`Cliente: ${a.clientName}`);
    if (a.clientPhone) descParts.push(`Tel: ${a.clientPhone}`);
    if (a.notes) descParts.push(a.notes);

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${doc.id}@aevo`);
    lines.push(`DTSTART;TZID=America/Sao_Paulo:${dtStart}`);
    lines.push(`DTEND;TZID=America/Sao_Paulo:${dtEnd}`);
    lines.push(`SUMMARY:${escapeICS(summary)}`);
    if (descParts.length > 0) {
      lines.push(`DESCRIPTION:${escapeICS(descParts.join('\\n'))}`);
    }
    lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
    if (a.updatedAt) {
      lines.push(`LAST-MODIFIED:${new Date(a.updatedAt).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
    }
    lines.push(`STATUS:${a.status === 'confirmado' ? 'CONFIRMED' : 'TENTATIVE'}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  const icsContent = lines.join('\r\n');

  return new NextResponse(icsContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${slug}-${userId}.ics"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
