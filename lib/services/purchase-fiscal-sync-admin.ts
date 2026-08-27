import { createHash, randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { adminStorage } from '@/lib/config/firebaseAdmin';
import type { Business } from '@/lib/types';
import { getCertificadoPayload } from '@/lib/fiscal/certificate-manager';
import { parsePurchaseNFeXml } from '@/lib/services/purchase-xml-parser';
import {
  findPurchaseNoteByAccessKeyAdmin,
  preparePurchaseNoteAdmin,
  PurchaseNoteDuplicateError,
  type PreparedPurchaseNote,
} from '@/lib/services/purchase-import-admin';
import {
  baixarDFe,
  distribuirDFe,
  getSefazDfeCapabilities,
  manifestarDFe,
  resolveAmbiente,
  type SefazDfeCapabilities,
  type SefazDfeDocument,
} from '@/lib/services/sefaz-gateway';
import type { SupplierActor } from '@/lib/services/supplier-admin';

const INBOX_COLLECTION = 'purchaseFiscalInbox';
const STATE_COLLECTION = 'purchaseFiscalSyncStates';
const LOCK_TTL_MS = 5 * 60 * 1000;

export type PurchaseFiscalInboxStatus = 'pending' | 'prepared' | 'error';
export type PurchaseFiscalXmlStatus = 'summary' | 'available';

export interface PurchaseFiscalInboxItem {
  id: string;
  businessId: string;
  accessKey: string;
  nsu: string;
  schema: string;
  status: PurchaseFiscalInboxStatus;
  xmlStatus: PurchaseFiscalXmlStatus;
  issuerDocument?: string;
  issuerName?: string;
  issueDate?: string;
  totalValue?: number;
  numero?: string;
  serie?: string;
  xmlStoragePath?: string;
  xmlSha256?: string;
  purchaseNoteId?: string;
  lastError?: string;
  receivedAt: string;
  updatedAt: string;
}

export interface PurchaseFiscalIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface PurchaseFiscalDiagnostics {
  cnpj: string | null;
  environment: 'producao' | 'homologacao' | null;
  cUFAutor: string | null;
  certificate: {
    configured: boolean;
    expiresAt?: string;
    daysUntilExpiry?: number;
    expired?: boolean;
  };
  capabilities: SefazDfeCapabilities;
  canSync: boolean;
  manualUploadAvailable: true;
  issues: PurchaseFiscalIssue[];
}

export interface PurchaseFiscalSyncState {
  businessId: string;
  status: 'idle' | 'syncing' | 'error';
  ultimoNsu: string;
  maxNsu?: string;
  hasMore?: boolean;
  lastSyncAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  lastErrorAt?: string;
  lastResult?: PurchaseFiscalSyncResult;
  updatedAt?: string;
}

export interface PurchaseFiscalSnapshot {
  diagnostics: PurchaseFiscalDiagnostics;
  state: PurchaseFiscalSyncState;
  inbox: PurchaseFiscalInboxItem[];
}

export interface PurchaseFiscalSyncResult {
  pages: number;
  discovered: number;
  duplicates: number;
  ignored: number;
  ultimoNsu: string;
  maxNsu: string;
  hasMore: boolean;
  completedAt: string;
}

export class PurchaseFiscalConfigurationError extends Error {
  constructor(public readonly issues: PurchaseFiscalIssue[]) {
    super(issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message).join(' '));
    this.name = 'PurchaseFiscalConfigurationError';
  }
}

export class PurchaseFiscalSyncBusyError extends Error {
  constructor() {
    super('Já existe uma sincronização fiscal em andamento para esta empresa.');
    this.name = 'PurchaseFiscalSyncBusyError';
  }
}

export class PurchaseFiscalInboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseFiscalInboxError';
  }
}

function digits(value?: string): string {
  return (value ?? '').replace(/\D/g, '');
}

function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutUndefined) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, withoutUndefined(entry)]),
    ) as T;
  }
  return value;
}

