import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';

const VALID_TYPES = new Set(['nfse', 'nfce', 'nfe']);
const VALID_STATUSES = new Set(['rascunho', 'processando', 'autorizada', 'rejeitada', 'cancelada', 'erro']);

// =============================================================================
// GET /api/v1/fiscal/documents — List fiscal documents (read-only)
// =============================================================================
export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:fiscal']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;
    const type = searchParams.get('type');
    const status = searchParams.get('status');
    const search = searchParams.get('search')?.toLowerCase().trim() || '';
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    // Validate type if provided
    if (type && !VALID_TYPES.has(type)) {
      return apiError(`Invalid type "${type}". Valid values: ${[...VALID_TYPES].join(', ')}`, 400);
    }

    // Validate status if provided
    if (status && !VALID_STATUSES.has(status)) {
      return apiError(`Invalid status "${status}". Valid values: ${[...VALID_STATUSES].join(', ')}`, 400);
    }

    // Build Firestore query — always filter by businessId
    let query: FirebaseFirestore.Query = adminDb
      .collection('fiscalDocuments')
      .where('businessId', '==', auth.businessId);

    if (type) {
      query = query.where('type', '==', type);
    }

    if (status) {
      query = query.where('status', '==', status);
    }

    query = query.orderBy('createdAt', 'desc');

    const snapshot = await query.get();
    let documents = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    // Apply text search filter in-memory (number, clientName, accessKey)
    if (search) {
      documents = documents.filter((d) => {
        const doc = d as Record<string, unknown>;
        const number = String(doc.number || '').toLowerCase();
        const clientName = (doc.clientName as string || '').toLowerCase();
        const accessKey = (doc.accessKey as string || '').toLowerCase();
        return (
          number.includes(search) ||
          clientName.includes(search) ||
          accessKey.includes(search)
        );
      });
    }

    const total = documents.length;
    const paginated = documents.slice(offset, offset + limit);

    return apiSuccess({
      documents: paginated,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (err) {
    console.error('[API] GET /api/v1/fiscal/documents error:', err);
    return apiError('Failed to fetch fiscal documents', 500);
  }
}
