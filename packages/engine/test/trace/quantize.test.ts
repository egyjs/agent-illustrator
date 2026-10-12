import { describe, expect, it } from 'vitest';
import { alea } from '../../src/random/rng.ts';
import { quantize, stackedMask } from '../../src/trace/quantize.ts';
import { TRANSPARENT } from '../../src/trace/vtracer.ts';
import { expectCode } from '../fixtures.ts';

/** Pixels from a run-length list of [hex, count] (alpha 255), or [null, count] for transparent. */
function pixels(runs: readonly (readonly [string | null, number])[]): Uint8Array {
  const out: number[] = [];
  for (const [hex, n] of runs) {
    const px = hex === null ? [0, 0, 0, 0] : [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(255);
    for (let i = 0; i < n; i++) out.push(...px);
  }
  return new Uint8Array(out);
}

describe('trace/quantize', () => {
  it('keeps the exact colors of an image with fewer colors than asked, largest first', () => {
    const q = quantize(pixels([['#1d3557', 20], ['#e63946', 50], ['#f1faee', 30]]), 8, alea(1));
    expect(q.palette).toEqual(['#e63946', '#f1faee', '#1d3557']);
    expect(q.counts).toEqual([50, 30, 20]);
    expect(q.index[0]).toBe(2);
    expect(q.index[20]).toBe(0);
    expect(q.index[99]).toBe(1);
  });

  it('merges the closest colors when asked for fewer', () => {
    const q = quantize(pixels([['#e63946', 50], ['#d62828', 30], ['#1d3557', 20]]), 2, alea(1));
    expect(q.palette).toHaveLength(2);
    expect(q.palette[1]).toBe('#1d3557');
    expect(q.counts).toEqual([80, 20]);
    // the weighted mean of the two reds: (230·50 + 214·30) / 80 = 224, and so on
    expect(q.palette[0]).toBe('#e0333b');
  });

  it('reduces a gradient to exactly the requested count', () => {
    const runs: [string, number][] = [];
    for (let v = 0; v < 256; v += 4) runs.push([`#${v.toString(16).padStart(2, '0')}40${(255 - v).toString(16).padStart(2, '0')}`, 3]);
    const q = quantize(pixels(runs), 4, alea(7));
    expect(q.palette).toHaveLength(4);
    expect(q.counts.reduce((a, b) => a + b)).toBe(64 * 3);
  });

  it('leaves transparent pixels out', () => {
    const q = quantize(pixels([[null, 10], ['#336699', 5]]), 4, alea(1));
    expect(q.palette).toEqual(['#336699']);
    expect(q.counts).toEqual([5]);
    expect(Array.from(q.index.subarray(0, 10)).every((i) => i === TRANSPARENT)).toBe(true);
  });

  it('refuses a fully transparent image', () => {
    expectCode(() => quantize(pixels([[null, 10]]), 4, alea(1)), 'invalid_input');
  });

  it('gives the same palette for the same seed', () => {
    const runs: [string, number][] = [];
    for (let i = 0; i < 200; i++) runs.push([`#${((i * 2654435761) >>> 8).toString(16).padStart(6, '0').slice(-6)}`, 1]);
    const a = quantize(pixels(runs), 6, alea(3));
    const b = quantize(pixels(runs), 6, alea(3));
    expect(a).toEqual(b);
    expect(a.palette).toHaveLength(6);
  });

  it('stacks masks: layer k covers every pixel of rank k or above', () => {
    const index = new Uint8Array([0, 1, 2, TRANSPARENT, 1, 0]);
    expect([0, 1, 2].map((k) => Array.from(stackedMask(index, k)))).toEqual([
      [1, 1, 1, 0, 1, 1],
      [0, 1, 1, 0, 1, 0],
      [0, 0, 1, 0, 0, 0],
    ]);
  });

  it('fills the buffer it is given, replacing what was there', () => {
    const index = new Uint8Array([0, 1, 2, TRANSPARENT]);
    const buffer = new Uint8Array(4).fill(7);
    expect(stackedMask(index, 1, buffer)).toBe(buffer);
    expect(Array.from(buffer)).toEqual([0, 1, 1, 0]);
  });
});
