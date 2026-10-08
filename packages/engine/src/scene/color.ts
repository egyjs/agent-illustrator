import { formatHex, formatRgb, parse } from 'culori';
import type { Doc } from './model.ts';

/**
 * Any CSS color culori parses (hex, names, rgb(), hsl(), oklch(), …) → a color string every SVG
 * renderer understands: '#rrggbb', or 'rgba(r, g, b, a)' when translucent. 'none' stays 'none'.
 * Out-of-gamut colors are clamped to sRGB. Returns undefined when the string is not a color.
 */
export function toSvgColor(value: string): string | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'none') return 'none';
  const color = parse(v);
  if (!color) return undefined;
  return color.alpha === undefined || color.alpha >= 1 ? formatHex(color) : formatRgb(color);
}

type Lookup = Pick<Doc, 'tokens'> & { readonly defs?: Doc['defs'] };

/** The SVG id a def is emitted under; node ids never start with "__", so the two never collide. */
export const defSvgId = (name: string): string => `__def_${name}`;

/** A token name (looked up first) or a color, as an SVG color; never 'none'. Gradient stops and shadows use this. */
export function resolveColor(doc: Lookup, value: string): string | undefined {
  const token = Object.hasOwn(doc.tokens, value) ? doc.tokens[value] : undefined;
  const color = toSvgColor(token ?? value);
  return color === 'none' ? undefined : color;
}

/** A paint is a token name (looked up first), a gradient def (→ "url(#…)") or a color; undefined when it is none of these. */
export function resolvePaint(doc: Lookup, paint: string): string | undefined {
  const token = Object.hasOwn(doc.tokens, paint) ? doc.tokens[paint] : undefined;
  if (token !== undefined) return toSvgColor(token);
  const def = doc.defs && Object.hasOwn(doc.defs, paint) ? doc.defs[paint] : undefined;
  if (def) return def.kind === 'filter' ? undefined : `url(#${defSvgId(paint)})`;
  return toSvgColor(paint);
}
