/**
 * Compressão client-side de imagens antes de upload pra Meta APIs.
 *
 * Por que: WhatsApp Cloud API limita imagens a 5MB. Smartphone moderno gera
 * 5-15MB facilmente (HDR/12MP+), gerando "arquivo muito grande" frustrante
 * pro operador. Compressão automática resolve sem perda visual perceptível
 * no contexto de chat (telas pequenas + visualização rápida).
 *
 * Estratégia:
 *   1. Redimensiona pra max 2048×2048 (suficiente pra qualquer tela de chat,
 *      reduz dramaticamente o tamanho da maior fonte de bytes).
 *   2. Re-encoda como JPEG quality 0.85 (sweet spot — perda visual mínima,
 *      30-50% do tamanho original).
 *   3. Se ainda exceder limite, baixa quality progressivamente (0.75/0.65/0.55).
 *   4. Falha explícita só se >limite mesmo em 0.55 (raro — imagem muito grande
 *      ou já comprimida ao máximo).
 *
 * Retorna File novo com mesma `name` (extensão trocada pra .jpg).
 */

export interface CompressImageOptions {
  /** Tamanho máximo aceitável em bytes. Default 5MB (limite Cloud API). */
  maxBytes?: number;
  /** Maior dimensão (largura ou altura) em pixels. Default 2048. */
  maxDimension?: number;
}

export async function compressImage(
  file: File,
  opts: CompressImageOptions = {},
): Promise<File> {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const maxDim = opts.maxDimension ?? 2048;

  // Não comprime se já cabe — economiza ciclos e preserva format/qualidade
  // original (importante pra screenshots/diagramas onde JPEG introduz ruído).
  if (file.size <= maxBytes) return file;

  if (typeof document === 'undefined') {
    throw new Error('Compressão de imagem só disponível no browser');
  }

  // Carrega via objectURL — funciona pra todos os formats que o browser
  // decodifica nativamente (jpeg/png/webp/gif/heic em Safari). Se decodificação
  // falhar (formato exótico), o erro propaga e o caller mostra toast.
  const objectUrl = URL.createObjectURL(file);
  let img: HTMLImageElement;
  try {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Falha ao decodificar imagem'));
      el.src = objectUrl;
    });
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    throw err;
  }

  // Calcula dimensão alvo mantendo aspect ratio. Se a imagem já é menor que
  // maxDim em ambos os eixos, mantém as dimensões originais (a redução de
  // tamanho vem só do re-encode JPEG abaixo).
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (w > maxDim || h > maxDim) {
    const ratio = Math.min(maxDim / w, maxDim / h);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    URL.revokeObjectURL(objectUrl);
    throw new Error('Canvas não disponível neste browser');
  }
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(objectUrl);

  // Loop de qualidade decrescente. Pra-quem-importa: começamos em 0.85 pq
  // 0.85 vs 1.0 é visualmente quase idêntico mas economiza 30-50% de bytes.
  // Abaixo de 0.55 a degradação visual fica perceptível — preferimos falhar
  // a mandar imagem feia.
  const qualities = [0.85, 0.75, 0.65, 0.55];
  for (const q of qualities) {
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('Canvas.toBlob retornou null'))),
        'image/jpeg',
        q,
      ),
    );
    if (blob.size <= maxBytes) {
      // Substitui extensão por .jpg porque o output é sempre JPEG mesmo se
      // entrada era PNG/WEBP. Sem isso, browsers tratariam o nome como hint
      // e poderiam errar o ícone de download.
      const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
      return new File([blob], newName, { type: 'image/jpeg', lastModified: Date.now() });
    }
  }

  throw new Error('Imagem muito grande mesmo após compressão. Use uma foto menor.');
}

/** Formata bytes pra exibição amigável ("1.2 MB"). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
