/**
 * Cotação USD/BRL — usado pela toggle de moeda do Financeiro.
 *
 * Fonte: awesomeapi.com.br (pública, sem autenticação)
 *   GET https://economia.awesomeapi.com.br/last/USD-BRL
 *   → { USDBRL: { bid: "5.1234" } }
 *
 * Cache em localStorage (TTL 1h) para evitar request a cada render.
 */

const CACHE_KEY = 'aevo:exchange:USD-BRL';
const CACHE_TTL_MS = 60 * 60 * 1000;

interface CachedRate {
  rate: number;
  fetchedAt: number;
}

export interface ExchangeRateResult {
  rate: number;       // BRL por 1 USD
  fetchedAt: number;  // epoch ms
  fromCache: boolean;
}

function readCache(): CachedRate | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedRate;
    if (typeof parsed.rate !== 'number' || typeof parsed.fetchedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(rate: number, fetchedAt: number): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ rate, fetchedAt } as CachedRate));
  } catch { /* quota / private mode */ }
}

export async function fetchUsdBrlRate(force = false): Promise<ExchangeRateResult> {
  if (!force) {
    const cached = readCache();
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return { rate: cached.rate, fetchedAt: cached.fetchedAt, fromCache: true };
    }
  }
  const res = await fetch('https://economia.awesomeapi.com.br/last/USD-BRL', {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Falha ao consultar cotação (HTTP ${res.status})`);
  const data = await res.json();
  const bid = parseFloat(data?.USDBRL?.bid);
  if (!Number.isFinite(bid) || bid <= 0) {
    throw new Error('Cotação inválida na resposta da API');
  }
  const fetchedAt = Date.now();
  writeCache(bid, fetchedAt);
  return { rate: bid, fetchedAt, fromCache: false };
}

export function readCachedRate(): CachedRate | null {
  return readCache();
}
