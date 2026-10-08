import type { Box, Cubic, Subpath, Vec2 } from './types.ts';

const TINY = 1e-12;

/** Straight cubic with control points on its end points. */
function lineCubic(x0: number, y0: number, x1: number, y1: number): Cubic {
  return [x0, y0, x0, y0, x1, y1, x1, y1];
}

/**
 * The subpath's cubics in drawing order. A closed subpath whose last segment does not end at
 * `start` gets a straight closing cubic. `closeForFill` does the same for open subpaths, because
 * SVG fills an open subpath as if it were closed.
 */
export function cubics(sp: Subpath, closeForFill = false): Cubic[] {
  const out: Cubic[] = [];
  let [x, y] = sp.start;
  for (const [c1x, c1y, c2x, c2y, ex, ey] of sp.segs) {
    out.push([x, y, c1x, c1y, c2x, c2y, ex, ey]);
    x = ex;
    y = ey;
  }
  if ((sp.closed || closeForFill) && (x !== sp.start[0] || y !== sp.start[1])) {
    out.push(lineCubic(x, y, sp.start[0], sp.start[1]));
  }
  return out;
}

/** B(t) = (1−t)³P0 + 3(1−t)²t·P1 + 3(1−t)t²·P2 + t³P3. */
export function pointAt(c: Cubic, t: number): Vec2 {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = c;
  const mt = 1 - t;
  const w0 = mt * mt * mt, w1 = 3 * mt * mt * t, w2 = 3 * mt * t * t, w3 = t * t * t;
  return [w0 * x0 + w1 * x1 + w2 * x2 + w3 * x3, w0 * y0 + w1 * y1 + w2 * y2 + w3 * y3];
}

/** B'(t) = 3[(1−t)²(P1−P0) + 2(1−t)t(P2−P1) + t²(P3−P2)]. */
export function derivativeAt(c: Cubic, t: number): Vec2 {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = c;
  const mt = 1 - t;
  const w0 = 3 * mt * mt, w1 = 6 * mt * t, w2 = 3 * t * t;
  return [w0 * (x1 - x0) + w1 * (x2 - x1) + w2 * (x3 - x2), w0 * (y1 - y0) + w1 * (y2 - y1) + w2 * (y3 - y2)];
}

/**
 * Unit tangent. Where the derivative vanishes (a control point on its end point, as in every
 * straight segment) the direction comes from the next distinct control point. A curve collapsed
 * to a point returns [1, 0].
 */
export function tangentAt(c: Cubic, t: number): Vec2 {
  const [dx, dy] = derivativeAt(c, t);
  const len = Math.hypot(dx, dy);
  if (len > TINY) return [dx / len, dy / len];
  const [x0, y0, x1, y1, x2, y2, x3, y3] = c;
  const candidates: Vec2[] =
    t <= 0.5
      ? [[x1 - x0, y1 - y0], [x2 - x0, y2 - y0], [x3 - x0, y3 - y0]]
      : [[x3 - x2, y3 - y2], [x3 - x1, y3 - y1], [x3 - x0, y3 - y0]];
  for (const [vx, vy] of candidates) {
    const l = Math.hypot(vx, vy);
    if (l > TINY) return [vx / l, vy / l];
  }
  return [1, 0];
}

/** Unit normal N = (−B'y, B'x)/|B'| (Appendix A). */
export function normalAt(c: Cubic, t: number): Vec2 {
  const [tx, ty] = tangentAt(c, t);
  return [-ty, tx];
}

/** True when both control points lie on the chord P0→P3 (within 1e-9 of its length), not past its ends. */
export function isStraight(c: Cubic): boolean {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = c;
  const dx = x3 - x0, dy = y3 - y0;
  const len2 = dx * dx + dy * dy;
  if (len2 <= TINY * TINY) return Math.hypot(x1 - x0, y1 - y0) <= TINY && Math.hypot(x2 - x0, y2 - y0) <= TINY;
  const tol = 1e-9 * len2; // cross and dot products scale with len²
  const controls: Vec2[] = [[x1 - x0, y1 - y0], [x2 - x0, y2 - y0]];
  for (const [px, py] of controls) {
    const cross = dx * py - dy * px;
    const dot = dx * px + dy * py;
    if (Math.abs(cross) > tol || dot < -tol || dot > len2 + tol) return false;
  }
  return true;
}

/** Real roots of a·t² + b·t + c = 0, numerically stable; linear when a ≈ 0. */
function quadRoots(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < TINY) return Math.abs(b) < TINY ? [] : [-c / b];
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const q = -0.5 * (b + Math.sign(b || 1) * Math.sqrt(disc));
  return q === 0 ? [0] : [q / a, c / q];
}

/** Parameters in (0, 1) where one coordinate has a zero derivative (Appendix A "Exact bounds"). */
function extremaT(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3);
  const b = 6 * (p0 - 2 * p1 + p2);
  const c = 3 * (p1 - p0);
  return quadRoots(a, b, c).filter((t) => t > 0 && t < 1);
}

