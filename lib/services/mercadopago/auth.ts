/**
 * lib/services/mercadopago/auth.ts
 *
 * OAuth Marketplace do Mercado Pago + ciclo de vida do access token do tenant.
 * SERVER-ONLY (Admin SDK). Tokens cifrados em repouso (AES-256-GCM).
 *
 * Doc sensível: businesses/{businessId}/private/mpAuth (só Admin SDK lê/escreve).
 * Flags públicas espelhadas em businesses/{businessId} para gates de UI.
 *
 * REFRESH ROTATIVO: o MP rotaciona o refresh_token a cada refresh. Persistir o
 * novo é OBRIGATÓRIO — se dois processos derem refresh concorrente com o mesmo
 * refresh_token, o segundo invalida a conexão. Por isso o refresh roda sob um
 * LOCK distribuído (businesses/{id}/private/mpTokenLock).
 */

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { encryptToken, decryptToken } from '@/lib/utils/encryption';
import {
  PaymentAccountSchema,
  PaymentAccountPublicSchema,
  type PaymentAccount,
  type PaymentAccountPublic,
} from '@/contracts/domain/paymentAccount';
import { mpFetch } from './client';

// ─── Config do APP (env) ────────────────────────────────────────────────────

function getAppCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.MP_CLIENT_ID;
  const clientSecret = process.env.MP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('[MercadoPago] MP_CLIENT_ID e MP_CLIENT_SECRET são obrigatórios');
  }
  return { clientId, clientSecret };
}

// ─── Shape da resposta do /oauth/token (boundary externo → valida com Zod) ───

const MpTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
  user_id: z.union([z.string(), z.number()]),
  public_key: z.string().min(1),
  live_mode: z.boolean().optional(),
});
export type MpTokenResponse = z.infer<typeof MpTokenResponseSchema>;

// ─── Caminhos de doc ─────────────────────────────────────────────────────────

const mpAuthRef = (businessId: string) =>
  adminDb.collection('businesses').doc(businessId).collection('private').doc('mpAuth');
const mpLockRef = (businessId: string) =>
  adminDb.collection('businesses').doc(businessId).collection('private').doc('mpTokenLock');
const businessRef = (businessId: string) =>
  adminDb.collection('businesses').doc(businessId);

// ─── exchangeCodeForToken ────────────────────────────────────────────────────

/**
 * Troca o `code` do OAuth (grant authorization_code) por tokens do vendedor.
 * Retorna a resposta tipada do MP (tokens + user_id + public_key + live_mode).
 */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
): Promise<MpTokenResponse> {
  const { clientId, clientSecret } = getAppCredentials();
  const raw = await mpFetch<unknown>('/oauth/token', {
    method: 'POST',
    body: {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    },
  });
  return MpTokenResponseSchema.parse(raw);
}

// ─── saveMpAccount ───────────────────────────────────────────────────────────

/**
 * Cifra e persiste os tokens em businesses/{id}/private/mpAuth, espelhando as
 * flags públicas em businesses/{id} num batch atômico. Retorna a projeção
 * segura (sem tokens) pra UI.
 */
export async function saveMpAccount(
  businessId: string,
  tokenResp: MpTokenResponse,
): Promise<PaymentAccountPublic> {
  const now = new Date();
  const [accessTokenEncrypted, refreshTokenEncrypted] = await Promise.all([
    encryptToken(tokenResp.access_token),
    encryptToken(tokenResp.refresh_token),
  ]);

  const account: PaymentAccount = PaymentAccountSchema.parse({
    businessId,
    provider: 'mercadopago',
    mpUserId: String(tokenResp.user_id),
    mpPublicKey: tokenResp.public_key,
    mpLiveMode: tokenResp.live_mode ?? false,
    accessTokenEncrypted,
    refreshTokenEncrypted,
    tokenExpiresAt: new Date(now.getTime() + tokenResp.expires_in * 1000).toISOString(),
    mpConnected: true,
    mpNeedsReauth: false,
    connectedAt: now.toISOString(),
    lastRefreshAt: now.toISOString(),
  } satisfies PaymentAccount);

  const publicFlags = {
    mpConnected: account.mpConnected,
    mpPublicKey: account.mpPublicKey,
    mpNeedsReauth: account.mpNeedsReauth,
    mpLiveMode: account.mpLiveMode,
  };

  const batch = adminDb.batch();
  batch.set(mpAuthRef(businessId), account);
  batch.set(businessRef(businessId), publicFlags, { merge: true });
  await batch.commit();

  return PaymentAccountPublicSchema.parse(publicFlags);
}

// ─── getMpAccessToken (com refresh sob lock) ─────────────────────────────────

const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // renova com <5min de folga
// Lock órfão só após 60s: precisa de folga ACIMA do pior caso do doRefresh
// (mpFetch timeout 15s + retries/rede). Se fosse < esse pior caso, um 2º
// processo reivindicaria o lock enquanto o 1º ainda renova → refresh concorrente
// rotacionando o refresh_token duas vezes (invalida a conexão).
const LOCK_STALE_MS = 60 * 1000; // lock órfão após ~60s
const LOCK_WAIT_TOTAL_MS = 65 * 1000; // espera o detentor terminar (> LOCK_STALE_MS)
const LOCK_POLL_MS = 500;

