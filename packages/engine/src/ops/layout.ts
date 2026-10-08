import { z } from 'zod';
import { bandQuery, indexBounds } from '../analysis/spatial-index.ts';
import { EngineError } from '../errors.ts';
import { translate } from '../geometry/transform.ts';
import type { Box } from '../geometry/types.ts';
import { requireNode, subtreeIds } from '../scene/query.ts';
import { AnchorInput, anchorPoint, applyWorld, boundsOf, point, PointInput, resolveIds, selectionBounds, topmost } from './common.ts';
import { defineOp, type OpContext } from './registry.ts';

const canvasBox = (ctx: OpContext): Box => ({ x: 0, y: 0, width: ctx.doc.canvas.width, height: ctx.doc.canvas.height });
const moveAll = (ctx: OpContext, ids: readonly string[], dx: number, dy: number) => {
  if (dx !== 0 || dy !== 0) for (const id of ids) applyWorld(ctx, id, translate(dx, dy));
};
const result = (ids: readonly string[]) => (ids.length === 1 ? { id: ids[0]! } : { ids });

/** The ids that move with the selection: each selected node and everything below it. */
const movedIds = (ctx: OpContext, ids: readonly string[]) => new Set(ids.flatMap((id) => subtreeIds(ctx.doc, id)));

/** The reference box: "canvas", a node id, or (undefined) the selection itself. */
function referenceBox(ctx: OpContext, ref: string | undefined, ids: readonly string[]): Box {
  if (ref === undefined) return selectionBounds(ctx, ids);
  if (ref === 'canvas') return canvasBox(ctx);
  const id = ctx.node(ref).id;
  if (movedIds(ctx, ids).has(id)) throw new EngineError('invalid_input', `"${id}" moves with the selection, so it cannot be the reference`, 'Use another node or "canvas" as the reference.');
  return boundsOf(ctx, id);
}

export const place = defineOp({
  name: 'place',
  domain: 'layout',
  description:
    'Moves nodes (as one unit) so their `anchor` lands on the `target_anchor` of `relative_to` (a node id or "canvas"), plus offset [dx, dy]. ' +
    'Anchors: top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right; target_anchor defaults to anchor.',
  schema: z.strictObject({
    ids: z.array(z.string()).min(1).max(1000),
    relative_to: z.string(),
    anchor: AnchorInput.optional(),
    target_anchor: AnchorInput.optional(),
    offset: PointInput.optional(),
  }),
  examples: [
    [
      { op: 'ellipse', id: 'sun', cx: 0, cy: 0, rx: 50, style: { fill: '#ffb703' } },
      { op: 'place', ids: ['sun'], relative_to: 'canvas', anchor: 'top-right', offset: [-40, 40] },
    ],
  ],
  handler(input, ctx) {
    const ids = topmost(ctx, resolveIds(ctx, input.ids));
    const ref = referenceBox(ctx, input.relative_to, ids);
    const anchor = input.anchor ?? 'center';
    const from = anchorPoint(selectionBounds(ctx, ids), anchor);
    const to = anchorPoint(ref, input.target_anchor ?? anchor);
    const [ox, oy] = input.offset ? point(ctx, input.offset) : [0, 0];
    moveAll(ctx, ids, to[0] + ox - from[0], to[1] + oy - from[1]);
    return result(ids);
  },
});

const EDGES = ['left', 'right', 'top', 'bottom', 'center-x', 'center-y'] as const;
type Edge = (typeof EDGES)[number];
const edgeValue = (b: Box, e: Edge) =>
  e === 'left' ? b.x : e === 'right' ? b.x + b.width : e === 'top' ? b.y : e === 'bottom' ? b.y + b.height : e === 'center-x' ? b.x + b.width / 2 : b.y + b.height / 2;

export const align = defineOp({
  name: 'align',
  domain: 'layout',
  description: 'Lines nodes up on one edge or center ("left", "right", "top", "bottom", "center-x", "center-y") of `to`: the selection (default), "canvas" or a node id.',
  schema: z.strictObject({ ids: z.array(z.string()).min(1).max(1000), edge: z.enum(EDGES), to: z.string().optional() }),
  examples: [
    [
      { op: 'rect', id: 'a', x: 100, y: 100, width: 80, height: 40 },
      { op: 'rect', id: 'b', x: 140, y: 200, width: 120, height: 40 },
      { op: 'align', ids: ['a', 'b'], edge: 'center-x', to: 'canvas' },
    ],
  ],
  handler(input, ctx) {
    const ids = topmost(ctx, resolveIds(ctx, input.ids));
    const target = edgeValue(referenceBox(ctx, input.to, ids), input.edge);
    const horizontal = input.edge === 'left' || input.edge === 'right' || input.edge === 'center-x';
    for (const id of ids) {
      const d = target - edgeValue(boundsOf(ctx, id), input.edge);
      moveAll(ctx, [id], horizontal ? d : 0, horizontal ? 0 : d);
    }
    return result(ids);
  },
});

