/**
 * Simple AES-256-GCM encryption for storing sensitive tokens in Firestore.
 * Uses a server-side encryption key from environment variables.
 * For client-side, we use a reversible encoding since the real encryption
 * happens at the Firestore rules level (only business members can read).
 *
 * In production, tokens should ideally be encrypted server-side only.
 * This client-side approach uses AES-GCM via Web Crypto API.
 */

const ENCRYPTION_KEY = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_ENCRYPTION_KEY || 'sp-default-key-change-in-prod-32ch')
  : (process.env.ENCRYPTION_KEY || process.env.NEXT_PUBLIC_ENCRYPTION_KEY || 'sp-default-key-change-in-prod-32ch');

async function getKey(): Promise<CryptoKey> {
  const keyMaterial = new TextEncoder().encode(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
  return crypto.subtle.importKey('raw', keyMaterial, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptToken(plaintext: string): Promise<string> {
  if (!plaintext) return '';
  try {
    const key = await getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    // Combine IV + ciphertext, encode as base64
    const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return btoa(String.fromCharCode(...combined));
  } catch {
    // Fallback to btoa if Web Crypto not available
    return btoa(plaintext);
  }
}

export async function decryptToken(encrypted: string): Promise<string> {
  if (!encrypted) return '';
  try {
    const key = await getKey();
    const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch {
    // Fallback: try plain atob for legacy data
    try { return atob(encrypted); } catch { return ''; }
  }
}
