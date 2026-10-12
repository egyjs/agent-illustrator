import { describe, expect, it } from 'vitest';
import { crop, downscale, type Bitmap } from '../../src/trace/resample.ts';

/** A w×h bitmap whose pixel (x, y) is `at(x, y)` as [r, g, b, a]. */
function bitmap(w: number, h: number, at: (x: number, y: number) => readonly number[]): Bitmap {
  const pixels = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixels.set(at(x, y), (y * w + x) * 4);
  return { width: w, height: h, pixels };
}
const px = (b: Bitmap, x: number, y: number) => [...b.pixels.subarray((y * b.width + x) * 4, (y * b.width + x) * 4 + 4)];

describe('trace/resample: crop', () => {
  it('copies exactly the pixels of the box', () => {
    const src = bitmap(6, 5, (x, y) => [x * 10, y * 10, 7, 255]);
    const part = crop(src, { x: 2, y: 1, width: 3, height: 2 });
    expect([part.width, part.height]).toEqual([3, 2]);
    expect(part.pixels).toHaveLength(3 * 2 * 4);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) expect(px(part, x, y)).toEqual(px(src, x + 2, y + 1));
  });

  it('returns the whole image for a box that covers it', () => {
    const src = bitmap(4, 3, (x, y) => [x, y, 0, 255]);
    expect(crop(src, { x: 0, y: 0, width: 4, height: 3 }).pixels).toEqual(src.pixels);
  });
});

describe('trace/resample: downscale', () => {
  it('returns an image that already fits unchanged, and never upscales', () => {
    const src = bitmap(8, 4, () => [1, 2, 3, 255]);
    expect(downscale(src, 8)).toBe(src);
    expect(downscale(src, 100)).toBe(src);
  });

  it('keeps the aspect: round(w·k) × round(h·k), at least 1', () => {
    const a = downscale(bitmap(100, 30, () => [9, 9, 9, 255]), 40);
    expect([a.width, a.height]).toEqual([40, 12]);
    const b = downscale(bitmap(1000, 1, () => [9, 9, 9, 255]), 10);
    expect([b.width, b.height]).toEqual([10, 1]);
    const c = downscale(bitmap(30, 100, () => [9, 9, 9, 255]), 50);
    expect([c.width, c.height]).toEqual([15, 50]);
  });

  it('averages whole blocks exactly', () => {
    const src = bitmap(4, 2, (x) => (x < 2 ? [0, 0, 0, 255] : [200, 100, 50, 255]));
    const out = downscale(src, 2);
    expect([out.width, out.height]).toEqual([2, 1]);
    expect(px(out, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(px(out, 1, 0)).toEqual([200, 100, 50, 255]);
    const mix = downscale(bitmap(2, 2, (x, y) => ((x + y) % 2 === 0 ? [0, 0, 0, 255] : [100, 200, 40, 255])), 1);
    expect(px(mix, 0, 0)).toEqual([50, 100, 20, 255]);
  });

  it('weights partly covered pixels by the area they cover', () => {
    // 3 → 2 pixels: each output pixel spans 1.5 source pixels.
    const out = downscale(bitmap(3, 1, (x) => [x * 90, 0, 0, 255]), 2);
    expect(px(out, 0, 0)).toEqual([30, 0, 0, 255]);
    expect(px(out, 1, 0)).toEqual([150, 0, 0, 255]);
  });

  it('keeps a uniform image exactly uniform at awkward scales', () => {
    const out = downscale(bitmap(97, 61, () => [17, 129, 250, 255]), 23);
    for (let i = 0; i < out.pixels.length; i += 4) expect([...out.pixels.subarray(i, i + 4)]).toEqual([17, 129, 250, 255]);
  });

  it('weights color by alpha, so transparent pixels do not tint the result', () => {
    const src = bitmap(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 255, 0]));
    expect(px(downscale(src, 1), 0, 0)).toEqual([255, 0, 0, 128]);
    const clear = downscale(bitmap(2, 1, () => [9, 9, 9, 0]), 1);
    expect(px(clear, 0, 0)[3]).toBe(0);
  });

  it('does not touch its input', () => {
    const src = bitmap(6, 6, (x, y) => [x * 40, y * 40, 0, 255]);
    const before = src.pixels.slice();
    downscale(src, 2);
    expect(src.pixels).toEqual(before);
  });
});
