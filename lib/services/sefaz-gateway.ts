// lib/services/sefaz-gateway.ts
// SEFAZ API Gateway — connects to external fiscal emission service
// Server-side only (uses process.env secrets)

const SEFAZ_API_URL = process.env.SEFAZ_API_URL || 'https://emissao.tensorroot.com';
const SEFAZ_API_KEY = process.env.SEFAZ_API_KEY || '';

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

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SEFAZ_API_KEY}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

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
  return sefazRequest('emitirNFe', '/nfe/emitir', payload);
}

export async function emitirNFCe(
  payload: Record<string, unknown> & { certificado: CertificadoPayload; ambiente: SefazAmbiente },
): Promise<SefazResponse> {
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
