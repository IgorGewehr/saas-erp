/**
 * CRM Omnichannel — Critical Logic Tests
 *
 * Tests the two most critical business operations:
 * 1. Kanban drag-and-drop: lead status transitions
 * 2. Tag system: add/remove preset and custom tags
 */

import { getTagConfig, ALL_PRESET_TAGS, TAG_PRESETS, KANBAN_COLUMNS } from '../../app/components/features/crm/shared';
import type { LeadStatus } from '../../lib/types';

// ─── Tag System Tests ────────────────────────────────────────────────────────

describe('Tag System', () => {
  describe('getTagConfig', () => {
    it('returns preset config for known tags (case-insensitive)', () => {
      const cfg = getTagConfig('quente');
      expect(cfg.label).toBe('Quente');
      expect(cfg.dot).toBe('bg-orange-500');
      expect(cfg.bg).toContain('orange');
    });

    it('handles uppercase input', () => {
      const cfg = getTagConfig('QUENTE');
      expect(cfg.label).toBe('Quente');
    });

    it('handles mixed case input', () => {
      const cfg = getTagConfig('Para Prosseguir');
      expect(cfg.label).toBe('Para Prosseguir');
      expect(cfg.dot).toBe('bg-blue-500');
    });

    it('returns fallback gray config for unknown tags', () => {
      const cfg = getTagConfig('custom-tag-xyz');
      expect(cfg.label).toBe('custom-tag-xyz');
      expect(cfg.dot).toBe('bg-gray-500');
      expect(cfg.bg).toContain('gray');
      expect(cfg.text).toContain('gray');
    });

    it('returns fallback for empty string', () => {
      const cfg = getTagConfig('');
      expect(cfg.label).toBe('');
      expect(cfg.dot).toBe('bg-gray-500');
    });
  });

  describe('ALL_PRESET_TAGS', () => {
    it('contains exactly 5 preset tags', () => {
      expect(ALL_PRESET_TAGS).toHaveLength(5);
    });

    it('contains the required tags', () => {
      expect(ALL_PRESET_TAGS).toContain('quente');
      expect(ALL_PRESET_TAGS).toContain('para prosseguir');
      expect(ALL_PRESET_TAGS).toContain('falhou contato');
      expect(ALL_PRESET_TAGS).toContain('assinou');
      expect(ALL_PRESET_TAGS).toContain('tem interesse');
    });

    it('each preset tag has a valid config', () => {
      ALL_PRESET_TAGS.forEach((tag) => {
        const cfg = TAG_PRESETS[tag];
        expect(cfg).toBeDefined();
        expect(cfg.label).toBeTruthy();
        expect(cfg.bg).toBeTruthy();
        expect(cfg.text).toBeTruthy();
        expect(cfg.dot).toBeTruthy();
      });
    });
  });

  describe('Tag toggle logic (simulated)', () => {
    function toggleTag(currentTags: string[], tag: string): string[] {
      if (currentTags.includes(tag)) {
        return currentTags.filter((t) => t !== tag);
      }
      return [...currentTags, tag];
    }

    it('adds a tag when not present', () => {
      const result = toggleTag([], 'quente');
      expect(result).toEqual(['quente']);
    });

    it('removes a tag when already present', () => {
      const result = toggleTag(['quente', 'assinou'], 'quente');
      expect(result).toEqual(['assinou']);
    });

    it('preserves order of other tags when removing', () => {
      const result = toggleTag(['quente', 'para prosseguir', 'assinou'], 'para prosseguir');
      expect(result).toEqual(['quente', 'assinou']);
    });

    it('appends new tag at end', () => {
      const result = toggleTag(['quente'], 'tem interesse');
      expect(result).toEqual(['quente', 'tem interesse']);
    });

    it('handles custom (non-preset) tags', () => {
      const result = toggleTag(['quente'], 'vip-client');
      expect(result).toEqual(['quente', 'vip-client']);
    });

    it('handles empty array', () => {
      const result = toggleTag([], 'assinou');
      expect(result).toEqual(['assinou']);
    });

    it('handles removing last tag', () => {
      const result = toggleTag(['quente'], 'quente');
      expect(result).toEqual([]);
    });

    it('does not duplicate tags on double-add', () => {
      let tags = toggleTag([], 'quente');
      tags = toggleTag(tags, 'quente'); // remove
      tags = toggleTag(tags, 'quente'); // add again
      expect(tags).toEqual(['quente']);
    });
  });

  describe('Custom tag add logic (simulated)', () => {
    function addCustomTag(currentTags: string[], tag: string): string[] {
      const normalized = tag.trim().toLowerCase();
      if (!normalized || currentTags.includes(normalized)) return currentTags;
      return [...currentTags, normalized];
    }

    it('adds normalized (lowercase, trimmed) custom tag', () => {
      const result = addCustomTag([], '  VIP Client  ');
      expect(result).toEqual(['vip client']);
    });

    it('rejects empty string', () => {
      const result = addCustomTag(['quente'], '');
      expect(result).toEqual(['quente']);
    });

    it('rejects whitespace-only string', () => {
      const result = addCustomTag(['quente'], '   ');
      expect(result).toEqual(['quente']);
    });

    it('rejects duplicate tag', () => {
      const result = addCustomTag(['quente', 'vip'], 'vip');
      expect(result).toEqual(['quente', 'vip']);
    });
  });
});

