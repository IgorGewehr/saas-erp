/**
 * Estilos compartilhados pelos dialogs modernos do sistema.
 * Aplica visual elevado (rounded 14px, focus ring vermelho 4px,
 * fontSize 14, helper text 11) em todo MUI TextField/Select/FormControl
 * dentro do DialogContent.
 *
 * Uso: passe `dialogPaperSx` em PaperProps.sx e `dialogContentSx` em
 * DialogContent.sx do MUI Dialog. Funciona automaticamente em dark mode
 * via `.dark &` selector (classe na <html>).
 */
import type { SxProps, Theme } from '@mui/material';

export const dialogPaperSx: SxProps<Theme> = {
  borderRadius: '28px',
  overflow: 'hidden',
  bgcolor: 'transparent',
  boxShadow: '0 28px 90px rgba(2, 6, 23, 0.45)',
  maxHeight: 'calc(100vh - 32px)',
};

export const dialogBackdropSx = {
  backdropFilter: 'blur(10px)',
  backgroundColor: 'rgba(2, 6, 23, 0.72)',
};

export const dialogContentSx: SxProps<Theme> = {
  p: 0,
  bgcolor: 'rgb(248 250 252)',
  color: 'rgb(15 23 42)',
  '.dark &': {
    bgcolor: 'rgb(9 15 27)',
    color: 'rgb(241 245 249)',
  },
  '& .MuiTextField-root, & .MuiFormControl-root': {
    '& .MuiInputLabel-root': {
      color: 'rgb(100 116 139)',
      fontWeight: 700,
      fontSize: 13,
    },
    '& .MuiInputLabel-root.Mui-focused': {
      color: 'rgb(220 38 38)',
    },
    '& .MuiOutlinedInput-root': {
      minHeight: 46,
      borderRadius: '14px',
      backgroundColor: 'rgba(255,255,255,0.86)',
      color: 'rgb(15 23 42)',
      transition: 'box-shadow 160ms ease, border-color 160ms ease, background-color 160ms ease',
      '& fieldset': {
        borderColor: 'rgba(148,163,184,0.32)',
      },
      '&:hover fieldset': {
        borderColor: 'rgba(220,38,38,0.45)',
      },
      '&.Mui-focused': {
        boxShadow: '0 0 0 4px rgba(220,38,38,0.10)',
        backgroundColor: 'rgba(255,255,255,0.98)',
      },
      '&.Mui-focused fieldset': {
        borderColor: 'rgb(220 38 38)',
        borderWidth: 1,
      },
      '& input, & textarea': {
        fontSize: 14,
      },
    },
    '& .MuiFormHelperText-root': {
      marginLeft: 0,
      color: 'rgb(100 116 139)',
      fontSize: 11,
    },
    '& .MuiSelect-icon': {
      color: 'rgb(100 116 139)',
    },
  },
  '& .MuiButton-root': {
    textTransform: 'none',
    fontWeight: 800,
  },
  '.dark & .MuiTextField-root, .dark & .MuiFormControl-root': {
    '& .MuiInputLabel-root': {
      color: 'rgb(148 163 184)',
    },
    '& .MuiOutlinedInput-root': {
      backgroundColor: 'rgba(15,23,42,0.72)',
      color: 'rgb(241 245 249)',
      '& fieldset': {
        borderColor: 'rgba(148,163,184,0.22)',
      },
      '&:hover fieldset': {
        borderColor: 'rgba(248,113,113,0.48)',
      },
      '&.Mui-focused': {
        backgroundColor: 'rgba(15,23,42,0.92)',
        boxShadow: '0 0 0 4px rgba(248,113,113,0.12)',
      },
      '&.Mui-focused fieldset': {
        borderColor: 'rgb(248 113 113)',
      },
    },
    '& .MuiFormHelperText-root': {
      color: 'rgb(148 163 184)',
    },
    '& .MuiSelect-icon': {
      color: 'rgb(148 163 184)',
    },
  },
};
