import { z } from 'zod';
import { EngineError } from '../errors.ts';
import { ellipse as ellipsePath, polyline, roundCorners } from '../geometry/paths.ts';
import { cosSinDeg } from '../geometry/transform.ts';
import type { Vec2 } from '../geometry/types.ts';
import { addPath, common, positive } from './common.ts';
import { defineOp, Length } from './registry.ts';

export const rect = defineOp({
  name: 'rect',
  domain: 'shapes',
  description: 'Rectangle from its top-left corner (x, y), width and height, with optional rounded corners (radius, clamped to half the shorter side).',
  schema: z.strictObject({ ...common, x: Length, y: Length, width: Length, height: Length, radius: Length.optional() }),
  examples: [
    [{ op: 'rect', id: 'sky', x: 0, y: 0, width: '100%', height: '60%', style: { fill: '#8ecae6' } }],
    [{ op: 'rect', id: 'card', x: 100, y: 100, width: 200, height: 120, radius: 16, style: { fill: '#ffffff', stroke: '#264653', strokeWidth: 2 } }],
  ],
  handler(input, ctx) {
    const x = ctx.len(input.x, 'x'), y = ctx.len(input.y, 'y');
    const w = positive('rect', 'width', ctx.len(input.width, 'x'));
    const h = positive('rect', 'height', ctx.len(input.height, 'y'));
    const r = input.radius === undefined ? 0 : ctx.len(input.radius, 'min');
    if (r < 0) throw new EngineError('invalid_input', `rect radius must be ≥ 0, got ${r}`, 'Use 0 for sharp corners or a positive radius.');
    let sp = polyline([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
    if (r > 0) {
      const rounded = roundCorners(sp, r);
      if (rounded.clamped > 0) ctx.warn('radius_clamped', `radius ${r} is more than half the shorter side; used ${Math.min(w, h) / 2}`);
      sp = rounded.subpath;
    }
    return { id: addPath(ctx, input, { prefix: 'rect', subpaths: [sp], source: { kind: 'rect', x, y, width: w, height: h, radius: r } }) };
  },
});

export const ellipse = defineOp({
  name: 'ellipse',
  domain: 'shapes',
  description: 'Ellipse or circle from its center (cx, cy) and radii; ry defaults to rx, which makes a circle.',
  schema: z.strictObject({ ...common, cx: Length, cy: Length, rx: Length, ry: Length.optional() }),
  examples: [[{ op: 'ellipse', id: 'sun', cx: '75%', cy: '20%', rx: 60, style: { fill: '#ffb703' } }]],
  handler(input, ctx) {
    const cx = ctx.len(input.cx, 'x'), cy = ctx.len(input.cy, 'y');
    const rx = positive('ellipse', 'rx', ctx.len(input.rx, 'x'));
    const ry = input.ry === undefined ? rx : positive('ellipse', 'ry', ctx.len(input.ry, 'y'));
    return { id: addPath(ctx, input, { prefix: 'ellipse', subpaths: [ellipsePath(cx, cy, rx, ry)], source: { kind: 'ellipse', cx, cy, rx, ry } }) };
  },
});

export const polygon = defineOp({
  name: 'polygon',
  domain: 'shapes',
  description: 'Regular polygon with `sides` corners on a circle of `radius` around (cx, cy). The first corner points up; rotation turns it clockwise in degrees.',
  schema: z.strictObject({ ...common, cx: Length, cy: Length, radius: Length, sides: z.number().int().min(3).max(1000), rotation: z.number().optional() }),
  examples: [[{ op: 'polygon', id: 'hex', cx: 400, cy: 300, radius: 80, sides: 6, style: { fill: '#2a9d8f' } }]],
  handler(input, ctx) {
    const cx = ctx.len(input.cx, 'x'), cy = ctx.len(input.cy, 'y');
    const r = positive('polygon', 'radius', ctx.len(input.radius, 'min'));
    const rotation = input.rotation ?? 0;
    const pts = Array.from({ length: input.sides }, (_, k): Vec2 => {
      const [c, s] = cosSinDeg(rotation - 90 + (360 * k) / input.sides);
      return [cx + r * c, cy + r * s];
    });
    return { id: addPath(ctx, input, { prefix: 'polygon', subpaths: [polyline(pts, true)], source: { kind: 'polygon', cx, cy, radius: r, sides: input.sides, rotation } }) };
  },
});

export const line = defineOp({
  name: 'line',
  domain: 'shapes',
  description: 'Straight line from (x1, y1) to (x2, y2). Stroke defaults to black, since a line has no fill area.',
  schema: z.strictObject({ ...common, x1: Length, y1: Length, x2: Length, y2: Length }),
  examples: [[{ op: 'line', id: 'horizon', x1: 0, y1: '60%', x2: '100%', y2: '60%', style: { stroke: '#264653', strokeWidth: 3 } }]],
  handler(input, ctx) {
    const a: Vec2 = [ctx.len(input.x1, 'x'), ctx.len(input.y1, 'y')];
    const b: Vec2 = [ctx.len(input.x2, 'x'), ctx.len(input.y2, 'y')];
    if (a[0] === b[0] && a[1] === b[1]) {
      throw new EngineError('invalid_input', 'line end points are the same point', 'Give the line two different end points.');
    }
    return {
      id: addPath(ctx, input, {
        prefix: 'line',
        subpaths: [polyline([a, b], false)],
        source: { kind: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1] },
        defaults: { stroke: '#000000' },
      }),
    };
  },
});

export const star = defineOp({
  name: 'star',
  domain: 'shapes',
  description: 'Star with `points` tips: outer and inner radius around (cx, cy). The first tip points up; rotation turns it clockwise in degrees; roundness 0..1 rounds the corners.',
  schema: z.strictObject({
    ...common,
    cx: Length,
    cy: Length,
    outer: Length,
    inner: Length,
    points: z.number().int().min(3).max(500),
    rotation: z.number().optional(),
    roundness: z.number().min(0).max(1).optional(),
  }),
  examples: [[{ op: 'star', id: 'badge', cx: 400, cy: 300, outer: 100, inner: 45, points: 5, style: { fill: '#ffb703' } }]],
  handler(input, ctx) {
    const cx = ctx.len(input.cx, 'x'), cy = ctx.len(input.cy, 'y');
    const ro = positive('star', 'outer', ctx.len(input.outer, 'min'));
    const ri = positive('star', 'inner', ctx.len(input.inner, 'min'));
    const n = input.points, rotation = input.rotation ?? 0, roundness = input.roundness ?? 0;
    const pts = Array.from({ length: 2 * n }, (_, k): Vec2 => {
      const r = k % 2 === 0 ? ro : ri;
      const [c, s] = cosSinDeg(rotation - 90 + (180 * k) / n);
      return [cx + r * c, cy + r * s];
    });
    let sp = polyline(pts, true);
    if (roundness > 0) {
      const edge = Math.hypot(pts[1]![0] - pts[0]![0], pts[1]![1] - pts[0]![1]);
      sp = roundCorners(sp, roundness * edge).subpath;
    }
    return { id: addPath(ctx, input, { prefix: 'star', subpaths: [sp], source: { kind: 'star', cx, cy, outer: ro, inner: ri, points: n, rotation, roundness } }) };
  },
});
