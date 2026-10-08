import { oklch, parse } from 'culori';
import { describe, expect, it } from 'vitest';
import { contrastRatio, HARMONIES, makePalette } from '../../src/scene/color.ts';

const hueOf = (hex: string) => oklch(parse(hex)!).h!;
const lightnessOf = (hex: string) => oklch(parse(hex)!).l;
/** Smallest angle between two hues, in degrees. */
const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
const rampOf = (p: Record<string, string>, role: string) => Object.keys(p).filter((k) => k.startsWith(`${role}.`)).map((k) => p[k]!);

describe('scene/color contrastRatio', () => {
  it('matches the WCAG 2.x reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('is 1 for the same color and symmetric', () => {
    expect(contrastRatio('teal', 'teal')).toBeCloseTo(1, 5);
    expect(contrastRatio('#264653', '#e9c46a')).toBe(contrastRatio('#e9c46a', '#264653'));
  });

  it('reads any CSS color and ignores alpha', () => {
    expect(contrastRatio('white', 'rgb(0 0 0)')).toBeCloseTo(21, 5);
    expect(contrastRatio('rgb(0 0 0 / 20%)', '#fff')).toBeCloseTo(21, 5);
  });

  it('is undefined when either side is not a color', () => {
    expect(contrastRatio('brand.ink', '#fff')).toBeUndefined();
    expect(contrastRatio('#fff', 'none')).toBeUndefined();
  });
});

describe('scene/color makePalette', () => {
  const base = '#2a9d8f';

  it('writes only lowercase #rrggbb values', () => {
    for (const harmony of HARMONIES) {
      for (const value of Object.values(makePalette(base, harmony, 5, 'p')!)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('names a root color and a ramp per role, then a neutral ramp', () => {
    const p = makePalette(base, 'analogous', 5, 'brand')!;
    expect(Object.keys(p)).toEqual([
      'brand.primary', ...[1, 2, 3, 4, 5].map((k) => `brand.primary.${k}`),
      'brand.secondary', ...[1, 2, 3, 4, 5].map((k) => `brand.secondary.${k}`),
      'brand.tertiary', ...[1, 2, 3, 4, 5].map((k) => `brand.tertiary.${k}`),
      ...[1, 2, 3, 4, 5].map((k) => `brand.neutral.${k}`),
    ]);
  });

  it('has the right number of roles per harmony', () => {
    const roots = (h: (typeof HARMONIES)[number]) => Object.keys(makePalette(base, h, 3, 'p')!).filter((k) => k.split('.').length === 2 && !k.startsWith('p.neutral'));
    expect(roots('monochrome')).toEqual(['p.primary']);
    expect(roots('complementary')).toEqual(['p.primary', 'p.accent']);
    expect(roots('analogous')).toHaveLength(3);
    expect(roots('triadic')).toHaveLength(3);
  });

  it('ramps get strictly darker, from light to dark', () => {
    for (const harmony of HARMONIES) {
      const p = makePalette(base, harmony, 9, 'p')!;
      for (const role of ['primary', 'neutral']) {
        const ls = rampOf(p, `p.${role}`).map(lightnessOf);
        expect(ls).toHaveLength(9);
        for (let i = 1; i < ls.length; i++) expect(ls[i]!).toBeLessThan(ls[i - 1]!);
        expect(ls[0]!).toBeCloseTo(0.95, 1);
        expect(ls.at(-1)!).toBeCloseTo(0.25, 1);
      }
    }
  });

  it('complementary accent sits 180 degrees from the primary', () => {
    const p = makePalette(base, 'complementary', 5, 'p')!;
    expect(hueGap(hueOf(p['p.accent']!), hueOf(p['p.primary']!) + 180)).toBeLessThan(3);
  });

  it('triadic and analogous hue offsets', () => {
    const t = makePalette(base, 'triadic', 5, 'p')!;
    expect(hueGap(hueOf(t['p.secondary']!), hueOf(t['p.primary']!) + 120)).toBeLessThan(3);
    expect(hueGap(hueOf(t['p.tertiary']!), hueOf(t['p.primary']!) + 240)).toBeLessThan(3);
    const a = makePalette(base, 'analogous', 5, 'p')!;
    expect(hueGap(hueOf(a['p.secondary']!), hueOf(a['p.primary']!) + 30)).toBeLessThan(3);
    expect(hueGap(hueOf(a['p.tertiary']!), hueOf(a['p.primary']!) - 30)).toBeLessThan(3);
  });

  it('keeps an in-gamut base color as the primary', () => {
    const got = parse(makePalette(base, 'monochrome', 5, 'p')!['p.primary']!)! as { r: number; g: number; b: number };
    const want = parse(base)! as { r: number; g: number; b: number };
    for (const c of ['r', 'g', 'b'] as const) expect(Math.abs(got[c] * 255 - want[c] * 255)).toBeLessThanOrEqual(1);
  });

  it('honors the step count, 3 to 9', () => {
    expect(rampOf(makePalette(base, 'monochrome', 3, 'p')!, 'p.primary')).toHaveLength(3);
    expect(rampOf(makePalette(base, 'monochrome', 9, 'p')!, 'p.primary')).toHaveLength(9);
  });

  it('works for achromatic and out-of-gamut bases', () => {
    const gray = makePalette('#808080', 'triadic', 5, 'p')!;
    expect(Object.keys(gray)).toHaveLength(3 * 6 + 5);
    for (const v of Object.values(gray)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
    const vivid = makePalette('oklch(0.7 0.4 30)', 'complementary', 5, 'p')!;
    for (const v of Object.values(vivid)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('is deterministic and undefined for a non-color base', () => {
    expect(makePalette(base, 'triadic', 5, 'p')).toEqual(makePalette(base, 'triadic', 5, 'p'));
    expect(makePalette('not-a-color', 'triadic', 5, 'p')).toBeUndefined();
  });
});