// ─── Kanban Drag-and-Drop Tests ──────────────────────────────────────────────

describe('Kanban Drag-and-Drop', () => {
  describe('KANBAN_COLUMNS configuration', () => {
    it('has 7 columns matching all LeadStatus values', () => {
      expect(KANBAN_COLUMNS).toHaveLength(7);
      const statuses = KANBAN_COLUMNS.map((c) => c.status);
      expect(statuses).toContain('novo');
      expect(statuses).toContain('contatado');
      expect(statuses).toContain('qualificado');
      expect(statuses).toContain('proposta');
      expect(statuses).toContain('negociacao');
      expect(statuses).toContain('ganho');
      expect(statuses).toContain('perdido');
    });

    it('each column has a label and color', () => {
      KANBAN_COLUMNS.forEach((col) => {
        expect(col.label).toBeTruthy();
        expect(col.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });
    });
  });

  describe('Status change handler (simulated)', () => {
    // Simulate the handleDrop logic from KanbanBoard
    type StatusChangeCall = { contactId: string; newStatus: LeadStatus };

    function simulateDrop(
      draggingContact: { id: string; status: LeadStatus } | null,
      targetStatus: LeadStatus,
    ): StatusChangeCall | null {
      if (!draggingContact) return null;
      if (draggingContact.status === targetStatus) return null;
      return { contactId: draggingContact.id, newStatus: targetStatus };
    }

    it('returns status change when dropping on a different column', () => {
      const result = simulateDrop({ id: 'lead-1', status: 'novo' }, 'contatado');
      expect(result).toEqual({ contactId: 'lead-1', newStatus: 'contatado' });
    });

    it('returns null when dropping on the same column (no-op)', () => {
      const result = simulateDrop({ id: 'lead-1', status: 'novo' }, 'novo');
      expect(result).toBeNull();
    });

    it('returns null when no contact is being dragged', () => {
      const result = simulateDrop(null, 'contatado');
      expect(result).toBeNull();
    });

    it('handles transition from novo to ganho (full pipeline skip)', () => {
      const result = simulateDrop({ id: 'lead-1', status: 'novo' }, 'ganho');
      expect(result).toEqual({ contactId: 'lead-1', newStatus: 'ganho' });
    });

    it('handles transition from ganho to perdido', () => {
      const result = simulateDrop({ id: 'lead-1', status: 'ganho' }, 'perdido');
      expect(result).toEqual({ contactId: 'lead-1', newStatus: 'perdido' });
    });

    it('handles backward transition (negociacao back to novo)', () => {
      const result = simulateDrop({ id: 'lead-1', status: 'negociacao' }, 'novo');
      expect(result).toEqual({ contactId: 'lead-1', newStatus: 'novo' });
    });

    it('preserves exact contactId in the result', () => {
      const result = simulateDrop({ id: 'abc-123-xyz', status: 'proposta' }, 'qualificado');
      expect(result?.contactId).toBe('abc-123-xyz');
    });
  });

  describe('Kanban filtering logic (simulated)', () => {
    const mockContacts = [
      { id: '1', name: 'Maria', company: 'TechCo', email: 'maria@tech.co', source: 'whatsapp' as const, status: 'novo' as const, score: 80, tags: ['quente', 'tem interesse'] },
      { id: '2', name: 'João', company: 'DevShop', email: 'joao@dev.sh', source: 'instagram' as const, status: 'contatado' as const, score: 50, tags: ['para prosseguir'] },
      { id: '3', name: 'Ana', company: 'DesignLab', email: 'ana@design.lab', source: 'facebook' as const, status: 'novo' as const, score: 30, tags: [] },
    ];

    function filterContacts(contacts: typeof mockContacts, search: string, filterSource: string, filterTags: string[]) {
      let result = [...contacts];
      if (search) {
        const q = search.toLowerCase();
        result = result.filter((c) =>
          c.name.toLowerCase().includes(q) ||
          c.company.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q)
        );
      }
      if (filterSource !== 'all') result = result.filter((c) => c.source === filterSource);
      if (filterTags.length > 0) {
        result = result.filter((c) => filterTags.every((tag) => c.tags.includes(tag)));
      }
      return result;
    }

    it('returns all contacts with no filters', () => {
      const result = filterContacts(mockContacts, '', 'all', []);
      expect(result).toHaveLength(3);
    });

    it('filters by name search', () => {
      const result = filterContacts(mockContacts, 'maria', 'all', []);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('filters by company search', () => {
      const result = filterContacts(mockContacts, 'devshop', 'all', []);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });

    it('filters by source', () => {
      const result = filterContacts(mockContacts, '', 'whatsapp', []);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('filters by single tag', () => {
      const result = filterContacts(mockContacts, '', 'all', ['quente']);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('filters by multiple tags (AND logic)', () => {
      const result = filterContacts(mockContacts, '', 'all', ['quente', 'tem interesse']);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('returns empty when tag combo has no matches', () => {
      const result = filterContacts(mockContacts, '', 'all', ['quente', 'para prosseguir']);
      expect(result).toHaveLength(0);
    });

    it('combines search + source + tags filters', () => {
      const result = filterContacts(mockContacts, 'maria', 'whatsapp', ['quente']);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('returns empty with non-matching combined filters', () => {
      const result = filterContacts(mockContacts, 'maria', 'instagram', []);
      expect(result).toHaveLength(0);
    });
  });
});
