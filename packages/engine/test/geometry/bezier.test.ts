import { describe, expect, it } from 'vitest';
import {
  cubicBounds,
  cubicLength,
  cubics,
  derivativeAt,
  isStraight,
  lengthTable,
  measure,
  normalAt,
  pathBounds,
  pointAt,
  tAtLength,
  tangentAt,
} from '../../src/geometry/bezier.ts';
import type { Cubic, Subpath } from '../../src/geometry/types.ts';
import { expectVec, KAPPA, kappaCircle, polylineLength, square } from './helpers.ts';

const K = 100 * KAPPA;
/** Quarter circle r = 100 around the origin, from (100, 0) to (0, 100). */
const quarter: Cubic = [100, 0, 100, K, K, 100, 0, 100];
/** S-curve with two interior x extremes at ±50/√3. */
const sCurve: Cubic = [0, 0, 100, 0, -100, 100, 0, 100];
/** Straight line with control points on its end points: zero derivative at both ends. */
const line: Cubic = [0, 0, 0, 0, 30, 40, 30, 40];
const dot: Cubic = [5, 5, 5, 5, 5, 5, 5, 5];

describe('bezier: evaluation', () => {
  it('hits the end points exactly and the circle at t = 0.5', () => {
    expect(pointAt(quarter, 0)).toEqual([100, 0]);
    expect(pointAt(quarter, 1)).toEqual([0, 100]);
    expectVec(pointAt(quarter, 0.5), [100 * Math.SQRT1_2, 100 * Math.SQRT1_2]);
  });

  it('derivative at t = 0 is 3·(P1 − P0)', () => {
    expectVec(derivativeAt(quarter, 0), [0, 3 * K]);
  });

  it('tangent and normal are unit vectors, normal = (−ty, tx)', () => {
    expectVec(tangentAt(quarter, 0), [0, 1]);
    expectVec(normalAt(quarter, 0), [-1, 0]);
    const [tx, ty] = tangentAt(quarter, 0.37);
    expect(Math.hypot(tx, ty)).toBeCloseTo(1, 12);
  });

  it('tangentAt falls back to the chord where the derivative vanishes', () => {
    expect(derivativeAt(line, 0)).toEqual([0, 0]);
    expectVec(tangentAt(line, 0), [0.6, 0.8]);
    expectVec(tangentAt(line, 1), [0.6, 0.8]);
    expect(tangentAt(dot, 0.5)).toEqual([1, 0]);
  });

  it('isStraight accepts endpoint and third-point controls, rejects bends and overshoot', () => {
    expect(isStraight(line)).toBe(true);
    expect(isStraight([0, 0, 10, 0, 20, 0, 30, 0])).toBe(true);
    expect(isStraight(quarter)).toBe(false);
    expect(isStraight([0, 0, 40, 0, 20, 0, 30, 0])).toBe(false); // control past the end: overshoots
    expect(isStraight(dot)).toBe(true);
  });
});

describe('bezier: exact bounds', () => {
  it('uses derivative roots, not the control-point box', () => {
    // Arch: the control box is 100 tall, the curve peaks at y = 75 (t = 0.5).
    expect(cubicBounds([0, 0, 0, 100, 100, 100, 100, 0])).toEqual({ x: 0, y: 0, width: 100, height: 75 });
  });

  it('finds both interior x extremes of an S-curve', () => {
    const b = cubicBounds(sCurve);
    expect(b.x).toBeCloseTo(-50 / Math.sqrt(3), 9);
    expect(b.width).toBeCloseTo(100 / Math.sqrt(3), 9);
    expect(b.y).toBe(0);
    expect(b.height).toBe(100);
  });

  it('a circle of four quarter arcs has bounds exactly ±r around its center', () => {
    expect(pathBounds([kappaCircle(10, 20, 100)])).toEqual({ x: -90, y: -80, width: 200, height: 200 });
  });

  it('pathBounds unions subpaths and returns null when nothing is drawn', () => {
    expect(pathBounds([square(0, 0, 10), square(20, 5, 10)])).toEqual({ x: 0, y: 0, width: 30, height: 15 });
    expect(pathBounds([])).toBeNull();
    expect(pathBounds([{ start: [5, 5], segs: [], closed: false }])).toBeNull();
  });
});

