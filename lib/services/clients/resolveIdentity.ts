/**
 * lib/services/clients/resolveIdentity.ts
 *
 * Resolução determinística da identidade de um cliente a partir de telefone +
 * nome. É o ponto ÚNICO que o cardápio (orders/public, admin SDK) e os fluxos
 * de balcão (OrdersModule/PDV, client SDK) deveriam usar para "achar ou criar"
 * o Client antes de gravar um pedido/venda — fechando o gap de duplicatas que
 * surgia quando cada fluxo reimplementava match por telefone do seu jeito.
 *
 * Divisor SDK (espelha o resto do código):
 *   - resolveClientIdentityAdmin → admin SDK (firebase-admin/firestore), usado
 *     por rotas server-side (orders/public, agent tools).
 *   - resolveClientIdentityClient → client SDK (firebase/firestore), usado no
 *     browser do operador (OrdersModule/PDV).
 * As REGRAS de identidade (canonicalização BR, candidatos de match, shape do
 * Client novo) são funções PURAS compartilhadas — só a EXECUÇÃO (query/read/
 * write) difere por SDK.
 *
 * Invariantes:
 *   R1 — todo Client criado leva `businessId`; toda query filtra por ele.
 *   - Match por phone + whatsapp + channelIdentities.whatsapp, usando os
 *     candidatos BR (com/sem 55, com/sem 9, últimos 8 dígitos).
 *   - Soft-deleted (`deletedAt`) NÃO casa — é como se não existisse.
 *   - `mergedInto` é seguido até o cliente primário (cadeia de merges).
 */

import type { Firestore as AdminFirestore } from 'firebase-admin/firestore';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  addDoc,
  type Firestore as ClientFirestore,
} from 'firebase/firestore';
import { db as clientDb } from '@/lib/config/firebase';
import {
  digitsOnly,
  canonicalizeBr,
  brPhoneCandidates,
} from '@/lib/contracts/_runtime/phone-br';
import type { Client } from '@/lib/types';

/** Máximo de saltos ao seguir `mergedInto` — guarda contra ciclos de merge. */
const MAX_MERGE_DEPTH = 8;

export interface ResolveIdentityResult {
  /** ID do cliente PRIMÁRIO (já seguindo a cadeia de mergedInto). null SÓ quando
   *  createIfMissing:false e nenhum candidato casou (modo find-only). */
  clientId: string | null;
  /** true se um novo Client foi criado nesta chamada. */
  created: boolean;
}

interface ResolveIdentityArgs {
  businessId: string;
  phone: string;
  name?: string;
  /** Default true (acha-ou-cria). false = find-only: não cria, retorna
   *  clientId=null se não casar (ex.: PDV com cliente já selecionado, pra não
   *  gerar duplicata órfã quando o telefone legado não bate nos candidatos). */
  createIfMissing?: boolean;
}

// ── Puros (compartilhados entre SDKs) ───────────────────────────────────────

/**
 * Candidatos de telefone para o match `in`. Combina os candidatos BR canônicos
 * (com prefixo 55, variação com/sem 9, últimos 8 dígitos) com as formas SEM o
 * 55 e os dígitos crus — porque dados legados foram gravados de formas
 * inconsistentes (orders/public grava `digitsOnly`, sem canonicalizar).
 * Mantém ≤ 30 valores (limite do operador `in` do Firestore).
 */
export function buildPhoneMatchCandidates(phone: string): string[] {
  const out = new Set<string>();
  const raw = digitsOnly(phone);
  if (raw) out.add(raw);
  for (const c of brPhoneCandidates(phone)) {
    out.add(c);
    if (c.startsWith('55') && c.length >= 12) out.add(c.slice(2));
  }
  return Array.from(out).slice(0, 30);
}

/**
 * Shape de um Client recém-criado. Telefone é canonicalizado (forma BR com 55).
 * Mantém paridade com os defaults usados em orders/public e conversationToPipeline.
 * NÃO conta visita aqui — a contagem de visita/compra é responsabilidade de
 * recordClientPurchase (ou do caller), para não duplicar.
 */
