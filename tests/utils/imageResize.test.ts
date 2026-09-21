import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_RESIZE_OPTIONS,
  computeTargetSize,
  planImageResize,
  renameForType,
  prepareImageForUpload,
  prepareImagesForUpload,
  type ImageCodec,
  type OpenedImage,
  type RenderPlan,
} from '@/lib/utils/imageResize';

const KB = 1024;
const MB = 1024 * KB;

function file(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type, lastModified: 1_700_000_000_000 });
}

/** Codec de mentira: devolve as dimensões pedidas e um blob de tamanho controlado por render. */
function fakeCodec(config: {
  width: number;
  height: number;
  /** Tamanho do blob por (tipo) — permite simular "PNG continua pesado". */
  blobSizes?: Partial<Record<RenderPlan['type'], number>>;
  openFails?: boolean;
  renderReturnsNull?: boolean;
  renderThrows?: boolean;
}) {
  const renders: RenderPlan[] = [];
  const closed = vi.fn();
  const codec: ImageCodec = {
    async open(): Promise<OpenedImage | null> {
      if (config.openFails) return null;
      return {
        width: config.width,
        height: config.height,
        async render(plan) {
          renders.push(plan);
          if (config.renderThrows) throw new Error('canvas quebrou');
          if (config.renderReturnsNull) return null;
          return new Blob([new Uint8Array(config.blobSizes?.[plan.type] ?? 200 * KB)], { type: plan.type });
        },
        close: closed,
      };
    },
  };
  return { codec, renders, closed };
}

describe('computeTargetSize', () => {
  it('reduz pelo maior lado mantendo a proporção', () => {
    expect(computeTargetSize(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200, scaled: true });
    expect(computeTargetSize(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600, scaled: true });
  });

  it('nunca amplia', () => {
    expect(computeTargetSize(800, 600, 1600)).toEqual({ width: 800, height: 600, scaled: false });
    expect(computeTargetSize(1600, 900, 1600).scaled).toBe(false);
  });

  it('panorama extremo não gera lado zero', () => {
    const result = computeTargetSize(20_000, 10, 1600);
    expect(result.width).toBe(1600);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });
});

describe('planImageResize', () => {
  it('foto grande: reduz e vira JPEG com fundo branco', () => {
    expect(planImageResize({ width: 4032, height: 3024, size: 6 * MB, type: 'image/jpeg' })).toEqual({
      width: 1600, height: 1200, type: 'image/jpeg', quality: 0.82, flattenBackground: true,
    });
  });

  it('imagem já pequena (dimensões e bytes) passa direto', () => {
    expect(planImageResize({ width: 1200, height: 800, size: 300 * KB, type: 'image/jpeg' })).toBeNull();
  });

  it('dentro das dimensões mas pesada: recomprime', () => {
    expect(planImageResize({ width: 1500, height: 1000, size: 3 * MB, type: 'image/jpeg' })).toMatchObject({
      width: 1500, height: 1000, type: 'image/jpeg',
    });
  });

  it('PNG mantém PNG (transparência) e não pinta fundo', () => {
    expect(planImageResize({ width: 3000, height: 2000, size: 4 * MB, type: 'image/png' })).toMatchObject({
      type: 'image/png', flattenBackground: false,
    });
  });

  it('WebP vira JPEG (Safari não codifica WebP)', () => {
    expect(planImageResize({ width: 3000, height: 2000, size: 4 * MB, type: 'image/webp' })?.type).toBe('image/jpeg');
  });

  it('HEIC/HEIF do iPad SEMPRE converte, mesmo pequeno (o servidor não aceita)', () => {
    expect(planImageResize({ width: 800, height: 600, size: 100 * KB, type: 'image/heic' })).toMatchObject({ type: 'image/jpeg' });
    expect(planImageResize({ width: 800, height: 600, size: 100 * KB, type: 'image/heif' })).not.toBeNull();
  });

  it('tipo desconhecido e dimensão inválida não são tocados', () => {
    expect(planImageResize({ width: 4000, height: 3000, size: 5 * MB, type: 'image/gif' })).toBeNull();
    expect(planImageResize({ width: 0, height: 3000, size: 5 * MB, type: 'image/jpeg' })).toBeNull();
    expect(planImageResize({ width: NaN, height: 3000, size: 5 * MB, type: 'image/jpeg' })).toBeNull();
  });
});

