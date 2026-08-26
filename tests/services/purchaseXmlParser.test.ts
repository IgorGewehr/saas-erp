import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePurchaseNFeXml, PurchaseXmlValidationError } from '@/lib/services/purchase-xml-parser';

const fixture = readFileSync('tests/fixtures/m01/nfe-compra-caracterizacao.xml', 'utf8');

describe('purchase XML parser', () => {
  it('valida e normaliza a fixture com custos acessórios e lote', () => {
    const parsed = parsePurchaseNFeXml({ xml: fixture, expectedRecipientDocument: '99.876.543/0001-11' });
    expect(parsed).toMatchObject({
      accessKey: '35260812345678000199550010000001231123456789',
      numero: '123',
      serie: '1',
      recipientDocument: '99876543000111',
      supplier: { document: '12345678000199', name: 'Fornecedor Fixture LTDA' },
      totals: { products: 350, freight: 20, discount: 10, ipi: 15, invoice: 375 },
    });
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]).toMatchObject({
      lineId: '1', supplierProductCode: 'FORN-001', gtin: '7891234567895',
      purchaseUnit: 'KG', purchaseQuantity: 10, unitPrice: 30, productTotal: 300,
      lot: { code: 'LOTE-CAFE-001', manufacturedAt: '2026-08-01', expiresAt: '2027-08-01' },
    });
    expect(parsed.items[0].allocatedCosts).toEqual({
      freight: 17.14, insurance: 0, discount: 8.57, other: 0, st: 0, ipi: 12.86,
    });
    expect(parsed.items[1].allocatedCosts).toEqual({
      freight: 2.86, insurance: 0, discount: 1.43, other: 0, st: 0, ipi: 2.14,
    });
    expect(parsed.items[0].landedUnitCost).toBe(32.14);
    expect(parsed.items[1].landedUnitCost).toBe(10.71);
    expect(parsed.xmlSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejeita XML destinado a outra empresa', () => {
    expect(() => parsePurchaseNFeXml({ xml: fixture, expectedRecipientDocument: '11111111000111' }))
      .toThrowError(PurchaseXmlValidationError);
    try {
      parsePurchaseNFeXml({ xml: fixture, expectedRecipientDocument: '11111111000111' });
    } catch (cause) {
      expect((cause as PurchaseXmlValidationError).issues).toContain('A NF-e pertence a outro destinatário.');
    }
  });

  it('rejeita chave divergente, totais adulterados e declarações externas', () => {
    const wrongKey = fixture.replace(
      '<chNFe>35260812345678000199550010000001231123456789</chNFe>',
      '<chNFe>35260812345678000199550010000001231123456788</chNFe>',
    );
    expect(() => parsePurchaseNFeXml({ xml: wrongKey, expectedRecipientDocument: '99876543000111' }))
      .toThrow(/chave do protocolo diverge/i);
    const wrongTotal = fixture.replace('<vProd>350.00</vProd>', '<vProd>351.00</vProd>');
    expect(() => parsePurchaseNFeXml({ xml: wrongTotal, expectedRecipientDocument: '99876543000111' }))
      .toThrow(/soma dos itens diverge/i);
    const external = fixture.replace('<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]>');
    expect(() => parsePurchaseNFeXml({ xml: external, expectedRecipientDocument: '99876543000111' }))
      .toThrow(/declarações externas/i);
  });
});
