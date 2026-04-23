import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';

const SEFAZ_API_URL = process.env.SEFAZ_API_URL;
const SEFAZ_API_KEY = process.env.SEFAZ_API_KEY;

// Helper to extract data from XML using regex (same pattern as gestao-raiz)
function tag(xml: string, tagName: string): string {
  const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`));
  return match ? match[1].trim() : '';
}

function tagNum(xml: string, tagName: string): number {
  const val = tag(xml, tagName);
  return val ? parseFloat(val) : 0;
}

function formatCnpjCpf(doc: string): string {
  if (!doc) return '';
  const clean = doc.replace(/\D/g, '');
  if (clean.length === 14) return clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (clean.length === 11) return clean.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return doc;
}

function formatChave(chave: string): string {
  if (!chave) return '';
  return chave.replace(/(.{4})/g, '$1 ').trim();
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

interface DanfeData {
  modelo: string;
  chaveAcesso: string;
  numero: string;
  serie: string;
  dataEmissao: string;
  protocolo: string;
  tpAmb: string;
  emitente: {
    cnpj: string;
    nome: string;
    fantasia: string;
    ie: string;
    endereco: string;
    cidade: string;
    uf: string;
    cep: string;
  };
  destinatario?: {
    cpf?: string;
    cnpj?: string;
    nome: string;
  };
  itens: {
    num: string;
    codigo: string;
    descricao: string;
    ncm: string;
    cfop: string;
    un: string;
    qtd: string;
    vUnit: string;
    vTotal: string;
  }[];
  totais: {
    vProd: number;
    vDesc: number;
    vFrete: number;
    vSeg: number;
    vOutro: number;
    vNF: number;
    vBC: number;
    vICMS: number;
    vST: number;
    vIPI: number;
    vPIS: number;
    vCOFINS: number;
  };
  pagamentos: { tipo: string; valor: string }[];
  natOp: string;
  infAdic: string;
}

function extractDanfeData(xml: string): DanfeData {
  const modelo = tag(xml, 'mod');
  const chaveAcesso = tag(xml, 'chNFe') || (() => {
    const match = xml.match(/Id="NFe(\d{44})"/);
    return match ? match[1] : '';
  })();

  // Emitente
  const emitXml = tag(xml, 'emit');
  const emitEnd = tag(emitXml, 'enderEmit');

  // Destinatario
  const destXml = tag(xml, 'dest');

  // Items
  const detMatches = xml.match(/<det[^>]*>[\s\S]*?<\/det>/g) || [];
  const itens = detMatches.map((det, i) => {
    const prod = tag(det, 'prod');
    return {
      num: String(i + 1),
      codigo: tag(prod, 'cProd'),
      descricao: tag(prod, 'xProd'),
      ncm: tag(prod, 'NCM'),
      cfop: tag(prod, 'CFOP'),
      un: tag(prod, 'uCom'),
      qtd: tagNum(det, 'qCom').toFixed(4),
      vUnit: tagNum(det, 'vUnCom').toFixed(4),
      vTotal: tagNum(det, 'vProd').toFixed(2),
    };
  });

  // Totals
  const totalXml = tag(xml, 'ICMSTot');

  // Payments
  const pagMatches = xml.match(/<detPag>[\s\S]*?<\/detPag>/g) || [];
  const tpagLabels: Record<string, string> = {
    '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartao Credito', '04': 'Cartao Debito',
    '05': 'Credito Loja', '10': 'Vale Alimentacao', '11': 'Vale Refeicao',
    '12': 'Vale Presente', '13': 'Vale Combustivel', '15': 'Boleto',
    '16': 'Deposito', '17': 'PIX', '18': 'Transferencia', '99': 'Outros',
  };
  const pagamentos = pagMatches.map(p => ({
    tipo: tpagLabels[tag(p, 'tPag')] || tag(p, 'tPag'),
    valor: tagNum(p, 'vPag').toFixed(2),
  }));

  // Protocol
  const protocolo = tag(xml, 'nProt');
  const tpAmb = tag(xml, 'tpAmb');

  return {
    modelo,
    chaveAcesso,
    numero: tag(xml, 'nNF'),
    serie: tag(xml, 'serie'),
    dataEmissao: tag(xml, 'dhEmi'),
    protocolo,
    tpAmb,
    emitente: {
      cnpj: tag(emitXml, 'CNPJ'),
      nome: tag(emitXml, 'xNome'),
      fantasia: tag(emitXml, 'xFant'),
      ie: tag(emitXml, 'IE'),
      endereco: `${tag(emitEnd, 'xLgr')}, ${tag(emitEnd, 'nro')} - ${tag(emitEnd, 'xBairro')}`,
      cidade: tag(emitEnd, 'xMun'),
      uf: tag(emitEnd, 'UF'),
      cep: tag(emitEnd, 'CEP'),
    },
    destinatario: destXml ? {
      cpf: tag(destXml, 'CPF') || undefined,
      cnpj: tag(destXml, 'CNPJ') || undefined,
      nome: tag(destXml, 'xNome'),
    } : undefined,
    itens,
    totais: {
      vProd: tagNum(totalXml, 'vProd'),
      vDesc: tagNum(totalXml, 'vDesc'),
      vFrete: tagNum(totalXml, 'vFrete'),
      vSeg: tagNum(totalXml, 'vSeg'),
      vOutro: tagNum(totalXml, 'vOutro'),
      vNF: tagNum(totalXml, 'vNF'),
      vBC: tagNum(totalXml, 'vBC'),
      vICMS: tagNum(totalXml, 'vICMS'),
      vST: tagNum(totalXml, 'vST'),
      vIPI: tagNum(totalXml, 'vIPI'),
      vPIS: tagNum(totalXml, 'vPIS'),
      vCOFINS: tagNum(totalXml, 'vCOFINS'),
    },
    pagamentos,
    natOp: tag(xml, 'natOp'),
    infAdic: tag(xml, 'infCpl'),
  };
}

function generateDanfeNFCeHtml(data: DanfeData): string {
  const isHomolog = data.tpAmb === '2';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>DANFE NFCe #${data.numero}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', monospace; font-size: 10px; width: 80mm; margin: 0 auto; padding: 4mm; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .divider { border-top: 1px dashed #000; margin: 4px 0; }
  .header { margin-bottom: 4px; }
  .item { display: flex; justify-content: space-between; font-size: 9px; }
  .total { font-size: 14px; font-weight: bold; margin: 4px 0; }
  .key { font-size: 8px; word-break: break-all; }
  ${isHomolog ? '.homolog { background: #fef3cd; padding: 4px; text-align: center; font-weight: bold; color: #856404; margin-bottom: 4px; }' : ''}
  @media print { body { width: 80mm; } }
</style></head><body>
${isHomolog ? '<div class="homolog">EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</div>' : ''}
<div class="header center">
  <div class="bold">${data.emitente.fantasia || data.emitente.nome}</div>
  <div>${data.emitente.endereco}</div>
  <div>${data.emitente.cidade} - ${data.emitente.uf}</div>
  <div>CNPJ: ${formatCnpjCpf(data.emitente.cnpj)}</div>
  <div>IE: ${data.emitente.ie}</div>
</div>
<div class="divider"></div>
<div class="center bold">DANFE NFC-e</div>
<div class="center">Doc Auxiliar da Nota Fiscal Eletronica p/ Consumidor Final</div>
<div class="divider"></div>
<div style="font-size: 9px;">
${data.itens.map(i => `<div class="item"><span>${i.num}. ${i.descricao}</span></div><div class="item"><span>${i.qtd} ${i.un} x ${i.vUnit}</span><span>R$ ${i.vTotal}</span></div>`).join('')}
</div>
<div class="divider"></div>
<div class="item"><span>Subtotal</span><span>R$ ${data.totais.vProd.toFixed(2)}</span></div>
${data.totais.vDesc > 0 ? `<div class="item"><span>Desconto</span><span>-R$ ${data.totais.vDesc.toFixed(2)}</span></div>` : ''}
<div class="total center">TOTAL: R$ ${data.totais.vNF.toFixed(2)}</div>
<div class="divider"></div>
<div style="font-size: 9px;">
${data.pagamentos.map(p => `<div class="item"><span>${p.tipo}</span><span>R$ ${p.valor}</span></div>`).join('')}
</div>
<div class="divider"></div>
${data.destinatario ? `<div style="font-size: 9px;">Consumidor: ${data.destinatario.nome || ''} ${data.destinatario.cpf ? `CPF: ${formatCnpjCpf(data.destinatario.cpf)}` : ''}</div><div class="divider"></div>` : ''}
<div class="center key">Chave de Acesso:<br>${formatChave(data.chaveAcesso)}</div>
<div class="divider"></div>
<div class="center" style="font-size: 9px;">
  NFC-e n. ${data.numero} Serie ${data.serie}<br>
  Emissao: ${data.dataEmissao ? new Date(data.dataEmissao).toLocaleString('pt-BR') : '-'}<br>
  ${data.protocolo ? `Protocolo: ${data.protocolo}` : ''}
</div>
</body></html>`;
}