class MpReauthRequiredError extends Error {
  constructor(businessId: string, cause?: string) {
    super(`[MercadoPago] reconexão necessária para ${businessId}${cause ? `: ${cause}` : ''}`);
    this.name = 'MpReauthRequiredError';
  }
}

function readAccount(snap: FirebaseFirestore.DocumentSnapshot): PaymentAccount | null {
  if (!snap.exists) return null;
  return snap.data() as PaymentAccount;
}

function tokenStillFresh(account: PaymentAccount): boolean {
  const expiresAt = new Date(account.tokenExpiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt - Date.now() > REFRESH_THRESHOLD_MS;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Retorna um access token VÁLIDO do tenant, renovando sob lock se necessário.
 * Lança MpReauthRequiredError se a conta não existe / refresh falhou.
 */
export async function getMpAccessToken(businessId: string): Promise<string> {
  let account = readAccount(await mpAuthRef(businessId).get());
  if (!account) throw new MpReauthRequiredError(businessId, 'conta MP não conectada');
  if (account.mpNeedsReauth) throw new MpReauthRequiredError(businessId, 'mpNeedsReauth=true');

  if (tokenStillFresh(account)) {
    return decryptToken(account.accessTokenEncrypted);
  }

  // Precisa renovar — tenta adquirir o lock distribuído.
  const lockId = randomUUID();
  const deadline = Date.now() + LOCK_WAIT_TOTAL_MS;

  while (true) {
    const acquired = await tryAcquireLock(businessId, lockId);
    if (acquired) break;

    // Outro processo está renovando: aguarda e relê — talvez já tenha renovado.
    await sleep(LOCK_POLL_MS);
    account = readAccount(await mpAuthRef(businessId).get());
    if (!account) throw new MpReauthRequiredError(businessId, 'conta removida durante refresh');
    if (account.mpNeedsReauth) throw new MpReauthRequiredError(businessId, 'refresh concorrente falhou');
    if (tokenStillFresh(account)) {
      return decryptToken(account.accessTokenEncrypted);
    }
    if (Date.now() > deadline) {
      // Lock preso além do stale: força nova tentativa (reivindica órfão).
      const forced = await tryAcquireLock(businessId, lockId);
      if (forced) break;
      throw new Error(`[MercadoPago] timeout aguardando refresh lock de ${businessId}`);
    }
  }

  try {
    // Double-check sob o lock: outro processo pode ter renovado antes de soltarmos.
    account = readAccount(await mpAuthRef(businessId).get());
    if (!account) throw new MpReauthRequiredError(businessId, 'conta removida');
    if (account.mpNeedsReauth) throw new MpReauthRequiredError(businessId, 'mpNeedsReauth=true');
    if (tokenStillFresh(account)) {
      return decryptToken(account.accessTokenEncrypted);
    }
    return await doRefresh(businessId, account);
  } finally {
    await releaseLock(businessId, lockId);
  }
}

async function tryAcquireLock(businessId: string, lockId: string): Promise<boolean> {
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(mpLockRef(businessId));
    if (snap.exists) {
      const data = snap.data() as { lockId: string; acquiredAt: string };
      const age = Date.now() - new Date(data.acquiredAt).getTime();
      if (Number.isFinite(age) && age < LOCK_STALE_MS) {
        return false; // lock fresco de outro processo
      }
    }
    tx.set(mpLockRef(businessId), { lockId, acquiredAt: new Date().toISOString() });
    return true;
  });
}

async function releaseLock(businessId: string, lockId: string): Promise<void> {
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(mpLockRef(businessId));
    if (snap.exists && (snap.data() as { lockId: string }).lockId === lockId) {
      tx.delete(mpLockRef(businessId));
    }
  }).catch(() => undefined); // soltar lock nunca pode derrubar o fluxo principal
}

