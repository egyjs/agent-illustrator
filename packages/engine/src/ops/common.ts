import { castDraft, type Draft } from 'immer';
import { z } from 'zod';
import { EngineError } from '../errors.ts';
import { unionBoxes } from '../geometry/bezier.ts';
import { booleanOp, type Shape } from '../geometry/boolean.ts';
import { applyToSubpaths, compose, IDENTITY, invert, multiply } from '../geometry/transform.ts';
import type { Box, FillRule, Mat6, Subpath, Vec2 } from '../geometry/types.ts';
import { isValidId, StyleSchema, type Doc, type GroupNode, type SceneNode, type Style } from '../scene/model.ts';
import { requireNode, subtreeIds, worldBounds, worldSubpaths, worldTransform } from '../scene/query.ts';
import { insertNode } from '../scene/store.ts';
import { Length, type OpContext } from './registry.ts';

/** A new node's id; rejected in the validate-first pass when it can never be used. */
export const IdInput = z.string().refine(isValidId, 'not a usable id: start with a letter or "_", use letters, digits, "_", "." or "-", and avoid "canvas" and names like "constructor"');

/** Fields every drawing op accepts. Coordinates are canvas units, also inside transformed groups. */
export const common = { id: IdInput.optional(), parent: z.string().optional(), style: StyleSchema.optional() };
export type Common = { readonly id?: string; readonly parent?: string; readonly style?: Style };

/** A point as [x, y]; each part is canvas units or a percent of the canvas width / height. */
export const PointInput = z.tuple([Length, Length]);
export type PointInput = z.output<typeof PointInput>;

export const ANCHORS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'] as const;
export type Anchor = (typeof ANCHORS)[number];
export const AnchorInput = z.enum(ANCHORS);

/** anchor(box, u, v) = (x + u·w, y + v·h), u, v ∈ {0, ½, 1} (Appendix A). */
export function anchorPoint(b: Box, a: Anchor): Vec2 {
  const u = a.endsWith('left') ? 0 : a.endsWith('right') ? 1 : 0.5;
  const v = a.startsWith('top') ? 0 : a.startsWith('bottom') ? 1 : 0.5;
  return [b.x + u * b.width, b.y + v * b.height];
}

export function point(ctx: OpContext, p: PointInput): Vec2 {
  return [ctx.len(p[0], 'x'), ctx.len(p[1], 'y')];
}

export function positive(op: string, name: string, v: number): number {
  if (!(v > 0)) {
    throw new EngineError('invalid_input', `${op} ${name} must be > 0, got ${v}`, `Give ${name} a positive size in canvas units or a percent such as "10%".`);
  }
  return v;
}

/** Runs geometry code; its RangeErrors become invalid_input errors with this hint. */
export function geometryInput<T>(fn: () => T, hint: string): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RangeError) throw new EngineError('invalid_input', e.message, hint);
    throw e;
  }
}

type NewPath = {
  readonly prefix: string;
  /** The geometry, or a function of the claimed id (seeded generators derive their randomness from it). */
  readonly subpaths: readonly Subpath[] | ((id: string) => readonly Subpath[]);
  readonly source: Record<string, unknown>;
  readonly defaults?: Style;
  readonly fillRule?: FillRule;
};

const isIdentity = (m: Mat6) => m.every((v, i) => v === IDENTITY[i]);

export const segmentCount = (subpaths: readonly Subpath[]): number => subpaths.reduce((n, sp) => n + sp.segs.length, 0);

/**
 * The transform that makes a new child of `parentId` land at the canvas coordinates of its geometry:
 * the inverse of the parent's world matrix (identity at the top level).
 */
export function canvasSpaceIn(ctx: OpContext, parentId: string | null): Mat6 {
  const world = parentId === null ? IDENTITY : worldTransform(ctx.doc, parentId);
  if (isIdentity(world)) return IDENTITY;
  const inv = invert(world);
  if (!inv) throw new EngineError('invalid_structure', `group "${parentId}" is squashed flat (scale 0)`, 'Give that group a non-zero scale before adding to it.');
  return inv;
}

