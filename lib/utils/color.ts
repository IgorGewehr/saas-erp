/**
 * lib/utils/color.ts
 *
 * Utilities pra manipular cores hex em runtime. Usado por badges com cor
 * configurada pelo tenant (estágios do pipeline, setores, tags, etc.) que
 * precisam manter legibilidade em ambos os temas (light/dark) sem que o
 * admin precise cadastrar 2 paletas.
 *
 * Princípio: preservar a matiz (identidade visual) e ajustar só
 * luminância pra atingir contraste mínimo aceitável (WCAG AA ~4.5:1
 * pra texto normal).
 *
 * Não tem dependência de React — pode ser chamada em qualquer contexto
 * (server, worker, etc).
 */

/** Normaliza string hex pra formato 6-char sem '#' (ex: '166534'). */
function normalizeHex(hex: string): string {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h.split('').map(c => c + c).join('');
  }
  // Strip alpha se presente (cor + opacity em 8 chars).
  if (h.length === 8) h = h.slice(0, 6);
  return h.toLowerCase();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = normalizeHex(hex);
  if (!/^[0-9a-f]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return '#' + [clamp(r), clamp(g), clamp(b)]
    .map(v => v.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Luminância relativa WCAG (0 a 1). Cor preta = 0, branca = 1.
 * Fórmula oficial: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/**
 * Mistura cor com branco (lighten) ou preto (darken). amount em 0..1.
 * Operação no espaço RGB linear — suficiente pra badges, não pra
 * processamento de imagem (que exigiria HSL ou Lab).
 */
function mix(hex: string, target: { r: number; g: number; b: number }, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const t = Math.max(0, Math.min(1, amount));
  return rgbToHex(
    rgb.r + (target.r - rgb.r) * t,
    rgb.g + (target.g - rgb.g) * t,
    rgb.b + (target.b - rgb.b) * t,
  );
}

export function lighten(hex: string, amount: number): string {
  return mix(hex, { r: 255, g: 255, b: 255 }, amount);
}

export function darken(hex: string, amount: number): string {
  return mix(hex, { r: 0, g: 0, b: 0 }, amount);
}

/**
 * Retorna a cor original ou uma variante claro/escuro pra atingir
 * contraste mínimo aceitável contra o fundo do tema atual.
 *
 * - Em DARK mode (fundo escuro slate-900 ~lum 0.012): cores com
 *   lum < 0.18 são clareadas. Aproxima contrast ratio WCAG AA (4.5:1)
 *   pra texto pequeno. Threshold empírico: pega greens/reds escuros
 *   tipo #166534 (Ganho lum 0.12) e #991B1B (Perdido lum 0.10), mas
 *   passa azuis médios tipo #3B82F6 (Novo lum 0.29).
 * - Em LIGHT mode (fundo branco): cores com lum > 0.75 são escurecidas.
 *
 * Stages com cores médias passam direto sem ajuste — preserva a
 * identidade visual escolhida pelo admin.
 */
export function pickReadableTextColor(hex: string, isDark: boolean): string {
  const lum = relativeLuminance(hex);
  if (isDark && lum < 0.18) {
    // Lighten ~0.45 leva Ganho (0.12) e Perdido (0.10) pra ~0.5 lum,
    // contraste seguro sobre slate-900.
    return lighten(hex, 0.5);
  }
  if (!isDark && lum > 0.75) {
    return darken(hex, 0.4);
  }
  return hex;
}
