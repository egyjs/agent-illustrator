import { Resvg } from '@resvg/resvg-js';
import type { Box } from '../geometry/types.ts';
import type { TextNode } from '../scene/model.ts';
import type { RasterFonts } from './raster.ts';
import { formatter } from './svg.ts';
import { textMarkup } from './text-svg.ts';

const CACHE_SIZE = 512;
/** Least recently used first; a Map iterates in insertion order. */
const cache = new Map<string, Box | null>();

/**
 * The ink box of a text node in its own coordinates (before its transform), as resvg lays the glyphs
 * out; null when nothing is drawn. Without `fonts`, system fonts are used. Results are cached per
 * font set and markup, so re-measuring unchanged text is free.
 */
export function measureInk(node: TextNode, fonts?: RasterFonts): Box | null {
  const { prefix, attrs, body } = textMarkup(node, formatter(3));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">${prefix}<text ${attrs.join(' ')}>${body}</text></svg>`;
  const key = `${fonts ? [fonts.defaultFamily, ...fonts.files].join('\0') : 'system'}\0${svg}`;
  const hit = cache.get(key);
  if (hit !== undefined || cache.has(key)) {
    cache.delete(key);
    cache.set(key, hit ?? null);
    return hit ?? null;
  }
  const bbox = new Resvg(svg, {
    font: fonts ? { fontFiles: [...fonts.files], loadSystemFonts: false, defaultFontFamily: fonts.defaultFamily } : { loadSystemFonts: true },
  }).getBBox();
  // BBox is a native object, so copy its fields out.
  const box = bbox ? { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height } : null;
  cache.set(key, box);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return box;
}