function padNsu(value: string): string {
  return digits(value).padStart(15, '0');
}

function xmlValue(xml: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return xml.match(new RegExp(`<(?:\\w+:)?${escaped}[^>]*>\\s*([^<]+?)\\s*<\\/(?:\\w+:)?${escaped}>`, 'i'))?.[1]?.trim() ?? '';
}

function invoiceIdentity(accessKey: string): { numero?: string; serie?: string } {
  if (!/^\d{44}$/.test(accessKey)) return {};
  return {
    serie: String(Number(accessKey.slice(22, 25))),
    numero: String(Number(accessKey.slice(25, 34))),
  };
}

export function purchaseFiscalInboxId(businessId: string, accessKey: string): string {
  return createHash('sha256').update(`${businessId}:purchase-fiscal-inbox:${accessKey}`).digest('hex');
}

function businessContext(business: Business) {
  const cnpj = digits(business.cnpj);
  const ibge = digits(business.fiscal?.ibgeCodigoMunicipio);
  const environment = business.fiscal?.nfeConfig?.environment;
  return {
    cnpj,
    cUFAutor: ibge.slice(0, 2),
    environment: environment === 'producao' || environment === 'homologacao' ? environment : null,
  };
}

export function buildPurchaseFiscalDiagnostics(
  business: Business,
  capabilities: SefazDfeCapabilities = getSefazDfeCapabilities(),
  now = new Date(),
): PurchaseFiscalDiagnostics {
  const context = businessContext(business);
  const certificate = business.fiscal?.certificate;
  const expiryMs = certificate?.expiresAt ? Date.parse(certificate.expiresAt) : Number.NaN;
  const daysUntilExpiry = Number.isFinite(expiryMs)
    ? Math.ceil((expiryMs - now.getTime()) / (24 * 60 * 60 * 1000))
    : undefined;
  const expired = daysUntilExpiry !== undefined ? daysUntilExpiry < 0 : undefined;
  const issues: PurchaseFiscalIssue[] = [];

  if (context.cnpj.length !== 14) issues.push({ code: 'CNPJ_REQUIRED', severity: 'error', message: 'Cadastre um CNPJ válido para consultar documentos destinados à empresa.' });
  if (!certificate?.storagePath) issues.push({ code: 'CERTIFICATE_REQUIRED', severity: 'error', message: 'Envie um certificado digital A1 em Configurações > Fiscal.' });
  else if (expired) issues.push({ code: 'CERTIFICATE_EXPIRED', severity: 'error', message: 'O certificado digital está vencido. Envie um certificado válido.' });
  else if (daysUntilExpiry !== undefined && daysUntilExpiry <= 30) issues.push({ code: 'CERTIFICATE_EXPIRING', severity: 'warning', message: `O certificado digital vence em ${Math.max(0, daysUntilExpiry)} dia(s).` });
  if (!context.cUFAutor) issues.push({ code: 'IBGE_REQUIRED', severity: 'error', message: 'Configure o código IBGE do município em Configurações > Fiscal.' });
  if (!context.environment) issues.push({ code: 'ENVIRONMENT_REQUIRED', severity: 'error', message: 'Defina o ambiente da NF-e em Configurações > Fiscal.' });
  else if (context.environment === 'homologacao') issues.push({ code: 'HOMOLOGATION', severity: 'warning', message: 'O ambiente está em homologação; notas reais de fornecedores não aparecerão.' });
  if (!capabilities.configured || !capabilities.distribution) issues.push({ code: 'PROVIDER_DISTRIBUTION_UNAVAILABLE', severity: 'error', message: 'O gateway fiscal ainda não está habilitado para distribuir NF-e recebidas. O upload manual continua disponível.' });
  if (!capabilities.manifestation || !capabilities.download) issues.push({ code: 'PROVIDER_HYDRATION_UNAVAILABLE', severity: 'warning', message: 'Manifestação/download não estão disponíveis neste provedor; solicite o XML ao fornecedor e use o upload manual.' });
  if (issues.length === 0) issues.push({ code: 'READY', severity: 'info', message: 'Configuração pronta para sincronizar documentos fiscais recebidos.' });

  return {
    cnpj: context.cnpj.length === 14 ? context.cnpj : null,
    environment: context.environment,
    cUFAutor: context.cUFAutor || null,
    certificate: {
      configured: Boolean(certificate?.storagePath),
      ...(certificate?.expiresAt ? { expiresAt: certificate.expiresAt } : {}),
      ...(daysUntilExpiry !== undefined ? { daysUntilExpiry, expired } : {}),
    },
    capabilities,
    canSync: !issues.some((issue) => issue.severity === 'error'),
    manualUploadAvailable: true,
    issues,
  };
}

