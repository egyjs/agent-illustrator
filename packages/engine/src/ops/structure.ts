import { castDraft, type Draft } from 'immer';
import { z } from 'zod';
import { EngineError } from '../errors.ts';
import { applyToSubpaths, compose, IDENTITY, invert, translate } from '../geometry/transform.ts';
import type { ClipShape, Doc, GroupNode, SceneNode, Style } from '../scene/model.ts';
import { requireNode, siblings, subtreeIds, worldTransform } from '../scene/query.ts';
import { detach, insertNode, removeSubtree } from '../scene/store.ts';
import { applyWorld, IdInput, point, PointInput, resolveIds, shapeOf, topmost } from './common.ts';
import { defineOp } from './registry.ts';

/** The list that holds the children of `parent`, or the top level for null. */
const childrenOf = (d: Draft<Doc>, parent: string | null): string[] => (parent === null ? d.root : (d.nodes[parent] as Draft<GroupNode>).children);

export const group = defineOp({
  name: 'group',
  domain: 'structure',
  description: 'Wraps sibling nodes in a new group placed where the topmost member was. Members keep their order and their look.',
  schema: z.strictObject({ id: z.string().optional(), ids: z.array(z.string()).min(1).max(1000) }),
  examples: [
    [
      { op: 'rect', id: 'body', x: 300, y: 250, width: 200, height: 100 },
      { op: 'ellipse', id: 'wheel', cx: 340, cy: 360, rx: 25 },
      { op: 'group', id: 'cart', ids: ['body', 'wheel'] },
    ],
  ],
  handler(input, ctx) {
    const members = [...new Map(input.ids.map((ref) => [ctx.node(ref).id, ctx.node(ref)] as const)).values()];
    const first = members[0]!;
    if (members.some((m) => m.parent !== first.parent)) {
      throw new EngineError('invalid_structure', 'group members must share one parent', 'Group nodes that sit side by side in the same group, or all at the top level.');
    }
    const list = siblings(ctx.doc, first);
    const ordered = members.map((m) => m.id).sort((a, b) => list.indexOf(a) - list.indexOf(b));
    // After the members are taken out, this is where the topmost one was.
    const at = list.indexOf(ordered.at(-1)!) - (ordered.length - 1);
    const id = ctx.newId(input.id, 'group');
    ctx.update((d) => {
      for (const m of ordered) {
        detach(d, m);
        d.nodes[m]!.parent = id;
      }
      insertNode(d, { id, type: 'group', parent: first.parent, transform: IDENTITY, style: {}, children: ordered }, at);
    });
    return { id };
  },
});

export const remove = defineOp({
  name: 'delete',
  domain: 'structure',
  description: 'Deletes nodes. Deleting a group deletes everything inside it.',
  schema: z.strictObject({ ids: z.array(z.string()).min(1).max(1000) }),
  examples: [
    [
      { op: 'rect', id: 'draft', x: 10, y: 10, width: 50, height: 50 },
      { op: 'delete', ids: ['draft'] },
    ],
  ],
  handler(input, ctx) {
    const targets = input.ids.map((ref) => ctx.node(ref).id);
    const removed: string[] = [];
    ctx.update((d) => {
      for (const id of targets) if (Object.hasOwn(d.nodes, id)) removed.push(...removeSubtree(d, id));
    });
    return { ids: removed };
  },
});

const ORDER = ['front', 'back', 'forward', 'backward', 'above', 'below'] as const;

