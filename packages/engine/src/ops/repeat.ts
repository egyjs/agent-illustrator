import { z } from 'zod';
import { EngineError } from '../errors.ts';
import { measure, type PathSample } from '../geometry/bezier.ts';
import { contains, rings } from '../geometry/flatten.ts';
import { applyToPoint, compose, cosSinDeg, rotate, scale, translate } from '../geometry/transform.ts';
import type { Box, Mat6, Vec2 } from '../geometry/types.ts';
import { poissonDisk, type Area } from '../random/poisson.ts';
import { between, rngFor } from '../random/rng.ts';
import { subtreeIds, worldSubpaths, worldTransform } from '../scene/query.ts';
import { removeSubtree } from '../scene/store.ts';
import { boundsOf, cloneSubtree, geometryInput, IdInput, insertNew, point, PointInput, positive, shapeOf } from './common.ts';
import { defineOp, Length, type OpContext, type OpResult } from './registry.ts';

/** Where the copies go, and whether the source stays. */
const target = { id: IdInput.optional(), parent: z.string().optional(), keep: z.boolean().optional() };
type Target = { readonly id?: string; readonly parent?: string; readonly keep?: boolean };

/** The source as the copies see it: its world matrix and world box. */
type Origin = { readonly world: Mat6; readonly box: Box; readonly center: Vec2 };

/** Copy of the source with its center on `p`, turned by `deg` and scaled by `s` about that center. */
const placeAt = (o: Origin, p: Vec2, deg: number, s: number): Mat6 => compose(translate(p[0], p[1]), rotate(deg), scale(s), translate(-o.center[0], -o.center[1]), o.world);

function limitCopies(ctx: OpContext, copies: number): void {
  if (copies > ctx.limits.maxGenerated) {
    throw new EngineError(
      'limit_exceeded',
      `${copies} copies in one op; the limit is ${ctx.limits.maxGenerated}`,
      'Ask for fewer copies (a larger spacing or min_distance, a smaller max_count or grid), or split the work into several ops.',
    );
  }
}

type Copies = {
  readonly prefix: string;
  readonly src: string;
  /** A node that shapes the placement (`within`, `path`). It stays, so it cannot be part of the source. */
  readonly guide?: string;
  /** Recorded in the group's `meta.source`. */
  readonly source: Record<string, unknown>;
  /** Said when no copy is made. */
  readonly empty: string;
  /** Given the new group's id (which seeds randomness) and the source's frame, returns one world matrix per copy. */
  readonly plan: (group: string, origin: Origin) => readonly Mat6[];
};

/**
 * Shared body of the copy generators: puts the copies in a new group on top of the parent, then
 * removes the source unless `keep` is set. "$last" ends up at the group.
 */
function generate(ctx: OpContext, input: Target, c: Copies): OpResult {
  const subtree = subtreeIds(ctx.doc, c.src);
  const parent = input.parent === undefined ? undefined : ctx.node(input.parent).id;
  for (const id of [parent, c.guide]) {
    if (id !== undefined && subtree.includes(id)) {
      throw new EngineError('invalid_structure', `"${id}" is part of the source "${c.src}", which is copied and then removed`, 'Use a node outside the source, or move it out of the source group first.');
    }
  }
  const box = boundsOf(ctx, c.src);
  const origin: Origin = { world: worldTransform(ctx.doc, c.src), box, center: [box.x + box.width / 2, box.y + box.height / 2] };
  const group = insertNew(ctx, { id: input.id, parent: input.parent }, c.prefix, (b) => ({ ...b, type: 'group', children: [], meta: { source: c.source } }));
  const worlds = c.plan(group, origin);

  limitCopies(ctx, worlds.length);
  const total = Object.keys(ctx.doc.nodes).length + subtree.length * worlds.length;
  if (total > ctx.limits.maxNodes) {
    throw new EngineError(
      'limit_exceeded',
      `the copies would bring the document to ${total} nodes; the limit is ${ctx.limits.maxNodes}`,
      'Copy a simpler source, make fewer copies, or delete nodes first.',
    );
  }
  if (worlds.length === 0) {
    ctx.warn('empty_result', `${c.empty}; the new group is empty and the source was left in place`);
  } else {
    cloneSubtree(ctx, c.src, worlds, group);
    if (!input.keep) {
      ctx.update((d) => {
        removeSubtree(d, c.src);
      });
    }
  }
  ctx.last = group;
  return { id: group };
}

