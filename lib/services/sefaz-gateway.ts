// lib/services/sefaz-gateway.ts
// SEFAZ API Gateway — connects to external fiscal emission service
// Server-side only (uses process.env secrets)

import * as https from 'https';
import * as http from 'http';

const SEFAZ_API_URL = process.env.SEFAZ_API_URL || 'https://emissao.tensorroot.com';
const SEFAZ_API_KEY = process.env.SEFAZ_API_KEY || '';

// ---------------------------------------------------------------------------
// Connection Pooling — reuse TCP connections across requests
// ---------------------------------------------------------------------------

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 10,
});

const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 10,
});

function getAgent(url: string) {
  return url.startsWith('https') ? httpsAgent : httpAgent;
}

// ---------------------------------------------------------------------------
// Mock Mode — for development/testing without real SEFAZ calls
// ---------------------------------------------------------------------------

function isMockMode(): boolean {
  return process.env.SEFAZ_AMBIENTE === 'mock';
}

function generateMockAccessKey(): string {
  const uf = '35';
  const now = new Date();
  const aamm = String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, '0');
  const cnpj = '00000000000191';
  const mod = '65';
  const serie = '001';
  const num = String(Math.floor(Math.random() * 999999999)).padStart(9, '0');
  const tpEmis = '1';
  const cNF = String(Math.floor(Math.random() * 99999999)).padStart(8, '0');
  const partial = `${uf}${aamm}${cnpj}${mod}${serie}${num}${tpEmis}${cNF}`;
  let sum = 0;
  let weight = 2;
  for (let i = partial.length - 1; i >= 0; i--) {
    sum += parseInt(partial[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  const dv = remainder < 2 ? 0 : 11 - remainder;
  return `${partial}${dv}`;
}

function generateMockProtocol(): string {
  const year = String(new Date().getFullYear()).slice(2);
  const seq = String(Math.floor(Math.random() * 9999999999)).padStart(10, '0');
  return `135${year}${seq}`;
}

function generateMockXml(tipo: 'nfe' | 'nfce', chaveAcesso: string, protocolo: string): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${chaveAcesso}" versao="4.00">
      <ide>
        <mod>${tipo === 'nfce' ? '65' : '55'}</mod>
        <tpAmb>2</tpAmb>
        <dhEmi>${now}</dhEmi>
      </ide>
    </infNFe>
  </NFe>
  <protNFe versao="4.00">
    <infProt>
      <tpAmb>2</tpAmb>
      <chNFe>${chaveAcesso}</chNFe>
      <dhRecbto>${now}</dhRecbto>
      <nProt>${protocolo}</nProt>
      <cStat>100</cStat>
      <xMotivo>Autorizado o uso da ${tipo === 'nfce' ? 'NFC-e' : 'NF-e'} (MOCK)</xMotivo>
    </infProt>
  </protNFe>
</nfeProc>`;
}

function buildMockResponse(tipo: 'nfe' | 'nfce'): SefazResponse {
  const chaveAcesso = generateMockAccessKey();
  const protocolo = generateMockProtocol();
  const xml = generateMockXml(tipo, chaveAcesso, protocolo);
  return {
    success: true,
    status: 'autorizado',
    codigoStatus: '100',
    motivoStatus: `Autorizado o uso da ${tipo === 'nfce' ? 'NFC-e' : 'NF-e'} (MOCK - ambiente de teste)`,
    chaveAcesso,
    protocolo,
    dataRecebimento: new Date().toISOString(),
    xml,
    nRec: null,
    erros: null,
  };
}

function buildMockCancelResponse(): SefazResponse {
  return {
    success: true,
    status: 'cancelado',
    codigoStatus: '135',
    motivoStatus: 'Evento registrado e vinculado a NF-e (MOCK)',
    protocolo: generateMockProtocol(),
    dataRecebimento: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SefazResponse {
  success: boolean;
  status: 'autorizado' | 'rejeitado' | 'processando' | 'denegado' | 'cancelado' | 'erro';
  codigoStatus?: string;
  motivoStatus?: string;
  chaveAcesso?: string;
  protocolo?: string;
  dataRecebimento?: string;
  xml?: string;
  nRec?: string | null;
  erros?: string[] | null;
}

export interface CertificadoPayload {
  pfxBase64: string;
  password: string;
}

export type SefazAmbiente = 'producao' | 'homologacao';

/** Resolve o campo environment do Firestore ('production' | qualquer) para o valor aceito pelo SEFAZ-API */
export function resolveAmbiente(environment?: string): SefazAmbiente {
  return environment === 'production' ? 'producao' : 'homologacao';
}

// ---------------------------------------------------------------------------
// Core request helper
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const TIMEOUT_MS = 60_000;

async function sefazRequest<T = SefazResponse>(
  operation: string,
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const url = `${SEFAZ_API_URL}${endpoint}`;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      console.log(`[SEFAZ] ${operation} attempt ${attempt}/${MAX_RETRIES} → ${endpoint}`);

      const fetchOptions: RequestInit & { agent?: unknown } = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SEFAZ_API_KEY}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      };
      // Node.js fetch supports agent via undici — for environments that support it
      try { (fetchOptions as Record<string, unknown>).dispatcher = getAgent(url); } catch { /* ignore */ }

      const response = await fetch(url, fetchOptions);

      clearTimeout(timer);

      console.log(`[SEFAZ] ${operation} → HTTP ${response.status}`);

      // 401/403 — auth error, no point retrying
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `[SEFAZ] Erro de autenticacao (${response.status}). Verifique SEFAZ_API_KEY.`,
        );
      }

      // 422 — SEFAZ rejection (nota rejeitada, dados invalidos, etc.)
      // Return as-is so the caller can inspect status/erros
      if (response.status === 422) {
        const body = (await response.json()) as T;
        return body;
      }

      // 400 — bad request (malformed payload)
      if (response.status === 400) {
        const body = await response.json().catch(() => null);
        const detail =
          body && typeof body === 'object' && 'message' in body
            ? (body as { message: string }).message
            : response.statusText;
        throw new Error(`[SEFAZ] Requisicao invalida (400): ${detail}`);
      }

      // 5xx — server error, retry
      if (response.status >= 500) {
        lastError = new Error(
          `[SEFAZ] Erro do servidor (${response.status}): ${response.statusText}`,
        );
        // fall through to retry logic below
      } else if (!response.ok) {
        // Any other non-2xx
        throw new Error(
          `[SEFAZ] Resposta inesperada (${response.status}): ${response.statusText}`,
        );
      } else {
        // 2xx — success
        const body = (await response.json()) as T;
        return body;
      }
    } catch (err) {
      clearTimeout(timer);

      if (err instanceof DOMException && err.name === 'AbortError') {
        lastError = new Error(`[SEFAZ] Timeout apos ${TIMEOUT_MS / 1000}s na operacao ${operation}`);
      } else if (
        err instanceof Error &&
        err.message.startsWith('[SEFAZ]') &&
        // Only retry on server errors; auth/bad-request/unexpected should throw immediately
        !err.message.includes('Erro do servidor')
      ) {
        throw err;
      } else if (err instanceof Error) {
        lastError = err;
      } else {
        lastError = new Error(String(err));
      }
    }

    // Exponential backoff before next attempt (1s, 2s, 4s)
    if (attempt < MAX_RETRIES) {
      const backoff = Math.pow(2, attempt - 1) * 1000;
      console.log(`[SEFAZ] ${operation} — retrying in ${backoff / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  throw lastError ?? new Error(`[SEFAZ] ${operation} falhou apos ${MAX_RETRIES} tentativas`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function emitirNFe(
  payload: Record<string, unknown> & { certificado: CertificadoPayload; ambiente: SefazAmbiente },
): Promise<SefazResponse> {
  if (isMockMode()) {
    console.log('[SEFAZ] Mock mode — emitirNFe');
    return buildMockResponse('nfe');
  }
  return sefazRequest('emitirNFe', '/nfe/emitir', payload);
}

export async function emitirNFCe(
  payload: Record<string, unknown> & { certificado: CertificadoPayload; ambiente: SefazAmbiente },
): Promise<SefazResponse> {
  if (isMockMode()) {
    console.log('[SEFAZ] Mock mode — emitirNFCe');
    return buildMockResponse('nfce');
  }
  return sefazRequest('emitirNFCe', '/nfe/nfce/emitir', payload);
}

export async function cancelarNFe(payload: {
  chaveAcesso: string;
  protocolo: string;
  justificativa: string;
  ufEmitente: string;
  ambiente: SefazAmbiente;
  certificado: CertificadoPayload;
}): Promise<SefazResponse> {
  if (isMockMode()) {
    console.log('[SEFAZ] Mock mode — cancelarNFe');
    return buildMockCancelResponse();
  }
  return sefazRequest('cancelarNFe', '/nfe/cancelar', payload);
}

export async function cartaCorrecaoNFe(payload: {
  chaveAcesso: string;
  correcao: string;
  ufEmitente: string;
  sequencia?: number;
  ambiente: SefazAmbiente;
  certificado: CertificadoPayload;
}): Promise<SefazResponse> {
  return sefazRequest('cartaCorrecaoNFe', '/nfe/carta-correcao', payload);
}

export async function inutilizarNFe(payload: {
  cnpj: string;
  serie: string;
  numeroInicial: number;
  numeroFinal: number;
  justificativa: string;
  modelo: '55' | '65';
  ano: string;
  ufEmitente: string;
  ambiente: SefazAmbiente;
  certificado: CertificadoPayload;
}): Promise<SefazResponse> {
  return sefazRequest('inutilizarNFe', '/nfe/inutilizar', payload);
}

export async function consultarNFe(payload: {
  chaveAcesso: string;
  ufEmitente: string;
  ambiente: SefazAmbiente;
  certificado: CertificadoPayload;
}): Promise<SefazResponse> {
  return sefazRequest('consultarNFe', '/nfe/consultar', payload);
}

export async function statusSefaz(payload: {
  ufEmitente: string;
  ambiente: SefazAmbiente;
  certificado: CertificadoPayload;
}): Promise<SefazResponse> {
  return sefazRequest('statusSefaz', '/nfe/status', payload);
}

// ---------------------------------------------------------------------------
// NFS-e (Nota Fiscal de Serviço)
// ---------------------------------------------------------------------------

export interface NfsePayload {
  numeroDPS: number;
  serie: string;
  codigoMunicipioEmissao: string;
  prestador: {
    cnpj: string;
    inscricaoMunicipal?: string;
    nome: string;
    nomeFantasia?: string;
    simplesNacional?: '1' | '2';
  };
  tomador: {
    nome: string;
    cpf?: string;
    cnpj?: string;
    email?: string;
    telefone?: string;
  };
  servico: {
    codigoTributacaoNacional: string;
    codigoTributacaoMunicipal?: string;
    discriminacao: string;
    localPrestacao?: { codigoMunicipio: string };
    nbs?: string;
  };
  valores: {
    valorServicos: number;
    valorDeducoes?: number;
    valorDescontoCondicionado?: number;
    valorDescontoIncondicionado?: number;
  };
  issqn: {
    tipoRetencaoISSQN: '1' | '2' | '3';
    baseCalculo: number;
    aliquota: number;
    valorISS: number;
    valorISSRetido?: number;
  };
  informacoesComplementares?: string;
  ambiente: SefazAmbiente;
  certificado: CertificadoPayload;
}

export async function emitirNFSe(payload: NfsePayload): Promise<SefazResponse> {
  if (isMockMode()) {
    console.log('[SEFAZ] Mock mode — emitirNFSe');
    const chaveAcesso = String(Math.floor(Math.random() * 1e15)).padStart(50, '0');
    return {
      success: true,
      status: 'autorizado',
      codigoStatus: '100',
      motivoStatus: 'NFS-e autorizada com sucesso (MOCK)',
      chaveAcesso,
      protocolo: generateMockProtocol(),
      dataRecebimento: new Date().toISOString(),
      xml: `<nfse><chave>${chaveAcesso}</chave></nfse>`,
      nRec: null,
      erros: null,
    };
  }
  return sefazRequest('emitirNFSe', '/nfse/emitir', payload as unknown as Record<string, unknown>);
}

export async function cancelarNFSe(payload: {
  chaveAcesso: string;
  codigoCancelamento?: string;
  justificativa: string;
  codigoMunicipio: string;
  ambiente: SefazAmbiente;
  certificado: CertificadoPayload;
}): Promise<SefazResponse> {
  if (isMockMode()) {
    console.log('[SEFAZ] Mock mode — cancelarNFSe');
    return buildMockCancelResponse();
  }
  return sefazRequest('cancelarNFSe', '/nfse/cancelar', payload);
}
