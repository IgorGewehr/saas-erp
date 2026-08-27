import { describe, it, expect } from 'vitest';
import {
  ROLE_HIERARCHY,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
  INTEGRATION_PROVIDERS,
  API_KEY_SCOPES,
  USER_STATUS_LABELS,
  COMPANY_TYPE_LABELS,
} from '@/lib/types/index';
import type {
  UserRole,
  UserStatus,
  IntegrationProvider,
  ApiKeyScope,
} from '@/lib/types/index';

// ==========================================
// ROLE_HIERARCHY
// ==========================================
describe('ROLE_HIERARCHY', () => {
  it('assigns correct numeric values to each role', () => {
    expect(ROLE_HIERARCHY.founder).toBe(100);
    expect(ROLE_HIERARCHY.admin).toBe(80);
    expect(ROLE_HIERARCHY.manager).toBe(60);
    expect(ROLE_HIERARCHY.operator).toBe(40);
    expect(ROLE_HIERARCHY.viewer).toBe(20);
  });

  it('maintains strict ordering: founder > admin > manager > operator > viewer', () => {
    expect(ROLE_HIERARCHY.founder).toBeGreaterThan(ROLE_HIERARCHY.admin);
    expect(ROLE_HIERARCHY.admin).toBeGreaterThan(ROLE_HIERARCHY.manager);
    expect(ROLE_HIERARCHY.manager).toBeGreaterThan(ROLE_HIERARCHY.operator);
    expect(ROLE_HIERARCHY.operator).toBeGreaterThan(ROLE_HIERARCHY.viewer);
  });

  it('has exactly 5 roles', () => {
    expect(Object.keys(ROLE_HIERARCHY)).toHaveLength(5);
  });

  it('contains all expected role keys', () => {
    const expectedRoles: UserRole[] = ['founder', 'admin', 'manager', 'operator', 'viewer'];
    for (const role of expectedRoles) {
      expect(ROLE_HIERARCHY).toHaveProperty(role);
    }
  });
});

// ==========================================
// ROLE_LABELS
// ==========================================
describe('ROLE_LABELS', () => {
  it('has a label for every role in ROLE_HIERARCHY', () => {
    for (const role of Object.keys(ROLE_HIERARCHY)) {
      expect(ROLE_LABELS).toHaveProperty(role);
      expect(typeof ROLE_LABELS[role as UserRole]).toBe('string');
      expect(ROLE_LABELS[role as UserRole].length).toBeGreaterThan(0);
    }
  });

  it('has correct Portuguese labels', () => {
    expect(ROLE_LABELS.founder).toBe('Fundador');
    expect(ROLE_LABELS.admin).toBe('Administrador');
    expect(ROLE_LABELS.manager).toBe('Gerente');
    expect(ROLE_LABELS.operator).toBe('Operador');
    expect(ROLE_LABELS.viewer).toBe('Visualizador');
  });

  it('has exactly 5 entries', () => {
    expect(Object.keys(ROLE_LABELS)).toHaveLength(5);
  });
});

// ==========================================
// ROLE_DESCRIPTIONS
// ==========================================
describe('ROLE_DESCRIPTIONS', () => {
  it('has a description for every role in ROLE_HIERARCHY', () => {
    for (const role of Object.keys(ROLE_HIERARCHY)) {
      expect(ROLE_DESCRIPTIONS).toHaveProperty(role);
      expect(typeof ROLE_DESCRIPTIONS[role as UserRole]).toBe('string');
      expect(ROLE_DESCRIPTIONS[role as UserRole].length).toBeGreaterThan(0);
    }
  });

  it('has exactly 5 entries', () => {
    expect(Object.keys(ROLE_DESCRIPTIONS)).toHaveLength(5);
  });

  it('descriptions are non-empty strings', () => {
    for (const desc of Object.values(ROLE_DESCRIPTIONS)) {
      expect(desc.trim().length).toBeGreaterThan(0);
    }
  });
});

// ==========================================
// USER_STATUS_LABELS
// ==========================================
describe('USER_STATUS_LABELS', () => {
  it('has labels for all user statuses', () => {
    const expectedStatuses: UserStatus[] = ['online', 'busy', 'invisible', 'offline'];
    for (const status of expectedStatuses) {
      expect(USER_STATUS_LABELS).toHaveProperty(status);
      expect(typeof USER_STATUS_LABELS[status]).toBe('string');
    }
  });

  it('has correct Portuguese labels', () => {
    expect(USER_STATUS_LABELS.online).toBe('Online');
    expect(USER_STATUS_LABELS.busy).toBe('Ocupado');
    expect(USER_STATUS_LABELS.invisible).toBe('Invisível');
    expect(USER_STATUS_LABELS.offline).toBe('Offline');
  });

  it('has exactly 4 entries', () => {
    expect(Object.keys(USER_STATUS_LABELS)).toHaveLength(4);
  });
});

