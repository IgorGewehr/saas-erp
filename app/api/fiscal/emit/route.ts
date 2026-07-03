import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { UserRole } from '@/lib/types';
import { emitirNFe, emitirNFCe, emitirNFSe, prepararNFCeContingencia, NfsePayload, CertificadoPayload, SefazAmbiente, resolveAmbiente, isTransientSefazError } from '@/lib/services/sefaz-gateway';
import {
  getNextInvoiceNumber,
  getCRT,
  getPaymentCode,
  getICMSDefaults,
  getPISCOFINSDefaults,
} from '@/lib/fiscal/number-sequence';
import { getCertificadoPayload } from '@/lib/fiscal/certificate-manager';
import { decryptToken } from '@/lib/utils/encryption';
import type { Product } from '@/lib/types';
import { EmitFiscalRequestSchema } from '@/lib/contracts/api/fiscal/emit';
import { validateMunicipalRequirements } from '@/lib/fiscal/municipalRequirements';
import { normalizeFiscalDocumentStatus } from '@/lib/contracts/fsm/fiscalDocument';

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

/**
 * Persiste documento fiscal como 'pendente' (SEFAZ indisponível) e responde
 * 200 ao cliente. Salva o PAYLOAD DO GATEWAY já montado (não o request da
 * UI!) menos certificado e CSC, pra permitir replay direto pela rota
 * /api/fiscal/retry — operador clica "Reenviar para SEFAZ" quando o serviço
 * voltar. NUNCA persistir certificado nem CSC token no Firestore (sensíveis;
 * o retry os re-resolve do business).
 */
async function persistPendingAndRespond(params: {
  businessId: string;
  type: 'nfe' | 'nfce' | 'nfse';
  number: number;
  series: string;
  clientName: string | null;
  clientCpfCnpj: string | null;
  totalValue: number;
  /** Payload do gateway (nfePayload/nfcePayload/nfsePayload) pronto pra replay. */
  originalRequest: Record<string, unknown>;
  ufEmitente?: string | null;
  ambiente?: string | null;
  error: Error;
  now: string;
}): Promise<NextResponse> {
  const { certificado: _certCleanup, csc: _cscCleanup, ...payloadForRetry } =
    params.originalRequest as Record<string, unknown>;
  void _certCleanup;
  void _cscCleanup;
  const docRef = await adminDb.collection('fiscalDocuments').add(
    stripEmpty({
      businessId: params.businessId,
      type: params.type,
      number: params.number,
      series: params.series,
      status: 'pendente',
      statusMessage: params.error.message || 'SEFAZ temporariamente indisponível',
      clientName: params.clientName,
      clientCpfCnpj: params.clientCpfCnpj,
      totalValue: params.totalValue,
      originalRequest: payloadForRetry,
      ufEmitente: params.ufEmitente || null,
      ambiente: params.ambiente || null,
      issueDate: params.now,
      createdAt: params.now,
      updatedAt: params.now,
    }),
  );
  return NextResponse.json(
    {
      success: false,
      fallback: 'pending',
      documentId: docRef.id,
      message:
        'SEFAZ temporariamente indisponível. Documento salvo como pendente — use "Reenviar para SEFAZ" no detalhe da nota quando o serviço voltar.',
    },
    { status: 200 },
  );
}

/**
 * Grava o vínculo do fiscalDocument recém-emitido de volta no documento de
 * origem (Sale em `sales` ou DeliveryOrder em `deliveryOrders`). Fecha o loop
 * de rastreio: a venda passa a saber sua nota (accessKey + documentId) e o
 * módulo Fiscal já ancora a idempotência no saleId/orderId. Best-effort — a
 * emissão já ocorreu, então falha de writeback loga (warn) e não derruba a
 * resposta. Cross-tenant guard: nunca escreve em doc de outro businessId
 * (adminDb bypassa Firestore rules).
 */
