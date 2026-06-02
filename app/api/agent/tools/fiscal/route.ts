import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import { parseToolRequest, validateToolResponse, isContractError } from '@/contracts/_runtime/agentToolValidation';
import type { FiscalToolAction } from '@/contracts/api/agent/fiscal';
import { cancelarNFe, resolveAmbiente, type SefazAmbiente } from '@/lib/services/sefaz-gateway';
import { getCertificadoPayload } from '@/lib/fiscal/certificate-manager';
import { resolveUfEmitente } from '@/lib/fiscal/uf';

type Action = FiscalToolAction;

// Campos do fiscalDocument que o agent precisa — XML/sefazResponse crus ficam
// de fora (payload enorme e sensível; o agent só raciocina sobre status/chave).
function toShort(id: string, data: FirebaseFirestore.DocumentData) {
  return {
    id,
    businessId: data.businessId,
    type: data.type,
    number: data.number,
    series: data.series,
    status: data.status,
    statusMessage: data.statusMessage ?? null,
    accessKey: data.accessKey ?? null,
    protocol: data.protocol ?? null,
    clientName: data.clientName ?? null,
    clientCpfCnpj: data.clientCpfCnpj ?? null,
    totalValue: typeof data.totalValue === 'number' ? data.totalValue : undefined,
    issueDate: data.issueDate,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await verifyAgentRequest(req);
  } catch (err) {
    const resp = agentAuthErrorResponse(err);
    if (resp) return resp;
    throw err;
  }

  const rawBody = parseAgentBody<{ action: Action; params: Record<string, unknown> }>(ctx.rawBody);
  const { businessId } = ctx;

  let action: Action;
  let params: Record<string, unknown>;
  try {
    const parsed = parseToolRequest('fiscal', rawBody);
    action = parsed.action as Action;
    params = parsed.params as Record<string, unknown>;
  } catch (err) {
    if (isContractError(err)) {
      return NextResponse.json(err.toEnvelope(), { status: 400 });
    }
    throw err;
  }

  try {
    let data: unknown;
    switch (action) {
      case 'get':
        data = await getDocument(businessId, params.id as string);
        break;
      case 'query_status':
        data = await queryStatus(businessId, params.id as string | undefined, params.accessKey as string | undefined);
        break;
      case 'list':
        data = await listDocuments(
          businessId,
          params.type as string | undefined,
          params.status as string | undefined,
          (params.limit as number) || 20,
        );
        break;
      case 'emit':
        // emit/cancel são role-gated (>= manager) no use_case `operator` via
        // TOOL_MIN_ROLE no guardrails do agent Python — aqui só validamos
        // shape + tenant.
        data = await emitDocument(businessId, params);
        break;
      case 'cancel':
        data = await cancelDocument(businessId, params as unknown as CancelParams);
        break;
      default: {
        const exhaustiveCheck: never = action;
        return NextResponse.json({ ok: false, error: `Unknown action: ${exhaustiveCheck}` }, { status: 400 });
      }
    }

    const validated = validateToolResponse('fiscal', action, data);
    return NextResponse.json({ ok: true, data: validated });
  } catch (err) {
    if (isContractError(err)) {
      return NextResponse.json(err.toEnvelope(), { status: err.code === 'INTERNAL' ? 500 : 400 });
    }
    console.error('[agent/tools/fiscal]', action, err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

// ─── Read-first implementations ───────────────────────────────────────────────

async function getDocument(businessId: string, id: string) {
  const snap = await adminDb.collection('fiscalDocuments').doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  // Cross-tenant guard — adminDb bypassa Firestore rules.
  if (data.businessId !== businessId) return null;
  return toShort(snap.id, data);
}

async function queryStatus(businessId: string, id?: string, accessKey?: string) {
  let docData: FirebaseFirestore.DocumentData | undefined;
  let docId: string | undefined;

  if (id) {
    const snap = await adminDb.collection('fiscalDocuments').doc(id).get();
    if (snap.exists && snap.data()!.businessId === businessId) {
      docData = snap.data()!;
      docId = snap.id;
    }
  } else if (accessKey) {
    const snap = await adminDb.collection('fiscalDocuments')
      .where('businessId', '==', businessId)
      .where('accessKey', '==', accessKey)
      .limit(1)
      .get();
    if (!snap.empty) {
      docData = snap.docs[0].data();
      docId = snap.docs[0].id;
    }
  }

  if (!docData) return null;
  return {
    id: docId,
    type: docData.type,
    status: docData.status,
    statusMessage: docData.statusMessage ?? null,
    accessKey: docData.accessKey ?? null,
    protocol: docData.protocol ?? null,
  };
}

async function listDocuments(businessId: string, type?: string, status?: string, limit = 20) {
  let q: FirebaseFirestore.Query = adminDb.collection('fiscalDocuments')
    .where('businessId', '==', businessId);
  if (type) q = q.where('type', '==', type);
  if (status) q = q.where('status', '==', status);
  q = q.orderBy('createdAt', 'desc').limit(Math.min(limit, 100));

  const snap = await q.get();
  return snap.docs.map(d => toShort(d.id, d.data()));
}

// ─── Mutating implementations (role-gated upstream) ───────────────────────────

interface CancelParams {
  type: 'nfe' | 'nfce' | 'nfse';
  chaveAcesso: string;
  justificativa: string;
  protocolo?: string;
  codigoCancelamento?: '1' | '2' | '3' | '4';
}

async function cancelDocument(businessId: string, p: CancelParams) {
  // NFSe tem fluxo de cancelamento específico por município (lookup de número,
  // payload do prestador, codigoCancelamento) já implementado em
  // /api/fiscal/cancel. Replicá-lo aqui seria um rewrite arriscado.
  // TODO(auditoria/P1.3): expor cancelamento de NFSe ao agent extraindo o
  // fluxo de /api/fiscal/cancel para um serviço compartilhado em lib/fiscal/.
  if (p.type === 'nfse') {
    throw new Error('Cancelamento de NFSe pelo agent ainda não suportado — use o painel Fiscal.');
  }

  if (p.chaveAcesso.replace(/\D/g, '').length !== 44) {
    throw new Error('Chave de acesso deve conter 44 dígitos.');
  }

  // Resolve certificado/ambiente/UF do tenant (mesma lógica de /api/fiscal/cancel).
  const businessDoc = await adminDb.collection('businesses').doc(businessId).get();
  if (!businessDoc.exists) throw new Error('Empresa não encontrada.');
  const bizData = businessDoc.data()!;
  const fiscal = bizData.fiscal;
  const rawEnv = p.type === 'nfce'
    ? (fiscal?.nfceConfig?.environment ?? fiscal?.nfeConfig?.environment ?? fiscal?.environment)
    : (fiscal?.nfeConfig?.environment ?? fiscal?.environment);
  const ambiente: SefazAmbiente = resolveAmbiente(rawEnv);
  const ufFromBusiness: string | undefined = bizData.endereco?.uf?.toUpperCase();

  let certificado;
  try {
    certificado = await getCertificadoPayload(businessId);
  } catch {
    throw new Error('Certificado digital não disponível.');
  }

  const ufEmitente = resolveUfEmitente({ ufFromBusiness, chaveAcesso: p.chaveAcesso });

  const result = await cancelarNFe({
    chaveAcesso: p.chaveAcesso,
    protocolo: p.protocolo || '',
    justificativa: p.justificativa.trim(),
    ufEmitente,
    ambiente,
    certificado,
  });

  const isCancelled = result.status === 'cancelado' || result.success === true;
  if (!isCancelled) {
    return {
      success: false,
      status: result.status,
      message: result.motivoStatus || result.erros?.[0] || 'Cancelamento rejeitado pela SEFAZ.',
    };
  }

  // Reflete o cancelamento no fiscalDocument persistido (best-effort, tenant-scoped).
  try {
    const docSnap = await adminDb.collection('fiscalDocuments')
      .where('businessId', '==', businessId)
      .where('accessKey', '==', p.chaveAcesso)
      .limit(1)
      .get();
    if (!docSnap.empty) {
      await docSnap.docs[0].ref.update({
        status: 'cancelada',
        canceledAt: new Date().toISOString(),
        cancelReason: p.justificativa.trim(),
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn('[agent/tools/fiscal] cancel: failed to update fiscalDocument', err);
  }

  return { success: true, status: 'cancelado', message: result.motivoStatus };
}

async function emitDocument(_businessId: string, _params: Record<string, unknown>) {
  // A montagem do payload de emissão (enrichment de Product, blocos tributários
  // ICMS/PIS/COFINS/IPI, CSC de NFC-e, regras municipais de NFSe, peek/commit do
  // número de série) vive em /api/fiscal/emit (~1100 linhas) e depende de auth de
  // usuário Firebase, não HMAC. Replicá-la aqui seria um rewrite amplo e arriscado
  // num domínio regulatório — uma emissão mal montada gera nota fiscal inválida.
  // TODO(auditoria/P1.3): extrair o pipeline de emissão de /api/fiscal/emit para
  // um serviço compartilhado em lib/fiscal/ (recebendo businessId + payload) e
  // chamá-lo aqui, gerando a mesma idempotência/persistência do caminho humano.
  void _businessId;
  void _params;
  throw new Error(
    'Emissão fiscal pelo agent ainda não suportada — use o painel Fiscal. ' +
    'O agent pode consultar (get/query_status/list) e cancelar NF-e/NFC-e.',
  );
}