function supportedDocument(document: SefazDfeDocument): 'summary' | 'full' | 'ignore' {
  const schema = document.schema.toLowerCase();
  if (schema.includes('resnfe')) return 'summary';
  if (schema.includes('procnfe') || schema.includes('nfeproc') || /<(?:\w+:)?infNFe\b/i.test(document.xml)) return 'full';
  return 'ignore';
}

function summaryDocument(params: {
  businessId: string;
  document: SefazDfeDocument;
  receivedAt: string;
}): PurchaseFiscalInboxItem {
  const accessKey = digits(params.document.accessKey || xmlValue(params.document.xml, 'chNFe'));
  const nsu = digits(params.document.nsu);
  if (accessKey.length !== 44 || !nsu) {
    throw new PurchaseFiscalInboxError('Documento fiscal sem chave de acesso ou NSU válido; o cursor foi preservado para nova tentativa.');
  }
  const identity = invoiceIdentity(accessKey);
  const rawTotal = Number(xmlValue(params.document.xml, 'vNF').replace(',', '.'));
  return {
    id: purchaseFiscalInboxId(params.businessId, accessKey),
    businessId: params.businessId,
    accessKey,
    nsu,
    schema: params.document.schema || 'resNFe',
    status: 'pending',
    xmlStatus: 'summary',
    issuerDocument: digits(xmlValue(params.document.xml, 'CNPJ') || xmlValue(params.document.xml, 'CPF')) || undefined,
    issuerName: xmlValue(params.document.xml, 'xNome') || undefined,
    issueDate: xmlValue(params.document.xml, 'dhEmi') || undefined,
    totalValue: Number.isFinite(rawTotal) ? rawTotal : undefined,
    ...identity,
    receivedAt: params.receivedAt,
    updatedAt: params.receivedAt,
  };
}

async function saveFullXml(params: {
  businessId: string;
  inboxId: string;
  accessKey: string;
  xml: string;
}): Promise<string> {
  const path = `businesses/${params.businessId}/purchase-fiscal-inbox/${params.inboxId}/source.xml`;
  await adminStorage.bucket().file(path).save(Buffer.from(params.xml, 'utf8'), {
    contentType: 'application/xml; charset=utf-8',
    resumable: false,
    metadata: {
      cacheControl: 'private, no-store',
      metadata: { businessId: params.businessId, accessKey: params.accessKey },
    },
  });
  return path;
}

