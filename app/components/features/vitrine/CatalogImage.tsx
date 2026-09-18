'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CatalogImageProps {
  src: string;
  alt: string;
  /** Largura renderizada por breakpoint — é o que faz o Next servir miniatura em vez da foto cheia. */
  sizes: string;
  fit?: 'cover' | 'contain';
  priority?: boolean;
  className?: string;
}

type Stage = 'optimized' | 'raw' | 'failed';

/**
 * Preenche o pai (`relative` + proporção definida). Tenta o otimizador do Next
 * (miniatura leve no tablet); se ele falhar — host inalcançável pelo servidor,
 * imagem fora do formato — cai pra URL crua e, se também falhar, pro placeholder.
 * O pai deve usar `key={src}` pra o estado reiniciar quando a imagem trocar.
 */
export function CatalogImage({ src, alt, sizes, fit = 'cover', priority = false, className }: CatalogImageProps) {
  const [stage, setStage] = useState<Stage>('optimized');
  const fitClass = fit === 'cover' ? 'object-cover' : 'object-contain';

  if (stage === 'failed') return <ImagePlaceholder />;

  if (stage === 'raw') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        className={cn('absolute inset-0 h-full w-full', fitClass, className)}
        onError={() => setStage('failed')}
      />
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      className={cn(fitClass, className)}
      onError={() => setStage('raw')}
    />
  );
}

export function ImagePlaceholder({ className }: { className?: string }) {
  return (
    <div className={cn('absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800', className)}>
      <ImageOff className="h-8 w-8 text-gray-300 dark:text-gray-600" aria-hidden />
    </div>
  );
}
