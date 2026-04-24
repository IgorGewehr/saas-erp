/**
 * Tiny markdown renderer for agent responses.
 *
 * Intentionally NOT full CommonMark — we control the agent's prompt so the
 * output subset is predictable. Supports:
 *   - **bold**, *italic*, `code`
 *   - bullet lists (- item or * item at line start)
 *   - numbered lists (1. item)
 *   - paragraphs (blank line = <p>)
 *   - line breaks (single newline = <br/>)
 *   - auto-linked URLs
 *
 * Zero dependencies. Output: array of React elements.
 */

import React from 'react';

// ─── Inline parsing (bold / italic / code / links) ───────────────────────────

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|https?:\/\/\S+)/g;

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > lastIdx) nodes.push(text.slice(lastIdx, m.index));
    const token = m[0];
    const key = `${keyBase}-${m.index}`;

    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(<strong key={key} className="font-semibold">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code key={key} className="px-1 py-0.5 rounded bg-gray-200/70 dark:bg-gray-700/60 text-[0.9em] font-mono">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('*') && token.endsWith('*') && !token.startsWith('**')) {
      nodes.push(<em key={key} className="italic">{token.slice(1, -1)}</em>);
    } else if (token.startsWith('http')) {
      nodes.push(
        <a key={key} href={token} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-red-600 dark:hover:text-red-400">
          {token}
        </a>,
      );
    } else {
      nodes.push(token);
    }
    lastIdx = m.index + token.length;
  }

  if (lastIdx < text.length) nodes.push(text.slice(lastIdx));
  return nodes;
}

// ─── Block parsing ───────────────────────────────────────────────────────────

type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] };

const BULLET_RE = /^\s*[-*]\s+(.+)$/;
const NUMBERED_RE = /^\s*\d+\.\s+(.+)$/;

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let buf: string[] = [];
  let listBuf: string[] = [];
  let listKind: 'ul' | 'ol' | null = null;

  const flushParagraph = () => {
    if (buf.length) {
      blocks.push({ kind: 'paragraph', lines: buf });
      buf = [];
    }
  };
  const flushList = () => {
    if (listBuf.length && listKind) {
      blocks.push({ kind: listKind, items: listBuf });
      listBuf = [];
      listKind = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const bullet = BULLET_RE.exec(line);
    const numbered = NUMBERED_RE.exec(line);

    if (line === '') {
      flushParagraph();
      flushList();
      continue;
    }

    if (bullet) {
      flushParagraph();
      if (listKind && listKind !== 'ul') flushList();
      listKind = 'ul';
      listBuf.push(bullet[1]);
      continue;
    }

    if (numbered) {
      flushParagraph();
      if (listKind && listKind !== 'ol') flushList();
      listKind = 'ol';
      listBuf.push(numbered[1]);
      continue;
    }

    // regular line — belongs to current paragraph
    flushList();
    buf.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

// ─── Public render ───────────────────────────────────────────────────────────

export function RenderMarkdown({ source }: { source: string }) {
  if (!source) return null;
  const blocks = parseBlocks(source);

  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        if (block.kind === 'paragraph') {
          // Join lines of a paragraph, but preserve single \n as <br/>
          return (
            <p key={i} className="leading-relaxed">
              {block.lines.map((ln, j) => (
                <React.Fragment key={j}>
                  {renderInline(ln, `p${i}-${j}`)}
                  {j < block.lines.length - 1 && <br />}
                </React.Fragment>
              ))}
            </p>
          );
        }
        if (block.kind === 'ul') {
          return (
            <ul key={i} className="list-disc list-outside ml-4 space-y-0.5">
              {block.items.map((item, j) => (
                <li key={j} className="leading-relaxed">{renderInline(item, `ul${i}-${j}`)}</li>
              ))}
            </ul>
          );
        }
        return (
          <ol key={i} className="list-decimal list-outside ml-4 space-y-0.5">
            {block.items.map((item, j) => (
              <li key={j} className="leading-relaxed">{renderInline(item, `ol${i}-${j}`)}</li>
            ))}
          </ol>
        );
      })}
    </div>
  );
}
