import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { UserRole } from '@/lib/types';
import { emitirNFe, emitirNFCe, emitirNFSe, NfsePayload, CertificadoPayload, SefazAmbiente, resolveAmbiente } from '@/lib/services/sefaz-gateway';
import {
  peekNextInvoiceNumber,
  commitInvoiceNumber,
  getCRT,
  getPaymentCode,
  getICMSDefaults,
  getPISCOFINSDefaults,
} from '@/lib/fiscal/number-sequence';
import { getCertificadoPayload } from '@/lib/fiscal/certificate-manager';
import { decryptToken } from '@/lib/utils/encryption';
import type { Product } from '@/lib/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Lista oficial das 27 UFs válidas para emissão de NF-e/NFC-e */
const VALID_UFS = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA',
  'MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN',
  'RO','RR','RS','SC','SE','SP','TO',
];

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

    if (!type || !['nfe', 'nfce', 'nfse'].includes(type)) {
      return NextResponse.json(
        { error: 'Tipo de documento fiscal invalido. Use: nfe, nfce ou nfse.' },
        { status: 400 },
      );
    }

    if (!businessId || typeof businessId !== 'string') {
      return NextResponse.json(
        { error: 'businessId e obrigatorio.' },
        { status: 400 },
      );
    }

    // Auth: admin+ only
    const auth = await verifyAuth(request, businessId);
    if (isAuthError(auth)) return auth;
    if (ROLE_HIERARCHY[auth.role as UserRole] < ROLE_HIERARCHY['admin']) {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
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

    // 4. Peek at next invoice number (commit only after SEFAZ accepts) ----------

    const { number, series } = await peekNextInvoiceNumber(businessId, type);

    // 5. Determine tax regime, defaults and ambiente ----------------------------

    const crt = getCRT(fiscal.taxRegime);
    const icmsDefaults = getICMSDefaults(crt);
    const pisCofsDefaults = getPISCOFINSDefaults(crt, fiscal.taxRegime);

    // Resolve environment: prefer per-document-type config, fall back to nfeConfig,
    // then to fiscal.environment (raiz, salva pelo botão "Salvar Ambiente" no Settings).
    const rawEnvironment =
      type === 'nfce'
        ? (fiscal.nfceConfig?.environment ?? fiscal.nfeConfig?.environment ?? fiscal.environment)
        : (fiscal.nfeConfig?.environment ?? fiscal.environment);
    const ambiente: SefazAmbiente = resolveAmbiente(rawEnvironment);

    // 6. Build items with tax blocks (NFe/NFCe only — NFSe uses servico block) -

    const rawItems = data.items;
    if (type !== 'nfse' && (!Array.isArray(rawItems) || rawItems.length === 0)) {
      return NextResponse.json(
        { error: 'Pelo menos um item e obrigatorio.' },
        { status: 400 },
      );
    }

    // 6.1 Enrichment: lê Products referenciados (via productId) e mescla campos
    // fiscais avançados (unidadeTrib, gtinTrib, fiscalTax CST/CSOSN/alíquotas)
    // antes do map. Sem isso, o cadastro do Product virava letra morta — operador
    // configurava CST/origem por produto e a emissão usava só defaults do regime.
    // Precedência: item.X (digitado/editado no form) > product.X > default.
    // Best-effort: produto deletado/cross-tenant cai no fallback gracioso.
    const productIdsRaw = Array.isArray(rawItems)
      ? rawItems
          .map((it: Record<string, unknown>) => (typeof it.productId === 'string' ? it.productId : null))
          .filter((id): id is string => !!id)
      : [];
    const productIds = Array.from(new Set(productIdsRaw));
    const productsMap = new Map<string, Product>();
    if (productIds.length > 0) {
      const productDocs = await Promise.all(
        productIds.map(id => adminDb.collection('products').doc(id).get().catch(() => null)),
      );
      for (const doc of productDocs) {
        if (!doc || !doc.exists) continue;
        const productData = doc.data();
        // Cross-tenant guard — operador A não consegue ler Product do business B
        // mesmo se forjar productId no payload. Defesa em profundidade sobre
        // o auth check da rota.
        if (productData && productData.businessId === businessId) {
          productsMap.set(doc.id, { ...productData, id: doc.id } as Product);
        }
      }
    }

    // Validação prévia: descrição é obrigatória pra SEFAZ (xProd). Antes do
    // enrichment, item.description undefined era removido pelo stripEmpty e a
    // SEFAZ rejeitava com erro genérico. Agora com fallback pro Product.name,
    // o cenário "ambos vazios" precisa ser tratado explicitamente — 400
    // cedo dá feedback acionável ao operador.
    if (Array.isArray(rawItems)) {
      for (let i = 0; i < rawItems.length; i++) {
        const it = rawItems[i] as Record<string, unknown>;
        const desc = (typeof it.description === 'string' ? it.description : '').trim();
        const productName = typeof it.productId === 'string' ? productsMap.get(it.productId)?.name?.trim() : '';
        if (!desc && !productName) {
          return NextResponse.json(
            { error: `Item ${i + 1}: descrição vazia. Preencha no item ou cadastre o produto com nome.` },
            { status: 400 },
          );
        }
      }
    }

    const items = (Array.isArray(rawItems) ? rawItems : []).map((item: Record<string, unknown>, i: number) => {
      // Resolve Product cadastrado (pode ser undefined — operador editou item
      // sem importar do estoque, OU produto foi deletado entre import e emissão).
      const product = typeof item.productId === 'string' ? productsMap.get(item.productId) : undefined;
      const productFiscal = product?.fiscalTax;
      // Helper: usa item.X se o operador preencheu (não-vazio); senão product.X;
      // senão undefined (caller decide o default).
      const pick = <T>(itemVal: T | undefined | null | '', productVal: T | undefined | null): T | undefined => {
        if (itemVal !== undefined && itemVal !== null && itemVal !== '') return itemVal as T;
        if (productVal !== undefined && productVal !== null) return productVal as T;
        return undefined;
      };
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unitPrice) || 0;
      const vProd = +(qty * price).toFixed(2);
      const vDesc = +(Number(item.discount) || 0).toFixed(2);
      const baseCalc = +(vProd - vDesc).toFixed(2);
      // ── Campos comerciais (com enrichment do Product quando item omite) ────
      const ean = String(pick(item.barcode as string, product?.gtin) || 'SEM GTIN');
      const unitStr = String(pick(item.unit as string, product?.unit) || 'UN');
      const ncm = String(pick(item.ncm as string, product?.ncm) || '00000000').replace(/\D/g, '');
      const cfop = String(pick(item.cfop as string | number, product?.cfop) || 5102);
      const cest = pick(item.cest as string, product?.cest);
      // ── Campos tributáveis: default = comercial; sobrescreve só quando o
      // Product cadastra valor explícito diferente (caixa→unidade etc).
      const unidadeTrib = product?.unidadeTrib?.trim() || unitStr;
      const cEANTrib = product?.gtinTrib?.trim() || ean;
      // ── Origem ICMS: pick respeita 0 (Nacional), por isso check de undefined
      // explícito em vez do '||' que cairia em fallback. icmsDefaults é último.
      const icmsOrigemResolved = item.icmsOrigem !== undefined && item.icmsOrigem !== null && item.icmsOrigem !== ''
        ? item.icmsOrigem
        : (product?.icmsOrigem ?? icmsDefaults.origem);

      // -- Tax blocks --

      // ICMS
      let icmsBlock: Record<string, unknown>;
      if (crt === '3') {
        // Regime normal: CST + alíquota. Product.fiscalTax.icms vence sobre
        // o default do regime, mas perde pra valor digitado manualmente no item.
        const aliq = Number(pick(item.icmsAliquota as number, productFiscal?.icms?.rate) ?? icmsDefaults.aliquota);
        const cst = pick(item.icmsSituacaoTributaria as string, productFiscal?.icms?.cst) || icmsDefaults.cst;
        icmsBlock = {
          orig: String(Number(icmsOrigemResolved)),
          cst,
          modBC: '0',
          valorBC: baseCalc,
          aliquota: aliq,
          valor: +((baseCalc * aliq) / 100).toFixed(2),
        };
      } else {
        // Simples Nacional: CSOSN. Mesma lógica de precedência.
        const csosn = pick(item.icmsSituacaoTributaria as string, productFiscal?.icms?.csosn) || icmsDefaults.csosn;
        icmsBlock = {
          orig: String(Number(icmsOrigemResolved)),
          csosn,
        };
      }

      // PIS — Product override prevalece sobre default do regime, item digitado vence ambos.
      const pisCST = pick(item.pisSituacaoTributaria as string, productFiscal?.pis?.cst) || pisCofsDefaults.pisCST;
      const pisAliq = pick(item.pisAliquota as number, productFiscal?.pis?.rate) ?? pisCofsDefaults.pisAliquota;
      const pisBlock: Record<string, unknown> = {
        cst: pisCST,
        valorBC: pisAliq > 0 ? baseCalc : undefined,
        aliquota: pisAliq > 0 ? pisAliq : undefined,
        valor: pisAliq > 0 ? +((baseCalc * pisAliq) / 100).toFixed(2) : undefined,
      };

      // COFINS — idem PIS.
      const cofinsCST = pick(item.cofinsSituacaoTributaria as string, productFiscal?.cofins?.cst) || pisCofsDefaults.cofinsCST;
      const cofinsAliq = pick(item.cofinsAliquota as number, productFiscal?.cofins?.rate) ?? pisCofsDefaults.cofinsAliquota;
      const cofinsBlock: Record<string, unknown> = {
        cst: cofinsCST,
        valorBC: cofinsAliq > 0 ? baseCalc : undefined,
        aliquota: cofinsAliq > 0 ? cofinsAliq : undefined,
        valor: cofinsAliq > 0 ? +((baseCalc * cofinsAliq) / 100).toFixed(2) : undefined,
      };

      // IPI (optional) — só emite bloco quando há CST IPI definido (item ou Product).
      let ipiBlock: Record<string, unknown> | undefined;
      const ipiCSTResolved = pick(item.ipiSituacaoTributaria as string, productFiscal?.ipi?.cst);
      if (ipiCSTResolved) {
        const ipiCST = String(ipiCSTResolved);
        const ipiEnq = String(pick(item.ipiCodigoEnquadramento as string, productFiscal?.ipi?.cEnq) || '999');
        const ipiTaxable = ['00', '49', '50', '99'].includes(ipiCST);
        const ipiAliq = ipiTaxable ? Number(pick(item.ipiAliquota as number, productFiscal?.ipi?.rate) ?? 0) : 0;
        ipiBlock = {
          cst: ipiCST,
          cEnq: ipiEnq,
          baseCalculo: ipiAliq > 0 ? baseCalc : undefined,
          aliquota: ipiAliq > 0 ? ipiAliq : undefined,
          valor: ipiAliq > 0 ? +((baseCalc * ipiAliq) / 100).toFixed(2) : undefined,
        };
      }

      // Descrição final do item — operador digitou ou veio do Product.name.
      // Validação prévia (acima do map) já garante que pelo menos um existe.
      const descricao = (item.description as string) || product?.name || '';

      // -- Build item in nested format (matches TensorRoot API) --
      return {
        numero: i + 1,
        produto: {
          // `codigo` segue como antes (item.code ou índice sequencial). SKU
          // do Product NÃO é injetado aqui — `cProd` no XML é livre e o
          // operador pode preferir o número do item; enrichment é só pros
          // campos fiscais.
          codigo: item.code || String(i + 1),
          cEAN: ean,
          descricao,
          ncm,
          ...(cest ? { cest: String(cest) } : {}),
          cfop,
          unidade: unitStr,
          quantidade: qty,
          valorUnitario: price,
          valorTotal: vProd,
          cEANTrib,
          unidadeTrib,
          quantidadeTrib: qty,
          valorUnitarioTrib: price,
          valorDesconto: vDesc > 0 ? vDesc : undefined,
          indTot: '1',
        },
        imposto: {
          icms: icmsBlock,
          pis: pisBlock,
          cofins: cofinsBlock,
          ...(ipiBlock ? { ipi: ipiBlock } : {}),
        },
      };
    });

    // Em homologação, o primeiro item de NFe/NFCe DEVE ter descrição literal
    // exigida pela SEFAZ (Manual de Integração 7.0, item 7.4.4).
    if (
      (type === 'nfe' || type === 'nfce') &&
      ambiente === 'homologacao' &&
      items[0]?.produto
    ) {
      (items[0].produto as Record<string, unknown>).descricao =
        'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';
    }

    // 7. CFOP auto-adjustment for interstate operations -------------------------
    //    5xxx = intrastate, 6xxx = interstate — SEFAZ rejects mismatches
    const ufEmitente = business.endereco?.uf?.toUpperCase() || '';

    // Validate UF do emitente (required for NF-e and NFC-e)
    if (type !== 'nfse' && (!ufEmitente || !VALID_UFS.includes(ufEmitente))) {
      return NextResponse.json(
        {
          error: `UF do emitente inválida ("${ufEmitente || 'não informada'}"). Configure o estado (UF) em Configurações → Empresa.`,
        },
        { status: 400 },
      );
    }

    // IE/IM/IBGE podem estar em fiscal.* (canônico), na raiz do business (UI Empresa)
    // ou em business.endereco (preenchido via lookup CEP). Resolve com fallbacks.
    // IE: aceita só dígitos ou a literal "ISENTO" (MEI).
    const ieRaw = String(fiscal.inscricaoEstadual || business.inscricaoEstadual || '').trim();
    const inscricaoEstadual = ieRaw.toUpperCase() === 'ISENTO' ? 'ISENTO' : ieRaw.replace(/\D/g, '');
    const inscricaoMunicipal = String(fiscal.inscricaoMunicipal || business.inscricaoMunicipal || '').replace(/\D/g, '');
    const codigoMunicipioEmitente = String(
      fiscal.ibgeCodigoMunicipio || business.endereco?.codigoMunicipio || ''
    ).replace(/\D/g, '');

    // Validate inscricaoEstadual (required for NF-e and NFC-e)
    if ((type === 'nfe' || type === 'nfce') && !inscricaoEstadual) {
      return NextResponse.json(
        { error: 'Inscrição Estadual não configurada. Configure em Configurações → Empresa.' },
        { status: 400 },
      );
    }

    // Validate codigoMunicipioEmitente (required for NF-e and NFC-e)
    if (type !== 'nfse') {
      if (!codigoMunicipioEmitente || codigoMunicipioEmitente === '0000000' || codigoMunicipioEmitente.length !== 7) {
        return NextResponse.json(
          { error: 'Código IBGE do município não configurado ou inválido. Configure em Configurações → Fiscal.' },
          { status: 400 },
        );
      }

      // CEP do emitente: schema TCEP da NFe exige exatamente 8 dígitos.
      const cepEmit = String(business.endereco?.cep || '').replace(/\D/g, '');
      if (cepEmit.length !== 8) {
        return NextResponse.json(
          { error: `CEP do emitente inválido (${cepEmit.length} dígitos). Configure um CEP de 8 dígitos em Configurações → Empresa.` },
          { status: 400 },
        );
      }
    }

    const ufDestinatario = data.recipient?.address?.uf?.toUpperCase();
    if (ufDestinatario && type === 'nfe') {
      const interestadual = ufEmitente !== ufDestinatario;
      for (const item of items) {
        const cfop = String(item.produto.cfop);
        if (interestadual && cfop.startsWith('5')) {
          item.produto.cfop = '6' + cfop.slice(1);
        } else if (!interestadual && cfop.startsWith('6')) {
          item.produto.cfop = '5' + cfop.slice(1);
        }
      }
    }

    // 8. Build emitente from business data --------------------------------------

    const emitente: Record<string, unknown> = {
      cnpj: business.cnpj?.replace(/\D/g, ''),
      nome: business.razaoSocial,
      nomeFantasia: business.nomeFantasia,
      inscricaoEstadual,
      inscricaoMunicipal: inscricaoMunicipal || undefined,
      crt,
    };

    if (business.endereco) {
      emitente.endereco = {
        logradouro: business.endereco.logradouro,
        numero: business.endereco.numero || 'SN',
        complemento: business.endereco.complemento || undefined,
        bairro: business.endereco.bairro,
        codigoMunicipio: codigoMunicipioEmitente,
        municipio: business.endereco.municipio,
        uf: business.endereco.uf?.toUpperCase(),
        cep: business.endereco.cep?.replace(/\D/g, ''),
        codigoPais: '1058',
        pais: 'BRASIL',
        telefone: business.phone?.replace(/\D/g, '') || undefined,
      };
    }

    // 9. Payment ----------------------------------------------------------------

    const totalNF = items.reduce(
      (sum: number, it: { produto: { valorTotal: number; valorDesconto?: number } }) =>
        sum + (it.produto.valorTotal || 0) - (it.produto.valorDesconto || 0),
      0,
    );

    // Aceita data.payments (array — preferido) ou data.paymentMethod+paymentValue
    // (legado/single). Card info só pra métodos eletrônicos (crédito, débito, pix).
    const rawPayments: Array<{ method?: string; amount?: number }> = Array.isArray(data.payments) && data.payments.length > 0
      ? data.payments
      : [{ method: data.paymentMethod, amount: Number(data.paymentValue) || totalNF }];

    const formas = rawPayments
      .filter((p) => p && (p.method || p.amount))
      .map((p) => {
        const code = getPaymentCode(p.method || 'dinheiro');
        const needsCardInfo = ['03', '04', '17'].includes(code);
        return {
          tipo: code,
          valor: +(Number(p.amount) || 0).toFixed(2),
          ...(needsCardInfo ? { cartao: { tipoIntegracao: '2' } } : {}),
        };
      })
      .filter((f) => f.valor > 0);

    if (formas.length === 0) {
      // Fallback: total da nota como dinheiro (caso UI não tenha enviado nada).
      formas.push({ tipo: '01', valor: +totalNF.toFixed(2) });
    }

    const pagamento = {
      indicadorPagamento: '0',
      formas,
    };

    const now = new Date().toISOString();

    // 9. Emit depending on type -------------------------------------------------

    // -- NFS-e ----------------------------------------------------------------
    if (type === 'nfse') {
      if (!inscricaoMunicipal) {
        return NextResponse.json(
          { error: 'Inscricao Municipal nao configurada. Configure em Configuracoes → Empresa.' },
          { status: 400 },
        );
      }
      if (!codigoMunicipioEmitente || codigoMunicipioEmitente.length !== 7) {
        return NextResponse.json(
          { error: 'Codigo IBGE do municipio invalido. Deve ter 7 digitos.' },
          { status: 400 },
        );
      }

      const isSimples = crt === '1' || crt === '2';
      const baseCalculo = +(Number(data.valorServicos) || 0).toFixed(2);
      const aliquotaIss = Number(data.aliquotaIss) || 0;
      const valorISS = +((baseCalculo * aliquotaIss) / 100).toFixed(2);

      const nfsePayload = stripEmpty({
        numeroDPS: number,
        serie: series,
        codigoMunicipioEmissao: codigoMunicipioEmitente,
        prestador: {
          cnpj: business.cnpj?.replace(/\D/g, ''),
          inscricaoMunicipal,
          nome: business.razaoSocial,
          nomeFantasia: business.nomeFantasia,
          simplesNacional: isSimples ? '1' : '2',
        },
        tomador: data.tomador
          ? {
              nome: data.tomador.nome,
              cpf: data.tomador.cpf?.replace(/\D/g, '') || undefined,
              cnpj: data.tomador.cnpj?.replace(/\D/g, '') || undefined,
              email: data.tomador.email,
            }
          : undefined,
        servico: {
          codigoTributacaoNacional: (data.codigoServico || '').replace(/\D/g, '').padEnd(6, '0'),
          codigoTributacaoMunicipal: data.codigoServicoMunicipal || undefined,
          discriminacao: data.discriminacao || data.descricaoServico,
          localPrestacao: { codigoMunicipio: codigoMunicipioEmitente },
          nbs: data.nbs,
        },
        valores: {
          valorServicos: baseCalculo,
          valorDeducoes: data.valorDeducoes ? +Number(data.valorDeducoes).toFixed(2) : undefined,
          valorDescontoIncondicionado: data.valorDesconto ? +Number(data.valorDesconto).toFixed(2) : undefined,
        },
        issqn: {
          tipoRetencaoISSQN: data.issRetido ? '2' : '1',
          baseCalculo,
          aliquota: aliquotaIss,
          valorISS,
          valorISSRetido: data.issRetido ? valorISS : undefined,
        },
        informacoesComplementares: data.informacoesAdicionais,
        ambiente,
        certificado,
      });

      const result = await emitirNFSe(nfsePayload as NfsePayload);

      // Commit number only after success
      if (result.status === 'autorizado') {
        await commitInvoiceNumber(businessId, 'nfse', number);
      }

      // Persist fiscal document
      if (result.chaveAcesso || result.codigoVerificacao || result.status === 'autorizado') {
        await adminDb.collection('fiscalDocuments').add(
          stripEmpty({
            businessId,
            type: 'nfse',
            // Prefer the SEFAZ-issued NFSe number when available; otherwise fall back to the DPS/RPS number we sent.
            number: result.numeroNfse || number,
            series,
            // For NFSe, the SEFAZ returns codigoVerificacao (used to validate the note on the city portal).
            accessKey: result.codigoVerificacao || result.chaveAcesso,
            protocol: result.protocolo,
            status: result.status === 'autorizado' ? 'autorizada' : result.status,
            statusMessage: result.motivoStatus || result.mensagens?.[0]?.mensagem || result.erros?.[0] || null,
            xml: result.xml,
            // linkVisualizacao = external URL (city portal) to view/print the NFSe — there's no DANFE for NFSe.
            pdfUrl: result.linkVisualizacao,
            sefazResponse: result,
            totalValue: baseCalculo,
            clientName: data.tomador?.nome,
            clientCpfCnpj: data.tomador?.cpf || data.tomador?.cnpj,
            informacoesAdicionais: data.informacoesAdicionais,
            // NFSe doesn't have a true items array — synthesize one entry from the service block so
            // the detail dialog renders the description/value table consistently with NFe/NFCe.
            items: [
              {
                description: data.discriminacao || data.descricaoServico || 'Servico',
                quantity: 1,
                unitPrice: baseCalculo,
                totalPrice: baseCalculo,
                unit: 'SV',
                codigo: data.codigoServico || undefined,
                taxes: { iss: { aliquota: aliquotaIss, valor: valorISS } },
              },
            ],
            issueDate: result.dataEmissao || now,
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

    // -- NFC-e ----------------------------------------------------------------
    if (type === 'nfce') {
      // Validate NFC-e specific fields (CSC). Token is stored encrypted
      // in cscTokenEncrypted (preferred); legacy plaintext cscToken is a fallback.
      const cscTokenPlain = fiscal.nfceConfig?.cscTokenEncrypted
        ? await decryptToken(fiscal.nfceConfig.cscTokenEncrypted)
        : fiscal.nfceConfig?.cscToken || '';

      if (!fiscal.nfceConfig?.cscId || !cscTokenPlain) {
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
        ambiente,
        naturezaOperacao: data.naturezaOperacao || 'VENDA AO CONSUMIDOR FINAL',
        tipoOperacao: '1',
        finalidade: '1',
        consumidorFinal: '1',
        presencaComprador: String(data.presencaComprador ?? 1),
        consumidor: data.cpfConsumidor
          ? {
              cpf: data.cpfConsumidor.replace(/\D/g, ''),
              nome: data.nomeConsumidor,
            }
          : data.nomeConsumidor
            ? { nome: data.nomeConsumidor }
            : undefined,
        itens: items,
        pagamento,
        transporte: { modFrete: '9' },
        csc: {
          id: fiscal.nfceConfig.cscId,
          token: cscTokenPlain,
        },
        informacoesAdicionais: data.informacoesAdicionais
          ? { contribuinte: data.informacoesAdicionais }
          : undefined,
        certificado,
      });

      const result = await emitirNFCe(nfcePayload as Record<string, unknown> & { certificado: CertificadoPayload; ambiente: SefazAmbiente });

      // Commit number only after SEFAZ accepts
      if (result.status === 'autorizado') {
        await commitInvoiceNumber(businessId, 'nfce', number);
      }

      // Persist fiscal document — sempre (autorizada, rejeitada ou processando)
      // pra que o usuário consulte o histórico mesmo em caso de falha.
      await adminDb.collection('fiscalDocuments').add(
        stripEmpty({
          businessId,
          type: 'nfce',
          number,
          series,
          accessKey: result.chaveAcesso || null,
          protocol: result.protocolo || null,
          status:
            result.status === 'autorizado' ? 'autorizada' : result.status,
          statusMessage: result.motivoStatus || result.erros?.[0] || null,
          clientName: data.nomeConsumidor || null,
          clientCpfCnpj: data.cpfConsumidor?.replace(/\D/g, '') || null,
          xml: result.xml || null,
          sefazResponse: result,
          totalValue: totalNF,
          issueDate: now,
          createdAt: now,
          updatedAt: now,
        }),
      );

      return NextResponse.json(
        { success: result.success, data: result },
        { status: result.status === 'autorizado' ? 201 : 200 },
      );
    }

    // -- NFe -------------------------------------------------------------------

    // Validate codigoMunicipio do destinatário (required when recipient has address)
    if (data.recipient?.address) {
      const codigoMunDest = data.recipient.address.codigoMunicipio
        || data.recipient.codigoMunicipio;
      if (!codigoMunDest) {
        return NextResponse.json(
          { error: 'Código IBGE do município do destinatário é obrigatório para NF-e. Informe recipient.address.codigoMunicipio.' },
          { status: 400 },
        );
      }
    }

    // Auto-resolve indicadorIE: se tem IE → contribuinte (1), senão → não contribuinte (9)
    const resolvedIndicadorIE: '1' | '2' | '9' = data.recipient?.indicadorIE
      ? String(data.recipient.indicadorIE) as '1' | '2' | '9'
      : data.recipient?.inscricaoEstadual
        ? '1'
        : '9';

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
          indicadorIE: resolvedIndicadorIE,
          endereco: data.recipient.address
            ? {
                logradouro: data.recipient.address.logradouro,
                numero: data.recipient.address.numero || 'SN',
                complemento: data.recipient.address.complemento || undefined,
                bairro: data.recipient.address.bairro,
                codigoMunicipio: data.recipient.address.codigoMunicipio
                  || data.recipient.codigoMunicipio,
                municipio: data.recipient.address.municipio,
                uf: data.recipient.address.uf,
                cep: data.recipient.address.cep?.replace(/\D/g, ''),
                codigoPais: '1058',
                pais: 'BRASIL',
              }
            : undefined,
        })
      : undefined;

    const nfePayload = stripEmpty({
      emitente,
      numero: number,
      serie: series,
      ufEmitente,
      ambiente,
      naturezaOperacao: data.naturezaOperacao || 'VENDA DE MERCADORIA',
      tipoOperacao: '1',
      finalidade: String(data.finalidadeEmissao ?? 1),
      consumidorFinal: String(data.consumidorFinal ?? 0),
      presencaComprador: String(data.presencaComprador ?? 1),
      destinatario,
      itens: items,
      pagamento,
      transporte: {
        modFrete: String(data.modalidadeFrete ?? 9),
      },
      informacoesAdicionais: data.informacoesAdicionais
        ? { contribuinte: data.informacoesAdicionais }
        : undefined,
      certificado,
    });

    const result = await emitirNFe(nfePayload as Record<string, unknown> & { certificado: CertificadoPayload; ambiente: SefazAmbiente });

    // Commit number only after SEFAZ accepts
    if (result.status === 'autorizado' || result.status === 'processando') {
      await commitInvoiceNumber(businessId, 'nfe', number);
    }

    // Persist fiscal document — sempre (autorizada, rejeitada ou processando).
    await adminDb.collection('fiscalDocuments').add(
      stripEmpty({
        businessId,
        type: 'nfe',
        number,
        series,
        accessKey: result.chaveAcesso || null,
        protocol: result.protocolo || null,
        status:
          result.status === 'autorizado'
            ? 'autorizada'
            : result.status === 'processando'
              ? 'processando'
              : result.status,
        statusMessage: result.motivoStatus || result.erros?.[0] || null,
        clientName: data.recipient?.name || null,
        clientCpfCnpj: data.recipient?.document?.replace(/\D/g, '') || null,
        xml: result.xml || null,
        sefazResponse: result,
        totalValue: totalNF,
        issueDate: now,
        createdAt: now,
        updatedAt: now,
      }),
    );

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
