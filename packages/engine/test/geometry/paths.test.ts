import { describe, expect, it } from 'vitest';
import { pathBounds, pointAt } from '../../src/geometry/bezier.ts';
import { flatten, signedArea } from '../../src/geometry/flatten.ts';
import { arcToCubics, ellipse, fit, line, polyline, quadToCubic, roundCorners, smooth } from '../../src/geometry/paths.ts';
import type { Box, Subpath, Vec2 } from '../../src/geometry/types.ts';
import { distanceToPolyline, expectVec, KAPPA_CIRCLE_AREA, kappaCircle } from './helpers.ts';

function expectBox(actual: Box | null, expected: Box, digits: number): void {
  expect(actual).not.toBeNull();
  for (const k of ['x', 'y', 'width', 'height'] as const) expect(actual![k]).toBeCloseTo(expected[k], digits);
}

const arcPath = (from: Vec2, rx: number, ry: number, rot: number, large: boolean, sweep: boolean, to: Vec2): Subpath => ({
  start: from,
  closed: false,
  segs: arcToCubics(from, rx, ry, rot, large, sweep, to),
});

describe('paths: conversions', () => {
  it('line puts the control points on the end points', () => {
    expect(line([1, 2], [3, 4])).toEqual([1, 2, 3, 4, 3, 4]);
  });

  it('quadToCubic is an exact degree elevation', () => {
    const p0: Vec2 = [0, 0], q: Vec2 = [50, 100], p2: Vec2 = [100, 0];
    const [c1x, c1y, c2x, c2y, x, y] = quadToCubic(p0, q, p2);
    for (const t of [0, 0.25, 0.5, 0.9, 1]) {
      const mt = 1 - t;
      const expected: Vec2 = [2 * mt * t * q[0] + t * t * p2[0], mt * mt * p0[1] + 2 * mt * t * q[1] + t * t * p2[1]];
      expectVec(pointAt([p0[0], p0[1], c1x, c1y, c2x, c2y, x, y], t), expected);
    }
  });

  it('polyline ends a closed run with an explicit closing segment', () => {
    expect(polyline([[0, 0], [10, 0], [10, 10]], true)).toEqual({
      start: [0, 0],
      closed: true,
      segs: [line([0, 0], [10, 0]), line([10, 0], [10, 10]), line([10, 10], [0, 0])],
    });
  });

  it('polyline drops consecutive duplicates and a repeated closing point', () => {
    const sp = polyline([[0, 0], [10, 0], [10, 0], [10, 10], [0, 0]], true);
    expect(sp.segs).toHaveLength(3);
    expect(polyline([[0, 0], [10, 0]], false).segs).toEqual([line([0, 0], [10, 0])]);
  });

  it('polyline rejects an empty point list', () => {
    expect(() => polyline([], false)).toThrow(RangeError);
  });

  it('ellipse is four KAPPA quarter arcs with exact bounds', () => {
    expect(ellipse(10, 20, 100, 100)).toEqual(kappaCircle(10, 20, 100));
    expect(pathBounds([ellipse(0, 0, 100, 50)])).toEqual({ x: -100, y: -50, width: 200, height: 100 });
  });
});

describe('paths: SVG arcs', () => {
  it('half circle: sweep picks the side, the end point is exact', () => {
    const up = arcPath([0, 0], 50, 50, 0, false, true, [100, 0]);
    expect(up.segs).toHaveLength(2);
    expect(up.segs.at(-1)!.slice(4)).toEqual([100, 0]);
    expectBox(pathBounds([up]), { x: 0, y: -50, width: 100, height: 50 }, 6);
    expectBox(pathBounds([arcPath([0, 0], 50, 50, 0, false, false, [100, 0])]), { x: 0, y: 0, width: 100, height: 50 }, 6);
  });

  it('scales radii that are too small to reach the end point', () => {
    const scaled = arcToCubics([0, 0], 10, 10, 0, false, true, [100, 0]).flat();
    const exact = arcToCubics([0, 0], 50, 50, 0, false, true, [100, 0]).flat();
    scaled.forEach((v, i) => expect(v).toBeCloseTo(exact[i]!, 9));
  });

  it('large-arc and sweep flags choose among the four arcs', () => {
    // r = 100 between (0,0) and (100,0): centers at (50, ±86.6); the arcs span 60° or 300°.
    const small = arcPath([0, 0], 100, 100, 0, false, true, [100, 0]);
    expect(small.segs).toHaveLength(1);
    expectBox(pathBounds([small]), { x: 0, y: -(100 - 50 * Math.sqrt(3)), width: 100, height: 100 - 50 * Math.sqrt(3) }, 6);
    const large = arcPath([0, 0], 100, 100, 0, true, true, [100, 0]);
    expect(large.segs).toHaveLength(4);
    expect(large.segs.at(-1)!.slice(4)).toEqual([100, 0]);
    expectBox(pathBounds([large]), { x: -50, y: -(100 + 50 * Math.sqrt(3)), width: 200, height: 100 + 50 * Math.sqrt(3) }, 1);
  });

  it('applies the x-axis rotation', () => {
    // rx = 50 along y after a 90° rotation: a half ellipse from (0,0) to (0,100) bulging to +x by ry = 25.
    const sp = arcPath([0, 0], 50, 25, 90, false, true, [0, 100]);
    expect(sp.segs.at(-1)!.slice(4)).toEqual([0, 100]);
    expectBox(pathBounds([sp]), { x: 0, y: 0, width: 25, height: 100 }, 6);
  });

  it('zero radius gives a straight segment; equal end points give nothing', () => {
    expect(arcToCubics([0, 0], 0, 10, 0, false, true, [10, 0])).toEqual([line([0, 0], [10, 0])]);
    expect(arcToCubics([5, 5], 10, 10, 0, false, true, [5, 5])).toEqual([]);
  });
});

