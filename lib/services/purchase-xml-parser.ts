import { createHash } from 'node:crypto';
import { PurchaseNoteItemV2Schema, type PurchaseNoteItemV2 } from '@/lib/contracts/domain/purchaseNoteV2';

export interface ParsedPurchaseSupplier {
  document: string;
  documentType: 'cpf' | 'cnpj';
  name: string;
  tradeName?: string;
  stateRegistration?: string;
  phone?: string;
  address?: {
    logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    municipio?: string;
    uf?: string;
    cep?: string;
  };
}

export interface ParsedPurchaseTotals {
  products: number;
  freight: number;
  insurance: number;
  discount: number;
  other: number;
  st: number;
  ipi: number;
  invoice: number;
}

export interface ParsedPurchaseXml {
  accessKey: string;
  numero: string;
  serie: string;
  issueDate: string;
  recipientDocument: string;
  supplier: ParsedPurchaseSupplier;
  items: PurchaseNoteItemV2[];
  totals: ParsedPurchaseTotals;
  xmlSha256: string;
  warnings: string[];
}

export class PurchaseXmlValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join(' '));
    this.name = 'PurchaseXmlValidationError';
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function block(xml: string, name: string): string {
  const match = xml.match(new RegExp(`<(?:[^:>]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[^:>]+:)?${name}>`, 'i'));
  return match?.[1] ?? '';
}

function blocks(xml: string, name: string): Array<{ attrs: string; body: string }> {
  const regex = new RegExp(`<(?:[^:>]+:)?${name}(\\s[^>]*)?>([\\s\\S]*?)</(?:[^:>]+:)?${name}>`, 'gi');
  const result: Array<{ attrs: string; body: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) result.push({ attrs: match[1] ?? '', body: match[2] });
  return result;
}

function text(xml: string, name: string): string {
  const value = block(xml, name);
  return value ? decodeXml(value.replace(/<[^>]+>/g, '')) : '';
}

