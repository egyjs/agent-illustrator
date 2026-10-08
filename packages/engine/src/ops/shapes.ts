import { z } from 'zod';
import { EngineError } from '../errors.ts';
import { ellipse as ellipsePath, polyline, roundCorners } from '../geometry/paths.ts';
import { cosSinDeg, IDENTITY } from '../geometry/transform.ts';
import type { Subpath, Vec2 } from '../geometry/types.ts';
import { StyleSchema, type PathNode, type Style } from '../scene/model.ts';
import { insertNode } from '../scene/store.ts';
import { defineOp, Length, type OpContext } from './registry.ts';

const common = { id: z.string().optional(), parent: z.string().optional(), style: StyleSchema.optional() };
type Common = { readonly id?: string; readonly parent?: string; readonly style?: Style };

function positive(op: string, name: string, v: number): number {
  if (!(v > 0)) {
    throw new EngineError('invalid_input', `${op} ${name} must be > 0, got ${v}`, `Give ${name} a positive size in canvas units or a percent such as "10%".`);
  }
  return v;
}

/** Inserts a new path node (on top of its parent or the canvas) and returns its id. */
function addPath(ctx: OpContext, input: Common, prefix: string, subpaths: Subpath[], source: Record<string, unknown>, defaults: Style = {}): string {
  const parent = input.parent === undefined ? null : ctx.node(input.parent);
  if (parent && parent.type !== 'group') {
    throw new EngineError('invalid_structure', `parent "${parent.id}" is a ${parent.type}, not a group`, 'Pass a group id as parent, or leave parent out.');
  }
  const segs = subpaths.reduce((n, sp) => n + sp.segs.length, 0);
  if (segs > ctx.limits.maxSegmentsPerPath) {
    throw new EngineError('limit_exceeded', `${segs} segments in one path; the limit is ${ctx.limits.maxSegmentsPerPath}`, 'Use fewer points or sides.');
  }
  const style = ctx.style({ ...defaults, ...input.style });
  const id = ctx.newId(input.id, prefix);
  const node: PathNode = { id, type: 'path', parent: parent?.id ?? null, transform: IDENTITY, style, fillRule: 'nonzero', subpaths, meta: { source } };
  ctx.update((d) => insertNode(d, node));
  return id;
}

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
    return { id: addPath(ctx, input, 'rect', [sp], { kind: 'rect', x, y, width: w, height: h, radius: r }) };
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
    return { id: addPath(ctx, input, 'ellipse', [ellipsePath(cx, cy, rx, ry)], { kind: 'ellipse', cx, cy, rx, ry }) };
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
    return { id: addPath(ctx, input, 'polygon', [polyline(pts, true)], { kind: 'polygon', cx, cy, radius: r, sides: input.sides, rotation }) };
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
    return { id: addPath(ctx, input, 'line', [polyline([a, b], false)], { kind: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, { stroke: '#000000' }) };
  },
});
