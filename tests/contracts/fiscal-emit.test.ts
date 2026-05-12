/**
 * Contrato Zod de POST /api/fiscal/emit — testes de shape positivos e
 * negativos contra payloads canônicos das UIs (EmitirNotaDialog, PDVModule).
 *
 * Objetivo: garantir que mudanças no schema não quebrem silenciosamente os
 * fluxos reais. Se a UI for refatorada e mandar campo novo, o schema
 * (passthrough) aceita; mas se algum campo obrigatório for removido, o teste
 * falha cedo.
 */

import { describe, it, expect } from 'vitest';
import { EmitFiscalRequestSchema } from '@/lib/contracts/api/fiscal/emit';

describe('EmitFiscalRequestSchema — NFe canonical payload', () => {
  const baseNfe = {
    type: 'nfe' as const,
    businessId: 'biz_123',
    items: [
      {
        description: 'Produto teste',
        ncm: '12345678',
        cfop: '5102',
        unit: 'UN',
        quantity: 2,
        unitPrice: 100,
        barcode: '7891234567890',
        cest: undefined,
        icmsOrigem: '0',
      },
    ],
    payments: [{ method: 'pix', amount: 200 }],
    recipient: {
      document: '12345678000199',
      name: 'Cliente PJ',
      inscricaoEstadual: '123456789',
      indicadorIE: '1' as const,
      address: {
        logradouro: 'Rua A',
        numero: '100',
        bairro: 'Centro',
        codigoMunicipio: '4314902',
        municipio: 'Porto Alegre',
        uf: 'RS',
        cep: '90010100',
      },
    },
    naturezaOperacao: 'VENDA DE MERCADORIA',
    finalidadeEmissao: 1,
    consumidorFinal: 0,
    presencaComprador: 9,
  };

  it('aceita payload canônico de NFe (EmitirNotaDialog)', () => {
    const result = EmitFiscalRequestSchema.safeParse(baseNfe);
    expect(result.success).toBe(true);
  });

  it('rejeita NFe sem items', () => {
    const result = EmitFiscalRequestSchema.safeParse({ ...baseNfe, items: [] });
    expect(result.success).toBe(false);
  });

  it('rejeita NFe com quantity zero', () => {
    const result = EmitFiscalRequestSchema.safeParse({
      ...baseNfe,
      items: [{ ...baseNfe.items[0], quantity: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita NFe com unitPrice negativo', () => {
    const result = EmitFiscalRequestSchema.safeParse({
      ...baseNfe,
      items: [{ ...baseNfe.items[0], unitPrice: -1 }],
    });
    expect(result.success).toBe(false);
  });

  it('aceita NFe sem recipient (auto consumidor)', () => {
    const { recipient: _, ...rest } = baseNfe;
    const result = EmitFiscalRequestSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it('aceita item só com productId — enrichment server-side cobre campos comerciais', () => {
    const result = EmitFiscalRequestSchema.safeParse({
      ...baseNfe,
      items: [
        {
          productId: 'prod_xyz',
          quantity: 1,
          unitPrice: 50,
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('EmitFiscalRequestSchema — NFCe canonical payload', () => {
  it('aceita NFCe minimal (PDVModule)', () => {
    const result = EmitFiscalRequestSchema.safeParse({
      type: 'nfce',
      businessId: 'biz_123',
      items: [
        {
          description: 'Pizza',
          quantity: 1,
          unitPrice: 45,
          unit: 'UN',
          ncm: '21069090',
          cfop: 5102, // number permitido
          barcode: '7891000000000',
        },
      ],
      paymentMethod: 'dinheiro',
      paymentValue: 45,
      cpfConsumidor: '12345678900',
      nomeConsumidor: 'João',
      presencaComprador: 1, // number permitido
      naturezaOperacao: 'VENDA AO CONSUMIDOR FINAL',
    });
    expect(result.success).toBe(true);
  });

  it('aceita NFCe com payments[] e sem consumidor', () => {
    const result = EmitFiscalRequestSchema.safeParse({
      type: 'nfce',
      businessId: 'biz_123',
      items: [{ description: 'Item', quantity: 1, unitPrice: 10 }],
      payments: [
        { method: 'pix', amount: 5 },
        { method: 'dinheiro', amount: 5 },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('EmitFiscalRequestSchema — NFSe canonical payload', () => {
  it('aceita NFSe minimal (EmitirNotaDialog)', () => {
    const result = EmitFiscalRequestSchema.safeParse({
      type: 'nfse',
      businessId: 'biz_123',
      valorServicos: 500,
      aliquotaIss: 5,
      codigoServico: '0101',
      codigoServicoMunicipal: '01.01',
      discriminacao: 'Consultoria',
      issRetido: false,
      tomador: {
        cnpj: '12345678000199',
        nome: 'Cliente Tomador',
        email: 'cli@x.com',
        // campo extra (telefone) passa via passthrough
        telefone: '51999998888',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejeita NFSe sem valorServicos', () => {
    const result = EmitFiscalRequestSchema.safeParse({
      type: 'nfse',
      businessId: 'biz_123',
    });
    expect(result.success).toBe(false);
  });

  it('rejeita NFSe com aliquotaIss > 100', () => {
    const result = EmitFiscalRequestSchema.safeParse({
      type: 'nfse',
      businessId: 'biz_123',
      valorServicos: 100,
      aliquotaIss: 150,
    });
    expect(result.success).toBe(false);
  });
});

describe('EmitFiscalRequestSchema — discriminator + base validations', () => {
  it('rejeita type inválido', () => {
    const result = EmitFiscalRequestSchema.safeParse({
      type: 'nfx',
      businessId: 'biz_123',
    });
    expect(result.success).toBe(false);
  });

  it('rejeita ausência de businessId', () => {
    const result = EmitFiscalRequestSchema.safeParse({
      type: 'nfe',
      items: [{ quantity: 1, unitPrice: 10 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita businessId vazio', () => {
    const result = EmitFiscalRequestSchema.safeParse({
      type: 'nfse',
      businessId: '',
      valorServicos: 100,
    });
    expect(result.success).toBe(false);
  });

  it('coerce strings numéricas para number em quantity/unitPrice', () => {
    const result = EmitFiscalRequestSchema.safeParse({
      type: 'nfce',
      businessId: 'biz_123',
      items: [{ description: 'X', quantity: '2', unitPrice: '15.50' }],
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'nfce') {
      expect(result.data.items[0].quantity).toBe(2);
      expect(result.data.items[0].unitPrice).toBe(15.5);
    }
  });
});
