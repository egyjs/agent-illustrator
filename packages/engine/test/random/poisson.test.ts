import { describe, expect, it } from 'vitest';
import { poissonDisk } from '../../src/random/poisson.ts';
import { alea } from '../../src/random/rng.ts';

const area = { x: 10, y: 20, width: 300, height: 200 };
const always = () => true;

describe('random/poisson', () => {
  it('keeps every pair at least r apart and every point in the area', () => {
    const r = 18;
    const pts = poissonDisk(alea(1), area, r, always, 10_000);
    expect(pts.length).toBeGreaterThan(100);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(area.x);
      expect(x).toBeLessThan(area.x + area.width);
      expect(y).toBeGreaterThanOrEqual(area.y);
      expect(y).toBeLessThan(area.y + area.height);
    }
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i]![0] - pts[j]![0], pts[i]![1] - pts[j]![1])).toBeGreaterThanOrEqual(r - 1e-9);
    }
  });

  it('fills the area densely: a maximal sampling leaves no gap wider than 2r', () => {
    const r = 20;
    const pts = poissonDisk(alea(2), area, r, always, 10_000);
    for (let gx = area.x + 5; gx < area.x + area.width; gx += 25) {
      for (let gy = area.y + 5; gy < area.y + area.height; gy += 25) {
        expect(pts.some(([x, y]) => Math.hypot(x - gx, y - gy) < 2 * r)).toBe(true);
      }
    }
  });

  it('respects the inside test', () => {
    const disc = (x: number, y: number) => Math.hypot(x - 160, y - 120) < 70;
    const pts = poissonDisk(alea(3), area, 10, disc, 10_000);
    expect(pts.length).toBeGreaterThan(20);
    for (const [x, y] of pts) expect(disc(x, y)).toBe(true);
  });

  it('is deterministic for a seed and differs between seeds', () => {
    const a = poissonDisk(alea(4), area, 15, always, 10_000);
    expect(poissonDisk(alea(4), area, 15, always, 10_000)).toEqual(a);
    expect(poissonDisk(alea(5), area, 15, always, 10_000)).not.toEqual(a);
  });

  it('stops at maxPoints, and returns nothing for 0', () => {
    expect(poissonDisk(alea(6), area, 5, always, 12)).toHaveLength(12);
    expect(poissonDisk(alea(6), area, 5, always, 0)).toEqual([]);
  });

  it('returns nothing when no start point is inside', () => {
    expect(poissonDisk(alea(7), area, 10, () => false, 100)).toEqual([]);
    expect(poissonDisk(alea(7), { x: 0, y: 0, width: 0, height: 50 }, 10, always, 100)).toEqual([]);
  });

  it('throws a RangeError when the grid would be huge', () => {
    expect(() => poissonDisk(alea(8), { x: 0, y: 0, width: 5000, height: 5000 }, 1, always, 10)).toThrow(RangeError);
    expect(() => poissonDisk(alea(8), area, 0, always, 10)).toThrow(RangeError);
  });
});