async function fullDocument(params: {
  business: Business;
  document: SefazDfeDocument;
  receivedAt: string;
}): Promise<PurchaseFiscalInboxItem> {
  const parsed = parsePurchaseNFeXml({
    xml: params.document.xml,
    expectedRecipientDocument: params.business.cnpj,
  });
  const accessKey = digits(params.document.accessKey || parsed.accessKey);
  const nsu = digits(params.document.nsu);
  if (accessKey !== parsed.accessKey || !nsu) {
    throw new PurchaseFiscalInboxError('Documento fiscal com chave divergente ou NSU inválido; o cursor foi preservado.');
  }
  const id = purchaseFiscalInboxId(params.business.id, accessKey);
  const xmlStoragePath = await saveFullXml({ businessId: params.business.id, inboxId: id, accessKey, xml: params.document.xml });
  return {
    id,
    businessId: params.business.id,
    accessKey,
    nsu,
    schema: params.document.schema || 'procNFe',
    status: 'pending',
    xmlStatus: 'available',
    issuerDocument: parsed.supplier.document,
    issuerName: parsed.supplier.name,
    issueDate: parsed.issueDate,
    totalValue: parsed.totals.invoice,
    numero: parsed.numero,
    serie: parsed.serie,
    xmlStoragePath,
    xmlSha256: parsed.xmlSha256,
    receivedAt: params.receivedAt,
    updatedAt: params.receivedAt,
  };
}

async function loadBusiness(db: Firestore, businessId: string): Promise<Business> {
  const snapshot = await db.collection('businesses').doc(businessId).get();
  if (!snapshot.exists) throw new PurchaseFiscalInboxError('Empresa não encontrada.');
  return { ...snapshot.data(), id: snapshot.id } as Business;
}

function defaultState(businessId: string): PurchaseFiscalSyncState {
  return { businessId, status: 'idle', ultimoNsu: '000000000000000' };
}

export async function getPurchaseFiscalSnapshotAdmin(params: {
  db: Firestore;
  businessId: string;
  limit?: number;
}): Promise<PurchaseFiscalSnapshot> {
  const business = await loadBusiness(params.db, params.businessId);
  const [stateSnapshot, inboxSnapshot] = await Promise.all([
    params.db.collection(STATE_COLLECTION).doc(params.businessId).get(),
    params.db.collection(INBOX_COLLECTION).where('businessId', '==', params.businessId).limit(params.limit ?? 100).get(),
  ]);
  const state = stateSnapshot.exists
    ? { ...defaultState(params.businessId), ...stateSnapshot.data() } as PurchaseFiscalSyncState
    : defaultState(params.businessId);
  const inbox = inboxSnapshot.docs
    .map((entry) => ({ ...entry.data(), id: entry.id } as PurchaseFiscalInboxItem))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const diagnostics = buildPurchaseFiscalDiagnostics(business);
  if (state.lastError) diagnostics.issues.unshift({ code: 'LAST_SYNC_ERROR', severity: 'error', message: `Última sincronização: ${state.lastError}` });
  if (state.lastSuccessAt) {
    const ageDays = Math.floor((Date.now() - Date.parse(state.lastSuccessAt)) / (24 * 60 * 60 * 1000));
    if (ageDays > 7) diagnostics.issues.push({ code: 'STALE_SYNC', severity: 'warning', message: `A última sincronização bem-sucedida foi há ${ageDays} dia(s).` });
  }
  return { diagnostics, state, inbox };
}

async function acquireLock(db: Firestore, businessId: string): Promise<string> {
  const token = randomUUID();
  const ref = db.collection(STATE_COLLECTION).doc(businessId);
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const current = snapshot.data() as Partial<PurchaseFiscalSyncState> | undefined;
    const lockAt = current?.updatedAt ? Date.parse(current.updatedAt) : Number.NaN;
    if (current?.status === 'syncing' && Number.isFinite(lockAt) && Date.now() - lockAt < LOCK_TTL_MS) {
      throw new PurchaseFiscalSyncBusyError();
    }
    tx.set(ref, {
      ...defaultState(businessId),
      ...current,
      businessId,
      status: 'syncing',
      lockToken: token,
      lastSyncAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });
  return token;
}

