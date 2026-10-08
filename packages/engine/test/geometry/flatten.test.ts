import { describe, expect, it } from 'vitest';
import { pointAt } from '../../src/geometry/bezier.ts';
import { contains, flatten, flattenCubic, MAX_FLATTEN_STEPS, rings, signedArea, windingNumber } from '../../src/geometry/flatten.ts';
import { ellipse, polyline } from '../../src/geometry/paths.ts';
import type { Cubic } from '../../src/geometry/types.ts';
import { distanceToPolyline, KAPPA, KAPPA_CIRCLE_AREA, kappaCircle, square } from './helpers.ts';

const K = 100 * KAPPA;
const quarter: Cubic = [100, 0, 100, K, K, 100, 0, 100];
const sCurve: Cubic = [0, 0, 100, 0, -100, 100, 0, 100];
/** The same square as square(0, 0, 10), but counter-clockwise on screen. */
const ccwSquare = polyline([[0, 0], [0, 10], [10, 10], [10, 0]], true);

describe('flatten: Wang flattening', () => {
  it('a straight cubic flattens to its two end points', () => {
    expect(flattenCubic([0, 0, 0, 0, 30, 40, 30, 40], 0.25)).toEqual([[0, 0], [30, 40]]);
    expect(flattenCubic([0, 0, 10, 0, 20, 0, 30, 0], 0.25)).toEqual([[0, 0], [30, 0]]);
  });

  it("uses Wang's count: 12 pieces for the r = 100 quarter circle at 0.25", () => {
    expect(flattenCubic(quarter, 0.25)).toHaveLength(13);
  });

  it.each([0.25, 0.01])('keeps every curve point within tolerance %s of the polyline', (tol) => {
    for (const c of [quarter, sCurve]) {
      const poly = flattenCubic(c, tol);
      expect(poly[0]).toEqual([c[0], c[1]]);
      expect(poly.at(-1)).toEqual([c[6], c[7]]);
      for (let i = 0; i <= 1000; i++) expect(distanceToPolyline(pointAt(c, i / 1000), poly)).toBeLessThanOrEqual(tol);
    }
  });

  it('caps the piece count for huge curves and tiny tolerances', () => {
    expect(flattenCubic([0, 0, 1e7, 0, -1e7, 1e7, 0, 1e7], 1e-6).length).toBeLessThanOrEqual(MAX_FLATTEN_STEPS + 1);
  });

  it('rejects a non-positive tolerance', () => {
    expect(() => flattenCubic(quarter, 0)).toThrow(RangeError);
    expect(() => flattenCubic(quarter, -1)).toThrow(RangeError);
  });

  it('a closed subpath flattens to a ring ending at its start', () => {
    expect(flatten(square(0, 0, 10))).toEqual([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
  });
});

describe('flatten: winding and contains', () => {
  it('clockwise rings wind +1, counter-clockwise rings −1, outside is 0', () => {
    expect(windingNumber([5, 5], rings([square(0, 0, 10)]))).toBe(1);
    expect(windingNumber([5, 5], rings([ccwSquare]))).toBe(-1);
    expect(windingNumber([15, 5], rings([square(0, 0, 10)]))).toBe(0);
  });

  it('separates nonzero from evenodd on nested rings', () => {
    const sameWay = rings([square(0, 0, 30), square(10, 10, 10)]);
    expect(windingNumber([15, 15], sameWay)).toBe(2);
    expect(contains([15, 15], sameWay, 'nonzero')).toBe(true);
    expect(contains([15, 15], sameWay, 'evenodd')).toBe(false);
    const hole = rings([square(0, 0, 30), polyline([[10, 10], [10, 20], [20, 20], [20, 10]], true)]);
    expect(contains([15, 15], hole, 'nonzero')).toBe(false);
    expect(contains([5, 5], hole, 'nonzero')).toBe(true);
  });

  it('classifies points 1 unit inside and outside a circle', () => {
    const rs = rings([kappaCircle(0, 0, 100)]);
    expect(contains([99, 0], rs, 'nonzero')).toBe(true);
    expect(contains([101, 0], rs, 'nonzero')).toBe(false);
    expect(contains([0, 0], rs, 'evenodd')).toBe(true);
  });

  it('an open subpath is closed for fill, as SVG does', () => {
    const rs = rings([polyline([[0, 0], [10, 0], [10, 10]], false)]);
    expect(contains([8, 2], rs, 'nonzero')).toBe(true);
    expect(contains([2, 8], rs, 'nonzero')).toBe(false);
  });
});

describe('flatten: exact signed area', () => {
  it('is positive for clockwise squares and negative when reversed', () => {
    expect(signedArea([square(0, 0, 10)])).toBeCloseTo(100, 9);
    expect(signedArea([ccwSquare])).toBeCloseTo(-100, 9);
  });

  it('is exact on curves: the KAPPA circle and an ellipse', () => {
    expect(signedArea([kappaCircle(0, 0, 100)])).toBeCloseTo(KAPPA_CIRCLE_AREA * 1e4, 6);
    expect(Math.abs(signedArea([kappaCircle(0, 0, 100)]) / (Math.PI * 1e4) - 1)).toBeLessThan(3e-4);
    expect(signedArea([ellipse(5, 5, 100, 50)])).toBeCloseTo(KAPPA_CIRCLE_AREA * 5000, 6);
  });

  it('closes open subpaths and subtracts reversed holes', () => {
    expect(signedArea([polyline([[0, 0], [10, 0], [10, 10]], false)])).toBeCloseTo(50, 9);
    const hole = polyline([[10, 10], [10, 15], [15, 15], [15, 10]], true);
    expect(signedArea([square(0, 0, 10), hole])).toBeCloseTo(75, 9);
  });
});
