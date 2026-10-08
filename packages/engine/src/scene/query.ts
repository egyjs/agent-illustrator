import { closest, EngineError } from '../errors.ts';
import { pathBounds, unionBoxes } from '../geometry/bezier.ts';
import { applyToPoint, applyToSubpaths, IDENTITY, multiply } from '../geometry/transform.ts';
import type { Box, Mat6, Subpath } from '../geometry/types.ts';
import type { Doc, PathNode, SceneNode } from './model.ts';

/** The node with this id, or undefined. Own keys only, so "constructor" and friends never resolve. */
export function getNode(doc: Doc, id: string): SceneNode | undefined {
  return Object.hasOwn(doc.nodes, id) ? doc.nodes[id] : undefined;
}

/** The node with this id, or an unknown_id error whose hint names the closest ids. */
export function requireNode(doc: Doc, id: string): SceneNode {
  const node = getNode(doc, id);
  if (node) return node;
  const ids = Object.keys(doc.nodes);
  const near = closest(id, ids);
  const hint =
    near.length > 0
      ? `Did you mean ${near.map((n) => `"${n}"`).join(' or ')}?`
      : ids.length > 0
        ? `Existing ids include ${ids.slice(0, 10).join(', ')}.`
        : 'The document is empty; create a node first.';
  throw new EngineError('unknown_id', `no node with id "${id}"`, hint);
}

const sameMatrix = (a: Mat6, b: Mat6) => a === b || a.every((v, i) => v === b[i]);

const worldCache = new WeakMap<SceneNode, { readonly parent: Mat6; readonly world: Mat6 }>();

/**
 * world = parentWorld · local (FR-1.4). The cache is keyed by the node object and checked against
 * the parent's world matrix, because an ancestor can change while this node object is shared.
 */
export function worldTransform(doc: Doc, id: string): Mat6 {
  const node = requireNode(doc, id);
  const parent = node.parent === null ? IDENTITY : worldTransform(doc, node.parent);
  const hit = worldCache.get(node);
  if (hit && sameMatrix(hit.parent, parent)) return hit.world;
  const world = node.parent === null ? node.transform : multiply(parent, node.transform);
  worldCache.set(node, { parent, world });
  return world;
}

/** A path's geometry in world space. */
export function worldSubpaths(doc: Doc, node: PathNode): Subpath[] {
  return applyToSubpaths(worldTransform(doc, node.id), node.subpaths);
}

const boundsCache = new WeakMap<PathNode, { readonly world: Mat6; readonly box: Box | null }>();

/**
 * Exact world-space bounds (FR-5.3): control points go through the world matrix, then exact Bézier
 * bounds are taken. Groups union their children. A clip trims the box to the clip's own bounds.
 * Empty groups and empty paths give null. Stroke width is not included. Text gives the box around
 * its transformed ink box (exact unless rotated or skewed).
 */
export function worldBounds(doc: Doc, id: string): Box | null {
  const node = requireNode(doc, id);
  const box = unclippedBounds(doc, node);
  if (!box || !node.clip) return box;
  const clipBox = clipBounds(doc, node);
  return clipBox ? intersectBoxes(box, clipBox) : null;
}

/** `worldBounds` without the node's own clip: the area its content covers before it is clipped. */
export function worldContentBounds(doc: Doc, id: string): Box | null {
  return unclippedBounds(doc, requireNode(doc, id));
}

/** The world-space bounds of a node's clip shape; null when the node has no clip or the clip is empty. */
export function clipBounds(doc: Doc, node: SceneNode): Box | null {
  return node.clip ? pathBounds(applyToSubpaths(worldTransform(doc, node.id), node.clip.subpaths)) : null;
}

function unclippedBounds(doc: Doc, node: SceneNode): Box | null {
  if (node.type === 'group') {
    return unionBoxes(node.children.map((c) => worldBounds(doc, c)).filter((b): b is Box => b !== null));
  }
  const world = worldTransform(doc, node.id);
  if (node.type === 'text') return node.ink ? transformBox(world, node.ink) : null;
  const hit = boundsCache.get(node);
  if (hit && sameMatrix(hit.world, world)) return hit.box;
  const box = pathBounds(applyToSubpaths(world, node.subpaths));
  boundsCache.set(node, { world, box });
  return box;
}

function transformBox(m: Mat6, b: Box): Box {
  const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => applyToPoint(m, [x!, y!]));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function intersectBoxes(a: Box, b: Box): Box | null {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width), y1 = Math.min(a.y + a.height, b.y + b.height);
  return x1 >= x0 && y1 >= y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** The node and everything below it, depth-first, parents before children. */
export function subtreeIds(doc: Doc, id: string): string[] {
  const out: string[] = [];
  const walk = (nid: string): void => {
    out.push(nid);
    const node = requireNode(doc, nid);
    if (node.type === 'group') node.children.forEach(walk);
  };
  walk(id);
  return out;
}

/** The list that holds the node: its parent's children, or root. */
export function siblings(doc: Doc, node: SceneNode): readonly string[] {
  if (node.parent === null) return doc.root;
  const parent = requireNode(doc, node.parent);
  return parent.type === 'group' ? parent.children : [];
}
