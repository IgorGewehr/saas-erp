import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Business } from '@/lib/types';
import {
  normalizeDfeDistributionResponse,
  type SefazDfeCapabilities,
} from '@/lib/services/sefaz-gateway';
import {
  buildPurchaseFiscalDiagnostics,
  purchaseFiscalInboxId,
} from '@/lib/services/purchase-fiscal-sync-admin';

const capabilities: SefazDfeCapabilities = {
  provider: 'sefaz_gateway',
  configured: true,
  distribution: true,
  manifestation: true,
  download: true,
};

function business(overrides: Partial<Business> = {}): Business {
  return {
    id: 'biz-1',
    razaoSocial: 'Mercado Exemplo Ltda',
    nomeFantasia: 'Mercado Exemplo',
    cnpj: '99.876.543/0001-11',
    crt: '1',
    endereco: {} as Business['endereco'],
    phone: '',
    email: '',
    ownerUserId: 'owner-1',
    memberIds: ['owner-1'],
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    fiscal: {
      certificate: {
        serialNumber: '123',
        subject: 'CN=Mercado Exemplo',
        validFrom: '2026-01-01T00:00:00.000Z',
        expiresAt: '2027-12-31T00:00:00.000Z',
        storagePath: 'businesses/biz-1/certificates/a1.pfx',
        uploadedAt: '2026-01-01T00:00:00.000Z',
      },
      nfeConfig: { series: '1', nextNumber: 1, environment: 'producao' },
      ibgeCodigoMunicipio: '3550308',
    },
    ...overrides,
  };
}

describe('gateway de distribuição fiscal', () => {
  it('normaliza contratos em português e infere paginação por NSU', () => {
    const response = normalizeDfeDistributionResponse({
      success: true,
      data: {
        ultNSU: '000000000000123',
        maxNSU: '000000000000125',
        documentos: [{
          NSU: '000000000000123',
          tipo: 'resNFe_v1.01.xsd',
          conteudo: '<resNFe><chNFe>35260812345678000199550010000001231000001234</chNFe></resNFe>',
        }],
      },
    });

    expect(response).toMatchObject({ ultimoNsu: '000000000000123', maxNsu: '000000000000125', hasMore: true });
    expect(response.documents[0]).toMatchObject({
      accessKey: '35260812345678000199550010000001231000001234',
      nsu: '000000000000123',
      schema: 'resNFe_v1.01.xsd',
    });
  });

  it('recusa resposta sem ultimoNsu para preservar o cursor anterior', () => {
    expect(() => normalizeDfeDistributionResponse({ documents: [], maxNsu: '10' }))
      .toThrow(/cursor anterior foi preservado/i);
  });
});
describe('diagnóstico e isolamento da caixa fiscal', () => {
  it('habilita sincronização com CNPJ, certificado, IBGE, ambiente e provedor válidos', () => {
    const diagnostics = buildPurchaseFiscalDiagnostics(business(), capabilities, new Date('2026-08-27T12:00:00.000Z'));
    expect(diagnostics).toMatchObject({
      cnpj: '99876543000111',
      cUFAutor: '35',
      environment: 'producao',
      canSync: true,
      manualUploadAvailable: true,
    });
  });

  it('bloqueia somente a sincronização quando o provedor não está configurado e preserva upload manual', () => {
    const diagnostics = buildPurchaseFiscalDiagnostics(business(), {
      ...capabilities,
      configured: false,
      distribution: false,
      manifestation: false,
      download: false,
    }, new Date('2026-08-27T12:00:00.000Z'));
    expect(diagnostics.canSync).toBe(false);
    expect(diagnostics.manualUploadAvailable).toBe(true);
    expect(diagnostics.issues).toContainEqual(expect.objectContaining({ code: 'PROVIDER_DISTRIBUTION_UNAVAILABLE', severity: 'error' }));
  });

  it('gera IDs determinísticos, mas diferentes entre tenants', () => {
    const key = '35260812345678000199550010000001231000001234';
    expect(purchaseFiscalInboxId('biz-1', key)).toBe(purchaseFiscalInboxId('biz-1', key));
    expect(purchaseFiscalInboxId('biz-1', key)).not.toBe(purchaseFiscalInboxId('biz-2', key));
  });
});

describe('fronteiras operacionais da M01.6c', () => {
  const service = readFileSync('lib/services/purchase-fiscal-sync-admin.ts', 'utf8');
  const rules = readFileSync('firestore.rules', 'utf8');

  it('sincronização não confirma compra nem movimenta estoque/financeiro', () => {
    const syncBody = service.slice(
      service.indexOf('export async function syncPurchaseFiscalInboxAdmin'),
      service.indexOf('async function inboxItem'),
    );
    expect(syncBody).not.toContain('confirmPurchaseNoteAdmin');
    expect(syncBody).not.toContain('applyStockOperationAdmin');
    expect(syncBody).not.toContain('linkPurchaseFinancialAdmin');
  });

  it('caixa fiscal e cursor são inacessíveis pelo SDK cliente', () => {
    expect(rules).toMatch(/match \/purchaseFiscalInbox\/\{documentId\}[\s\S]*?allow read, write: if false;/);
    expect(rules).toMatch(/match \/purchaseFiscalSyncStates\/\{businessId\}[\s\S]*?allow read, write: if false;/);
  });
});
