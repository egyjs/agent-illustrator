import { castDraft } from 'immer';
import { z } from 'zod';
import { StyleSchema, type Style } from '../scene/model.ts';
import { defineOp } from './registry.ts';

export const style = defineOp({
  name: 'style',
  domain: 'style',
  description: 'Sets style properties on nodes, merging into their current style, and removes the properties listed in unset.',
  schema: z.strictObject({ ids: z.array(z.string()).min(1).max(1000), style: StyleSchema.optional(), unset: z.array(StyleSchema.keyof()).optional() }),
  examples: [
    [
      { op: 'rect', id: 'box', x: 10, y: 10, width: 50, height: 50 },
      { op: 'style', ids: ['$last'], style: { fill: '#e76f51', stroke: '#264653', strokeWidth: 3 } },
    ],
  ],
  handler(input, ctx) {
    const ids = [...new Set(input.ids.map((ref) => ctx.node(ref).id))];
    const patch = ctx.style(input.style);
    if (Object.keys(patch).length === 0 && !input.unset?.length) ctx.warn('no_change', 'style was given nothing to set or unset');
    ctx.update((d) => {
      for (const id of ids) {
        const next: Record<string, unknown> = { ...d.nodes[id]!.style, ...patch };
        for (const key of input.unset ?? []) delete next[key];
        d.nodes[id]!.style = castDraft(next as Style);
      }
    });
    return { ids };
  },
});
