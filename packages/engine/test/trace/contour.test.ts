import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../src/geometry/types.ts';
import { decodeImage } from '../../src/render/image.ts';
import { isolines, layerField, loopArea } from '../../src/trace/contour.ts';
import { coverage } from '../../src/trace/coverage.ts';

/** A field that is 1 inside `on` and 0 elsewhere. */
function block(w: number, h: number, on: (x: number, y: number) => boolean): Float32Array {
  const f = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = on(x, y) ? 1 : 0;
  return f;
}
const bounds = (loop: Vec2[]) => {
  const xs = loop.map((p) => p[0]), ys = loop.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

describe('trace/contour: isolines', () => {
  it('outlines a pixel-aligned block exactly along the pixel edges', () => {
    const loops = isolines(block(20, 20, (x, y) => x >= 5 && x < 15 && y >= 4 && y < 12), 20, 20);
    expect(loops).toHaveLength(1);
    expect(bounds(loops[0]!)).toEqual([5, 4, 15, 12]);
    expect(Math.abs(loopArea(loops[0]!))).toBeCloseTo(80 - 4 * 0.125, 6); // marching squares cuts each corner by ⅛ pixel²
  });

  it('closes shapes that touch the image border', () => {
    const loops = isolines(block(10, 10, (x) => x < 4), 10, 10);
    expect(loops).toHaveLength(1);
    expect(bounds(loops[0]!)).toEqual([0, 0, 4, 10]);
  });

  it('gives a ring two loops and keeps an island inside the hole', () => {
    const loops = isolines(block(60, 60, (x, y) => { const d = Math.hypot(x + 0.5 - 30, y + 0.5 - 30); return (d < 25 && d >= 15) || d < 6; }), 60, 60);
    expect(loops).toHaveLength(3);
  });

  it('places an antialiased circle’s edge to a few hundredths of a pixel', () => {
    const img = decodeImage(new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60.3" cy="59.7" r="40" fill="#000000"/></svg>', { font: { loadSystemFonts: false } }).render().asPng());
    const cov = coverage(img, ['#000000']);
    const [loop] = isolines(layerField(cov, 120, 120, 0, 'abutting'), 120, 120);
    const e = loop!.map(([x, y]) => Math.hypot(x - 60.3, y - 59.7) - 40);
    const mean = e.reduce((s, v) => s + v, 0) / e.length;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.sqrt(e.reduce((s, v) => s + (v - mean) ** 2, 0) / e.length)).toBeLessThan(0.05);
  });
});

describe('trace/contour: layerField', () => {
  // 7×1: colors 0 0 1 1 2 2 transparent (palette order is drawing order, 0 at the bottom)
  const cov = { a: new Uint8Array([0, 0, 1, 1, 2, 2, 3]), b: new Uint8Array([0, 0, 1, 1, 2, 2, 3]), t: new Float32Array(7).fill(1), transparent: 3, error: new Float32Array(7) };
  const row = (f: Float32Array) => Array.from(f);

  it('abutting: a layer covers its own pixels and reaches under the colors above it, not below', () => {
    expect(row(layerField(cov, 7, 1, 0, 'abutting', 2))).toEqual([1, 1, 1, 1, 0, 0, 0]);
    expect(row(layerField(cov, 7, 1, 1, 'abutting', 1))).toEqual([0, 0, 1, 1, 1, 0, 0]);
    expect(row(layerField(cov, 7, 1, 2, 'abutting', 2))).toEqual([0, 0, 0, 0, 1, 1, 0]);
  });

  it('stacked: a layer covers every color above it, never transparent pixels', () => {
    expect(row(layerField(cov, 7, 1, 0, 'stacked'))).toEqual([1, 1, 1, 1, 1, 1, 0]);
    expect(row(layerField(cov, 7, 1, 1, 'stacked'))).toEqual([0, 0, 1, 1, 1, 1, 0]);
  });
});
