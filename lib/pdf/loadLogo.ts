/**
 * lib/pdf/loadLogo.ts
 *
 * Logo da empresa como data URL PNG para o timbre do PDF. Melhor esforço: qualquer falha (sem logo,
 * sem CORS no Storage, formato estranho, rede lenta) devolve `null` e o PDF sai só com o nome.
 * Passa por canvas pra aceitar WebP/SVG (o jsPDF só embute PNG/JPEG) e limitar o tamanho.
 */

export interface LoadLogoOptions {
  timeoutMs?: number;
  /** Maior lado do PNG gerado, em px. */
  maxSize?: number;
}

export async function loadLogoDataUrl(url: string | undefined | null, options: LoadLogoOptions = {}): Promise<string | null> {
  if (!url || typeof document === 'undefined') return null;
  const { timeoutMs = 4000, maxSize = 400 } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let objectUrl: string | null = null;
  try {
    const response = await fetch(url, { signal: controller.signal, mode: 'cors' });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) return null;

    objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.src = objectUrl;
    await image.decode();

    const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/png');
    canvas.width = 0;
    canvas.height = 0;
    return dataUrl.startsWith('data:image/png') ? dataUrl : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
