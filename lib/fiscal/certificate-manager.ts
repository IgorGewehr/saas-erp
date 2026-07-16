import * as crypto from 'node:crypto';
import { adminDb, adminStorage } from '@/lib/config/firebaseAdmin';

// ---------------------------------------------------------------------------
// Password Encryption (AES-256-GCM)
// ---------------------------------------------------------------------------

const ENCRYPTION_KEY = process.env.CERT_PASSWORD_ENCRYPTION_KEY || '';
// Key must be 64 hex chars = 32 bytes for AES-256

export function encryptPassword(password: string): string {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
    throw new Error(
      'CERT_PASSWORD_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).',
    );
  }

  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(password, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Format: iv.authTag.ciphertext (base64, dot-separated)
  return `${iv.toString('base64')}.${authTag.toString('base64')}.${encrypted.toString('base64')}`;
}

export function decryptPassword(encrypted: string): string {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
    throw new Error(
      'CERT_PASSWORD_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).',
    );
  }

  const parts = encrypted.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted password format.');
  }

  const [ivB64, tagB64, dataB64] = parts;
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

  return (
    decipher.update(Buffer.from(dataB64, 'base64')).toString('utf8') +
    decipher.final('utf8')
  );
}

// ---------------------------------------------------------------------------
// Certificate Cache (30-minute TTL)
// ---------------------------------------------------------------------------

interface CachedCert {
  pfxBase64: string;
  password: string;
  expiresAt: number;
}

const certCache = new Map<string, CachedCert>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export function invalidateCertCache(businessId: string): void {
  certCache.delete(businessId);
}

// ---------------------------------------------------------------------------
// Get Certificate Payload
// ---------------------------------------------------------------------------

