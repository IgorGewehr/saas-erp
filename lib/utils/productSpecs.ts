/**
 * lib/utils/productSpecs.ts
 *
 * Especificações do produto para a Vitrine (tablet). Duas fontes:
 *  1. `Product.specs` — campo estruturado (rótulo/valor), editado no cadastro do produto;
 *  2. legado — linhas `Rótulo: valor` (uma por linha) escritas na `description`. `parseProductSpecs`
 *     interpreta isso numa tabela e devolve o resto como texto; degrada com graça (se a descrição
 *     não parece uma lista de specs, tudo vira texto e `specs` fica vazio).
 * `resolveProductSpecs` escolhe: estruturado primeiro, senão o legado.
 */

import type { Product, ProductSpec } from '@/lib/types';

export type { ProductSpec };

export interface ParsedProductSpecs {
  specs: ProductSpec[];
  /** Linhas que não são spec, na ordem original (vazio se não sobrou nada). */
  rest: string;
}

const MAX_LABEL_LENGTH = 40;
const MIN_SPEC_LINES = 2;
const BULLET_PREFIX = /^[-•*–]\s+/;
const SPEC_LINE = /^([^:]+):\s*(.+)$/;
const HAS_LETTER = /\p{L}/u;

function parseSpecLine(rawLine: string): ProductSpec | null {
  const line = rawLine.trim().replace(BULLET_PREFIX, '');
  const match = SPEC_LINE.exec(line);
  if (!match) return null;
  const label = match[1].trim();
  const value = match[2].trim();
  if (!label || !value) return null;
  if (label.length > MAX_LABEL_LENGTH) return null;
  // "10:30 às 12h" (hora) não é spec — rótulo precisa ter ao menos uma letra.
  if (!HAS_LETTER.test(label)) return null;
  // "https://exemplo.com" → rótulo "https", valor "//exemplo.com".
  if (/^https?$/i.test(label) || value.startsWith('//')) return null;
  return { label, value };
}

export function parseProductSpecs(description: string | null | undefined): ParsedProductSpecs {
  const text = (description ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return { specs: [], rest: '' };

  const lines = text.split('\n');
  const parsed = lines.map((line) => ({ line, spec: parseSpecLine(line) }));
  const specCount = parsed.filter((p) => p.spec).length;

  // Uma linha "Duração: 30s" solta é só uma frase — exige ao menos 2 pra
  // considerar que o autor escreveu uma lista de especificações.
  if (specCount < MIN_SPEC_LINES) return { specs: [], rest: text };

  const specs: ProductSpec[] = [];
  const restLines: string[] = [];
  for (const { line, spec } of parsed) {
    if (spec) specs.push(spec);
    else restLines.push(line.trim());
  }
  const rest = restLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { specs, rest };
}

const MAX_SPECS = 30;

/** Tira espaços e descarta linha com rótulo OU valor vazio (linha meio digitada não pode barrar o salvar). */
export function sanitizeSpecs(specs: ProductSpec[] | null | undefined): ProductSpec[] {
  return (specs ?? [])
    .map((spec) => ({ label: spec.label.trim(), value: spec.value.trim() }))
    .filter((spec) => spec.label !== '' && spec.value !== '')
    .slice(0, MAX_SPECS);
}

/** Sobe/desce uma linha (delta −1/+1); fora dos limites não muda nada. */
export function moveSpec(specs: ProductSpec[], index: number, delta: -1 | 1): ProductSpec[] {
  const target = index + delta;
  if (index < 0 || index >= specs.length || target < 0 || target >= specs.length) return specs;
  const next = [...specs];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * Especificações a exibir. Com campo estruturado, ele manda e a descrição inteira vira texto
 * (o autor escolheu manter as linhas lá). Sem ele, cai na convenção antiga `Rótulo: valor`
 * da descrição — produtos cadastrados antes do campo continuam com a tabela.
 */
export function resolveProductSpecs(
  product: Pick<Product, 'specs' | 'description' | 'menuDescription'>,
): ParsedProductSpecs {
  const description = product.description?.trim() || product.menuDescription?.trim() || '';
  const structured = sanitizeSpecs(product.specs);
  if (structured.length > 0) return { specs: structured, rest: description };
  return parseProductSpecs(description);
}
