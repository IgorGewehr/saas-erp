/**
 * Tiny markdown renderer for agent responses.
 */

import React from 'react';

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
      nodes.push(<strong key={key} className="font-semibold text-gray-900 dark:text-gray-100">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code key={key} className="px-1 py-0.5 rounded bg-gray-200/70 dark:bg-gray-700/60 text-[0.85em] font-mono">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('*') && token.endsWith('*') && !token.startsWith('**')) {
      nodes.push(<em key={key} className="italic opacity-80">{token.slice(1, -1)}</em>);
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

type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] };

const BULLET_RE = /^\s*[-*]\s+(.+)$/;
const NUMBERED_RE = /^\s*\d+\.\s+(.+)$/;

function parseBlocks(source: string): Block[] {
  // Deduplica linhas consecutivas idênticas (artifact do agent retornar texto 2x)
  const rawLines = source.replace(/\r\n/g, '\n').split('\n');
  const lines: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trimEnd();
    if (i > 0 && line !== '' && line === lines[lines.length - 1]) continue;
    lines.push(line);
  }

  const blocks: Block[] = [];
  let buf: string[] = [];
  let listBuf: string[] = [];
  let listKind: 'ul' | 'ol' | null = null;

  const flushParagraph = () => {
    if (buf.length) { blocks.push({ kind: 'paragraph', lines: buf }); buf = []; }
  };
  const flushList = () => {
    if (listBuf.length && listKind) { blocks.push({ kind: listKind, items: listBuf }); listBuf = []; listKind = null; }
  };

  for (const line of lines) {
    if (line === '') { flushParagraph(); flushList(); continue; }
    const bullet = BULLET_RE.exec(line);
    const numbered = NUMBERED_RE.exec(line);
    if (bullet) {
      flushParagraph();
      if (listKind && listKind !== 'ul') flushList();
      listKind = 'ul'; listBuf.push(bullet[1]); continue;
    }
    if (numbered) {
      flushParagraph();
      if (listKind && listKind !== 'ol') flushList();
      listKind = 'ol'; listBuf.push(numbered[1]); continue;
    }
    flushList(); buf.push(line);
  }
  flushParagraph(); flushList();

  // Deduplica blocos de parágrafo idênticos consecutivos
  return blocks.filter((block, i) => {
    if (i === 0) return true;
    const prev = blocks[i - 1];
    if (block.kind !== prev.kind) return true;
    if (block.kind === 'paragraph' && prev.kind === 'paragraph')
      return block.lines.join('\n') !== prev.lines.join('\n');
    if ((block.kind === 'ul' || block.kind === 'ol') && (prev.kind === 'ul' || prev.kind === 'ol'))
      return block.items.join('\n') !== prev.items.join('\n');
    return true;
  });
}

export function RenderMarkdown({ source }: { source: string }) {
  if (!source) return null;
  const blocks = parseBlocks(source);

  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed">
      {blocks.map((block, i) => {
        if (block.kind === 'paragraph') {
          return (
            <p key={i} className="text-inherit">
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
            <ul key={i} className="space-y-0.5">
              {block.items.map((item, j) => (
                <li key={j} className="flex items-start gap-2">
                  <span className="mt-[0.5em] w-1 h-1 rounded-full bg-current opacity-40 flex-shrink-0" />
                  <span>{renderInline(item, `ul${i}-${j}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <ol key={i} className="space-y-0.5">
            {block.items.map((item, j) => (
              <li key={j} className="flex items-start gap-2">
                <span className="mt-0 w-4 text-right text-[11px] font-semibold opacity-40 flex-shrink-0 tabular-nums leading-relaxed">{j + 1}.</span>
                <span>{renderInline(item, `ol${i}-${j}`)}</span>
              </li>
            ))}
          </ol>
        );
      })}
    </div>
  );
}
