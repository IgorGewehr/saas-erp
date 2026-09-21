import { describe, it, expect } from 'vitest';
import { generateIdempotencyKey } from '@/lib/utils/idempotencyKey';
import { CreateOrderBodySchema } from '@/contracts/api/v1/orders';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('generateIdempotencyKey', () => {
  it('usa crypto.randomUUID quando existe (contexto seguro)', () => {
    const fake = { randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' } as unknown as Crypto;
    expect(generateIdempotencyKey(fake)).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  });

  it('sem randomUUID (http://IP-da-rede) cai em getRandomValues e ainda gera UUID v4 válido', () => {
    const fake = {
      getRandomValues: (bytes: Uint8Array) => { bytes.fill(0xff); return bytes; },
    } as unknown as Crypto;
    const key = generateIdempotencyKey(fake);
    expect(key).toMatch(UUID_V4);
  });

  it('sem crypto nenhum ainda gera UUID v4 válido', () => {
    expect(generateIdempotencyKey(undefined as unknown as Crypto)).toMatch(UUID_V4);
  });

  it('chaves consecutivas diferem', () => {
    const fake = {} as unknown as Crypto;
    expect(generateIdempotencyKey(fake)).not.toBe(generateIdempotencyKey(fake));
  });

  it('o formato passa no contrato do corpo do pedido (8–100 chars)', () => {
    const key = generateIdempotencyKey({} as unknown as Crypto);
    expect(CreateOrderBodySchema.safeParse({
      type: 'b2b', items: [{ productId: 'p1', quantity: 1 }], idempotencyKey: key,
    }).success).toBe(true);
  });
});