// ==========================================
// INTEGRATION_PROVIDERS
// ==========================================
describe('INTEGRATION_PROVIDERS', () => {
  const expectedProviders: IntegrationProvider[] = [
    'stripe', 'vercel', 'resend', 'sentry', 'cloudflare', 'aws', 'supabase', 'godaddy',
  ];

  it('has all expected providers', () => {
    for (const provider of expectedProviders) {
      expect(INTEGRATION_PROVIDERS).toHaveProperty(provider);
    }
  });

  it('has exactly 8 providers', () => {
    expect(Object.keys(INTEGRATION_PROVIDERS)).toHaveLength(8);
  });

  it('each provider has the required structure', () => {
    for (const [key, config] of Object.entries(INTEGRATION_PROVIDERS)) {
      expect(config).toHaveProperty('name');
      expect(config).toHaveProperty('description');
      expect(config).toHaveProperty('icon');
      expect(config).toHaveProperty('color');
      expect(config).toHaveProperty('bgColor');
      expect(config).toHaveProperty('darkBgColor');
      expect(config).toHaveProperty('fields');
      expect(typeof config.name).toBe('string');
      expect(typeof config.description).toBe('string');
      expect(typeof config.icon).toBe('string');
      expect(typeof config.color).toBe('string');
      expect(Array.isArray(config.fields)).toBe(true);
      expect(config.fields.length).toBeGreaterThan(0);
    }
  });

  it('each provider field has key, label, and placeholder', () => {
    for (const config of Object.values(INTEGRATION_PROVIDERS)) {
      for (const field of config.fields) {
        expect(field).toHaveProperty('key');
        expect(field).toHaveProperty('label');
        expect(field).toHaveProperty('placeholder');
        expect(typeof field.key).toBe('string');
        expect(typeof field.label).toBe('string');
        expect(typeof field.placeholder).toBe('string');
      }
    }
  });

  it('stripe has the correct name', () => {
    expect(INTEGRATION_PROVIDERS.stripe.name).toBe('Stripe');
  });

  it('vercel has the correct name', () => {
    expect(INTEGRATION_PROVIDERS.vercel.name).toBe('Vercel');
  });

  it('aws has two fields (access key and secret)', () => {
    expect(INTEGRATION_PROVIDERS.aws.fields).toHaveLength(2);
  });
});

// ==========================================
// API_KEY_SCOPES
// ==========================================
describe('API_KEY_SCOPES', () => {
  const expectedScopes: ApiKeyScope[] = [
    'read:clients', 'write:clients',
    'read:appointments', 'write:appointments',
    'read:financial', 'write:financial',
    'read:products', 'write:products',
    'read:purchases', 'write:purchases',
    'read:kanban', 'write:kanban',
    'read:crm', 'write:crm',
    'read:sales', 'write:sales',
    'admin:all',
  ];

  it('has all expected scopes', () => {
    for (const scope of expectedScopes) {
      expect(API_KEY_SCOPES).toHaveProperty(scope);
    }
  });

  it('each scope has a label and description', () => {
    for (const [key, value] of Object.entries(API_KEY_SCOPES)) {
      expect(value).toHaveProperty('label');
      expect(value).toHaveProperty('description');
      expect(typeof value.label).toBe('string');
      expect(typeof value.description).toBe('string');
      expect(value.label.length).toBeGreaterThan(0);
      expect(value.description.length).toBeGreaterThan(0);
    }
  });

  it('read/write scopes come in pairs', () => {
    const resources = ['clients', 'appointments', 'financial', 'products', 'purchases', 'kanban', 'crm', 'sales'];
    for (const resource of resources) {
      expect(API_KEY_SCOPES).toHaveProperty(`read:${resource}`);
      expect(API_KEY_SCOPES).toHaveProperty(`write:${resource}`);
    }
  });

  it('has admin:all as a super scope', () => {
    expect(API_KEY_SCOPES['admin:all']).toBeDefined();
    expect(API_KEY_SCOPES['admin:all'].label.length).toBeGreaterThan(0);
  });
});

// ==========================================
// COMPANY_TYPE_LABELS
// ==========================================
describe('COMPANY_TYPE_LABELS', () => {
  it('has all expected company types', () => {
    const expectedTypes = ['mei', 'me', 'epp', 'ltda', 'eireli', 'sa', 'individual'];
    for (const type of expectedTypes) {
      expect(COMPANY_TYPE_LABELS).toHaveProperty(type);
    }
  });

  it('has exactly 7 entries', () => {
    expect(Object.keys(COMPANY_TYPE_LABELS)).toHaveLength(7);
  });

  it('all labels are non-empty strings', () => {
    for (const label of Object.values(COMPANY_TYPE_LABELS)) {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
