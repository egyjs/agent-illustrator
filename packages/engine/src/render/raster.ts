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

/** A round step (1, 2 or 5 × 10^k) near a tenth of the shorter side. */
function niceStep(span: number): number {
  const raw = span / 10;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
}

function overlaySvg(doc: Doc, region: Box, scale: number, overlays: readonly Overlay[], gridStep?: number): string {
  if (overlays.length === 0) return '';
  const px = 1 / scale; // one output pixel, in canvas units
  const f = (v: number) => String(Number(v.toFixed(3)));
  const parts: string[] = ['<g id="__overlay">'];
  if (overlays.includes('grid')) {
    const step = gridStep ?? niceStep(Math.min(doc.canvas.width, doc.canvas.height));
    const label = `font-size="${f(10 * px)}" fill="#00708f"`;
    for (let x = Math.ceil(region.x / step) * step; x <= region.x + region.width; x += step) {
      parts.push(`<path d="M${f(x)} ${f(region.y)} V${f(region.y + region.height)}" stroke="#00a6d6" stroke-opacity="0.45" stroke-width="${f(px)}"/>`);
      parts.push(`<text x="${f(x + 2 * px)}" y="${f(region.y + 10 * px)}" ${label}>${f(x)}</text>`);
    }
    for (let y = Math.ceil(region.y / step) * step; y <= region.y + region.height; y += step) {
      parts.push(`<path d="M${f(region.x)} ${f(y)} H${f(region.x + region.width)}" stroke="#00a6d6" stroke-opacity="0.45" stroke-width="${f(px)}"/>`);
      parts.push(`<text x="${f(region.x + 2 * px)}" y="${f(y - 2 * px)}" ${label}>${f(y)}</text>`);
    }
  }
  const ids = Object.keys(doc.nodes);
  if (overlays.includes('bounds')) {
    for (const id of ids) {
      const b = worldBounds(doc, id);
      if (!b) continue;
      const color = doc.nodes[id]!.type === 'group' ? '#7a00ff' : '#ff00aa';
      parts.push(
        `<rect x="${f(b.x)}" y="${f(b.y)}" width="${f(b.width)}" height="${f(b.height)}" fill="none" stroke="${color}" ` +
          `stroke-width="${f(px)}" stroke-dasharray="${f(4 * px)} ${f(3 * px)}"/>`,
      );
    }
  }
  if (overlays.includes('ids')) {
    for (const id of ids) {
      const b = worldBounds(doc, id);
      if (!b) continue;
      const size = 11 * px;
      parts.push(
        `<rect x="${f(b.x)}" y="${f(b.y)}" width="${f((id.length * 6.5 + 4) * px)}" height="${f(14 * px)}" fill="#ffffff" fill-opacity="0.85"/>`,
        `<text x="${f(b.x + 2 * px)}" y="${f(b.y + 11 * px)}" font-size="${f(size)}" fill="#c00070">${id}</text>`,
      );
    }
  }
  parts.push('</g>');
  return parts.join('');
}
