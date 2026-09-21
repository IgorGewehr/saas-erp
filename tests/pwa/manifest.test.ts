import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import manifest from '@/app/manifest';

const publicPath = (src: string) => join(process.cwd(), 'public', src.replace(/^\//, ''));

/** Largura/altura reais do PNG (IHDR nos bytes 16–23) — o manifest não pode mentir sobre `sizes`. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('manifest do PWA', () => {
  const data = manifest();

  it('tem o mínimo pra ser instalável', () => {
    expect(data.name).toBeTruthy();
    expect(data.short_name).toBeTruthy();
    expect(data.short_name!.length).toBeLessThanOrEqual(12); // rótulo embaixo do ícone na tela inicial
    expect(data.display).toBe('standalone');
    expect(data.start_url).toBe('/');
    expect(data.lang).toBe('pt-BR');
  });

  it('o escopo é a raiz: o login (/login) precisa ficar dentro dele', () => {
    expect(data.scope).toBe('/');
    expect('/login'.startsWith(data.scope!)).toBe(true);
    expect('/app'.startsWith(data.scope!)).toBe(true);
  });

  it('cores válidas (barra do navegador e splash)', () => {
    expect(data.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(data.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('traz 192 e 512 "any" e um 512 "maskable" (exigência do Chrome/Android)', () => {
    const icons = data.icons ?? [];
    const has = (size: string, purpose: string) => icons.some((icon) => icon.sizes === size && icon.purpose === purpose);
    expect(has('192x192', 'any')).toBe(true);
    expect(has('512x512', 'any')).toBe(true);
    expect(has('512x512', 'maskable')).toBe(true);
  });

  it.each((manifest().icons ?? []).map((icon) => [icon.src, icon.sizes] as const))(
    'ícone %s existe em public/ e tem exatamente %s',
    (src, sizes) => {
      expect(existsSync(publicPath(src))).toBe(true);
      const { width, height } = pngSize(publicPath(src));
      expect(`${width}x${height}`).toBe(sizes);
    },
  );
});

describe('arquivos estáticos do PWA', () => {
  it('a página offline e o service worker existem', () => {
    expect(existsSync(publicPath('/offline.html'))).toBe(true);
    expect(existsSync(publicPath('/sw.js'))).toBe(true);
  });

  it('a página offline só depende de arquivos que o service worker pré-carrega', () => {
    const html = readFileSync(publicPath('/offline.html'), 'utf8');
    const sw = readFileSync(publicPath('/sw.js'), 'utf8');
    const localRefs = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((match) => match[1]);
    expect(localRefs.length).toBeGreaterThan(0);
    for (const ref of localRefs) expect(sw).toContain(`'${ref}'`);
  });

  it('a página offline não carrega nada de fora (funciona sem rede)', () => {
    const html = readFileSync(publicPath('/offline.html'), 'utf8');
    expect(html).not.toMatch(/https?:\/\//);
  });
});