function number(xml: string, name: string): number {
  const parsed = Number(text(xml, name).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function allocation(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const roundedTotal = round2(total);
  if (roundedTotal === 0) return weights.map(() => 0);
  const weightTotal = weights.reduce((sum, value) => sum + Math.max(value, 0), 0);
  if (weightTotal <= 0) {
    const equal = round2(roundedTotal / weights.length);
    let allocated = 0;
    return weights.map((_, index) => {
      const value = index === weights.length - 1 ? round2(roundedTotal - allocated) : equal;
      allocated = round2(allocated + value);
      return value;
    });
  }
  let allocated = 0;
  return weights.map((weight, index) => {
    const value = index === weights.length - 1
      ? round2(roundedTotal - allocated)
      : round2(roundedTotal * Math.max(weight, 0) / weightTotal);
    allocated = round2(allocated + value);
    return value;
  });
}

function supplierFromXml(xml: string): ParsedPurchaseSupplier {
  const emit = block(xml, 'emit');
  const address = block(emit, 'enderEmit');
  const document = digits(text(emit, 'CNPJ') || text(emit, 'CPF'));
  return {
    document,
    documentType: document.length === 11 ? 'cpf' : 'cnpj',
    name: text(emit, 'xNome'),
    tradeName: text(emit, 'xFant') || undefined,
    stateRegistration: text(emit, 'IE') || undefined,
    phone: text(address, 'fone') || undefined,
    address: {
      logradouro: text(address, 'xLgr') || undefined,
      numero: text(address, 'nro') || undefined,
      complemento: text(address, 'xCpl') || undefined,
      bairro: text(address, 'xBairro') || undefined,
      municipio: text(address, 'xMun') || undefined,
      uf: text(address, 'UF') || undefined,
      cep: text(address, 'CEP') || undefined,
    },
  };
}

function totalsFromXml(xml: string): ParsedPurchaseTotals {
  const total = block(block(xml, 'total'), 'ICMSTot');
  return {
    products: round2(number(total, 'vProd')),
    freight: round2(number(total, 'vFrete')),
    insurance: round2(number(total, 'vSeg')),
    discount: round2(number(total, 'vDesc')),
    other: round2(number(total, 'vOutro')),
    st: round2(number(total, 'vST')),
    ipi: round2(number(total, 'vIPI')),
    invoice: round2(number(total, 'vNF')),
  };
}

function rawItems(xml: string): Array<Omit<PurchaseNoteItemV2, 'allocatedCosts' | 'landedUnitCost'>> {
  return blocks(xml, 'det').map((entry, index) => {
    const product = block(entry.body, 'prod');
    const taxes = block(entry.body, 'imposto');
    const lot = block(product, 'rastro');
    const purchaseQuantity = number(product, 'qCom');
    const unitPrice = number(product, 'vUnCom');
    const lineId = entry.attrs.match(/nItem\s*=\s*["']([^"']+)["']/i)?.[1] ?? String(index + 1);
    const gtin = text(product, 'cEAN');
    return {
      lineId,
      supplierProductCode: text(product, 'cProd') || undefined,
      productName: text(product, 'xProd'),
      gtin: gtin && !/^SEM GTIN$/i.test(gtin) ? gtin : undefined,
      ncm: text(product, 'NCM') || undefined,
      cfop: text(product, 'CFOP') || undefined,
      purchaseUnit: text(product, 'uCom') || 'UN',
      purchaseQuantity,
      unitPrice,
      productTotal: round2(number(product, 'vProd')),
      taxes: {
        icms: number(block(taxes, 'ICMS'), 'vICMS') || undefined,
        ipi: number(block(taxes, 'IPI'), 'vIPI') || undefined,
        pis: number(block(taxes, 'PIS'), 'vPIS') || undefined,
        cofins: number(block(taxes, 'COFINS'), 'vCOFINS') || undefined,
      },
      action: 'pending' as const,
      stockUnit: text(product, 'uCom') || 'UN',
      conversionFactor: 1,
      stockQuantity: purchaseQuantity,
      importStatus: 'pending' as const,
      lot: text(lot, 'nLote') ? {
        code: text(lot, 'nLote'),
        manufacturedAt: text(lot, 'dFab') || undefined,
        expiresAt: text(lot, 'dVal') || undefined,
      } : undefined,
    };
  });
}

export function parsePurchaseNFeXml(input: {
  xml: string;
  expectedRecipientDocument: string;
}): ParsedPurchaseXml {
  const xml = input.xml.replace(/^\uFEFF/, '').trim();
  const issues: string[] = [];
  const warnings: string[] = [];
  if (!xml.startsWith('<') || !/<(?:[^:>]+:)?NFe[\s>]/i.test(xml)) issues.push('O arquivo não contém uma NF-e completa.');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) issues.push('O XML contém declarações externas não permitidas.');

  const infNFeTag = xml.match(/<(?:[^:>]+:)?infNFe\b[^>]*\bId=["']NFe(\d{44})["']/i)?.[1] ?? '';
  const protocolKey = digits(text(xml, 'chNFe'));
  const accessKey = protocolKey || infNFeTag;
  if (!/^\d{44}$/.test(accessKey)) issues.push('A chave de acesso da NF-e deve possuir 44 dígitos.');
  if (protocolKey && infNFeTag && protocolKey !== infNFeTag) issues.push('A chave do protocolo diverge da chave da NF-e.');

  const ide = block(xml, 'ide');
  if (text(ide, 'mod') !== '55') issues.push('Somente NF-e modelo 55 pode ser importada em Compras.');
  const numero = text(ide, 'nNF');
  const serie = text(ide, 'serie');
  const issueDate = text(ide, 'dhEmi') || text(ide, 'dEmi');
  if (!numero) issues.push('Número da NF-e ausente.');
  if (!serie) issues.push('Série da NF-e ausente.');
  if (!issueDate || Number.isNaN(new Date(issueDate).getTime())) issues.push('Data de emissão da NF-e inválida.');

  const supplier = supplierFromXml(xml);
  if (!supplier.name) issues.push('Razão social do emitente ausente.');
  if (![11, 14].includes(supplier.document.length)) issues.push('CPF/CNPJ do emitente inválido.');
  const recipient = block(xml, 'dest');
  const recipientDocument = digits(text(recipient, 'CNPJ') || text(recipient, 'CPF'));
  const expectedRecipient = digits(input.expectedRecipientDocument);
  if (![11, 14].includes(expectedRecipient.length)) issues.push('Cadastre o CPF/CNPJ da empresa antes de importar compras.');
  if (![11, 14].includes(recipientDocument.length)) issues.push('CPF/CNPJ do destinatário ausente ou inválido.');
  else if (expectedRecipient && recipientDocument !== expectedRecipient) issues.push('A NF-e pertence a outro destinatário.');
  if (supplier.document && supplier.document === recipientDocument) issues.push('Emitente e destinatário não podem ser o mesmo documento.');

  const authorizationStatus = text(block(xml, 'infProt'), 'cStat');
  if (authorizationStatus && !['100', '150'].includes(authorizationStatus)) {
    issues.push(`NF-e sem autorização válida na SEFAZ (cStat ${authorizationStatus}).`);
  } else if (!authorizationStatus) {
    warnings.push('XML sem protocolo de autorização; valide a origem do arquivo.');
  }

  const totals = totalsFromXml(xml);
  const sourceItems = rawItems(xml);
  if (sourceItems.length === 0) issues.push('A NF-e não possui itens de produto.');
  sourceItems.forEach((item, index) => {
    if (!item.productName) issues.push(`Item ${index + 1}: descrição ausente.`);
    if (item.purchaseQuantity <= 0) issues.push(`Item ${index + 1}: quantidade deve ser positiva.`);
    if (item.unitPrice < 0) issues.push(`Item ${index + 1}: preço unitário inválido.`);
    if (Math.abs(round2(item.purchaseQuantity * item.unitPrice) - item.productTotal) > 0.011) {
      issues.push(`Item ${index + 1}: total diverge de quantidade × preço unitário.`);
    }
  });
  const itemProducts = round2(sourceItems.reduce((sum, item) => sum + item.productTotal, 0));
  if (Math.abs(itemProducts - totals.products) > 0.02) issues.push('A soma dos itens diverge do total de produtos da NF-e.');
  const calculatedInvoice = round2(
    totals.products + totals.freight + totals.insurance + totals.other + totals.st + totals.ipi - totals.discount,
  );
  if (Math.abs(calculatedInvoice - totals.invoice) > 0.02) {
    warnings.push('O total da nota inclui componentes fiscais além do rateio básico; o valor oficial da NF-e foi preservado.');
  }
  if (issues.length) throw new PurchaseXmlValidationError(issues);

  const weights = sourceItems.map((item) => item.productTotal);
  const allocations = {
    freight: allocation(totals.freight, weights),
    insurance: allocation(totals.insurance, weights),
    discount: allocation(totals.discount, weights),
    other: allocation(totals.other, weights),
    st: allocation(totals.st, weights),
    ipi: allocation(totals.ipi, weights),
  };
  const items = sourceItems.map((item, index) => {
    const allocatedCosts = {
      freight: allocations.freight[index],
      insurance: allocations.insurance[index],
      discount: allocations.discount[index],
      other: allocations.other[index],
      st: allocations.st[index],
      ipi: allocations.ipi[index],
    };
    const landedTotal = item.productTotal + allocatedCosts.freight + allocatedCosts.insurance
      + allocatedCosts.other + allocatedCosts.st + allocatedCosts.ipi - allocatedCosts.discount;
    return PurchaseNoteItemV2Schema.parse({
      ...item,
      allocatedCosts,
      landedUnitCost: round2(landedTotal / item.stockQuantity),
    });
  });

  return {
    accessKey,
    numero,
    serie,
    issueDate,
    recipientDocument,
    supplier,
    items,
    totals,
    xmlSha256: createHash('sha256').update(xml).digest('hex'),
    warnings,
  };
}
