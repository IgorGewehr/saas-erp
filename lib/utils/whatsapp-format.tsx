/**
 * lib/utils/whatsapp-format.tsx
 *
 * Renderiza texto de mensagem com formatação estilo WhatsApp:
 *   *bold*      → <strong>
 *   _italic_    → <em>
 *   ~strike~    → <s>
 *   `code`      → <code> inline
 *   ```block``` → <pre><code> monoespaço
 *   https://... → <a> clicável (target=_blank rel=noopener)
 *   www.foo.com → <a> idem
 *
 * Não usa dangerouslySetInnerHTML — devolve árvore de ReactNode pra evitar
 * XSS com conteúdo de usuário externo (mensagem inbound de WhatsApp/IG/FB).
 *
 * Regras de markdown (paridade WhatsApp):
 *   - Marker abre apenas se char seguinte for non-whitespace.
 *   - Marker fecha apenas se char anterior for non-whitespace.
 *   - Sem aninhamento: `*_x_*` renderiza bold com `_x_` literal.
 *     (WhatsApp tem a mesma limitação na maioria das versões.)
 *   - Code blocks ``` ... ``` são literais — nenhum marker interno é
 *     processado, e podem atravessar quebras de linha.
 *
 * Precedência (primeiro match no scan ganha):
 *   1. ```code block```
 *   2. `inline code`
 *   3. URL (http://, https://, www.)
 *   4. *bold*
 *   5. _italic_
 *   6. ~strike~
 *
 * Quebras de linha (\n) são preservadas pelo CSS `white-space: pre-wrap`
 * no container chamador — este formatter NÃO injeta <br>.
 */

import React from 'react';

type Marker = '*' | '_' | '~' | '`';

interface ScanHit {
  type: 'pre' | 'code' | 'url' | 'bold' | 'italic' | 'strike';
  start: number;
  end: number;
  content: string;
}

