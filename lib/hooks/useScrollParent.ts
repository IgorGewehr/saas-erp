'use client';

/**
 * useScrollParent — resolve o elemento de scroll ancestral para alimentar o
 * `customScrollParent` do react-virtuoso.
 *
 * Porquê: os módulos não-full-height rolam dentro do wrapper de aba
 * (`app/app/page.tsx` → `absolute inset-0 overflow-y-auto`, marcado com
 * `data-scroll-container`), NÃO na janela. Sem apontar o Virtuoso pra esse
 * scroller, ele não sabe qual viewport observar e a virtualização quebra.
 *
 * Uso:
 *   const [attachRef, scrollParent] = useScrollParent();
 *   return (
 *     <div ref={attachRef}>
 *       {scrollParent && <Virtuoso customScrollParent={scrollParent} ... />}
 *     </div>
 *   );
 *
 * `attachRef` é um callback-ref: resolve o ancestral no momento em que o nó
 * monta (inclusive após troca de aba/view remontar o wrapper), sem depender de
 * efeito com deps.
 */

import { useCallback, useState } from 'react';

const SCROLL_CONTAINER_SELECTOR = '[data-scroll-container]';

export function useScrollParent(): [(node: HTMLElement | null) => void, HTMLElement | null] {
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null);

  const attachRef = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const found = node.closest(SCROLL_CONTAINER_SELECTOR);
    setScrollParent(prev => {
      const next = found instanceof HTMLElement ? found : null;
      return prev === next ? prev : next;
    });
  }, []);

  return [attachRef, scrollParent];
}
