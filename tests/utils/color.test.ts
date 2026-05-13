import { describe, it, expect } from 'vitest';
import {
  relativeLuminance,
  lighten,
  darken,
  pickReadableTextColor,
} from '@/lib/utils/color';

describe('relativeLuminance', () => {
  it('preto = 0', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 3);
  });
  it('branco = 1', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 3);
  });
  it('aceita hex sem #', () => {
    expect(relativeLuminance('166534')).toBeCloseTo(relativeLuminance('#166534'), 5);
  });
  it('aceita hex curto (3 chars)', () => {
    expect(relativeLuminance('#fff')).toBeCloseTo(1, 3);
    expect(relativeLuminance('#000')).toBeCloseTo(0, 3);
  });
  it('hex inválido cai em 0.5 (defensive)', () => {
    expect(relativeLuminance('lixo')).toBe(0.5);
  });
  it('stage Ganho (#166534) tem luminância baixa', () => {
    expect(relativeLuminance('#166534')).toBeLessThan(0.2);
  });
  it('stage Novo (#3B82F6) tem luminância média', () => {
    const lum = relativeLuminance('#3B82F6');
    expect(lum).toBeGreaterThan(0.15);
    expect(lum).toBeLessThan(0.5);
  });
});

describe('lighten / darken', () => {
  it('lighten(black, 1) = white', () => {
    expect(lighten('#000000', 1).toLowerCase()).toBe('#ffffff');
  });
  it('lighten(black, 0) = black', () => {
    expect(lighten('#000000', 0).toLowerCase()).toBe('#000000');
  });
  it('darken(white, 1) = black', () => {
    expect(darken('#ffffff', 1).toLowerCase()).toBe('#000000');
  });
  it('lighten move luminância pra cima', () => {
    const before = relativeLuminance('#166534');
    const after = relativeLuminance(lighten('#166534', 0.5));
    expect(after).toBeGreaterThan(before);
  });
});

describe('pickReadableTextColor', () => {
  // Threshold WCAG AA (texto pequeno em fundo slate-900):
  // lum >= ~0.23 produz contraste >= 4.5:1.
  const AA_MIN_LUM_ON_DARK = 0.25;

  it('Ganho (#166534) em dark mode → clareia acima do AA', () => {
    const adjusted = pickReadableTextColor('#166534', true);
    expect(relativeLuminance(adjusted)).toBeGreaterThan(AA_MIN_LUM_ON_DARK);
  });
  it('Ganho (#166534) em light mode → passa direto', () => {
    expect(pickReadableTextColor('#166534', false).toLowerCase()).toBe('#166534');
  });
  it('Perdido (#991B1B) em dark mode → clareia acima do AA', () => {
    const adjusted = pickReadableTextColor('#991B1B', true);
    expect(relativeLuminance(adjusted)).toBeGreaterThan(AA_MIN_LUM_ON_DARK);
  });
  it('Novo (#3B82F6 azul médio) passa direto em ambos', () => {
    expect(pickReadableTextColor('#3B82F6', true).toLowerCase()).toBe('#3b82f6');
    expect(pickReadableTextColor('#3B82F6', false).toLowerCase()).toBe('#3b82f6');
  });
  it('cor muito clara em light mode → escurece', () => {
    const adjusted = pickReadableTextColor('#FAFAFA', false);
    expect(relativeLuminance(adjusted)).toBeLessThan(0.75);
  });
});
