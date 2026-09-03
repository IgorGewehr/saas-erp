import { describe, expect, it } from 'vitest';
import { computeSidebarPrefsSyncKey } from '@/lib/services/settings/sidebarPrefsSync';
import type { SidebarPrefs } from '@/lib/types';

function prefs(overrides: Partial<SidebarPrefs> = {}): SidebarPrefs {
  return {
    sections: [{ key: 'principal', title: 'Principal', isCollapsed: false, items: ['Dashboard', 'Agenda'] }],
    hiddenItems: [],
    ...overrides,
  };
}

describe('computeSidebarPrefsSyncKey', () => {
  it('produz a mesma chave para um objeto estruturalmente igual com referência nova', () => {
    // Simula o onSnapshot recriando `sidebarPrefs` (nova referência) sem
    // mudança real de conteúdo — ex: heartbeat de presença tocando um campo
    // irmão (isOnline) no mesmo doc.
    const a = prefs();
    const b = JSON.parse(JSON.stringify(a)) as SidebarPrefs;
    expect(a).not.toBe(b);
    expect(computeSidebarPrefsSyncKey('u1', a, false, 'servicos', 40))
      .toBe(computeSidebarPrefsSyncKey('u1', b, false, 'servicos', 40));
  });

  it('muda a chave quando o conteúdo de sections realmente muda', () => {
    const a = prefs();
    const b = prefs({ sections: [{ key: 'principal', title: 'Principal', isCollapsed: false, items: ['Dashboard'] }] });
    expect(computeSidebarPrefsSyncKey('u1', a, false, 'servicos', 40))
      .not.toBe(computeSidebarPrefsSyncKey('u1', b, false, 'servicos', 40));
  });

  it('muda a chave quando o userId muda, mesmo com prefs idênticos', () => {
    const p = prefs();
    expect(computeSidebarPrefsSyncKey('u1', p, false, 'servicos', 40))
      .not.toBe(computeSidebarPrefsSyncKey('u2', p, false, 'servicos', 40));
  });

  it('muda a chave quando o useCase do negócio muda, mesmo com prefs idênticos', () => {
    const p = prefs();
    expect(computeSidebarPrefsSyncKey('u1', p, false, 'servicos', 40))
      .not.toBe(computeSidebarPrefsSyncKey('u1', p, false, 'pedidos', 40));
  });

  it('muda a chave quando o role do usuário muda, mesmo com prefs idênticos', () => {
    const p = prefs();
    expect(computeSidebarPrefsSyncKey('u1', p, false, 'servicos', 40))
      .not.toBe(computeSidebarPrefsSyncKey('u1', p, false, 'servicos', 80));
  });

  it('trata prefs undefined de forma estável (sem prefs salvos ainda)', () => {
    expect(computeSidebarPrefsSyncKey('u1', undefined, false, 'servicos', 40))
      .toBe(computeSidebarPrefsSyncKey('u1', undefined, false, 'servicos', 40));
  });
});
