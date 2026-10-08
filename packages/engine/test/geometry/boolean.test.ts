import { describe, expect, it } from 'vitest';
import { booleanOp, type Shape } from '../../src/geometry/boolean.ts';
import { contains, rings, signedArea } from '../../src/geometry/flatten.ts';
import { ellipse, polyline } from '../../src/geometry/paths.ts';
import type { FillRule, Subpath } from '../../src/geometry/types.ts';
import { KAPPA_CIRCLE_AREA, square } from './helpers.ts';

const shape = (fillRule: FillRule, ...subpaths: Subpath[]): Shape => ({ subpaths, fillRule });
const nz = (...subpaths: Subpath[]) => shape('nonzero', ...subpaths);
const area = (s: Shape) => signedArea(s.subpaths);

/** Result invariants: closed loops that end exactly at their start, no zero-area loop, outer loops clockwise. */
function expectWellFormed(s: Shape): void {
  expect(s.fillRule).toBe('nonzero');
  for (const sp of s.subpaths) {
    expect(sp.closed).toBe(true);
    expect(sp.segs.at(-1)!.slice(4)).toEqual([...sp.start]);
    expect(Math.abs(signedArea([sp]))).toBeGreaterThan(1e-6);
  }
  if (s.subpaths.length > 0) expect(area(s)).toBeGreaterThan(0);
}

describe('boolean: known areas', () => {
  const a = nz(square(0, 0, 10)), b = nz(square(5, 5, 10));

  // exclude = 150 is the F3 regression: without reorient the two loops cancel to an area of about 0.
  it.each([
    ['union', 175],
    ['intersect', 25],
    ['subtract', 75],
    ['exclude', 150],
  ] as const)('%s of two overlapping squares', (op, expected) => {
    const r = booleanOp(op, a, b);
    expectWellFormed(r);
    expect(area(r)).toBeCloseTo(expected, 6);
  });

  it('the lens of two r = 50 circles matches the circle formula', () => {
    const r = booleanOp('intersect', nz(ellipse(0, 0, 50, 50)), nz(ellipse(50, 0, 50, 50)));
    expectWellFormed(r);
    const exact = 2 * 2500 * Math.acos(0.5) - 25 * Math.sqrt(7500);
    expect(Math.abs(area(r) - exact)).toBeLessThan(3);
  });
});