export const reorder = defineOp({
  name: 'reorder',
  domain: 'structure',
  description: 'Changes stacking order among siblings: "front", "back", "forward" (one step up), "backward", or "above"/"below" the `relative` node.',
  schema: z.strictObject({ ids: z.array(z.string()).min(1).max(1000), to: z.enum(ORDER), relative: z.string().optional() }),
  examples: [
    [
      { op: 'rect', id: 'back', x: 100, y: 100, width: 200, height: 200, style: { fill: '#264653' } },
      { op: 'rect', id: 'front', x: 150, y: 150, width: 200, height: 200, style: { fill: '#e9c46a' } },
      { op: 'reorder', ids: ['back'], to: 'front' },
    ],
  ],
  handler(input, ctx) {
    const ids = resolveIds(ctx, input.ids);
    const parent = ctx.node(ids[0]!).parent;
    if (ids.some((id) => ctx.node(id).parent !== parent)) {
      throw new EngineError('invalid_structure', 'reorder works on siblings only', 'Reorder nodes that share one parent; call reorder once per group.');
    }
    let rel: string | undefined;
    if (input.to === 'above' || input.to === 'below') {
      if (input.relative === undefined) throw new EngineError('invalid_input', `to "${input.to}" needs relative`, 'Name the node to go above or below.');
      rel = ctx.node(input.relative).id;
      if (ctx.node(rel).parent !== parent || ids.includes(rel)) {
        throw new EngineError('invalid_structure', `"${rel}" is not a sibling outside the moved set`, 'Pick a sibling that is not being moved.');
      }
    }
    const chosen = new Set(ids);
    ctx.update((d) => {
      const list = childrenOf(d, parent);
      const moving = list.filter((x) => chosen.has(x));
      const rest = list.filter((x) => !chosen.has(x));
      let next: string[];
      if (input.to === 'front') next = [...rest, ...moving];
      else if (input.to === 'back') next = [...moving, ...rest];
      else if (rel !== undefined) {
        const at = rest.indexOf(rel) + (input.to === 'above' ? 1 : 0);
        next = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
      } else {
        next = [...list];
        const step = input.to === 'forward' ? 1 : -1;
        // Walk from the end the nodes move toward, so a selected neighbour is never swapped twice.
        const order = step === 1 ? [...next.keys()].reverse() : [...next.keys()];
        for (const i of order) {
          if (!chosen.has(next[i]!)) continue;
          const j = i + step;
          if (j < 0 || j >= next.length || chosen.has(next[j]!)) continue;
          [next[i], next[j]] = [next[j]!, next[i]!];
        }
      }
      list.splice(0, list.length, ...next);
    });
    return ids.length === 1 ? { id: ids[0]! } : { ids };
  },
});

export const duplicate = defineOp({
  name: 'duplicate',
  domain: 'structure',
  description: 'Copies nodes (with everything inside) just above the originals, moved by offset [dx, dy]. Copies get fresh ids ("tree" → "tree-2"); `id` names a single copy.',
  schema: z.strictObject({ ids: z.array(z.string()).min(1).max(1000), offset: PointInput.optional(), id: IdInput.optional() }),
  examples: [
    [
      { op: 'polygon', id: 'tree', cx: 200, cy: 400, radius: 60, sides: 3, style: { fill: '#2d6a4f' } },
      { op: 'duplicate', ids: ['tree'], offset: [140, 0] },
    ],
  ],
  handler(input, ctx) {
    const ids = topmost(ctx, resolveIds(ctx, input.ids));
    if (input.id !== undefined && ids.length !== 1) throw new EngineError('invalid_input', 'id names one copy, but several nodes are being copied', 'Leave id out, or copy one node.');
    const [dx, dy] = input.offset ? point(ctx, input.offset) : [0, 0];
    const copies: string[] = [];
    for (const src of ids) {
      const subtree = subtreeIds(ctx.doc, src);
      const map = new Map(subtree.slice(1).map((id) => [id, ctx.newId(id, id, { quiet: true })] as const));
      // The copy's root claims its id last, so it ends up as "$last".
      const rootId = ctx.newId(input.id ?? src, src, { quiet: input.id === undefined });
      map.set(src, rootId);
      const nodes = subtree.map((id): SceneNode => {
        const n = requireNode(ctx.doc, id);
        const base = { id: map.get(id)!, parent: id === src ? n.parent : map.get(n.parent!)! };
        return n.type === 'group' ? { ...n, ...base, children: n.children.map((c) => map.get(c)!) } : { ...n, ...base };
      });
      const parent = requireNode(ctx.doc, src).parent;
      ctx.update((d) => {
        const list = childrenOf(d, parent);
        for (const n of nodes) d.nodes[n.id] = castDraft(n);
        list.splice(list.indexOf(src) + 1, 0, rootId);
      });
      if (dx !== 0 || dy !== 0) applyWorld(ctx, rootId, translate(dx, dy));
      copies.push(rootId);
    }
    return copies.length === 1 ? { id: copies[0]! } : { ids: copies };
  },
});

export const rename = defineOp({
  name: 'rename',
  domain: 'structure',
  description: 'Gives a node a new id; every reference to it follows.',
  schema: z.strictObject({ id: z.string(), to: IdInput }),
  examples: [[{ op: 'rect', id: 'rect-1', x: 10, y: 10, width: 50, height: 50 }, { op: 'rename', id: 'rect-1', to: 'window' }]],
  handler(input, ctx) {
    const from = ctx.node(input.id).id;
    const to = input.to;
    if (to !== from && Object.hasOwn(ctx.doc.nodes, to)) throw new EngineError('invalid_input', `id "${to}" is already taken`, 'Pick an unused id, or rename the other node first.');
    ctx.update((d) => {
      const n = d.nodes[from]!;
      delete d.nodes[from];
      n.id = to;
      d.nodes[to] = n;
      const list = childrenOf(d, n.parent);
      list[list.indexOf(from)] = to;
      if (n.type === 'group') for (const c of n.children) d.nodes[c]!.parent = to;
    });
    if (ctx.last === from) ctx.last = to;
    return { id: to };
  },
});