async function doRefresh(businessId: string, account: PaymentAccount): Promise<string> {
  const { clientId, clientSecret } = getAppCredentials();
  // Baseline pra detectar rotação concorrente antes de persistir (defesa em
  // profundidade — ver re-leitura mais abaixo).
  const baselineRefreshAt = account.lastRefreshAt;
  let refreshToken: string;
  try {
    refreshToken = await decryptToken(account.refreshTokenEncrypted);
  } catch (err) {
    await markNeedsReauth(businessId);
    throw new MpReauthRequiredError(businessId, `refresh_token ilegível: ${String(err)}`);
  }

  let parsed: MpTokenResponse;
  try {
    const raw = await mpFetch<unknown>('/oauth/token', {
      method: 'POST',
      body: {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
    });
    parsed = MpTokenResponseSchema.parse(raw);
  } catch (err) {
    await markNeedsReauth(businessId);
    throw new MpReauthRequiredError(
      businessId,
      `refresh falhou: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Defesa em profundidade: mesmo sob lock, re-leia antes de persistir. Se outro
  // processo (lock reivindicado como órfão, relógio dessincronizado, etc.) já
  // rotacionou — lastRefreshAt mudou e o token está fresco — NÃO sobrescreve:
  // sobrescrever invalidaria o refresh_token recém-rotacionado pelo outro
  // processo. Devolve o access token vigente já persistido.
  const latest = readAccount(await mpAuthRef(businessId).get());
  if (
    latest &&
    latest.lastRefreshAt !== baselineRefreshAt &&
    !latest.mpNeedsReauth &&
    tokenStillFresh(latest)
  ) {
    return decryptToken(latest.accessTokenEncrypted);
  }

  // Persiste tokens ROTACIONADOS (refresh_token novo é obrigatório).
  const now = new Date();
  const [accessTokenEncrypted, refreshTokenEncrypted] = await Promise.all([
    encryptToken(parsed.access_token),
    encryptToken(parsed.refresh_token),
  ]);
  await mpAuthRef(businessId).set(
    {
      accessTokenEncrypted,
      refreshTokenEncrypted,
      tokenExpiresAt: new Date(now.getTime() + parsed.expires_in * 1000).toISOString(),
      mpPublicKey: parsed.public_key,
      mpLiveMode: parsed.live_mode ?? account.mpLiveMode,
      mpConnected: true,
      mpNeedsReauth: false,
      lastRefreshAt: now.toISOString(),
    } satisfies Partial<PaymentAccount>,
    { merge: true },
  );

  return parsed.access_token;
}

// ─── refreshMpTokenProactively (cron de resiliência) ─────────────────────────

/** Janela default de antecipação do refresh proativo: 15 dias. */
export const PROACTIVE_REFRESH_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000;

export interface ProactiveRefreshOutcome {
  refreshed: boolean;
  /** Motivo quando NÃO renovou (no-op). */
  skipped?:
    | 'no-account'
    | 'needs-reauth'
    | 'still-fresh'
    | 'locked';
}

/**
 * Renova o token do tenant ANTECIPADAMENTE (antes da janela apertada de 5min do
 * fluxo on-demand) — usado pelo cron de resiliência. Renova se o access token
 * expira em menos de `minRemainingMs`. Roda sob o MESMO lock distribuído do
 * fluxo on-demand (a rotação do refresh_token do MP exige serialização — dois
 * refreshes concorrentes invalidam a conexão).
 *
 * NÃO lança em falha de rede/refresh: o `doRefresh` já marca `mpNeedsReauth` e
 * lança MpReauthRequiredError; o cron isola por-tenant. Aqui só propagamos pra
 * o caller contabilizar; falha de UM tenant nunca derruba a varredura.
 */
export async function refreshMpTokenProactively(
  businessId: string,
  minRemainingMs: number = PROACTIVE_REFRESH_THRESHOLD_MS,
): Promise<ProactiveRefreshOutcome> {
  const account = readAccount(await mpAuthRef(businessId).get());
  if (!account) return { refreshed: false, skipped: 'no-account' };
  if (account.mpNeedsReauth) return { refreshed: false, skipped: 'needs-reauth' };

  const expiresAt = new Date(account.tokenExpiresAt).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > minRemainingMs) {
    return { refreshed: false, skipped: 'still-fresh' };
  }

  const lockId = randomUUID();
  const acquired = await tryAcquireLock(businessId, lockId);
  if (!acquired) return { refreshed: false, skipped: 'locked' };

  try {
    // Double-check sob o lock — outro processo pode ter acabado de renovar.
    const fresh = readAccount(await mpAuthRef(businessId).get());
    if (!fresh) return { refreshed: false, skipped: 'no-account' };
    if (fresh.mpNeedsReauth) return { refreshed: false, skipped: 'needs-reauth' };
    const exp = new Date(fresh.tokenExpiresAt).getTime();
    if (Number.isFinite(exp) && exp - Date.now() > minRemainingMs) {
      return { refreshed: false, skipped: 'still-fresh' };
    }
    await doRefresh(businessId, fresh);
    return { refreshed: true };
  } finally {
    await releaseLock(businessId, lockId);
  }
}

async function markNeedsReauth(businessId: string): Promise<void> {
  const batch = adminDb.batch();
  batch.set(mpAuthRef(businessId), { mpConnected: false, mpNeedsReauth: true }, { merge: true });
  batch.set(businessRef(businessId), { mpConnected: false, mpNeedsReauth: true }, { merge: true });
  await batch.commit().catch(() => undefined);
}

// ─── disconnectMp ────────────────────────────────────────────────────────────

/**
 * Desconecta a conta MP do tenant (best-effort). Não há recurso remoto a
 * cancelar no fluxo OAuth padrão; apaga tokens e zera flags públicas.
 */
export async function disconnectMp(businessId: string): Promise<void> {
  const batch = adminDb.batch();
  batch.delete(mpAuthRef(businessId));
  batch.set(
    businessRef(businessId),
    { mpConnected: false, mpNeedsReauth: false },
    { merge: true },
  );
  await batch.commit();
}