export type NewBase = Pick<SceneNode, 'id' | 'parent' | 'transform' | 'style'>;

/**
 * Inserts a new node on top of its parent (or the canvas) and returns its id. The base transform maps
 * canvas coordinates into the parent, so `build` works in canvas units. `build` runs after the id is
 * claimed.
 */
export function insertNew(ctx: OpContext, input: Common, prefix: string, build: (base: NewBase) => SceneNode, defaults?: Style): string {
  const parent = input.parent === undefined ? null : ctx.node(input.parent);
  if (parent && parent.type !== 'group') {
    throw new EngineError('invalid_structure', `parent "${parent.id}" is a ${parent.type}, not a group`, 'Pass a group id as parent, or leave parent out.');
  }
  const transform = canvasSpaceIn(ctx, parent?.id ?? null);
  const style = ctx.style({ ...defaults, ...input.style });
  const id = ctx.newId(input.id, prefix);
  const node = build({ id, parent: parent?.id ?? null, transform, style });
  ctx.update((d) => insertNode(d, node));
  return id;
}

/** Inserts a new path node on top of its parent (or the canvas) and returns its id. Coordinates are canvas units. */
export function addPath(ctx: OpContext, input: Common, p: NewPath): string {
  return insertNew(
    ctx,
    input,
    p.prefix,
    ({ id, parent, transform, style }) => {
      const subpaths = typeof p.subpaths === 'function' ? p.subpaths(id) : p.subpaths;
      const segs = segmentCount(subpaths);
      if (segs > ctx.limits.maxSegmentsPerPath) {
        throw new EngineError('limit_exceeded', `${segs} segments in one path; the limit is ${ctx.limits.maxSegmentsPerPath}`, 'Use fewer points, or split the shape.');
      }
      return { id, type: 'path', parent, transform, style, fillRule: p.fillRule ?? 'nonzero', subpaths, meta: { source: p.source } };
    },
    p.defaults,
  );
}

/**
 * Copies `src` with everything inside it once per entry of `worlds`, appending the copies to group
 * `parent` (or the top level for null) in one update. Copy k's root gets world matrix worlds[k]. Ids
 * derive quietly from the source ids ("leaf" → "leaf-2"). Returns the copies' root ids, in order.
 * Callers check `limits.maxGenerated` and the node budget first.
 */
export function cloneSubtree(ctx: OpContext, src: string, worlds: readonly Mat6[], parent: string | null): string[] {
  const subtree = subtreeIds(ctx.doc, src);
  const Pinv = invert(parent === null ? IDENTITY : worldTransform(ctx.doc, parent));
  if (!Pinv) throw new EngineError('invalid_structure', `group "${parent}" is squashed flat (scale 0)`, 'Give that group a non-zero scale first.');
  const nodes: SceneNode[] = [];
  const roots: string[] = [];
  for (const world of worlds) {
    const map = new Map(subtree.map((id) => [id, ctx.newId(id, id, { quiet: true })] as const));
    for (const id of subtree) {
      const n = requireNode(ctx.doc, id);
      const base = id === src ? { id: map.get(id)!, parent, transform: multiply(Pinv, world) } : { id: map.get(id)!, parent: map.get(n.parent!)! };
      nodes.push(n.type === 'group' ? { ...n, ...base, children: n.children.map((c) => map.get(c)!) } : { ...n, ...base });
    }
    roots.push(map.get(src)!);
  }
  ctx.update((d) => {
    for (const n of nodes) d.nodes[n.id] = castDraft(n);
    (parent === null ? d.root : (d.nodes[parent] as Draft<GroupNode>).children).push(...roots);
  });
  return roots;
}

/** Resolves refs (ids or "$last") to unique ids, in order. */
export function resolveIds(ctx: OpContext, refs: readonly string[]): string[] {
  return [...new Set(refs.map((r) => ctx.node(r).id))];
}