describe('renameForType', () => {
  it('troca a extensão pelo tipo de saída', () => {
    expect(renameForType('IMG_0001.HEIC', 'image/jpeg')).toBe('IMG_0001.jpg');
    expect(renameForType('logo.webp', 'image/jpeg')).toBe('logo.jpg');
    expect(renameForType('arte.final.png', 'image/png')).toBe('arte.final.png');
  });

  it('sem extensão ou nome vazio', () => {
    expect(renameForType('foto', 'image/jpeg')).toBe('foto.jpg');
    expect(renameForType('.jpg', 'image/jpeg')).toBe('.jpg.jpg');
    expect(renameForType('', 'image/png')).toBe('imagem.png');
  });
});

describe('prepareImageForUpload', () => {
  it('foto de 6 MB vira ~200 KB, JPEG, mesmo nome-base e mesma data', async () => {
    const { codec, renders, closed } = fakeCodec({ width: 4032, height: 3024 });
    const original = file('capa-spot.jpg', 'image/jpeg', 6 * MB);

    const result = await prepareImageForUpload(original, DEFAULT_RESIZE_OPTIONS, codec);

    expect(result).not.toBe(original);
    expect(result.size).toBe(200 * KB);
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('capa-spot.jpg');
    expect(result.lastModified).toBe(original.lastModified);
    expect(renders).toHaveLength(1);
    expect(renders[0]).toMatchObject({ width: 1600, height: 1200 });
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('imagem pequena volta o MESMO arquivo, sem renderizar', async () => {
    const { codec, renders } = fakeCodec({ width: 1000, height: 700 });
    const original = file('pequena.jpg', 'image/jpeg', 200 * KB);
    expect(await prepareImageForUpload(original, DEFAULT_RESIZE_OPTIONS, codec)).toBe(original);
    expect(renders).toHaveLength(0);
  });

  it('HEIC vira JPEG com extensão .jpg', async () => {
    const { codec } = fakeCodec({ width: 3000, height: 2000 });
    const result = await prepareImageForUpload(file('IMG_1234.HEIC', 'image/heic', 3 * MB), DEFAULT_RESIZE_OPTIONS, codec);
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('IMG_1234.jpg');
  });

  it('PNG que continua pesado depois de reduzir é reencodado como JPEG', async () => {
    const { codec, renders } = fakeCodec({ width: 3000, height: 2000, blobSizes: { 'image/png': 3 * MB, 'image/jpeg': 250 * KB } });
    const result = await prepareImageForUpload(file('print.png', 'image/png', 8 * MB), DEFAULT_RESIZE_OPTIONS, codec);

    expect(renders.map((plan) => plan.type)).toEqual(['image/png', 'image/jpeg']);
    expect(renders[1].flattenBackground).toBe(true);
    expect(result).toMatchObject({ type: 'image/jpeg', name: 'print.jpg' });
    expect(result.size).toBe(250 * KB);
  });

  it('PNG leve depois de reduzir continua PNG', async () => {
    const { codec } = fakeCodec({ width: 3000, height: 2000, blobSizes: { 'image/png': 900 * KB } });
    const result = await prepareImageForUpload(file('logo.png', 'image/png', 4 * MB), DEFAULT_RESIZE_OPTIONS, codec);
    expect(result).toMatchObject({ type: 'image/png', name: 'logo.png' });
  });

  it('sem ganho (mesmas dimensões e o resultado não é menor): manda o original', async () => {
    const { codec } = fakeCodec({ width: 1500, height: 1000, blobSizes: { 'image/jpeg': 2 * MB } });
    const original = file('ja-otimizada.jpg', 'image/jpeg', 1 * MB);
    expect(await prepareImageForUpload(original, DEFAULT_RESIZE_OPTIONS, codec)).toBe(original);
  });

  it('mesmo sem ganho de bytes, se as dimensões diminuíram usa o reduzido', async () => {
    const { codec } = fakeCodec({ width: 4000, height: 3000, blobSizes: { 'image/jpeg': 2 * MB } });
    const result = await prepareImageForUpload(file('grande.jpg', 'image/jpeg', 1 * MB), DEFAULT_RESIZE_OPTIONS, codec);
    expect(result.size).toBe(2 * MB);
  });

  it('não consegue abrir (formato/DOM): original', async () => {
    const { codec } = fakeCodec({ width: 1, height: 1, openFails: true });
    const original = file('x.jpg', 'image/jpeg', 6 * MB);
    expect(await prepareImageForUpload(original, DEFAULT_RESIZE_OPTIONS, codec)).toBe(original);
  });

  it('canvas devolve null, vazio ou lança: original — e o recurso é sempre liberado', async () => {
    const original = file('x.jpg', 'image/jpeg', 6 * MB);

    const nullCase = fakeCodec({ width: 4000, height: 3000, renderReturnsNull: true });
    expect(await prepareImageForUpload(original, DEFAULT_RESIZE_OPTIONS, nullCase.codec)).toBe(original);
    expect(nullCase.closed).toHaveBeenCalledTimes(1);

    const emptyCase = fakeCodec({ width: 4000, height: 3000, blobSizes: { 'image/jpeg': 0 } });
    expect(await prepareImageForUpload(original, DEFAULT_RESIZE_OPTIONS, emptyCase.codec)).toBe(original);

    const throwCase = fakeCodec({ width: 4000, height: 3000, renderThrows: true });
    expect(await prepareImageForUpload(original, DEFAULT_RESIZE_OPTIONS, throwCase.codec)).toBe(original);
    expect(throwCase.closed).toHaveBeenCalledTimes(1);
  });

  it('tipo que não é imagem tratável passa direto sem nem abrir o codec', async () => {
    const open = vi.fn();
    const original = file('doc.pdf', 'application/pdf', 6 * MB);
    expect(await prepareImageForUpload(original, DEFAULT_RESIZE_OPTIONS, { open })).toBe(original);
    expect(open).not.toHaveBeenCalled();
  });

  it('no ambiente sem DOM de imagem (jsdom), o codec padrão cai no original', async () => {
    const original = file('x.jpg', 'image/jpeg', 6 * MB);
    expect(await prepareImageForUpload(original)).toBe(original);
  });
});

describe('prepareImagesForUpload', () => {
  it('processa UMA por vez, na ordem (evita decodificar 8 fotos grandes juntas)', async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const codec: ImageCodec = {
      async open(current) {
        active++;
        maxActive = Math.max(maxActive, active);
        order.push(current.name);
        await new Promise((resolve) => setTimeout(resolve, 1));
        return {
          width: 4000,
          height: 3000,
          render: async (plan) => new Blob([new Uint8Array(100 * KB)], { type: plan.type }),
          close: () => { active--; },
        };
      },
    };

    const result = await prepareImagesForUpload(
      [file('a.jpg', 'image/jpeg', 5 * MB), file('b.jpg', 'image/jpeg', 5 * MB), file('c.jpg', 'image/jpeg', 5 * MB)],
      DEFAULT_RESIZE_OPTIONS,
      codec,
    );

    expect(order).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(maxActive).toBe(1);
    expect(result.map((item) => item.size)).toEqual([100 * KB, 100 * KB, 100 * KB]);
  });

  it('lista vazia devolve vazia', async () => {
    expect(await prepareImagesForUpload([])).toEqual([]);
  });
});
