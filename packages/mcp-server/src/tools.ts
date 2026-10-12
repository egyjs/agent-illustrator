import { randomInt } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createDocument,
  EngineError,
  executeBatch,
  exportSvg,
  INCREMENTAL_CHECKS,
  lint,
  rasterize,
  type Box,
  type Doc,
  type ImageSource,
  type Limits,
  type LintIssue,
  type OpDef,
  type OpOutcome,
  type RasterFonts,
  type Registry,
} from '@agent-illustrator/engine';
import { z } from 'zod';
import type { ServerConfig } from './config.ts';
import type { Logger } from './logging.ts';
import type { SessionStore } from './sessions.ts';

export type ToolDeps = {
  readonly sessions: SessionStore;
  readonly registry: Registry;
  readonly config: ServerConfig;
  readonly fonts: RasterFonts;
  readonly images: ImageSource;
  readonly log: Logger;
};
export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: 'image/png' };
export type ToolResult = { content: Content[]; isError?: boolean };

export const text = (value: unknown): Content => ({ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) });
const pngImage = (png: Uint8Array): Content => ({ type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png' });

/** Runs a tool body; engine errors and surprises both come back as isError results the model can act on. */
export function guarded(deps: ToolDeps, tool: string, body: () => ToolResult): ToolResult {
  try {
    return body();
  } catch (e) {
    const error =
      e instanceof EngineError
        ? e.info
        : { code: 'internal_error', message: e instanceof Error ? e.message : String(e), hint: 'This is a server bug, not a mistake in the call. Try a simpler request.' };
    if (!(e instanceof EngineError)) deps.log.error({ tool, err: e }, 'tool failed unexpectedly');
    return { isError: true, content: [text({ error })] };
  }
}

/**
 * Validates tool input in the handler, not in the SDK, so every mistake gets the same
 * { code, message, hint } shape as engine errors and shows up in the logs (NFR-3, NFR-5).
 */
export function parse<S extends z.ZodType>(schema: S, input: unknown, tool: string, example: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new EngineError('invalid_input', `${tool}: ${z.prettifyError(r.error)}`, `Example: ${JSON.stringify(example)}`);
  return r.data;
}

export const round = (v: number): number => Math.round(v * 100) / 100;
export const roundBox = (b: Box) => ({ x: round(b.x), y: round(b.y), width: round(b.width), height: round(b.height) });

/** What the model sees for one op: no empty warnings, bounds rounded to 0.01. */
function compact(o: OpOutcome): Record<string, unknown> {
  if (o.status === 'error' || o.status === 'skipped') return { ...o };
  const { warnings, bounds, ...rest } = o;
  return { ...rest, ...(bounds ? { bounds: roundBox(bounds) } : {}), ...(warnings.length > 0 ? { warnings } : {}) };
}

/** The reply field that names documents closed to make room; nothing when none were. */
export const closedNote = (closed: readonly string[]): { closed?: readonly string[] } => (closed.length > 0 ? { closed } : {});

export const createDocumentInput = z.object({
  width: z.number().positive().max(16384).describe('Canvas width in px'),
  height: z.number().positive().max(16384).describe('Canvas height in px'),
  background: z.string().optional().describe('Canvas color, e.g. "#ffffff"; omit for transparent'),
  seed: z.number().int().optional().describe('Seed for generators; omit for a random one (returned)'),
});

export function createDocumentTool(deps: ToolDeps, raw: unknown): ToolResult {
  return guarded(deps, 'create_document', () => {
    const input = parse(createDocumentInput, raw, 'create_document', { width: 800, height: 600, background: '#ffffff' });
    const seed = input.seed ?? randomInt(0, 2 ** 31);
    const doc = createDocument({ width: input.width, height: input.height, seed, ...(input.background === undefined ? {} : { background: input.background }) });
    const { session, closed } = deps.sessions.create(doc);
    return { content: [text({ doc_id: session.id, width: doc.canvas.width, height: doc.canvas.height, seed, ...closedNote(closed) })] };
  });
}

/** JSON Schema for apply_ops (spec S1, finding F4): loose items, per-op validation happens in the engine. */
export function applyOpsInputSchema(registry: Registry, limits: Limits): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      doc_id: { type: 'string', description: 'Document id from create_document' },
      ops: {
        type: 'array',
        minItems: 1,
        maxItems: limits.maxOpsPerBatch,
        description: 'Ops to apply in order; each is {"op": name, ...fields}',
        items: { type: 'object', properties: { op: { type: 'string', enum: registry.names() } }, required: ['op'], additionalProperties: true },
      },
      dry_run: { type: 'boolean', description: 'Validate and report without changing the document' },
      preview: { type: 'boolean', description: 'Run the batch without changing the document and return a PNG of the result; implies dry_run' },
    },
    required: ['doc_id', 'ops'],
    additionalProperties: false,
  };
}

