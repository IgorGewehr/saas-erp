'use client';

/**
 * EmailBodyEditor — editor rich-text simples para o corpo de campanhas de email.
 *
 * Decisão arquitetural: NÃO importa biblioteca externa (Tiptap, Quill, etc.) para
 * manter o bundle leve. Usa contenteditable + document.execCommand (deprecated mas
 * universalmente suportado nos navegadores modernos) com uma toolbar mínima.
 *
 * Recursos:
 *  - Negrito, itálico, sublinhado
 *  - Lista ordenada / não-ordenada
 *  - Inserir / remover link
 *  - Limpar formatação
 *  - Toggle visual ↔ código HTML
 *
 * Output: HTML sanitizado via allowlist (tags permitidas: p, br, b, strong, i, em,
 * u, ul, ol, li, a). Atributos: apenas href em <a> (com normalização para http/https/mailto).
 *
 * Props:
 *  - value: HTML inicial / controlado
 *  - onChange: callback chamado a cada edição com o HTML sanitizado
 *  - placeholder: texto exibido quando vazio
 *  - minRows: altura mínima em linhas (default 8)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bold, Italic, Underline, List, ListOrdered, Link as LinkIcon, Eraser, Code } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minRows?: number;
  className?: string;
}

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'A', 'DIV', 'SPAN',
]);

/**
 * Sanitiza HTML usando allowlist. Remove tags não permitidas (preservando texto),
 * limpa atributos inseguros e normaliza href.
 */
function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined' || !html) return html || '';
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return '';

  const walk = (node: Node) => {
    // Itera de trás pra frente porque vamos remover/substituir
    const children = Array.from(node.childNodes);
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        const tag = el.tagName;
        if (!ALLOWED_TAGS.has(tag)) {
          // Substitui tag não permitida pelo seu textContent
          const replacement = doc.createTextNode(el.textContent || '');
          el.parentNode?.replaceChild(replacement, el);
          continue;
        }
        // Remove TODOS os atributos exceto href em <A>
        const attrs = Array.from(el.attributes);
        for (const attr of attrs) {
          const name = attr.name.toLowerCase();
          if (tag === 'A' && name === 'href') {
            // Normaliza protocolo: aceita http(s), mailto, tel; default para https://
            let href = attr.value.trim();
            if (!/^(https?:|mailto:|tel:)/i.test(href)) {
              if (/^[\w.-]+@[\w.-]+\.\w+$/.test(href)) href = `mailto:${href}`;
              else if (href.startsWith('//')) href = `https:${href}`;
              else if (href.length > 0 && !href.startsWith('#')) href = `https://${href}`;
            }
            el.setAttribute('href', href);
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
          } else {
            el.removeAttribute(attr.name);
          }
        }
        walk(el);
      } else if (child.nodeType !== Node.TEXT_NODE) {
        // Comentários, CDATA etc — remove
        child.parentNode?.removeChild(child);
      }
    }
  };

  walk(root);
  return root.innerHTML;
}

/**
 * Extrai texto puro do HTML (para preview de comprimento).
 */
function htmlToText(html: string): string {
  if (typeof window === 'undefined') return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent || '').trim();
}

