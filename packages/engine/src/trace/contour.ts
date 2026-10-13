import type { Vec2 } from '../geometry/types.ts';
import type { Coverage } from './coverage.ts';

/** A rectangle of pixels: columns x..x+width−1, rows y..y+height−1. */
export type PixelBox = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/** The pixels each of the first `n` palette colors covers at all, as boxes (undefined for a color with none). */
export function colorBoxes(cov: Coverage, width: number, height: number, n: number): (PixelBox | undefined)[] {
  const x0 = new Array<number>(n).fill(Infinity), y0 = x0.slice(), x1 = new Array<number>(n).fill(-Infinity), y1 = x1.slice();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      for (const k of [cov.a[i]!, cov.b[i]!]) {
        if (k >= n) continue;
        if (x < x0[k]!) x0[k] = x;
        if (x > x1[k]!) x1[k] = x;
        if (y < y0[k]!) y0[k] = y;
        if (y > y1[k]!) y1[k] = y;
      }
    }
  }
  return x0.map((x, k) => (x === Infinity ? undefined : { x, y: y0[k]!, width: x1[k]! - x + 1, height: y1[k]! - y0[k]! + 1 }));
}

/** `box` grown by `by` pixels on every side, kept inside a width×height image. */
export function grow(box: PixelBox, by: number, width: number, height: number): PixelBox {
  const x = Math.max(0, box.x - by), y = Math.max(0, box.y - by);
  return { x, y, width: Math.min(width, box.x + box.width + by) - x, height: Math.min(height, box.y + box.height + by) - y };
}

/** The smallest box holding all of `boxes`, or undefined when there are none. */
export function union(boxes: readonly (PixelBox | undefined)[]): PixelBox | undefined {
  const some = boxes.filter((b): b is PixelBox => b !== undefined);
  if (some.length === 0) return undefined;
  const x = Math.min(...some.map((b) => b.x)), y = Math.min(...some.map((b) => b.y));
  return { x, y, width: Math.max(...some.map((b) => b.x + b.width)) - x, height: Math.max(...some.map((b) => b.y + b.height)) - y };
}

/**
 * How much of each pixel layer `k` paints, 0..1. Layers are drawn in palette order. "abutting": the
 * layer's own coverage, plus the colors drawn above it within `reach` pixels of it, so it runs a hidden
 * strip under its neighbors above (no gaps) while its visible edges stay exact. "stacked": its own
 * coverage plus every color above it, everywhere. Only pixels inside `box` are computed (it must hold
 * every pixel the layer paints); the rest stay 0.
 */
export function layerField(cov: Coverage, width: number, height: number, k: number, method: 'abutting' | 'stacked', reach = 2, box: PixelBox = { x: 0, y: 0, width, height }): Float32Array {
  const { a, b, t, transparent } = cov;
  const n = width * height;
  const own = new Float32Array(n), above = new Float32Array(n);
  const { x: bx, y: by, width: bw, height: bh } = box;
  for (let y = by; y < by + bh; y++) {
    for (let i = y * width + bx, end = i + bw; i < end; i++) {
      const ai = a[i]!, bi = b[i]!, ti = t[i]!;
      if (ai === k) own[i]! += ti;
      if (bi === k && bi !== ai) own[i]! += 1 - ti;
      if (ai !== transparent && ai > k) above[i]! += ti;
      if (bi !== transparent && bi > k && bi !== ai) above[i]! += 1 - ti;
    }
  }
  if (method === 'stacked') {
    for (let y = by; y < by + bh; y++) for (let i = y * width + bx, end = i + bw; i < end; i++) own[i] = Math.min(1, own[i]! + above[i]!);
    return own;
  }
  // Pixels within `reach` (square neighborhood) of any pixel the layer touches: rows, then columns.
  const row = new Uint8Array(n), near = new Uint8Array(n);
  for (let y = by; y < by + bh; y++) {
    let last = -Infinity;
    for (let x = bx; x < bx + bw; x++) {
      if (own[y * width + x]! > 0) last = x;
      if (x - last <= reach) row[y * width + x] = 1;
    }
    last = Infinity;
    for (let x = bx + bw - 1; x >= bx; x--) {
      if (own[y * width + x]! > 0) last = x;
      if (last - x <= reach) row[y * width + x] = 1;
    }
  }
  for (let x = bx; x < bx + bw; x++) {
    let last = -Infinity;
    for (let y = by; y < by + bh; y++) {
      if (row[y * width + x]) last = y;
      if (y - last <= reach) near[y * width + x] = 1;
    }
    last = Infinity;
    for (let y = by + bh - 1; y >= by; y--) {
      if (row[y * width + x]) last = y;
      if (last - y <= reach) near[y * width + x] = 1;
    }
  }
  for (let y = by; y < by + bh; y++) for (let i = y * width + bx, end = i + bw; i < end; i++) if (near[i]) own[i] = Math.min(1, own[i]! + above[i]!);
  return own;
}

