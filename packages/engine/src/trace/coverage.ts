import type { Bitmap } from './resample.ts';

/**
 * How much of each pixel every palette color covers. An antialiased edge pixel is a blend
 * pixel = t·A + (1 − t)·B of the two colors on either side (compositing is linear in premultiplied
 * RGBA), so solving for t places the edge inside the pixel. `a` and `b` are palette positions
 * (`transparent`, one past the palette, stands for no paint) and `t` is the share of `a`; interior
 * pixels have a = b and t = 1.
 */
export type Coverage = {
  readonly a: Uint8Array;
  readonly b: Uint8Array;
  readonly t: Float32Array;
  readonly transparent: number;
  /** Squared premultiplied-RGBA distance between each pixel and the blend that explains it. */
  readonly error: Float32Array;
};

/** Squared premultiplied-RGBA distance under which a pixel counts as exactly its nearest color. */
const INTERIOR = 9;
/** A blend the neighborhood's colors explain worse than this (squared distance) is tried against every pair of colors. */
const POOR_FIT = 64;
/** How far (pixels) an edge pixel looks for the flat colors on either side of it. */
const FLAT_REACH = 3;
/** Fewer flat pixels than this, and the palette is taken from every pixel. */
const MIN_INTERIOR = 64;

/**
 * The pixels whose 3×3 neighborhood is flat (every channel within `tolerance`), as RGBA: the colors
 * of the image, without the blends along its edges, which would otherwise win palette slots of their own.
 */
export function interiorPixels(img: Bitmap, tolerance = 6): Uint8Array {
  const { width: w, height: h, pixels: p } = img;
  const out = new Uint8Array(p.length);
  let n = 0;
  const differs = (i: number, j: number) =>
    Math.abs(p[i]! - p[j]!) > tolerance || Math.abs(p[i + 1]! - p[j + 1]!) > tolerance || Math.abs(p[i + 2]! - p[j + 2]!) > tolerance || Math.abs(p[i + 3]! - p[j + 3]!) > tolerance;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1);
      let flat = true;
      for (let yy = y0; yy <= y1 && flat; yy++) for (let xx = x0; xx <= x1 && flat; xx++) if (differs(i, (yy * w + xx) * 4)) flat = false;
      if (flat) {
        out[4 * n] = p[i]!;
        out[4 * n + 1] = p[i + 1]!;
        out[4 * n + 2] = p[i + 2]!;
        out[4 * n + 3] = p[i + 3]!;
        n++;
      }
    }
  }
  return n >= MIN_INTERIOR ? out.slice(0, 4 * n) : p;
}

/** A palette color (#rrggbb, or #rrggbbaa when translucent) in premultiplied RGBA. */
function premultiplied(hex: string): number[] {
  const alpha = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) : 255;
  return [...[1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) * alpha) / 255), alpha];
}

