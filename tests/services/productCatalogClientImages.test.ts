import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/config/firebase', () => ({
  auth: { currentUser: { getIdToken: async () => 'tok123' } },
}));

const prepareImagesForUpload = vi.fn();
vi.mock('@/lib/utils/imageResize', () => ({
  prepareImagesForUpload: (...args: unknown[]) => prepareImagesForUpload(...args),
}));

import { replaceCatalogProductImages } from '@/lib/services/product-catalog-client';

const original = new File([new Uint8Array(6 * 1024 * 1024)], 'IMG_0001.HEIC', { type: 'image/heic' });
const reduced = new File([new Uint8Array(200 * 1024)], 'IMG_0001.jpg', { type: 'image/jpeg' });

describe('replaceCatalogProductImages — foto reduzida antes do envio', () => {
  let sent: { url: string; init: RequestInit } | undefined;

  beforeEach(() => {
    sent = undefined;
    prepareImagesForUpload.mockReset().mockResolvedValue([reduced]);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      sent = { url, init };
      return { ok: true, json: async () => ({ ok: true, data: { id: 'p1' } }) };
    }));
  });

  it('manda ao servidor o arquivo REDUZIDO, não o original do tablet', async () => {
    await replaceCatalogProductImages({ businessId: 'biz_1', productId: 'p1', files: [original] });

    expect(prepareImagesForUpload).toHaveBeenCalledWith([original]);
    const form = sent?.init.body as FormData;
    const files = form.getAll('files') as File[];
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('IMG_0001.jpg');
    expect(files[0].size).toBe(200 * 1024);
    expect(sent?.url).toBe('/api/products/images');
    expect((sent?.init.headers as Record<string, string>).Authorization).toBe('Bearer tok123');
  });

  it('sem imagem selecionada continua recusando antes de qualquer trabalho', async () => {
    await expect(replaceCatalogProductImages({ businessId: 'biz_1', productId: 'p1', files: [] }))
      .rejects.toThrow('Selecione ao menos uma imagem.');
    expect(prepareImagesForUpload).not.toHaveBeenCalled();
  });

  it('preserva businessId, produto, modo e imagens existentes no formulário', async () => {
    await replaceCatalogProductImages({
      businessId: 'biz_1',
      productId: 'p1',
      files: [original],
      existingImages: [{ id: 'img1', url: 'https://x/a.jpg', sortOrder: 0 }],
      mode: 'append',
    });
    const form = sent?.init.body as FormData;
    expect(form.get('businessId')).toBe('biz_1');
    expect(form.get('productId')).toBe('p1');
    expect(form.get('mode')).toBe('append');
    expect(JSON.parse(String(form.get('existingImages')))).toHaveLength(1);
  });
});
