/**
 * lib/contracts/_runtime/idempotency.ts
 *
 * Idempotency middleware para POSTs que criam recursos.
 *
 * Como funciona:
 *   1. Cliente envia POST com header `X-Idempotency-Key: <uuid>`
 *   2. Server normaliza chave: `${businessId}_${key}` e checa em `idempotencyKeys/{docId}`
 *   3. Se já existe E status='completed' → devolve o resultado salvo (idempotent replay)
 *   4. Se já existe E status='in_progress' → 409 CONFLICT (request anterior ainda rodando)
 *   5. Se não existe → cria doc 'in_progress', roda o handler, salva resultado, retorna
 *
 * Chave fica vivendo 24h por padrão (TTL via campo expiresAt + Cloud Function de limpeza
 * opcional). Em produção, recomenda-se garbage collect periódico.
 *
 * IMPORTANTE: não é uma transação distribuída. Se o handler crashar entre
 * o set 'in_progress' e o set 'completed', a chave fica órfã 24h. Aceitável
 * para o uso típico (criar Sale/Order). Cliente faz retry com a mesma chave
 * e recebe 409 até a chave expirar.
 */

import type { Firestore } from 'firebase-admin/firestore';

export interface IdempotencyRecord {
  businessId: string;
  key: string;
  status: 'in_progress' | 'completed';
  result?: unknown;
  endpoint: string;
  createdAt: string;
  completedAt?: string;
  expiresAt: string;
}

export interface IdempotencyResult<T> {
  /** Resultado a devolver ao cliente. */
  result: T;
  /** True quando foi cache hit (replay). False quando handler rodou agora. */
  replayed: boolean;
}

export class IdempotencyConflictError extends Error {
  constructor(public key: string) {
    super(`Idempotency key ${key} ainda em processamento — retry mais tarde`);
    this.name = 'IdempotencyConflictError';
  }
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Resolve uma chave de idempotência (opcional). Se não fornecida (cliente
 * decidiu não enviar header), executa o handler normalmente — sem cache.
 *
 * Se fornecida:
 *   - cache hit → devolve resultado salvo (replayed=true)
 *   - in_progress → IdempotencyConflictError
 *   - miss → roda handler, persiste resultado, retorna replayed=false
 */
export async function withIdempotency<T>(
  db: Firestore,
  opts: {
    businessId: string;
    /** Header `X-Idempotency-Key`. `null|undefined` desativa idempotency pro request. */
    key: string | null | undefined;
    /** Identificador da rota (ex: 'POST /api/v1/sales') — guardado para auditoria. */
    endpoint: string;
    /** TTL em ms. Default: 24h. */
    ttlMs?: number;
  },
  handler: () => Promise<T>,
): Promise<IdempotencyResult<T>> {
  if (!opts.key) {
    const result = await handler();
    return { result, replayed: false };
  }

  const docId = `${opts.businessId}_${opts.key}`;
  const ref = db.collection('idempotencyKeys').doc(docId);
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = Date.now();

  // Tenta criar a entrada in_progress de forma atômica (transaction)
  const startResult = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const data = snap.data() as IdempotencyRecord;
      if (data.businessId !== opts.businessId) {
        // Tenant mismatch — chave já usada por outro businessId. Trata como conflito.
        return { kind: 'conflict' as const };
      }
      if (data.status === 'completed') {
        return { kind: 'replay' as const, result: data.result as T };
      }
      // in_progress: cheque se expirou
      if (new Date(data.expiresAt).getTime() < now) {
        // Expirou — reusa (handler rodará de novo)
        tx.set(ref, {
          businessId: opts.businessId,
          key: opts.key!,
          status: 'in_progress',
          endpoint: opts.endpoint,
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + ttlMs).toISOString(),
        } satisfies IdempotencyRecord);
        return { kind: 'fresh' as const };
      }
      return { kind: 'conflict' as const };
    }
    // Não existe: cria
    tx.set(ref, {
      businessId: opts.businessId,
      key: opts.key!,
      status: 'in_progress',
      endpoint: opts.endpoint,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
    } satisfies IdempotencyRecord);
    return { kind: 'fresh' as const };
  });

  if (startResult.kind === 'replay') {
    return { result: startResult.result, replayed: true };
  }
  if (startResult.kind === 'conflict') {
    throw new IdempotencyConflictError(opts.key);
  }

  // fresh — roda o handler
  try {
    const result = await handler();
    await ref.update({
      status: 'completed',
      result: result as Record<string, unknown>,
      completedAt: new Date().toISOString(),
    });
    return { result, replayed: false };
  } catch (err) {
    // Handler falhou: delete pra permitir retry imediato com mesma chave
    await ref.delete().catch(() => undefined);
    throw err;
  }
}
