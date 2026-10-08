import { z } from 'zod';
import { EngineError } from '../errors.ts';
import type { Box, FillRule, Mat6, Subpath, Vec2 } from '../geometry/types.ts';
import { resolveColor, resolvePaint, toSvgColor } from './color.ts';

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
export const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
  'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

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
  /** Name of a filter def in `doc.defs` (drop shadow, blur). */
  readonly filter?: string;
  readonly blend?: BlendMode;
};

/** A gradient stop; `color` is a CSS color or a token name, never 'none' or a gradient. */
export type GradientStop = { readonly offset: number; readonly color: Paint };
/** Coordinates are fractions of the painted node's bounding box (SVG objectBoundingBox). */
export type LinearGradientDef = { readonly kind: 'linear'; readonly angle: number; readonly stops: readonly GradientStop[] };
export type RadialGradientDef = {
  readonly kind: 'radial';
  readonly center: Vec2;
  readonly radius: number;
  readonly focal?: Vec2;
  readonly stops: readonly GradientStop[];
};
/** Blur and shadow sizes are Gaussian standard deviations in the node's own units. */
export type FilterDef = {
  readonly kind: 'filter';
  readonly blur?: number;
  readonly shadow?: { readonly dx: number; readonly dy: number; readonly blur: number; readonly color: Paint };
};
export type Def = LinearGradientDef | RadialGradientDef | FilterDef;

/** An opacity fade over the node's bounding box: `from` at the start (linear) or center (radial), `to` at the end or rim. */
export type MaskFade = { readonly type: 'linear' | 'radial'; readonly angle: number; readonly from: number; readonly to: number };

export type FontSpec = { readonly family: string; readonly size: number; readonly weight: number; readonly letterSpacing: number };
export type TextAnchor = 'start' | 'middle' | 'end';
/** Point text starts its first baseline at (x, y); path text follows the first subpath from `offset` (0..1 of its length). */
export type TextPlacement =
  | { readonly kind: 'point'; readonly x: number; readonly y: number }
  | { readonly kind: 'path'; readonly subpaths: readonly Subpath[]; readonly offset: number };

/** Provenance: the primitive or generator parameters a node was made from (FR-1.2). */
export type NodeMeta = { readonly source?: unknown };

/** A clip region in the node's own coordinates (before its transform), as filled geometry. */
export type ClipShape = { readonly subpaths: readonly Subpath[]; readonly fillRule: FillRule };

type NodeBase = {
  readonly id: string;
  readonly parent: string | null;
  readonly transform: Mat6;
  readonly style: Style;
  readonly clip?: ClipShape;
  readonly mask?: MaskFade;
  readonly meta?: NodeMeta;
};

export type GroupNode = NodeBase & { readonly type: 'group'; readonly children: readonly string[] };
export type PathNode = NodeBase & { readonly type: 'path'; readonly fillRule: FillRule; readonly subpaths: readonly Subpath[] };
/**
 * Native SVG text. `ink` is the measured glyph box in the node's own coordinates (before its
 * transform); it is stored because measuring needs the font files, which the document does not hold.
 */
export type TextNode = NodeBase & {
  readonly type: 'text';
  readonly content: string;
  readonly font: FontSpec;
  readonly anchor: TextAnchor;
  readonly direction: 'ltr' | 'rtl';
  readonly lineHeight: number;
  readonly at: TextPlacement;
  readonly ink: Box | null;
};
export type SceneNode = GroupNode | PathNode | TextNode;

export type Canvas = { readonly width: number; readonly height: number; readonly background?: Paint };

/** Spec A3: a flat node map keyed by id, plus the top-level z-order (back → front). */
export type Doc = {
  readonly schema: 1;
  readonly seed: number;
  readonly canvas: Canvas;
  readonly tokens: Readonly<Record<string, string>>;
  /** Gradients and filters, referenced by name from styles. */
  readonly defs: Readonly<Record<string, Def>>;
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
  filter: IdSchema.optional(),
  blend: z.enum(BLEND_MODES).optional(),
});

const unit = z.number().min(0).max(1);
const StopsSchema = z.array(z.strictObject({ offset: unit, color: PaintSchema })).min(2).max(9);
export const DefSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('linear'), angle: num, stops: StopsSchema }),
  z.strictObject({ kind: z.literal('radial'), center: Vec2Schema, radius: z.number().positive().max(100), focal: Vec2Schema.optional(), stops: StopsSchema }),
  z.strictObject({
    kind: z.literal('filter'),
    blur: z.number().min(0).max(1000).optional(),
    shadow: z.strictObject({ dx: num, dy: num, blur: z.number().min(0).max(1000), color: PaintSchema }).optional(),
  }),
]);
export const MaskSchema = z.strictObject({ type: z.enum(['linear', 'radial']), angle: num, from: unit, to: unit });
export const FONT_FAMILY_PATTERN = /^[A-Za-z0-9 _-]{1,64}$/;
export const FontSchema = z.strictObject({
  family: z.string().regex(FONT_FAMILY_PATTERN),
  size: z.number().positive().max(10_000),
  weight: z.number().int().min(100).max(900),
  letterSpacing: z.number().min(-1000).max(1000),
});
const BoxSchema = z.strictObject({ x: num, y: num, width: z.number().min(0), height: z.number().min(0) });

