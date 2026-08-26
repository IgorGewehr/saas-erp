import { NextResponse, type NextRequest } from 'next/server';
import { adminDb, adminStorage } from '@/lib/config/firebaseAdmin';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { isAuthError, verifyAuth } from '@/lib/utils/verifyAuth';

export const runtime = 'nodejs';

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  const businessId = request.nextUrl.searchParams.get('businessId') ?? '';
  const noteId = request.nextUrl.searchParams.get('noteId') ?? '';
  if (!businessId || !noteId) return error('businessId e noteId são obrigatórios.', 400);
  const auth = await verifyAuth(request, businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.manager) return error('Sem permissão.', 403);

  const snapshot = await adminDb.collection('purchaseNotes').doc(noteId).get();
  if (!snapshot.exists || snapshot.data()?.businessId !== auth.businessId) return error('Nota não encontrada.', 404);
  const storagePath = snapshot.data()?.xmlStoragePath;
  const expectedPrefix = `businesses/${auth.businessId}/purchase-notes/${noteId}/`;
  if (typeof storagePath !== 'string' || !storagePath.startsWith(expectedPrefix)) return error('XML original indisponível.', 404);
  try {
    const [contents] = await adminStorage.bucket().file(storagePath).download();
    const originalName = typeof snapshot.data()?.originalFileName === 'string'
      ? snapshot.data()?.originalFileName.replace(/[\r\n"\\/]/g, '_')
      : `nfe-${snapshot.data()?.numero ?? noteId}.xml`;
    return new NextResponse(new Uint8Array(contents), {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${originalName}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (cause) {
    console.error('[purchase-notes/xml] download failed', cause);
    return error('Não foi possível baixar o XML.', 500);
  }
}
