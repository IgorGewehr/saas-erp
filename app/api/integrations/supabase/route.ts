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

    // Fetch projects
    const projectsRes = await fetch('https://api.supabase.com/v1/projects', { headers });

    if (!projectsRes.ok) {
      const err = await projectsRes.json();
      return NextResponse.json({ error: err.message || 'Supabase API error' }, { status: projectsRes.status });
    }

    const projectsData = await projectsRes.json();

    const projects = (projectsData || []).map((p: any) => ({
      id: p.id || '',
      name: p.name || '',
      region: p.region || '',
      status: p.status || '',
      createdAt: p.created_at || '',
    }));

    // Fetch health for first 3 projects in parallel
    const projectsToCheck = projects.slice(0, 3);
    const healthPromises = projectsToCheck.map(async (project: any) => {
      try {
        const healthRes = await fetch(
          `https://api.supabase.com/v1/projects/${project.id}/health`,
          { headers }
        );

        if (!healthRes.ok) {
          return {
            projectId: project.id,
            projectName: project.name,
            isHealthy: false,
          };
        }

        const healthData = await healthRes.json();
        // Supabase health endpoint returns service statuses
        const allHealthy = Array.isArray(healthData)
          ? healthData.every((s: any) => s.status === 'ACTIVE_HEALTHY')
          : true;

        return {
          projectId: project.id,
          projectName: project.name,
          isHealthy: allHealthy,
        };
      } catch {
        return {
          projectId: project.id,
          projectName: project.name,
          isHealthy: false,
        };
      }
    });

    const health = await Promise.all(healthPromises);
    const healthyProjects = health.filter((h: any) => h.isHealthy).length;

    // Collect unique regions
    const regions = [...new Set(projects.map((p: any) => p.region).filter(Boolean))];

    return NextResponse.json({
      projects,
      health,
      summary: {
        totalProjects: projects.length,
        healthyProjects,
        regions,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
