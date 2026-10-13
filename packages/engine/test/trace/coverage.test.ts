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

  it('blends the colors on either side even when a palette color lies between them', () => {
    // RIM is 20% white over blue, so a white|blue edge pixel is as exact a blend of RIM and white:
    // which pair wins must not come down to rounding. Row y has white covering (y + 1)/10 of the edge pixel.
    const [BLUE, WHITE, RIM] = ['#5294e2', '#ffffff', '#75a9e8'];
    const both = (left: string, right: string) => bitmap(9, 9, (x, y) => [...(x < 4 ? rgb(left) : x === 4 ? mix(left, right, (y + 1) / 10) : rgb(right)), 255]);
    const share = (cov: ReturnType<typeof coverage>, i: number, k: number) => (cov.a[i] === k ? cov.t[i]! : 0) + (cov.b[i] === k && cov.b[i] !== cov.a[i] ? 1 - cov.t[i]! : 0);
    for (const [left, k] of [[WHITE, 1], [RIM, 2]] as const) {
      const cov = coverage(both(left, BLUE), [BLUE, WHITE, RIM]);
      for (let y = 0; y < 9; y++) expect(share(cov, y * 9 + 4, k), `${left} row ${y}`).toBeCloseTo((y + 1) / 10, 1);
    }
  });

  it('finds a thin feature’s color when the flat colors around it explain it badly', () => {
    // transparent | the 1-pixel tip of a light rim, 69% covered | blue
    const [BLUE, RIM] = ['#5294e2', '#75a9e8'];
    const cov = coverage(bitmap(9, 5, (x) => (x < 4 ? [0, 0, 0, 0] : x === 4 ? [...rgb(RIM), 175] : [...rgb(BLUE), 255])), [BLUE, RIM]);
    const i = 2 * 9 + 4;
    expect(cov.a[i] === 1 ? cov.t[i]! : cov.b[i] === 1 ? 1 - cov.t[i]! : 0).toBeCloseTo(175 / 255, 1);
    expect(cov.error[i]!).toBeLessThan(64);
  });

  it('reads partial alpha as coverage against transparency', () => {
    const img = bitmap(3, 1, (x) => (x === 0 ? [200, 30, 30, 255] : x === 1 ? [200, 30, 30, 128] : [0, 0, 0, 0]));
    const cov = coverage(img, ['#c81e1e']);
    expect(cov.transparent).toBe(1);
    const red = cov.a[1] === 0 ? cov.t[1]! : 1 - cov.t[1]!;
    expect(red).toBeCloseTo(128 / 255, 2);
    expect([cov.a[2], cov.b[2]]).toEqual([1, 1]);
  });

  it('blends a translucent color with transparency by its own alpha', () => {
    // a 20% shadow | its antialiased edge, 40% covered | transparent
    const img = bitmap(3, 1, (x) => (x === 0 ? [0, 15, 15, 51] : x === 1 ? [0, 15, 15, 20] : [0, 0, 0, 0]));
    const cov = coverage(img, ['#000f0f33']);
    expect([cov.a[0], cov.b[0], cov.t[0]]).toEqual([0, 0, 1]);
    const shadow = cov.a[1] === 0 ? cov.t[1]! : 1 - cov.t[1]!;
    expect(shadow).toBeCloseTo(20 / 51, 2);
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