export function buildNewClientPayload(
  businessId: string,
  name: string | undefined,
  phone: string,
  now: string,
): Omit<Client, 'id'> {
  const canonical = canonicalizeBr(phone) || digitsOnly(phone);
  return {
    businessId,
    name: name?.trim() || 'Cliente',
    phone: canonical,
    whatsapp: canonical,
    channelIdentities: { whatsapp: canonical },
    source: 'outro',
    status: 'novo',
    score: 0,
    isActive: true,
    totalSpent: 0,
    visitCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** Soft-deleted não casa. `deletedAt` não está no tipo Client (é gravado pelo
 *  softDelete sem estar tipado), então lemos via cast. */
function isDeleted(data: Client | undefined): boolean {
  return !!(data as { deletedAt?: string } | undefined)?.deletedAt;
}

// ── Admin SDK ───────────────────────────────────────────────────────────────

async function findExistingAdmin(
  db: AdminFirestore,
  businessId: string,
  candidates: string[],
): Promise<{ id: string; data: Client } | null> {
  const col = db.collection('clients');
  const fields = ['phone', 'whatsapp', 'channelIdentities.whatsapp'] as const;
  const snaps = await Promise.all(
    fields.map((f) =>
      col.where('businessId', '==', businessId).where(f, 'in', candidates).limit(5).get(),
    ),
  );
  for (const snap of snaps) {
    for (const d of snap.docs) {
      const data = d.data() as Client;
      if (data.businessId !== businessId) continue;
      if (isDeleted(data)) continue;
      return { id: d.id, data };
    }
  }
  return null;
}

async function followMergeAdmin(
  db: AdminFirestore,
  businessId: string,
  start: { id: string; data: Client },
): Promise<string> {
  let current = start;
  for (let i = 0; i < MAX_MERGE_DEPTH; i++) {
    const next = current.data.mergedInto;
    if (!next || next === current.id) break;
    const snap = await db.collection('clients').doc(next).get();
    if (!snap.exists) break;
    const data = snap.data() as Client;
    if (data.businessId !== businessId) break;
    current = { id: snap.id, data };
  }
  return current.id;
}

/**
 * Admin SDK: acha ou cria o Client a partir de telefone + nome. Retorna o ID
 * do cliente primário (seguindo mergedInto).
 */
export async function resolveClientIdentityAdmin(
  args: ResolveIdentityArgs & { db: AdminFirestore },
): Promise<ResolveIdentityResult> {
  const { db, businessId, phone, name } = args;
  if (!businessId) throw new Error('resolveClientIdentity: businessId obrigatório (R1)');
  const candidates = buildPhoneMatchCandidates(phone);
  if (candidates.length === 0) throw new Error('resolveClientIdentity: telefone inválido');

  const existing = await findExistingAdmin(db, businessId, candidates);
  if (existing) {
    return { clientId: await followMergeAdmin(db, businessId, existing), created: false };
  }
  if (args.createIfMissing === false) return { clientId: null, created: false };

  const now = new Date().toISOString();
  const payload = buildNewClientPayload(businessId, name, phone, now);
  const ref = await db.collection('clients').add(payload);
  return { clientId: ref.id, created: true };
}

// ── Client SDK ────────────────────────────────────────────────────────────

async function findExistingClient(
  db: ClientFirestore,
  businessId: string,
  candidates: string[],
): Promise<{ id: string; data: Client } | null> {
  const col = collection(db, 'clients');
  const fields = ['phone', 'whatsapp', 'channelIdentities.whatsapp'] as const;
  const snaps = await Promise.all(
    fields.map((f) =>
      getDocs(query(col, where('businessId', '==', businessId), where(f, 'in', candidates))),
    ),
  );
  for (const snap of snaps) {
    for (const d of snap.docs) {
      const data = d.data() as Client;
      if (data.businessId !== businessId) continue;
      if (isDeleted(data)) continue;
      return { id: d.id, data };
    }
  }
  return null;
}

async function followMergeClient(
  db: ClientFirestore,
  businessId: string,
  start: { id: string; data: Client },
): Promise<string> {
  let current = start;
  for (let i = 0; i < MAX_MERGE_DEPTH; i++) {
    const next = current.data.mergedInto;
    if (!next || next === current.id) break;
    const snap = await getDoc(doc(db, 'clients', next));
    if (!snap.exists()) break;
    const data = snap.data() as Client;
    if (data.businessId !== businessId) break;
    current = { id: snap.id, data };
  }
  return current.id;
}

/**
 * Client SDK: acha ou cria o Client a partir de telefone + nome. `db` é opcional
 * — default é a instância do client SDK em lib/config/firebase.
 */
export async function resolveClientIdentityClient(
  args: ResolveIdentityArgs & { db?: ClientFirestore },
): Promise<ResolveIdentityResult> {
  const { businessId, phone, name } = args;
  const db = args.db ?? clientDb;
  if (!businessId) throw new Error('resolveClientIdentity: businessId obrigatório (R1)');
  const candidates = buildPhoneMatchCandidates(phone);
  if (candidates.length === 0) throw new Error('resolveClientIdentity: telefone inválido');

  const existing = await findExistingClient(db, businessId, candidates);
  if (existing) {
    return { clientId: await followMergeClient(db, businessId, existing), created: false };
  }
  if (args.createIfMissing === false) return { clientId: null, created: false };

  const now = new Date().toISOString();
  const payload = buildNewClientPayload(businessId, name, phone, now);
  const ref = await addDoc(collection(db, 'clients'), payload);
  return { clientId: ref.id, created: true };
}