/** Each pixel's two palette colors and the share of the first; see `Coverage`. */
export function coverage(img: Bitmap, palette: readonly string[]): Coverage {
  const { width: w, height: h, pixels: px } = img;
  const transparent = palette.length;
  const cols = [...palette.map(premultiplied), [0, 0, 0, 0]];
  const n = w * h;
  const a = new Uint8Array(n), b = new Uint8Array(n), t = new Float32Array(n).fill(1), error = new Float32Array(n);
  const nearest = new Uint8Array(n), nearD = new Float64Array(n);
  const P = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    const alpha = px[i * 4 + 3]! / 255;
    for (let c = 0; c < 3; c++) P[i * 4 + c] = px[i * 4 + c]! * alpha;
    P[i * 4 + 3] = px[i * 4 + 3]!;
    let best = 0, bd = Infinity;
    for (let k = 0; k <= transparent; k++) {
      const q = cols[k]!;
      let d = 0;
      for (let c = 0; c < 4; c++) d += (P[i * 4 + c]! - q[c]!) ** 2;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    nearest[i] = a[i] = b[i] = best;
    nearD[i] = error[i] = bd;
  }
  const all = Array.from({ length: transparent + 1 }, (_, k) => k);
  /** Sets pixel i to the best blend of two of `colors` that improves on `beat`; returns its squared error. */
  const blend = (i: number, colors: readonly number[], beat = Infinity): number => {
    let best = beat;
    for (let u = 0; u < colors.length; u++) {
      for (let v = u + 1; v < colors.length; v++) {
        const qa = cols[colors[u]!]!, qb = cols[colors[v]!]!;
        let num = 0, den = 0;
        for (let c = 0; c < 4; c++) {
          num += (P[i * 4 + c]! - qb[c]!) * (qa[c]! - qb[c]!);
          den += (qa[c]! - qb[c]!) ** 2;
        }
        const s = Math.min(1, Math.max(0, num / den));
        let r = 0;
        for (let c = 0; c < 4; c++) r += (P[i * 4 + c]! - (qb[c]! + s * (qa[c]! - qb[c]!))) ** 2;
        if (r < best) {
          // A blend all of one color is that color alone: no partner with zero coverage.
          best = r;
          a[i] = s > 0 ? colors[u]! : colors[v]!;
          b[i] = s < 1 ? colors[v]! : colors[u]!;
          t[i] = s > 0 ? s : 1;
        }
      }
    }
    return best;
  };
  // Flat pixels: they and their 8 neighbors are all, within INTERIOR, the same palette color.
  const flat = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let ok = nearD[i]! < INTERIOR;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1) && ok; yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1) && ok; xx++) ok = nearest[yy * w + xx] === nearest[i] && nearD[yy * w + xx]! < INTERIOR;
      }
      flat[i] = ok ? 1 : 0;
    }
  }
  const cand: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (flat[i]) continue;
      // An edge pixel blends the colors on either side of it, which show up flat within a few pixels. A palette
      // color that lies between them (a tint of one toward the other) can match the pixel as well: it must not win.
      cand.length = 0;
      for (let yy = Math.max(0, y - FLAT_REACH); yy <= Math.min(h - 1, y + FLAT_REACH); yy++) {
        for (let xx = Math.max(0, x - FLAT_REACH); xx <= Math.min(w - 1, x + FLAT_REACH); xx++) {
          const j = yy * w + xx;
          if (flat[j] && !cand.includes(nearest[j]!)) cand.push(nearest[j]!);
        }
      }
      if (cand.length >= 2) {
        // Kept when it fits well, and no worse than the pixel's nearest color (a thin line of that color, say).
        const br = blend(i, cand);
        if (br <= Math.max(INTERIOR, Math.min(nearD[i]!, POOR_FIT))) {
          error[i] = br;
          continue;
        }
        a[i] = b[i] = nearest[i]!;
        t[i] = 1;
      }
      if (nearD[i]! < INTERIOR) continue;
      // Otherwise (thin features, noise) the candidates are what this pixel and its neighbors are nearest to.
      // With one candidate the pixel is inside a shape (noise or a color the palette lacks, not an edge) and keeps its nearest color.
      cand.length = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const k = nearest[yy * w + xx]!;
          if (!cand.includes(k)) cand.push(k);
        }
      }
      if (cand.length < 2) continue;
      let br = cand.length < 2 ? Infinity : blend(i, cand);
      // A color too thin to show up pure next to its blend (a hairline, say) is found among all of them.
      if (br > POOR_FIT) br = Math.min(br, blend(i, all, br));
      error[i] = Math.min(nearD[i]!, br);
    }
  }
  return { a, b, t, transparent, error };
}

/** How many pixels' worth of each of the first `n` palette colors the image holds. */
export function shares(cov: Coverage, n: number): number[] {
  const sum = new Array<number>(n).fill(0);
  for (let i = 0; i < cov.a.length; i++) {
    const a = cov.a[i]!, b = cov.b[i]!, t = cov.t[i]!;
    if (a < n) sum[a]! += t;
    if (b !== a && b < n) sum[b]! += 1 - t;
  }
  return sum;
}

/** Worse than this (squared premultiplied-RGBA distance), a pixel is a color the palette lacks. */
const UNEXPLAINED = 400;

/**
 * The opaque pixels no blend of the palette explains and that a neighbor matches (within `tolerance`
 * per channel), as RGBA: colors of features too thin to have a flat inside (hairlines, dots), which
 * the palette, taken from inside shapes, misses. Lone pixels where three colors meet are left out.
 */
export function unexplained(img: Bitmap, cov: Coverage, tolerance = 24): Uint8Array {
  const { width: w, height: h, pixels: p } = img;
  const out = new Uint8Array(p.length);
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (cov.error[i]! <= UNEXPLAINED || p[i * 4 + 3]! < 128) continue;
      let matched = false;
      for (let dy = -1; dy <= 1 && !matched; dy++) {
        for (let dx = -1; dx <= 1 && !matched; dx++) {
          const xx = x + dx, yy = y + dy;
          if ((dx === 0 && dy === 0) || xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          matched = [0, 1, 2, 3].every((c) => Math.abs(p[i * 4 + c]! - p[j * 4 + c]!) <= tolerance);
        }
      }
      if (matched) out.set(p.subarray(i * 4, i * 4 + 4), 4 * n++);
    }
  }
  return out.slice(0, 4 * n);
}

/** How far the insides of shapes stray from their palette colors: RMS premultiplied-RGBA distance (grain, JPEG noise). */
export function noise(cov: Coverage): number {
  let sum = 0, n = 0;
  for (let i = 0; i < cov.a.length; i++) {
    if (cov.a[i] !== cov.b[i] || cov.a[i] === cov.transparent) continue;
    sum += cov.error[i]!;
    n++;
  }
  return n > 0 ? Math.sqrt(sum / n) : 0;
}

