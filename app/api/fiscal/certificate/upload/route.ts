import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminStorage } from '@/lib/config/firebaseAdmin';
import {
  encryptPassword,
  invalidateCertCache,
  parseCertificateInfo,
} from '@/lib/fiscal/certificate-manager';
import { FieldValue } from 'firebase-admin/firestore';

const MAX_FILE_SIZE = 256 * 1024; // 256 KB
const ALLOWED_EXTENSIONS = ['.pfx', '.p12'];

export async function POST(req: NextRequest) {
  try {
    // 1. Parse FormData
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const password = formData.get('password') as string | null;
    const businessId =
      (formData.get('businessId') as string | null) ||
      req.headers.get('x-business-id');

    // Validate required fields
    if (!businessId) {
      return NextResponse.json(
        { error: 'businessId is required (form field or x-business-id header).' },
        { status: 400 },
      );
    }

    if (!file) {
      return NextResponse.json(
        { error: 'Certificate file is required.' },
        { status: 400 },
      );
    }

    if (!password) {
      return NextResponse.json(
        { error: 'Certificate password is required.' },
        { status: 400 },
      );
    }

    // 2. Validate file extension
    const fileName = file.name.toLowerCase();
    const hasValidExtension = ALLOWED_EXTENSIONS.some((ext) =>
      fileName.endsWith(ext),
    );

    if (!hasValidExtension) {
      return NextResponse.json(
        {
          error: `Invalid file type. Allowed extensions: ${ALLOWED_EXTENSIONS.join(', ')}`,
        },
        { status: 400 },
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024}KB.` },
        { status: 400 },
      );
    }

    // Verify business exists
    const businessDoc = await adminDb
      .collection('businesses')
      .doc(businessId)
      .get();

    if (!businessDoc.exists) {
      return NextResponse.json(
        { error: 'Business not found.' },
        { status: 404 },
      );
    }

    // 3. Read file buffer and parse certificate to validate password + extract info
    const arrayBuffer = await file.arrayBuffer();
    const pfxBuffer = Buffer.from(arrayBuffer);

    let certInfo;
    try {
      certInfo = parseCertificateInfo(pfxBuffer, password);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to parse certificate.';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    // 4. Upload PFX to Firebase Storage
    const storagePath = `businesses/${businessId}/certificates/cert.pfx`;
    const bucket = adminStorage.bucket();
    const storageFile = bucket.file(storagePath);

    await storageFile.save(pfxBuffer, {
      metadata: {
        contentType: 'application/x-pkcs12',
        metadata: {
          businessId,
          serialNumber: certInfo.serialNumber,
          uploadedAt: new Date().toISOString(),
        },
      },
    });

    // 5. Encrypt password
    const encryptedPassword = encryptPassword(password);

    // 6. Update business document in Firestore
    const now = new Date().toISOString();

    await adminDb
      .collection('businesses')
      .doc(businessId)
      .update({
        'fiscal.certificate': {
          serialNumber: certInfo.serialNumber,
          subject: certInfo.subject,
          validFrom: certInfo.validFrom,
          expiresAt: certInfo.expiresAt,
          storagePath,
          uploadedAt: now,
        },
        'fiscal.certPasswordEncrypted': encryptedPassword,
        updatedAt: FieldValue.serverTimestamp(),
      });

    // 7. Invalidate cache so next getCertificadoPayload fetches fresh data
    invalidateCertCache(businessId);

    // 8. Return certificate info
    return NextResponse.json({
      success: true,
      certificate: {
        serialNumber: certInfo.serialNumber,
        subject: certInfo.subject,
        validFrom: certInfo.validFrom,
        expiresAt: certInfo.expiresAt,
        storagePath,
        uploadedAt: now,
      },
    });
  } catch (error) {
    console.error('[Certificate Upload] Error:', error);

    return NextResponse.json(
      {
        error: 'Internal error processing certificate upload.',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
