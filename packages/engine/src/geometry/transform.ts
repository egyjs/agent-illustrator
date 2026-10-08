import type { Mat6, Seg, Subpath, Vec2 } from './types.ts';

export const IDENTITY: Mat6 = [1, 0, 0, 1, 0, 0];

const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** cos and sin of an angle in degrees, exact at multiples of 90° so axis-aligned results stay clean. */
export function cosSinDeg(deg: number): Vec2 {
  const q = ((deg % 360) + 360) % 360;
  if (q === 0) return [1, 0];
  if (q === 90) return [0, 1];
  if (q === 180) return [-1, 0];
  if (q === 270) return [0, -1];
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

/** Matrix product m × n: applies n first, then m (SVG transform-list order). */
export function multiply(m: Mat6, n: Mat6): Mat6 {
  const [a, b, c, d, e, f] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f];
}

/** compose(m1, m2, …) = m1 × m2 × …, the same as transform="m1 m2 …" in SVG. */
export function compose(...ms: readonly Mat6[]): Mat6 {
  return ms.reduce(multiply, IDENTITY);
}

export function translate(tx: number, ty = 0): Mat6 {
  return [1, 0, 0, 1, tx, ty];
}

export function scale(sx: number, sy = sx): Mat6 {
  return [sx, 0, 0, sy, 0, 0];
}

/** SVG rotate(deg, cx, cy): positive angles turn clockwise on screen, about the pivot (cx, cy). */
export function rotate(deg: number, cx = 0, cy = 0): Mat6 {
  const [cos, sin] = cosSinDeg(deg);
  const r: Mat6 = [cos, sin, -sin, cos, 0, 0];
  return cx === 0 && cy === 0 ? r : compose(translate(cx, cy), r, translate(-cx, -cy));
}

export function skewX(deg: number): Mat6 {
  return [1, 0, Math.tan((deg * Math.PI) / 180), 1, 0, 0];
}

export function skewY(deg: number): Mat6 {
  return [1, Math.tan((deg * Math.PI) / 180), 0, 1, 0, 0];
}

/** Inverse matrix, or null when m is singular (det ≈ 0 relative to its own terms). */
export function invert(m: Mat6): Mat6 | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) <= 1e-12 * (Math.abs(a * d) + Math.abs(b * c))) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function applyToPoint(m: Mat6, p: Vec2): Vec2 {
  const [a, b, c, d, e, f] = m;
  return [a * p[0] + c * p[1] + e, b * p[0] + d * p[1] + f];
}

/** Béziers are affine-invariant: transforming the control points transforms the curve exactly. */
export function applyToSubpaths(m: Mat6, subpaths: readonly Subpath[]): Subpath[] {
  const [a, b, c, d, e, f] = m;
  const x = (px: number, py: number) => a * px + c * py + e;
  const y = (px: number, py: number) => b * px + d * py + f;
  return subpaths.map((sp) => ({
    start: [x(sp.start[0], sp.start[1]), y(sp.start[0], sp.start[1])],
    closed: sp.closed,
    segs: sp.segs.map(
      ([c1x, c1y, c2x, c2y, ex, ey]): Seg => [x(c1x, c1y), y(c1x, c1y), x(c2x, c2y), y(c2x, c2y), x(ex, ey), y(ex, ey)],
    ),
  }));
}

/** m = translate · rotate · skewX · scale, in SVG order. A reflection shows up as a negative scale[1]. */
export type Decomposed = { readonly translate: Vec2; readonly rotate: number; readonly skewX: number; readonly scale: Vec2 };

/**
 * Columns (a, b) and (c, d) are the images of the x and y axes:
 * (a, b) = sx·(cos θ, sin θ) and (c, d) = sy·(k·cos θ − sin θ, k·sin θ + cos θ), with k = tan(skewX).
 * So sx = |(a, b)|, θ = atan2(b, a), sy = det / sx, and k = (a·c + b·d) / (sx·sy).
 */
export function decompose(m: Mat6): Decomposed {
  const [a, b, c, d, e, f] = m;
  const sx = Math.hypot(a, b);
  if (sx < 1e-12) {
    // The x axis collapsed: carry the whole linear part on the y axis.
    const sy = Math.hypot(c, d);
    return { translate: [e, f], rotate: sy < 1e-12 ? 0 : toDeg(Math.atan2(-c, d)), skewX: 0, scale: [0, sy] };
  }
  const sy = (a * d - b * c) / sx;
  const k = sy === 0 ? 0 : (a * c + b * d) / (sx * sy);
  return { translate: [e, f], rotate: toDeg(Math.atan2(b, a)), skewX: toDeg(Math.atan(k)), scale: [sx, sy] };
}

export function recompose(p: Decomposed): Mat6 {
  return compose(translate(p.translate[0], p.translate[1]), rotate(p.rotate), skewX(p.skewX), scale(p.scale[0], p.scale[1]));
}
