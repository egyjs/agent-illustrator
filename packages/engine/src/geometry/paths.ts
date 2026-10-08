import { cosSinDeg } from './transform.ts';
import type { Seg, Subpath, Vec2 } from './types.ts';

/** 4/3·(√2 − 1) = 4/3·tan(π/8): quarter-circle handle length per unit radius. */
const KAPPA = 0.5522847498307936;

/** Straight segment to `to`, control points on the end points (paper's zero-handle form). */
export function line(from: Vec2, to: Vec2): Seg {
  return [from[0], from[1], to[0], to[1], to[0], to[1]];
}

/** Exact degree elevation (Appendix A): C1 = P0 + ⅔(Q − P0), C2 = P2 + ⅔(Q − P2). */
export function quadToCubic(p0: Vec2, q: Vec2, p2: Vec2): Seg {
  return [
    p0[0] + (2 / 3) * (q[0] - p0[0]),
    p0[1] + (2 / 3) * (q[1] - p0[1]),
    p2[0] + (2 / 3) * (q[0] - p2[0]),
    p2[1] + (2 / 3) * (q[1] - p2[1]),
    p2[0],
    p2[1],
  ];
}

/** Drops consecutive duplicate points and, for closed input, a last point equal to the first. */
export function distinct(points: readonly Vec2[], closed: boolean): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const q = out.at(-1);
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  const first = out[0], last = out.at(-1);
  if (closed && out.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}

/** Straight segments through the points; a closed polyline ends with an explicit closing segment. */
export function polyline(points: readonly Vec2[], closed: boolean): Subpath {
  const pts = distinct(points, closed);
  const first = pts[0];
  if (!first) throw new RangeError('polyline needs at least one point');
  const segs: Seg[] = [];
  for (let i = 1; i < pts.length; i++) segs.push(line(pts[i - 1]!, pts[i]!));
  if (closed && pts.length > 1) segs.push(line(pts.at(-1)!, first));
  return { start: first, segs, closed };
}

/** Ellipse from four quarter arcs, clockwise on screen, starting at (cx + rx, cy). */
export function ellipse(cx: number, cy: number, rx: number, ry: number): Subpath {
  const kx = rx * KAPPA, ky = ry * KAPPA;
  return {
    start: [cx + rx, cy],
    closed: true,
    segs: [
      [cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
      [cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
      [cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
      [cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
    ],
  };
}

/**
 * SVG elliptical arc (endpoint form, SVG 2 implementation notes) as cubics of at most 90° each,
 * with handle length 4/3·tan(δ/4). Radii too small to reach `to` are scaled up; a zero radius gives
 * a straight segment; equal end points give no segments. The last segment ends exactly at `to`.
 */
export function arcToCubics(
  from: Vec2,
  rx: number,
  ry: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  to: Vec2,
): Seg[] {
  const [x0, y0] = from, [x1, y1] = to;
  if (x0 === x1 && y0 === y1) return [];
  let ax = Math.abs(rx), ay = Math.abs(ry);
  if (ax === 0 || ay === 0) return [line(from, to)];
  const [cos, sin] = cosSinDeg(rotationDeg);
  const dx2 = (x0 - x1) / 2, dy2 = (y0 - y1) / 2;
  const x1p = cos * dx2 + sin * dy2, y1p = -sin * dx2 + cos * dy2;
  const lambda = (x1p * x1p) / (ax * ax) + (y1p * y1p) / (ay * ay);
  if (lambda > 1) {
    ax *= Math.sqrt(lambda);
    ay *= Math.sqrt(lambda);
  }
  const ax2 = ax * ax, ay2 = ay * ay;
  const num = ax2 * ay2 - ax2 * y1p * y1p - ay2 * x1p * x1p;
  const den = ax2 * y1p * y1p + ay2 * x1p * x1p;
  const coef = (largeArc !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * ax * y1p) / ay, cyp = (-coef * ay * x1p) / ax;
  const cx = cos * cxp - sin * cyp + (x0 + x1) / 2;
  const cy = sin * cxp + cos * cyp + (y0 + y1) / 2;
  const ux = (x1p - cxp) / ax, uy = (y1p - cyp) / ay;
  const vx = (-x1p - cxp) / ax, vy = (-y1p - cyp) / ay;
  let delta = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;
  return ellipticArc(cx, cy, ax, ay, cos, sin, Math.atan2(uy, ux), delta, to);
}

/** Center-form arc from angle theta1 through delta, split into pieces of at most 90°. */
function ellipticArc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  cos: number,
  sin: number,
  theta1: number,
  delta: number,
  end: Vec2,
): Seg[] {
  const n = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / n;
  const k = (4 / 3) * Math.tan(step / 4);
  // E(θ) maps the unit circle through scale(rx, ry), the rotation and translate(cx, cy); D(θ) = dE/dθ.
  const ex = (t: number) => cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin;
  const ey = (t: number) => cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos;
  const dx = (t: number) => -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin;
  const dy = (t: number) => -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos;
  const segs: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const a = theta1 + i * step, b = a + step;
    const last = i === n - 1;
    const x3 = last ? end[0] : ex(b), y3 = last ? end[1] : ey(b);
    segs.push([ex(a) + k * dx(a), ey(a) + k * dy(a), x3 - k * dx(b), y3 - k * dy(b), x3, y3]);
  }
  return segs;
}
