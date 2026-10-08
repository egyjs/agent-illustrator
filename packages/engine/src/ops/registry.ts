import { produce, type Draft } from 'immer';
import { z } from 'zod';
import { closest, EngineError, type ErrorInfo } from '../errors.ts';
import type { Box } from '../geometry/types.ts';
import { resolvePaint } from '../scene/color.ts';
import { isValidId, type Doc, type SceneNode, type Style } from '../scene/model.ts';
import { getNode, requireNode, worldBounds } from '../scene/query.ts';
import type { RasterFonts } from '../render/raster.ts';

/** A coordinate or length: canvas units, or a percent string such as "50%" (FR-2.1). */
export const Length = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?%$/, 'expected a number or a percent string such as "50%"')]);
export type Length = z.output<typeof Length>;
/** What a percent refers to: the canvas width, its height, or the smaller of the two. */
export type Axis = 'x' | 'y' | 'min';
/** Largest coordinate or length (canvas units) an op accepts; beyond it, geometry overflows to Infinity. */
export const MAX_COORD = 1e7;

export type Warning = { readonly code: string; readonly message: string };
/** `data` carries results that are not nodes (token values, def names, text metrics) back to the caller. */
export type OpResult = { readonly id?: string; readonly ids?: readonly string[]; readonly data?: Readonly<Record<string, unknown>> };

export type Limits = {
  readonly maxOpsPerBatch: number;
  readonly maxNodes: number;
  readonly maxSegmentsPerPath: number;
  /** Most copies or samples one generator op may make (scatter, repeat_along_path, array). */
  readonly maxGenerated: number;
};
export const DEFAULT_LIMITS: Limits = { maxOpsPerBatch: 200, maxNodes: 5000, maxSegmentsPerPath: 20_000, maxGenerated: 2000 };

/** What a handler sees. `doc` is frozen and always current; changes go through `update`. */
export interface OpContext {
  readonly doc: Doc;
  readonly limits: Limits;
  /** Font files for measuring text; without them, system fonts are used. */
  readonly fonts: RasterFonts | undefined;
  /** Applies an immer recipe; `doc` reflects it right away. */
  update(recipe: (draft: Draft<Doc>) => void): void;
  /** Resolves an id or "$last" to a node; throws unknown_id or invalid_reference. */
  node(ref: string): SceneNode;
  /**
   * Claims an id for a new node: the requested one (suffixed -2, -3… with a warning when taken) or
   * "<prefix>-<n>". The claimed id becomes "$last". `releasing` lists ids this op deletes before it
   * inserts, which therefore count as free. `quiet` suppresses the renamed warning.
   */
  newId(requested: string | undefined, prefix: string, options?: { readonly releasing?: ReadonlySet<string>; readonly quiet?: boolean }): string;
  /** The node "$last" refers to. Ops that rename or replace nodes keep it pointing at the right one. */
  last: string | undefined;
  /** Canvas units from a number or a percent of the canvas width (x), height (y) or smaller side (min). */
  len(v: Length, axis: Axis): number;
  /** Checks every paint in the style (a color, a token or a gradient def) and the filter def, and drops undefined keys. */
  style(s: Style | undefined): Style;
  warn(code: string, message: string): void;
}

/** One call as it arrives: `op` names the op; the other fields are its input. */
export type OpCall = { readonly op: string; readonly [field: string]: unknown };

export interface OpDef<S extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly domain: string;
  readonly description: string;
  readonly schema: S;
  /** Sample batches that run on an empty 800×600 document; the last call of each uses this op. */
  readonly examples: readonly (readonly OpCall[])[];
  handler(input: z.output<S>, ctx: OpContext): OpResult;
}

export function defineOp<S extends z.ZodType>(def: OpDef<S>): OpDef<S> {
  return def;
}

/** The single source of truth for ops (PROJECT_INIT §2.1.3). */
export class Registry {
  readonly #ops = new Map<string, OpDef>();

