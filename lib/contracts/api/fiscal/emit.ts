/**
 * lib/contracts/api/fiscal/emit.ts — POST /api/fiscal/emit
 *
 * Validação Zod do payload de emissão fiscal (NF-e, NFC-e, NFSe). Cobre o
 * shape do body que `app/api/fiscal/emit/route.ts` consome. O handler chama
 * `EmitFiscalRequestSchema.safeParse(body)` antes de tocar Firestore.
 *
 * Convenções:
 * - `.passthrough()` em todos os objetos → campos extras passam ao handler
 *   sem rejeição. Hoje o handler ignora extras; manter passthrough garante
 *   compatibilidade retroativa com integrações já no ar (sefaz-api, app web,
 *   API v1 — se cliente externo manda campo extra, não quebramos).
 * - Discriminated union por `type` ('nfe' | 'nfce' | 'nfse') → cada tipo
 *   tem campos próprios. Erro de digitação em `type` é capturado.
 * - Tudo opcional quando o handler aplica fallback (Product, default do
 *   regime, ou valor canônico de business.fiscal). Validações cross-field
 *   que dependem de read do Firestore (Product.name p/ descrição vazia,
 *   business.fiscal p/ inscrições) ficam no handler — schema valida
 *   apenas shape sintático.
 * - `item.description` é opcional aqui porque o server tem fallback pra
 *   Product.name. Validação "ambos vazios" → 400 vive no handler.
 *
 * Quem consome:
 * - `app/api/fiscal/emit/route.ts` (handler — server-side validation)
 * - `app/components/features/fiscal/EmitirNotaDialog.tsx` (cliente — type
 *   `EmitFiscalRequest` derivado por z.infer pra autocomplete no form)
 */

import { z } from 'zod';

// ─── Sub-schemas comuns ──────────────────────────────────────────────────────

/**
 * Item de NF-e/NFC-e. Quase tudo opcional porque:
 *   - Campos comerciais (ncm, cfop, barcode, unit, cest) caem em Product.X
 *     via enrichment server-side, ou em default do regime.
 *   - Campos fiscais (icms*, pis*, cofins*, ipi*) idem.
 *   - description cai em Product.name (validação cruzada no handler).
 *
 * Validações estruturais que DEVEM passar pra emissão valer:
 *   - quantity > 0
 *   - unitPrice >= 0
 *
 * NCM/CFOP/CST validação de formato (8 dígitos, 4 dígitos, 2 chars) NÃO é
 * feita aqui — strings com qualquer formato passam; o handler aplica
 * `.replace(/\D/g, '')` e fallback. Razão: tolerância a UI antiga, payloads
 * importados de planilha, e integrações externas. SEFAZ rejeita formato
 * inválido com mensagem específica que repassamos ao operador.
 */
export const EmitItemSchema = z
  .object({
    // Linkagem com cadastro (Inventory). Triggera enrichment server-side.
    productId: z.string().optional(),
    serviceId: z.string().optional(),

    // Comercial
    description: z.string().max(500).optional(),
    code: z.union([z.string(), z.number()]).optional(),
    barcode: z.string().optional(),
    quantity: z.coerce.number().positive('quantity deve ser > 0'),
    unitPrice: z.coerce.number().nonnegative('unitPrice deve ser >= 0'),
    discount: z.coerce.number().nonnegative().optional(),
    unit: z.string().optional(),
    ncm: z.string().optional(),
    cfop: z.union([z.string(), z.number()]).optional(),
    cest: z.string().optional(),

    // ICMS — origem aceita string '0'..'8' ou number 0..8. CST/CSOSN
    // são strings curtas; aliquota é número.
    icmsOrigem: z.union([z.string(), z.number()]).optional(),
    icmsSituacaoTributaria: z.string().max(4).optional(),
    icmsAliquota: z.coerce.number().nonnegative().max(100).optional(),

    // PIS
    pisSituacaoTributaria: z.string().max(4).optional(),
    pisAliquota: z.coerce.number().nonnegative().max(100).optional(),

    // COFINS
    cofinsSituacaoTributaria: z.string().max(4).optional(),
    cofinsAliquota: z.coerce.number().nonnegative().max(100).optional(),

    // IPI (opcional — só emite bloco quando há CST)
    ipiSituacaoTributaria: z.string().max(4).optional(),
    ipiCodigoEnquadramento: z.string().max(8).optional(),
    ipiAliquota: z.coerce.number().nonnegative().max(100).optional(),
  })
  .passthrough();

