import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { getIntegrationKeys } from '@/lib/utils/integrationKeys';

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (isAuthError(auth)) return auth;

  const keys = await getIntegrationKeys(auth.businessId, 'sentry');
  const apiKey = keys?.apiKey || request.headers.get('x-api-key');
  if (!apiKey) {
    return NextResponse.json({ error: 'Sentry integration not configured' }, { status: 400 });
  }

  const orgSlug = (keys?.metadata?.org as string) || request.headers.get('x-org-slug');
  if (!orgSlug) {
    return NextResponse.json({ error: 'Sentry organization slug not configured' }, { status: 400 });
  }

  try {
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    const baseUrl = `https://sentry.io/api/0/organizations/${orgSlug}`;

    // Fetch data in parallel
    const [projectsRes, issuesRes, statsRes] = await Promise.all([
      fetch(`${baseUrl}/projects/`, { headers }),
      fetch(`${baseUrl}/issues/?statsPeriod=24h&limit=10&sort=freq`, { headers }),
      fetch(`${baseUrl}/stats_v2/?field=sum(quantity)&groupBy=category&groupBy=outcome&statsPeriod=30d`, { headers }),
    ]);

    if (!projectsRes.ok) {
      const err = await projectsRes.json();
      return NextResponse.json({ error: err.detail || 'Sentry API error' }, { status: projectsRes.status });
    }

    const [projectsData, issuesData, statsData] = await Promise.all([
      projectsRes.json(),
      issuesRes.json(),
      statsRes.json(),
    ]);

    // Parse projects
    const projects = (projectsData || []).map((p: any) => ({
      slug: p.slug || '',
      name: p.name || '',
      platform: p.platform || '',
      dateCreated: p.dateCreated || '',
      hasAccess: p.hasAccess ?? true,
    }));

    // Parse issues
    const issues = (issuesData || []).map((i: any) => ({
      id: i.id || '',
      title: i.title || '',
      culprit: i.culprit || '',
      count: parseInt(i.count || '0', 10),
      userCount: i.userCount || 0,
      level: i.level || '',
      firstSeen: i.firstSeen || '',
      lastSeen: i.lastSeen || '',
    }));

    // Parse stats — aggregate by outcome
    let eventsAccepted = 0;
    let eventsFiltered = 0;
    let eventsRateLimited = 0;

    const groups = statsData?.groups || [];
    for (const group of groups) {
      const outcome = group.by?.outcome;
      const totals = group.totals?.['sum(quantity)'] || 0;

      if (outcome === 'accepted') eventsAccepted += totals;
      else if (outcome === 'filtered') eventsFiltered += totals;
      else if (outcome === 'rate_limited') eventsRateLimited += totals;
    }

    return NextResponse.json({
      projects,
      issues,
      stats: {
        eventsAccepted,
        eventsFiltered,
        eventsRateLimited,
      },
      summary: {
        totalProjects: projects.length,
        unresolvedIssues: issues.length,
        eventsToday: eventsAccepted,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
