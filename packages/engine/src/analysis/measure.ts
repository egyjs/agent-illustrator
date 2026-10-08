import { EngineError } from '../errors.ts';
import { measure as measureSubpath } from '../geometry/bezier.ts';
import { booleanOp, type Shape } from '../geometry/boolean.ts';
import { signedArea } from '../geometry/flatten.ts';
import type { Box, Subpath } from '../geometry/types.ts';
import type { Doc, PathNode } from '../scene/model.ts';
import { requireNode, subtreeIds, worldBounds, worldSubpaths } from '../scene/query.ts';
import { round2, roundBox } from './describe.ts';

export const MAX_MEASURE_IDS = 50;
/** Pairs grow with the square of the ids, so they are only worked out for this many. */
export const MAX_PAIR_IDS = 12;
/** Overlaps smaller than this area are rounding noise from the boolean. */
const MIN_OVERLAP_AREA = 1e-6;

/** Geometry of one node; null where it does not apply (empty nodes, and text for area and length). */
export type NodeMeasure = {
  readonly bounds: Box | null;
  readonly center: readonly [number, number] | null;
  readonly area: number | null;
  readonly length: number | null;
};

export type PairMeasure = {
  readonly a: string;
  readonly b: string;
  /** Between the centers of the two bounding boxes; null when either node is empty. */
  readonly centerDistance: number | null;
  /** Distance between the boxes on each axis, 0 where they overlap on that axis; null when either node is empty. */
  readonly gap: { readonly x: number; readonly y: number } | null;
  readonly overlap: boolean;
  readonly overlapArea: number;
  /** True when the overlap comes from the shapes themselves, false when it is the overlap of their boxes. */
  readonly exact: boolean;
};

export type Measurement = {
  /** In the order the ids were given, duplicates removed. */
  readonly nodes: Readonly<Record<string, NodeMeasure>>;
  /** Every pair in input order; empty unless there are 2 to MAX_PAIR_IDS ids. */
  readonly pairs: readonly PairMeasure[];
};

/**
 * Exact numbers for 1 to 50 nodes (FR-10), so an agent need not eyeball a render. Area and length are
 * of the path geometry in world space: a path's filled area (overlapping loops add up, so holes
 * need opposite winding) and its drawn length, a group's the sum over its descendant paths. Clips
 * and strokes are not counted. For 2 to 12 nodes it also relates every pair. Two paths are tested
 * with a boolean intersection (exact); a pair involving a group or text falls back to the overlap
 * of the bounding boxes.
 */
export function measure(doc: Doc, ids: readonly string[]): Measurement {
  const unique = [...new Set(ids)];
  if (unique.length < 1 || unique.length > MAX_MEASURE_IDS) {
    throw new EngineError('invalid_input', `measure takes 1 to ${MAX_MEASURE_IDS} ids, got ${unique.length}`, `List the nodes to measure, at most ${MAX_MEASURE_IDS} per call.`);
  }
  const boxes = new Map(unique.map((id) => [id, worldBounds(doc, id)] as const)); // throws unknown_id before any real work
  const nodes = Object.fromEntries(unique.map((id) => [id, measureNode(doc, id, boxes.get(id)!)]));
  const pairs: PairMeasure[] = [];
  if (unique.length >= 2 && unique.length <= MAX_PAIR_IDS) {
    for (const [i, a] of unique.entries()) {
      for (const b of unique.slice(i + 1)) pairs.push(measurePair(doc, a, b, boxes.get(a)!, boxes.get(b)!));
    }
  }
  return { nodes, pairs };
}

function measureNode(doc: Doc, id: string, box: Box | null): NodeMeasure {
  const paths = subtreeIds(doc, id)
    .map((nid) => requireNode(doc, nid))
    .filter((n): n is PathNode => n.type === 'path')
    .map((n) => worldSubpaths(doc, n));
  const sum = (f: (sps: Subpath[]) => number): number | null => (paths.length === 0 ? null : round2(paths.reduce((s, sps) => s + f(sps), 0)));
  return {
    bounds: box && roundBox(box),
    center: box && [round2(box.x + box.width / 2), round2(box.y + box.height / 2)],
    area: sum((sps) => Math.abs(signedArea(sps))),
    length: sum((sps) => sps.reduce((s, sp) => s + measureSubpath(sp).length, 0)),
  };
}

function measurePair(doc: Doc, a: string, b: string, boxA: Box | null, boxB: Box | null): PairMeasure {
  if (!boxA || !boxB) return { a, b, centerDistance: null, gap: null, overlap: false, overlapArea: 0, exact: false };
  const axisGap = (a0: number, a1: number, b0: number, b1: number) => Math.max(a0 - b1, b0 - a1, 0);
  const gap = { x: axisGap(boxA.x, boxA.x + boxA.width, boxB.x, boxB.x + boxB.width), y: axisGap(boxA.y, boxA.y + boxA.height, boxB.y, boxB.y + boxB.height) };
  const centerDistance = Math.hypot(boxA.x + boxA.width / 2 - (boxB.x + boxB.width / 2), boxA.y + boxA.height / 2 - (boxB.y + boxB.height / 2));
  const { area, exact } = shapeOverlap(doc, a, b, gap.x > 0 || gap.y > 0, overlapOfBoxes(boxA, boxB));
  return {
    a,
    b,
    centerDistance: round2(centerDistance),
    gap: { x: round2(gap.x), y: round2(gap.y) },
    overlap: area > MIN_OVERLAP_AREA,
    overlapArea: round2(area),
    exact,
  };
}

const overlapOfBoxes = (p: Box, q: Box): number =>
  Math.max(0, Math.min(p.x + p.width, q.x + q.width) - Math.max(p.x, q.x)) * Math.max(0, Math.min(p.y + p.height, q.y + q.height) - Math.max(p.y, q.y));

/** The overlap area of two nodes: exact for two paths, else (or if the boolean fails) `boxOverlap`, the overlap of their boxes. */
function shapeOverlap(doc: Doc, a: string, b: string, boxesApart: boolean, boxOverlap: number): { area: number; exact: boolean } {
  const [na, nb] = [requireNode(doc, a), requireNode(doc, b)];
  if (na.type !== 'path' || nb.type !== 'path') return { area: boxOverlap, exact: false };
  if (boxesApart) return { area: 0, exact: true };
  const shape = (n: PathNode): Shape => ({ subpaths: worldSubpaths(doc, n), fillRule: n.fillRule });
  try {
    return { area: Math.abs(signedArea(booleanOp('intersect', shape(na), shape(nb)).subpaths)), exact: true };
  } catch {
    // paper.js can fail on degenerate input; the boxes still say whether the shapes could touch.
    return { area: boxOverlap, exact: false };
  }
}
