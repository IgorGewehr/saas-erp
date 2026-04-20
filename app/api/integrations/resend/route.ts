import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (isAuthError(auth)) return auth;

  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) {
    return NextResponse.json({ error: 'API key required' }, { status: 401 });
  }

  try {
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    const [emailsRes, domainsRes] = await Promise.all([
      fetch('https://api.resend.com/emails', { headers }),
      fetch('https://api.resend.com/domains', { headers }),
    ]);

    if (!emailsRes.ok) {
      const err = await emailsRes.json();
      return NextResponse.json({ error: err.message || 'Resend API error' }, { status: emailsRes.status });
    }

    const [emails, domains] = await Promise.all([
      emailsRes.json(),
      domainsRes.ok ? domainsRes.json() : { data: [] },
    ]);

    const emailList = emails.data || [];
    const delivered = emailList.filter((e: any) => e.last_event === 'delivered').length;
    const bounced = emailList.filter((e: any) => e.last_event === 'bounced').length;
    const complained = emailList.filter((e: any) => e.last_event === 'complained').length;

    return NextResponse.json({
      emailsSent: emailList.length,
      delivered,
      bounced,
      complained,
      deliveryRate: emailList.length > 0 ? Number(((delivered / emailList.length) * 100).toFixed(1)) : 100,
      domains: (domains.data || []).map((d: any) => ({
        name: d.name,
        status: d.status,
        records: d.records?.length || 0,
      })),
      recentEmails: emailList.slice(0, 5).map((e: any) => ({
        id: e.id,
        to: Array.isArray(e.to) ? e.to[0] : e.to,
        subject: e.subject || 'Sem assunto',
        status: e.last_event || 'sent',
        sentAt: new Date(e.created_at).getTime(),
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