describe('bezier: cubics', () => {
  it('cubics adds a straight closing cubic only when a closed subpath does not end at start', () => {
    expect(cubics(square(0, 0, 10))).toHaveLength(4);
    const implicit: Subpath = { start: [0, 0], closed: true, segs: [[0, 0, 10, 0, 10, 0], [10, 0, 10, 10, 10, 10]] };
    expect(cubics(implicit)).toHaveLength(3);
    expect(cubics(implicit)[2]).toEqual([10, 10, 10, 10, 0, 0, 0, 0]);
    const open: Subpath = { ...implicit, closed: false };
    expect(cubics(open)).toHaveLength(2);
    expect(cubics(open, true)).toHaveLength(3);
  });
});

describe('bezier: arc length', () => {
  it('is exact for straight lines, whatever the control spacing', () => {
    expect(cubicLength(line)).toBeCloseTo(50, 9);
    expect(cubicLength([0, 0, 10, 0, 20, 0, 30, 0])).toBeCloseTo(30, 9);
    expect(cubicLength([0, 0, 10, 0, 20, 0, 30, 0], 0.5)).toBeCloseTo(15, 9);
  });

  it('matches a 100 000-step polyline on a quarter circle and an S-curve', () => {
    for (const c of [quarter, sCurve]) expect(cubicLength(c)).toBeCloseTo(polylineLength(c, 100_000), 5);
    expect(Math.abs(cubicLength(quarter) - 50 * Math.PI)).toBeLessThan(0.05);
  });

  it('tAtLength inverts the table to 1e-6 and clamps out-of-range lengths', () => {
    const table = lengthTable(quarter);
    for (const t of [0.05, 0.3, 0.5, 0.77, 0.99]) {
      expect(tAtLength(quarter, table, cubicLength(quarter, t))).toBeCloseTo(t, 6);
    }
    expect(tAtLength(quarter, table, -1)).toBe(0);
    expect(tAtLength(quarter, table, 1e9)).toBe(1);
  });

  it('inverts arc length exactly next to zero-derivative ends', () => {
    const m = measure(square(0, 0, 1000));
    for (const s of [0.1, 1, 31, 500, 969, 999.5]) expectVec(m.at(s).point, [s, 0], 6);
    const cusp: Cubic = [0, 0, 0, 0, 100, 0, 100, 100];
    const table = lengthTable(cusp);
    for (const t of [0.001, 0.01, 0.02, 0.5, 0.98, 0.999]) {
      expect(tAtLength(cusp, table, cubicLength(cusp, t))).toBeCloseTo(t, 8);
    }
  });

  it('handles a curve collapsed to a point', () => {
    expect(cubicLength(dot)).toBe(0);
    expect(tAtLength(dot, lengthTable(dot), 3)).toBe(0);
    expect(cubicBounds(dot)).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });
});

describe('bezier: measure', () => {
  it('walks a square by arc length, with clamping at both ends', () => {
    const m = measure(square(0, 0, 10));
    expect(m.length).toBeCloseTo(40, 9);
    expectVec(m.at(12).point, [10, 2], 6);
    expectVec(m.at(12).tangent, [0, 1]);
    expectVec(m.at(-5).point, [0, 0]);
    expectVec(m.at(0).tangent, [1, 0]);
    expectVec(m.at(1000).point, [0, 0]);
  });

  it('an empty subpath has length 0 and stays at its start', () => {
    const m = measure({ start: [3, 4], segs: [], closed: false });
    expect(m.length).toBe(0);
    expect(m.at(5).point).toEqual([3, 4]);
  });
});