describe('paths: roundCorners', () => {
  const sq100 = polyline([[0, 0], [100, 0], [100, 100], [0, 100]], true);
  /** Area of a square of side s with all four corners filleted at r, using KAPPA arcs. */
  const roundedSquareArea = (s: number, r: number) => s * s - 4 * r * r * (1 - KAPPA_CIRCLE_AREA / 4);

  it('fillets a square: 4 lines + 4 arcs, same bounds, exact area', () => {
    const { subpath, clamped, skipped } = roundCorners(sq100, 10);
    expect([clamped, skipped]).toEqual([0, 0]);
    expect(subpath.segs).toHaveLength(8);
    expectVec(subpath.start, [10, 0]);
    expect(subpath.segs.at(-1)!.slice(4)).toEqual([...subpath.start]);
    expect(pathBounds([subpath])).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(signedArea([subpath])).toBeCloseTo(roundedSquareArea(100, 10), 6);
  });

  it('clamps the radius to half the shorter edge: an oversized fillet turns a square into a circle', () => {
    const { subpath, clamped } = roundCorners(sq100, 100);
    expect(clamped).toBe(4);
    expect(subpath.segs).toHaveLength(4); // the zero-length lines between the arcs are dropped
    expect(signedArea([subpath])).toBeCloseTo(KAPPA_CIRCLE_AREA * 2500, 6);
  });

  it('uses d = r / tan(φ/2) and k = 4/3·tan((π − φ)/4)·r on a 60° corner', () => {
    const tri = polyline([[0, 0], [100, 0], [50, 50 * Math.sqrt(3)]], true);
    const { subpath } = roundCorners(tri, 10);
    expect(subpath.segs).toHaveLength(6);
    expectVec(subpath.start, [10 * Math.sqrt(3), 0]);
    expectVec(subpath.segs[0]!.slice(4) as unknown as Vec2, [100 - 10 * Math.sqrt(3), 0]);
    expect(subpath.segs[1]![0]).toBeCloseTo(100 - 10 * Math.sqrt(3) + (40 / 3) * Math.tan(Math.PI / 6), 9);
  });

  it('keeps the end points of an open subpath', () => {
    const { subpath } = roundCorners(polyline([[0, 0], [100, 0], [100, 100]], false), 10);
    expect(subpath.start).toEqual([0, 0]);
    expect(subpath.segs).toHaveLength(3);
    expect(subpath.segs[0]).toEqual(line([0, 0], [90, 0]));
    expect(subpath.segs[1]!.slice(4)).toEqual([100, 10]);
    expect(subpath.segs[2]!.slice(4)).toEqual([100, 100]);
  });

  it('returns the input unchanged when there is no corner to round', () => {
    const collinear = polyline([[0, 0], [50, 0], [100, 0]], false);
    expect(roundCorners(collinear, 10)).toEqual({ subpath: collinear, clamped: 0, skipped: 0 });
    const circle = kappaCircle(0, 0, 50);
    expect(roundCorners(circle, 10).subpath).toBe(circle);
    expect(roundCorners(sq100, 0).subpath).toBe(sq100);
    expect(roundCorners(sq100, -5).subpath).toBe(sq100);
  });

  it('skips corners next to a curved segment', () => {
    const sp: Subpath = { start: [0, 0], closed: false, segs: [[0, 0, 100, 0, 100, 0], [100, 30, 130, 70, 100, 100]] };
    const r = roundCorners(sp, 10);
    expect(r.skipped).toBe(1);
    expect(r.subpath).toBe(sp);
  });

  it('skips a hairpin where the path folds back on itself', () => {
    const r = roundCorners(polyline([[0, 0], [100, 0], [50, 0]], false), 10);
    expect(r.skipped).toBe(1);
  });
});

