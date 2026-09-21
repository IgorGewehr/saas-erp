/**
 * UUID v4 para chave de idempotência gerada no browser.
 *
 * `crypto.randomUUID` só existe em contexto seguro (HTTPS/localhost). O tablet pode abrir o
 * sistema por `http://IP-da-rede`, onde só `getRandomValues` está disponível — sem o
 * fallback, fechar negócio quebraria justamente na demo em rede local.
 */
export function generateIdempotencyKey(cryptoImpl: Crypto | undefined = globalThis.crypto): string {
  if (typeof cryptoImpl?.randomUUID === 'function') return cryptoImpl.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof cryptoImpl?.getRandomValues === 'function') {
    cryptoImpl.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40; // versão 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
