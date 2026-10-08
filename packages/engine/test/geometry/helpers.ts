import { expect } from 'vitest';
import { pointAt } from '../../src/geometry/bezier.ts';
import type { Cubic, Subpath, Vec2 } from '../../src/geometry/types.ts';

/** 4/3·(√2 − 1) = 4/3·tan(π/8): quarter-circle handle length per unit radius. */
export const KAPPA = 0.5522847498307936;
/**
 * Exact area of a circle made of four KAPPA quarter arcs, per unit r². Green's theorem on one
 * quarter gives 0.5 + 0.6k − 0.15k²; four quarters give 2 + 2.4k − 0.6k² ≈ 3.1424723 (π + 2.8e-4).
 */
export const KAPPA_CIRCLE_AREA = 2 + 2.4 * KAPPA - 0.6 * KAPPA * KAPPA;

export function expectVec(actual: Vec2, expected: Vec2, digits = 9): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
}

/** Axis-aligned square, clockwise on screen, straight segments with controls on the end points. */
export function square(x: number, y: number, s: number): Subpath {
  return {
    start: [x, y],
    closed: true,
    segs: [
      [x, y, x + s, y, x + s, y],
      [x + s, y, x + s, y + s, x + s, y + s],
      [x + s, y + s, x, y + s, x, y + s],
      [x, y + s, x, y, x, y],
    ],
  };
}

/** Circle from four KAPPA quarter arcs, clockwise on screen, starting at (cx + r, cy). */
export function kappaCircle(cx: number, cy: number, r: number): Subpath {
  const k = r * KAPPA;
  return {
    start: [cx + r, cy],
    closed: true,
    segs: [
      [cx + r, cy + k, cx + k, cy + r, cx, cy + r],
      [cx - k, cy + r, cx - r, cy + k, cx - r, cy],
      [cx - r, cy - k, cx - k, cy - r, cx, cy - r],
      [cx + k, cy - r, cx + r, cy - k, cx + r, cy],
    ],
  };
}

/** Reference arc length: a fine uniform-t polyline. */
export function polylineLength(c: Cubic, steps: number): number {
  let total = 0;
  let [px, py] = pointAt(c, 0);
  for (let i = 1; i <= steps; i++) {
    const [x, y] = pointAt(c, i / steps);
    total += Math.hypot(x - px, y - py);
    px = x;
    py = y;
  }
  return total;
}

/** Distance from p to the closest point of a polyline. */
export function distanceToPolyline(p: Vec2, pts: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i]!, [bx, by] = pts[i + 1]!;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy));
  }
  return best;
}
