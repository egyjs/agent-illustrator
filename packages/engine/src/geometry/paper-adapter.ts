import paper from 'paper/dist/paper-core.js';
import type { FillRule, Seg, Subpath } from './types.ts';

let shared: paper.PaperScope | undefined;

/**
 * Runs `fn` with the engine's single headless paper.js scope (spec S6, spike finding F5).
 * paper's constructors attach items to whichever scope was activated last, and every PaperScope
 * stays in a static registry forever. So the engine keeps one long-lived scope and activates it on
 * every call. It never inserts items (`settings.insertItems = false`, plus `insert: false` at each
 * call site), so nothing paper creates outlives the call: results leave as plain data.
 */
export function withPaper<T>(fn: (scope: paper.PaperScope) => T): T {
  if (!shared) {
    shared = new paper.PaperScope();
    shared.setup(new shared.Size(1, 1));
    shared.settings.insertItems = false;
  }
  shared.activate();
  return fn(shared);
}

/**
 * Plain subpaths → one paper item: a Path for one subpath, otherwise a CompoundPath. Subpaths with
 * no segments are skipped. The fill rule is set on the item, because paper's booleans read it.
 */
export function toPaper(scope: paper.PaperScope, subpaths: readonly Subpath[], fillRule: FillRule = 'nonzero'): paper.PathItem {
  const paths = subpaths
    .filter((sp) => sp.segs.length > 0)
    .map((sp) => {
      const path = new scope.Path({ insert: false });
      path.add(new scope.Point(sp.start[0], sp.start[1]));
      sp.segs.forEach(([c1x, c1y, c2x, c2y, x, y], i) => {
        const last = path.lastSegment;
        last.handleOut = new scope.Point(c1x - last.point.x, c1y - last.point.y);
        const closesLoop = sp.closed && i === sp.segs.length - 1 && x === sp.start[0] && y === sp.start[1];
        if (!closesLoop) path.add(new scope.Point(x, y));
        const next = closesLoop ? path.firstSegment : path.lastSegment;
        next.handleIn = new scope.Point(c2x - x, c2y - y);
      });
      path.closed = sp.closed;
      return path;
    });
  const item: paper.PathItem =
    paths.length === 1 ? paths[0]! : new scope.CompoundPath({ children: paths, insert: false });
  item.fillRule = fillRule;
  return item;
}

/**
 * paper item → plain subpaths, one per child path with curves. A closed path's last segment ends
 * exactly at its start. Handles are stored relative to their anchor in paper, so non-integer
 * coordinates round-trip within float rounding.
 */
export function fromPaper(item: paper.PathItem): Subpath[] {
  const paths = item.className === 'CompoundPath' ? (item.children as paper.Path[]) : [item as paper.Path];
  return paths
    .filter((p) => p.curves.length > 0)
    .map(
      (p): Subpath => ({
        start: [p.firstSegment.point.x, p.firstSegment.point.y],
        closed: p.closed,
        segs: p.curves.map(
          (c): Seg => [
            c.point1.x + c.handle1.x,
            c.point1.y + c.handle1.y,
            c.point2.x + c.handle2.x,
            c.point2.y + c.handle2.y,
            c.point2.x,
            c.point2.y,
          ],
        ),
      }),
    );
}
