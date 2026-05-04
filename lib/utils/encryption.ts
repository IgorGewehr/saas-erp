import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      '[Encryption] ENCRYPTION_KEY env var is required. ' +
      'Set a 32-character random string in your environment.'
    );
  }
  // Ensure key is exactly 32 bytes
  return Buffer.from(key.padEnd(32, '0').slice(0, 32), 'utf-8');
}

export async function encryptToken(plaintext: string): Promise<string> {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Format: base64(iv + encrypted + tag)
  const combined = Buffer.concat([iv, encrypted, tag]);
  return combined.toString('base64');
}

export async function decryptToken(ciphertext: string): Promise<string> {
  if (!ciphertext) return '';

  const key = getEncryptionKey();

  try {
    const combined = Buffer.from(ciphertext, 'base64');

    if (combined.length < IV_LENGTH + TAG_LENGTH) {
      throw new Error('Ciphertext too short');
    }

    const iv = combined.subarray(0, IV_LENGTH);
    const tag = combined.subarray(combined.length - TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH, combined.length - TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf-8');
  } catch (err) {
    // If decryption fails, the token may be legacy base64 (pre-encryption migration)
    // Try base64 decode as a one-time migration path
    try {
      const decoded = Buffer.from(ciphertext, 'base64').toString('utf-8');
      // Validate it looks like a token (not random bytes from failed decryption)
      if (decoded && /^[a-zA-Z0-9_\-\.]+$/.test(decoded) && decoded.length > 20) {
        console.warn('[Encryption] Legacy base64 token detected. Re-encrypt this token.');
        return decoded;
      }
    } catch {
      // Not valid base64 either
    }
    throw new Error(`[Encryption] Failed to decrypt token: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
}
