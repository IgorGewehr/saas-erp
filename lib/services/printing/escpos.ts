/**
 * lib/services/printing/escpos.ts
 *
 * Encoder ESC/POS mínimo e PURO (sem SDK, sem DOM) para impressoras térmicas de
 * cupom/comanda. Acumula bytes num builder e devolve um Uint8Array pronto pra
 * `USBDevice.transferOut` (WebUSB) ou qualquer transporte raw.
 *
 * Codepage: texto é codificado em CP850 (PC-850 Multilíngue) — o mais amplamente
 * suportado por impressoras Epson-compatíveis para PT-BR (acentos/ç). O comando
 * `ESC t 2` seleciona CP850 no início; caracteres fora do mapa viram '?'.
 *
 * Larguras: 80mm ≈ 48 colunas (Fonte A 12×24), 58mm ≈ 32 colunas. Quem monta o
 * conteúdo (comandaEscpos.ts) passa a largura em colunas para alinhar/centralizar.
 */

// ── Bytes de controle ─────────────────────────────────────────────────────────
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/**
 * Mapa Unicode→CP850 para o subconjunto PT-BR + símbolos comuns. ASCII (<0x80)
 * passa direto. Fora do mapa → '?' (0x3f). Valores conferidos contra a tabela
 * IBM-850.
 */
const CP850: Record<string, number> = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'å': 0x86,
  'ç': 0x87, 'ê': 0x88, 'ë': 0x89, 'è': 0x8a, 'ï': 0x8b, 'î': 0x8c, 'ì': 0x8d,
  'Ä': 0x8e, 'Å': 0x8f, 'É': 0x90, 'æ': 0x91, 'Æ': 0x92, 'ô': 0x93, 'ö': 0x94,
  'ò': 0x95, 'û': 0x96, 'ù': 0x97, 'ÿ': 0x98, 'Ö': 0x99, 'Ü': 0x9a, 'ø': 0x9b,
  '£': 0x9c, 'Ø': 0x9d, '×': 0x9e, 'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3,
  'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7, '®': 0xa9, '¬': 0xaa, '½': 0xab,
  '¼': 0xac, '¡': 0xad, '«': 0xae, '»': 0xaf, 'Á': 0xb5, 'Â': 0xb6, 'À': 0xb7,
  '©': 0xb8, '¢': 0xbd, '¥': 0xbe, 'ã': 0xc6, 'Ã': 0xc7, '¤': 0xcf, 'ð': 0xd0,
  'Ê': 0xd2, 'Ë': 0xd3, 'È': 0xd4, 'Í': 0xd6, 'Î': 0xd7, 'Ï': 0xd8, 'Ó': 0xe0,
  'ß': 0xe1, 'Ô': 0xe2, 'Ò': 0xe3, 'õ': 0xe4, 'Õ': 0xe5, 'µ': 0xe6, 'þ': 0xe7,
  'Ú': 0xe9, 'Û': 0xea, 'Ù': 0xeb, 'ý': 0xec, 'Ý': 0xed, '°': 0xf8, '·': 0xfa,
  '²': 0xfd, ' ': 0x20, // NBSP → espaço
};

function encodeCp850(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) {
      out.push(code); // ASCII direto
    } else if (CP850[ch] !== undefined) {
      out.push(CP850[ch]);
    } else {
      out.push(0x3f); // '?'
    }
  }
  return out;
}

export type Align = 'left' | 'center' | 'right';

/**
 * Builder fluente de comandos ESC/POS. Cada método muta o estado e devolve `this`.
 * `build()` fecha com bytes finais e devolve o Uint8Array.
 */
export class EscPosBuilder {
  private bytes: number[] = [];

  /** `ESC @` (reset) + seleciona CP850 (`ESC t 2`). Sempre chame primeiro. */
  init(): this {
    this.bytes.push(ESC, 0x40); // initialize
    this.bytes.push(ESC, 0x74, 2); // select codepage CP850
    return this;
  }

  align(a: Align): this {
    this.bytes.push(ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0);
    return this;
  }

  bold(on: boolean): this {
    this.bytes.push(ESC, 0x45, on ? 1 : 0);
    return this;
  }

  /**
   * `GS ! n` — tamanho de caractere. A magnificação é NIBBLE-encoded (diferente
   * de `ESC !`): largura = nibble ALTO (×2 = 0x10, ×3 = 0x20…), altura = nibble
   * BAIXO (×2 = 0x01). Então dobrar ambos = 0x11 (NÃO 0x30, que seria ×4 largura).
   */
  size(doubleWidth: boolean, doubleHeight: boolean): this {
    const n = (doubleWidth ? 0x10 : 0) | (doubleHeight ? 0x01 : 0);
    this.bytes.push(GS, 0x21, n);
    return this;
  }

  /** Texto SEM quebra de linha (codificado em CP850). */
  textRaw(text: string): this {
    this.bytes.push(...encodeCp850(text));
    return this;
  }

  /** Texto + LF. */
  line(text = ''): this {
    this.bytes.push(...encodeCp850(text), LF);
    return this;
  }

  /** N linhas em branco. */
  feed(n = 1): this {
    for (let i = 0; i < n; i++) this.bytes.push(LF);
    return this;
  }

  /** Régua de largura total (ex: '-' × colunas). */
  rule(cols: number, ch = '-'): this {
    return this.line(ch.repeat(Math.max(1, cols)));
  }

  /** Corte parcial com avanço (`GS V 66 n`). Alguns modelos ignoram — inócuo. */
  cut(): this {
    this.bytes.push(GS, 0x56, 66, 3);
    return this;
  }

  /** Pulso na gaveta (drawer kick) `ESC p m t1 t2` — opcional. */
  drawerKick(): this {
    this.bytes.push(ESC, 0x70, 0, 25, 250);
    return this;
  }

  build(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

/**
 * Justifica esquerda↔direita numa largura de colunas: `padLineLR('Total','R$ 10', 48)`
 * → 'Total' + espaços + 'R$ 10' ocupando exatamente `cols`. Trunca se estourar.
 */
export function padLineLR(left: string, right: string, cols: number): string {
  const space = cols - left.length - right.length;
  if (space >= 1) return left + ' '.repeat(space) + right;
  // Estourou: trunca a esquerda preservando a direita + 1 espaço.
  const keep = Math.max(0, cols - right.length - 1);
  return left.slice(0, keep) + ' ' + right;
}

/** Quebra `text` em linhas de no máximo `cols` colunas (word-wrap simples). */
export function wrap(text: string, cols: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (w.length > cols) {
      // Palavra maior que a linha: quebra dura.
      if (cur) { lines.push(cur); cur = ''; }
      for (let i = 0; i < w.length; i += cols) lines.push(w.slice(i, i + cols));
      continue;
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= cols) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}
