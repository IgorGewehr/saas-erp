import { adminDb } from '@/lib/config/firebaseAdmin';
import { notFound } from 'next/navigation';
import CatalogClient, { type PublicBusiness } from './CatalogClient';
import type { Business, Product, MenuCategory } from '@/lib/types';

export const revalidate = 60;

async function resolveBusiness(slug: string): Promise<Business | null> {
  try {
    // 1. Try slug field lookup
    const slugSnap = await adminDb
      .collection('businesses')
      .where('slug', '==', slug)
      .limit(1)
      .get();
    if (!slugSnap.empty) {
      return { ...slugSnap.docs[0].data(), id: slugSnap.docs[0].id } as Business;
    }

    // 2. Fallback: direct document ID
    const idSnap = await adminDb.collection('businesses').doc(slug).get();
    if (idSnap.exists) {
      return { ...idSnap.data(), id: idSnap.id } as Business;
    }
  } catch (err) {
    console.error('[PublicMenu] resolveBusiness error:', err);
  }
  return null;
}

export default async function PublicMenuPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let business: Business | null = null;
  let products: Product[] = [];
  let categories: MenuCategory[] = [];

  try {
    business = await resolveBusiness(slug);

    if (business) {
      const [productsSnap, categoriesSnap] = await Promise.all([
        adminDb
          .collection('products')
          .where('businessId', '==', business.id)
          .where('isActive', '==', true)
          .get(),
        adminDb
          .collection('menuCategories')
          .where('businessId', '==', business.id)
          .get()
          .catch(() => null),
      ]);

      products = productsSnap.docs
        .map(d => ({ ...d.data(), id: d.id }) as Product)
        .filter(p => p.isDeliverable !== false);

      if (categoriesSnap) {
        categories = categoriesSnap.docs
          .map(d => ({ ...d.data(), id: d.id }) as MenuCategory)
          .filter(c => c.isActive)
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      }
    }
  } catch (err) {
    console.error('[PublicMenu] page error:', err);
  }

  if (!business) notFound();

  // ALLOWLIST DE SEGURANÇA: o cardápio é público/anônimo — NUNCA enviar o doc
  // completo do business ao client (contém segredos: channels.*.accessToken,
  // fiscal/certificado). Projeta-se só o necessário + flags MP públicas.
  const publicBusiness: PublicBusiness = {
    id: business.id,
    slug: business.slug,
    logo: business.logo,
    nomeFantasia: business.nomeFantasia,
    razaoSocial: business.razaoSocial,
    mpConnected: business.mpConnected,
    mpPublicKey: business.mpPublicKey,
    mpLiveMode: business.mpLiveMode,
    settings: {
      openingHours: business.settings?.openingHours,
      aiAgent: {
        acceptedPaymentMethods: business.settings?.aiAgent?.acceptedPaymentMethods,
        businessDescription: business.settings?.aiAgent?.businessDescription,
        pedidos: {
          acceptOrdersOffHours: business.settings?.aiAgent?.pedidos?.acceptOrdersOffHours,
          deliveryFee: business.settings?.aiAgent?.pedidos?.deliveryFee,
        },
        // Zonas de entrega são conteúdo público (bairros/taxas exibidos ao
        // cliente) — seguro projetar; habilita a taxa por região no checkout.
        deliveryZones: business.settings?.aiAgent?.deliveryZones,
      },
    },
  };

  return <CatalogClient business={publicBusiness} products={products} categories={categories} />;
}