export default function EmailBodyEditor({ value, onChange, placeholder, minRows = 8, className }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showSource, setShowSource] = useState(false);
  const [sourceHtml, setSourceHtml] = useState(value || '');
  // Atualiza o conteúdo do editor quando `value` muda externamente E o editor não está focado.
  // Sem isso, digitar no contenteditable causa cursor jumps porque o React resetaria o innerHTML.
  useEffect(() => {
    if (!editorRef.current) return;
    if (document.activeElement === editorRef.current) return;
    if (editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || '';
    }
  }, [value]);

  // Mantém sourceHtml sincronizado com value quando aba code é aberta
  useEffect(() => {
    if (showSource) setSourceHtml(value || '');
  }, [showSource, value]);

  const exec = useCallback((command: string, arg?: string) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    // execCommand é deprecated mas ainda é a forma mais simples de manipular
    // formatação inline em contenteditable. Nenhum browser tem plano público de remoção.
    document.execCommand(command, false, arg);
    // Trigger sync após um tick — alguns navegadores aplicam o command async
    setTimeout(() => {
      if (editorRef.current) {
        onChange(sanitizeHtml(editorRef.current.innerHTML));
      }
    }, 0);
  }, [onChange]);

  const handleInput = useCallback(() => {
    if (!editorRef.current) return;
    onChange(sanitizeHtml(editorRef.current.innerHTML));
  }, [onChange]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    // Prevê paste sujo (rich text de Word, Google Docs, etc.) → cola como texto puro,
    // a não ser que seja HTML simples já dentro do allowlist.
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const toInsert = html ? sanitizeHtml(html) : text.replace(/\n/g, '<br>');
    document.execCommand('insertHTML', false, toInsert);
  }, []);

  const handleLink = useCallback(() => {
    const url = prompt('Cole a URL (https://exemplo.com ou email@exemplo.com):');
    if (!url) return;
    const trimmed = url.trim();
    if (!trimmed) return;
    exec('createLink', trimmed);
  }, [exec]);

  const handleClearFormat = useCallback(() => {
    exec('removeFormat');
    exec('unlink');
  }, [exec]);

  const handleApplySource = useCallback(() => {
    const cleaned = sanitizeHtml(sourceHtml);
    onChange(cleaned);
    if (editorRef.current) editorRef.current.innerHTML = cleaned;
    setShowSource(false);
  }, [sourceHtml, onChange]);

  const charCount = useMemo(() => htmlToText(value || '').length, [value]);
  const isEmpty = !value || htmlToText(value).length === 0;

  return (
    <div className={cn('rounded-xl border border-gray-300 dark:border-gray-700 overflow-hidden', className)}>
      <div className="flex items-center gap-0.5 flex-wrap border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 px-2 py-1.5">
        <ToolbarBtn onClick={() => exec('bold')} title="Negrito (Ctrl+B)"><Bold size={15} /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec('italic')} title="Itálico (Ctrl+I)"><Italic size={15} /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec('underline')} title="Sublinhado (Ctrl+U)"><Underline size={15} /></ToolbarBtn>
        <Divider />
        <ToolbarBtn onClick={() => exec('insertUnorderedList')} title="Lista"><List size={15} /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec('insertOrderedList')} title="Lista numerada"><ListOrdered size={15} /></ToolbarBtn>
        <Divider />
        <ToolbarBtn onClick={handleLink} title="Inserir link"><LinkIcon size={15} /></ToolbarBtn>
        <ToolbarBtn onClick={handleClearFormat} title="Limpar formatação"><Eraser size={15} /></ToolbarBtn>
        <Divider />
        <ToolbarBtn
          onClick={() => setShowSource(s => !s)}
          title="Ver código HTML"
          active={showSource}
        >
          <Code size={15} />
        </ToolbarBtn>
        <div className="ml-auto text-[11px] text-gray-400 pr-1">
          {charCount} {charCount === 1 ? 'caractere' : 'caracteres'}
        </div>
      </div>

      {showSource ? (
        <div className="p-3 space-y-2 bg-gray-50 dark:bg-gray-900/30">
          <textarea
            value={sourceHtml}
            onChange={(e) => setSourceHtml(e.target.value)}
            className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-red-500"
            rows={Math.max(minRows, 6)}
            spellCheck={false}
          />
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setSourceHtml(value || ''); setShowSource(false); }}
              className="px-3 py-1 text-[11px] font-semibold rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleApplySource}
              className="px-3 py-1 text-[11px] font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
            >
              Aplicar
            </button>
          </div>
        </div>
      ) : (
        <div className="relative">
          {isEmpty && placeholder && (
            <div className="absolute top-3 left-3 text-sm text-gray-400 dark:text-gray-500 pointer-events-none">
              {placeholder}
            </div>
          )}
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={handleInput}
            onPaste={handlePaste}
            className={cn(
              'px-3 py-3 text-sm text-gray-900 dark:text-gray-100 focus:outline-none',
              'prose prose-sm dark:prose-invert max-w-none',
              '[&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6',
              '[&_a]:text-red-600 [&_a]:underline dark:[&_a]:text-red-400',
            )}
            style={{ minHeight: `${minRows * 1.5}em` }}
          />
        </div>
      )}
    </div>
  );
}

function ToolbarBtn({ onClick, title, active, children }: {
  onClick: () => void;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault() /* não tira foco do editor */}
      onClick={onClick}
      title={title}
      className={cn(
        'p-1.5 rounded-lg transition-colors',
        active
          ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400'
          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700/60'
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-0.5" />;
}
