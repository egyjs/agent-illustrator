import { createRequire } from 'node:module';
import type * as Vtracer from '@visioncortex/vtracer';
import { EngineError } from '../errors.ts';
import { parsePathData } from '../geometry/pathdata.ts';
import { applyToSubpaths, translate } from '../geometry/transform.ts';
import type { Subpath } from '../geometry/types.ts';

/**
 * The only module that touches VTracer (WASM). It loads on first use, so a broken install fails
 * the trace op alone, never the server's startup.
 */

/** Palette index of a transparent pixel in `traceRegions`. */
export const TRANSPARENT = 255;
/** `speckle`: patches smaller than about speckle² pixels are dropped (VTracer's filter_speckle). */
export type TraceOptions = { readonly speckle: number };

const FIT = { mode: 'spline', cornerThreshold: 60, lengthThreshold: 4, spliceThreshold: 45, maxIterations: 10, pathPrecision: 3 } as const;

let loaded: typeof Vtracer | string | undefined;
const load = (): typeof Vtracer | string => {
  if (loaded === undefined) {
    try {
      loaded = createRequire(import.meta.url)('@visioncortex/vtracer') as typeof Vtracer;
    } catch (e) {
      loaded = e instanceof Error ? e.message : String(e);
    }
  }
  return loaded;
};

function vtracer(): typeof Vtracer {
  const m = load();
  if (typeof m === 'string') throw new EngineError('internal_error', `image tracing is unavailable: ${m}`, 'Reinstall agent-illustrator, then check it with --doctor.');
  return m;
}

/** True when VTracer loads and traces; otherwise the reason. */
export function traceAvailable(): true | string {
  try {
    traceMask(new Uint8Array([1, 1, 1, 1]), 2, 2, { speckle: 0 });
    return true;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

type TracedPath = { readonly fill: string; readonly subpaths: Subpath[] };

/** The `<path>` elements of VTracer's SVG as geometry in image pixels, with their fills uppercased. */
function parse(svg: string): TracedPath[] {
  return [...svg.matchAll(/<path\b([^>]*)>/g)].map(([, attrs]) => {
    const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs!)?.[1];
    const subpaths = parsePathData(attr('d') ?? '');
    const move = /translate\(\s*([-\d.e]+)[\s,]+([-\d.e]+)\s*\)/.exec(attr('transform') ?? '');
    return { fill: (attr('fill') ?? '').toUpperCase(), subpaths: move ? applyToSubpaths(translate(Number(move[1]), Number(move[2])), subpaths) : subpaths };
  });
}

/** Outlines of the 1-pixels of a w×h mask (holes and islands included; fill them evenodd), in image pixels. */
export function traceMask(mask: Uint8Array, width: number, height: number, opts: TraceOptions): Subpath[] {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    const p = i * 4;
    rgba[p] = rgba[p + 1] = rgba[p + 2] = mask[i] ? 0 : 255;
    rgba[p + 3] = 255;
  }
  const svg = vtracer().convertPixels(rgba, width, height, { ...FIT, clustering: 'bw', filterSpeckle: opts.speckle });
  return parse(svg).filter((p) => p.fill === '#000000').flatMap((p) => p.subpaths);
}

const rgbOf = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const dist2 = (a: readonly number[], b: readonly number[]) => (a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2;
const hexOf = ([r, g, b]: readonly number[]) => `#${[r, g, b].map((v) => v!.toString(16).padStart(2, '0')).join('')}`;

/** Colors with every channel 0, 128 or 255: the pool the transparency key is picked from. */
const KEYS = [0, 128, 255].flatMap((r) => [0, 128, 255].flatMap((g) => [0, 128, 255].map((b): [number, number, number] => [r, g, b])));

/** The key color farthest from every palette color (the first of equals), so no region can be mistaken for it. */
function keyFor(palette: readonly (readonly number[])[]): [number, number, number] {
  let best = KEYS[0]!;
  let far = -1;
  for (const key of KEYS) {
    const near = Math.min(...palette.map((c) => dist2(c, key)));
    if (near > far) {
      far = near;
      best = key;
    }
  }
  return best;
}

/**
 * Outlines of each palette color's pixels (`index` holds palette positions, TRANSPARENT for none),
 * as one list of subpaths per color. Neighboring regions share their edges, so they leave no gaps.
 * Transparent pixels get a key color far from the palette whose regions are dropped. VTracer is told
 * not to merge similar colors, so every palette color keeps its own layer.
 */
export function traceRegions(index: Uint8Array, palette: readonly string[], width: number, height: number, opts: TraceOptions): Subpath[][] {
  const colors = palette.map((c) => c.toLowerCase());
  const rgb = colors.map(rgbOf);
  const keyRgb = keyFor(rgb);
  const key = hexOf(keyRgb);
  const all = [...rgb, keyRgb];
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < index.length; i++) {
    const c = all[index[i] === TRANSPARENT ? colors.length : index[i]!]!;
    const p = i * 4;
    rgba[p] = c[0];
    rgba[p + 1] = c[1];
    rgba[p + 2] = c[2];
    rgba[p + 3] = 255;
  }
  const svg = vtracer().convertPixels(rgba, width, height, {
    ...FIT,
    clustering: 'color-cluster',
    hierarchical: 'cutout',
    colorPrecision: 8,
    layerDifference: 0,
    palette: [...colors, key],
    filterSpeckle: opts.speckle,
  });
  const layers = colors.map((): Subpath[] => []);
  const slot = new Map(colors.map((c, i) => [c.toUpperCase(), i]));
  const nearest = (fill: string): number => {
    const c = rgbOf(fill.toLowerCase());
    return rgb.reduce((best, p, i) => (dist2(p, c) < dist2(rgb[best]!, c) ? i : best), 0);
  };
  for (const p of parse(svg)) {
    if (p.fill === key.toUpperCase()) continue;
    layers[slot.get(p.fill) ?? nearest(p.fill)]!.push(...p.subpaths);
  }
  return layers;
}
