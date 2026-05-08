'use client';

import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Button } from '@mui/material';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { dialogPaperSx, dialogContentSx, dialogBackdropSx } from './styles';

/**
 * Dialog moderno padronizado do sistema.
 *
 * Header tem barra vermelha no topo, ícone em quadrado vermelho (esquerda),
 * título display bold + badges/subtitle opcionais, botão X de fechar (direita).
 *
 * O conteúdo (children) já recebe o estilo elevado em todos os MUI
 * TextField/Select/FormControl via dialogContentSx.
 *
 * Footer é livre — passe `footer` prop com um <ModernDialogActions /> pré-feito,
 * ou qualquer nó React. Omita para dialog sem footer.
 */
export function ModernDialog({
  open,
  onClose,
  icon: Icon,
  title,
  badges,
  subtitle,
  maxWidth = 'md',
  fullWidth = true,
  children,
  footer,
  contentPadding = 'default',
}: {
  open: boolean;
  onClose: () => void;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  title: string;
  /** Conteúdo livre ao lado direito do título (ex: pill de status). */
  badges?: React.ReactNode;
  /** Conteúdo livre abaixo do título — geralmente uma row de pills. */
  subtitle?: React.ReactNode;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  fullWidth?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** 'default' = px-6 py-5 space-y-5; 'tight' = px-4 sm:px-6 py-4 space-y-4. */
  contentPadding?: 'default' | 'tight';
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      PaperProps={{ sx: dialogPaperSx }}
      BackdropProps={{ sx: dialogBackdropSx }}
    >
      <DialogTitle sx={{ p: 0 }}>
        <div className="relative overflow-hidden bg-white dark:bg-slate-950 border-b border-slate-200/80 dark:border-slate-800">
          <div className="h-1 bg-red-600" />
          <div className="px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4 min-w-0">
                <div className="hidden sm:flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400">
                  <Icon size={22} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display text-2xl font-bold text-slate-950 dark:text-slate-50">
                      {title}
                    </h3>
                    {badges}
                  </div>
                  {subtitle && (
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      {subtitle}
                    </div>
                  )}
                </div>
              </div>
              <IconButton
                onClick={onClose}
                size="small"
                sx={{
                  color: 'rgb(100 116 139)',
                  border: '1px solid rgba(148,163,184,0.22)',
                  borderRadius: '12px',
                  '&:hover': { bgcolor: 'rgba(148,163,184,0.10)' },
                }}
                aria-label="Fechar"
              >
                <X size={16} />
              </IconButton>
            </div>
          </div>
        </div>
      </DialogTitle>
      <DialogContent sx={dialogContentSx}>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className={cn(
            contentPadding === 'tight'
              ? 'px-4 sm:px-6 py-4 space-y-4'
              : 'px-4 sm:px-6 py-5 space-y-5',
          )}
        >
          {children}
        </motion.div>
      </DialogContent>
      {footer && (
        <DialogActions sx={{ p: 0, bgcolor: 'transparent' }}>
          {footer}
        </DialogActions>
      )}
    </Dialog>
  );
}

/**
 * Footer padronizado do dialog. Suporta uma área de status à esquerda
 * (geralmente uma pill + texto pequeno) e botões de ação à direita.
 *
 * Use ModernCancelButton e ModernPrimaryButton para os botões padrão.
 */
export function ModernDialogActions({
  status,
  children,
}: {
  status?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full border-t border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 px-4 sm:px-6 py-4">
      <div className="flex items-center justify-between gap-3">
        {status ? (
          <div className="hidden sm:flex items-center gap-2 min-w-0 text-xs text-slate-500 dark:text-slate-400">
            {status}
          </div>
        ) : (
          <div className="hidden sm:block" />
        )}
        <div className="flex items-center justify-end gap-2 w-full sm:w-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Botão "Cancelar" — visual texto vermelho discreto. */
export function ModernCancelButton({
  onClick,
  children = 'Cancelar',
}: {
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Button
      onClick={onClick}
      sx={{
        borderRadius: '14px',
        px: 2.25,
        color: 'rgb(220 38 38)',
        textTransform: 'none',
        fontWeight: 700,
        '&:hover': { bgcolor: 'rgba(220,38,38,0.08)' },
      }}
    >
      {children}
    </Button>
  );
}

/** Botão primário — preenchido vermelho com sombra. */
export function ModernPrimaryButton({
  onClick,
  disabled,
  startIcon,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  startIcon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Button
      onClick={onClick}
      variant="contained"
      disabled={disabled}
      startIcon={startIcon}
      sx={{
        borderRadius: '14px',
        px: 2.75,
        minHeight: 44,
        bgcolor: '#DC2626',
        textTransform: 'none',
        fontWeight: 800,
        boxShadow: '0 14px 30px rgba(220,38,38,0.28)',
        '&:hover': { bgcolor: '#B91C1C', boxShadow: '0 16px 34px rgba(185,28,28,0.32)' },
        '&.Mui-disabled': {
          bgcolor: 'rgba(100,116,139,0.22)',
          color: 'rgba(148,163,184,0.70)',
          boxShadow: 'none',
        },
      }}
    >
      {children}
    </Button>
  );
}
