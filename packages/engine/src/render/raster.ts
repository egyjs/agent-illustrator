import { Resvg } from '@resvg/resvg-js';
import { EngineError } from '../errors.ts';
import type { Box } from '../geometry/types.ts';
import type { Doc } from '../scene/model.ts';
import { worldBounds } from '../scene/query.ts';
import { toSvg } from './svg.ts';

export type Overlay = 'ids' | 'bounds' | 'grid';
export type RasterFonts = { readonly files: readonly string[]; readonly defaultFamily: string };
export type RasterOptions = {
  /** Output pixels per canvas unit; default 1. */
  readonly scale?: number;
  /** Canvas-space area to render; default the whole canvas. */
  readonly region?: Box;
  /** Drawn on top as a separate layer; never part of the document or its export. */
  readonly overlays?: readonly Overlay[];
  /** Grid spacing in canvas units; default a round step near a tenth of the shorter side. */
  readonly grid?: number;
  /** Font files for text and overlay labels. Without them, system fonts are used. */
  readonly fonts?: RasterFonts;
  /** Backdrop behind transparent areas; default white. */
  readonly background?: string;
  readonly maxPixels?: number;
};
export type Raster = { readonly width: number; readonly height: number; readonly png: Uint8Array; readonly pixels: Uint8Array };

export const MAX_RENDER_PIXELS = 4096 * 4096;
export const MAX_SCALE = 8;
/** Render regions stay within this distance of the canvas origin; far beyond, floats lose whole pixels. */
export const MAX_REGION_COORD = 1e6;
/** Grid lines are at least this many output pixels apart. */
const MIN_GRID_PX = 8;

