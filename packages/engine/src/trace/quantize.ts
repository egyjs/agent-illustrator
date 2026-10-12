import { converter } from 'culori';
import { EngineError } from '../errors.ts';
import type { Rng } from '../random/rng.ts';
import { TRANSPARENT } from './vtracer.ts';

/**
 * A color-reduced image: `palette` (hex, most pixels first), each color's pixel `counts`, and the
 * palette position of every pixel (`index`; TRANSPARENT where alpha < 128).
 */
export type Quantized = { readonly palette: string[]; readonly counts: number[]; readonly index: Uint8Array };

const BINS = 1 << 15;
const MAX_ROUNDS = 20;
const toOklab = converter('oklab');

/**
 * Reduces an RGBA image to at most `colors` colors: pixels are binned at 5 bits per channel, the
 * bins clustered by weighted k-means++ in OKLab (seeded by `rng`), and each cluster painted with the
 * pixel-weighted mean of its bins in sRGB. An image with fewer colors keeps them exactly.
 */
export function quantize(pixels: Uint8Array, colors: number, rng: Rng): Quantized {
  const n = pixels.length / 4;
  const binOf = new Int32Array(n).fill(-1);
  const count = new Float64Array(BINS);
  const sum = new Float64Array(BINS * 3);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    if (pixels[p + 3]! < 128) continue;
    const bin = ((pixels[p]! >> 3) << 10) | ((pixels[p + 1]! >> 3) << 5) | (pixels[p + 2]! >> 3);
    binOf[i] = bin;
    count[bin]!++;
    for (let c = 0; c < 3; c++) sum[bin * 3 + c]! += pixels[p + c]!;
  }
  const bins: number[] = [];
  for (let b = 0; b < BINS; b++) if (count[b]! > 0) bins.push(b);
  if (bins.length === 0) {
    throw new EngineError('invalid_input', 'the image is fully transparent, or could not be decoded', 'Give an image with visible pixels that opens in an image viewer.');
  }
  const weights = bins.map((b) => count[b]!);
  const lab = bins.map((b) => {
    const c = toOklab({ mode: 'rgb', r: sum[b * 3]! / count[b]! / 255, g: sum[b * 3 + 1]! / count[b]! / 255, b: sum[b * 3 + 2]! / count[b]! / 255 });
    return [c.l, c.a, c.b] as const;
  });
  const cluster = kmeans(lab, weights, Math.min(colors, bins.length), rng);

  // Each cluster's color, then clusters of the same hex merged and ranked by pixel count.
  const totals = new Map<number, { n: number; rgb: [number, number, number] }>();
  bins.forEach((b, j) => {
    const t = totals.get(cluster[j]!) ?? { n: 0, rgb: [0, 0, 0] };
    t.n += count[b]!;
    for (let c = 0; c < 3; c++) t.rgb[c]! += sum[b * 3 + c]!;
    totals.set(cluster[j]!, t);
  });
  const byHex = new Map<string, number>();
  const hexOfCluster = new Map<number, string>();
  for (const [id, t] of totals) {
    const hex = `#${t.rgb.map((v) => Math.round(v / t.n).toString(16).padStart(2, '0')).join('')}`;
    hexOfCluster.set(id, hex);
    byHex.set(hex, (byHex.get(hex) ?? 0) + t.n);
  }
  const ranked = [...byHex].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const rankOfHex = new Map(ranked.map(([hex], r) => [hex, r]));
  const rankOfBin = new Int32Array(BINS);
  bins.forEach((b, j) => (rankOfBin[b] = rankOfHex.get(hexOfCluster.get(cluster[j]!)!)!));

  const index = new Uint8Array(n).fill(TRANSPARENT);
  for (let i = 0; i < n; i++) if (binOf[i]! >= 0) index[i] = rankOfBin[binOf[i]!]!;
  return { palette: ranked.map(([hex]) => hex), counts: ranked.map(([, c]) => c), index };
}

type Point = readonly [number, number, number];
const dist2 = (p: Point, q: Point) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

/** Weighted k-means with k-means++ seeding; returns each point's cluster. */
function kmeans(points: readonly Point[], weights: readonly number[], k: number, rng: Rng): Int32Array {
  const pick = (w: readonly number[]): number => {
    let r = rng() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < w.length; i++) if ((r -= w[i]!) < 0) return i;
    return w.findLastIndex((x) => x > 0);
  };
  const centers: Point[] = [points[pick(weights)]!];
  const nearest = points.map((p) => dist2(p, centers[0]!));
  while (centers.length < k) {
    const i = pick(weights.map((w, j) => w * nearest[j]!));
    if (i < 0) break; // every point already sits on a center
    centers.push(points[i]!);
    points.forEach((p, j) => (nearest[j] = Math.min(nearest[j]!, dist2(p, points[i]!))));
  }
  const assign = new Int32Array(points.length).fill(-1);
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let moved = false;
    points.forEach((p, j) => {
      let best = 0;
      for (let c = 1; c < centers.length; c++) if (dist2(p, centers[c]!) < dist2(p, centers[best]!)) best = c;
      if (assign[j] !== best) {
        assign[j] = best;
        moved = true;
      }
    });
    if (!moved) break;
    const acc = centers.map(() => [0, 0, 0, 0]);
    points.forEach((p, j) => {
      const a = acc[assign[j]!]!;
      for (let c = 0; c < 3; c++) a[c]! += p[c]! * weights[j]!;
      a[3]! += weights[j]!;
    });
    acc.forEach((a, c) => {
      if (a[3]! > 0) centers[c] = [a[0]! / a[3]!, a[1]! / a[3]!, a[2]! / a[3]!];
    });
  }
  return assign;
}

/** For stacked tracing: mask k holds every opaque pixel whose palette rank is k or more. */
export function stackedMasks(index: Uint8Array, n: number): Uint8Array[] {
  return Array.from({ length: n }, (_, k) => index.map((r) => (r !== TRANSPARENT && r >= k ? 1 : 0)));
}