/** Pairs [min, max] that must not run backwards. */
const range = (item: z.ZodNumber) => z.tuple([item, item]).refine(([lo, hi]) => lo <= hi, 'expected [min, max] with min ≤ max');
const Density = z.strictObject({ angle: z.number().optional(), from: z.number().min(0).max(1).optional(), to: z.number().min(0).max(1).optional() });

/** The chance to keep a point: `from` at the start edge of the area along `angle`, `to` at the far edge. */
function keepChance(area: Area, d: z.output<typeof Density>): (x: number, y: number) => number {
  const [dx, dy] = cosSinDeg(d.angle ?? 90);
  const half = (Math.abs(dx) * area.width + Math.abs(dy) * area.height) / 2;
  const cx = area.x + area.width / 2, cy = area.y + area.height / 2;
  const from = d.from ?? 1, to = d.to ?? 0;
  return (x, y) => {
    const t = half > 0 ? Math.min(1, Math.max(0, ((x - cx) * dx + (y - cy) * dy) / (2 * half) + 0.5)) : 0.5;
    return from + (to - from) * t;
  };
}

export const scatter = defineOp({
  name: 'scatter',
  domain: 'generators',
  description:
    'Fills an area with copies of `source` at random, evenly spread (Poisson-disk) positions, no two closer than `min_distance`. ' +
    'The area is the fill of the node `within` (it stays), or a `region` {x, y, width, height}. Each copy is centered on its point with a random `scale` and `rotate` (degrees) from the given [min, max]. ' +
    '`density` thins the copies along a direction: the chance to keep one fades from `from` to `to` across the area (angle 0 = left to right, 90 = top to bottom). ' +
    '`max_count` caps the points drawn, before thinning. Copies land in a new group; the source is removed unless `keep` is true. The same `seed` (default: the document seed) gives the same result.',
  schema: z.strictObject({
    ...target,
    source: z.string(),
    within: z.string().optional(),
    region: z.strictObject({ x: Length, y: Length, width: Length, height: Length }).optional(),
    min_distance: Length,
    max_count: z.number().int().min(1).optional(),
    scale: range(z.number().positive()).optional(),
    rotate: range(z.number()).optional(),
    density: Density.optional(),
    seed: z.number().int().optional(),
  }),
  examples: [
    [
      { op: 'ellipse', id: 'leaf', cx: 0, cy: 0, rx: 8, ry: 4, style: { fill: '#2a9d8f' } },
      { op: 'scatter', source: 'leaf', region: { x: 50, y: 50, width: 700, height: 500 }, min_distance: 40, scale: [0.6, 1.4], rotate: [0, 360], seed: 7 },
    ],
    [
      { op: 'ellipse', id: 'meadow', cx: 400, cy: 300, rx: 300, ry: 200, style: { fill: '#b7e4c7' } },
      { op: 'ellipse', id: 'flower', cx: 0, cy: 0, rx: 6, style: { fill: '#e76f51' } },
      { op: 'scatter', source: 'flower', within: 'meadow', min_distance: 30, max_count: 60, density: { angle: 90, from: 1, to: 0.2 } },
    ],
  ],
  handler(input, ctx) {
    if ((input.within === undefined) === (input.region === undefined)) {
      throw new EngineError(
        'invalid_input',
        'scatter needs exactly one of `within` and `region`',
        'Pass within: "<shape id>" to fill a shape, or region: {"x": 0, "y": 0, "width": 400, "height": 300} for a rectangle.',
      );
    }
    const src = ctx.node(input.source).id;
    const within = input.within === undefined ? undefined : ctx.node(input.within).id;
    const dist = positive('scatter', 'min_distance', ctx.len(input.min_distance, 'min'));
    const maxCount = input.max_count ?? ctx.limits.maxGenerated;
    limitCopies(ctx, maxCount);

    let area: Area;
    let inside: (x: number, y: number) => boolean = () => true;
    if (within !== undefined) {
      const shape = shapeOf(ctx, within);
      const ringsOf = rings(shape.subpaths);
      area = boundsOf(ctx, within);
      inside = (x, y) => contains([x, y], ringsOf, shape.fillRule);
    } else {
      const r = input.region!;
      area = {
        x: ctx.len(r.x, 'x'),
        y: ctx.len(r.y, 'y'),
        width: positive('scatter', 'region width', ctx.len(r.width, 'x')),
        height: positive('scatter', 'region height', ctx.len(r.height, 'y')),
      };
    }
    const seed = input.seed ?? ctx.doc.seed;
    const [minScale, maxScale] = input.scale ?? [1, 1];
    const [minTurn, maxTurn] = input.rotate ?? [0, 0];
    const keep = input.density && keepChance(area, input.density);

    return generate(ctx, input, {
      prefix: 'scatter',
      src,
      guide: within,
      source: {
        kind: 'scatter',
        source: src,
        ...(within === undefined ? { region: area } : { within }),
        min_distance: dist,
        max_count: maxCount,
        scale: [minScale, maxScale],
        rotate: [minTurn, maxTurn],
        ...(input.density && { density: input.density }),
        seed,
      },
      empty: 'no copy fits: min_distance may be too large for the area, or density too low',
      plan(group, origin) {
        const rng = rngFor(seed, group, 'scatter');
        const points = geometryInput(() => poissonDisk(rng, area, dist, inside, maxCount), 'Raise min_distance, or scatter over a smaller area.');
        return points
          .filter(([x, y]) => !keep || rng() < keep(x, y))
          .map((p) => {
            const s = between(rng, minScale, maxScale);
            return placeAt(origin, p, between(rng, minTurn, maxTurn), s);
          });
      },
    });
  },
});

