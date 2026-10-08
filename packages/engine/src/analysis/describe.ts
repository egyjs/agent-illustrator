import { EngineError } from '../errors.ts';
import { IDENTITY } from '../geometry/transform.ts';
import type { Box, Mat6, Seg, Subpath } from '../geometry/types.ts';
import { toSvgColor } from '../scene/color.ts';
import type { Canvas, Doc, FontSpec, NodeMeta, SceneNode, TextPlacement } from '../scene/model.ts';
import { requireNode, subtreeIds, worldBounds } from '../scene/query.ts';

export type DescribeDetail = 'outline' | 'normal' | 'full';
export type DescribeOptions = { readonly detail?: DescribeDetail; readonly root?: string; readonly maxNodes?: number };

export const DEFAULT_MAX_NODES = 300;
const LEVEL = { outline: 0, normal: 1, full: 2 } as const;

/** Rounds to 0.01. Never returns -0, so equal numbers compare and print the same. */
export const round2 = (v: number): number => Math.round(v * 100) / 100 + 0;
export const roundBox = (b: Box): Box => ({ x: round2(b.x), y: round2(b.y), width: round2(b.width), height: round2(b.height) });
const round4 = (v: number): number => Math.round(v * 10_000) / 10_000 + 0;

/**
 * One node of the description. Which fields appear depends on the detail level (outline: id, type,
 * bounds, children; normal adds style and content summaries; full adds exact geometry); fields a
 * node does not have are left out.
 */
export type NodeInfo = {
  readonly id: string;
  readonly type: SceneNode['type'];
  /** World-space bounds, rounded to 0.01; null for empty groups and paths. */
  readonly bounds: Box | null;
  /** Groups: the children listed, back → front. Fewer than the group holds when maxNodes cut some off. */
  readonly children?: readonly NodeInfo[];
  /** Groups: how many children the group has, set only when `children` is missing some of them. */
  readonly childCount?: number;
  /** Fill and stroke as stored; a token or gradient name also shows what it resolves to. */
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly opacity?: number;
  readonly filter?: string;
  readonly blend?: string;
  readonly mask?: true;
  readonly clip?: true;
  /** The kind of primitive or generator the node was made from (`meta.source.kind`). */
  readonly source?: string;
  /** Paths: segment count over all subpaths. */
  readonly segments?: number;
  /** Text: the first 80 characters. */
  readonly text?: string;
  /** Text: "family size/weight". */
  readonly font?: string;
  readonly anchor?: string;
  /** Full detail. Everything below is in the node's own coordinates, before its transform. */
  readonly transform?: Mat6;
  readonly subpaths?: readonly Subpath[];
  readonly at?: TextPlacement;
  readonly fontSpec?: FontSpec;
  readonly meta?: NodeMeta;
};

export type SceneDescription = {
  readonly canvas: Canvas;
  readonly seed: number;
  /** Token names, sorted. */
  readonly tokens: readonly string[];
  /** Gradient and filter defs, sorted by name. */
  readonly defs: readonly { readonly name: string; readonly kind: string }[];
  /** Nodes in the described scope: the whole document, or the subtree under `root`. */
  readonly nodeCount: number;
  /** Nodes listed in `nodes`, nested ones included. */
  readonly shown: number;
  readonly truncated: boolean;
  readonly nodes: readonly NodeInfo[];
};

/**
 * A structured outline of the scene for an agent to read (FR-10): canvas, tokens, defs and the node
 * tree, depth-first and back → front. At most `maxNodes` nodes are listed, chosen level by level,
 * so the top of the tree is always complete before deeper levels begin; `truncated` says some were
 * left out and groups with missing children carry `childCount`. `root` describes one subtree.
 */
