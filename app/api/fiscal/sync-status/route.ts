import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { UserRole } from '@/lib/types';
import { consultarNFe, resolveAmbiente, SefazAmbiente } from '@/lib/services/sefaz-gateway';
import { getCertificadoPayload } from '@/lib/fiscal/certificate-manager';
import { resolveUfEmitente } from '@/lib/fiscal/uf';
import { SyncStatusRequestSchema } from '@/lib/contracts/api/fiscal/sync-status';
import {
  normalizeFiscalDocumentStatus,
  canTransitionFiscalDocument,
} from '@/lib/contracts/fsm/fiscalDocument';

const SEFAZ_API_URL = process.env.SEFAZ_API_URL;
const SEFAZ_API_KEY = process.env.SEFAZ_API_KEY;

/**
 * Sincroniza o status de um fiscalDocument com a SEFAZ e PERSISTE server-side.
 * Antes, o FiscalModule consultava e gravava o status via updateDoc no cliente,
 * burlando o FSM (R4) e podendo rebaixar uma nota autorizada. Aqui a escrita é
 * autoritativa: consulta → normaliza → valida transição → grava via adminDb.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = SyncStatusRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Payload inválido.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { businessId, documentId } = parsed.data;

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
    const doc = docSnap.data()!;
    if (doc.businessId !== businessId) {
      return NextResponse.json({ error: 'Documento de outro tenant.' }, { status: 403 });
    }

    const accessKey = String(doc.accessKey || '').replace(/\D/g, '');
    const type = (doc.type as 'nfe' | 'nfce' | 'nfse') || 'nfe';

    // Resolve ambiente, UF e certificado do tenant.
    const businessDoc = await adminDb.collection('businesses').doc(businessId).get();
    const bizData = businessDoc.exists ? businessDoc.data() : null;
    const fiscal = bizData?.fiscal;
    const rawEnv =
      type === 'nfce'
        ? (fiscal?.nfceConfig?.environment ?? fiscal?.nfeConfig?.environment ?? fiscal?.environment)
        : (fiscal?.nfeConfig?.environment ?? fiscal?.environment);
    const ambiente: SefazAmbiente = resolveAmbiente(rawEnv);

    let certificado;
    try {
      certificado = await getCertificadoPayload(businessId);
    } catch {
      return NextResponse.json({ error: 'Certificado digital não disponível.' }, { status: 400 });
    }

    // Consulta na SEFAZ conforme o tipo.
    let sefazStatus: string | undefined;
    let protocolo: string | undefined;
    if (type === 'nfse') {
      if (accessKey.length !== 50 || !SEFAZ_API_URL || !SEFAZ_API_KEY) {
        return NextResponse.json(
          { error: 'Sincronização de NFSe exige chave de 50 dígitos e gateway configurado.' },
          { status: 400 },
        );
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      try {
        const resp = await fetch(`${SEFAZ_API_URL}/nfse/consultar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SEFAZ_API_KEY}` },
          body: JSON.stringify({ chaveAcesso: accessKey, ambiente, certificado }),
          signal: controller.signal,
        });
        const json = await resp.json().catch(() => null);
        sefazStatus = json?.status ?? json?.data?.status;
        protocolo = json?.protocolo ?? json?.data?.protocolo;
      } catch (err) {
        return NextResponse.json(
          { error: 'Falha ao consultar NFSe na SEFAZ.', details: String(err) },
          { status: 504 },
        );
      } finally {
        clearTimeout(timer);
      }
    } else {
      if (accessKey.length !== 44) {
        return NextResponse.json(
          { error: 'Documento sem chave de acesso de 44 dígitos para sincronizar.' },
          { status: 400 },
        );
      }
      const ufEmitente = resolveUfEmitente({
        ufFromBusiness: bizData?.endereco?.uf?.toUpperCase(),
        chaveAcesso: accessKey,
      });
      const result = await consultarNFe({ chaveAcesso: accessKey, ufEmitente, ambiente, certificado });
      sefazStatus = result.status;
      protocolo = result.protocolo;
    }

    // 'erro' = falha da consulta, não veredito — preserva o status atual.
    if (!sefazStatus || sefazStatus === 'erro') {
      return NextResponse.json(
        { success: true, status: doc.status, unchanged: true, message: 'SEFAZ não retornou status definitivo — documento preservado.' },
        { status: 200 },
      );
    }

    const from = normalizeFiscalDocumentStatus(doc.status);
    const to = normalizeFiscalDocumentStatus(sefazStatus);
    if (!to) {
      return NextResponse.json({ success: true, status: doc.status, unchanged: true }, { status: 200 });
    }
    if (to === from) {
      return NextResponse.json({ success: true, status: doc.status, unchanged: true }, { status: 200 });
    }
    // Guard FSM: não rebaixar autorizada→rejeitada (delay de replicação), etc.
    if (from && !canTransitionFiscalDocument(from, to)) {
      console.warn(`[sync-status] Transição inválida ${from}→${to} ignorada (doc ${documentId})`);
      return NextResponse.json(
        { success: true, status: doc.status, unchanged: true, message: `Transição ${from}→${to} não permitida — status preservado.` },
        { status: 200 },
      );
    }

    await docRef.update({
      status: to,
      ...(protocolo ? { protocol: protocolo } : {}),
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, status: to }, { status: 200 });
  } catch (error) {
    console.error('[Fiscal Sync-Status] Erro:', error);
    return NextResponse.json(
      { error: 'Erro interno ao sincronizar status.', details: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 },
    );
  }
}
