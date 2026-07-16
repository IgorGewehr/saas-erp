/**
 * Tiny image cache — eliminates the "flash-reload" on Firebase Storage photos
 * every time a component unmounts/remounts (avatars, logos).
 *
 * Strategy:
 *  - In-memory Map<src, blobUrl>: instant on repeat renders in the same tab.
 *  - sessionStorage<src, dataUrl>: survives across navigations + reloads within
 *    the tab lifecycle without forcing a network round-trip.
 *  - Stale-while-revalidate: on cache hit we still fetch in the background so
 *    updates (new photo) propagate within seconds.
 *
 * Usage:
 *   const cached = useCachedImage(user.photoURL);
 *   return <img src={cached || user.photoURL} ... />
 */

const MEMORY_CACHE = new Map<string, string>();       // src → blobUrl
const INFLIGHT = new Map<string, Promise<string>>();  // dedupe concurrent fetches
const STORAGE_PREFIX = '__img_cache:';
const MAX_BYTES_PER_IMG = 512 * 1024;                 // don't try to store >512KB as dataUrl

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function readSessionCache(src: string): string | null {
  try {
    return sessionStorage.getItem(STORAGE_PREFIX + src);
  } catch {
    return null;
  }
}

function writeSessionCache(src: string, dataUrl: string): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + src, dataUrl);
  } catch {
    // Quota exceeded — evict oldest entries and retry once
    try {
      const keys: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
      }
      // Drop ~half to free room
      keys.slice(0, Math.ceil(keys.length / 2)).forEach(k => sessionStorage.removeItem(k));
      sessionStorage.setItem(STORAGE_PREFIX + src, dataUrl);
    } catch {
      /* give up silently */
    }
  }
}

/**
 * Get a cached blob URL for the given source. Returns the URL synchronously if
 * cached; otherwise fetches and returns a Promise.
 *
 * `null` is returned synchronously when nothing is cached and the caller should
 * fall back to the original src while waiting for the background fetch.
 */
export function getCachedSync(src: string): string | null {
  if (!src || !isHttpUrl(src)) return src || null;
  const mem = MEMORY_CACHE.get(src);
  if (mem) return mem;
  if (typeof window === 'undefined') return null;
  const sess = readSessionCache(src);
  if (sess) {
    MEMORY_CACHE.set(src, sess);
    return sess;
  }
  return null;
}

export async function ensureCached(src: string): Promise<string | null> {
  if (!src || !isHttpUrl(src)) return src || null;
  const existing = getCachedSync(src);
  if (existing) return existing;

  const pending = INFLIGHT.get(src);
  if (pending) return pending;

  const p = (async () => {
    try {
      const resp = await fetch(src, { cache: 'force-cache' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      if (blob.size > MAX_BYTES_PER_IMG) {
        // Too big for sessionStorage — keep only in memory via blob URL
        const blobUrl = URL.createObjectURL(blob);
        MEMORY_CACHE.set(src, blobUrl);
        return blobUrl;
      }
      const dataUrl = await blobToDataUrl(blob);
      MEMORY_CACHE.set(src, dataUrl);
      writeSessionCache(src, dataUrl);
      return dataUrl;
    } catch {
      return src; // fall back to direct URL
    } finally {
      INFLIGHT.delete(src);
    }
  })();

  INFLIGHT.set(src, p);
  return p;
}