export const repeatAlongPath = defineOp({
  name: 'repeat_along_path',
  domain: 'generators',
  description:
    'Places copies of `source` along the path `path` (it stays), centered on points at equal distances: `count` copies spread over the whole length (a closed outline wraps around), or one every `spacing` units. ' +
    '`offset` shifts the start along the path: on a closed outline it wraps around, on an open path positions beyond either end are skipped (with a warning). With `align` (default true) each copy turns to follow the path direction. Copies land in a new group; the source is removed unless `keep` is true.',
  schema: z.strictObject({
    ...target,
    source: z.string(),
    path: z.string(),
    count: z.number().int().min(1).optional(),
    spacing: Length.optional(),
    offset: Length.optional(),
    align: z.boolean().optional(),
  }),
  examples: [
    [
      { op: 'line', id: 'rail', x1: 50, y1: 300, x2: 750, y2: 300, style: { stroke: '#264653', strokeWidth: 2 } },
      { op: 'rect', id: 'tie', x: 0, y: 0, width: 6, height: 30, style: { fill: '#6c584c' } },
      { op: 'repeat_along_path', source: 'tie', path: 'rail', spacing: 40 },
    ],
    [
      { op: 'ellipse', id: 'track', cx: 400, cy: 300, rx: 250, ry: 150, style: { fill: 'none', stroke: '#264653' } },
      { op: 'polygon', id: 'lamp', cx: 0, cy: 0, radius: 10, sides: 3, style: { fill: '#e9c46a' } },
      { op: 'repeat_along_path', source: 'lamp', path: 'track', count: 12, align: false },
    ],
  ],
  handler(input, ctx) {
    if ((input.count === undefined) === (input.spacing === undefined)) {
      throw new EngineError('invalid_input', 'repeat_along_path needs exactly one of `count` and `spacing`', 'Use count: 12 for a fixed number of copies, or spacing: 40 for a fixed distance between them.');
    }
    const src = ctx.node(input.source).id;
    const guide = ctx.node(input.path);
    if (guide.type !== 'path') {
      throw new EngineError('invalid_structure', `"${guide.id}" is a ${guide.type}, not a path`, 'Pass the id of a path (a line, curve or outline) as `path`; for a group, use a path inside it.');
    }
    const spacing = input.spacing === undefined ? undefined : positive('repeat_along_path', 'spacing', ctx.len(input.spacing, 'min'));
    const offset = input.offset === undefined ? 0 : ctx.len(input.offset, 'min');
    const align = input.align ?? true;
    const subpaths = worldSubpaths(ctx.doc, guide);
    if (subpaths.length === 0) {
      throw new EngineError('invalid_structure', `path "${guide.id}" has no geometry`, 'Give the path some segments first, or pick another path.');
    }
    const parts = subpaths.map(measure);
    const length = parts.reduce((sum, m) => sum + m.length, 0);
    const loop = subpaths.length === 1 && subpaths[0]!.closed && length > 0;

    // Distances along the path, in order. The count is checked before the list is made.
    // A single closed outline wraps: the offset turns modulo its length, and the end is the start, so no copy sits there twice.
    const start = loop ? ((offset % length) + length) % length : offset;
    let n: number;
    if (input.count !== undefined) n = input.count;
    else if (loop) n = Math.floor(length / spacing! + 1e-9);
    else n = Math.max(0, Math.floor((length - start + 1e-9) / spacing!) + 1);
    limitCopies(ctx, n);
    const asked = Array.from({ length: n }, (_, i) => {
      if (loop) return (start + (spacing === undefined ? (length * i) / n : i * spacing)) % length;
      if (spacing !== undefined) return start + i * spacing;
      return n === 1 ? start : start + ((length - start) * i) / (n - 1);
    });
    // On an open path a distance outside [0, length] is no place on it: skip it rather than pile copies on an end.
    const distances = asked.filter((s) => s >= -1e-9 && s <= length + 1e-9);
    if (distances.length < asked.length) {
      ctx.warn('out_of_range', `${asked.length - distances.length} of ${asked.length} positions fall outside the path (length ${Math.round(length * 100) / 100}, offset ${offset}) and were skipped`);
    }

    const sampleAt = (s: number): PathSample => {
      let rest = Math.min(Math.max(s, 0), length);
      for (const m of parts.slice(0, -1)) {
        if (rest <= m.length) return m.at(rest);
        rest -= m.length;
      }
      return parts.at(-1)!.at(rest);
    };

    return generate(ctx, input, {
      prefix: 'repeat',
      src,
      guide: guide.id,
      source: { kind: 'repeat_along_path', source: src, path: guide.id, ...(spacing === undefined ? { count: n } : { spacing }), offset, align },
      empty: 'no position on the path fits: the offset may lie past its end',
      plan: (_group, origin) =>
        distances.map((s) => {
          const { point: p, tangent } = sampleAt(s);
          return placeAt(origin, p, align ? (Math.atan2(tangent[1], tangent[0]) * 180) / Math.PI : 0, 1);
        }),
    });
  },
});