/** Exact bounds of one cubic: end points plus derivative roots, never the control-point box. */
export function cubicBounds(c: Cubic): Box {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = c;
  const xs = [x0, x3], ys = [y0, y3];
  for (const t of extremaT(x0, x1, x2, x3)) xs.push(pointAt(c, t)[0]);
  for (const t of extremaT(y0, y1, y2, y3)) ys.push(pointAt(c, t)[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/** Smallest box containing every box; null for none. */
export function unionBoxes(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Exact bounds of the drawn geometry; subpaths without segments draw nothing and are ignored. */
export function pathBounds(subpaths: readonly Subpath[]): Box | null {
  return unionBoxes(subpaths.flatMap((sp) => cubics(sp).map(cubicBounds)));
}

// 5-point Gauss–Legendre nodes and weights on [−1, 1] (Appendix A "Arc length").
const GAUSS: readonly (readonly [x: number, w: number])[] = [
  [0, 0.5688888888888889],
  [-0.5384693101056831, 0.47862867049936647],
  [0.5384693101056831, 0.47862867049936647],
  [-0.906179845938664, 0.23692688505618908],
  [0.906179845938664, 0.23692688505618908],
];
// 8 pieces left a 3e-8 relative error on an S-curve whose speed (√ of a quartic) has complex roots
// near the real axis; 16 pieces bring it under 1e-10.
const LENGTH_PIECES = 16;

function speed(c: Cubic, t: number): number {
  const [dx, dy] = derivativeAt(c, t);
  return Math.hypot(dx, dy);
}

/** ∫ |B'(t)| dt over [t0, t1] with one 5-point Gauss–Legendre rule. */
function gauss(c: Cubic, t0: number, t1: number): number {
  const half = (t1 - t0) / 2, mid = (t0 + t1) / 2;
  let sum = 0;
  for (const [x, w] of GAUSS) sum += w * speed(c, mid + half * x);
  return sum * half;
}

/** Arc length from 0 to t: Gauss–Legendre on 16 equal sub-intervals. */
export function cubicLength(c: Cubic, t = 1): number {
  let sum = 0;
  for (let i = 0; i < LENGTH_PIECES; i++) sum += gauss(c, (t * i) / LENGTH_PIECES, (t * (i + 1)) / LENGTH_PIECES);
  return sum;
}

/** Cumulative arc length s at evenly spaced t; both arrays hold samples + 1 entries, s[0] = 0. */
export type LengthTable = { readonly t: Float64Array; readonly s: Float64Array };

export function lengthTable(c: Cubic, samples = 32): LengthTable {
  const t = new Float64Array(samples + 1), s = new Float64Array(samples + 1);
  let prevT = 0, acc = 0;
  for (let i = 1; i <= samples; i++) {
    const ti = i / samples;
    acc += gauss(c, prevT, ti);
    t[i] = ti;
    s[i] = acc;
    prevT = ti;
  }
  return { t, s };
}

/**
 * Parameter t where the arc length from 0 reaches s (s is clamped to [0, total]): binary search in
 * the table, linear interpolation, then Newton steps on |B'(t)| kept inside the table interval
 * (bisecting when a step would leave it). The bracket matters next to a zero derivative, as at
 * the ends of every straight segment, where s(t) ≈ k·t² and an unguarded step overshoots.
 */
export function tAtLength(c: Cubic, table: LengthTable, s: number): number {
  const acc = table.s, ts = table.t;
  const n = acc.length - 1;
  const total = acc[n]!;
  if (s <= 0 || total <= 0) return 0;
  if (s >= total) return 1;
  let lo = 0, hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (acc[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const s0 = acc[lo]!, s1 = acc[hi]!, t0 = ts[lo]!;
  let a = t0, b = ts[hi]!;
  let u = s1 > s0 ? a + ((s - s0) / (s1 - s0)) * (b - a) : a;
  for (let i = 0; i < 30; i++) {
    const f = s0 + gauss(c, t0, u) - s;
    if (Math.abs(f) <= 1e-12 * total) break;
    if (f > 0) b = u;
    else a = u;
    const v = speed(c, u);
    const next = v > TINY ? u - f / v : Number.NaN;
    u = next > a && next < b ? next : (a + b) / 2;
  }
  return u;
}

export type PathSample = { readonly point: Vec2; readonly tangent: Vec2 };
export type SubpathMeasure = { readonly length: number; at(s: number): PathSample };

/** Arc-length parameterization of the drawn subpath (no fill close); `at` clamps s to [0, length]. */
export function measure(sp: Subpath): SubpathMeasure {
  const parts = cubics(sp).map((c) => {
    const table = lengthTable(c);
    return { c, table, length: table.s[table.s.length - 1]! };
  });
  const length = parts.reduce((sum, p) => sum + p.length, 0);
  return {
    length,
    at(s: number): PathSample {
      let rest = Math.min(Math.max(s, 0), length);
      for (const [i, p] of parts.entries()) {
        if (rest <= p.length || i === parts.length - 1) {
          const t = tAtLength(p.c, p.table, rest);
          return { point: pointAt(p.c, t), tangent: tangentAt(p.c, t) };
        }
        rest -= p.length;
      }
      return { point: sp.start, tangent: [1, 0] };
    },
  };
}
