import { describe, expect, it } from 'vitest';
import {
  applyToPoint,
  applyToSubpaths,
  compose,
  decompose,
  IDENTITY,
  invert,
  multiply,
  recompose,
  rotate,
  scale,
  skewX,
  skewY,
  translate,
} from '../../src/geometry/transform.ts';
import type { Mat6 } from '../../src/geometry/types.ts';
import { expectVec, square } from './helpers.ts';

function expectMat(actual: Mat6 | null, expected: Mat6, digits = 9): void {
  expect(actual).not.toBeNull();
  actual!.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, digits));
}

const general = compose(translate(5, -3), rotate(33), scale(2, -0.5), skewX(12));

describe('transform: construction and composition', () => {
  it('composes in SVG transform-list order (the last matrix applies first)', () => {
    expectVec(applyToPoint(compose(translate(10, 0), scale(2)), [1, 1]), [12, 2]);
    expectVec(applyToPoint(multiply(translate(10, 0), scale(2)), [1, 1]), [12, 2]);
    expectVec(applyToPoint(compose(scale(2), translate(10, 0)), [1, 1]), [22, 2]);
  });

  it('IDENTITY is neutral and compose() of nothing is IDENTITY', () => {
    expect(compose()).toEqual(IDENTITY);
    expectMat(multiply(IDENTITY, general), general);
    expectMat(multiply(general, IDENTITY), general);
  });

  it('rotates clockwise on screen, exactly at multiples of 90°', () => {
    expectVec(applyToPoint(rotate(90), [1, 0]), [0, 1]);
    expectVec(applyToPoint(rotate(180), [1, 0]), [-1, 0]);
    expectVec(applyToPoint(rotate(30), [1, 0]), [Math.sqrt(3) / 2, 0.5]);
  });

  it('rotates about a pivot: T(p)·R(θ)·T(−p)', () => {
    expectVec(applyToPoint(rotate(90, 10, 10), [20, 10]), [10, 20]);
    expectVec(applyToPoint(rotate(57, 10, 10), [10, 10]), [10, 10]);
  });

  it('skews like SVG skewX/skewY', () => {
    expectVec(applyToPoint(skewX(45), [0, 10]), [10, 10]);
    expectVec(applyToPoint(skewY(45), [10, 0]), [10, 10]);
  });
});

describe('transform: invert', () => {
  it('m × invert(m) is the identity', () => {
    expectMat(multiply(general, invert(general)!), IDENTITY);
    expectMat(multiply(invert(general)!, general), IDENTITY);
  });

  it('returns null for singular matrices but inverts tiny scales', () => {
    expect(invert(scale(0, 1))).toBeNull();
    expect(invert([1, 2, 2, 4, 0, 0])).toBeNull();
    expect(invert([0, 0, 0, 0, 3, 4])).toBeNull();
    expectMat(invert(scale(1e-7)), scale(1e7), 0);
  });
});

describe('transform: decompose', () => {
  it('recovers translate, rotate and scale', () => {
    const d = decompose(compose(translate(10, 20), rotate(30), scale(2, 3)));
    expectVec(d.translate, [10, 20]);
    expect(d.rotate).toBeCloseTo(30, 9);
    expect(d.skewX).toBeCloseTo(0, 9);
    expectVec(d.scale, [2, 3]);
  });

  it('reports a reflection as a negative y scale', () => {
    const d = decompose(scale(-1, 1));
    expect(d.rotate).toBeCloseTo(180, 9);
    expectVec(d.scale, [1, -1]);
    expectMat(recompose(d), scale(-1, 1));
  });

  it('recompose(decompose(m)) ≈ m, singular matrices included', () => {
    const cases: Mat6[] = [
      IDENTITY,
      translate(7, -2),
      rotate(30, 10, 20),
      scale(2, 3),
      scale(-1, 1),
      skewX(20),
      general,
      scale(0, 2),
    ];
    for (const m of cases) expectMat(recompose(decompose(m)), m);
  });
});

describe('transform: apply to subpaths', () => {
  it('moves control points exactly and keeps closed subpaths closed', () => {
    expect(applyToSubpaths(translate(5, 5), [square(0, 0, 10)])).toEqual([square(5, 5, 10)]);
    const [turned] = applyToSubpaths(rotate(33, 4, 7), [square(0, 0, 10)]);
    expect(turned!.segs.at(-1)!.slice(4)).toEqual([...turned!.start]);
  });
});