/**
 * The field blurred with the [1 2 1]/4 kernel twice per axis (about a Gaussian of σ = 1 pixel), inside
 * `box` (grown by 2 so the blur can spread); the image's edge pixels repeat outward, so shapes keep
 * the image border. A symmetric blur keeps a straight edge where it is; it rounds corners a little and
 * merges the speckle that noise leaves along boundaries.
 */
export function smoothField(field: Float32Array, width: number, height: number, box: PixelBox = { x: 0, y: 0, width, height }): Float32Array {
  const { x: bx, y: by, width: bw, height: bh } = grow(box, 2, width, height);
  let cur = field;
  for (let pass = 0; pass < 2; pass++) {
    const tmp = new Float32Array(cur.length), out = new Float32Array(cur.length);
    for (let y = by; y < by + bh; y++) {
      for (let x = bx; x < bx + bw; x++) {
        const i = y * width + x;
        tmp[i] = (2 * cur[i]! + cur[x > 0 ? i - 1 : i]! + cur[x < width - 1 ? i + 1 : i]!) / 4;
      }
    }
    for (let y = by; y < by + bh; y++) {
      for (let x = bx; x < bx + bw; x++) {
        const i = y * width + x;
        out[i] = (2 * tmp[i]! + tmp[y > 0 ? i - width : i]! + tmp[y < height - 1 ? i + width : i]!) / 4;
      }
    }
    cur = out;
  }
  return cur;
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
 * Holes and islands come out as separate loops; fill them evenodd. Only `box` is scanned: the field
 * must be 0 outside it. `linear` interpolates between pixel centers instead, which is right for a
 * smoothed field (it is no longer pixel coverage).
 */
export function isolines(field: Float32Array, width: number, height: number, box: PixelBox = { x: 0, y: 0, width, height }, linear = false): Vec2[][] {
  const { x: bx, y: by, width: bw, height: bh } = box;
  const W = bw + 2, H = bh + 2;
  // Local padded node (i, j) is pixel (bx + i − 1, by + j − 1); outside the box everything is 0.
  const v = (i: number, j: number): number => (i < 1 || j < 1 || i > bw || j > bh ? 0 : field[(by + j - 1) * width + (bx + i - 1)]!);
  const edges = 2 * W * H;
  const px = new Float64Array(edges), py = new Float64Array(edges), placed = new Uint8Array(edges);
  const links = new Int32Array(2 * edges).fill(-1);
  const crossing = (id: number, i0: number, j0: number, i1: number, j1: number): number => {
    if (placed[id]) return id;
    const c0 = v(i0, j0), c1 = v(i1, j1);
    let s = (0.5 - c0) / (c1 - c0);
    const gx = (v(i0 + 1, j0) - v(i0 - 1, j0) + v(i1 + 1, j1) - v(i1 - 1, j1)) / 2;
    const gy = (v(i0, j0 + 1) - v(i0, j0 - 1) + v(i1, j1 + 1) - v(i1, j1 - 1)) / 2;
    const gl = Math.hypot(gx, gy);
    if (!linear && gl > 1e-9) {
      const n: Vec2 = [gx / gl, gy / gl];
      const step = (i1 - i0) * n[0] + (j1 - j0) * n[1];
      let sum = 0, count = 0;
      if (Math.abs(step) > 1e-6) {
        if (c0 > 0 && c0 < 1) {
          sum += -edgeDistance(c0, n) / step;
          count++;
        }
        if (c1 > 0 && c1 < 1) {
          sum += 1 - edgeDistance(c1, n) / step;
          count++;
        }
      }
      if (count > 0) s = Math.min(1, Math.max(0, sum / count));
      else if ((c0 <= 0 || c0 >= 1) && (c1 <= 0 || c1 >= 1)) s = 0.5;
    }
    px[id] = bx + i0 + s * (i1 - i0) - 0.5;
    py[id] = by + j0 + s * (j1 - j0) - 0.5;
    placed[id] = 1;
    return id;
  };
  const link = (p: number, q: number) => {
    links[2 * p + (links[2 * p]! < 0 ? 0 : 1)] = q;
    links[2 * q + (links[2 * q]! < 0 ? 0 : 1)] = p;
  };
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
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
  const seen = new Uint8Array(edges);
  const loops: Vec2[][] = [];
  for (let start = 0; start < edges; start++) {
    if (!placed[start] || seen[start]) continue;
    const loop: Vec2[] = [];
    let prev = -1, cur = start;
    while (cur >= 0 && !seen[cur]) {
      seen[cur] = 1;
      loop.push([px[cur]!, py[cur]!]);
      const to = links[2 * cur] !== prev ? links[2 * cur]! : links[2 * cur + 1]!;
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
