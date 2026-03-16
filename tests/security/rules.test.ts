import { describe, it, expect } from 'vitest';
import { ROLE_HIERARCHY } from '@/lib/types/index';
import type { UserRole } from '@/lib/types/index';
import fs from 'fs';
import path from 'path';

/**
 * These tests verify the security rules logic conceptually by:
 * 1. Testing the roleValue function logic (mirrors firestore.rules roleValue)
 * 2. Verifying role hierarchy consistency between TypeScript constants and rules
 * 3. Ensuring all Firestore collections are covered in the rules file
 */

// Mirrors the roleValue function from firestore.rules
function roleValue(role: string): number {
  switch (role) {
    case 'founder': return 100;
    case 'admin': return 80;
    case 'manager': return 60;
    case 'operator': return 40;
    case 'viewer': return 20;
    default: return 0;
  }
}

// Mirrors the hasMinRole check from firestore.rules
function hasMinRole(userRole: string, minRole: string): boolean {
  return roleValue(userRole) >= roleValue(minRole);
}

// ==========================================
// roleValue function (mirrors firestore.rules)
// ==========================================
describe('roleValue (firestore.rules mirror)', () => {
  it('returns 100 for founder', () => {
    expect(roleValue('founder')).toBe(100);
  });

  it('returns 80 for admin', () => {
    expect(roleValue('admin')).toBe(80);
  });

  it('returns 60 for manager', () => {
    expect(roleValue('manager')).toBe(60);
  });

  it('returns 40 for operator', () => {
    expect(roleValue('operator')).toBe(40);
  });

  it('returns 20 for viewer', () => {
    expect(roleValue('viewer')).toBe(20);
  });

  it('returns 0 for unknown role', () => {
    expect(roleValue('unknown')).toBe(0);
    expect(roleValue('')).toBe(0);
  });
});

// ==========================================
// Role hierarchy consistency
// ==========================================
describe('Role hierarchy consistency between TypeScript and rules', () => {
  it('TypeScript ROLE_HIERARCHY matches rules roleValue for all roles', () => {
    const allRoles: UserRole[] = ['founder', 'admin', 'manager', 'operator', 'viewer'];
    for (const role of allRoles) {
      expect(ROLE_HIERARCHY[role]).toBe(roleValue(role));
    }
  });

  it('hasMinRole correctly checks founder >= admin', () => {
    expect(hasMinRole('founder', 'admin')).toBe(true);
  });

  it('hasMinRole correctly checks admin >= admin', () => {
    expect(hasMinRole('admin', 'admin')).toBe(true);
  });

  it('hasMinRole correctly rejects manager < admin', () => {
    expect(hasMinRole('manager', 'admin')).toBe(false);
  });

  it('hasMinRole correctly checks manager >= operator', () => {
    expect(hasMinRole('manager', 'operator')).toBe(true);
  });

  it('hasMinRole correctly rejects viewer < operator', () => {
    expect(hasMinRole('viewer', 'operator')).toBe(false);
  });

  it('hasMinRole correctly checks viewer >= viewer', () => {
    expect(hasMinRole('viewer', 'viewer')).toBe(true);
  });

  it('hasMinRole rejects unknown role for any minimum', () => {
    expect(hasMinRole('unknown', 'viewer')).toBe(false);
  });
});

// ==========================================
// Firestore rules coverage
// ==========================================
describe('Firestore rules file coverage', () => {
  const rulesPath = path.resolve(__dirname, '../../firestore.rules');
  let rulesContent: string;

  try {
    rulesContent = fs.readFileSync(rulesPath, 'utf-8');
  } catch {
    rulesContent = '';
  }

  // All collections that must be covered by security rules
  const expectedCollections = [
    'users',
    'businesses',
    'inviteCodes',
    'clients',
    'appointments',
    'services',
    'products',
    'stockMovements',
    'sales',
    'transactions',
    'bankAccounts',
    'kanbanBoards',
    'kanbanCards',
    'crmContacts',
    'crmDeals',
    'crmActivities',
    'fiscalDocuments',
    'conversations',
    'conversationMessages',
    'saasApiKeys',
  ];

  it('firestore.rules file exists and is non-empty', () => {
    expect(rulesContent.length).toBeGreaterThan(0);
  });

  for (const collectionName of expectedCollections) {
    it(`covers the "${collectionName}" collection`, () => {
      expect(rulesContent).toContain(collectionName);
    });
  }

  it('has a catch-all deny rule for unmatched paths', () => {
    expect(rulesContent).toContain('match /{document=**}');
    expect(rulesContent).toContain('allow read, write: if false');
  });

  it('defines the roleValue helper function', () => {
    expect(rulesContent).toContain('function roleValue(role)');
  });

  it('defines the isAuthenticated helper function', () => {
    expect(rulesContent).toContain('function isAuthenticated()');
  });

  it('defines the belongsToBusiness helper function', () => {
    expect(rulesContent).toContain('function belongsToBusiness(businessId)');
  });

  it('defines the isOwnBusiness helper function', () => {
    expect(rulesContent).toContain('function isOwnBusiness()');
  });

  it('defines the hasMinRole helper function', () => {
    expect(rulesContent).toContain('function hasMinRole(minRole)');
  });

  it('defines the isAdmin helper function', () => {
    expect(rulesContent).toContain('function isAdmin()');
  });

  it('defines the isManager helper function', () => {
    expect(rulesContent).toContain('function isManager()');
  });

  it('defines the isOperator helper function', () => {
    expect(rulesContent).toContain('function isOperator()');
  });

  it('fiscal documents cannot be deleted (legal requirement)', () => {
    // The rules contain "allow delete: if false;" for fiscalDocuments
    // We verify the pattern exists in the rules
    const fiscalSection = rulesContent.substring(
      rulesContent.indexOf('FISCAL DOCUMENTS'),
      rulesContent.indexOf('CONVERSATIONS COLLECTION')
    );
    expect(fiscalSection).toContain('allow delete: if false');
  });

  it('stock movements are immutable (no update or delete)', () => {
    const stockSection = rulesContent.substring(
      rulesContent.indexOf('STOCK MOVEMENTS'),
      rulesContent.indexOf('SALES COLLECTION')
    );
    expect(stockSection).toContain('allow update: if false');
    expect(stockSection).toContain('allow delete: if false');
  });
});
