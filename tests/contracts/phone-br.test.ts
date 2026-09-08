import { describe, expect, it } from 'vitest';
import {
  digitsOnly,
  canonicalizeBr,
  alternativeBrPhone,
  brPhoneCandidates,
  brPhonesMatch,
} from '@/contracts/_runtime/phone-br';

describe('digitsOnly', () => {
  it('remove tudo que não é dígito', () => {
    expect(digitsOnly('+55 (11) 98765-4321')).toBe('5511987654321');
  });

  it('retorna string vazia pra null/undefined/vazio', () => {
    expect(digitsOnly(null)).toBe('');
    expect(digitsOnly(undefined)).toBe('');
    expect(digitsOnly('')).toBe('');
  });
});

describe('canonicalizeBr', () => {
  it('normaliza número formatado com máscara pra dígitos com prefixo 55', () => {
    expect(canonicalizeBr('+55 (11) 98765-4321')).toBe('5511987654321');
  });

  it('adiciona prefixo 55 em número local (DDD + 9 dígitos, com 9)', () => {
    expect(canonicalizeBr('11 98765-4321')).toBe('5511987654321');
  });

  it('adiciona prefixo 55 em número local sem o 9 (DDD + 8 dígitos)', () => {
    expect(canonicalizeBr('11 8765-4321')).toBe('551187654321');
  });

  it('já canonical (55 + 13 dígitos) permanece igual', () => {
    expect(canonicalizeBr('5511987654321')).toBe('5511987654321');
  });

  it('já canonical (55 + 12 dígitos, sem o 9) permanece igual', () => {
    expect(canonicalizeBr('551187654321')).toBe('551187654321');
  });

  it('retorna string vazia pra input vazio', () => {
    expect(canonicalizeBr('')).toBe('');
    expect(canonicalizeBr(null)).toBe('');
  });

  it('devolve como veio pra formato não reconhecido (nem 10-11 nem 12-13 dígitos)', () => {
    expect(canonicalizeBr('123')).toBe('123');
  });
});

describe('alternativeBrPhone', () => {
  it('tira o 9 quando presente', () => {
    expect(alternativeBrPhone('5511987654321')).toBe('551187654321');
  });

  it('adiciona o 9 quando ausente', () => {
    expect(alternativeBrPhone('551187654321')).toBe('5511987654321');
  });

  it('retorna null pra número não-BR (não começa com 55)', () => {
    expect(alternativeBrPhone('12125551234')).toBeNull();
  });

  it('retorna null pra formato com 11 dígitos após o 55 mas sem o 9 na posição esperada', () => {
    // DDD=11, próximo dígito não é '9' — não é "com 9 pra tirar" válido.
    expect(alternativeBrPhone('5511187654321')).toBeNull();
  });

  it('retorna null pra tamanho de resto inesperado', () => {
    expect(alternativeBrPhone('551123')).toBeNull();
  });
});

describe('brPhoneCandidates', () => {
  it('inclui canonical, variação com/sem 9, e últimos 8 dígitos', () => {
    const candidates = brPhoneCandidates('5511987654321');
    expect(candidates).toContain('5511987654321');
    expect(candidates).toContain('551187654321');
    expect(candidates).toContain('87654321');
  });

  it('retorna array vazio pra input vazio', () => {
    expect(brPhoneCandidates('')).toEqual([]);
    expect(brPhoneCandidates(null)).toEqual([]);
  });

  it('não duplica candidatos (Set dedup)', () => {
    const candidates = brPhoneCandidates('5511987654321');
    expect(new Set(candidates).size).toBe(candidates.length);
  });
});

describe('brPhonesMatch', () => {
  it('MATCH: mesmo número com/sem o 9', () => {
    expect(brPhonesMatch('5511987654321', '551187654321')).toBe(true);
  });

  it('MATCH: mesmo número em formatações diferentes (máscara vs dígitos puros)', () => {
    expect(brPhonesMatch('5511987654321', '+55 11 98765-4321')).toBe(true);
  });

  it('MATCH: número local (sem prefixo 55) contra canonical', () => {
    expect(brPhonesMatch('11987654321', '5511987654321')).toBe(true);
  });

  it('NO MATCH: DDDs e números totalmente diferentes', () => {
    // Local numbers diferentes de propósito (não só o DDD) — se os últimos 8
    // dígitos coincidissem por acaso, o fallback de brPhoneCandidates faria
    // MATCH mesmo com DDD diferente (comportamento conhecido/documentado da
    // função, não testado aqui).
    expect(brPhonesMatch('5511987654321', '5521933332222')).toBe(false);
  });

  it('NO MATCH: números completamente diferentes', () => {
    expect(brPhonesMatch('5511987654321', '5511911112222')).toBe(false);
  });

  it('NO MATCH: um dos dois é vazio/null', () => {
    expect(brPhonesMatch('5511987654321', null)).toBe(false);
    expect(brPhonesMatch(null, undefined)).toBe(false);
  });
});
