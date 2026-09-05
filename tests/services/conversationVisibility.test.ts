import { describe, it, expect } from 'vitest';
import { computeVisibleToUserIds, type SectorMembersLookup } from '@/lib/services/conversationVisibility';

const sectorsById = (entries: Record<string, string[]>): Map<string, SectorMembersLookup> => {
  const map = new Map<string, SectorMembersLookup>();
  for (const [id, memberIds] of Object.entries(entries)) map.set(id, { memberIds });
  return map;
};

describe('computeVisibleToUserIds', () => {
  it('retorna null quando não há sectorIds nem isPrivate (sem restrição)', () => {
    expect(computeVisibleToUserIds({ sectorsById: sectorsById({}) })).toBeNull();
    expect(computeVisibleToUserIds({ sectorIds: [], isPrivate: false, sectorsById: sectorsById({}) })).toBeNull();
  });

  it('restringe aos membros do setor quando sectorIds está presente (não-privada)', () => {
    const result = computeVisibleToUserIds({
      sectorIds: ['financeiro'],
      sectorsById: sectorsById({ financeiro: ['u1', 'u2'] }),
    });
    expect(result).not.toBeNull();
    expect(new Set(result)).toEqual(new Set(['u1', 'u2']));
  });

  it('restringe aos membros do setor quando isPrivate é true e há sectorIds', () => {
    const result = computeVisibleToUserIds({
      sectorIds: ['financeiro'],
      isPrivate: true,
      sectorsById: sectorsById({ financeiro: ['u1', 'u2'] }),
    });
    expect(new Set(result)).toEqual(new Set(['u1', 'u2']));
  });

  it('privada sem sectorIds restringe só ao assignedTo (ninguém mais)', () => {
    const result = computeVisibleToUserIds({
      isPrivate: true,
      assignedTo: 'u9',
      sectorsById: sectorsById({}),
    });
    expect(result).toEqual(['u9']);
  });

  it('privada sem sectorIds e sem assignedTo não libera ninguém (array vazio, só admin via bypass externo)', () => {
    const result = computeVisibleToUserIds({ isPrivate: true, sectorsById: sectorsById({}) });
    expect(result).toEqual([]);
  });

  it('inclui assignedTo além dos membros do setor (união, sem duplicar)', () => {
    const result = computeVisibleToUserIds({
      sectorIds: ['financeiro'],
      assignedTo: 'u2', // já é membro do setor
      sectorsById: sectorsById({ financeiro: ['u1', 'u2'] }),
    });
    expect(new Set(result)).toEqual(new Set(['u1', 'u2']));
    expect(result?.length).toBe(2); // não duplica u2

    const result2 = computeVisibleToUserIds({
      sectorIds: ['financeiro'],
      assignedTo: 'u9', // fora do setor
      sectorsById: sectorsById({ financeiro: ['u1', 'u2'] }),
    });
    expect(new Set(result2)).toEqual(new Set(['u1', 'u2', 'u9']));
  });

  it('setor referenciado que não existe mais é ignorado (conservador — perde membro morto, não vaza acesso)', () => {
    const result = computeVisibleToUserIds({
      sectorIds: ['setor-apagado'],
      sectorsById: sectorsById({}),
    });
    expect(result).toEqual([]);
  });

  it('múltiplos setores unem os membros de todos', () => {
    const result = computeVisibleToUserIds({
      sectorIds: ['financeiro', 'recepcao'],
      sectorsById: sectorsById({ financeiro: ['u1'], recepcao: ['u2', 'u3'] }),
    });
    expect(new Set(result)).toEqual(new Set(['u1', 'u2', 'u3']));
  });
});
