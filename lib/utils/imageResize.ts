/**
 * lib/utils/imageResize.ts
 *
 * Redução de imagem NO NAVEGADOR antes do upload de produto. Foto tirada no tablet/celular
 * tem 3–12 MB (o servidor recusa acima de 5 MB) e deixa a Vitrine pesada; 1600 px no lado
 * maior com JPEG 82% costuma ficar em 150–400 KB e continua nítido em tela retina.
 *
 * Por que no cliente e não com `sharp` no servidor: o build roda no Windows e a imagem Docker é
 * Linux — o binário nativo do sharp não acompanha. Canvas funciona em qualquer navegador,
 * poupa upload em Wi-Fi ruim e converte HEIC do iPad de graça.
 *
 * O planejamento e a decisão (`planImageResize`, `prepareImageForUpload`) são puros e testados;
 * só `browserImageCodec` toca em DOM. Qualquer falha devolve o arquivo ORIGINAL — o servidor
 * continua validando tipo e tamanho.
 */

export interface ResizeOptions {
  /** Maior lado, em px. Nunca amplia. */
  maxDimension: number;
  /** Qualidade JPEG (0–1). */
  quality: number;
  /** Arquivo já dentro das dimensões e menor que isso passa direto, sem recomprimir. */
  skipBelowBytes: number;
  /** PNG que continua maior que isso depois de reduzir vira JPEG. */
  maxPngBytes: number;
}

export const DEFAULT_RESIZE_OPTIONS: ResizeOptions = {
  maxDimension: 1600,
  quality: 0.82,
  skipBelowBytes: 600 * 1024,
  maxPngBytes: 1.5 * 1024 * 1024,
};

export type OutputType = 'image/jpeg' | 'image/png';

export interface RenderPlan {
  width: number;
  height: number;
  type: OutputType;
  quality: number;
  /** JPEG não tem transparência: pinta branco antes, senão PNG/WebP transparente vira preto. */
  flattenBackground: boolean;
}

/** O que o servidor aceita (app/api/products/images). O resto (HEIC/HEIF do iPad) precisa converter. */
const SERVER_ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const CONVERTIBLE = new Set([...SERVER_ACCEPTED, 'image/heic', 'image/heif']);

export function computeTargetSize(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number; scaled: boolean } {
  const longest = Math.max(width, height);
  if (longest <= maxDimension) return { width, height, scaled: false };
  const scale = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: true,
  };
}

/** `null` = deixar o arquivo como está. */
export function planImageResize(
  input: { width: number; height: number; size: number; type: string },
  options: ResizeOptions = DEFAULT_RESIZE_OPTIONS,
): RenderPlan | null {
  if (!CONVERTIBLE.has(input.type)) return null;
  if (![input.width, input.height].every((value) => Number.isFinite(value) && value > 0)) return null;

  const target = computeTargetSize(input.width, input.height, options.maxDimension);
  const needsConversion = !SERVER_ACCEPTED.has(input.type);
  if (!needsConversion && !target.scaled && input.size <= options.skipBelowBytes) return null;

  const keepPng = input.type === 'image/png';
  return {
    width: target.width,
    height: target.height,
    type: keepPng ? 'image/png' : 'image/jpeg',
    quality: options.quality,
    flattenBackground: !keepPng,
  };
}

export function renameForType(name: string, type: OutputType): string {
  const extension = type === 'image/png' ? 'png' : 'jpg';
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base || 'imagem'}.${extension}`;
}

export interface OpenedImage {
  width: number;
  height: number;
  render(plan: RenderPlan): Promise<Blob | null>;
  close(): void;
}

export interface ImageCodec {
  /** `null` quando o navegador não consegue decodificar (formato desconhecido, sem DOM). */
  open(file: File): Promise<OpenedImage | null>;
}

export async function prepareImageForUpload(
  file: File,
  options: ResizeOptions = DEFAULT_RESIZE_OPTIONS,
  codec: ImageCodec = browserImageCodec,
): Promise<File> {
  if (!CONVERTIBLE.has(file.type)) return file;

  let opened: OpenedImage | null = null;
  try {
    opened = await codec.open(file);
    if (!opened) return file;

    let plan = planImageResize({ width: opened.width, height: opened.height, size: file.size, type: file.type }, options);
    if (!plan) return file;

    let blob = await opened.render(plan);
    // PNG que continua pesado (captura de tela, arte grande) vira JPEG: perde transparência, ganha muito.
    if (blob && plan.type === 'image/png' && blob.size > options.maxPngBytes) {
      plan = { ...plan, type: 'image/jpeg', quality: options.quality, flattenBackground: true };
      blob = await opened.render(plan);
    }
    if (!blob || blob.size === 0) return file;

    const converted = !SERVER_ACCEPTED.has(file.type);
    const shrunk = plan.width < opened.width || plan.height < opened.height;
    // Mesmas dimensões e não ficou menor: recomprimir só perderia qualidade.
    if (!converted && !shrunk && blob.size >= file.size) return file;

    return new File([blob], renameForType(file.name, plan.type), { type: plan.type, lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    opened?.close();
  }
}

/** Uma por vez: 8 fotos de 12 MP decodificadas juntas derrubam a aba do iPad. */
export async function prepareImagesForUpload(
  files: File[],
  options: ResizeOptions = DEFAULT_RESIZE_OPTIONS,
  codec: ImageCodec = browserImageCodec,
): Promise<File[]> {
  const prepared: File[] = [];
  for (const file of files) prepared.push(await prepareImageForUpload(file, options, codec));
  return prepared;
}

/** Decodifica via <img> (aplica a orientação EXIF em todos os navegadores atuais) e reencoda em canvas. */
export const browserImageCodec: ImageCodec = {
  async open(file) {
    if (typeof document === 'undefined' || typeof Image === 'undefined') return null;

    const url = URL.createObjectURL(file);
    const image = new Image();
    try {
      image.src = url;
      await image.decode();
    } catch {
      URL.revokeObjectURL(url);
      return null;
    }

    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      async render(plan) {
        const canvas = document.createElement('canvas');
        canvas.width = plan.width;
        canvas.height = plan.height;
        try {
          const context = canvas.getContext('2d');
          if (!context) return null;
          if (plan.flattenBackground) {
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, plan.width, plan.height);
          }
          context.imageSmoothingQuality = 'high';
          context.drawImage(image, 0, 0, plan.width, plan.height);
          return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, plan.type, plan.quality));
        } finally {
          // Safari segura a memória do canvas até o GC; zerar libera na hora.
          canvas.width = 0;
          canvas.height = 0;
        }
      },
      close() {
        URL.revokeObjectURL(url);
      },
    };
  },
};