export async function getCertificadoPayload(
  businessId: string,
): Promise<{ pfxBase64: string; password: string }> {
  // 1. Check cache
  const cached = certCache.get(businessId);
  if (cached && Date.now() < cached.expiresAt) {
    return { pfxBase64: cached.pfxBase64, password: cached.password };
  }

  // 2. Read business document from Firestore
  const businessDoc = await adminDb
    .collection('businesses')
    .doc(businessId)
    .get();

  if (!businessDoc.exists) {
    throw new Error(`Business ${businessId} not found.`);
  }

  const data = businessDoc.data();
  const fiscal = data?.fiscal;

  if (!fiscal?.certificate?.storagePath) {
    throw new Error(
      `No certificate configured for business ${businessId}. Upload a certificate first.`,
    );
  }

  if (!fiscal?.certPasswordEncrypted) {
    throw new Error(
      `No encrypted password found for business ${businessId} certificate.`,
    );
  }

  // 3. Download PFX from Firebase Storage
  const bucket = adminStorage.bucket();
  const file = bucket.file(fiscal.certificate.storagePath);

  const [exists] = await file.exists();
  if (!exists) {
    throw new Error(
      `Certificate file not found in storage at path: ${fiscal.certificate.storagePath}`,
    );
  }

  const [fileBuffer] = await file.download();

  // 4. Decrypt password.
  // Legacy: o CertificateManager antigo gravava btoa(senha) direto do browser
  // (base64 puro, sem os pontos do formato iv.tag.cipher) e metadados
  // fabricados (serialNumber PENDING_VALIDATION + validade inventada).
  // Self-heal: decodifica, valida contra o PFX, re-criptografa com
  // AES-256-GCM e corrige os metadados com os reais do certificado.
  let password: string;
  const storedPassword = String(fiscal.certPasswordEncrypted);
  if (storedPassword.includes('.')) {
    password = decryptPassword(storedPassword);
  } else {
    password = Buffer.from(storedPassword, 'base64').toString('utf8');
    try {
      const info = parseCertificateInfo(fileBuffer, password);
      await businessDoc.ref.update({
        'fiscal.certPasswordEncrypted': encryptPassword(password),
        'fiscal.certificate.serialNumber': info.serialNumber,
        'fiscal.certificate.subject': info.subject,
        'fiscal.certificate.issuer': info.issuer,
        'fiscal.certificate.thumbprint': info.thumbprint,
        'fiscal.certificate.validFrom': info.validFrom,
        'fiscal.certificate.expiresAt': info.expiresAt,
      });
      console.log(
        `[certificate-manager] Senha legada (btoa) migrada para AES-256-GCM e metadados corrigidos — business ${businessId}`,
      );
    } catch (err) {
      throw new Error(
        `Certificado com senha em formato legado que falhou na validação (senha incorreta ou certificado expirado). Refaça o upload em Configurações → Fiscal. Detalhe: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 5. Re-export to 3DES preserving full ICP-Brasil CA chain
  //    Some SEFAZ APIs require 3DES-encoded certificates for compatibility
  let pfxBase64: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const forge = require('node-forge');
    const p12Der = forge.util.createBuffer(fileBuffer.toString('binary'));
    const p12Asn1 = forge.asn1.fromDer(p12Der);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const privateKey = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key;
    const allCerts = (certBags[forge.pki.oids.certBag] ?? [])
      .map((b: { cert?: unknown }) => b.cert)
      .filter((c: unknown): c is object => !!c);

    if (privateKey && allCerts.length > 0) {
      const subject = (allCerts[0] as { subject: { getField: (s: string) => { value: string } | null } })
        .subject.getField('CN')?.value || 'Certificado Digital';
      const newP12Asn1 = forge.pkcs12.toPkcs12Asn1(privateKey, allCerts, password, {
        algorithm: '3des',
        friendlyName: subject,
      });
      const newP12Der = forge.asn1.toDer(newP12Asn1).getBytes();
      pfxBase64 = Buffer.from(newP12Der, 'binary').toString('base64');
    } else {
      pfxBase64 = fileBuffer.toString('base64');
    }
  } catch {
    // If 3DES conversion fails, fall back to original buffer
    pfxBase64 = fileBuffer.toString('base64');
  }

  // 6. Cache for 30 minutes
  certCache.set(businessId, {
    pfxBase64,
    password,
    expiresAt: Date.now() + CACHE_TTL,
  });

  return { pfxBase64, password };
}

// ---------------------------------------------------------------------------
// Parse Certificate Info (PFX validation & metadata extraction)
// ---------------------------------------------------------------------------

export interface CertificateInfo {
  serialNumber: string;
  subject: string;
  issuer: string;
  thumbprint: string;
  validFrom: string;
  expiresAt: string;
}

export function parseCertificateInfo(
  pfxBuffer: Buffer,
  password: string,
): CertificateInfo {
  // node-forge is a peer dependency -- must be installed separately
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const forge = require('node-forge');

  let p12;
  try {
    const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Unknown parsing error';

    if (
      message.includes('Invalid password') ||
      message.includes('PKCS#12 MAC') ||
      message.includes('incorrect')
    ) {
      throw new Error('Invalid certificate password.');
    }

    throw new Error(`Failed to parse certificate: ${message}`);
  }

  // Extract certificate from certBag
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const bags = certBags[forge.pki.oids.certBag];

  if (!bags || bags.length === 0) {
    throw new Error('No certificate found in PFX file.');
  }

  const cert = bags[0].cert;
  if (!cert) {
    throw new Error('Could not extract certificate data from PFX.');
  }

  // Validate expiration
  const expiresAt = new Date(cert.validity.notAfter).toISOString();
  const validFrom = new Date(cert.validity.notBefore).toISOString();

  if (new Date(cert.validity.notAfter).getTime() < Date.now()) {
    throw new Error(
      `Certificate expired on ${new Date(cert.validity.notAfter).toLocaleDateString('pt-BR')}. Please upload a valid certificate.`,
    );
  }

  // Build subject string from attributes
  const subjectParts: string[] = [];
  const attrOrder = ['CN', 'O', 'OU', 'L', 'ST', 'C'];
  for (const shortName of attrOrder) {
    const attr = cert.subject.getField(shortName);
    if (attr) {
      subjectParts.push(`${shortName}=${attr.value}`);
    }
  }
  const subject = subjectParts.join(', ') || 'Unknown';

  // Issuer CN for the details panel
  const issuer = (cert.issuer.getField('CN')?.value as string) || 'Unknown';

  // SHA-1 thumbprint (hex) — used to detect re-uploads of the same cert
  const certDerBytes = forge.asn1
    .toDer(forge.pki.certificateToAsn1(cert))
    .getBytes();
  const md = forge.md.sha1.create();
  md.update(certDerBytes);
  const thumbprint = md.digest().toHex().toUpperCase();

  // Serial number as hex
  const serialNumber = cert.serialNumber
    ? cert.serialNumber.toUpperCase()
    : 'Unknown';

  return { serialNumber, subject, issuer, thumbprint, validFrom, expiresAt };
}
