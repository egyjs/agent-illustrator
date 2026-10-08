import { formatHex, formatRgb, oklch, parse, toGamut, wcagContrast } from 'culori';
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

/** WCAG 2.x contrast ratio (1 to 21) of two CSS colors, alpha ignored; undefined when either is not a color. */
export function contrastRatio(a: string, b: string): number | undefined {
  const ca = parse(a.trim().toLowerCase());
  const cb = parse(b.trim().toLowerCase());
  return ca && cb ? wcagContrast(ca, cb) : undefined;
}

export const HARMONIES = ['monochrome', 'complementary', 'analogous', 'triadic'] as const;
export type Harmony = (typeof HARMONIES)[number];

/** Palette roles of each harmony, with their hue offset from the base color in degrees. */
const ROLES: Record<Harmony, readonly (readonly [role: string, offset: number])[]> = {
  monochrome: [['primary', 0]],
  complementary: [['primary', 0], ['accent', 180]],
  analogous: [['primary', 0], ['secondary', 30], ['tertiary', -30]],
  triadic: [['primary', 0], ['secondary', 120], ['tertiary', 240]],
};

const intoSrgb = toGamut('rgb', 'oklch');
/** An OKLCH color as '#rrggbb', gamut-mapped to sRGB by lowering chroma (the hue stays). */
const oklchHex = (l: number, c: number, h: number): string => formatHex(intoSrgb({ mode: 'oklch', l, c, h: ((h % 360) + 360) % 360 }));

/**
 * Token values for a palette built around `base`: per harmony role one color (`<prefix>.<role>`, the base's
 * lightness and chroma at the role's hue) and a ramp of `steps` colors from light to dark
 * (`<prefix>.<role>.1` … `.N`), then a nearly gray ramp (`<prefix>.neutral.1` … `.N`). Undefined when `base` is not a color.
 */
export function makePalette(base: string, harmony: Harmony, steps: number, prefix: string): Record<string, string> | undefined {
  const parsed = parse(base.trim().toLowerCase());
  if (!parsed) return undefined;
  const { l, c, h } = oklch(parsed);
  const hue = h ?? 0;
  const out: Record<string, string> = {};
  const ramp = (name: string, chroma: number, at: number) => {
    for (let k = 1; k <= steps; k++) out[`${name}.${k}`] = oklchHex(0.95 - (0.7 * (k - 1)) / Math.max(steps - 1, 1), chroma, at);
  };
  for (const [role, offset] of ROLES[harmony]) {
    out[`${prefix}.${role}`] = oklchHex(l, c, hue + offset);
    ramp(`${prefix}.${role}`, c, hue + offset);
  }
  ramp(`${prefix}.neutral`, Math.min(c, 0.02), hue);
  return out;
}
