import { NextRequest, NextResponse } from 'next/server';
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostForecastCommand,
} from '@aws-sdk/client-cost-explorer';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (isAuthError(auth)) return auth;

  const accessKeyId = request.headers.get('x-api-key');
  if (!accessKeyId) {
    return NextResponse.json({ error: 'API key required' }, { status: 401 });
  }

  const secretAccessKey = request.headers.get('x-secret-key');
  if (!secretAccessKey) {
    return NextResponse.json({ error: 'Secret access key required (x-secret-key header)' }, { status: 400 });
  }

  try {
    const client = new CostExplorerClient({
      region: 'us-east-1',
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const now = new Date();
    const currentMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const currentMonthEnd = now.toISOString().split('T')[0];

    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousMonthStart = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-01`;
    const previousMonthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    // Forecast end: 3 months from now
    const forecastEnd = new Date(now.getFullYear(), now.getMonth() + 4, 1);
    const forecastEndStr = `${forecastEnd.getFullYear()}-${String(forecastEnd.getMonth() + 1).padStart(2, '0')}-01`;

    // Fetch current month costs by service
    const currentMonthCmd = new GetCostAndUsageCommand({
      TimePeriod: { Start: currentMonthStart, End: currentMonthEnd },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
    });

    // Fetch previous month costs by service
    const previousMonthCmd = new GetCostAndUsageCommand({
      TimePeriod: { Start: previousMonthStart, End: previousMonthEnd },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
    });

    // Fetch daily costs for current month
    const dailyCostsCmd = new GetCostAndUsageCommand({
      TimePeriod: { Start: currentMonthStart, End: currentMonthEnd },
      Granularity: 'DAILY',
      Metrics: ['UnblendedCost'],
    });

    const [currentMonthData, previousMonthData, dailyCostsData] = await Promise.all([
      client.send(currentMonthCmd),
      client.send(previousMonthCmd),
      client.send(dailyCostsCmd),
    ]);

    // Fetch forecast (separate because it can fail if no historical data)
    let forecastData: any = null;
    try {
      const forecastCmd = new GetCostForecastCommand({
        TimePeriod: { Start: currentMonthEnd, End: forecastEndStr },
        Metric: 'UNBLENDED_COST',
        Granularity: 'MONTHLY',
      });
      forecastData = await client.send(forecastCmd);
    } catch {
      // Forecast may fail if insufficient historical data
    }

    // Parse current month
    const currentByService = (currentMonthData.ResultsByTime?.[0]?.Groups || []).map((g: any) => ({
      service: g.Keys?.[0] || '',
      amount: parseFloat(g.Metrics?.UnblendedCost?.Amount || '0'),
    })).sort((a: any, b: any) => b.amount - a.amount);

    const currentTotal = currentByService.reduce((sum: number, s: any) => sum + s.amount, 0);

    // Parse previous month
    const previousByService = (previousMonthData.ResultsByTime?.[0]?.Groups || []).map((g: any) => ({
      service: g.Keys?.[0] || '',
      amount: parseFloat(g.Metrics?.UnblendedCost?.Amount || '0'),
    })).sort((a: any, b: any) => b.amount - a.amount);

    const previousTotal = previousByService.reduce((sum: number, s: any) => sum + s.amount, 0);

    // Parse daily costs
    const dailyCosts = (dailyCostsData.ResultsByTime || []).map((d: any) => ({
      date: d.TimePeriod?.Start || '',
      amount: parseFloat(d.Total?.UnblendedCost?.Amount || '0'),
    }));

    // Parse forecast
    const forecastMonths = (forecastData?.ForecastResultsByTime || []).map((f: any) => ({
      start: f.TimePeriod?.Start || '',
      end: f.TimePeriod?.End || '',
      amount: parseFloat(f.MeanValue || '0'),
    }));

    const forecastTotal = forecastMonths.reduce((sum: number, f: any) => sum + f.amount, 0);

    // Calculate change percent
    const changePercent = previousTotal > 0
      ? Math.round(((currentTotal - previousTotal) / previousTotal) * 10000) / 100
      : 0;

    const topService = currentByService.length > 0 ? currentByService[0].service : '';

    return NextResponse.json({
      currentMonth: {
        total: Math.round(currentTotal * 100) / 100,
        byService: currentByService.map((s: any) => ({
          service: s.service,
          amount: Math.round(s.amount * 100) / 100,
        })),
      },
      previousMonth: {
        total: Math.round(previousTotal * 100) / 100,
        byService: previousByService.map((s: any) => ({
          service: s.service,
          amount: Math.round(s.amount * 100) / 100,
        })),
      },
      forecast: {
        total: Math.round(forecastTotal * 100) / 100,
        months: forecastMonths.map((f: any) => ({
          start: f.start,
          end: f.end,
          amount: Math.round(f.amount * 100) / 100,
        })),
      },
      dailyCosts,
      summary: {
        currentTotal: Math.round(currentTotal * 100) / 100,
        previousTotal: Math.round(previousTotal * 100) / 100,
        changePercent,
        forecastTotal: Math.round(forecastTotal * 100) / 100,
        topService,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
