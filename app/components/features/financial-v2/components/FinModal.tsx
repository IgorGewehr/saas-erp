'use client';

/**
 * FinModal — a moldura `.modal-backdrop`/`.modal` do mockup, compartilhada por
 * BaixaDialog e LancarSheet (evita duplicar chrome de portal/scroll-lock/Esc
 * duas vezes — só o conteúdo muda por dialog). Mesmo padrão de portal do
 * `RecurrenceDetailDialog` clássico (createPortal + lock de scroll no body),
 * reimplementado aqui porque o financial-v2 é aditivo (CLAUDE.md R-aditivo:
 * nunca importa do módulo `financial/` antigo).
 */

import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FinModalProps {
  open: boolean;
  onClose: () => void;
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  maxWidthClassName?: string;
}

export function FinModal({ open, onClose, eyebrow, title, description, children, footer, maxWidthClassName }: FinModalProps) {
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => setPortalReady(true), []);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!portalReady) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            className={cn(
              'relative w-full rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl',
              maxWidthClassName ?? 'max-w-[440px]',
            )}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <button
              onClick={onClose}
              aria-label="Fechar"
              className="absolute top-3.5 right-3.5 w-7 h-7 rounded-lg grid place-items-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="px-5 pt-4.5 pb-1">
              <div className="fin-eyebrow text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold mb-1">
                {eyebrow}
              </div>
              <h3 className="text-[17px] font-bold tracking-tight text-gray-900 dark:text-gray-50 pr-6">{title}</h3>
              {description && <p className="mt-1.5 text-[13px] text-gray-500 dark:text-gray-400 leading-relaxed">{description}</p>}
            </div>
            <div className="px-5 py-4 flex flex-col gap-3.5 max-h-[60vh] overflow-y-auto">{children}</div>
            <div className="px-5 pb-5 pt-1 flex gap-2.5 justify-end">{footer}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function FinModalButton({
  variant = 'default',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' }) {
  return (
    <button
      {...props}
      className={cn(
        'px-3.5 py-2 rounded-[9px] text-[13px] font-semibold transition-colors disabled:opacity-45 disabled:cursor-not-allowed',
        variant === 'primary'
          ? 'bg-[hsl(var(--fin-primary))] text-white hover:brightness-[1.06]'
          : 'border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800',
        className,
      )}
    />
  );
}