/** SVG → PNG through resvg, with optional region crop, scale and overlays (FR-11.1). */
export function rasterize(doc: Doc, options: RasterOptions = {}): Raster {
  const scale = options.scale ?? 1;
  if (!(scale > 0 && scale <= MAX_SCALE)) {
    throw new EngineError('invalid_input', `scale must be in (0, ${MAX_SCALE}], got ${scale}`, 'Use 1 for actual size, 2 to zoom in, 0.5 for a thumbnail.');
  }
  const region = options.region ?? { x: 0, y: 0, width: doc.canvas.width, height: doc.canvas.height };
  if (!(region.width > 0 && region.height > 0)) {
    throw new EngineError('invalid_input', 'render region needs a positive width and height', 'Give region as { x, y, width, height } in canvas units.');
  }
  const far = [region.x, region.y, region.x + region.width, region.y + region.height].some((v) => !(Math.abs(v) <= MAX_REGION_COORD));
  if (far) {
    throw new EngineError('invalid_input', `render region must stay within ±${MAX_REGION_COORD} canvas units`, 'Render an area at or near the canvas, e.g. { x: 0, y: 0, width: 400, height: 300 }.');
  }
  if (options.grid !== undefined && options.grid * scale < MIN_GRID_PX) {
    throw new EngineError(
      'invalid_input',
      `grid spacing ${options.grid} is under ${MIN_GRID_PX} output pixels at scale ${scale}`,
      `Use grid ${Math.ceil((MIN_GRID_PX / scale) * 100) / 100} or more, or leave grid out for an automatic step.`,
    );
  }
  const width = Math.max(1, Math.round(region.width * scale));
  const height = Math.max(1, Math.round(region.height * scale));
  const maxPixels = options.maxPixels ?? MAX_RENDER_PIXELS;
  if (width * height > maxPixels) {
    throw new EngineError(
      'limit_exceeded',
      `a ${width}×${height} render exceeds the ${maxPixels}-pixel limit`,
      'Lower scale, or render a smaller region and zoom into the part you need.',
    );
  }
  const body = toSvg(doc);
  const inner = body.slice(body.indexOf('>') + 1, body.lastIndexOf('</svg>'));
  const overlay = overlaySvg(doc, region, scale, options.overlays ?? [], options.grid);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="${region.x} ${region.y} ${region.width} ${region.height}">${inner}${overlay}</svg>`;
  const fonts = options.fonts;
  const image = new Resvg(svg, {
    background: options.background ?? 'white',
    font: fonts
      ? { fontFiles: [...fonts.files], loadSystemFonts: false, defaultFontFamily: fonts.defaultFamily }
      : { loadSystemFonts: true },
  }).render();
  return { width: image.width, height: image.height, png: image.asPng(), pixels: image.pixels };
}

/** The smallest round step (1, 2 or 5 × 10^k) that is at least `min`. */
function roundUp(min: number): number {
  const pow = 10 ** Math.floor(Math.log10(min));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= min) ?? min;
}

/** Lines at whole multiples of `step` inside [from, to], by integer index so no float drift or runaway loop. */
function gridLines(from: number, to: number, step: number): number[] {
  const first = Math.ceil(from / step), last = Math.floor(to / step);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, k) => (first + k) * step);
}

export type LabelBox = { readonly id: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/**
 * Where the ids overlay puts each label, in canvas units:
 * - Groups come first and leaves last, so leaf labels draw on top.
 * - Each label starts at the top-left of the node's visible part, so zoomed renders still label
 *   nodes that begin outside the view.
 * - A label that would cover an earlier one moves down until it is clear.
 * Nodes outside the region get no label.
 */
export function labelLayout(nodes: readonly { id: string; box: Box; group: boolean }[], region: Box, px: number): LabelBox[] {
  const ordered = [...nodes.filter((n) => n.group), ...nodes.filter((n) => !n.group)];
  const placed: LabelBox[] = [];
  const hits = (a: LabelBox) => placed.some((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h);
  for (const { id, box } of ordered) {
    const x0 = Math.max(box.x, region.x), y0 = Math.max(box.y, region.y);
    if (x0 > Math.min(box.x + box.width, region.x + region.width) || y0 > Math.min(box.y + box.height, region.y + region.height)) continue;
    const h = 14 * px;
    let label: LabelBox = { id, x: x0, y: y0, w: (id.length * 6.5 + 4) * px, h };
    for (let tries = 0; tries < 20 && hits(label); tries++) label = { ...label, y: label.y + h };
    placed.push(label);
  }
  return placed;
}

function overlaySvg(doc: Doc, region: Box, scale: number, overlays: readonly Overlay[], gridStep?: number): string {
  if (overlays.length === 0) return '';
  const px = 1 / scale; // one output pixel, in canvas units
  const f = (v: number) => String(Number(v.toFixed(3)));
  const parts: string[] = ['<g id="__overlay">'];
  if (overlays.includes('grid')) {
    const step = gridStep ?? roundUp(Math.max(Math.min(region.width, region.height) / 10, MIN_GRID_PX * px));
    const label = `font-size="${f(10 * px)}" fill="#00708f"`;
    for (const x of gridLines(region.x, region.x + region.width, step)) {
      parts.push(`<path d="M${f(x)} ${f(region.y)} V${f(region.y + region.height)}" stroke="#00a6d6" stroke-opacity="0.45" stroke-width="${f(px)}"/>`);
      parts.push(`<text x="${f(x + 2 * px)}" y="${f(region.y + 10 * px)}" ${label}>${f(x)}</text>`);
    }
    for (const y of gridLines(region.y, region.y + region.height, step)) {
      parts.push(`<path d="M${f(region.x)} ${f(y)} H${f(region.x + region.width)}" stroke="#00a6d6" stroke-opacity="0.45" stroke-width="${f(px)}"/>`);
      parts.push(`<text x="${f(region.x + 2 * px)}" y="${f(y - 2 * px)}" ${label}>${f(y)}</text>`);
    }
  }
  const boxes = Object.keys(doc.nodes).flatMap((id) => {
    const box = worldBounds(doc, id);
    return box ? [{ id, box, group: doc.nodes[id]!.type === 'group' }] : [];
  });
  if (overlays.includes('bounds')) {
    for (const { box: b, group } of boxes) {
      parts.push(
        `<rect x="${f(b.x)}" y="${f(b.y)}" width="${f(b.width)}" height="${f(b.height)}" fill="none" stroke="${group ? '#7a00ff' : '#ff00aa'}" ` +
          `stroke-width="${f(px)}" stroke-dasharray="${f(4 * px)} ${f(3 * px)}"/>`,
      );
    }
  }
  if (overlays.includes('ids')) {
    for (const l of labelLayout(boxes, region, px)) {
      parts.push(
        `<rect x="${f(l.x)}" y="${f(l.y)}" width="${f(l.w)}" height="${f(l.h)}" fill="#ffffff" fill-opacity="0.85"/>`,
        `<text x="${f(l.x + 2 * px)}" y="${f(l.y + 11 * px)}" font-size="${f(11 * px)}" fill="#c00070">${l.id}</text>`,
      );
    }
  }
  parts.push('</g>');
  return parts.join('');
}