/** The ids whose ancestors are not selected too; an ancestor already carries its descendants. */
export function topmost(ctx: OpContext, ids: readonly string[]): string[] {
  const chosen = new Set(ids);
  return ids.filter((id) => {
    for (let p = requireNode(ctx.doc, id).parent; p !== null; p = requireNode(ctx.doc, p).parent) if (chosen.has(p)) return false;
    return true;
  });
}

/** World bounds, or an error when the node draws nothing. */
export function boundsOf(ctx: OpContext, id: string): Box {
  const b = worldBounds(ctx.doc, id);
  if (!b) throw new EngineError('invalid_structure', `"${id}" has no geometry to measure`, 'Give it some geometry first, or leave it out of this op.');
  return b;
}

export function selectionBounds(ctx: OpContext, ids: readonly string[]): Box {
  return unionBoxes(ids.map((id) => boundsOf(ctx, id)))!;
}

/** Moves a node by a canvas-space matrix D (world' = D·world); its new local transform is P⁻¹·D·P·local. */
export function applyWorld(ctx: OpContext, id: string, D: Mat6): void {
  const node = requireNode(ctx.doc, id);
  const P = node.parent === null ? IDENTITY : worldTransform(ctx.doc, node.parent);
  const Pinv = invert(P);
  if (!Pinv) {
    throw new EngineError('invalid_structure', `the group holding "${id}" is squashed flat (scale 0)`, 'Give the parent group a non-zero scale first.');
  }
  const local = compose(Pinv, D, P, node.transform);
  ctx.update((d) => {
    d.nodes[node.id]!.transform = castDraft(local);
  });
}

/** Segments in everything that shapes a node: its paths and every clip on the way. */
function inputSegments(doc: Doc, id: string): number {
  const node = requireNode(doc, id);
  const own = node.clip ? segmentCount(node.clip.subpaths) : 0;
  if (node.type === 'text') return own;
  return own + (node.type === 'path' ? segmentCount(node.subpaths) : node.children.reduce((n, child) => n + inputSegments(doc, child), 0));
}

/** Unions in rounds of pairs, so no step drags one ever-growing accumulator along. */
function unionAll(shapes: readonly Shape[]): Shape {
  let round = shapes;
  while (round.length > 1) {
    const next: Shape[] = [];
    for (let i = 0; i < round.length; i += 2) next.push(i + 1 < round.length ? booleanOp('union', round[i]!, round[i + 1]!) : round[i]!);
    round = next;
  }
  return round[0] ?? { subpaths: [], fillRule: 'nonzero' };
}

function buildShape(doc: Doc, id: string): Shape {
  const node = requireNode(doc, id);
  if (node.type === 'text') {
    throw new EngineError('invalid_structure', `"${id}" is text, which has no outline to combine or clip with`, 'Leave text out of booleans and clip shapes; text-to-outlines is not supported yet.');
  }
  const shape: Shape = node.type === 'path' ? { subpaths: worldSubpaths(doc, node), fillRule: node.fillRule } : unionAll(node.children.map((child) => buildShape(doc, child)));
  if (!node.clip) return shape;
  return booleanOp('intersect', shape, { subpaths: applyToSubpaths(worldTransform(doc, id), node.clip.subpaths), fillRule: node.clip.fillRule });
}

/**
 * The filled areas of these nodes in canvas space, one per id. A group is the union of the paths
 * inside it, and a clip trims whatever it clips. The geometry of all ids together must fit one
 * path's segment limit, since that is what the booleans on it have to chew through.
 */
export function shapesOf(ctx: OpContext, ids: readonly string[]): Shape[] {
  const segs = ids.reduce((n, id) => n + inputSegments(ctx.doc, id), 0);
  if (segs > ctx.limits.maxSegmentsPerPath) {
    throw new EngineError('limit_exceeded', `${segs} segments go into one boolean; the limit is ${ctx.limits.maxSegmentsPerPath}`, 'Combine fewer or simpler shapes per boolean, or split it into several booleans.');
  }
  return ids.map((id) => buildShape(ctx.doc, id));
}

export function shapeOf(ctx: OpContext, id: string): Shape {
  return shapesOf(ctx, [id])[0]!;
}
