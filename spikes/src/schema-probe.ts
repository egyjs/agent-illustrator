import * as z from 'zod';

export const OP_NAMES = Array.from({ length: 50 }, (_, i) => `op_${i}`) as [string, ...string[]];

// One shared instance on purpose: proves the SDK inlines reused sub-schemas instead of emitting $ref.
const point = z.object({ x: z.number(), y: z.number() });

const variants = OP_NAMES.map((name) =>
  z.object({
    op: z.literal(name),
    id: z.string(),
    at: point,
    size: z.number().positive().optional(),
    fill: z.string().optional(),
  }),
);
type Variant = (typeof variants)[number];

/** Strict per-op validation: what the registry will run on the server (M2). */
export const UNION_OPS = z.discriminatedUnion('op', variants as [Variant, ...Variant[]]);

/** What the tool advertises (spec S1): op name enum plus passthrough fields. */
export const LOOSE_OPS = z.looseObject({ op: z.enum(OP_NAMES) });
