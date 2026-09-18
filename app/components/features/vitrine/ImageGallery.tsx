'use client';

import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CatalogImage, ImagePlaceholder } from './CatalogImage';

interface ImageGalleryProps {
  urls: string[];
  alt: string;
  sizes: string;
  /** Classe de proporção do quadro (ex.: `aspect-[4/3]`). */
  aspectClass?: string;
  priority?: boolean;
  className?: string;
}

/**
 * Galeria com rolagem horizontal nativa (`snap-x`): no tablet o dedo já dá
 * inércia e encaixe sem JS de gesto. Setas só aparecem com ponteiro fino —
 * `pointer: coarse` (toque) navega arrastando.
 * O pai deve usar `key` por produto pra o índice reiniciar ao trocar de item.
 */
export function ImageGallery({ urls, alt, sizes, aspectClass = 'aspect-[4/3]', priority = false, className }: ImageGalleryProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  if (urls.length === 0) {
    return (
      <div className={cn('relative w-full overflow-hidden rounded-2xl', aspectClass, className)}>
        <ImagePlaceholder />
      </div>
    );
  }

  const handleScroll = () => {
    const element = scroller.current;
    if (!element || element.clientWidth === 0) return;
    setIndex(Math.round(element.scrollLeft / element.clientWidth));
  };

  const goTo = (target: number) => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTo({ left: target * element.clientWidth, behavior: 'smooth' });
  };

  return (
    <div className={cn('relative', className)}>
      <div
        ref={scroller}
        onScroll={handleScroll}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-2xl scrollbar-hide"
      >
        {urls.map((url, position) => (
          <div
            key={url}
            className={cn('relative w-full shrink-0 snap-center bg-gray-100 dark:bg-gray-800', aspectClass)}
          >
            <CatalogImage
              src={url}
              alt={urls.length > 1 ? `${alt} — foto ${position + 1} de ${urls.length}` : alt}
              sizes={sizes}
              fit="contain"
              priority={priority && position === 0}
            />
          </div>
        ))}
      </div>

      {urls.length > 1 && (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5" aria-hidden>
            {urls.map((url, position) => (
              <span
                key={url}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  position === index ? 'w-4 bg-white shadow' : 'w-1.5 bg-white/60',
                )}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label="Foto anterior"
            disabled={index === 0}
            onClick={() => goTo(index - 1)}
            className="absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white transition-opacity disabled:opacity-30 [@media(pointer:fine)]:flex"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Próxima foto"
            disabled={index === urls.length - 1}
            onClick={() => goTo(index + 1)}
            className="absolute right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white transition-opacity disabled:opacity-30 [@media(pointer:fine)]:flex"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}
    </div>
  );
}