export const distribute = defineOp({
  name: 'distribute',
  domain: 'layout',
  description: 'Spreads nodes along an axis ("x" or "y") between the first and last: mode "gap" (default) makes equal gaps, "center" equal center spacing.',
  schema: z.strictObject({ ids: z.array(z.string()).min(3).max(1000), axis: z.enum(['x', 'y']), mode: z.enum(['gap', 'center']).optional() }),
  examples: [
    [
      { op: 'rect', id: 'p1', x: 100, y: 280, width: 40, height: 40 },
      { op: 'rect', id: 'p2', x: 180, y: 280, width: 80, height: 40 },
      { op: 'rect', id: 'p3', x: 600, y: 280, width: 40, height: 40 },
      { op: 'distribute', ids: ['p1', 'p2', 'p3'], axis: 'x' },
    ],
  ],
  handler(input, ctx) {
    const ids = topmost(ctx, resolveIds(ctx, input.ids));
    if (ids.length < 3) throw new EngineError('invalid_input', 'distribute needs at least three different nodes', 'With two nodes, use align or place.');
    const x = input.axis === 'x';
    const items = ids.map((id) => {
      const b = boundsOf(ctx, id);
      return { id, start: x ? b.x : b.y, size: x ? b.width : b.height };
    });
    const mode = input.mode ?? 'gap';
    items.sort((a, b) => (mode === 'gap' ? a.start - b.start : a.start + a.size / 2 - (b.start + b.size / 2)));
    const first = items[0]!, last = items.at(-1)!;
    const n = items.length;
    if (mode === 'gap') {
      const span = last.start + last.size - first.start;
      const gap = (span - items.reduce((s, i) => s + i.size, 0)) / (n - 1);
      let cursor = first.start;
      for (const item of items) {
        const d = cursor - item.start;
        moveAll(ctx, [item.id], x ? d : 0, x ? 0 : d);
        cursor += item.size + gap;
      }
    } else {
      const c0 = first.start + first.size / 2, c1 = last.start + last.size / 2;
      items.forEach((item, k) => {
        const d = c0 + ((c1 - c0) * k) / (n - 1) - (item.start + item.size / 2);
        moveAll(ctx, [item.id], x ? d : 0, x ? 0 : d);
      });
    }
    return { ids };
  },
});

export const snap = defineOp({
  name: 'snap',
  domain: 'layout',
  description:
    'Nudges nodes (as one unit) so a near edge or center lines up with other nodes ("nodes"), the canvas ("canvas") or a grid ("grid", spacing `grid`), within `tolerance` px (default 8). `to` defaults to ["nodes", "canvas"]; `targets` limits "nodes" to those ids.',
  schema: z.strictObject({
    ids: z.array(z.string()).min(1).max(1000),
    tolerance: z.number().positive().optional(),
    to: z.array(z.enum(['nodes', 'canvas', 'grid'])).min(1).optional(),
    grid: z.number().positive().optional(),
    targets: z.array(z.string()).optional(),
  }),
  examples: [
    [
      { op: 'rect', id: 'wall', x: 300, y: 100, width: 20, height: 300 },
      { op: 'rect', id: 'shelf', x: 324, y: 200, width: 120, height: 10 },
      { op: 'snap', ids: ['shelf'] },
    ],
  ],
  handler(input, ctx) {
    const ids = topmost(ctx, resolveIds(ctx, input.ids));
    const tol = input.tolerance ?? 8;
    const to = new Set(input.to ?? ['nodes', 'canvas']);
    const grid = input.grid;
    if (to.has('grid') && grid === undefined) throw new EngineError('invalid_input', 'snapping to the grid needs `grid` spacing', 'Add grid, e.g. 10.');
    if (grid !== undefined && !to.has('grid')) throw new EngineError('invalid_input', '`grid` is set but `to` does not include "grid"', 'Add "grid" to `to`, or leave `grid` out.');
    if (input.targets && !to.has('nodes')) throw new EngineError('invalid_input', '`targets` only applies when snapping to "nodes"', 'Add "nodes" to `to`, or leave `targets` out.');
    const b = selectionBounds(ctx, ids);
    // The moved nodes and the groups around them are no targets: their bounds follow the move.
    const skip = movedIds(ctx, ids);
    for (const id of ids) for (let p = requireNode(ctx.doc, id).parent; p !== null; p = requireNode(ctx.doc, p).parent) skip.add(p);
    const only = input.targets ? new Set(resolveIds(ctx, input.targets)) : undefined;
    const tree = to.has('nodes') ? indexBounds(ctx.doc, skip) : undefined;
    const best = (axis: 'x' | 'y'): number => {
      const lo = axis === 'x' ? b.x : b.y, size = axis === 'x' ? b.width : b.height;
      const features = [lo, lo + size / 2, lo + size];
      const cands: number[] = [];
      if (tree) {
        for (const n of bandQuery(tree, axis, lo - tol, lo + size + tol)) {
          if (only && !only.has(n.id)) continue;
          const [a, z2] = axis === 'x' ? [n.minX, n.maxX] : [n.minY, n.maxY];
          cands.push(a, (a + z2) / 2, z2);
        }
      }
      if (to.has('canvas')) {
        const full = axis === 'x' ? ctx.doc.canvas.width : ctx.doc.canvas.height;
        cands.push(0, full / 2, full);
      }
      if (grid !== undefined) for (const f of features) cands.push(Math.round(f / grid) * grid);
      // The smallest shift wins, so an edge that already lines up keeps the node where it is.
      let shift: number | undefined;
      for (const f of features) {
        for (const c of cands) {
          const d = c - f;
          if (Math.abs(d) <= tol && (shift === undefined || Math.abs(d) < Math.abs(shift))) shift = d;
        }
      }
      return shift ?? 0;
    };
    const dx = best('x'), dy = best('y');
    if (dx === 0 && dy === 0) ctx.warn('nothing_to_snap', `nothing moved: no target edge or center is within ${tol} px, or the node already lines up with one`);
    moveAll(ctx, ids, dx, dy);
    return result(ids);
  },
});
