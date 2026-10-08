import { z } from 'zod';
import { EngineError } from '../errors.ts';
import { HARMONIES, makePalette, resolveColor, toSvgColor } from '../scene/color.ts';
import { isValidId } from '../scene/model.ts';
import { defineOp, type OpContext } from './registry.ts';

/** Checks names and colors, merges the values into `doc.tokens`, and returns how many existing tokens changed color. */
function writeTokens(ctx: OpContext, values: Readonly<Record<string, string>>): number {
  for (const [name, value] of Object.entries(values)) {
    if (!isValidId(name)) {
      throw new EngineError(
        'invalid_input',
        `"${name}" is not a usable token name`,
        'Token names start with a letter or "_" and use letters, digits, "_", "." or "-" (at most 64), for example "brand.ink".',
      );
    }
    const color = toSvgColor(value);
    if (color === undefined || color === 'none') {
      throw new EngineError('invalid_color', `token "${name}": "${value}" is not a color`, 'Give a CSS color such as "#2a9d8f", "teal" or "oklch(0.7 0.1 200)".');
    }
    if (Object.hasOwn(ctx.doc.defs, name)) {
      throw new EngineError('invalid_input', `"${name}" is already the name of a gradient or filter`, 'Pick another name (for the palette op, another prefix): tokens and gradient/filter names share one namespace.');
    }
  }
  const changed = Object.entries(values).filter(([name, value]) => Object.hasOwn(ctx.doc.tokens, name) && toSvgColor(ctx.doc.tokens[name]!) !== toSvgColor(value)).length;
  ctx.update((d) => {
    Object.assign(d.tokens, values);
  });
  return changed;
}

export const tokens = defineOp({
  name: 'tokens',
  domain: 'color',
  description:
    'Sets named color tokens, merging into the existing ones. Use a token name as any fill, stroke, shadow color or gradient stop; changing the token later recolors everything that uses it.',
  schema: z.strictObject({ set: z.record(z.string(), z.string()) }),
  examples: [[{ op: 'tokens', set: { 'brand.ink': '#264653', 'brand.sun': 'oklch(0.85 0.17 85)' } }]],
  handler(input, ctx) {
    const entries = Object.entries(input.set);
    if (entries.length === 0 || entries.length > 200) {
      throw new EngineError(
        entries.length === 0 ? 'invalid_input' : 'limit_exceeded',
        `tokens needs 1 to 200 entries in "set", got ${entries.length}`,
        'Pass {"name": "color"} pairs, for example {"brand.ink": "#264653"}; split very large sets over several calls.',
      );
    }
    writeTokens(ctx, input.set);
    return { data: { tokens: Object.fromEntries(entries.map(([name, value]) => [name, toSvgColor(value)])) } };
  },
});

export const palette = defineOp({
  name: 'palette',
  domain: 'color',
  description:
    'Generates a color palette from a base color or token as tokens named <prefix>.<role> (the role color) and <prefix>.<role>.1 … .N (light to dark), for each role of the harmony (monochrome: primary; complementary: primary, accent; analogous and triadic: primary, secondary, tertiary), plus <prefix>.neutral.1 … .N. Overwrites tokens of the same name.',
  schema: z.strictObject({
    base: z.string().min(1).max(64),
    harmony: z.enum(HARMONIES).optional(),
    steps: z.number().int().min(3).max(9).optional(),
    prefix: z.string().optional(),
  }),
  examples: [
    [{ op: 'palette', base: '#2a9d8f', harmony: 'complementary' }],
    [{ op: 'tokens', set: { 'brand.ink': '#264653' } }, { op: 'palette', base: 'brand.ink', harmony: 'triadic', steps: 7, prefix: 'ink' }],
  ],
  handler(input, ctx) {
    const base = resolveColor(ctx.doc, input.base);
    if (base === undefined) {
      throw new EngineError('invalid_color', `"${input.base}" is not a color or a token`, 'Use a CSS color such as "#2a9d8f" or "teal", or the name of a color token.');
    }
    const prefix = input.prefix ?? 'palette';
    // "<prefix>.secondary.9" is the longest name the palette makes, so it is the one that can exceed 64 characters.
    if (!isValidId(prefix) || !isValidId(`${prefix}.secondary.9`)) {
      throw new EngineError(
        'invalid_input',
        `prefix "${prefix}" cannot start valid token names`,
        'Use a short prefix (at most 52 characters) that starts with a letter or "_" and uses letters, digits, "_", "." or "-", for example "brand".',
      );
    }
    const values = makePalette(base, input.harmony ?? 'analogous', input.steps ?? 5, prefix)!;
    const changed = writeTokens(ctx, values);
    if (changed > 0) ctx.warn('tokens_replaced', `${changed} existing token(s) got a new color; shapes using them changed too`);
    return { data: { tokens: values } };
  },
});
