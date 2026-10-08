import { z } from 'zod';
import { EngineError } from '../errors.ts';
import type { FillRule, Mat6, Subpath } from '../geometry/types.ts';
import { resolvePaint, toSvgColor } from './color.ts';

/** Semantic ids double as SVG ids: a letter or "_", then letters, digits, "_", "." or "-"; at most 64 characters. */
export const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
/** Words with a meaning of their own in op fields. */
export const RESERVED_IDS: ReadonlySet<string> = new Set(['canvas']);
export const MAX_CANVAS = 16384;

/** False for the pattern's misses, reserved words, and names that would collide with Object.prototype. */
export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id) && !id.startsWith('__') && !(id in Object.prototype) && !RESERVED_IDS.has(id);
}

/** A CSS color, 'none', or the name of a token in `doc.tokens`. */
export type Paint = string;
export type LineCap = 'butt' | 'round' | 'square';
export type LineJoin = 'miter' | 'round' | 'bevel';

export type Style = {
  readonly fill?: Paint;
  readonly stroke?: Paint;
  readonly strokeWidth?: number;
  readonly strokeCap?: LineCap;
  readonly strokeJoin?: LineJoin;
  readonly strokeDash?: readonly number[];
  readonly miterLimit?: number;
  readonly opacity?: number;
  readonly fillOpacity?: number;
  readonly strokeOpacity?: number;
};

/** Provenance: the primitive or generator parameters a node was made from (FR-1.2). */
export type NodeMeta = { readonly source?: unknown };

type NodeBase = {
  readonly id: string;
  readonly parent: string | null;
  readonly transform: Mat6;
  readonly style: Style;
  readonly meta?: NodeMeta;
};

export type GroupNode = NodeBase & { readonly type: 'group'; readonly children: readonly string[] };
export type PathNode = NodeBase & { readonly type: 'path'; readonly fillRule: FillRule; readonly subpaths: readonly Subpath[] };
export type SceneNode = GroupNode | PathNode;

export type Canvas = { readonly width: number; readonly height: number; readonly background?: Paint };

/** Spec A3: a flat node map keyed by id, plus the top-level z-order (back → front). */
export type Doc = {
  readonly schema: 1;
  readonly seed: number;
  readonly canvas: Canvas;
  readonly tokens: Readonly<Record<string, string>>;
  readonly nodes: Readonly<Record<string, SceneNode>>;
  readonly root: readonly string[];
};

// zod 4's z.number() already rejects NaN and ±Infinity.
const num = z.number();
const IdSchema = z.string().refine(isValidId, 'not a usable id');
const Vec2Schema = z.tuple([num, num]);
const SegSchema = z.tuple([num, num, num, num, num, num]);
const Mat6Schema = z.tuple([num, num, num, num, num, num]);

export const SubpathSchema = z.strictObject({ start: Vec2Schema, segs: z.array(SegSchema), closed: z.boolean() });
export const PaintSchema = z.string().min(1).max(64);
export const StyleSchema = z.strictObject({
  fill: PaintSchema.optional(),
  stroke: PaintSchema.optional(),
  strokeWidth: z.number().min(0).max(10_000).optional(),
  strokeCap: z.enum(['butt', 'round', 'square']).optional(),
  strokeJoin: z.enum(['miter', 'round', 'bevel']).optional(),
  strokeDash: z.array(z.number().min(0)).max(32).optional(),
  miterLimit: z.number().min(1).max(1000).optional(),
  opacity: z.number().min(0).max(1).optional(),
  fillOpacity: z.number().min(0).max(1).optional(),
  strokeOpacity: z.number().min(0).max(1).optional(),
});

const nodeBase = {
  id: IdSchema,
  parent: IdSchema.nullable(),
  transform: Mat6Schema,
  style: StyleSchema,
  meta: z.strictObject({ source: z.unknown().optional() }).optional(),
};
const GroupSchema = z.strictObject({ ...nodeBase, type: z.literal('group'), children: z.array(IdSchema) });
const PathSchema = z.strictObject({
  ...nodeBase,
  type: z.literal('path'),
  fillRule: z.enum(['nonzero', 'evenodd']),
  subpaths: z.array(SubpathSchema),
});

