import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (isAuthError(auth)) return auth;

  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) {
    return NextResponse.json({ error: 'API key required' }, { status: 401 });
  }

  const apiSecret = request.headers.get('x-api-secret');
  if (!apiSecret) {
    return NextResponse.json({ error: 'API secret required (x-api-secret header)' }, { status: 400 });
  }

  try {
    const headers = {
      'Authorization': `sso-key ${apiKey}:${apiSecret}`,
      'Content-Type': 'application/json',
    };

    // Fetch domains
    const domainsRes = await fetch('https://api.godaddy.com/v1/domains?limit=100', { headers });

    if (!domainsRes.ok) {
      const err = await domainsRes.json();
      return NextResponse.json({ error: err.message || 'GoDaddy API error' }, { status: domainsRes.status });
    }

    const domainsData = await domainsRes.json();

    const now = new Date();
    const in30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const in90d = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    const domains = (domainsData || []).map((d: any) => ({
      domain: d.domain || '',
      status: d.status || '',
      expires: d.expires || '',
      renewAuto: d.renewAuto ?? false,
      locked: d.locked ?? false,
      privacy: d.privacy ?? false,
      createdAt: d.createdAt || '',
    }));

    const activeDomains = domains.filter((d: any) => d.status === 'ACTIVE').length;
    const autoRenewEnabled = domains.filter((d: any) => d.renewAuto).length;

    const expiringIn30d = domains.filter((d: any) => {
      if (!d.expires) return false;
      const exp = new Date(d.expires);
      return exp >= now && exp <= in30d;
    }).length;

    const expiringIn90d = domains.filter((d: any) => {
      if (!d.expires) return false;
      const exp = new Date(d.expires);
      return exp >= now && exp <= in90d;
    }).length;

    return NextResponse.json({
      domains,
      summary: {
        totalDomains: domains.length,
        activeDomains,
        expiringIn30d,
        expiringIn90d,
        autoRenewEnabled,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
