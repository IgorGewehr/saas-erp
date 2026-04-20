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

    const [projectsRes, deploysRes] = await Promise.all([
      fetch('https://api.vercel.com/v9/projects?limit=50', { headers }),
      fetch('https://api.vercel.com/v6/deployments?limit=20', { headers }),
    ]);

    if (!projectsRes.ok) {
      const err = await projectsRes.json();
      return NextResponse.json({ error: err.error?.message || 'Vercel API error' }, { status: projectsRes.status });
    }

    const [projects, deploys] = await Promise.all([
      projectsRes.json(),
      deploysRes.ok ? deploysRes.json() : { deployments: [] },
    ]);

    const deployments = deploys.deployments || [];
    const successDeploys = deployments.filter((d: any) => d.readyState === 'READY');
    const failedDeploys = deployments.filter((d: any) => d.readyState === 'ERROR');

    // Count unique domains
    const domains = new Set<string>();
    for (const p of projects.projects || []) {
      if (p.alias) p.alias.forEach((a: any) => domains.add(typeof a === 'string' ? a : a.domain));
    }

    return NextResponse.json({
      projects: projects.projects?.length || 0,
      deployments: {
        total: deployments.length,
        success: successDeploys.length,
        failed: failedDeploys.length,
        successRate: deployments.length > 0 ? Number(((successDeploys.length / deployments.length) * 100).toFixed(1)) : 100,
      },
      domains: domains.size,
      recentDeploys: deployments.slice(0, 5).map((d: any) => ({
        id: d.uid,
        project: d.name,
        status: d.readyState,
        branch: d.meta?.githubCommitRef || d.meta?.gitlabCommitRef || 'main',
        createdAt: d.created,
        buildTime: d.ready ? Math.round((d.ready - d.created) / 1000) : 0,
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
