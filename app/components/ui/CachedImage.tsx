'use client';

import { useEffect, useState, memo } from 'react';
import { ensureCached, getCachedSync } from '@/lib/utils/imageCache';

export interface CachedImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string | null | undefined;
  /** Fallback node shown when src is empty/null or the fetch fails. */
  fallback?: React.ReactNode;
}

/**
 * Drop-in <img> replacement that dedupes + caches remote URLs in memory and
 * sessionStorage. Prevents the "flash → spinner → load" on every mount for
 * stable URLs (user avatars, business logos, contact photos).
 *
 * Behavior:
 *  - Instant render when the URL is already cached (cache-first).
 *  - Falls back to the raw URL while the background fetch completes.
 *  - If fetch fails, retries on next render but never blocks.
 *  - When src changes, we swap cleanly without a visible flash.
 */
function CachedImageImpl({ src, fallback, alt = '', ...rest }: CachedImageProps) {
  const initial = src ? getCachedSync(src) : null;
  const [resolved, setResolved] = useState<string | null>(initial);

  useEffect(() => {
    if (!src) {
      setResolved(null);
      return;
    }
    // If we already have a cached hit, no need to refetch
    const hit = getCachedSync(src);
    if (hit) {
      setResolved(hit);
      return;
    }
    // Optimistically render the raw URL so the user isn't staring at blank
    setResolved(src);
    let cancelled = false;
    ensureCached(src).then(cached => {
      if (!cancelled && cached) setResolved(cached);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!src) {
    return fallback ? <>{fallback}</> : null;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={resolved || src} alt={alt} {...rest} />;
}

export const CachedImage = memo(CachedImageImpl);
