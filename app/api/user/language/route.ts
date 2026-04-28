import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { adminDb } from '@/lib/config/firebaseAdmin';

const SUPPORTED_LANGUAGES = ['pt-BR', 'en-US'];

export async function PUT(req: NextRequest) {
  const authResult = await verifyAuth(req);
  if (isAuthError(authResult)) return authResult;

  try {
    const { language } = await req.json();

    if (!language || !SUPPORTED_LANGUAGES.includes(language)) {
      return NextResponse.json(
        { error: 'Invalid language. Supported: ' + SUPPORTED_LANGUAGES.join(', ') },
        { status: 400 },
      );
    }

    await adminDb.collection('users').doc(authResult.uid).update({
      language,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, language });
  } catch (err) {
    console.error('[API] Error updating language:', err);
    return NextResponse.json({ error: 'Failed to update language' }, { status: 500 });
  }
}
