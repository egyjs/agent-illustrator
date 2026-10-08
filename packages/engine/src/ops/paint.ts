import { castDraft } from 'immer';
import { z } from 'zod';
import { EngineError } from '../errors.ts';
import { resolveColor, toSvgColor } from '../scene/color.ts';
import { PaintSchema, type Def, type Style } from '../scene/model.ts';
import { IdInput, resolveIds } from './common.ts';
import { defineOp, type OpContext } from './registry.ts';

const unit = z.number().min(0).max(1);
const IdsInput = z.array(z.string()).min(1).max(1000);

type DefKind = 'gradient' | 'filter';

/**
 * The name a new def is stored under: the requested id, or the first free "<kind>-<n>". A name must
 * not be a token or read as a color, since a paint resolves tokens and colors before defs. A def of
 * the same kind under that name is replaced (with a warning); one of the other kind is an error.
 */
function defName(ctx: OpContext, requested: string | undefined, kind: DefKind): string {
  const { tokens, defs } = ctx.doc;
  if (requested === undefined) {
    for (let n = 1; ; n++) {
      const name = `${kind}-${n}`;
      if (!Object.hasOwn(defs, name) && !Object.hasOwn(tokens, name)) return name;
    }
  }
  const clash = Object.hasOwn(tokens, requested) ? 'a token' : toSvgColor(requested) !== undefined ? 'a color' : undefined;
  if (clash) {
    throw new EngineError('invalid_input', `"${requested}" cannot name a ${kind}: it is ${clash}`, `Pick another id for the ${kind}, one that is not a token or a color name, such as "sky_fade".`);
  }
  const existing = Object.hasOwn(defs, requested) ? defs[requested] : undefined;
  if (existing) {
    const other: DefKind = existing.kind === 'filter' ? 'filter' : 'gradient';
    if (other !== kind) {
      throw new EngineError('invalid_input', `"${requested}" is already a ${other}, which a ${kind} cannot replace`, `Pick another id for the ${kind}.`);
    }
    ctx.warn('def_replaced', `${kind} "${requested}" already existed and was replaced`);
  }
  return requested;
}

/** Stores the def and, for each id, points its style at it: `style[key] = name`. */
function define(ctx: OpContext, name: string, def: Def, ids: readonly string[] | undefined, key: keyof Style): void {
  ctx.update((d) => {
    d.defs[name] = castDraft(def);
    for (const id of ids ?? []) d.nodes[id]!.style = castDraft({ ...d.nodes[id]!.style, [key]: name } as Style);
  });
}

const Stop = z.union([PaintSchema, z.strictObject({ color: PaintSchema, offset: unit })]);

export const gradient = defineOp({
  name: 'gradient',
  domain: 'style',
  description:
    'Defines a linear or radial gradient and, with ids, paints it as their fill (or stroke). Stops are colors or token names, evenly spaced unless given as {color, offset}; offsets run 0..1 and must not decrease. Linear: angle 0 runs left to right, 90 top to bottom. Radial: center, radius and focal point are fractions of the painted shape\'s box. Colors blend through OKLab, so the ramp stays smooth.',
  schema: z.strictObject({
    id: IdInput.optional(),
    type: z.enum(['linear', 'radial']).optional(),
    stops: z.array(Stop).min(2).max(9),
    angle: z.number().optional(),
    center: z.tuple([unit, unit]).optional(),
    radius: z.number().positive().max(2).optional(),
    focal: z.tuple([unit, unit]).optional(),
    ids: IdsInput.optional(),
    target: z.enum(['fill', 'stroke']).optional(),
  }),
  examples: [
    [
      { op: 'rect', id: 'sky', x: 0, y: 0, width: '100%', height: '100%' },
      { op: 'gradient', id: 'sky_fade', stops: ['#8ecae6', '#ffffff'], angle: 90, ids: ['sky'] },
    ],
    [
      { op: 'ellipse', id: 'sun', cx: 400, cy: 300, rx: 120 },
      { op: 'gradient', id: 'glow', type: 'radial', stops: [{ color: '#fff3b0', offset: 0 }, { color: '#ffb703', offset: 0.6 }, '#e76f51'], focal: [0.4, 0.4], ids: ['sun'] },
    ],
  ],
  handler(input, ctx) {
    const last = input.stops.length - 1;
    const stops = input.stops.map((s, k) => (typeof s === 'string' ? { offset: k / last, color: s } : s));
    stops.forEach(({ color }, k) => {
      if (resolveColor(ctx.doc, color) === undefined) {
        throw new EngineError('invalid_color', `gradient stop ${k + 1} "${color}" is not a color or a token`, 'Use a CSS color such as "#2a9d8f" or a token name; a stop cannot be "none" or another gradient.');
      }
    });
    const back = stops.findIndex((s, k) => k > 0 && s.offset < stops[k - 1]!.offset);
    if (back > 0) {
      throw new EngineError('invalid_input', `gradient stop ${back + 1} (offset ${stops[back]!.offset}) comes before stop ${back} (offset ${stops[back - 1]!.offset})`, 'Sort the stops by offset, from 0 to 1.');
    }
    const name = defName(ctx, input.id, 'gradient');
    const ids = input.ids && resolveIds(ctx, input.ids);
    const def: Def =
      input.type === 'radial'
        ? { kind: 'radial', center: input.center ?? [0.5, 0.5], radius: input.radius ?? 0.5, ...(input.focal ? { focal: input.focal } : {}), stops }
        : { kind: 'linear', angle: input.angle ?? 90, stops };
    define(ctx, name, def, ids, input.target ?? 'fill');
    return { ...(ids ? { ids } : {}), data: { def: name } };
  },
});

