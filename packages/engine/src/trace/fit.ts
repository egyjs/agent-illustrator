import { fit, polyline } from '../geometry/paths.ts';
import type { Seg, Subpath, Vec2 } from '../geometry/types.ts';

/**
 * Curve fitting for traced outlines. The outline points are accurate to a few hundredths of a pixel
 * but carry noise; fitting averages it out instead of following it: straight runs become exact lines
 * whose corners are where neighboring lines meet, a corner-free loop that is a circle becomes an exact
 * circle, and other runs are smoothed (Taubin, which does not shrink shapes) before Bézier fitting.
 */

export type FitOptions = {
  /** Largest distance (pixels) a fitted curve may stray from the smoothed outline. */
  readonly tolerance?: number;
  /** Turns sharper than this (degrees, measured over ±2.5 px of outline) are corners. */
  readonly cornerAngle?: number;
};

/** A run counts as straight when its points lie this close to their least-squares line (RMS / worst point, pixels). */
const LINE_RMS = 0.06, LINE_MAX = 0.3;
/** A corner-free loop counts as a circle when its points lie this close to the best circle (RMS, pixels). */
const CIRCLE_RMS = 0.06;
/** Taubin smoothing passes for curved runs. */
const SMOOTHING = 60;
/** Outlines shorter than this (pixels) are kept as polygons. */
const MIN_PERIMETER = 8;
/** Half the outline length (pixels) over which turning is measured. */
const SPAN = 2.5;
/** A corner may move this far (pixels) to where its neighboring lines meet. */
const CORNER_SNAP = 2;
const KAPPA = 0.5522847498307936;

const sub = (p: Vec2, q: Vec2): Vec2 => [p[0] - q[0], p[1] - q[1]];
const len = (p: Vec2) => Math.hypot(p[0], p[1]);

/** Least-squares line through points: its centroid and unit direction. */
function lineOf(ps: readonly Vec2[]): [Vec2, Vec2] {
  let mx = 0, my = 0;
  for (const p of ps) {
    mx += p[0];
    my += p[1];
  }
  mx /= ps.length;
  my /= ps.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of ps) {
    const dx = p[0] - mx, dy = p[1] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return [[mx, my], [Math.cos(angle), Math.sin(angle)]];
}

function isStraightRun(ps: readonly Vec2[]): boolean {
  if (ps.length < 3) return true;
  const [m, d] = lineOf(ps);
  let sum = 0, worst = 0;
  for (const p of ps) {
    const e = Math.abs(-d[1] * (p[0] - m[0]) + d[0] * (p[1] - m[1]));
    sum += e * e;
    worst = Math.max(worst, e);
  }
  return Math.sqrt(sum / ps.length) <= LINE_RMS && worst <= LINE_MAX;
}

/** Least-squares circle (Kåsa) through points, with the RMS of their radial distances. */
function circleOf(ps: readonly Vec2[]): { c: Vec2; r: number; rms: number } {
  const n = ps.length;
  let mx = 0, my = 0;
  for (const p of ps) {
    mx += p[0];
    my += p[1];
  }
  mx /= n;
  my /= n;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of ps) {
    const u = p[0] - mx, v = p[1] - my;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  const bu = (suuu + suvv) / 2, bv = (svvv + svuu) / 2;
  const uc = (bu * svv - bv * suv) / det, vc = (suu * bv - suv * bu) / det;
  let c: Vec2 = [mx + uc, my + vc];
  let r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  // Kåsa's algebraic fit leans toward the inside under noise; a few Gauss–Newton steps on the true distances fix that.
  for (let it = 0; it < 4; it++) {
    const m = [0, 0, 0, 0, 0, 0], g = [0, 0, 0];
    for (const p of ps) {
      const dx = p[0] - c[0], dy = p[1] - c[1], d = Math.hypot(dx, dy) || 1;
      const j = [-dx / d, -dy / d, -1], e = d - r;
      m[0]! += j[0]! * j[0]!; m[1]! += j[0]! * j[1]!; m[2]! += j[0]! * j[2]!;
      m[3]! += j[1]! * j[1]!; m[4]! += j[1]! * j[2]!; m[5]! += j[2]! * j[2]!;
      g[0]! += j[0]! * e; g[1]! += j[1]! * e; g[2]! += j[2]! * e;
    }
    const [a, b2, c2, d2, e2, f] = m as [number, number, number, number, number, number];
    const det3 = a * (d2 * f - e2 * e2) - b2 * (b2 * f - e2 * c2) + c2 * (b2 * e2 - d2 * c2);
    if (Math.abs(det3) < 1e-12) break;
    const inv = [d2 * f - e2 * e2, c2 * e2 - b2 * f, b2 * e2 - c2 * d2, a * f - c2 * c2, b2 * c2 - a * e2, a * d2 - b2 * b2].map((v) => v / det3);
    const step = [inv[0]! * g[0]! + inv[1]! * g[1]! + inv[2]! * g[2]!, inv[1]! * g[0]! + inv[3]! * g[1]! + inv[4]! * g[2]!, inv[2]! * g[0]! + inv[4]! * g[1]! + inv[5]! * g[2]!];
    c = [c[0] - step[0]!, c[1] - step[1]!];
    r -= step[2]!;
  }
  let sum = 0;
  for (const p of ps) sum += (len(sub(p, c)) - r) ** 2;
  return { c, r, rms: Math.sqrt(sum / n) };
}

