import { describe, expect, it } from 'vitest';
import { pathBounds } from '../../src/geometry/bezier.ts';
import type { Box, Subpath } from '../../src/geometry/types.ts';
import { alea } from '../../src/random/rng.ts';
import { rasterize } from '../../src/render/raster.ts';
import { quantize } from '../../src/trace/quantize.ts';
import { TRANSPARENT, traceAvailable, traceMask, traceRegions } from '../../src/trace/vtracer.ts';
import { docOf, pathNode } from '../fixtures.ts';

/** A w×h mask, 1 where `on` holds. */
function mask(w: number, h: number, on: (x: number, y: number) => boolean): Uint8Array {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = on(x, y) ? 1 : 0;
  return m;
}
const near = (b: Box | null, want: Box, tol = 1) => {
  expect(b).not.toBeNull();
  for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(b![k] - want[k])).toBeLessThanOrEqual(tol);
};
const inCircle = (x: number, y: number) => Math.hypot(x + 0.5 - 60, y + 0.5 - 60) < 37;

/** Pixels of `region` that none of the layers cover, rendered over a green backdrop. */
function uncovered(layers: Subpath[][], size: number): number {
  const fills = ['#c81e1e', '#1e1ec8', '#e0a000'];
  const doc = docOf(layers.map((sp, i) => pathNode(`l${i}`, sp, { fillRule: 'evenodd', style: { fill: fills[i]! } })));
  const img = rasterize(doc, { region: { x: 0, y: 0, width: size, height: size }, background: '#00ff00' });
  let n = 0;
  for (let i = 0; i < img.pixels.length; i += 4) if (img.pixels[i + 1]! > 100 && img.pixels[i]! < 100) n++;
  return n;
}

describe('trace/vtracer', () => {
  it('loads', () => {
    expect(traceAvailable()).toBe(true);
  });

  it('traces a filled square to one closed subpath on the square', () => {
    const sp = traceMask(mask(40, 30, (x, y) => x >= 10 && x < 30 && y >= 5 && y < 25), 40, 30, { speckle: 4 });
    expect(sp).toHaveLength(1);
    expect(sp[0]!.closed).toBe(true);
    near(pathBounds(sp), { x: 10, y: 5, width: 20, height: 20 });
  });

  it('keeps holes and islands inside holes', () => {
    const sp = traceMask(mask(60, 60, (x, y) => { const d = Math.hypot(x - 30, y - 30); return (d < 25 && d >= 15) || d < 6; }), 60, 60, { speckle: 4 });
    expect(sp).toHaveLength(3);
    const boxes = sp.map((s) => pathBounds([s])!).sort((a, b) => b.width - a.width);
    expect(boxes[0]!.width).toBeGreaterThan(45);
    expect(boxes[2]!.width).toBeLessThan(14);
  });

  it('draws nothing for an empty mask and drops specks under speckle²', () => {
    expect(traceMask(mask(20, 20, () => false), 20, 20, { speckle: 4 })).toEqual([]);
    expect(traceMask(mask(20, 20, (x, y) => x === 5 && y === 5), 20, 20, { speckle: 4 })).toEqual([]);
  });

  it('gives the same geometry every time', () => {
    const m = mask(80, 80, (x, y) => Math.hypot(x - 40, y - 40) < 30 && x % 17 !== 3);
    expect(traceMask(m, 80, 80, { speckle: 2 })).toEqual(traceMask(m, 80, 80, { speckle: 2 }));
  });

  it('traces palette regions that meet without gaps', () => {
    const index = mask(120, 120, (x, y) => !inCircle(x, y)); // 0 inside the circle, 1 outside
    const layers = traceRegions(index, ['#c81e1e', '#1e1ec8'], 120, 120, { speckle: 4 });
    expect(layers).toHaveLength(2);
    near(pathBounds(layers[0]!), { x: 23, y: 23, width: 74, height: 74 });
    near(pathBounds(layers[1]!), { x: 0, y: 0, width: 120, height: 120 });
    expect(uncovered(layers, 120)).toBe(0);
  });

  it('leaves transparent pixels out of every region', () => {
    const index = mask(60, 40, (x) => x >= 30);
    for (let i = 0; i < index.length; i++) index[i] = index[i] ? 0 : TRANSPARENT;
    const [layer] = traceRegions(index, ['#336699'], 60, 40, { speckle: 4 });
    near(pathBounds(layer!), { x: 30, y: 0, width: 30, height: 40 });
  });

  describe('palette colors stay apart', () => {
    /** A w×h palette index image: `at` gives each pixel a palette position, or TRANSPARENT. */
    const indexOf = (w: number, h: number, at: (x: number, y: number) => number) => {
      const m = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = at(x, y);
      return m;
    };

    it('keeps a solid black shape on transparent', () => {
      const layers = traceRegions(indexOf(30, 10, (x) => (x >= 5 && x < 15 ? 0 : TRANSPARENT)), ['#000000'], 30, 10, { speckle: 0 });
      near(pathBounds(layers[0]!), { x: 5, y: 0, width: 10, height: 10 });
    });

    it('keeps a near-black body and the white shape inside it', () => {
      const index = indexOf(40, 30, (x, y) => (x >= 10 && x < 20 && y >= 10 && y < 20 ? 1 : x >= 5 && x < 35 && y >= 5 && y < 25 ? 0 : TRANSPARENT));
      const [body, inner] = traceRegions(index, ['#050505', '#ffffff'], 40, 30, { speckle: 0 });
      near(pathBounds(body!), { x: 5, y: 5, width: 30, height: 20 });
      near(pathBounds(inner!), { x: 10, y: 10, width: 10, height: 10 });
    });

    it('keeps two grays that are almost the same', () => {
      const layers = traceRegions(indexOf(20, 10, (x) => (x < 10 ? 0 : 1)), ['#404040', '#464646'], 20, 10, { speckle: 0 });
      near(pathBounds(layers[0]!), { x: 0, y: 0, width: 10, height: 10 });
      near(pathBounds(layers[1]!), { x: 10, y: 0, width: 10, height: 10 });
    });

    it('keeps black, white and mid-gray beside transparent pixels', () => {
      const index = indexOf(40, 10, (x) => (x < 10 ? 0 : x < 20 ? 1 : x < 30 ? 2 : TRANSPARENT));
      const layers = traceRegions(index, ['#000000', '#ffffff', '#808080'], 40, 10, { speckle: 0 });
      layers.forEach((sp, i) => near(pathBounds(sp), { x: i * 10, y: 0, width: 10, height: 10 }));
    });

    it.each([24, 32])('traces a noisy sunset quantized to %i colors, a layer for each color', (colors) => {
      const rng = alea('noisy-sunset');
      const w = 200, h = 150;
      const pixels = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const t = y / h;
          const sun = Math.hypot(x - 100, y - 60) < 25;
          const base = sun ? [255, 240, 200] : [250 - 180 * t, 160 - 100 * t, 120 + 100 * t];
          const i = (y * w + x) * 4;
          base.forEach((v, c) => (pixels[i + c] = Math.round(v + Math.floor(rng() * 5) - 2)));
          pixels[i + 3] = 255;
        }
      }
      const q = quantize(pixels, colors, alea(1));
      const layers = traceRegions(q.index, q.palette, w, h, { speckle: 0 });
      expect(layers).toHaveLength(q.palette.length);
      layers.forEach((sp, i) => expect(sp.length, `layer ${i} ${q.palette[i]}`).toBeGreaterThan(0));
    });
  });
});
