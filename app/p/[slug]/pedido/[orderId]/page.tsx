import { adminDb } from '@/lib/config/firebaseAdmin';
import TrackOrderClient from './TrackOrderClient';
import type { Business } from '@/lib/types';

/**
 * app/p/[slug]/pedido/[orderId]/page.tsx
 *
 * Página pública de ACOMPANHAMENTO de um pedido (cliente ANÔNIMO). É o link que
 * o cliente abre na tela de sucesso do checkout e pode reabrir depois.
 *
 * Toda a leitura de dados acontece no client via polling de
 * GET /api/orders/[id]/status?token= (projeção mínima + capability URL). Este
 * server component só resolve o branding (nome/logo) pelo slug — best-effort,
 * nunca bloqueia: se o business não resolver, o tracking ainda funciona.
 */

export const dynamic = 'force-dynamic';

async function resolveBusinessBranding(
  slug: string,
): Promise<{ name?: string; logo?: string }> {
  try {
    const slugSnap = await adminDb
      .collection('businesses')
      .where('slug', '==', slug)
      .limit(1)
      .get();
    const doc = slugSnap.empty
      ? await adminDb.collection('businesses').doc(slug).get()
      : slugSnap.docs[0];
    if (!doc.exists) return {};
    const b = doc.data() as Business;
    return { name: b.nomeFantasia || b.razaoSocial, logo: b.logo };
  } catch {
    return {};
  }
}

export default async function OrderTrackingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; orderId: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const [{ slug, orderId }, { t }] = await Promise.all([params, searchParams]);
  const branding = await resolveBusinessBranding(slug);

  return (
    <TrackOrderClient
      orderId={orderId}
      token={t ?? ''}
      businessName={branding.name}
      businessLogo={branding.logo}
    />
  );
}