describe('boolean: regression suite (R5)', () => {
  it('edge-sharing squares unite into one loop', () => {
    const r = booleanOp('union', nz(square(0, 0, 10)), nz(square(10, 0, 10)));
    expect(r.subpaths).toHaveLength(1);
    expect(area(r)).toBeCloseTo(200, 6);
  });

  it('partially shared edge: union is one loop, intersection is empty', () => {
    expect(booleanOp('union', nz(square(0, 0, 10)), nz(square(10, 5, 10))).subpaths).toHaveLength(1);
    expect(booleanOp('intersect', nz(square(0, 0, 10)), nz(square(10, 5, 10))).subpaths).toEqual([]);
  });

  it('corner-touching squares: union keeps both, intersection is empty', () => {
    expect(area(booleanOp('union', nz(square(0, 0, 10)), nz(square(10, 10, 10))))).toBeCloseTo(200, 6);
    expect(booleanOp('intersect', nz(square(0, 0, 10)), nz(square(10, 10, 10))).subpaths).toEqual([]);
  });

  it.each([
    ['union', 100],
    ['intersect', 100],
    ['subtract', 0],
    ['exclude', 0],
  ] as const)('identical operands: %s', (op, expected) => {
    const r = booleanOp(op, nz(square(0, 0, 10)), nz(square(0, 0, 10)));
    expectWellFormed(r);
    expect(area(r)).toBeCloseTo(expected, 6);
    if (expected === 0) expect(r.subpaths).toEqual([]);
  });

  it('subtracting a nested square leaves a counter-clockwise hole', () => {
    const r = booleanOp('subtract', nz(square(0, 0, 30)), nz(square(10, 10, 10)));
    expectWellFormed(r);
    expect(r.subpaths).toHaveLength(2);
    expect(r.subpaths.map((sp) => Math.sign(signedArea([sp]))).sort()).toEqual([-1, 1]);
    expect(area(r)).toBeCloseTo(800, 6);
    const rs = rings(r.subpaths);
    expect(contains([15, 15], rs, 'nonzero')).toBe(false);
    expect(contains([5, 5], rs, 'nonzero')).toBe(true);
  });

  it('disjoint squares: union keeps both, intersection is empty, subtraction keeps A', () => {
    const a = nz(square(0, 0, 10)), b = nz(square(20, 0, 10));
    expect(booleanOp('union', a, b).subpaths).toHaveLength(2);
    expect(area(booleanOp('union', a, b))).toBeCloseTo(200, 6);
    expect(booleanOp('intersect', a, b).subpaths).toEqual([]);
    expect(area(booleanOp('subtract', a, b))).toBeCloseTo(100, 6);
  });

  it('near-tangent circles: no exception and no zero-area sliver', () => {
    const a = nz(ellipse(0, 0, 50, 50));
    expect(area(booleanOp('union', a, nz(ellipse(100 + 1e-9, 0, 50, 50))))).toBeCloseTo(2 * KAPPA_CIRCLE_AREA * 2500, 3);
    expect(booleanOp('intersect', a, nz(ellipse(100 + 1e-9, 0, 50, 50))).subpaths).toEqual([]);
    // paper returns a 4-curve loop of about zero area here; the epsilon tidy drops it.
    expect(booleanOp('intersect', a, nz(ellipse(100 - 1e-6, 0, 50, 50))).subpaths).toEqual([]);
  });

  it('honours evenodd holes in an operand', () => {
    const ring = [square(0, 0, 30), square(10, 10, 10)]; // same orientation: a hole only under evenodd
    expect(area(booleanOp('intersect', shape('evenodd', ...ring), nz(square(0, 0, 30))))).toBeCloseTo(800, 6);
    expect(area(booleanOp('intersect', shape('nonzero', ...ring), nz(square(0, 0, 30))))).toBeCloseTo(900, 6);
  });

  it('resolves a self-intersecting operand', () => {
    const bowtie = polyline([[0, 0], [10, 10], [10, 0], [0, 10]], true);
    const r = booleanOp('union', nz(bowtie), nz(square(100, 100, 1)));
    expectWellFormed(r);
    expect(r.subpaths).toHaveLength(3);
    expect(area(r)).toBeCloseTo(51, 6);
  });

  it('treats an open operand as closed, like SVG fill', () => {
    const r = booleanOp('intersect', nz(polyline([[0, 0], [10, 0], [10, 10]], false)), nz(square(0, 0, 10)));
    expectWellFormed(r);
    expect(area(r)).toBeCloseTo(50, 6);
  });

  it('handles empty operands without guessing', () => {
    const a = nz(square(0, 0, 10)), none = nz();
    expect(booleanOp('union', a, none)).toEqual(a);
    expect(booleanOp('exclude', none, a)).toEqual(a);
    expect(booleanOp('intersect', a, none).subpaths).toEqual([]);
    expect(booleanOp('subtract', none, a).subpaths).toEqual([]);
    expect(booleanOp('subtract', a, nz({ start: [0, 0], segs: [], closed: true })).subpaths).toEqual(a.subpaths);
  });

  it('is deterministic', () => {
    const run = () => booleanOp('exclude', nz(ellipse(0, 0, 50, 40)), nz(polyline([[10, -60], [70, 0], [10, 60]], true)));
    expect(run()).toEqual(run());
  });

  it('200 successive unions finish in bounded time', () => {
    let acc = nz(ellipse(0, 0, 20, 20));
    const t0 = performance.now();
    for (let i = 1; i <= 200; i++) acc = booleanOp('union', acc, nz(ellipse(i * 7, Math.sin(i) * 15, 20, 20)));
    const ms = performance.now() - t0;
    console.info(`[M1] 200 unions via booleanOp: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(5000);
    expectWellFormed(acc);
  }, 20_000);
});