export async function syncPurchaseFiscalInboxAdmin(params: {
  db: Firestore;
  businessId: string;
  maxPages?: number;
}): Promise<PurchaseFiscalSyncResult> {
  const business = await loadBusiness(params.db, params.businessId);
  const diagnostics = buildPurchaseFiscalDiagnostics(business);
  if (!diagnostics.canSync) throw new PurchaseFiscalConfigurationError(diagnostics.issues);
  const context = businessContext(business);
  const lockToken = await acquireLock(params.db, params.businessId);
  const stateRef = params.db.collection(STATE_COLLECTION).doc(params.businessId);
  let ultimoNsu = '000000000000000';
  let maxNsu = ultimoNsu;
  let hasMore = false;
  let pages = 0;
  let discovered = 0;
  let duplicates = 0;
  let ignored = 0;

  try {
    const stateSnapshot = await stateRef.get();
    ultimoNsu = padNsu(String(stateSnapshot.data()?.ultimoNsu ?? ultimoNsu));
    const certificado = await getCertificadoPayload(params.businessId);
    const pageLimit = Math.min(10, Math.max(1, params.maxPages ?? 3));

    do {
      const page = await distribuirDFe({
        cnpj: context.cnpj,
        ultimoNsu,
        cUFAutor: context.cUFAutor,
        ambiente: resolveAmbiente(context.environment ?? undefined),
        certificado,
      });
      if (page.documents.length > 450) {
        throw new PurchaseFiscalInboxError('O provedor retornou documentos demais em uma página; o cursor foi preservado para evitar uma gravação parcial.');
      }
      const receivedAt = new Date().toISOString();
      const batch = params.db.batch();

      for (const document of page.documents) {
        const kind = supportedDocument(document);
        if (kind === 'ignore') { ignored += 1; continue; }
        const item = kind === 'full'
          ? await fullDocument({ business, document, receivedAt })
          : summaryDocument({ businessId: params.businessId, document, receivedAt });
        const inboxRef = params.db.collection(INBOX_COLLECTION).doc(item.id);
        const [existingNoteId, existingInboxSnapshot] = await Promise.all([
          findPurchaseNoteByAccessKeyAdmin(params.db, params.businessId, item.accessKey),
          inboxRef.get(),
        ]);
        const existingInbox = existingInboxSnapshot.data() as Partial<PurchaseFiscalInboxItem> | undefined;
        if (existingInbox?.receivedAt) item.receivedAt = existingInbox.receivedAt;
        if (existingInbox?.xmlStatus === 'available' && item.xmlStatus === 'summary') {
          item.xmlStatus = 'available';
          item.schema = existingInbox.schema ?? item.schema;
          item.xmlStoragePath = existingInbox.xmlStoragePath;
          item.xmlSha256 = existingInbox.xmlSha256;
          item.numero = existingInbox.numero ?? item.numero;
          item.serie = existingInbox.serie ?? item.serie;
        }
        if (existingNoteId) {
          item.status = 'prepared';
          item.purchaseNoteId = existingNoteId;
          duplicates += 1;
        } else if (existingInboxSnapshot.exists) {
          item.status = existingInbox?.status === 'error' && item.xmlStatus === 'summary' ? 'error' : 'pending';
          item.lastError = item.status === 'error' ? existingInbox?.lastError : undefined;
          duplicates += 1;
        } else {
          discovered += 1;
        }
        batch.set(inboxRef, { ...withoutUndefined(item), lastError: item.lastError ?? null }, { merge: true });
      }

      const previousNsu = BigInt(ultimoNsu);
      const nextNsu = BigInt(padNsu(page.ultimoNsu));
      const nextMaxNsu = BigInt(padNsu(page.maxNsu));
      if (nextNsu < previousNsu || nextMaxNsu < nextNsu) {
        throw new PurchaseFiscalInboxError('O provedor retornou uma sequência NSU regressiva; o cursor anterior foi preservado.');
      }
      if (page.hasMore && nextNsu === previousNsu) {
        throw new PurchaseFiscalInboxError('O provedor informou mais páginas sem avançar o NSU; o cursor anterior foi preservado.');
      }
      ultimoNsu = padNsu(page.ultimoNsu);
      maxNsu = padNsu(page.maxNsu);
      hasMore = page.hasMore;
      pages += 1;
      batch.set(stateRef, {
        businessId: params.businessId,
        status: 'syncing',
        lockToken,
        ultimoNsu,
        maxNsu,
        hasMore,
        updatedAt: receivedAt,
      }, { merge: true });
      await batch.commit();
    } while (hasMore && pages < pageLimit);

    const completedAt = new Date().toISOString();
    const result: PurchaseFiscalSyncResult = { pages, discovered, duplicates, ignored, ultimoNsu, maxNsu, hasMore, completedAt };
    await stateRef.set({
      businessId: params.businessId,
      status: 'idle',
      lockToken: null,
      ultimoNsu,
      maxNsu,
      hasMore,
      lastSuccessAt: completedAt,
      lastError: null,
      lastErrorAt: null,
      lastResult: result,
      updatedAt: completedAt,
    }, { merge: true });
    return result;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const failedAt = new Date().toISOString();
    await stateRef.set({
      businessId: params.businessId,
      status: 'error',
      lockToken: null,
      lastError: message.slice(0, 2000),
      lastErrorAt: failedAt,
      updatedAt: failedAt,
    }, { merge: true }).catch(() => undefined);
    throw cause;
  }
}