function circle([x, y]: Vec2, r: number): Subpath {
  const k = KAPPA * r;
  return {
    start: [x + r, y],
    closed: true,
    segs: [
      [x + r, y + k, x + k, y + r, x, y + r],
      [x - k, y + r, x - r, y + k, x - r, y],
      [x - r, y - k, x - k, y - r, x, y - r],
      [x + k, y - r, x + r, y - k, x + r, y],
    ],
  };
}

/** Taubin λ|μ smoothing: removes jitter without shrinking. An open run keeps its end points. */
function taubin(ps: readonly Vec2[], closed: boolean, passes = SMOOTHING): Vec2[] {
  let cur = ps.map((p): Vec2 => [p[0], p[1]]);
  const n = cur.length;
  for (let it = 0; it < 2 * passes; it++) {
    const f = it % 2 === 0 ? 0.5 : -0.53;
    const next = cur.slice();
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      const p = cur[i]!, a = cur[(i - 1 + n) % n]!, b = cur[(i + 1) % n]!;
      next[i] = [p[0] + f * ((a[0] + b[0]) / 2 - p[0]), p[1] + f * ((a[1] + b[1]) / 2 - p[1])];
    }
    cur = next;
  }
  return cur;
}

/** One traced outline (a closed polygon in pixels) as a smooth subpath. */
export function fitLoop(loop: readonly Vec2[], options: FitOptions = {}): Subpath {
  const tolerance = options.tolerance ?? 0.04;
  const cornerAngle = options.cornerAngle ?? 35;
  const n = loop.length;
  let perimeter = 0;
  for (let i = 0; i < n; i++) perimeter += len(sub(loop[(i + 1) % n]!, loop[i]!));
  if (perimeter < MIN_PERIMETER) return polyline(loop, true);

  /** The index about `dist` pixels of outline away from i (negative: backwards). */
  const away = (i: number, dist: number): number => {
    const step = dist > 0 ? 1 : -1;
    let j = i, walked = 0;
    while (walked < Math.abs(dist) && Math.abs(j - i) < n) {
      const a = ((j % n) + n) % n, b = (((j + step) % n) + n) % n;
      walked += len(sub(loop[b]!, loop[a]!));
      j += step;
    }
    return ((j % n) + n) % n;
  };
  const turn = loop.map((p, i) => {
    const u = sub(p, loop[away(i, -SPAN)]!), w = sub(loop[away(i, SPAN)]!, p);
    const cos = (u[0] * w[0] + u[1] * w[1]) / (len(u) * len(w) || 1);
    return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  });
  const corners: number[] = [];
  for (let i = 0; i < n; i++) {
    if (turn[i]! < cornerAngle) continue;
    let peak = true;
    for (let d = 1; d <= 3 && peak; d++) if (turn[(i + d) % n]! > turn[i]! || turn[(i - d + n) % n]! >= turn[i]!) peak = false;
    if (peak) corners.push(i);
  }

  if (corners.length === 0) {
    const round = circleOf(loop);
    if (round.rms <= CIRCLE_RMS) return circle(round.c, round.r);
    return fit(taubin(loop, true), true, tolerance);
  }

  const runs: Vec2[][] = corners.map((c, k) => {
    const end = corners[(k + 1) % corners.length]!;
    const run: Vec2[] = [];
    for (let i = c; run.length <= n + 1; i = (i + 1) % n) {
      run.push(loop[i]!);
      if (i === end && run.length > 1) break;
    }
    return run;
  });
  // Marching squares cuts sharp corners off; where both sides are straight, the corner is where their lines meet.
  const vertex: Vec2[] = corners.map((c) => loop[c]!);
  corners.forEach((_, k) => {
    const before = runs[(k - 1 + runs.length) % runs.length]!, after = runs[k]!;
    const inner = (r: Vec2[]) => r.slice(Math.min(3, r.length >> 2), r.length - Math.min(3, r.length >> 2));
    const pa = inner(before), pb = inner(after);
    if (pa.length < 3 || pb.length < 3 || !isStraightRun(pa) || !isStraightRun(pb)) return;
    const [m1, d1] = lineOf(pa), [m2, d2] = lineOf(pb);
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-6) return;
    const s = ((m2[0] - m1[0]) * d2[1] - (m2[1] - m1[1]) * d2[0]) / den;
    const meet: Vec2 = [m1[0] + s * d1[0], m1[1] + s * d1[1]];
    if (len(sub(meet, vertex[k]!)) < CORNER_SNAP) vertex[k] = meet;
  });
  const segs: Seg[] = [];
  runs.forEach((run, k) => {
    const pts = [vertex[k]!, ...run.slice(1, -1), vertex[(k + 1) % runs.length]!];
    const piece = isStraightRun(pts) ? polyline([pts[0]!, pts.at(-1)!], false) : fit(taubin(pts, false), false, tolerance);
    segs.push(...piece.segs);
  });
  return { start: vertex[0]!, segs, closed: true };
}
