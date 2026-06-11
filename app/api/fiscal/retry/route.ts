import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { UserRole } from '@/lib/types';
import {
  emitirNFe,
  emitirNFCe,
  emitirNFSe,
  transmitirNFCeContingencia,
  NfsePayload,
  CertificadoPayload,
  SefazAmbiente,
  isTransientSefazError,
  resolveAmbiente,
} from '@/lib/services/sefaz-gateway';
import { getCertificadoPayload } from '@/lib/fiscal/certificate-manager';
import { decryptToken } from '@/lib/utils/encryption';
import { commitInvoiceNumber } from '@/lib/fiscal/number-sequence';

/**
 * POST /api/fiscal/retry
 *
 * Reenvia um documento fiscal que ficou em status 'pendente' (SEFAZ
 * estava indisponível no momento da emissão original). O documento
 * mantém o mesmo número/série da tentativa anterior — só o XML é
 * reconstruído pela emissão. O certificado NÃO é lido do documento
 * (não é persistido por segurança) — vem do business.
 *
 * Body: { businessId: string; documentId: string }
 *
 * Respostas:
 *   200 + { success: true, data: <result> } — SEFAZ aceitou
 *   200 + { success: false, fallback: 'pending' } — SEFAZ ainda fora
 *   400 — documento não existe / não está pendente / sem originalRequest
 *   500 — erro não-transiente
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { businessId, documentId } = body as { businessId?: string; documentId?: string };

    if (!businessId || !documentId) {
      return NextResponse.json(
        { error: 'businessId e documentId são obrigatórios.' },
        { status: 400 },
      );
    }

    const auth = await verifyAuth(request, businessId);
    if (isAuthError(auth)) return auth;
    if (ROLE_HIERARCHY[auth.role as UserRole] < ROLE_HIERARCHY['admin']) {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
    }

    const docRef = adminDb.collection('fiscalDocuments').doc(documentId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return NextResponse.json({ error: 'Documento não encontrado.' }, { status: 404 });
    }
    const docData = docSnap.data()!;

    if (docData.businessId !== businessId) {
      return NextResponse.json({ error: 'Documento de outro tenant.' }, { status: 403 });
    }
    if (docData.status !== 'pendente' && docData.status !== 'contingencia') {
      return NextResponse.json(
        { error: `Documento não está pendente nem em contingência (status atual: ${docData.status}). Apenas esses podem ser reenviados.` },
        { status: 400 },
      );
    }
    // Pendente precisa do payload original; contingência precisa do XML pré-assinado.
    if (docData.status === 'pendente' && !docData.originalRequest) {
      return NextResponse.json(
        { error: 'Documento pendente sem originalRequest — não há como reenviar. Emita uma nova nota.' },
        { status: 400 },
      );
    }
    if (docData.status === 'contingencia' && !docData.xml) {
      return NextResponse.json(
        { error: 'Documento em contingência sem XML salvo — caso anômalo. Reemita a nota.' },
        { status: 400 },
      );
    }

    // Certificado vem do business (nunca persistido no documento).
    let certificado: CertificadoPayload;
    try {
      certificado = await getCertificadoPayload(businessId);
    } catch (certError) {
      return NextResponse.json(
        {
          error: 'Certificado digital não disponível.',
          details: certError instanceof Error ? certError.message : 'Erro desconhecido',
        },
        { status: 400 },
      );
    }

    const originalRequest = (docData.originalRequest || {}) as Record<string, unknown>;
    const now = new Date().toISOString();
    const type = docData.type as 'nfe' | 'nfce' | 'nfse';
    const isContingencia = docData.status === 'contingencia';

    // Docs pendentes antigos guardavam o request da UI (items/recipient/...),
    // não o payload do gateway — replay direto resultaria em 400 opaco do
    // sefaz-api. Detecta o formato legado e orienta reemissão.
    if (!isContingencia) {
      const isGatewayShape =
        type === 'nfse' ? 'prestador' in originalRequest : 'emitente' in originalRequest;
      if (!isGatewayShape) {
        return NextResponse.json(
          { error: 'Documento pendente em formato antigo (anterior à correção do retry) — não é possível reenviar. Emita uma nova nota.' },
          { status: 400 },
        );
      }
    }

    try {
      let result: Awaited<ReturnType<typeof emitirNFe>>;
      if (isContingencia) {
        // Em contingência: o XML já foi assinado quando emitido. Só transmite.
        // Pega UF/ambiente do snapshot salvo (originalRequest pode estar vazio).
        const meta = (docData.contingencia || {}) as { ufEmitente?: string; ambiente?: string };
        const ufEmitente = meta.ufEmitente || (originalRequest.ufEmitente as string) || '';
        if (!ufEmitente) {
          return NextResponse.json(
            { error: 'UF do emitente não encontrada no documento de contingência.' },
            { status: 400 },
          );
        }
        result = await transmitirNFCeContingencia({
          signedXml: docData.xml as string,
          ufEmitente,
          certificado,
          ambiente: resolveAmbiente(meta.ambiente),
        });
      } else if (type === 'nfse') {
        // originalRequest é o payload do gateway montado pelo emit (sem
        // certificado, removido por segurança) — replay direto.
        const payload = { ...originalRequest, certificado };
        result = await emitirNFSe(payload as NfsePayload);
      } else if (type === 'nfce') {
        // CSC não é persistido (token sensível) — re-resolve do business,
        // mesma lógica do emit (cscTokenEncrypted preferido, legado plaintext).
        const businessDoc = await adminDb.collection('businesses').doc(businessId).get();
        const nfceConfig = businessDoc.data()?.fiscal?.nfceConfig;
        const cscTokenPlain = nfceConfig?.cscTokenEncrypted
          ? await decryptToken(nfceConfig.cscTokenEncrypted)
          : nfceConfig?.cscToken || '';
        if (!nfceConfig?.cscId || !cscTokenPlain) {
          return NextResponse.json(
            { error: 'CSC não configurado para NFC-e — configure em Configurações → Fiscal antes de reenviar.' },
            { status: 400 },
          );
        }
        const payload = {
          ...originalRequest,
          csc: { id: nfceConfig.cscId, token: cscTokenPlain },
          certificado,
        };
        result = await emitirNFCe(payload as unknown as Record<string, unknown> & { certificado: CertificadoPayload; ambiente: SefazAmbiente });
      } else {
        const payload = { ...originalRequest, certificado };
        result = await emitirNFe(payload as Record<string, unknown> & { certificado: CertificadoPayload; ambiente: SefazAmbiente });
      }

      // Atualiza o documento com o resultado. Mantém number/series originais
      // da 1ª tentativa. ATENÇÃO: peek não reserva — se outra emissão consumiu
      // o número entre o pendente e este retry, a SEFAZ rejeita com 539
      // (reserva atômica é o fix definitivo, pendente no backlog).
      const nextStatus =
        result.status === 'autorizado' ? 'autorizada' :
        result.status === 'processando' ? 'processando' :
        result.status;

      // Commit quando a SEFAZ consumiu o número (autorizado OU processando).
      if (!isContingencia && (nextStatus === 'autorizada' || nextStatus === 'processando')) {
        const docNumber = Number(docData.number);
        if (docNumber > 0) {
          await commitInvoiceNumber(businessId, type, docNumber);
        }
      }

      // Contingência: o XML assinado tpEmis=9 (DANFCE já impresso pro cliente)
      // é o ÚNICO artefato da nota — nunca sobrescrever com null em rejeição/
      // processando, senão o doc fica irrecuperável.
      const xmlToPersist = result.xml || (isContingencia ? docData.xml : null);
      // Rejeição na transmissão de contingência mantém o doc elegível pra
      // retry (status 'contingencia') — extemporaneidade é tratada pelo cron
      // (marca 'rejeitada' após a janela de 24h).
      const statusToPersist =
        isContingencia && nextStatus !== 'autorizada' && nextStatus !== 'processando'
          ? 'contingencia'
          : nextStatus;

      await docRef.update({
        status: statusToPersist,
        statusMessage: result.motivoStatus || result.mensagens?.[0]?.mensagem || result.erros?.[0] || null,
        accessKey: result.chaveAcesso || result.codigoVerificacao || docData.accessKey || null,
        protocol: result.protocolo || null,
        xml: xmlToPersist,
        pdfUrl: result.linkVisualizacao || null,
        sefazResponse: result,
        // Limpa originalRequest após sucesso — não precisa mais e libera espaço.
        originalRequest: nextStatus === 'autorizada' ? null : originalRequest,
        retriedAt: now,
        updatedAt: now,
      });

      return NextResponse.json(
        { success: result.success ?? nextStatus === 'autorizada', data: result },
        { status: 200 },
      );
    } catch (sefazErr) {
      if (sefazErr instanceof Error && isTransientSefazError(sefazErr)) {
        // SEFAZ ainda fora. Atualiza só a mensagem e timestamp.
        await docRef.update({
          statusMessage: sefazErr.message || 'SEFAZ ainda indisponível',
          retriedAt: now,
          updatedAt: now,
        });
        return NextResponse.json(
          {
            success: false,
            fallback: 'pending',
            message: 'SEFAZ ainda indisponível. Tente novamente mais tarde.',
          },
          { status: 200 },
        );
      }
      throw sefazErr;
    }
  } catch (error) {
    console.error('[Fiscal Retry] Erro:', error);
    return NextResponse.json(
      {
        error: 'Erro interno ao reenviar documento fiscal.',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 },
    );
  }
}
