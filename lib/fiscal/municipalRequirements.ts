/**
 * lib/fiscal/municipalRequirements.ts
 *
 * Validações específicas de NFS-e por município. Cada prefeitura tem regras
 * próprias (campos obrigatórios, formatos) que vão além do schema Zod
 * genérico. Concentrar essas regras aqui evita espalhar `if (codigoIBGE === X)`
 * pelo route e prepara o terreno pra adicionar BH/RJ/POA/etc. sem mexer no
 * fluxo principal de emit.
 *
 * Padrão de uso (no route):
 *
 *   const validation = validateMunicipalRequirements(codigoMunicipioEmitente, data);
 *   if (!validation.valid) {
 *     return NextResponse.json({
 *       error: validation.message,
 *       missingFields: validation.missingFields,
 *     }, { status: 400 });
 *   }
 *
 * Adicionando um novo município:
 *   1. Define a função `validate<Cidade>` que recebe `data` e retorna
 *      `MunicipalValidationResult` (valid + lista de missing + mensagem).
 *   2. Registra no `MUNICIPAL_VALIDATORS` map abaixo.
 *   3. Adiciona linha em `lib/fiscal/nfse-coverage.ts` se for cidade nova.
 */

export interface MunicipalValidationResult {
  valid: boolean;
  /** Mensagem completa pronta pra retornar no `error` da response 400. */
  message?: string;
  /** Lista de campos faltantes — UI pode usar pra destacar inputs. */
  missingFields?: string[];
}

type MunicipalValidator = (data: Record<string, any>) => MunicipalValidationResult;

// ─── Validators por município ───────────────────────────────────────────────

/**
 * São Paulo (IBGE 3550308) — Prefeitura Paulistana rejeita NFS-e sem
 * endereço completo do tomador. `numero` pode ser 'SN' (sem número) e
 * `municipio` textual é opcional pois `codigoMunicipio` é o que entra no XML.
 */
const validateSaoPaulo: MunicipalValidator = (data) => {
  if (!data.tomador) return { valid: true };

  const end = (data.tomador.endereco || {}) as Record<string, string>;
  const missing: string[] = [];
  if (!end.logradouro?.trim()) missing.push('logradouro');
  if (!end.bairro?.trim()) missing.push('bairro');
  if (!end.codigoMunicipio?.replace(/\D/g, '')) missing.push('código IBGE da cidade');
  if (!end.uf?.trim()) missing.push('UF');
  if (!end.cep?.replace(/\D/g, '') || end.cep.replace(/\D/g, '').length !== 8) {
    missing.push('CEP');
  }

  if (missing.length === 0) return { valid: true };
  return {
    valid: false,
    missingFields: missing,
    message: `Em São Paulo, NFS-e exige endereço completo do tomador. Campos faltando: ${missing.join(', ')}.`,
  };
};

// ─── Registry ───────────────────────────────────────────────────────────────

/**
 * Map de IBGE → validador. Cidades não listadas passam direto (sem regras
 * específicas além do schema Zod global). Quando uma cidade for adicionada
 * (ex: BH com CNAE obrigatório), registra aqui.
 */
const MUNICIPAL_VALIDATORS: Record<string, MunicipalValidator> = {
  '3550308': validateSaoPaulo,
  // '3106200': validateBeloHorizonte,  // futuro — CNAE obrigatório
  // '3304557': validateRio,            // futuro — procuração eletrônica + endereço
};

// ─── API pública ────────────────────────────────────────────────────────────

/**
 * Aplica a validação específica do município ao payload de NFS-e. Retorna
 * sempre `valid: true` quando o município não tem regras registradas
 * (validação genérica do schema Zod já cobre o resto).
 */
export function validateMunicipalRequirements(
  codigoMunicipioEmitente: string,
  data: Record<string, any>,
): MunicipalValidationResult {
  const codigo = String(codigoMunicipioEmitente || '').replace(/\D/g, '').slice(0, 7);
  const validator = MUNICIPAL_VALIDATORS[codigo];
  if (!validator) return { valid: true };
  return validator(data);
}

/**
 * Lista os códigos IBGE com regras específicas (debug/admin).
 */
export function listMunicipiosWithRequirements(): string[] {
  return Object.keys(MUNICIPAL_VALIDATORS);
}