/** An op as "rect(x, y, width, height, id?, …)": required fields first, both in schema order. */
export function opSignature(def: OpDef): string {
  const schema = z.toJSONSchema(def.schema, { io: 'input' }) as { properties?: Record<string, unknown>; required?: string[] };
  const required = new Set(schema.required ?? []);
  const fields = Object.keys(schema.properties ?? {});
  const ordered = [...fields.filter((f) => required.has(f)), ...fields.filter((f) => !required.has(f)).map((f) => `${f}?`)];
  return `${def.name}(${ordered.join(', ')})`;
}

/** One signature per line, for the apply_ops description. */
export const opSignatures = (registry: Registry): string => registry.list().map(opSignature).join('\n');

/** The shape check only; op names, op fields and the batch size are the engine's to judge, with its hints. */
const applyOpsInput = z.strictObject({ doc_id: z.string(), ops: z.array(z.unknown()), dry_run: z.boolean().optional(), preview: z.boolean().optional() });

/** Issues beyond this many are left for an explicit lint call. */
const MAX_BATCH_LINT_ISSUES = 10;

/** Whether the node is a trace group or lies inside one. */
function inTrace(doc: Doc, id: string): boolean {
  for (let node = doc.nodes[id]; node !== undefined; node = node.parent === null ? undefined : doc.nodes[node.parent]) {
    const source = node.meta?.source;
    if (typeof source === 'object' && source !== null && (source as { kind?: unknown }).kind === 'trace') return true;
  }
  return false;
}

/**
 * Cheap lint of the nodes a committed (or previewed) batch created or changed, so mistakes show up in the same
 * reply. Undefined when there is nothing to report; a failure here is logged and never fails the batch.
 */
function lintTouched(deps: ToolDeps, doc: Doc, results: readonly OpOutcome[]): LintIssue[] | undefined {
  const named = results.flatMap((o) => (o.status === 'ok' ? [...(o.ids ?? []), ...(o.id === undefined ? [] : [o.id])] : []));
  // Trace layers are reference geometry: stacked ones overlap by design and specks are small on purpose, so lint has nothing useful to say about them.
  const ids = [...new Set(named)].filter((id) => Object.hasOwn(doc.nodes, id) && !inTrace(doc, id));
  if (ids.length === 0) return undefined;
  try {
    const { issues } = lint(doc, { ids, checks: INCREMENTAL_CHECKS, maxIssues: MAX_BATCH_LINT_ISSUES, fonts: deps.fonts });
    return issues.length > 0 ? issues : undefined;
  } catch (e) {
    deps.log.warn({ err: e }, 'lint after apply_ops failed');
    return undefined;
  }
}