async function inboxItem(db: Firestore, businessId: string, inboxId: string): Promise<PurchaseFiscalInboxItem> {
  const snapshot = await db.collection(INBOX_COLLECTION).doc(inboxId).get();
  if (!snapshot.exists || snapshot.data()?.businessId !== businessId) throw new PurchaseFiscalInboxError('Documento fiscal não encontrado.');
  return { ...snapshot.data(), id: snapshot.id } as PurchaseFiscalInboxItem;
}

export async function hydratePurchaseFiscalInboxAdmin(params: {
  db: Firestore;
  businessId: string;
  inboxId: string;
}): Promise<PurchaseFiscalInboxItem> {
  const [business, item] = await Promise.all([
    loadBusiness(params.db, params.businessId),
    inboxItem(params.db, params.businessId, params.inboxId),
  ]);
  if (item.xmlStatus === 'available') return item;
  const diagnostics = buildPurchaseFiscalDiagnostics(business);
  if (!diagnostics.capabilities.manifestation || !diagnostics.capabilities.download) {
    throw new PurchaseFiscalConfigurationError(diagnostics.issues);
  }
  const context = businessContext(business);
  const certificado = await getCertificadoPayload(params.businessId);
  const ref = params.db.collection(INBOX_COLLECTION).doc(params.inboxId);

  try {
    const manifestation = await manifestarDFe({
      cnpj: context.cnpj,
      chaveAcesso: item.accessKey,
      tipoEvento: 'ciencia_operacao',
      ambiente: resolveAmbiente(context.environment ?? undefined),
      certificado,
    });
    if (!manifestation.success) throw new PurchaseFiscalInboxError(manifestation.motivoStatus || 'A manifestação não foi aceita.');
    const downloaded = await baixarDFe({
      cnpj: context.cnpj,
      chaveAcesso: item.accessKey,
      cUFAutor: context.cUFAutor,
      ambiente: resolveAmbiente(context.environment ?? undefined),
      certificado,
    });
    const parsed = parsePurchaseNFeXml({ xml: downloaded.xml, expectedRecipientDocument: business.cnpj });
    if (parsed.accessKey !== item.accessKey) throw new PurchaseFiscalInboxError('O XML baixado não corresponde ao resumo selecionado.');
    const xmlStoragePath = await saveFullXml({ businessId: params.businessId, inboxId: item.id, accessKey: item.accessKey, xml: downloaded.xml });
    const updated: PurchaseFiscalInboxItem = {
      ...item,
      status: 'pending',
      xmlStatus: 'available',
      schema: 'procNFe',
      issuerDocument: parsed.supplier.document,
      issuerName: parsed.supplier.name,
      issueDate: parsed.issueDate,
      totalValue: parsed.totals.invoice,
      numero: parsed.numero,
      serie: parsed.serie,
      xmlStoragePath,
      xmlSha256: parsed.xmlSha256,
      lastError: undefined,
      updatedAt: new Date().toISOString(),
    };
    await ref.set(withoutUndefined(updated), { merge: true });
    return updated;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await ref.set({ status: 'error', lastError: message.slice(0, 2000), updatedAt: new Date().toISOString() }, { merge: true }).catch(() => undefined);
    throw cause;
  }
}

