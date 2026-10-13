import { converter } from 'culori';
import { EngineError } from '../errors.ts';
import type { Rng } from '../random/rng.ts';

/**
 * A color-reduced image: `palette` (hex, most pixels first; #rrggbbaa for a translucent color), each
 * color's pixel `counts`, and the palette position of every pixel (`index`; TRANSPARENT where alpha < MIN_ALPHA).
 */
export type Quantized = { readonly palette: string[]; readonly counts: number[]; readonly index: Uint8Array };

/** Palette position of a transparent pixel in `Quantized.index`. */
export const TRANSPARENT = 255;
/** Fainter pixels than this alpha count as transparent: too faint to be a color of their own. */
const MIN_ALPHA = 16;
const BINS = 1 << 18;
const MAX_ROUNDS = 20;
const toOklab = converter('oklab');

/**
 * Reduces an RGBA image to at most `colors` colors: pixels are binned at 5 bits per color channel and
 * 3 for alpha, the bins clustered by weighted k-means++ in premultiplied OKLab plus alpha (seeded by
 * `rng`), so a translucent color stays apart from the same color opaque, and each cluster painted with
 * the pixel-weighted mean of its bins (premultiplied, in sRGB). An image with fewer colors keeps them exactly.
 */
export function quantize(pixels: Uint8Array, colors: number, rng: Rng): Quantized {
  const n = pixels.length / 4;
  const binOf = new Int32Array(n).fill(-1);
  const count = new Float64Array(BINS);
  // Per bin: each color channel times alpha, then alpha.
  const sum = new Float64Array(BINS * 4);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const alpha = pixels[p + 3]!;
    if (alpha < MIN_ALPHA) continue;
    const bin = ((pixels[p]! >> 3) << 13) | ((pixels[p + 1]! >> 3) << 8) | ((pixels[p + 2]! >> 3) << 3) | (alpha >> 5);
    binOf[i] = bin;
    count[bin]!++;
    for (let c = 0; c < 3; c++) sum[bin * 4 + c]! += pixels[p + c]! * alpha;
    sum[bin * 4 + 3]! += alpha;
  }
  const bins: number[] = [];
  for (let b = 0; b < BINS; b++) if (count[b]! > 0) bins.push(b);
  if (bins.length === 0) {
    throw new EngineError('invalid_input', 'the image is fully transparent, or could not be decoded', 'Give an image with visible pixels that opens in an image viewer.');
  }
  const weights = bins.map((b) => count[b]!);
  const lab = bins.map((b) => {
    const a = sum[b * 4 + 3]!;
    const c = toOklab({ mode: 'rgb', r: sum[b * 4]! / a / 255, g: sum[b * 4 + 1]! / a / 255, b: sum[b * 4 + 2]! / a / 255 });
    const alpha = a / count[b]! / 255;
    return [c.l * alpha, c.a * alpha, c.b * alpha, alpha] as const;
  });
  const cluster = kmeans(lab, weights, Math.min(colors, bins.length), rng);

  // Each cluster's color, then clusters of the same hex merged and ranked by pixel count.
  const totals = new Map<number, { n: number; rgba: [number, number, number, number] }>();
  bins.forEach((b, j) => {
    const t = totals.get(cluster[j]!) ?? { n: 0, rgba: [0, 0, 0, 0] };
    t.n += count[b]!;
    for (let c = 0; c < 4; c++) t.rgba[c]! += sum[b * 4 + c]!;
    totals.set(cluster[j]!, t);
  });
  const byHex = new Map<string, number>();
  const hexOfCluster = new Map<number, string>();
  const byte = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  for (const [id, t] of totals) {
    const [r, g, b, a] = t.rgba;
    const alpha = Math.round(a / t.n);
    const hex = `#${[r, g, b].map((v) => byte(v / a)).join('')}${alpha < 255 ? byte(alpha) : ''}`;
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

type Point = readonly [number, number, number, number];
const dist2 = (p: Point, q: Point) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 + (p[3] - q[3]) ** 2;

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
    const acc = centers.map(() => [0, 0, 0, 0, 0]);
    points.forEach((p, j) => {
      const a = acc[assign[j]!]!;
      for (let c = 0; c < 4; c++) a[c]! += p[c]! * weights[j]!;
      a[4]! += weights[j]!;
    });
    acc.forEach((a, c) => {
      if (a[4]! > 0) centers[c] = [a[0]! / a[4]!, a[1]! / a[4]!, a[2]! / a[4]!, a[3]! / a[4]!];
    });
  }
  return assign;
}