describe('paths: smooth and fit (paper)', () => {
  it('smooth passes through every point with tangent-continuous joins', () => {
    const pts: Vec2[] = [[0, 0], [50, 40], [100, 0], [150, 40], [200, 0]];
    const sp = smooth(pts, false);
    expect([sp.start, ...sp.segs.map((g) => [g[4], g[5]])]).toEqual(pts);
    for (let i = 0; i + 1 < sp.segs.length; i++) {
      const [, , c2x, c2y, x, y] = sp.segs[i]!;
      const [c1x, c1y] = sp.segs[i + 1]!;
      const inX = x - c2x, inY = y - c2y, outX = c1x - x, outY = c1y - y;
      expect(Math.abs(inX * outY - inY * outX)).toBeLessThan(1e-9); // collinear handles
      expect(inX * outX + inY * outY).toBeGreaterThan(0); // pointing the same way
    }
  });

  it('smooth is centripetal: uneven spacing does not overshoot', () => {
    // Uniform Catmull–Rom would put the first control of the short middle segment at x ≈ 116.8.
    const sp = smooth([[0, 0], [100, 0], [101, 0], [200, 0]], false);
    const [c1x, , c2x] = sp.segs[1]!;
    for (const x of [c1x, c2x]) {
      expect(x).toBeGreaterThanOrEqual(100);
      expect(x).toBeLessThanOrEqual(101);
    }
  });

  it('smooth closes the loop and ignores duplicate points', () => {
    const sp = smooth([[0, 0], [100, 0], [100, 0], [100, 100], [0, 100], [0, 0]], true);
    expect(sp.closed).toBe(true);
    expect(sp.segs).toHaveLength(4);
    expect(sp.segs.at(-1)!.slice(4)).toEqual([0, 0]);
    expect(sp.segs.flat().every(Number.isFinite)).toBe(true);
  });

  it('fit reduces 200 noisy points to far fewer segments within tolerance', () => {
    const pts = Array.from({ length: 200 }, (_, i): Vec2 => {
      const a = (i / 200) * 2 * Math.PI, r = 100 + Math.sin(i * 12.9898);
      return [Math.cos(a) * r, Math.sin(a) * r];
    });
    const sp = fit(pts, true, 2.5);
    expect(sp.segs.length).toBeLessThan(60);
    const poly = flatten(sp, 0.05);
    for (const p of pts) expect(distanceToPolyline(p, poly)).toBeLessThan(4);
  });

  it('fit tolerance is the maximum distance of any input point from the curve', () => {
    const pts = Array.from({ length: 300 }, (_, i): Vec2 => [i * 2, 50 * Math.sin(i / 20) + 2 * Math.sin(i * 12.9898)]);
    for (const tol of [0.25, 1, 5]) {
      const poly = flatten(fit(pts, false, tol), 0.01);
      for (const p of pts) expect(distanceToPolyline(p, poly)).toBeLessThanOrEqual(tol + 0.02);
    }
  });

  it('a closed fit stays within tolerance at the seam and joins smoothly there', () => {
    for (const [n, tol] of [[16, 2.5], [64, 0.5], [200, 0.5]] as const) {
      const pts = Array.from({ length: n }, (_, i): Vec2 => [100 * Math.cos((2 * Math.PI * i) / n), 100 * Math.sin((2 * Math.PI * i) / n)]);
      const sp = fit(pts, true, tol);
      expect(sp.closed).toBe(true);
      expect(sp.segs.at(-1)!.slice(4)).toEqual([...sp.start]);
      const poly = flatten(sp, 0.01);
      for (const p of pts) expect(distanceToPolyline(p, poly)).toBeLessThanOrEqual(tol + 0.02);
      const first = sp.segs[0]!, last = sp.segs.at(-1)!;
      const out: Vec2 = [first[0] - sp.start[0], first[1] - sp.start[1]];
      const inc: Vec2 = [sp.start[0] - last[2], sp.start[1] - last[3]];
      expect(Math.abs(out[0] * inc[1] - out[1] * inc[0]) / (Math.hypot(...out) * Math.hypot(...inc))).toBeLessThan(1e-6);
      expect(out[0] * inc[0] + out[1] * inc[1]).toBeGreaterThan(0);
    }
  });

  it('smooth and fit reject degenerate input', () => {
    expect(() => smooth([[1, 1], [1, 1]], false)).toThrow(RangeError);
    expect(() => fit([[1, 1]], false)).toThrow(RangeError);
    expect(() => fit([[0, 0], [1, 1]], false, 0)).toThrow(RangeError);
  });
});
