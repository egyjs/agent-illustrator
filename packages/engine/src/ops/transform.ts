import { z } from 'zod';
import { compose, IDENTITY, invert, rotate, scale, skewX, skewY, translate } from '../geometry/transform.ts';
import type { Box, Mat6, Vec2 } from '../geometry/types.ts';
import { AnchorInput, anchorPoint, applyWorld, boundsOf, point, PointInput, resolveIds, selectionBounds, topmost } from './common.ts';
import { defineOp } from './registry.ts';

const nonZero = z.number().refine((v) => v !== 0, 'scale must not be 0 (that flattens the node)');
const num = z.number();
const skewAngle = z.number().refine((v) => Math.abs(v) < 90, 'a skew angle must be between -90 and 90 degrees (at 90 the node collapses to a line)');
const invertible = z
  .tuple([num, num, num, num, num, num])
  .refine((m) => invert(m) !== null, 'matrix must have a non-zero determinant (a·d − b·c); a singular matrix flattens the node');

export const transform = defineOp({
  name: 'transform',
  domain: 'transform',
  description:
    'Moves, rotates (degrees, clockwise), scales, skews (degrees [x, y]) or applies a matrix [a, b, c, d, e, f] to nodes, in canvas space. ' +
    'pivot is an anchor ("center", "top-left", …) or a point [x, y]; around "each" (default) uses each node\'s own bounds, "selection" their combined bounds. ' +
    'Order: matrix, scale, skew, rotate (about the pivot), then translate.',
  schema: z.strictObject({
    ids: z.array(z.string()).min(1).max(1000),
    translate: PointInput.optional(),
    rotate: z.number().optional(),
    scale: z.union([nonZero, z.tuple([nonZero, nonZero])]).optional(),
    skew: z.tuple([skewAngle, skewAngle]).optional(),
    matrix: invertible.optional(),
    pivot: z.union([AnchorInput, PointInput]).optional(),
    around: z.enum(['each', 'selection']).optional(),
  }),
  examples: [
    [
      { op: 'rect', id: 'card', x: 300, y: 250, width: 200, height: 100, style: { fill: '#e9c46a' } },
      { op: 'transform', ids: ['card'], rotate: -8, translate: [20, 0] },
    ],
  ],
  handler(input, ctx) {
    const all = resolveIds(ctx, input.ids);
    const ids = topmost(ctx, all);
    if (ids.length < all.length) ctx.warn('skipped_descendants', `${all.length - ids.length} node(s) already move with a selected group`);
    const has = input.translate || input.rotate !== undefined || input.scale !== undefined || input.skew || input.matrix;
    if (!has) {
      ctx.warn('no_change', 'transform was given nothing to do');
      return ids.length === 1 ? { id: ids[0]! } : { ids };
    }
    const [sx, sy] = typeof input.scale === 'number' ? [input.scale, input.scale] : (input.scale ?? [1, 1]);
    const [kx, ky] = input.skew ?? [0, 0];
    const t = input.translate ? point(ctx, input.translate) : ([0, 0] as Vec2);
    // Bounds are measured only for an anchor pivot, so an explicit point also works on a node that draws nothing.
    const pivotOf = (bounds: () => Box): Vec2 => (Array.isArray(input.pivot) ? point(ctx, input.pivot) : anchorPoint(bounds(), input.pivot ?? 'center'));
    const delta = (p: Vec2): Mat6 =>
      compose(translate(t[0], t[1]), translate(p[0], p[1]), rotate(input.rotate ?? 0), skewX(kx), skewY(ky), scale(sx, sy), translate(-p[0], -p[1]), input.matrix ?? IDENTITY);
    if (input.around === 'selection') {
      const D = delta(pivotOf(() => selectionBounds(ctx, ids)));
      for (const id of ids) applyWorld(ctx, id, D);
    } else {
      for (const id of ids) applyWorld(ctx, id, delta(pivotOf(() => boundsOf(ctx, id))));
    }
    return ids.length === 1 ? { id: ids[0]! } : { ids };
  },
});