  register(...defs: readonly OpDef[]): this {
    for (const def of defs) {
      if (this.#ops.has(def.name)) throw new Error(`op "${def.name}" is registered twice`);
      this.#ops.set(def.name, def);
    }
    return this;
  }

  get(name: string): OpDef | undefined {
    return this.#ops.get(name);
  }

  names(): string[] {
    return [...this.#ops.keys()];
  }

  list(): OpDef[] {
    return [...this.#ops.values()];
  }
}

type Done = {
  readonly op: string;
  readonly id?: string;
  readonly ids?: readonly string[];
  readonly bounds?: Box | null;
  /** Exact world bounds of each returned id that still exists. */
  readonly boundsById?: Readonly<Record<string, Box | null>>;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly warnings: readonly Warning[];
};

export type OpOutcome =
  | (Done & { readonly status: 'ok' | 'rolled_back' })
  | { readonly op: string; readonly status: 'error'; readonly error: ErrorInfo }
  | { readonly op: string; readonly status: 'skipped' };

export type BatchResult = {
  readonly ok: boolean;
  /** True when `doc` is the new version. False after a failure (the original comes back) and on dry runs. */
  readonly committed: boolean;
  readonly doc: Doc;
  readonly results: readonly OpOutcome[];
  /** What "$last" refers to after this batch; pass it to the next one. */
  readonly lastCreated?: string;
};

export type BatchOptions = { readonly dryRun?: boolean; readonly lastCreated?: string; readonly limits?: Partial<Limits>; readonly fonts?: RasterFonts };

function paintError(doc: Doc, value: string): EngineError {
  const tokens = Object.keys(doc.tokens);
  const gradients = Object.keys(doc.defs).filter((k) => doc.defs[k]!.kind !== 'filter');
  if (Object.hasOwn(doc.tokens, value)) {
    return new EngineError('invalid_color', `token "${value}" holds "${doc.tokens[value]}", which is not a color`, 'Give the token a CSS color value, or use a color directly.');
  }
  return new EngineError(
    'invalid_color',
    `"${value}" is not a color, a token or a gradient`,
    `Use a CSS color such as "#2a9d8f", "teal" or "rgb(42 157 143)", or "none"${tokens.length > 0 ? `, or a token: ${tokens.slice(0, 10).join(', ')}` : ''}${gradients.length > 0 ? `, or a gradient: ${gradients.slice(0, 10).join(', ')}` : ''}.`,
  );
}

class Context implements OpContext {
  doc: Doc;
  last: string | undefined;
  readonly limits: Limits;
  readonly fonts: RasterFonts | undefined;
  readonly warnings: Warning[] = [];
  readonly #claimed = new Set<string>();

  constructor(doc: Doc, last: string | undefined, limits: Limits, fonts: RasterFonts | undefined) {
    this.doc = doc;
    this.last = last;
    this.limits = limits;
    this.fonts = fonts;
  }

  update(recipe: (draft: Draft<Doc>) => void): void {
    this.doc = produce(this.doc, recipe);
  }

  node(ref: string): SceneNode {
    if (ref !== '$last') return requireNode(this.doc, ref);
    if (this.last === undefined) {
      throw new EngineError(
        'invalid_reference',
        '"$last" has no node to refer to: none was created yet, or the document was undone, restored or loaded since',
        'Name the node by its id instead; "$last" starts over after undo, restore and load.',
      );
    }
    return requireNode(this.doc, this.last);
  }

  newId(requested: string | undefined, prefix: string, options: { readonly releasing?: ReadonlySet<string>; readonly quiet?: boolean } = {}): string {
    const taken = (id: string) => (getNode(this.doc, id) !== undefined && !options.releasing?.has(id)) || this.#claimed.has(id);
    let id: string;
    if (requested === undefined) {
      let n = 1;
      while (taken(`${prefix}-${n}`)) n++;
      id = `${prefix}-${n}`;
    } else {
      if (!isValidId(requested)) {
        throw new EngineError(
          'invalid_input',
          `"${requested}" is not a usable id`,
          'Ids start with a letter or "_" and use letters, digits, "_", "." or "-" (at most 64). "canvas" is reserved.',
        );
      }
      const stem = requested.slice(0, 58);
      id = requested;
      for (let n = 2; taken(id); n++) id = `${stem}-${n}`;
      if (id !== requested && !options.quiet) this.warn('id_renamed', `id "${requested}" is taken; the new node is "${id}"`);
    }
    this.#claimed.add(id);
    this.last = id;
    return id;
  }

  len(v: Length, axis: Axis): number {
    const { width, height } = this.doc.canvas;
    const ref = axis === 'x' ? width : axis === 'y' ? height : Math.min(width, height);
    const out = typeof v === 'number' ? v : (Number.parseFloat(v) / 100) * ref;
    if (!Number.isFinite(out) || Math.abs(out) > MAX_COORD) {
      throw new EngineError('invalid_input', `${String(v).slice(0, 24)} is too large a length (limit ${MAX_COORD} canvas units)`, 'Use values at canvas scale: a few thousand units at most, or a percent such as "50%".');
    }
    return out;
  }

  style(s: Style | undefined): Style {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(s ?? {})) {
      if (value === undefined) continue;
      if ((key === 'fill' || key === 'stroke') && resolvePaint(this.doc, value as string) === undefined) {
        throw paintError(this.doc, value as string);
      }
      if (key === 'filter' && this.doc.defs[value as string]?.kind !== 'filter') {
        const filters = Object.keys(this.doc.defs).filter((k) => this.doc.defs[k]!.kind === 'filter');
        throw new EngineError(
          'invalid_reference',
          `no filter named "${String(value)}"`,
          filters.length > 0 ? `Known filters: ${filters.slice(0, 10).join(', ')}.` : 'Create one first with the "filter" op, which can also apply it.',
        );
      }
      out[key] = value;
    }
    return out as Style;
  }

  warn(code: string, message: string): void {
    this.warnings.push({ code, message });
  }
}

type Parsed = { readonly def: OpDef; readonly input: unknown };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** SVG and CSS spellings models reach for (seen in eval transcripts), mapped to the style field they mean. */
const STYLE_ALIASES: Readonly<Record<string, string>> = {
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeCap',
  strokeLinecap: 'strokeCap',
  'stroke-linejoin': 'strokeJoin',
  strokeLinejoin: 'strokeJoin',
  'stroke-dasharray': 'strokeDash',
  strokeDasharray: 'strokeDash',
  'stroke-miterlimit': 'miterLimit',
  strokeMiterlimit: 'miterLimit',
  'fill-opacity': 'fillOpacity',
  'stroke-opacity': 'strokeOpacity',
  'mix-blend-mode': 'blend',
  mixBlendMode: 'blend',
};

/**
 * Forgives the slips models make most, before strict validation: SVG/CSS style names become the
 * style fields they mean (a canonical key given too wins), a dash string such as "4 2" becomes a
 * number list, and a CSS font list such as `"Tajawal", sans-serif` becomes its first family.
 */
function normalizeFields(fields: Record<string, unknown>): void {
  if (isRecord(fields.style)) {
    const style: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields.style)) {
      const name = Object.hasOwn(STYLE_ALIASES, key) ? STYLE_ALIASES[key]! : key;
      if (name === key || !Object.hasOwn(style, name)) style[name] = value;
    }
    if (typeof style.strokeDash === 'string' && /^[\d.\s,]+$/.test(style.strokeDash)) {
      style.strokeDash = style.strokeDash.trim().split(/[\s,]+/).map(Number);
    }
    fields.style = style;
  }
  if (typeof fields.font === 'string' && /[,'"]/.test(fields.font)) fields.font = fields.font.split(',')[0]!.replace(/['"]/g, '').trim();
}

function parseCall(registry: Registry, call: unknown): Parsed | ErrorInfo {
  if (!isRecord(call)) {
    return { code: 'invalid_input', message: 'each op must be an object', hint: 'Write ops like {"op": "rect", "x": 10, "y": 10, "width": 100, "height": 50}.' };
  }
  const fields: Record<string, unknown> = { ...call };
  const name = fields.op;
  delete fields.op;
  if (typeof name !== 'string') {
    return { code: 'invalid_input', message: 'an op is missing its "op" name', hint: `Add "op" with one of: ${registry.names().join(', ')}.` };
  }
  const def = registry.get(name);
  if (!def) {
    const near = closest(name, registry.names());
    const guess = near.length > 0 ? `Did you mean ${near.map((n) => `"${n}"`).join(' or ')}? ` : '';
    return { code: 'unknown_op', message: `unknown op "${name}"`, hint: `${guess}Known ops: ${registry.names().join(', ')}.` };
  }
  normalizeFields(fields);
  const parsed = def.schema.safeParse(fields);
  if (!parsed.success) {
    const example = def.examples[0]?.at(-1);
    return {
      code: 'invalid_input',
      message: `${name}: ${z.prettifyError(parsed.error)}`,
      hint: example ? `Example: ${JSON.stringify(example)}` : `Check the fields of "${name}".`,
    };
  }
  return { def, input: parsed.data };
}

/**
 * Runs a batch of op calls as one transaction (FR-2.3):
 * 1. Every call is validated against its op's schema before anything runs.
 * 2. Ops apply in order, each in its own immer `produce`.
 * 3. Any failure returns the original document. Ops that ran become "rolled_back"; later ones are
 *    "skipped".
 *
 * Batch-level problems (too many ops) throw an EngineError instead.
 */
export function executeBatch(registry: Registry, doc: Doc, calls: readonly unknown[], options: BatchOptions = {}): BatchResult {
  const limits: Limits = { ...DEFAULT_LIMITS, ...options.limits };
  if (calls.length > limits.maxOpsPerBatch) {
    throw new EngineError('limit_exceeded', `${calls.length} ops in one batch; the limit is ${limits.maxOpsPerBatch}`, 'Split the work into several smaller batches.');
  }
  const names = calls.map((c) => (isRecord(c) && typeof c.op === 'string' ? c.op : '?'));
  const parsed = calls.map((c) => parseCall(registry, c));
  const failed = (p: Parsed | ErrorInfo): p is ErrorInfo => 'code' in p;
  const unchanged = (results: OpOutcome[]): BatchResult => ({ ok: false, committed: false, doc, results, lastCreated: options.lastCreated });

  if (parsed.some(failed)) {
    return unchanged(parsed.map((p, i): OpOutcome => (failed(p) ? { op: names[i]!, status: 'error', error: p } : { op: names[i]!, status: 'skipped' })));
  }

  let current = doc;
  let last = options.lastCreated;
  const done: Done[] = [];
  for (const [i, p] of (parsed as Parsed[]).entries()) {
    const ctx = new Context(current, last, limits, options.fonts);
    try {
      const result = p.def.handler(p.input, ctx);
      const count = Object.keys(ctx.doc.nodes).length;
      if (count > limits.maxNodes) {
        throw new EngineError(
          'limit_exceeded',
          `the document would hold ${count} nodes; the limit is ${limits.maxNodes}`,
          'Delete or merge nodes (for example with a boolean union) before adding more.',
        );
      }
      current = ctx.doc;
      last = ctx.last;
      done.push({
        op: names[i]!,
        ...(result.id === undefined ? {} : { id: result.id, bounds: worldBounds(current, result.id) }),
        ...(result.ids === undefined ? {} : { ids: result.ids }),
        ...(result.ids === undefined
          ? {}
          : { boundsById: Object.fromEntries(result.ids.filter((x) => Object.hasOwn(current.nodes, x)).map((x) => [x, worldBounds(current, x)])) }),
        ...(result.data === undefined ? {} : { data: result.data }),
        warnings: ctx.warnings,
      });
    } catch (e) {
      const error: ErrorInfo =
        e instanceof EngineError
          ? e.info
          : { code: 'internal_error', message: e instanceof Error ? e.message : String(e), hint: 'This is an engine bug, not a mistake in the call. Try a simpler op.' };
      return unchanged([
        ...done.map((o): OpOutcome => ({ ...o, status: 'rolled_back' })),
        { op: names[i]!, status: 'error', error },
        ...names.slice(i + 1).map((op): OpOutcome => ({ op, status: 'skipped' })),
      ]);
    }
  }
  return {
    ok: true,
    committed: !options.dryRun,
    doc: options.dryRun ? doc : current,
    results: done.map((o): OpOutcome => ({ ...o, status: 'ok' })),
    lastCreated: options.dryRun ? options.lastCreated : last,
  };
}