function generateDanfeNFeHtml(data: DanfeData): string {
  const isHomolog = data.tpAmb === '2';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>DANFE NFe #${data.numero}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 9px; max-width: 210mm; margin: 0 auto; padding: 10mm; }
  table { width: 100%; border-collapse: collapse; }
  td, th { border: 1px solid #333; padding: 2px 4px; vertical-align: top; }
  th { background: #f3f4f6; font-weight: 600; text-align: left; }
  .header { display: flex; justify-content: space-between; border: 2px solid #333; padding: 8px; margin-bottom: 4px; }
  .header-left { flex: 1; }
  .header-right { text-align: right; }
  .section { margin-bottom: 4px; }
  .section-title { background: #e5e7eb; padding: 2px 6px; font-weight: bold; font-size: 8px; border: 1px solid #333; }
  .key { font-size: 8px; font-family: monospace; letter-spacing: 1px; }
  .total-row { font-weight: bold; background: #f9fafb; }
  ${isHomolog ? '.homolog-banner { background: #fef3cd; border: 2px solid #f59e0b; padding: 6px; text-align: center; font-weight: bold; color: #856404; margin-bottom: 8px; font-size: 12px; }' : ''}
  @media print { body { padding: 5mm; } @page { margin: 5mm; } }
</style></head><body>
${isHomolog ? '<div class="homolog-banner">EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</div>' : ''}
<div class="header">
  <div class="header-left">
    <div style="font-size: 14px; font-weight: bold;">${data.emitente.fantasia || data.emitente.nome}</div>
    <div>${data.emitente.nome}</div>
    <div>${data.emitente.endereco}</div>
    <div>${data.emitente.cidade} - ${data.emitente.uf} | CEP: ${data.emitente.cep}</div>
    <div>CNPJ: ${formatCnpjCpf(data.emitente.cnpj)} | IE: ${data.emitente.ie}</div>
  </div>
  <div class="header-right">
    <div style="font-size: 16px; font-weight: bold;">DANFE</div>
    <div style="font-size: 8px;">Documento Auxiliar da<br>Nota Fiscal Eletronica</div>
    <div style="margin-top: 4px; font-size: 11px; font-weight: bold;">N.: ${data.numero}</div>
    <div>Serie: ${data.serie}</div>
    <div style="font-size: 8px;">Nat. Op.: ${data.natOp}</div>
  </div>
</div>

<div class="section">
  <div class="key" style="border: 1px solid #333; padding: 4px; text-align: center;">
    CHAVE DE ACESSO: ${formatChave(data.chaveAcesso)}
  </div>
</div>

${data.protocolo ? `<div class="section" style="font-size: 8px; border: 1px solid #333; padding: 2px 6px;">Protocolo: ${data.protocolo} | Emissao: ${data.dataEmissao ? new Date(data.dataEmissao).toLocaleString('pt-BR') : '-'}</div>` : ''}

${data.destinatario ? `
<div class="section">
  <div class="section-title">DESTINATARIO</div>
  <table>
    <tr>
      <td><strong>Nome:</strong> ${data.destinatario.nome}</td>
      <td><strong>${data.destinatario.cnpj ? 'CNPJ' : 'CPF'}:</strong> ${formatCnpjCpf(data.destinatario.cnpj || data.destinatario.cpf || '')}</td>
    </tr>
  </table>
</div>` : ''}

<div class="section">
  <div class="section-title">PRODUTOS / SERVICOS</div>
  <table>
    <thead>
      <tr>
        <th>#</th><th>Codigo</th><th>Descricao</th><th>NCM</th><th>CFOP</th><th>UN</th><th>Qtd</th><th>V.Unit</th><th>V.Total</th>
      </tr>
    </thead>
    <tbody>
      ${data.itens.map(i => `<tr><td>${i.num}</td><td>${i.codigo}</td><td>${i.descricao}</td><td>${i.ncm}</td><td>${i.cfop}</td><td>${i.un}</td><td style="text-align:right">${i.qtd}</td><td style="text-align:right">${i.vUnit}</td><td style="text-align:right">${i.vTotal}</td></tr>`).join('')}
    </tbody>
  </table>
</div>

<div class="section">
  <div class="section-title">TOTAIS</div>
  <table>
    <tr>
      <td>Base ICMS: ${formatCurrency(data.totais.vBC)}</td>
      <td>ICMS: ${formatCurrency(data.totais.vICMS)}</td>
      <td>BC ST: ${formatCurrency(data.totais.vST)}</td>
      <td>PIS: ${formatCurrency(data.totais.vPIS)}</td>
      <td>COFINS: ${formatCurrency(data.totais.vCOFINS)}</td>
    </tr>
    <tr class="total-row">
      <td>Produtos: ${formatCurrency(data.totais.vProd)}</td>
      <td>Desconto: ${formatCurrency(data.totais.vDesc)}</td>
      <td>Frete: ${formatCurrency(data.totais.vFrete)}</td>
      <td colspan="2" style="font-size: 12px; text-align: right;">TOTAL NF: ${formatCurrency(data.totais.vNF)}</td>
    </tr>
  </table>
</div>

<div class="section">
  <div class="section-title">PAGAMENTO</div>
  <table>
    <tr>
      ${data.pagamentos.map(p => `<td>${p.tipo}: R$ ${p.valor}</td>`).join('')}
    </tr>
  </table>
</div>

${data.infAdic ? `
<div class="section">
  <div class="section-title">INFORMACOES ADICIONAIS</div>
  <div style="border: 1px solid #333; padding: 4px; font-size: 8px; min-height: 20px;">${data.infAdic}</div>
</div>` : ''}

</body></html>`;
}

export async function POST(request: NextRequest) {
  try {
    // Auth: any authenticated user
    const auth = await verifyAuth(request);
    if (isAuthError(auth)) return auth;

    const body = await request.json();
    const { xml, type } = body as { xml?: string; type?: string };

    if (!xml) {
      return NextResponse.json({ error: 'XML e obrigatorio para gerar DANFE.' }, { status: 400 });
    }

    const data = extractDanfeData(xml);
    const isNFCe = (type === 'nfce') || data.modelo === '65';

    const html = isNFCe ? generateDanfeNFCeHtml(data) : generateDanfeNFeHtml(data);

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  } catch (error) {
    console.error('[DANFE] Erro:', error);
    return NextResponse.json(
      { error: 'Erro ao gerar DANFE.', details: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 },
    );
  }
}
