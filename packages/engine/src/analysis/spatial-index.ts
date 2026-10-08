import RBush from 'rbush';
import type { Doc } from '../scene/model.ts';
import { worldBounds } from '../scene/query.ts';

export type Indexed = { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number; readonly id: string };

/** An R-tree of every node's world bounds, except the excluded ids. */
export function indexBounds(doc: Doc, exclude: ReadonlySet<string>): RBush<Indexed> {
  const items: Indexed[] = [];
  for (const id of Object.keys(doc.nodes)) {
    if (exclude.has(id)) continue;
    const b = worldBounds(doc, id);
    if (b) items.push({ minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height, id });
  }
  const tree = new RBush<Indexed>();
  tree.load(items);
  return tree;
}

/** Every node whose bounds overlap the band from..to across the whole other axis. */
export function bandQuery(tree: RBush<Indexed>, axis: 'x' | 'y', from: number, to: number): Indexed[] {
  return axis === 'x'
    ? tree.search({ minX: from, maxX: to, minY: -Infinity, maxY: Infinity })
    : tree.search({ minX: -Infinity, maxX: Infinity, minY: from, maxY: to });
}
