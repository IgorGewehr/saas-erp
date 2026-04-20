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

    // Fetch data in parallel
    const [balanceRes, subsRes, chargesRes, disputesRes] = await Promise.all([
      fetch('https://api.stripe.com/v1/balance', { headers }),
      fetch('https://api.stripe.com/v1/subscriptions?limit=100&status=all', { headers }),
      fetch('https://api.stripe.com/v1/charges?limit=10', { headers }),
      fetch('https://api.stripe.com/v1/disputes?limit=10', { headers }),
    ]);

    if (!balanceRes.ok) {
      const err = await balanceRes.json();
      return NextResponse.json({ error: err.error?.message || 'Stripe API error' }, { status: balanceRes.status });
    }

    const [balance, subs, charges, disputes] = await Promise.all([
      balanceRes.json(),
      subsRes.json(),
      chargesRes.json(),
      disputesRes.json(),
    ]);

    // Calculate MRR from active subscriptions
    const activeSubs = subs.data?.filter((s: any) => s.status === 'active') || [];
    const trialingSubs = subs.data?.filter((s: any) => s.status === 'trialing') || [];
    const pastDueSubs = subs.data?.filter((s: any) => s.status === 'past_due') || [];
    const canceledSubs = subs.data?.filter((s: any) => s.status === 'canceled') || [];

    const mrr = activeSubs.reduce((sum: number, s: any) => {
      const amount = s.items?.data?.[0]?.price?.unit_amount || 0;
      const quantity = s.items?.data?.[0]?.quantity || 1;
      const interval = s.items?.data?.[0]?.price?.recurring?.interval || 'month';
      const multiplier = interval === 'year' ? 1/12 : interval === 'week' ? 4.33 : 1;
      return sum + (amount * quantity * multiplier) / 100;
    }, 0);

    // Calculate revenue
    const successfulCharges = charges.data?.filter((c: any) => c.status === 'paid' || c.status === 'succeeded') || [];
    const thisMonthRevenue = successfulCharges.reduce((sum: number, c: any) => sum + (c.amount || 0), 0);

    return NextResponse.json({
      balance: {
        available: (balance.available?.[0]?.amount || 0) / 100,
        pending: (balance.pending?.[0]?.amount || 0) / 100,
      },
      subscriptions: {
        active: activeSubs.length,
        trialing: trialingSubs.length,
        pastDue: pastDueSubs.length,
        canceled: canceledSubs.length,
      },
      mrr,
      mrrGrowth: 0, // Would need historical data to calculate
      revenue: {
        total: 0,
        thisMonth: thisMonthRevenue,
        lastMonth: 0,
      },
      disputes: {
        open: disputes.data?.filter((d: any) => d.status === 'needs_response' || d.status === 'warning_needs_response').length || 0,
        amount: disputes.data?.reduce((sum: number, d: any) => sum + (d.amount || 0), 0) / 100 || 0,
        rate: charges.data?.length > 0 ? ((disputes.data?.length || 0) / charges.data.length * 100).toFixed(1) : 0,
      },
      recentCharges: charges.data?.slice(0, 5).map((c: any) => ({
        id: c.id,
        amount: c.amount,
        status: c.refunded ? 'refunded' : c.status,
        customer: c.billing_details?.email || c.receipt_email || 'N/A',
        created: c.created,
      })) || [],
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
