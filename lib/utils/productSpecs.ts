/**
 * lib/utils/productSpecs.ts
 *
 * Vitrine (tablet): Product não tem campo estruturado de especificações — a
 * convenção da demo é escrever `Rótulo: valor` (uma por linha) na `description`
 * do produto. Este helper interpreta isso numa tabela e devolve o resto como
 * texto. Estruturar num campo próprio fica pra quando o cliente explicar o que
 * realmente precisa (ver plano da Vitrine) — mexer no schema de Product toca
 * ~6 arquivos (produtos são server-write-only).
 *
 * Degrada com graça: se a descrição não parece uma lista de specs, tudo vira
 * texto normal (`rest`) e `specs` fica vazio.
 */

export interface ProductSpec {
  label: string;
  value: string;
}

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
