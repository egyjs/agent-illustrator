import type { Vec2 } from '../geometry/types.ts';
import type { Coverage } from './coverage.ts';

/**
 * How much of each pixel layer `k` paints, 0..1. Layers are drawn in palette order. "abutting": the
 * layer's own coverage, plus the colors drawn above it within `reach` pixels of it, so it runs a hidden
 * strip under its neighbors above (no gaps) while its visible edges stay exact. "stacked": its own
 * coverage plus every color above it, everywhere.
 */
export function layerField(cov: Coverage, width: number, height: number, k: number, method: 'abutting' | 'stacked', reach = 2): Float32Array {
  const { a, b, t, transparent } = cov;
  const n = width * height;
  const own = new Float32Array(n), above = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ai = a[i]!, bi = b[i]!, ti = t[i]!;
    if (ai === k) own[i]! += ti;
    if (bi === k && bi !== ai) own[i]! += 1 - ti;
    if (ai !== transparent && ai > k) above[i]! += ti;
    if (bi !== transparent && bi > k && bi !== ai) above[i]! += 1 - ti;
  }
  if (method === 'stacked') {
    for (let i = 0; i < n; i++) own[i] = Math.min(1, own[i]! + above[i]!);
    return own;
  }
  // Pixels within `reach` (square neighborhood) of any pixel the layer touches: rows, then columns.
  const row = new Uint8Array(n), near = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    let last = -Infinity;
    for (let x = 0; x < width; x++) {
      if (own[y * width + x]! > 0) last = x;
      if (x - last <= reach) row[y * width + x] = 1;
    }
    last = Infinity;
    for (let x = width - 1; x >= 0; x--) {
      if (own[y * width + x]! > 0) last = x;
      if (last - x <= reach) row[y * width + x] = 1;
    }
  }
  for (let x = 0; x < width; x++) {
    let last = -Infinity;
    for (let y = 0; y < height; y++) {
      if (row[y * width + x]) last = y;
      if (y - last <= reach) near[y * width + x] = 1;
    }
    last = Infinity;
    for (let y = height - 1; y >= 0; y--) {
      if (row[y * width + x]) last = y;
      if (last - y <= reach) near[y * width + x] = 1;
    }
  }
  for (let i = 0; i < n; i++) if (near[i]) own[i] = Math.min(1, own[i]! + above[i]!);
  return own;
}

/** Signed distance (pixels, + inside) from a pixel's center to a straight edge that covers fraction `c` of it, with unit normal `n`. */
function edgeDistance(c: number, n: Vec2): number {
  const p = Math.max(Math.abs(n[0]), Math.abs(n[1])), q = Math.min(Math.abs(n[0]), Math.abs(n[1]));
  if (q < 1e-6) return c - 0.5;
  const knee = q / (2 * p);
  if (c < knee) return -(p + q) / 2 + Math.sqrt(2 * p * q * c);
  if (c > 1 - knee) return (p + q) / 2 - Math.sqrt(2 * p * q * (1 - c));
  return p * (c - 0.5);
}

/**
 * The closed outlines where a w×h coverage field crosses ½ (outside the image counts as 0), in image
 * coordinates with pixel centers at +0.5: marching squares, with each crossing placed by the edge
 * distance that its partly covered pixels imply, not by linear interpolation between pixel centers.
 * Holes and islands come out as separate loops; fill them evenodd.
 */
export function isolines(field: Float32Array, width: number, height: number): Vec2[][] {
  const W = width + 2;
  const v = (i: number, j: number): number => (i < 1 || j < 1 || i > width || j > height ? 0 : field[(j - 1) * width + (i - 1)]!);
  const points = new Map<number, Vec2>();
  const links = new Map<number, number[]>();
  const crossing = (id: number, i0: number, j0: number, i1: number, j1: number): number => {
    if (points.has(id)) return id;
    const c0 = v(i0, j0), c1 = v(i1, j1);
    let s = (0.5 - c0) / (c1 - c0);
    const g: Vec2 = [(v(i0 + 1, j0) - v(i0 - 1, j0) + v(i1 + 1, j1) - v(i1 - 1, j1)) / 2, (v(i0, j0 + 1) - v(i0, j0 - 1) + v(i1, j1 + 1) - v(i1, j1 - 1)) / 2];
    const gl = Math.hypot(g[0], g[1]);
    if (gl > 1e-9) {
      const n: Vec2 = [g[0] / gl, g[1] / gl];
      const step = (i1 - i0) * n[0] + (j1 - j0) * n[1];
      const est: number[] = [];
      if (Math.abs(step) > 1e-6) {
        if (c0 > 0 && c0 < 1) est.push(-edgeDistance(c0, n) / step);
        if (c1 > 0 && c1 < 1) est.push(1 - edgeDistance(c1, n) / step);
      }
      if (est.length > 0) s = Math.min(1, Math.max(0, est.reduce((x, y) => x + y, 0) / est.length));
      else if ((c0 <= 0 || c0 >= 1) && (c1 <= 0 || c1 >= 1)) s = 0.5;
    }
    points.set(id, [i0 + s * (i1 - i0) - 0.5, j0 + s * (j1 - j0) - 0.5]);
    return id;
  };
  const link = (p: number, q: number) => {
    for (const [x, y] of [[p, q], [q, p]] as const) {
      const l = links.get(x);
      if (l) l.push(y);
      else links.set(x, [y]);
    }
  };
  for (let j = 0; j < height + 1; j++) {
    for (let i = 0; i < width + 1; i++) {
      const tl = v(i, j), tr = v(i + 1, j), br = v(i + 1, j + 1), bl = v(i, j + 1);
      const c = (tl >= 0.5 ? 8 : 0) | (tr >= 0.5 ? 4 : 0) | (br >= 0.5 ? 2 : 0) | (bl >= 0.5 ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const top = () => crossing(2 * (j * W + i), i, j, i + 1, j);
      const right = () => crossing(2 * (j * W + i + 1) + 1, i + 1, j, i + 1, j + 1);
      const bottom = () => crossing(2 * ((j + 1) * W + i), i, j + 1, i + 1, j + 1);
      const left = () => crossing(2 * (j * W + i) + 1, i, j, i, j + 1);
      const joined = (tl + tr + br + bl) / 4 >= 0.5;
      if (c === 1 || c === 14) link(left(), bottom());
      else if (c === 2 || c === 13) link(bottom(), right());
      else if (c === 3 || c === 12) link(left(), right());
      else if (c === 4 || c === 11) link(top(), right());
      else if (c === 6 || c === 9) link(top(), bottom());
      else if (c === 7 || c === 8) link(top(), left());
      else if ((c === 5) === joined) {
        // saddles: case 5 joined, or case 10 apart, cut off the top-left and bottom-right corners
        link(top(), left());
        link(bottom(), right());
      } else {
        link(top(), right());
        link(left(), bottom());
      }
    }
  }
  const seen = new Set<number>();
  const loops: Vec2[][] = [];
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const loop: Vec2[] = [];
    let prev = -1;
    let cur: number | undefined = start;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      loop.push(points.get(cur)!);
      const next: number[] = links.get(cur)!;
      const to: number | undefined = next[0] !== prev ? next[0] : next[1];
      prev = cur;
      cur = to;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Signed area of a closed polygon (shoelace). */
export function loopArea(loop: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i]!, q = loop[(i + 1) % loop.length]!;
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}