export const filter = defineOp({
  name: 'filter',
  domain: 'style',
  description:
    'Defines a blur and/or drop shadow and, with ids, applies it to them. blur and shadow.blur are Gaussian standard deviations in canvas units. The shadow defaults to dx 0, dy 4, blur 4 and a 35% black. Bounds ignore the effect.',
  schema: z.strictObject({
    id: IdInput.optional(),
    blur: z.number().positive().max(500).optional(),
    shadow: z
      .strictObject({ dx: z.number().optional(), dy: z.number().optional(), blur: z.number().min(0).max(500).optional(), color: PaintSchema.optional() })
      .optional(),
    ids: IdsInput.optional(),
  }),
  examples: [
    [
      { op: 'rect', id: 'card', x: 200, y: 150, width: 400, height: 300, radius: 16, style: { fill: '#ffffff' } },
      { op: 'filter', id: 'lift', shadow: { dy: 8, blur: 12, color: 'rgba(38,70,83,0.4)' }, ids: ['card'] },
    ],
    [
      { op: 'ellipse', id: 'haze', cx: 400, cy: 300, rx: 150, style: { fill: '#ffffff' } },
      { op: 'filter', blur: 20, ids: ['haze'] },
    ],
  ],
  handler(input, ctx) {
    if (input.blur === undefined && input.shadow === undefined) {
      throw new EngineError('invalid_input', 'filter needs a blur or a shadow', 'Add "blur": 6, or "shadow": {"dy": 4, "blur": 6}.');
    }
    const shadow = input.shadow && { dx: input.shadow.dx ?? 0, dy: input.shadow.dy ?? 4, blur: input.shadow.blur ?? 4, color: input.shadow.color ?? 'rgba(0,0,0,0.35)' };
    if (shadow && resolveColor(ctx.doc, shadow.color) === undefined) {
      throw new EngineError('invalid_color', `shadow color "${shadow.color}" is not a color or a token`, 'Use a CSS color such as "rgba(0,0,0,0.35)" or a token name.');
    }
    const name = defName(ctx, input.id, 'filter');
    const ids = input.ids && resolveIds(ctx, input.ids);
    define(ctx, name, { kind: 'filter', ...(input.blur === undefined ? {} : { blur: input.blur }), ...(shadow ? { shadow } : {}) }, ids, 'filter');
    return { ...(ids ? { ids } : {}), data: { def: name } };
  },
});

export const mask = defineOp({
  name: 'mask',
  domain: 'style',
  description:
    'Fades a node out with an opacity mask over its bounding box. fade.from is the opacity at the start of a linear fade (angle 0 = left, 90 = top) or at the center of a radial one; fade.to is the opacity at the other end or the rim. fade null removes the mask.',
  schema: z.strictObject({
    id: z.string(),
    fade: z.strictObject({ type: z.enum(['linear', 'radial']).optional(), angle: z.number().optional(), from: unit.optional(), to: unit.optional() }).nullable(),
  }),
  examples: [
    [
      { op: 'rect', id: 'banner', x: 100, y: 100, width: 600, height: 200, style: { fill: '#264653' } },
      { op: 'mask', id: 'banner', fade: { angle: 0, from: 1, to: 0 } },
    ],
  ],
  handler(input, ctx) {
    const node = ctx.node(input.id);
    const { fade } = input;
    ctx.update((d) => {
      const target = d.nodes[node.id]!;
      if (fade) target.mask = { type: fade.type ?? 'linear', angle: fade.angle ?? 90, from: fade.from ?? 1, to: fade.to ?? 0 };
      else delete target.mask;
    });
    return { id: node.id };
  },
});