export function describeScene(doc: Doc, options: DescribeOptions = {}): SceneDescription {
  const { detail = 'normal', root, maxNodes = DEFAULT_MAX_NODES } = options;
  if (!Number.isInteger(maxNodes) || maxNodes < 1) {
    throw new EngineError('invalid_input', `maxNodes must be a whole number ≥ 1, got ${maxNodes}`, 'Use a count such as 300, or leave maxNodes out.');
  }
  const roots = root === undefined ? doc.root : [requireNode(doc, root).id];
  const listed = new Set<string>();
  const queue = [...roots];
  for (let i = 0; i < queue.length && listed.size < maxNodes; i++) {
    const node = requireNode(doc, queue[i]!);
    listed.add(node.id);
    if (node.type === 'group') for (const child of node.children) queue.push(child);
  }
  const nodeCount = roots.reduce((n, id) => n + subtreeIds(doc, id).length, 0);
  return {
    canvas: doc.canvas,
    seed: doc.seed,
    tokens: Object.keys(doc.tokens).sort(),
    defs: Object.keys(doc.defs).sort().map((name) => ({ name, kind: doc.defs[name]!.kind })),
    nodeCount,
    shown: listed.size,
    truncated: listed.size < nodeCount,
    nodes: roots.filter((id) => listed.has(id)).map((id) => describeNode(doc, id, LEVEL[detail], listed)),
  };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function describeNode(doc: Doc, id: string, level: number, listed: ReadonlySet<string>): NodeInfo {
  const node = requireNode(doc, id);
  const box = worldBounds(doc, id);
  const info: Mutable<NodeInfo> = { id, type: node.type, bounds: box && roundBox(box) };
  if (node.type === 'group') {
    const shown = node.children.filter((child) => listed.has(child));
    info.children = shown.map((child) => describeNode(doc, child, level, listed));
    if (shown.length < node.children.length) info.childCount = node.children.length;
  }
  return level < LEVEL.normal ? info : { ...info, ...normalInfo(doc, node), ...(level < LEVEL.full ? {} : fullInfo(node)) };
}

/** The object without its undefined properties. */
const defined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

function normalInfo(doc: Doc, node: SceneNode): Partial<NodeInfo> {
  const { style } = node;
  const paint = (p: string | undefined) => (p === undefined ? undefined : paintLabel(doc, p));
  return defined<Partial<NodeInfo>>({
    fill: paint(style.fill),
    stroke: paint(style.stroke),
    strokeWidth: style.strokeWidth,
    opacity: style.opacity,
    filter: style.filter,
    blend: style.blend,
    mask: node.mask ? true : undefined,
    clip: node.clip ? true : undefined,
    source: sourceKind(node.meta?.source),
    segments: node.type === 'path' ? node.subpaths.reduce((n, sp) => n + sp.segs.length, 0) : undefined,
    text: node.type === 'text' ? [...node.content].slice(0, 80).join('') : undefined,
    font: node.type === 'text' ? `${node.font.family} ${node.font.size}/${node.font.weight}` : undefined,
    anchor: node.type === 'text' ? node.anchor : undefined,
  });
}

function fullInfo(node: SceneNode): Partial<NodeInfo> {
  return defined<Partial<NodeInfo>>({
    transform: node.transform.every((v, i) => v === IDENTITY[i]) ? undefined : (node.transform.map(round4) as unknown as Mat6),
    subpaths: node.type === 'path' ? node.subpaths.map(roundSubpath) : undefined,
    at: node.type === 'text' ? roundPlacement(node.at) : undefined,
    fontSpec: node.type === 'text' ? node.font : undefined,
    meta: node.meta,
  });
}

/** "token → #rrggbb" for a token, "name (gradient)" for a gradient def, otherwise the paint as stored. */
function paintLabel(doc: Doc, paint: string): string {
  const token = Object.hasOwn(doc.tokens, paint) ? doc.tokens[paint]! : undefined;
  if (token !== undefined) return `${paint} → ${toSvgColor(token) ?? token}`;
  const def = Object.hasOwn(doc.defs, paint) ? doc.defs[paint] : undefined;
  return def && def.kind !== 'filter' ? `${paint} (gradient)` : paint;
}

function sourceKind(source: unknown): string | undefined {
  return typeof source === 'object' && source !== null && 'kind' in source && typeof source.kind === 'string' ? source.kind : undefined;
}

const roundSubpath = (sp: Subpath): Subpath => ({
  start: [round2(sp.start[0]), round2(sp.start[1])],
  segs: sp.segs.map((seg) => seg.map(round2) as unknown as Seg),
  closed: sp.closed,
});

const roundPlacement = (at: TextPlacement): TextPlacement =>
  at.kind === 'point' ? { kind: 'point', x: round2(at.x), y: round2(at.y) } : { kind: 'path', subpaths: at.subpaths.map(roundSubpath), offset: round4(at.offset) };
