import { z } from 'zod';
import { EngineError } from '../errors.ts';
import { IDENTITY } from '../geometry/transform.ts';
import { siblings } from '../scene/query.ts';
import { detach, insertNode, removeSubtree } from '../scene/store.ts';
import { defineOp } from './registry.ts';

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
