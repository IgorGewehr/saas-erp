import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { emitirNFe, emitirNFCe, CertificadoPayload } from '@/lib/services/sefaz-gateway';
import {
  getNextInvoiceNumber,
  getCRT,
  getPaymentCode,
  getICMSDefaults,
  getPISCOFINSDefaults,
} from '@/lib/fiscal/number-sequence';
import { getCertificadoPayload } from '@/lib/fiscal/certificate-manager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively strip keys whose value is undefined/null so SEFAZ never
 * receives `"campo": null` which causes XML schema rejections.
 */
function stripEmpty<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map(stripEmpty) as unknown as T;
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, stripEmpty(v)]),
    ) as T;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, businessId, ...data } = body;

    // 1. Validate required fields ------------------------------------------------

    if (!type || !['nfe', 'nfce'].includes(type)) {
      return NextResponse.json(
        { error: 'Tipo de documento fiscal invalido. Use: nfe ou nfce.' },
        { status: 400 },
      );
    }

    if (!businessId || typeof businessId !== 'string') {
      return NextResponse.json(
        { error: 'businessId e obrigatorio.' },
        { status: 400 },
      );
    }

    // 2. Fetch business + fiscal config -----------------------------------------

    const businessDoc = await adminDb.collection('businesses').doc(businessId).get();

    if (!businessDoc.exists) {
      return NextResponse.json(
        { error: 'Empresa nao encontrada.' },
        { status: 404 },
      );
    }

    const business = businessDoc.data()!;
    const fiscal = business.fiscal;

    if (!fiscal) {
      return NextResponse.json(
        { error: 'Configuracao fiscal nao encontrada para esta empresa.' },
        { status: 400 },
      );
    }

    // 3. Resolve certificate ----------------------------------------------------
    //    Prefer stored certificate via getCertificadoPayload. Fall back to
    //    certificado sent in the request body (useful for testing / first-time).

    let certificado: CertificadoPayload;

    if (data.certificado?.pfxBase64 && data.certificado?.password) {
      certificado = {
        pfxBase64: data.certificado.pfxBase64,
        password: data.certificado.password,
      };
    } else {
      try {
        certificado = await getCertificadoPayload(businessId);
      } catch (certError) {
        return NextResponse.json(
          {
            error: 'Certificado digital nao disponivel.',
            details: certError instanceof Error ? certError.message : 'Erro desconhecido',
          },
          { status: 400 },
        );
      }
    }

    // 4. Get next invoice number atomically -------------------------------------

    const { number, series } = await getNextInvoiceNumber(businessId, type);

    // 5. Determine tax regime and defaults --------------------------------------

    const crt = getCRT(fiscal.taxRegime);
    const icmsDefaults = getICMSDefaults(crt);
    const pisCofsDefaults = getPISCOFINSDefaults(crt, fiscal.taxRegime);

    // 6. Build items with tax blocks -------------------------------------------

    const rawItems = data.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return NextResponse.json(
        { error: 'Pelo menos um item e obrigatorio.' },
        { status: 400 },
      );
    }

    const items = rawItems.map((item: Record<string, unknown>, i: number) => {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unitPrice) || 0;
      const vProd = +(qty * price).toFixed(2);
      const vDesc = +(Number(item.discount) || 0).toFixed(2);
      const baseCalc = +(vProd - vDesc).toFixed(2);

      const result: Record<string, unknown> = {
        numero: i + 1,
        codigo: item.code || String(i + 1),
        descricao: item.description,
        ncm: item.ncm || '00000000',
        cfop: item.cfop || 5102,
        unidade: item.unit || 'UN',
        quantidade: qty,
        valorUnitario: price,
        valorTotal: vProd,
        valorDesconto: vDesc > 0 ? vDesc : undefined,
        codigoBarras: item.barcode || 'SEM GTIN',
        codigoBarrasTrib: item.barcode || 'SEM GTIN',
      };

      // -- ICMS --
      if (crt === '3') {
        const aliq = Number(item.icmsAliquota ?? icmsDefaults.aliquota);
        result.icms = {
          origem: Number(item.icmsOrigem ?? icmsDefaults.origem),
          cst: item.icmsSituacaoTributaria || icmsDefaults.cst,
          baseCalculo: baseCalc,
          aliquota: aliq,
          valor: +((baseCalc * aliq) / 100).toFixed(2),
        };
      } else {
        result.icms = {
          origem: Number(item.icmsOrigem ?? icmsDefaults.origem),
          csosn: item.icmsSituacaoTributaria || icmsDefaults.csosn,
        };
      }

      // -- PIS --
      const pisCST = item.pisSituacaoTributaria || pisCofsDefaults.pisCST;
      const pisAliq = pisCofsDefaults.pisAliquota;
      result.pis = {
        cst: pisCST,
        baseCalculo: pisAliq > 0 ? baseCalc : undefined,
        aliquota: pisAliq > 0 ? pisAliq : undefined,
        valor: pisAliq > 0 ? +((baseCalc * pisAliq) / 100).toFixed(2) : undefined,
      };

      // -- COFINS --
      const cofinsCST = item.cofinsSituacaoTributaria || pisCofsDefaults.cofinsCST;
      const cofinsAliq = pisCofsDefaults.cofinsAliquota;
      result.cofins = {
        cst: cofinsCST,
        baseCalculo: cofinsAliq > 0 ? baseCalc : undefined,
        aliquota: cofinsAliq > 0 ? cofinsAliq : undefined,
        valor: cofinsAliq > 0 ? +((baseCalc * cofinsAliq) / 100).toFixed(2) : undefined,
      };

      return result;
    });

    // 7. Build emitente from business data --------------------------------------

    const emitente: Record<string, unknown> = {
      cnpj: business.cnpj?.replace(/\D/g, ''),
      inscricaoEstadual: fiscal.inscricaoEstadual,
      razaoSocial: business.razaoSocial,
      nomeFantasia: business.nomeFantasia,
      crt,
    };

    if (business.endereco) {
      emitente.endereco = {
        logradouro: business.endereco.logradouro,
        numero: business.endereco.numero,
        complemento: business.endereco.complemento || undefined,
        bairro: business.endereco.bairro,
        codigoMunicipio: fiscal.ibgeCodigoMunicipio,
        municipio: business.endereco.municipio,
        uf: business.endereco.uf,
        cep: business.endereco.cep?.replace(/\D/g, ''),
      };
    }

    // 8. Payment ----------------------------------------------------------------

    const paymentCode = getPaymentCode(data.paymentMethod || 'dinheiro');
    const totalNF = items.reduce(
      (sum: number, it: Record<string, unknown>) =>
        sum + (Number(it.valorTotal) || 0) - (Number(it.valorDesconto) || 0),
      0,
    );

    const pagamento = {
      indicador: 1,
      formas: [
        {
          meio: paymentCode,
          valor: +(Number(data.paymentValue) || totalNF).toFixed(2),
        },
      ],
    };

    const ufEmitente = business.endereco?.uf || 'SP';
    const now = new Date().toISOString();

    // 9. Emit depending on type -------------------------------------------------

    if (type === 'nfce') {
      // Validate NFC-e specific fields (CSC)
      if (!fiscal.nfceConfig?.cscId || !fiscal.nfceConfig?.cscToken) {
        return NextResponse.json(
          { error: 'CSC (Codigo de Seguranca do Contribuinte) nao configurado para NFC-e.' },
          { status: 400 },
        );
      }

      const nfcePayload = stripEmpty({
        emitente,
        numero: number,
        serie: series,
        ufEmitente,
        naturezaOperacao: data.naturezaOperacao || 'VENDA AO CONSUMIDOR FINAL',
        consumidorFinal: 1,
        presencaComprador: data.presencaComprador ?? 1,
        itens: items,
        pagamento,
        csc: {
          id: fiscal.nfceConfig.cscId,
          token: fiscal.nfceConfig.cscToken,
        },
        consumidor: data.cpfConsumidor
          ? {
              cpf: data.cpfConsumidor.replace(/\D/g, ''),
              nome: data.nomeConsumidor,
            }
          : undefined,
        informacoesAdicionais: data.informacoesAdicionais,
        certificado,
      });

      const result = await emitirNFCe(nfcePayload as Record<string, unknown> & { certificado: CertificadoPayload });

      // Persist fiscal document
      if (result.chaveAcesso) {
        await adminDb.collection('fiscalDocuments').add(
          stripEmpty({
            businessId,
            type: 'nfce',
            number,
            series,
            accessKey: result.chaveAcesso,
            protocol: result.protocolo,
            status:
              result.status === 'autorizado' ? 'autorizada' : result.status,
            xml: result.xml,
            sefazResponse: result,
            totalValue: totalNF,
            createdAt: now,
            updatedAt: now,
          }),
        );
      }

      return NextResponse.json(
        { success: result.success, data: result },
        { status: result.status === 'autorizado' ? 201 : 200 },
      );
    }

    // -- NFe -------------------------------------------------------------------

    const destinatario = data.recipient
      ? stripEmpty({
          cnpj:
            data.recipient.document?.replace(/\D/g, '').length === 14
              ? data.recipient.document.replace(/\D/g, '')
              : undefined,
          cpf:
            data.recipient.document?.replace(/\D/g, '').length === 11
              ? data.recipient.document.replace(/\D/g, '')
              : undefined,
          nome: data.recipient.name,
          email: data.recipient.email,
          inscricaoEstadual: data.recipient.inscricaoEstadual,
          indicadorIE: data.recipient.indicadorIE ?? 9,
          endereco: data.recipient.address
            ? {
                logradouro: data.recipient.address.logradouro,
                numero: data.recipient.address.numero,
                complemento: data.recipient.address.complemento || undefined,
                bairro: data.recipient.address.bairro,
                codigoMunicipio: data.recipient.address.codigoMunicipio,
                municipio: data.recipient.address.municipio,
                uf: data.recipient.address.uf,
                cep: data.recipient.address.cep?.replace(/\D/g, ''),
              }
            : undefined,
        })
      : undefined;

    const nfePayload = stripEmpty({
      emitente,
      numero: number,
      serie: series,
      ufEmitente,
      naturezaOperacao: data.naturezaOperacao || 'VENDA DE MERCADORIA',
      finalidadeEmissao: data.finalidadeEmissao ?? 1,
      consumidorFinal: data.consumidorFinal ?? 0,
      presencaComprador: data.presencaComprador ?? 1,
      destinatario,
      itens: items,
      pagamento,
      modalidadeFrete: data.modalidadeFrete ?? 9,
      informacoesAdicionais: data.informacoesAdicionais,
      certificado,
    });

    const result = await emitirNFe(nfePayload as Record<string, unknown> & { certificado: CertificadoPayload });

    // Persist fiscal document
    if (result.chaveAcesso) {
      await adminDb.collection('fiscalDocuments').add(
        stripEmpty({
          businessId,
          type: 'nfe',
          number,
          series,
          accessKey: result.chaveAcesso,
          protocol: result.protocolo,
          status:
            result.status === 'autorizado'
              ? 'autorizada'
              : result.status === 'processando'
                ? 'processando'
                : result.status,
          xml: result.xml,
          sefazResponse: result,
          totalValue: totalNF,
          recipientName: data.recipient?.name,
          recipientDocument: data.recipient?.document?.replace(/\D/g, ''),
          createdAt: now,
          updatedAt: now,
        }),
      );
    }

    return NextResponse.json(
      { success: result.success, data: result },
      { status: result.status === 'autorizado' ? 201 : 200 },
    );
  } catch (error) {
    console.error('[Fiscal Emit] Erro:', error);
    return NextResponse.json(
      {
        error: 'Erro interno ao emitir documento fiscal.',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 },
    );
  }
}