export async function preparePurchaseFromFiscalInboxAdmin(params: {
  db: Firestore;
  businessId: string;
  inboxId: string;
  actor: SupplierActor;
}): Promise<PreparedPurchaseNote> {
  const [business, item] = await Promise.all([
    loadBusiness(params.db, params.businessId),
    inboxItem(params.db, params.businessId, params.inboxId),
  ]);
  if (item.xmlStatus !== 'available' || !item.xmlStoragePath) {
    throw new PurchaseFiscalInboxError('Baixe o XML completo antes de preparar a compra.');
  }
  const expectedPrefix = `businesses/${params.businessId}/purchase-fiscal-inbox/${item.id}/`;
  if (!item.xmlStoragePath.startsWith(expectedPrefix)) throw new PurchaseFiscalInboxError('Caminho do XML fiscal inválido.');

  const existingNoteId = await findPurchaseNoteByAccessKeyAdmin(params.db, params.businessId, item.accessKey);
  if (existingNoteId) {
    await params.db.collection(INBOX_COLLECTION).doc(item.id).set({ status: 'prepared', purchaseNoteId: existingNoteId, lastError: null, updatedAt: new Date().toISOString() }, { merge: true });
    const snapshot = await params.db.collection('purchaseNotes').doc(existingNoteId).get();
    return { ...snapshot.data(), id: snapshot.id } as PreparedPurchaseNote;
  }

  const [contents] = await adminStorage.bucket().file(item.xmlStoragePath).download();
  const xml = contents.toString('utf8');
  const parsed = parsePurchaseNFeXml({ xml, expectedRecipientDocument: business.cnpj });
  if (parsed.accessKey !== item.accessKey) throw new PurchaseFiscalInboxError('O XML armazenado não corresponde ao documento fiscal selecionado.');
  const noteId = params.db.collection('purchaseNotes').doc().id;
  const targetPath = `businesses/${params.businessId}/purchase-notes/${noteId}/original.xml`;
  const target = adminStorage.bucket().file(targetPath);

  try {
    await target.save(contents, {
      contentType: 'application/xml; charset=utf-8',
      resumable: false,
      metadata: {
        cacheControl: 'private, no-store',
        metadata: { businessId: params.businessId, purchaseNoteId: noteId, sha256: parsed.xmlSha256, source: 'sefaz_sync' },
      },
    });
    const note = await preparePurchaseNoteAdmin({
      db: params.db,
      businessId: params.businessId,
      noteId,
      parsed,
      xmlStoragePath: targetPath,
      originalFileName: `${item.accessKey}.xml`,
      actor: params.actor,
      source: 'sefaz_sync',
    });
    await params.db.collection(INBOX_COLLECTION).doc(item.id).set({
      status: 'prepared',
      purchaseNoteId: note.id,
      lastError: null,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return note;
  } catch (cause) {
    await target.delete({ ignoreNotFound: true }).catch(() => undefined);
    if (cause instanceof PurchaseNoteDuplicateError && cause.existingNoteId) {
      await params.db.collection(INBOX_COLLECTION).doc(item.id).set({ status: 'prepared', purchaseNoteId: cause.existingNoteId, lastError: null, updatedAt: new Date().toISOString() }, { merge: true });
      const snapshot = await params.db.collection('purchaseNotes').doc(cause.existingNoteId).get();
      return { ...snapshot.data(), id: snapshot.id } as PreparedPurchaseNote;
    }
    throw cause;
  }
}
