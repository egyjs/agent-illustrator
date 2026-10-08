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

/** A paint is a token name (looked up first) or a color; undefined when it is neither. */
export function resolvePaint(doc: Pick<Doc, 'tokens'>, paint: string): string | undefined {
  const token = Object.hasOwn(doc.tokens, paint) ? doc.tokens[paint] : undefined;
  return toSvgColor(token ?? paint);
}
