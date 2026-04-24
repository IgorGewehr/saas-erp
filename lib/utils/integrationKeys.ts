/**
 * Server-side helper to fetch integration API keys from Firestore.
 * Keys are stored in businesses/{businessId}.enterprise.integrations[].
 * This avoids sending API keys from the frontend.
 */

import { adminDb } from '@/lib/config/firebaseAdmin';

export interface IntegrationKeys {
  apiKey: string;
  metadata?: Record<string, unknown>;
}

/**
 * Look up the API key for a given integration provider from Firestore.
 * Returns null if not found or not active.
 */
export async function getIntegrationKeys(
  businessId: string,
  provider: string,
): Promise<IntegrationKeys | null> {
  const doc = await adminDb.collection('businesses').doc(businessId).get();
  if (!doc.exists) return null;

  const enterprise = doc.data()?.enterprise;
  if (!enterprise?.isEnabled || !enterprise.integrations) return null;

  const integration = (enterprise.integrations as Array<{
    provider: string;
    apiKey: string;
    isActive: boolean;
    metadata?: Record<string, unknown>;
  }>).find(i => i.provider === provider && i.isActive);

  if (!integration?.apiKey) return null;

  return {
    apiKey: integration.apiKey,
    metadata: integration.metadata,
  };
}
