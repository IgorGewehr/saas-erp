import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) {
    return NextResponse.json({ error: 'API key required' }, { status: 401 });
  }

  try {
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    // Fetch zones
    const zonesRes = await fetch('https://api.cloudflare.com/client/v4/zones?per_page=50', { headers });

    if (!zonesRes.ok) {
      const err = await zonesRes.json();
      return NextResponse.json({ error: err.errors?.[0]?.message || 'Cloudflare API error' }, { status: zonesRes.status });
    }

    const zonesData = await zonesRes.json();
    const allZones = (zonesData.result || []).map((z: any) => ({
      id: z.id || '',
      name: z.name || '',
      status: z.status || '',
      plan: z.plan?.name || '',
    }));

    // Fetch analytics for first 3 zones via GraphQL
    const zonesToQuery = allZones.slice(0, 3);
    const now = new Date();
    const end = now.toISOString().split('T')[0];
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    let totalRequests = 0;
    let cachedRequests = 0;
    let bandwidth = 0;
    let threats = 0;
    let uniques = 0;
    let pageViews = 0;
    const dailyStats: { date: string; requests: number; cached: number; threats: number }[] = [];
    const dailyMap = new Map<string, { requests: number; cached: number; threats: number }>();

    const analyticsPromises = zonesToQuery.map(async (zone: any) => {
      const query = `query {
        viewer {
          zones(filter: {zoneTag: "${zone.id}"}) {
            httpRequests1dGroups(limit: 30, filter: {date_geq: "${start}", date_leq: "${end}"}) {
              dimensions { date }
              sum { requests cachedRequests bytes cachedBytes threats pageViews }
              uniq { uniques }
            }
          }
        }
      }`;

      const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
        method: 'POST',
        headers,
        body: JSON.stringify({ query }),
      });

      if (!res.ok) return null;
      return res.json();
    });

    const analyticsResults = await Promise.all(analyticsPromises);

    for (const result of analyticsResults) {
      if (!result?.data?.viewer?.zones?.[0]) continue;
      const groups = result.data.viewer.zones[0].httpRequests1dGroups || [];

      for (const day of groups) {
        const sum = day.sum || {};
        const uniq = day.uniq || {};
        const date = day.dimensions?.date || '';

        totalRequests += sum.requests || 0;
        cachedRequests += sum.cachedRequests || 0;
        bandwidth += sum.bytes || 0;
        threats += sum.threats || 0;
        uniques += uniq.uniques || 0;
        pageViews += sum.pageViews || 0;

        const existing = dailyMap.get(date) || { requests: 0, cached: 0, threats: 0 };
        existing.requests += sum.requests || 0;
        existing.cached += sum.cachedRequests || 0;
        existing.threats += sum.threats || 0;
        dailyMap.set(date, existing);
      }
    }

    // Sort daily stats by date
    for (const [date, stats] of dailyMap.entries()) {
      dailyStats.push({ date, ...stats });
    }
    dailyStats.sort((a, b) => a.date.localeCompare(b.date));

    const cacheHitRate = totalRequests > 0
      ? Math.round((cachedRequests / totalRequests) * 10000) / 100
      : 0;

    const activeZones = allZones.filter((z: any) => z.status === 'active').length;

    return NextResponse.json({
      zones: allZones,
      analytics: {
        totalRequests,
        cachedRequests,
        cacheHitRate,
        bandwidth,
        threats,
        uniques,
        pageViews,
      },
      dailyStats,
      summary: {
        totalZones: allZones.length,
        activeZones,
        totalRequests30d: totalRequests,
        cacheHitRate,
        threatsBlocked: threats,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
