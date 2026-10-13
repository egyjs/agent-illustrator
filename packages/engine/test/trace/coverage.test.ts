import { describe, expect, it } from 'vitest';
import { coverage, interiorPixels, noise, shares } from '../../src/trace/coverage.ts';
import type { Bitmap } from '../../src/trace/resample.ts';

/** A w×h bitmap whose pixel (x, y) is `at(x, y)` as [r, g, b, a]. */
function bitmap(w: number, h: number, at: (x: number, y: number) => readonly number[]): Bitmap {
  const pixels = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixels.set(at(x, y), (y * w + x) * 4);
  return { width: w, height: h, pixels };
}
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) => rgb(a).map((v, c) => Math.round(v * t + rgb(b)[c]! * (1 - t)));
const [SKY, NAVY, GREEN] = ['#8ecae6', '#264653', '#2a9d8f'];

describe('trace/coverage: interiorPixels', () => {
  it('keeps pixels whose neighborhood is flat and drops the blends along edges', () => {
    const img = bitmap(40, 20, (x) => [...(x < 20 ? rgb(SKY) : x === 20 ? mix(SKY, NAVY, 0.5) : rgb(NAVY)), 255]);
    const px = interiorPixels(img);
    const colors = new Set<string>();
    for (let i = 0; i < px.length; i += 4) colors.add(Array.from(px.subarray(i, i + 3)).join(','));
    expect([...colors].sort()).toEqual([rgb(NAVY).join(','), rgb(SKY).join(',')].sort());
  });

  it('falls back to every pixel when too few are flat', () => {
    const img = bitmap(4, 4, (x, y) => [x * 60, y * 60, 0, 255]);
    expect(interiorPixels(img)).toEqual(img.pixels);
  });
});

describe('trace/coverage: coverage', () => {
  it('gives interior pixels their own color, fully', () => {
    const cov = coverage(bitmap(3, 3, () => [...rgb(NAVY), 255]), [SKY, NAVY]);
    expect([cov.a[4], cov.b[4], cov.t[4]]).toEqual([1, 1, 1]);
  });

  it('explains a blend by the two colors around it, even when a third color is nearer', () => {
    // navy | 37.5% navy over sky | sky, with green present elsewhere in the palette
    const img = bitmap(5, 3, (x) => [...(x < 2 ? rgb(NAVY) : x === 2 ? mix(NAVY, SKY, 0.375) : rgb(SKY)), 255]);
    const cov = coverage(img, [SKY, NAVY, GREEN]);
    const i = 1 * 5 + 2;
    const navyShare = cov.a[i] === 1 ? cov.t[i]! : cov.b[i] === 1 ? 1 - cov.t[i]! : 0;
    expect(new Set([cov.a[i], cov.b[i]])).toEqual(new Set([0, 1]));
    expect(navyShare).toBeCloseTo(0.375, 2);
  });

  it('reads partial alpha as coverage against transparency', () => {
    const img = bitmap(3, 1, (x) => (x === 0 ? [200, 30, 30, 255] : x === 1 ? [200, 30, 30, 128] : [0, 0, 0, 0]));
    const cov = coverage(img, ['#c81e1e']);
    expect(cov.transparent).toBe(1);
    const red = cov.a[1] === 0 ? cov.t[1]! : 1 - cov.t[1]!;
    expect(red).toBeCloseTo(128 / 255, 2);
    expect([cov.a[2], cov.b[2]]).toEqual([1, 1]);
  });

  it('adds up each color’s coverage, transparent pixels left out', () => {
    const img = bitmap(4, 1, (x) => (x < 2 ? [...rgb(SKY), 255] : x === 2 ? [...mix(SKY, NAVY, 0.5), 255] : [0, 0, 0, 0]));
    const s = shares(coverage(img, [SKY, NAVY]), 2);
    expect(s[0]).toBeCloseTo(2.5, 1);
    expect(s[1]).toBeCloseTo(0.5, 1);
  });

  it('reports how badly each pixel is explained, so colors the palette lacks can be found', () => {
    const img = bitmap(3, 1, (x) => [...(x === 0 ? rgb(SKY) : x === 1 ? mix(SKY, NAVY, 0.5) : [230, 20, 20]), 255]);
    const cov = coverage(img, [SKY, NAVY]);
    expect(cov.error[0]).toBe(0);
    expect(cov.error[1]!).toBeLessThan(4);
    expect(cov.error[2]!).toBeGreaterThan(400);
  });
});


describe('trace/coverage: noise', () => {
  it('is about zero for clean flat color and grows with grain', () => {
    const clean = bitmap(20, 20, (x) => [...rgb(x < 10 ? SKY : NAVY), 255]);
    expect(noise(coverage(clean, [SKY, NAVY]))).toBeLessThan(0.5);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 10 - 5;
    const grainy = bitmap(20, 20, (x) => [...rgb(x < 10 ? SKY : NAVY).map((v) => Math.round(v + rand())), 255]);
    expect(noise(coverage(grainy, [SKY, NAVY]))).toBeGreaterThan(3);
  });
});
