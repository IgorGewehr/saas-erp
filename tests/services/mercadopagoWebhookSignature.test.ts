import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { parseMpXSignature, verifyMpSignature, isWithinMpReplayWindow } from '@/lib/services/mercadopago/webhookSignature';

// Extraído de app/api/webhooks/mercadopago/route.ts (M12) pra ser reaproveitado
// por app/api/webhooks/mercadopago-platform/route.ts — trava o comportamento
// pra garantir que a extração não mudou nada.

describe('parseMpXSignature', () => {
  it('parseia ts e v1 no formato padrão', () => {
    expect(parseMpXSignature('ts=1700000000,v1=abc123')).toEqual({ ts: '1700000000', v1: 'abc123' });
  });

  it('ignora ordem e espaços', () => {
    expect(parseMpXSignature('v1=abc123, ts=1700000000')).toEqual({ ts: '1700000000', v1: 'abc123' });
  });

  it('retorna null quando falta ts', () => {
    expect(parseMpXSignature('v1=abc123')).toBeNull();
  });

  it('retorna null quando falta v1', () => {
    expect(parseMpXSignature('ts=1700000000')).toBeNull();
  });

  it('retorna null para header ausente', () => {
    expect(parseMpXSignature(null)).toBeNull();
  });
});

describe('verifyMpSignature', () => {
  const secret = 'test-secret';

  function sign(manifest: string): string {
    return crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  }

  it('aceita assinatura válida com dataId + requestId', () => {
    const ts = '1700000000';
    const manifest = `id:abc123;request-id:req-1;ts:${ts};`;
    const v1 = sign(manifest);
    expect(verifyMpSignature({ secret, sig: { ts, v1 }, dataId: 'abc123', requestId: 'req-1' })).toBe(true);
  });

  it('minúsculiza dataId antes de assinar (regra do MP)', () => {
    const ts = '1700000000';
    const manifest = `id:abc123;request-id:req-1;ts:${ts};`;
    const v1 = sign(manifest);
    expect(verifyMpSignature({ secret, sig: { ts, v1 }, dataId: 'ABC123', requestId: 'req-1' })).toBe(true);
  });

  it('aceita assinatura sem requestId (segmento omitido do manifest)', () => {
    const ts = '1700000000';
    const manifest = `id:abc123;ts:${ts};`;
    const v1 = sign(manifest);
    expect(verifyMpSignature({ secret, sig: { ts, v1 }, dataId: 'abc123', requestId: null })).toBe(true);
  });

  it('rejeita assinatura com secret errado', () => {
    const ts = '1700000000';
    const manifest = `id:abc123;ts:${ts};`;
    const v1 = crypto.createHmac('sha256', 'wrong-secret').update(manifest).digest('hex');
    expect(verifyMpSignature({ secret, sig: { ts, v1 }, dataId: 'abc123', requestId: null })).toBe(false);
  });

  it('rejeita quando dataId usado pra verificar diverge do assinado', () => {
    const ts = '1700000000';
    const manifest = `id:abc123;ts:${ts};`;
    const v1 = sign(manifest);
    expect(verifyMpSignature({ secret, sig: { ts, v1 }, dataId: 'different', requestId: null })).toBe(false);
  });

  it('rejeita hash de tamanho diferente sem lançar', () => {
    expect(verifyMpSignature({ secret, sig: { ts: '1700000000', v1: 'short' }, dataId: 'abc123', requestId: null })).toBe(false);
  });
});

describe('isWithinMpReplayWindow', () => {
  it('aceita timestamp atual', () => {
    expect(isWithinMpReplayWindow(String(Math.floor(Date.now() / 1000)))).toBe(true);
  });

  it('rejeita timestamp de mais de 5 minutos atrás', () => {
    const sixMinAgo = Math.floor(Date.now() / 1000) - 6 * 60;
    expect(isWithinMpReplayWindow(String(sixMinAgo))).toBe(false);
  });

  it('rejeita timestamp não-numérico', () => {
    expect(isWithinMpReplayWindow('not-a-number')).toBe(false);
  });
});