export function applyOpsTool(deps: ToolDeps, raw: unknown): ToolResult {
  return guarded(deps, 'apply_ops', () => {
    const input = parse(applyOpsInput, raw, 'apply_ops', { doc_id: 'doc-1a2b3c', ops: [{ op: 'rect', x: 10, y: 10, width: 100, height: 50 }] });
    const session = deps.sessions.get(input.doc_id);
    const preview = input.preview ?? false;
    // A preview runs the batch for real (dryRun false) so result.doc is the would-be document; it is never committed.
    const result = executeBatch(deps.registry, session.store.doc, input.ops, {
      dryRun: !preview && (input.dry_run ?? false),
      lastCreated: session.lastCreated,
      limits: deps.config.limits,
      fonts: deps.fonts,
      images: deps.images,
    });
    const committed = result.committed && !preview;
    if (committed) {
      session.store.commit(result.doc);
      session.lastCreated = result.lastCreated;
    }
    const issues = result.committed && result.ok ? lintTouched(deps, result.doc, result.results) : undefined;
    const body = {
      ok: result.ok,
      committed,
      ...(preview && result.ok ? { preview: true } : {}),
      doc_id: session.id,
      results: result.results.map(compact),
      ...(issues ? { lint: issues } : {}),
    };
    if (!result.ok) return { isError: true, content: [text(body)] };
    if (!preview) return { content: [text(body)] };
    const raster = rasterize(result.doc, { fonts: deps.fonts, maxPixels: deps.config.maxRenderPixels });
    return { content: [text(body), pngImage(raster.png)] };
  });
}

const BoxInput = z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() });

export const renderInput = z.object({
  doc_id: z.string(),
  overlays: z.array(z.enum(['ids', 'bounds', 'grid'])).optional().describe('Debug layers drawn on top: node ids, exact bounds, a coordinate grid'),
  region: BoxInput.optional().describe('Canvas-space area to render, in px; default the whole canvas'),
  scale: z.number().positive().max(8).optional().describe('Output pixels per canvas px; default 1'),
  grid: z.number().positive().optional().describe('Grid spacing in canvas px'),
});

/** Each document keeps its last few render files, so a zoomed render does not overwrite the full view. */
const RENDER_FILES_PER_DOC = 4;

export function renderTool(deps: ToolDeps, raw: unknown): ToolResult {
  return guarded(deps, 'render', () => {
    const input = parse(renderInput, raw, 'render', { doc_id: 'doc-1a2b3c', overlays: ['ids'] });
    const session = deps.sessions.get(input.doc_id);
    const raster = rasterize(session.store.doc, {
      ...(input.scale === undefined ? {} : { scale: input.scale }),
      ...(input.region === undefined ? {} : { region: input.region }),
      ...(input.grid === undefined ? {} : { grid: input.grid }),
      overlays: input.overlays ?? [],
      fonts: deps.fonts,
      maxPixels: deps.config.maxRenderPixels,
    });
    let file: string | undefined;
    try {
      mkdirSync(deps.config.renderDir, { recursive: true });
      file = join(deps.config.renderDir, `${session.id}-${session.renders++ % RENDER_FILES_PER_DOC}.png`);
      writeFileSync(file, raster.png);
    } catch (e) {
      deps.log.warn({ err: e }, 'could not write the render fallback file');
      file = undefined;
    }
    const summary = { doc_id: session.id, width: raster.width, height: raster.height, overlays: input.overlays ?? [], ...(file ? { file } : {}) };
    return { content: [text(summary), pngImage(raster.png)] };
  });
}

export const exportSvgInput = z.object({
  doc_id: z.string(),
  precision: z.number().int().min(0).max(6).optional().describe('Decimals for coordinates; default 2'),
  optimize: z.boolean().optional().describe('Run SVGO; default true'),
  strip_ids: z.boolean().optional().describe('Remove id attributes; default false'),
});

export function exportSvgTool(deps: ToolDeps, raw: unknown): ToolResult {
  return guarded(deps, 'export_svg', () => {
    const input = parse(exportSvgInput, raw, 'export_svg', { doc_id: 'doc-1a2b3c' });
    const session = deps.sessions.get(input.doc_id);
    const svg = exportSvg(session.store.doc, {
      ...(input.precision === undefined ? {} : { precision: input.precision }),
      ...(input.optimize === undefined ? {} : { optimize: input.optimize }),
      ...(input.strip_ids === undefined ? {} : { stripIds: input.strip_ids }),
    });
    return { content: [text(svg)] };
  });
}