const INHERITED: readonly (keyof Style)[] = ['fill', 'stroke', 'strokeWidth', 'strokeCap', 'strokeJoin', 'strokeDash', 'miterLimit', 'fillOpacity', 'strokeOpacity'];

export const ungroup = defineOp({
  name: 'ungroup',
  domain: 'structure',
  description: 'Dissolves groups: their children move up into the group\'s place and keep their look (position, inherited style, opacity).',
  schema: z.strictObject({ ids: z.array(z.string()).min(1).max(1000) }),
  examples: [
    [
      { op: 'rect', id: 'a', x: 100, y: 100, width: 50, height: 50 },
      { op: 'rect', id: 'b', x: 200, y: 100, width: 50, height: 50 },
      { op: 'group', id: 'pair', ids: ['a', 'b'] },
      { op: 'ungroup', ids: ['pair'] },
    ],
  ],
  handler(input, ctx) {
    const released: string[] = [];
    for (const id of resolveIds(ctx, input.ids)) {
      const g = ctx.node(id);
      if (g.type !== 'group') throw new EngineError('invalid_structure', `"${id}" is not a group`, 'Ungroup works on groups only.');
      if (g.clip) throw new EngineError('invalid_structure', `"${id}" has a clip that would be lost`, 'Remove the clip first with {"op": "clip", "id": …, "shape": null}.');
      const inherited: Record<string, unknown> = {};
      for (const k of INHERITED) if (g.style[k] !== undefined) inherited[k] = g.style[k];
      const kids = g.children.map((c) => requireNode(ctx.doc, c));
      ctx.update((d) => {
        const list = childrenOf(d, g.parent);
        list.splice(list.indexOf(id), 1, ...g.children);
        for (const kid of kids) {
          const child = d.nodes[kid.id]!;
          child.parent = g.parent;
          child.transform = castDraft(compose(g.transform, kid.transform));
          const style: Record<string, unknown> = { ...inherited, ...kid.style };
          if (g.style.opacity !== undefined) style.opacity = g.style.opacity * (kid.style.opacity ?? 1);
          child.style = castDraft(style as Style);
        }
        delete d.nodes[id];
      });
      released.push(...g.children);
    }
    return { ids: released };
  },
});

export const clip = defineOp({
  name: 'clip',
  domain: 'structure',
  description:
    'Clips a node to the filled area of another shape (which is removed unless keep is true). The clip moves with the node and replaces an earlier one. shape null removes the clip.',
  schema: z.strictObject({ id: z.string(), shape: z.string().nullable(), keep: z.boolean().optional() }),
  examples: [
    [
      { op: 'rect', id: 'photo', x: 200, y: 150, width: 400, height: 300, style: { fill: '#8ecae6' } },
      { op: 'ellipse', id: 'frame', cx: 400, cy: 300, rx: 140 },
      { op: 'clip', id: 'photo', shape: 'frame' },
    ],
  ],
  handler(input, ctx) {
    const node = ctx.node(input.id);
    if (input.shape === null) {
      ctx.update((d) => {
        delete d.nodes[node.id]!.clip;
      });
      return { id: node.id };
    }
    const shapeId = ctx.node(input.shape).id;
    if (shapeId === node.id || topmost(ctx, [node.id, shapeId]).length < 2) {
      throw new EngineError('invalid_structure', `"${shapeId}" and "${node.id}" are the same node, or one sits inside the other`, 'Clip with a separate shape that neither holds nor sits inside the node.');
    }
    const inv = invert(worldTransform(ctx.doc, node.id));
    if (!inv) throw new EngineError('invalid_structure', `"${node.id}" is squashed flat (scale 0)`, 'Give it a non-zero scale first.');
    const shape = shapeOf(ctx, shapeId);
    if (shape.subpaths.length === 0) throw new EngineError('invalid_structure', `"${shapeId}" covers no area, so it would hide the whole node`, 'Clip with a shape that has filled geometry.');
    const clipShape: ClipShape = { subpaths: applyToSubpaths(inv, shape.subpaths), fillRule: shape.fillRule };
    const removed: string[] = [];
    ctx.update((d) => {
      d.nodes[node.id]!.clip = castDraft(clipShape);
      if (!input.keep) removed.push(...removeSubtree(d, shapeId));
    });
    if (ctx.last !== undefined && removed.includes(ctx.last)) ctx.last = node.id;
    return { id: node.id };
  },
});