async function linkFiscalDocToSource(params: {
  businessId: string;
  saleId?: string;
  orderId?: string;
  fiscalDocumentId: string;
  accessKey: string | null;
  type: 'nfe' | 'nfce';
  status: string;
  now: string;
}): Promise<void> {
  const collectionName = params.saleId ? 'sales' : params.orderId ? 'deliveryOrders' : null;
  const docId = params.saleId || params.orderId;
  if (!collectionName || !docId) return;
  try {
    const ref = adminDb.collection(collectionName).doc(docId);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.businessId !== params.businessId) return;
    await ref.set(
      stripEmpty({
        fiscalDocumentId: params.fiscalDocumentId,
        fiscalAccessKey: params.accessKey,
        fiscalType: params.type,
        fiscalStatus: params.status,
        fiscalEmittedAt: params.now,
        updatedAt: params.now,
      }),
      { merge: true },
    );
  } catch (err) {
    console.warn('[Fiscal Emit] writeback ao documento de origem falhou', {
      collectionName,
      docId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Idempotência (R3): POST que cria recurso aceita X-Idempotency-Key.
// Claim transacional em fiscalIdempotency/{businessId}_{key}:
//   - chave nova → marca 'processing' e executa a emissão;
//   - 'done'     → devolve a MESMA resposta gravada (replay seguro);
//   - 'processing' fresco → 409 (emissão duplicada em voo);
//   - 'processing' velho (>10min, processo morreu) → re-claim.
// Respostas 5xx/exceções LIBERAM a chave (retry legítimo não fica preso).
// ---------------------------------------------------------------------------

const IDEM_STALE_MS = 10 * 60 * 1000;

export async function POST(request: NextRequest) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido.' }, { status: 400 });
  }

  const bodyRec = body as Record<string, unknown> | null;
  const bid = bodyRec?.businessId;
  // Ancora a idempotência ao documento de origem (Sale/DeliveryOrder) quando
  // houver: dedup passa a valer POR VENDA/PEDIDO, independente da chave efêmera
  // do cliente. Assim um refresh, um segundo tab ou um retry da MESMA venda
  // replaya a nota já emitida em vez de gerar a segunda. Sem origem (dialog
  // manual), cai na X-Idempotency-Key enviada pela UI (comportamento legado).
  const sourceSaleId = typeof bodyRec?.saleId === 'string' ? bodyRec.saleId.trim() : '';
  const sourceOrderId = typeof bodyRec?.orderId === 'string' ? bodyRec.orderId.trim() : '';
  const sourceAnchor = sourceSaleId
    ? `sale_${sourceSaleId}`
    : sourceOrderId
      ? `order_${sourceOrderId}`
      : '';
  const idemKeyRaw = sourceAnchor || request.headers.get('x-idempotency-key')?.trim();
  if (!idemKeyRaw || typeof bid !== 'string' || !bid) {
    return emitCore(request, body);
  }

  // Auth ANTES do claim: sem isso, request não-autenticada escreveria em
  // fiscalIdempotency e poderia ler replay de resposta de outro usuário.
  // (emitCore re-valida — custo de 1 verify duplicado, aceitável.)
  const preAuth = await verifyAuth(request, bid);
  if (isAuthError(preAuth)) return preAuth;

  // Doc id não aceita '/', e chave gigante não pode virar 500 cru.
  const idemKey = idemKeyRaw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
  if (!idemKey) {
    return emitCore(request, body);
  }

  const idemRef = adminDb.collection('fiscalIdempotency').doc(`${bid}_${idemKey}`);
  const nowMs = Date.now();
  const claim = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(idemRef);
    if (!snap.exists) {
      tx.set(idemRef, { businessId: bid, status: 'processing', createdAt: new Date(nowMs).toISOString(), createdAtMs: nowMs });
      return { state: 'new' as const };
    }
    const d = snap.data()!;
    if (d.status === 'done') {
      return { state: 'done' as const, response: d.response, httpStatus: d.httpStatus as number };
    }
    // 'failed' (5xx/exceção anterior) é re-claimável imediatamente — mantém
    // trilha de auditoria em vez de delete, mesma semântica de retry.
    if (d.status === 'failed') {
      tx.set(idemRef, { businessId: bid, status: 'processing', createdAt: new Date(nowMs).toISOString(), createdAtMs: nowMs });
      return { state: 'new' as const };
    }
    if (typeof d.createdAtMs === 'number' && nowMs - d.createdAtMs > IDEM_STALE_MS) {
      tx.set(idemRef, { businessId: bid, status: 'processing', createdAt: new Date(nowMs).toISOString(), createdAtMs: nowMs });
      return { state: 'new' as const };
    }
    return { state: 'inflight' as const };
  });

  if (claim.state === 'done') {
    return NextResponse.json(claim.response, { status: claim.httpStatus || 200 });
  }
  if (claim.state === 'inflight') {
    return NextResponse.json(
      { error: 'Emissão com esta chave de idempotência já está em andamento. Aguarde o resultado antes de reenviar.' },
      { status: 409 },
    );
  }

  let res: NextResponse;
  try {
    res = await emitCore(request, body);
  } catch (err) {
    await idemRef
      .set({ status: 'failed', failedAt: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) }, { merge: true })
      .catch(() => {});
    throw err;
  }

  try {
    if (res.status < 500) {
      const json = await res.clone().json().catch(() => null);
      if (json) {
        // XML completo fica em fiscalDocuments — replay devolve a resposta
        // sem ele (evita duplicar nota inteira nesta coleção sem TTL).
        const stored = JSON.parse(JSON.stringify(json)) as Record<string, unknown>;
        const dataObj = stored.data as Record<string, unknown> | undefined;
        if (dataObj && typeof dataObj.xml === 'string') {
          dataObj.xml = null;
          dataObj.xmlOmitidoNoReplay = true;
        }
        const payload = { status: 'done', httpStatus: res.status, response: stored, doneAt: new Date().toISOString() };
        try {
          await idemRef.set(payload, { merge: true });
        } catch {
          // 2ª tentativa: chave presa em 'processing' re-emitiria após o
          // stale window mesmo com a emissão já entregue.
          await idemRef.set(payload, { merge: true });
        }
      } else {
        await idemRef.set({ status: 'failed', failedAt: new Date().toISOString(), error: 'resposta não-JSON' }, { merge: true });
      }
    } else {
      await idemRef.set({ status: 'failed', failedAt: new Date().toISOString(), httpStatus: res.status }, { merge: true });
    }
  } catch {
    // Falha ao gravar o resultado não pode derrubar uma emissão já feita.
  }
  return res;
}