const GRID_ONLY = ['rows', 'cols', 'gap', 'spacing'] as const;
const RADIAL_ONLY = ['count', 'center', 'sweep', 'rotate_copies'] as const;

export const array = defineOp({
  name: 'array',
  domain: 'generators',
  description:
    'Repeats `source` in a pattern. kind "grid": `rows` × `cols` copies, the first where the source is; the step is the source size plus `gap` [x, y] (default [0, 0]), or `spacing` [x, y] from one copy to the next. ' +
    'kind "radial": `count` copies around `center` (default: the canvas center) over `sweep` degrees (default 360, a full circle with no copy at both ends); with `rotate_copies` (default true) each copy turns with the circle. ' +
    'Copies land in a new group; the source is removed unless `keep` is true.',
  schema: z.strictObject({
    ...target,
    source: z.string(),
    kind: z.enum(['grid', 'radial']),
    rows: z.number().int().min(1).optional(),
    cols: z.number().int().min(1).optional(),
    gap: z.tuple([Length, Length]).optional(),
    spacing: z.tuple([Length, Length]).optional(),
    count: z.number().int().min(2).optional(),
    center: PointInput.optional(),
    sweep: z.number().min(-360).max(360).refine((v) => v !== 0, 'sweep must not be 0').optional(),
    rotate_copies: z.boolean().optional(),
  }),
  examples: [
    [
      { op: 'rect', id: 'tile', x: 50, y: 50, width: 60, height: 40, style: { fill: '#e76f51' } },
      { op: 'array', source: 'tile', kind: 'grid', rows: 3, cols: 4, gap: [10, 10] },
    ],
    [
      { op: 'rect', id: 'tick', x: 395, y: 60, width: 10, height: 40, style: { fill: '#264653' } },
      { op: 'array', source: 'tick', kind: 'radial', count: 12, center: [400, 300] },
    ],
  ],
  handler(input, ctx) {
    const stray = (input.kind === 'grid' ? RADIAL_ONLY : GRID_ONLY).filter((k) => input[k] !== undefined);
    if (stray.length > 0) {
      throw new EngineError(
        'invalid_input',
        `${stray.join(', ')} ${stray.length === 1 ? 'does' : 'do'} not apply to a ${input.kind} array`,
        input.kind === 'grid' ? 'A grid takes rows, cols and gap or spacing. For copies around a center, use kind "radial".' : 'A radial array takes count, center, sweep and rotate_copies. For rows and columns, use kind "grid".',
      );
    }
    const src = ctx.node(input.source).id;

    if (input.kind === 'grid') {
      const { rows, cols } = input;
      if (rows === undefined || cols === undefined) {
        throw new EngineError('invalid_input', 'a grid array needs `rows` and `cols`', 'Add them, e.g. {"kind": "grid", "rows": 3, "cols": 4, "gap": [10, 10]}.');
      }
      if (input.gap && input.spacing) {
        throw new EngineError('invalid_input', 'give `gap` or `spacing`, not both', 'gap adds space between copies; spacing sets the distance from copy to copy.');
      }
      limitCopies(ctx, rows * cols);
      return generate(ctx, input, {
        prefix: 'array',
        src,
        source: { kind: 'array', source: src, array: 'grid', rows, cols, ...(input.spacing ? { spacing: input.spacing } : { gap: input.gap ?? [0, 0] }) },
        empty: 'the grid is empty',
        plan(_group, origin) {
          const [sx, sy] = input.spacing
            ? [ctx.len(input.spacing[0], 'x'), ctx.len(input.spacing[1], 'y')]
            : [origin.box.width + (input.gap ? ctx.len(input.gap[0], 'x') : 0), origin.box.height + (input.gap ? ctx.len(input.gap[1], 'y') : 0)];
          return Array.from({ length: rows * cols }, (_, k) => compose(translate((k % cols) * sx, Math.floor(k / cols) * sy), origin.world));
        },
      });
    }

    const { count } = input;
    if (count === undefined) {
      throw new EngineError('invalid_input', 'a radial array needs `count`', 'Add it, e.g. {"kind": "radial", "count": 12, "center": [400, 300]}.');
    }
    limitCopies(ctx, count);
    const center = input.center ? point(ctx, input.center) : ([ctx.doc.canvas.width / 2, ctx.doc.canvas.height / 2] as const);
    const sweep = input.sweep ?? 360;
    const turn = input.rotate_copies ?? true;
    return generate(ctx, input, {
      prefix: 'array',
      src,
      source: { kind: 'array', source: src, array: 'radial', count, center, sweep, rotate_copies: turn },
      empty: 'the array is empty',
      plan: (_group, origin) =>
        Array.from({ length: count }, (_, k) => {
          const theta = (k * sweep) / (Math.abs(sweep) === 360 ? count : count - 1);
          if (turn) return compose(rotate(theta, center[0], center[1]), origin.world);
          const [rx, ry] = applyToPoint(rotate(theta), [origin.center[0] - center[0], origin.center[1] - center[1]]);
          return compose(translate(rx + center[0] - origin.center[0], ry + center[1] - origin.center[1]), origin.world);
        }),
    });
  },
});
