/**
 * lib/pdf/pdfText.ts
 *
 * As fontes padrão do PDF (Helvetica) só cobrem Latin-1: acentos do português passam, mas emoji,
 * aspas tipográficas e travessões viram lixo. Antes de desenhar, normaliza o texto — mantém tudo o
 * que é Latin-1 e troca/descarta o resto. Também troca o espaço "não quebrável" da moeda
 * (`R$ 1.500,00` do Intl) por espaço normal.
 */

const REPLACEMENTS: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '•': '*',
  '…': '...',
  '€': 'EUR',
  ' ': ' ',
  ' ': ' ',
};

export function toPdfText(text: string): string {
  let result = '';
  for (const char of text.normalize('NFC')) {
    const replacement = REPLACEMENTS[char];
    if (replacement !== undefined) {
      result += replacement;
    } else if (char === '\n' || (char >= ' ' && char <= '~') || (char >= '¡' && char <= 'ÿ')) {
      result += char;
    }
    // Resto (emoji, CJK, caracteres de controle): descartado.
  }
  return result.replace(/[ \t]{2,}/g, ' ').trim();
}