async function emitCore(request: NextRequest, body: unknown): Promise<NextResponse> {
  try {
    // 1. Validate payload shape via Zod (SDD R6: validação no boundary).
    // Schema cobre type/businessId/items/recipient/tomador/etc. Erros de
    // shape retornam 400 com detalhes acionáveis. Cross-field validações
    // (descrição vazia + sem Product, IE faltando, etc.) ficam abaixo
    // porque dependem de reads do Firestore.
    const parsed = EmitFiscalRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Payload inválido para emissão fiscal.',
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }
    const { type, businessId } = parsed.data;
    // `data` é cast intencional: Zod já validou os campos por type via
    // discriminated union, mas no fluxo legacy o handler acessa
    // `data.recipient/tomador/payments/...` sem narrow por type. Validação
    // de shape já garantiu que cada campo, quando presente, tem a forma
    // certa. Tech-debt: refatorar pra narrow por type-branch quando o
    // handler for quebrado em sub-handlers (1 por type).
    const data = parsed.data as Record<string, any>;

    // Vínculo com o documento de origem (Sale/DeliveryOrder). sourceType é
    // derivado quando ausente. Usado pra persistir no fiscalDocument e gravar
    // accessKey/documentId de volta na venda/pedido após a emissão.
    const saleId = typeof data.saleId === 'string' && data.saleId.trim() ? data.saleId.trim() : undefined;
    const orderId = typeof data.orderId === 'string' && data.orderId.trim() ? data.orderId.trim() : undefined;
    const sourceType: 'sale' | 'order' | 'manual' | undefined =
      data.sourceType === 'sale' || data.sourceType === 'order' || data.sourceType === 'manual'
        ? data.sourceType
        : saleId
          ? 'sale'
          : orderId
            ? 'order'
            : undefined;

    // Auth: NFC-e (cupom de caixa) pode ser emitida por operator+ — é o fluxo
    // pós-venda do PDV, operado por caixas. NF-e/NFSe seguem admin+ (dados
    // cadastrais/tributários sensíveis, sem urgência de balcão).
    const auth = await verifyAuth(request, businessId);
    if (isAuthError(auth)) return auth;
    const minRole: UserRole = type === 'nfce' ? 'operator' : 'admin';
    if (ROLE_HIERARCHY[auth.role as UserRole] < ROLE_HIERARCHY[minRole]) {
      return NextResponse.json(
        { error: type === 'nfce' ? 'Operator role required' : 'Admin role required' },
        { status: 403 },
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

    // 4. Numeração fiscal: a alocação ATÔMICA (getNextInvoiceNumber, transação
    // get-and-increment) acontece DENTRO de cada branch, imediatamente antes
    // da montagem do payload — depois de TODAS as validações locais. Alocar
    // aqui em cima queimava um número a cada 400 de configuração (IE/IBGE/
    // CSC ausentes etc.). Gap agora só ocorre por rejeição definitiva da
    // SEFAZ (comportamento previsto; /api/fiscal/inutilizar cobre).

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
    //
    // Convenção de precedência: item.X (digitado/editado no form) > product.X >
    // default do regime. A UI ("Importar do estoque") popula o form com Product.X
    // no clique de import; quando o operador NÃO importou, os campos fiscais do
    // form ficam vazios e o pick() abaixo cai para o Product. Por isso a UI deve
    // mandar campo vazio/ausente (não default literal) quando o operador não
    // editou — senão o cadastro nunca sobrescreve.
    //
    // Best-effort: produto deletado/cross-tenant/falha de read cai no fallback
    // gracioso. Falha de read é logada (warn) mas não bloqueia a emissão.
    const productIdsRaw = Array.isArray(rawItems)
      ? rawItems
          .map((it: Record<string, unknown>) => (typeof it.productId === 'string' ? it.productId : null))
          .filter((id): id is string => !!id)
      : [];
    const productIds = Array.from(new Set(productIdsRaw));
    const productsMap = new Map<string, Product>();
    if (productIds.length > 0) {
      const productDocs = await Promise.all(
        productIds.map(id =>
          adminDb.collection('products').doc(id).get().catch(err => {
            console.warn('[Fiscal Emit] product read failed; falling back to defaults', { productId: id, businessId, error: err?.message });
            return null;
          }),
        ),
      );
      for (const doc of productDocs) {
        if (!doc || !doc.exists) continue;
        const productData = doc.data();
        // Cross-tenant guard — operador A não consegue ler Product do business B
        // mesmo se forjar productId no payload. Defesa em profundidade sobre
        // o auth check da rota (adminDb bypassa Firestore rules).
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
      // senão undefined (caller decide o default). Strings só-espaços são tratadas
      // como vazias — caso contrário a SEFAZ rejeita com erro genérico (ex: NCM
      // '   ' depois de stripEmpty vira string com espaços ao invés de cair no
      // default '00000000').
      const pick = <T>(itemVal: T | undefined | null | '', productVal: T | undefined | null): T | undefined => {
        const isEmptyStr = typeof itemVal === 'string' && itemVal.trim() === '';
        if (itemVal !== undefined && itemVal !== null && !isEmptyStr) return itemVal as T;
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
          // tPag '99' exige xPag (descrição) no XSD — manda o rótulo do método.
          ...(code === '99' ? { descricao: (p.method || 'Outros').slice(0, 60) } : {}),
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

      // Regras municipais específicas (ex: SP exige endereço do tomador
      // completo; BH/RJ/etc. virão aqui no futuro). Concentradas em
      // `lib/fiscal/municipalRequirements.ts` pra evitar `if (cidade === X)`
      // espalhados pelo route. Validação no boundary dá mensagem acionável
      // antes do roundtrip — o erro do governo é genérico e confunde.
      const municipal = validateMunicipalRequirements(codigoMunicipioEmitente, data);
      if (!municipal.valid) {
        return NextResponse.json(
          { error: municipal.message, missingFields: municipal.missingFields },
          { status: 400 },
        );
      }

      const isSimples = crt === '1' || crt === '2';
      const baseCalculo = +(Number(data.valorServicos) || 0).toFixed(2);
      const aliquotaIss = Number(data.aliquotaIss) || 0;
      const valorISS = +((baseCalculo * aliquotaIss) / 100).toFixed(2);

      // Local da prestação: município onde o serviço foi efetivamente prestado.
      // Default: município do emitente. Diferente quando empresa atende in-loco
      // em outra cidade (ex: dentista de SP atende em Campinas — ISS recolhido
      // em Campinas). Validamos 7 dígitos pra evitar XML rejeitado pelo IBGE.
      const codigoMunicipioPrestacaoRaw = String(data.codigoMunicipioPrestacao || '').replace(/\D/g, '');
      if (codigoMunicipioPrestacaoRaw && codigoMunicipioPrestacaoRaw.length !== 7) {
        return NextResponse.json(
          { error: 'Código IBGE do município de prestação inválido. Deve ter 7 dígitos.' },
          { status: 400 },
        );
      }
      const codigoMunicipioPrestacao = codigoMunicipioPrestacaoRaw || codigoMunicipioEmitente;

      // Tomador: usa endereço quando fornecido. Validação obrigatória pra SP
      // ficou acima — aqui o caminho é só montar o payload.
      let tomadorPayload: Record<string, unknown> | undefined;
      if (data.tomador) {
        const tomadorCnpj = data.tomador.cnpj?.replace(/\D/g, '') || undefined;
        const tomadorCpf = data.tomador.cpf?.replace(/\D/g, '') || undefined;

        let tomadorEndereco: Record<string, unknown> | undefined;
        if (data.tomador.endereco) {
          tomadorEndereco = {
            logradouro: data.tomador.endereco.logradouro,
            numero: data.tomador.endereco.numero || 'SN',
            complemento: data.tomador.endereco.complemento || undefined,
            bairro: data.tomador.endereco.bairro,
            codigoMunicipio: data.tomador.endereco.codigoMunicipio,
            uf: data.tomador.endereco.uf?.toUpperCase(),
            cep: data.tomador.endereco.cep?.replace(/\D/g, ''),
          };
        }

        tomadorPayload = {
          nome: data.tomador.nome,
          cpf: tomadorCpf,
          cnpj: tomadorCnpj,
          email: data.tomador.email,
          telefone: data.tomador.telefone,
          endereco: tomadorEndereco,
        };
      }

      // Validações NFSe concluídas — alocar número agora (atômico).
      const { number, series } = await getNextInvoiceNumber(businessId, type);

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
        tomador: tomadorPayload,
        servico: {
          codigoTributacaoNacional: (data.codigoServico || '').replace(/\D/g, '').padEnd(6, '0'),
          codigoTributacaoMunicipal: data.codigoServicoMunicipal || undefined,
          discriminacao: data.discriminacao || data.descricaoServico,
          localPrestacao: { codigoMunicipio: codigoMunicipioPrestacao },
          nbs: data.nbs,
          // CNAE normalizado (só dígitos). Mantém undefined quando ausente
          // pra stripEmpty descartar — algumas prefeituras rejeitam tag vazia.
          cnae: data.cnae ? String(data.cnae).replace(/\D/g, '') || undefined : undefined,
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

      let result: Awaited<ReturnType<typeof emitirNFSe>>;
      try {
        result = await emitirNFSe(nfsePayload as NfsePayload);
      } catch (sefazErr) {
        if (sefazErr instanceof Error && isTransientSefazError(sefazErr)) {
          return persistPendingAndRespond({
            businessId,
            type: 'nfse',
            number,
            series,
            clientName: data.tomador?.nome ?? null,
            clientCpfCnpj: (data.tomador?.cnpj || data.tomador?.cpf || '').replace(/\D/g, '') || null,
            totalValue: baseCalculo,
            originalRequest: nfsePayload as Record<string, unknown>,
            ambiente,
            error: sefazErr,
            now,
          });
        }
        throw sefazErr;
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
            // Canoniza pro feminino do FSM (rejeitado→rejeitada, erro mantém)
            // — gravar o masculino cru do gateway divergiria do FSM e da UI.
            status: normalizeFiscalDocumentStatus(result.status) ?? result.status,
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

      // Validação da contingência ANTES da alocação (motivo curto não pode
      // queimar número). O branch forcarContingencia abaixo reusa este check.
      const motivoContingencia = String(data.motivoContingencia || '').trim();
      if (data.forcarContingencia && motivoContingencia.length < 15) {
        return NextResponse.json(
          { error: 'Contingência exige motivoContingencia com 15-256 caracteres (justificativa).' },
          { status: 400 },
        );
      }

      // Validações NFC-e concluídas — alocar número agora (atômico).
      const { number, series } = await getNextInvoiceNumber(businessId, type);

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

      // Contingência off-line NFC-e (tpEmis=9): operador marcou explicitamente
      // que SEFAZ está fora. Gera XML assinado localmente, salva como
      // 'contingencia', responde 200 com chave + xml pra impressão do DANFCE
      // em contingência. Transmissão posterior via /api/fiscal/retry.
      if (data.forcarContingencia) {
        const motivo = motivoContingencia; // já validado antes da alocação
        const dhCont = new Date().toISOString();
        const payloadContingencia = {
          ...(nfcePayload as Record<string, unknown>),
          contingencia: { dhCont, xJust: motivo },
        } as Record<string, unknown> & { certificado: CertificadoPayload; ambiente: SefazAmbiente; contingencia: { dhCont: string; xJust: string } };

        const prep = await prepararNFCeContingencia(payloadContingencia);
        if (!prep.success || !prep.xml || !prep.chaveAcesso) {
          return NextResponse.json(
            {
              error: 'Falha ao preparar contingência.',
              details: prep.motivoStatus || prep.erros?.[0] || 'Resposta sem XML',
            },
            { status: 502 },
          );
        }

        const docRef = await adminDb.collection('fiscalDocuments').add(
          stripEmpty({
            businessId,
            type: 'nfce',
            number,
            series,
            accessKey: prep.chaveAcesso,
            protocol: null,
            status: 'contingencia',
            statusMessage: `Em contingência off-line. Motivo: ${motivo}`,
            clientName: data.nomeConsumidor || null,
            clientCpfCnpj: data.cpfConsumidor?.replace(/\D/g, '') || null,
            xml: prep.xml,
            sefazResponse: prep,
            totalValue: totalNF,
            saleId,
            orderId,
            sourceType,
            contingencia: { dhCont, xJust: motivo, ufEmitente, ambiente },
            issueDate: now,
            createdAt: now,
            updatedAt: now,
          }),
        );

        await linkFiscalDocToSource({
          businessId,
          saleId,
          orderId,
          fiscalDocumentId: docRef.id,
          accessKey: prep.chaveAcesso,
          type: 'nfce',
          status: 'contingencia',
          now,
        });

        return NextResponse.json(
          {
            success: true,
            data: { ...prep, status: 'contingencia' },
            documentId: docRef.id,
            message: 'NFC-e emitida em contingência off-line. Imprima o DANFCE e transmita à SEFAZ quando o serviço voltar.',
          },
          { status: 201 },
        );
      }

      let result: Awaited<ReturnType<typeof emitirNFCe>>;
      try {
        result = await emitirNFCe(nfcePayload as Record<string, unknown> & { certificado: CertificadoPayload; ambiente: SefazAmbiente });
      } catch (sefazErr) {
        if (sefazErr instanceof Error && isTransientSefazError(sefazErr)) {
          return persistPendingAndRespond({
            businessId,
            type: 'nfce',
            number,
            series,
            clientName: data.nomeConsumidor ?? null,
            clientCpfCnpj: data.cpfConsumidor?.replace(/\D/g, '') || null,
            totalValue: totalNF,
            originalRequest: nfcePayload as Record<string, unknown>,
            ufEmitente,
            ambiente,
            error: sefazErr,
            now,
          });
        }
        throw sefazErr;
      }

      // Persist fiscal document — sempre (autorizada, rejeitada ou processando)
      // pra que o usuário consulte o histórico mesmo em caso de falha.
      // ufEmitente/ambiente são obrigatórios pro cron consultar-processando
      // conseguir consultar a nota depois (consultaStatusRunner exige ambos).
      const nfceStatus = normalizeFiscalDocumentStatus(result.status) ?? result.status;
      const nfceDocRef = await adminDb.collection('fiscalDocuments').add(
        stripEmpty({
          businessId,
          type: 'nfce',
          number,
          series,
          accessKey: result.chaveAcesso || null,
          protocol: result.protocolo || null,
          status: nfceStatus,
          statusMessage: result.motivoStatus || result.erros?.[0] || null,
          clientName: data.nomeConsumidor || null,
          clientCpfCnpj: data.cpfConsumidor?.replace(/\D/g, '') || null,
          xml: result.xml || null,
          sefazResponse: result,
          totalValue: totalNF,
          saleId,
          orderId,
          sourceType,
          ufEmitente,
          ambiente,
          issueDate: now,
          createdAt: now,
          updatedAt: now,
        }),
      );

      await linkFiscalDocToSource({
        businessId,
        saleId,
        orderId,
        fiscalDocumentId: nfceDocRef.id,
        accessKey: result.chaveAcesso || null,
        type: 'nfce',
        status: nfceStatus,
        now,
      });

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

    const finalidade = String(data.finalidadeEmissao ?? 1);

    // Devolução (finalidade=4) exige referência à NF-e original (tag <NFref>
    // dentro de <ide>). Sem isso, a SEFAZ rejeita como "nota nova inválida"
    // (rejeição 235/236). Validamos no boundary pra dar mensagem acionável
    // antes do roundtrip.
    let referencias: Array<{ refNFe: string }> | undefined;
    if (finalidade === '4') {
      const refDigits = String(data.refNFe ?? '').replace(/\D/g, '');
      if (refDigits.length !== 44) {
        return NextResponse.json(
          {
            error:
              'NF-e de devolução (finalidade=4) exige a chave de acesso (44 dígitos) da NF-e original sendo devolvida. Informe no campo "Chave da NF-e original" do formulário.',
          },
          { status: 400 },
        );
      }
      referencias = [{ refNFe: refDigits }];
    } else if (data.refNFe) {
      // Operador informou referência mas a finalidade não é devolução —
      // envia mesmo assim (complemento/ajuste também aceitam refs).
      const refDigits = String(data.refNFe).replace(/\D/g, '');
      if (refDigits.length === 44) {
        referencias = [{ refNFe: refDigits }];
      }
    }

    // tipoOperacao: '1'=saída, '0'=entrada. Devolução (finalidade=4) é
    // sempre entrada de mercadoria (cliente devolve pra empresa). Operador
    // pode override explicitamente via data.tipoOperacao, mas o default
    // muda automaticamente baseado na finalidade.
    const tipoOperacao = data.tipoOperacao !== undefined
      ? String(data.tipoOperacao)
      : finalidade === '4' ? '0' : '1';

    // Validações NF-e concluídas — alocar número agora (atômico).
    const { number, series } = await getNextInvoiceNumber(businessId, type);

    const nfePayload = stripEmpty({
      emitente,
      numero: number,
      serie: series,
      ufEmitente,
      ambiente,
      naturezaOperacao: data.naturezaOperacao || 'VENDA DE MERCADORIA',
      tipoOperacao,
      finalidade,
      consumidorFinal: String(data.consumidorFinal ?? 0),
      presencaComprador: String(data.presencaComprador ?? 1),
      destinatario,
      itens: items,
      pagamento,
      transporte: {
        modFrete: String(data.modalidadeFrete ?? 9),
      },
      referencias,
      informacoesAdicionais: data.informacoesAdicionais
        ? { contribuinte: data.informacoesAdicionais }
        : undefined,
      certificado,
    });

    let result: Awaited<ReturnType<typeof emitirNFe>>;
    try {
      result = await emitirNFe(nfePayload as Record<string, unknown> & { certificado: CertificadoPayload; ambiente: SefazAmbiente });
    } catch (sefazErr) {
      if (sefazErr instanceof Error && isTransientSefazError(sefazErr)) {
        return persistPendingAndRespond({
          businessId,
          type: 'nfe',
          number,
          series,
          clientName: data.recipient?.name ?? null,
          clientCpfCnpj: data.recipient?.document?.replace(/\D/g, '') || null,
          totalValue: totalNF,
          originalRequest: nfePayload as Record<string, unknown>,
          ufEmitente,
          ambiente,
          error: sefazErr,
          now,
        });
      }
      throw sefazErr;
    }

    // Persist fiscal document — sempre (autorizada, rejeitada ou processando).
    // ufEmitente/ambiente são obrigatórios pro cron consultar-processando.
    const nfeStatus = normalizeFiscalDocumentStatus(result.status) ?? result.status;
    const nfeDocRef = await adminDb.collection('fiscalDocuments').add(
      stripEmpty({
        businessId,
        type: 'nfe',
        number,
        series,
        accessKey: result.chaveAcesso || null,
        protocol: result.protocolo || null,
        status: nfeStatus,
        statusMessage: result.motivoStatus || result.erros?.[0] || null,
        clientName: data.recipient?.name || null,
        clientCpfCnpj: data.recipient?.document?.replace(/\D/g, '') || null,
        xml: result.xml || null,
        sefazResponse: result,
        totalValue: totalNF,
        saleId,
        orderId,
        sourceType,
        ufEmitente,
        ambiente,
        issueDate: now,
        createdAt: now,
        updatedAt: now,
      }),
    );

    await linkFiscalDocToSource({
      businessId,
      saleId,
      orderId,
      fiscalDocumentId: nfeDocRef.id,
      accessKey: result.chaveAcesso || null,
      type: 'nfe',
      status: nfeStatus,
      now,
    });

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