/**
 * Endereço de destinatário/tomador. Usado em NF-e (recipient.address) e
 * NFC-e quando consumidor identificado. Campos quase todos opcionais —
 * SEFAZ exige diferentes combinações por UF/tipo.
 */
const AddressSchema = z
  .object({
    logradouro: z.string().optional(),
    numero: z.string().optional(),
    complemento: z.string().optional(),
    bairro: z.string().optional(),
    municipio: z.string().optional(),
    codigoMunicipio: z.string().optional(),
    uf: z.string().length(2).optional(),
    cep: z.string().optional(),
    pais: z.string().optional(),
    codigoPais: z.string().optional(),
  })
  .passthrough();

/**
 * Destinatário de NF-e. Documento pode ser CPF (11) ou CNPJ (14) — handler
 * decide via `.replace(/\D/g, '').length`. Inscrição estadual triggera
 * indicadorIE='1' (contribuinte) por auto-resolução.
 */
const RecipientSchema = z
  .object({
    name: z.string().min(1).optional(),
    document: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    inscricaoEstadual: z.string().optional(),
    indicadorIE: z.union([z.literal('1'), z.literal('2'), z.literal('9')]).optional(),
    address: AddressSchema.optional(),
    codigoMunicipio: z.string().optional(),
  })
  .passthrough();

/** Pagamento individual — array preferido (data.payments[]). Legacy single
 * (paymentMethod + paymentValue) é aceito no payload root. */
const PaymentSchema = z
  .object({
    method: z.string().optional(),
    amount: z.coerce.number().nonnegative().optional(),
  })
  .passthrough();

/**
 * Certificado enviado no body (fallback quando o tenant não tem cert
 * cadastrado em `businesses/{id}/fiscalCerts`). Em produção o caminho
 * normal é não enviar e o handler busca via `getCertificadoPayload()`.
 */
const CertificadoInputSchema = z
  .object({
    pfxBase64: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
  })
  .passthrough();

/** Tomador da NFSe (PF ou PJ). */
const TomadorSchema = z
  .object({
    nome: z.string().optional(),
    cpf: z.string().optional(),
    cnpj: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    telefone: z.string().optional(),
    endereco: AddressSchema.optional(),
  })
  .passthrough();

// ─── Per-type request schemas ────────────────────────────────────────────────

const SharedFields = {
  businessId: z.string().min(1, 'businessId obrigatório'),
  certificado: CertificadoInputSchema.optional(),
  informacoesAdicionais: z.string().max(5000).optional(),
};

/** NF-e — mercadoria, B2B. */
export const NfeRequestSchema = z
  .object({
    type: z.literal('nfe'),
    ...SharedFields,
    items: z.array(EmitItemSchema).min(1, 'NF-e exige pelo menos 1 item'),
    recipient: RecipientSchema.optional(),
    payments: z.array(PaymentSchema).optional(),
    paymentMethod: z.string().optional(),
    paymentValue: z.coerce.number().optional(),
    naturezaOperacao: z.string().optional(),
    finalidadeEmissao: z.union([z.string(), z.number()]).optional(),
    consumidorFinal: z.union([z.string(), z.number()]).optional(),
    presencaComprador: z.union([z.string(), z.number()]).optional(),
    modalidadeFrete: z.union([z.string(), z.number()]).optional(),
    /**
     * Chave de acesso (44 dígitos) da NF-e referenciada. Obrigatório quando
     * finalidadeEmissao='4' (devolução). Aceita máscara — `replace(/\D/g, '')`
     * normaliza no handler antes de validar comprimento. Validação cross-field
     * "finalidade=4 ⇒ refNFe presente" fica no route (precisa do contexto).
     */
    refNFe: z.string().optional(),
  })
  .passthrough();