const URL_REGEX = /(https?:\/\/[^\s<>"'()]+[^\s<>"'.,;:!?()])|(\bwww\.[^\s<>"'()]+[^\s<>"'.,;:!?()])/i;

function isWhitespace(c: string | undefined): boolean {
  return c === undefined || /\s/.test(c);
}

/**
 * Procura o próximo par de markers válido a partir de `from`. Retorna o hit
 * mais à esquerda entre todos os formatadores. Markers seguem regras do
 * WhatsApp: sem espaço logo após o de abertura nem logo antes do de
 * fechamento, e o marker oposto também precisa estar lá.
 */
function findInlineMarker(
  text: string,
  from: number,
  marker: Marker,
  type: ScanHit['type'],
): ScanHit | null {
  let i = from;
  while (i < text.length) {
    const openIdx = text.indexOf(marker, i);
    if (openIdx === -1) return null;
    const charBefore = openIdx > 0 ? text[openIdx - 1] : undefined;
    const charAfter = text[openIdx + 1];
    // Abertura válida: char anterior é boundary E char seguinte é non-space.
    const openValid = isWhitespace(charBefore) || /[.,;:!?(\[{]/.test(charBefore!) || openIdx === 0;
    if (!openValid || isWhitespace(charAfter) || charAfter === marker) {
      i = openIdx + 1;
      continue;
    }
    // Procura fechamento na mesma linha (markers inline não atravessam \n).
    let j = openIdx + 1;
    while (j < text.length && text[j] !== '\n') {
      if (text[j] === marker) {
        const closeBefore = text[j - 1];
        const closeAfter = text[j + 1];
        if (!isWhitespace(closeBefore) && (isWhitespace(closeAfter) || /[.,;:!?)\]}]/.test(closeAfter ?? ' ') || j === text.length - 1)) {
          return {
            type,
            start: openIdx,
            end: j + 1,
            content: text.slice(openIdx + 1, j),
          };
        }
      }
      j++;
    }
    i = openIdx + 1;
  }
  return null;
}

function findCodeBlock(text: string, from: number): ScanHit | null {
  const open = text.indexOf('```', from);
  if (open === -1) return null;
  const close = text.indexOf('```', open + 3);
  if (close === -1) return null;
  return { type: 'pre', start: open, end: close + 3, content: text.slice(open + 3, close) };
}

function findInlineCode(text: string, from: number): ScanHit | null {
  let i = from;
  while (i < text.length) {
    const open = text.indexOf('`', i);
    if (open === -1) return null;
    // Não confunde com triple backtick.
    if (text.substr(open, 3) === '```') {
      i = open + 3;
      continue;
    }
    const close = text.indexOf('`', open + 1);
    if (close === -1 || close === open + 1) return null;
    // Inline code não atravessa \n.
    if (text.slice(open + 1, close).includes('\n')) {
      i = open + 1;
      continue;
    }
    return { type: 'code', start: open, end: close + 1, content: text.slice(open + 1, close) };
  }
  return null;
}

function findUrl(text: string, from: number): ScanHit | null {
  const slice = text.slice(from);
  const m = slice.match(URL_REGEX);
  if (!m || m.index === undefined) return null;
  const start = from + m.index;
  return { type: 'url', start, end: start + m[0].length, content: m[0] };
}

/**
 * Escolhe o próximo formato a aplicar a partir de `from`. Retorna o hit com
 * menor `start` entre todos os candidatos. Code blocks/inline têm
 * precedência implícita por aparecerem antes na ordem de comparação quando
 * empatam em posição.
 */
function nextHit(text: string, from: number): ScanHit | null {
  const candidates: Array<ScanHit | null> = [
    findCodeBlock(text, from),
    findInlineCode(text, from),
    findUrl(text, from),
    findInlineMarker(text, from, '*', 'bold'),
    findInlineMarker(text, from, '_', 'italic'),
    findInlineMarker(text, from, '~', 'strike'),
  ];
  let best: ScanHit | null = null;
  for (const c of candidates) {
    if (c && (!best || c.start < best.start)) best = c;
  }
  return best;
}

function normalizeUrl(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function renderHit(hit: ScanHit, key: number): React.ReactNode {
  switch (hit.type) {
    case 'pre':
      return (
        <code
          key={key}
          className="block my-1 px-2 py-1 rounded bg-black/10 dark:bg-white/10 font-mono text-[0.85em] whitespace-pre-wrap break-words"
        >
          {hit.content}
        </code>
      );
    case 'code':
      return (
        <code key={key} className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 font-mono text-[0.85em]">
          {hit.content}
        </code>
      );
    case 'url':
      return (
        <a
          key={key}
          href={normalizeUrl(hit.content)}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 break-all text-blue-600 dark:text-blue-300 hover:opacity-80"
        >
          {hit.content}
        </a>
      );
    case 'bold':
      return (
        <strong key={key} className="font-semibold">
          {formatWhatsAppText(hit.content, key * 100)}
        </strong>
      );
    case 'italic':
      return (
        <em key={key}>
          {formatWhatsAppText(hit.content, key * 100)}
        </em>
      );
    case 'strike':
      return (
        <s key={key}>
          {formatWhatsAppText(hit.content, key * 100)}
        </s>
      );
  }
}

/**
 * Retorna o texto formatado como árvore de ReactNode. Sempre seguro — não
 * usa dangerouslySetInnerHTML; conteúdo de usuário fica em text nodes.
 *
 * @param text mensagem crua, possivelmente com \n e markers WhatsApp.
 * @param baseKey offset de key pra garantir unicidade em chamadas recursivas
 *                (bold dentro de bold renderiza com keys distintas).
 */
export function formatWhatsAppText(text: string, baseKey = 0): React.ReactNode {
  if (!text) return null;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let keyCounter = baseKey;

  while (cursor < text.length) {
    const hit = nextHit(text, cursor);
    if (!hit) {
      nodes.push(text.slice(cursor));
      break;
    }
    if (hit.start > cursor) {
      nodes.push(text.slice(cursor, hit.start));
    }
    nodes.push(renderHit(hit, ++keyCounter));
    cursor = hit.end;
  }

  return nodes;
}
