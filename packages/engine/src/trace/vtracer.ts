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
    const v = mask[i] ? 0 : 255;
    rgba.set([v, v, v, 255], i * 4);
  }
  const svg = vtracer().convertPixels(rgba, width, height, { ...FIT, clustering: 'bw', filterSpeckle: opts.speckle });
  return parse(svg).filter((p) => p.fill === '#000000').flatMap((p) => p.subpaths);
}

const rgbOf = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const hexOf = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/**
 * Outlines of each palette color's pixels (`index` holds palette positions, TRANSPARENT for none),
 * as one list of subpaths per color. Neighboring regions share their edges, so they meet without
 * seams. Transparent pixels get a color outside the palette whose regions are dropped.
 */
export function traceRegions(index: Uint8Array, palette: readonly string[], width: number, height: number, opts: TraceOptions): Subpath[][] {
  const colors = palette.map((c) => c.toLowerCase());
  let k = 0x010203;
  while (colors.includes(hexOf(k))) k++;
  const key = hexOf(k);
  const rgb = [...colors, key].map(rgbOf);
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < index.length; i++) {
    const c = rgb[index[i] === TRANSPARENT ? colors.length : index[i]!]!;
    rgba.set([c[0], c[1], c[2], 255], i * 4);
  }
  const svg = vtracer().convertPixels(rgba, width, height, { ...FIT, clustering: 'color-cluster', hierarchical: 'cutout', palette: [...colors, key], filterSpeckle: opts.speckle });
  const layers = colors.map((): Subpath[] => []);
  const slot = new Map(colors.map((c, i) => [c.toUpperCase(), i]));
  for (const p of parse(svg)) {
    if (p.fill === key.toUpperCase()) continue;
    const i = slot.get(p.fill);
    if (i === undefined) throw new EngineError('internal_error', `the tracer returned color ${p.fill}, which is not in the palette`, 'Trace with method "stacked" instead.');
    layers[i]!.push(...p.subpaths);
  }
  return layers;
}
