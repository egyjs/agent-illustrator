import { cubics, isStraight, pointAt } from './bezier.ts';
import type { Cubic, FillRule, Subpath, Vec2 } from './types.ts';

/** Upper bound on pieces per cubic. Past it the tolerance is not met; input size caps belong to ops. */
export const MAX_FLATTEN_STEPS = 1024;

/**
 * Polyline through one cubic within `tolerance`, both end points included. Wang's formula:
 * n = ⌈√(3M / (4·tol))⌉ with M = max(|P0 − 2P1 + P2|, |P1 − 2P2 + P3|). Straight cubics need one piece.
 */
export function flattenCubic(c: Cubic, tolerance: number): Vec2[] {
  if (!(tolerance > 0)) throw new RangeError(`tolerance must be > 0, got ${tolerance}`);
  const [x0, y0, x1, y1, x2, y2, x3, y3] = c;
  if (isStraight(c)) return [[x0, y0], [x3, y3]];
  const m = Math.max(Math.hypot(x0 - 2 * x1 + x2, y0 - 2 * y1 + y2), Math.hypot(x1 - 2 * x2 + x3, y1 - 2 * y2 + y3));
  const n = Math.min(MAX_FLATTEN_STEPS, Math.max(1, Math.ceil(Math.sqrt((3 * m) / (4 * tolerance)))));
  const pts: Vec2[] = [[x0, y0]];
  for (let i = 1; i < n; i++) pts.push(pointAt(c, i / n));
  pts.push([x3, y3]);
  return pts;
}

function polylineOf(sp: Subpath, tolerance: number, closeForFill: boolean): Vec2[] {
  const pts: Vec2[] = [sp.start];
  for (const c of cubics(sp, closeForFill)) pts.push(...flattenCubic(c, tolerance).slice(1));
  return pts;
}

/** Polyline through the drawn subpath; a closed subpath ends with a copy of its start point. */
export function flatten(sp: Subpath, tolerance = 0.25): Vec2[] {
  return polylineOf(sp, tolerance, false);
}

/** A closed polygon: its last point equals its first. */
export type Ring = readonly Vec2[];

/** One ring per drawn subpath, for fill tests. Open subpaths are closed, as SVG fills them. */
export function rings(subpaths: readonly Subpath[], tolerance = 0.25): Ring[] {
  return subpaths.filter((sp) => sp.segs.length > 0).map((sp) => polylineOf(sp, tolerance, true));
}

/**
 * Winding number of p (Sunday's crossing rule). A ring that runs clockwise on screen, like the
 * engine's shapes, counts +1 inside. Points within the flattening tolerance of an edge may land on
 * either side.
 */
export function windingNumber(p: Vec2, rs: readonly Ring[]): number {
  const [px, py] = p;
  let wn = 0;
  for (const ring of rs) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const [ax, ay] = ring[i]!, [bx, by] = ring[i + 1]!;
      const side = (bx - ax) * (py - ay) - (px - ax) * (by - ay);
      if (ay <= py) {
        if (by > py && side > 0) wn++;
      } else if (by <= py && side < 0) wn--;
    }
  }
  return wn;
}

export function contains(p: Vec2, rs: readonly Ring[], fillRule: FillRule): boolean {
  const wn = windingNumber(p, rs);
  return fillRule === 'nonzero' ? wn !== 0 : wn % 2 !== 0;
}

/**
 * Exact signed area enclosed by the subpaths: Green's theorem in closed form per cubic, with no
 * flattening. Open subpaths are closed as for fill. Positive means clockwise on screen.
 * Overlapping loops add up, so this is the covered area only for non-overlapping, consistently
 * oriented loops, such as reoriented boolean results.
 */
export function signedArea(subpaths: readonly Subpath[]): number {
  let sum = 0;
  for (const sp of subpaths) {
    for (const [x0, y0, x1, y1, x2, y2, x3, y3] of cubics(sp, true)) {
      sum +=
        (3 *
          ((y3 - y0) * (x1 + x2) -
            (x3 - x0) * (y1 + y2) +
            y1 * (x0 - x2) -
            x1 * (y0 - y2) +
            y3 * (x2 + x0 / 3) -
            x3 * (y2 + y0 / 3))) /
        20;
    }
  }
  return sum;
}
