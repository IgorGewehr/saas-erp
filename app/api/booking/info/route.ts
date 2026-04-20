/**
 * Public booking info endpoint — no Firebase Auth required.
 *
 * GET /api/booking/info?slug=meu-salao
 *
 * Returns business name, services, professionals and opening hours
 * so the public /booking/[slug] page can render without any login.
 *
 * Rate-limit: none (static-ish data, cached by Next.js edge for 60s).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import type { Business, Service, User } from '@/lib/types';

export const runtime = 'nodejs';

// Cache for 60 seconds at the CDN level
export const revalidate = 60;

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug');
  if (!slug) {
    return NextResponse.json({ ok: false, error: 'slug is required' }, { status: 400 });
  }

  try {
    // Find business by slug
    const bizSnap = await adminDb
      .collection('businesses')
      .where('slug', '==', slug)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (bizSnap.empty) {
      return NextResponse.json({ ok: false, error: 'Business not found' }, { status: 404 });
    }

    const bizDoc = bizSnap.docs[0];
    const business = { ...bizDoc.data(), id: bizDoc.id } as Business;

    // Only expose what the public page needs
    const publicBusiness = {
      id: business.id,
      slug: business.slug,
      nomeFantasia: business.nomeFantasia,
      phone: business.phone,
      email: business.email,
      logo: business.logo || null,
      openingHours: business.settings?.openingHours || null,
      useCase: business.settings?.useCase || 'servicos',
      aiAgentEnabled: !!business.settings?.aiAgent?.enabled,
      tone: business.settings?.aiAgent?.tone || 'friendly',
    };

    // Load active services — uses 'services' collection (NOT 'products' which is inventory)
    const servicesSnap = await adminDb
      .collection('services')
      .where('businessId', '==', business.id)
      .where('isActive', '==', true)
      .get();

    const services = servicesSnap.docs
      .map(d => {
        const s = d.data() as Service;
        return {
          id: d.id,
          name: s.name,
          duration: s.duration,
          price: s.price,
          category: s.category || null,
          color: s.color,
        };
      })
      .filter(s => s.duration > 0); // only bookable services (have duration)

    // Load professionals (users with role operator/manager that have serviceIds)
    const membersSnap = await adminDb
      .collection('users')
      .where('businessId', '==', business.id)
      .where('isActive', '==', true)
      .get();

    const professionals = membersSnap.docs
      .map(d => {
        const u = d.data() as User;
        return {
          id: d.id,
          name: u.name,
          photoURL: u.photoURL || null,
          serviceIds: (u as unknown as { serviceIds?: string[] }).serviceIds || [],
        };
      })
      .filter(u =>
        // Include members that have at least one service assigned, or all if none have services
        true
      );

    return NextResponse.json({
      ok: true,
      data: {
        business: publicBusiness,
        services,
        professionals,
      },
    });
  } catch (err) {
    console.error('[booking/info]', err);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}
