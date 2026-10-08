import { optimize } from 'svgo';
import { EngineError } from '../errors.ts';
import type { Doc } from '../scene/model.ts';
import { toSvg } from './svg.ts';

export type ExportOptions = { readonly precision?: number; readonly optimize?: boolean; readonly stripIds?: boolean };

/** Drops every id except those a `url(#…)` or `href="#…"` points at (clips, masks, gradients, text guides), which would otherwise dangle. */
function stripUnreferencedIds(svg: string): string {
  const referenced = new Set([...svg.matchAll(/url\(#([^)]*)\)|href="#([^"]*)"/g)].map((m) => m[1] ?? m[2]));
  return svg.replace(/ id="([^"]*)"/g, (attr, id: string) => (referenced.has(id) ? attr : ''));
}

/**
 * Final SVG (FR-11.3): tokens resolved, coordinates rounded to `precision` decimals (default 2),
 * then SVGO with ids and groups preserved unless `stripIds` is set.
 */
export function exportSvg(doc: Doc, options: ExportOptions = {}): string {
  const precision = options.precision ?? 2;
  if (!Number.isInteger(precision) || precision < 0 || precision > 6) {
    throw new EngineError('invalid_input', `precision must be a whole number 0..6, got ${precision}`, 'Use 2 for most drawings, 0 for pixel art.');
  }
  const raw = toSvg(doc, { precision });
  if (options.optimize === false) return options.stripIds ? stripUnreferencedIds(raw) : raw;
  const overrides: { collapseGroups: false; cleanupIds?: false } = { collapseGroups: false };
  if (!options.stripIds) overrides.cleanupIds = false;
  // toSvg already rounded the coordinates; SVGO's own rounding would also hit unitless fractions (stop offsets, gradient vectors).
  return optimize(raw, { multipass: true, floatPrecision: Math.max(precision, 3), plugins: [{ name: 'preset-default', params: { overrides } }] }).data;
}