export const DocSchema = z.strictObject({
  schema: z.literal(1),
  seed: z.number().int(),
  canvas: z.strictObject({
    width: z.number().positive().max(MAX_CANVAS),
    height: z.number().positive().max(MAX_CANVAS),
    background: PaintSchema.optional(),
  }),
  tokens: z.record(z.string(), z.string()),
  nodes: z.record(IdSchema, z.discriminatedUnion('type', [GroupSchema, PathSchema])),
  root: z.array(IdSchema),
});

export type CreateDocumentInput = {
  readonly width: number;
  readonly height: number;
  readonly background?: Paint;
  readonly seed?: number;
};

/** A new empty document (FR-1.1). The seed defaults to 1; callers that want variety pass their own. */
export function createDocument(input: CreateDocumentInput): Doc {
  const { width, height, background, seed = 1 } = input;
  for (const [name, v] of [['width', width], ['height', height]] as const) {
    if (!Number.isFinite(v) || v <= 0 || v > MAX_CANVAS) {
      throw new EngineError(
        'invalid_input',
        `canvas ${name} must be a number in (0, ${MAX_CANVAS}], got ${v}`,
        'Give the canvas size in px, for example width 800 and height 600.',
      );
    }
  }
  if (!Number.isSafeInteger(seed)) {
    throw new EngineError('invalid_input', `seed must be an integer, got ${seed}`, 'Use a whole number such as 42, or leave seed out.');
  }
  if (background !== undefined && toSvgColor(background) === undefined) {
    throw new EngineError(
      'invalid_color',
      `background "${background}" is not a color`,
      'Use a CSS color such as "#ffffff", "white" or "rgb(240 240 240)", or "none".',
    );
  }
  return {
    schema: 1,
    seed,
    canvas: background === undefined ? { width, height } : { width, height, background },
    tokens: {},
    nodes: {},
    root: [],
  };
}

/** Untrusted JSON → Doc: the schema first, then the tree invariants. Throws invalid_document. */
export function validateDocument(json: unknown): Doc {
  const parsed = DocSchema.safeParse(json);
  const hint = 'Load a document saved by this engine; edits by hand must keep its schema.';
  if (!parsed.success) throw new EngineError('invalid_document', z.prettifyError(parsed.error), hint);
  const doc = parsed.data as Doc;
  const problem = integrityProblem(doc) ?? paintProblem(doc);
  if (problem) throw new EngineError('invalid_document', problem, hint);
  return doc;
}

/** The first token value that is not a color, or paint that is neither a color nor a token; or null. */
function paintProblem(doc: Doc): string | null {
  for (const [name, value] of Object.entries(doc.tokens)) {
    if (toSvgColor(value) === undefined) return `token "${name}" holds "${value}", which is not a color`;
  }
  const bad = (paint: string | undefined) => paint !== undefined && resolvePaint(doc, paint) === undefined;
  if (bad(doc.canvas.background)) return `background "${doc.canvas.background}" is not a color or a token`;
  for (const node of Object.values(doc.nodes)) {
    for (const key of ['fill', 'stroke'] as const) {
      if (bad(node.style[key])) return `${key} "${node.style[key]}" of "${node.id}" is not a color or a token`;
    }
  }
  return null;
}

/**
 * The first broken tree invariant, or null. Invariants: every map key equals its node's id; every
 * listed id exists, is listed once, and names its list's owner as parent; every node is reachable
 * from root.
 */
export function integrityProblem(doc: Doc): string | null {
  for (const [key, node] of Object.entries(doc.nodes)) {
    if (key !== node.id) return `node key "${key}" holds id "${node.id}"`;
  }
  const seen = new Set<string>();
  const visit = (ids: readonly string[], parent: string | null): string | null => {
    for (const id of ids) {
      const node = Object.hasOwn(doc.nodes, id) ? doc.nodes[id] : undefined;
      const where = parent === null ? 'root' : `group "${parent}"`;
      if (!node) return `"${id}" is listed in ${where} but does not exist`;
      if (seen.has(id)) return `"${id}" is listed more than once`;
      seen.add(id);
      if (node.parent !== parent) return `"${id}" names parent ${JSON.stringify(node.parent)} but is listed in ${where}`;
      if (node.type === 'group') {
        const problem = visit(node.children, id);
        if (problem) return problem;
      }
    }
    return null;
  };
  const problem = visit(doc.root, null);
  if (problem) return problem;
  const orphan = Object.keys(doc.nodes).find((id) => !seen.has(id));
  return orphan === undefined ? null : `"${orphan}" is not reachable from root`;
}
