import { z } from 'zod';
import { EngineError } from '../errors.ts';
import { booleanOp } from '../geometry/boolean.ts';
import { applyToSubpaths, IDENTITY, invert } from '../geometry/transform.ts';
import { StyleSchema, type Doc, type GroupNode, type PathNode, type SceneNode, type Style } from '../scene/model.ts';
import { requireNode, siblings, worldTransform } from '../scene/query.ts';
import { insertNode, removeSubtree } from '../scene/store.ts';
import { IdInput, resolveIds, segmentCount, shapesOf, topmost } from './common.ts';
import { defineOp } from './registry.ts';

const paints = (s: Style) => (s.fill ?? 'none') !== 'none' || (s.stroke ?? 'none') !== 'none';

/** A child's style over its parent's: the child's values win, but opacities multiply, as nested SVG groups do. */
const inherit = (above: Style, own: Style): Style =>
  above.opacity !== undefined && own.opacity !== undefined ? { ...above, ...own, opacity: above.opacity * own.opacity } : { ...above, ...own };

/** How a group looks as one path: its first painted path's style, with what the groups above it pass down. */
function groupLook(doc: Doc, group: GroupNode): Style {
  const firstPainted = (node: SceneNode, above: Style): Style | undefined => {
    const style = inherit(above, node.style);
    if (node.type === 'path') return paints(style) ? style : undefined;
    if (node.type === 'text') return undefined;
    for (const child of node.children) {
      const hit = firstPainted(requireNode(doc, child), style);
      if (hit) return hit;
    }
    return undefined;
  };
  return firstPainted(group, {}) ?? group.style;
}

export const boolean = defineOp({
  name: 'boolean',
  domain: 'boolean',
  description:
    'Combines filled shapes: "union", "subtract" (first minus the rest), "intersect" or "exclude". Groups count as the union of their paths. ' +
    'The result is one new path where the first shape was, styled like it; the inputs are removed unless keep is true.',
  schema: z.strictObject({
    mode: z.enum(['union', 'subtract', 'intersect', 'exclude']),
    ids: z.array(z.string()).min(2).max(100),
    id: IdInput.optional(),
    keep: z.boolean().optional(),
    style: StyleSchema.optional(),
  }),
  examples: [
    [
      { op: 'ellipse', id: 'plate', cx: 400, cy: 300, rx: 120, style: { fill: '#264653' } },
      { op: 'ellipse', id: 'hole', cx: 400, cy: 300, rx: 50 },
      { op: 'boolean', mode: 'subtract', ids: ['plate', 'hole'], id: 'ring' },
    ],
  ],
  handler(input, ctx) {
    const ids = resolveIds(ctx, input.ids);
    if (ids.length < 2) throw new EngineError('invalid_input', 'boolean needs at least two different shapes', 'List two or more ids.');
    if (topmost(ctx, ids).length !== ids.length) {
      throw new EngineError('invalid_structure', 'one operand sits inside another operand', 'Use the group alone, or the paths inside it, but not both.');
    }
    const first = requireNode(ctx.doc, ids[0]!);
    const P = first.parent === null ? IDENTITY : worldTransform(ctx.doc, first.parent);
    const Pinv = invert(P);
    if (!Pinv) throw new EngineError('invalid_structure', `the group holding "${first.id}" is squashed flat (scale 0)`, 'Give that group a non-zero scale first.');
    const [head, ...rest] = shapesOf(ctx, ids);
    let acc = head!;
    for (const shape of rest) acc = booleanOp(input.mode, acc, shape);
    const segs = segmentCount(acc.subpaths);
    if (segs > ctx.limits.maxSegmentsPerPath) {
      throw new EngineError('limit_exceeded', `the result has ${segs} segments; the limit is ${ctx.limits.maxSegmentsPerPath}`, 'Combine fewer or simpler shapes at once.');
    }
    if (acc.subpaths.length === 0) ctx.warn('empty_result', `${input.mode} of ${ids.join(', ')} covers no area`);
    const keep = input.keep ?? false;
    const style = ctx.style(input.style ?? (first.type === 'group' ? groupLook(ctx.doc, first) : first.style));
    const consumed = new Set(keep ? [] : ids);
    const id = ctx.newId(input.id, 'boolean', { releasing: consumed, quiet: input.id !== undefined && consumed.has(input.id) });
    const list = siblings(ctx.doc, first);
    const at = list.indexOf(first.id);
    const removedBelow = list.slice(0, at).filter((x) => consumed.has(x)).length;
    const node: PathNode = {
      id,
      type: 'path',
      parent: first.parent,
      transform: IDENTITY,
      style,
      fillRule: 'nonzero',
      subpaths: applyToSubpaths(Pinv, acc.subpaths),
      meta: { source: { kind: 'boolean', mode: input.mode, ids } },
    };
    ctx.update((d) => {
      for (const x of consumed) if (Object.hasOwn(d.nodes, x)) removeSubtree(d, x);
      insertNode(d, node, keep ? at + 1 : at - removedBelow);
    });
    return { id };
  },
});
