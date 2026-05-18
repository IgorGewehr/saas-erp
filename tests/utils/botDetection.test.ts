import { describe, it, expect } from 'vitest';
import { detectLikelyBotReply } from '@/lib/utils/botDetection';

const t0 = Date.parse('2026-05-15T14:00:00Z');

describe('detectLikelyBotReply — sinal de tempo', () => {
  it('flagra inbound que chega < 5s depois de outbound nosso', () => {
    expect(detectLikelyBotReply({
      content: 'Obrigado!',
      msgTimestampMs: t0 + 1500,
      prevOutboundAtMs: t0,
    })).toBe(true);
  });

  it('NAO flagra inbound que chega >= 5s depois (humano respondendo rapido)', () => {
    expect(detectLikelyBotReply({
      content: 'Obrigado!',
      msgTimestampMs: t0 + 6000,
      prevOutboundAtMs: t0,
    })).toBe(false);
  });

  it('NAO flagra inbound em conv sem outbound anterior (msg neutra)', () => {
    expect(detectLikelyBotReply({
      content: 'Oi, gostaria de saber sobre os horarios.',
      msgTimestampMs: t0,
      prevOutboundAtMs: null,
    })).toBe(false);
  });

  it('NAO flagra quando delta e negativo (clock skew)', () => {
    expect(detectLikelyBotReply({
      content: 'Oi',
      msgTimestampMs: t0 - 1000,
      prevOutboundAtMs: t0,
    })).toBe(false);
  });
});

describe('detectLikelyBotReply — sinal de keyword', () => {
  it('flagra "mensagem automatica" mesmo sem outbound anterior', () => {
    expect(detectLikelyBotReply({
      content: 'Esta e uma mensagem automatica — responderemos em breve.',
      msgTimestampMs: t0,
      prevOutboundAtMs: null,
    })).toBe(true);
  });

  it('flagra "fora do horario de atendimento"', () => {
    expect(detectLikelyBotReply({
      content: 'No momento estamos fora do horario. Retornaremos em breve.',
      msgTimestampMs: t0 + 60_000,
      prevOutboundAtMs: t0,
    })).toBe(true);
  });

  it('flagra "obrigado por entrar em contato" (template comum)', () => {
    expect(detectLikelyBotReply({
      content: 'Olá! Obrigado por entrar em contato com a nossa empresa.',
      msgTimestampMs: t0 + 30_000,
      prevOutboundAtMs: t0,
    })).toBe(true);
  });

  it('flagra "horario de atendimento" mesmo em mensagem longa', () => {
    expect(detectLikelyBotReply({
      content: 'Nosso horario de atendimento e de segunda a sexta das 9h as 18h. ' +
               'Aos sabados das 9h as 12h. Aos domingos e feriados nao atendemos. ' +
               'Para urgencias ligue 0800-XXX-XXXX. Obrigado pela preferencia!',
      msgTimestampMs: t0 + 120_000,
      prevOutboundAtMs: t0,
    })).toBe(true);
  });

  it('NAO flagra msg neutra de cliente humano', () => {
    expect(detectLikelyBotReply({
      content: 'Quanto fica o produto X com frete pra SP?',
      msgTimestampMs: t0 + 30_000,
      prevOutboundAtMs: t0,
    })).toBe(false);
  });

  it('NAO flagra msg curta sem keyword', () => {
    expect(detectLikelyBotReply({
      content: 'Beleza, obrigado',
      msgTimestampMs: t0 + 30_000,
      prevOutboundAtMs: t0,
    })).toBe(false);
  });
});

describe('detectLikelyBotReply — combinacao OR', () => {
  it('flagra quando AMBOS sinais batem', () => {
    expect(detectLikelyBotReply({
      content: 'Mensagem automatica: responderemos em breve.',
      msgTimestampMs: t0 + 1000,
      prevOutboundAtMs: t0,
    })).toBe(true);
  });

  it('flagra com tempo curto + content vazio (audio/imagem sem texto)', () => {
    expect(detectLikelyBotReply({
      content: '',
      msgTimestampMs: t0 + 1500,
      prevOutboundAtMs: t0,
    })).toBe(true);
  });

  it('NAO flagra content vazio sem tempo curto', () => {
    expect(detectLikelyBotReply({
      content: '',
      msgTimestampMs: t0 + 60_000,
      prevOutboundAtMs: t0,
    })).toBe(false);
  });
});