const nodeBase = {
  id: IdSchema,
  parent: IdSchema.nullable(),
  transform: Mat6Schema,
  style: StyleSchema,
  clip: z.strictObject({ subpaths: z.array(SubpathSchema), fillRule: z.enum(['nonzero', 'evenodd']) }).optional(),
  mask: MaskSchema.optional(),
  meta: z.strictObject({ source: z.unknown().optional() }).optional(),
};
const GroupSchema = z.strictObject({ ...nodeBase, type: z.literal('group'), children: z.array(IdSchema) });
const PathSchema = z.strictObject({
  ...nodeBase,
  type: z.literal('path'),
  fillRule: z.enum(['nonzero', 'evenodd']),
  subpaths: z.array(SubpathSchema),
});
// XML 1.0 forbids control characters and lone surrogates; the renderer refuses to parse them.
// eslint-disable-next-line no-control-regex -- matching them is the point
const UNPRINTABLE = /[\u{0}-\u{8}\u{B}\u{C}\u{E}-\u{1F}\u{FFFE}\u{FFFF}]|\p{Cs}/u;

/** Why this text cannot be drawn, or null when it can. The text ops and the document schema share it. */
export function textContentProblem(s: string): string | null {
  if (!/\S/.test(s)) return 'content needs at least one visible character';
  if (UNPRINTABLE.test(s)) return 'content has control characters or unpaired surrogates; remove them (a line break is "\\n")';
  return null;
}

/** Text content: 1..2000 characters that `textContentProblem` accepts. */
export const TextContentSchema = z
  .string()
  .min(1)
  .max(2000)
  .refine((s) => textContentProblem(s) === null, { error: (issue) => textContentProblem(String(issue.input)) ?? undefined });

const TextSchema = z.strictObject({
  ...nodeBase,
  type: z.literal('text'),
  content: TextContentSchema,
  font: FontSchema,
  anchor: z.enum(['start', 'middle', 'end']),
  direction: z.enum(['ltr', 'rtl']),
  lineHeight: z.number().min(0.5).max(4),
  at: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('point'), x: num, y: num }),
    z.strictObject({ kind: z.literal('path'), subpaths: z.array(SubpathSchema).min(1), offset: unit }),
  ]),
  ink: BoxSchema.nullable(),
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
  // Documents saved before M5 have no defs.
  defs: z.record(IdSchema, DefSchema).default({}),
  nodes: z.record(IdSchema, z.discriminatedUnion('type', [GroupSchema, PathSchema, TextSchema])),
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
    defs: {},
    nodes: {},
    root: [],
  };
}

/** A value from an untrusted document, cut to 40 characters, for a message that echoes it. */
const shown = (value: unknown): string => {
  const s = String(value);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
};

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
    if (toSvgColor(value) === undefined) return `token "${shown(name)}" holds "${shown(value)}", which is not a color`;
  }
  const bad = (paint: string | undefined) => paint !== undefined && resolvePaint(doc, paint) === undefined;
  if (bad(doc.canvas.background)) return `background "${shown(doc.canvas.background)}" is not a color or a token`;
  for (const [name, def] of Object.entries(doc.defs)) {
    if (Object.hasOwn(doc.tokens, name)) return `def "${shown(name)}" has the same name as a token`;
    const colors = def.kind === 'filter' ? (def.shadow ? [def.shadow.color] : []) : def.stops.map((s) => s.color);
    const off = colors.find((c) => resolveColor(doc, c) === undefined);
    if (off !== undefined) return `def "${shown(name)}" uses "${shown(off)}", which is not a color or a token`;
  }
  for (const node of Object.values(doc.nodes)) {
    for (const key of ['fill', 'stroke'] as const) {
      if (bad(node.style[key])) return `${key} "${shown(node.style[key])}" of "${shown(node.id)}" is not a color, a token or a gradient`;
    }
    const filter = node.style.filter;
    if (filter !== undefined && doc.defs[filter]?.kind !== 'filter') return `filter "${shown(filter)}" of "${shown(node.id)}" is not a filter def`;
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
    if (key !== node.id) return `node key "${shown(key)}" holds id "${shown(node.id)}"`;
  }
  const seen = new Set<string>();
  const visit = (ids: readonly string[], parent: string | null): string | null => {
    for (const id of ids) {
      const node = Object.hasOwn(doc.nodes, id) ? doc.nodes[id] : undefined;
      const where = parent === null ? 'root' : `group "${shown(parent)}"`;
      if (!node) return `"${shown(id)}" is listed in ${where} but does not exist`;
      if (seen.has(id)) return `"${shown(id)}" is listed more than once`;
      seen.add(id);
      if (node.parent !== parent) return `"${shown(id)}" names parent ${shown(JSON.stringify(node.parent))} but is listed in ${where}`;
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
  return orphan === undefined ? null : `"${shown(orphan)}" is not reachable from root`;
}