/** NFC-e — varejo consumidor final, exige CSC. */
export const NfceRequestSchema = z
  .object({
    type: z.literal('nfce'),
    ...SharedFields,
    items: z.array(EmitItemSchema).min(1, 'NFC-e exige pelo menos 1 item'),
    cpfConsumidor: z.string().optional(),
    nomeConsumidor: z.string().optional(),
    payments: z.array(PaymentSchema).optional(),
    paymentMethod: z.string().optional(),
    paymentValue: z.coerce.number().optional(),
    naturezaOperacao: z.string().optional(),
    presencaComprador: z.union([z.string(), z.number()]).optional(),
    /**
     * Modo contingência off-line NFC-e (tpEmis=9). Quando true, o sefaz-api
     * gera XML assinado + chave SEM enviar pra SEFAZ. O documento fica
     * salvo com status='contingencia' até ser transmitido via /api/fiscal/retry.
     * Requer motivoContingencia (15-256 caracteres) com a justificativa.
     */
    forcarContingencia: z.boolean().optional(),
    motivoContingencia: z.string().min(15).max(256).optional(),
  })
  .passthrough();

/** NFSe — serviço, sem items[] (servico singular). */
export const NfseRequestSchema = z
  .object({
    type: z.literal('nfse'),
    ...SharedFields,
    valorServicos: z.coerce.number().nonnegative('valorServicos deve ser >= 0'),
    aliquotaIss: z.coerce.number().nonnegative().max(100).optional(),
    codigoServico: z.string().optional(),
    codigoServicoMunicipal: z.string().optional(),
    discriminacao: z.string().optional(),
    descricaoServico: z.string().optional(),
    nbs: z.string().optional(),
    tomador: TomadorSchema.optional(),
    issRetido: z.boolean().optional(),
    valorDeducoes: z.coerce.number().nonnegative().optional(),
    valorDesconto: z.coerce.number().nonnegative().optional(),
    /**
     * Código IBGE (7 dígitos) do município onde o serviço foi efetivamente
     * prestado. Default: município do prestador (emitente). Diferente quando
     * a empresa atende in-loco em outra cidade — o ISS deve ser recolhido no
     * município da prestação. Aceita máscara — handler normaliza com replace(/\D/g, '').
     */
    codigoMunicipioPrestacao: z.string().optional(),
    /**
     * Código CNAE (Classificação Nacional de Atividades Econômicas) — 7 dígitos.
     * Exigido por algumas prefeituras (BH obrigatório; SP/Paulistana opcional;
     * Padrão Nacional aceita). Aceita máscara (ex: '6201-5/01') — handler
     * normaliza com replace(/\D/g, ''). sefaz-api propaga pros 3 providers.
     */
    cnae: z.string().optional(),
  })
  .passthrough();

/**
 * Schema raiz — discriminated union por `type`. Use `.safeParse(body)` no
 * boundary e retorne 400 com `parsed.error.flatten()` se inválido.
 */
export const EmitFiscalRequestSchema = z.discriminatedUnion('type', [
  NfeRequestSchema,
  NfceRequestSchema,
  NfseRequestSchema,
]);

export type EmitItem = z.infer<typeof EmitItemSchema>;
export type EmitFiscalRequest = z.infer<typeof EmitFiscalRequestSchema>;
export type NfeRequest = z.infer<typeof NfeRequestSchema>;
export type NfceRequest = z.infer<typeof NfceRequestSchema>;
export type NfseRequest = z.infer<typeof NfseRequestSchema>;
