import paper from 'paper/dist/paper-core.js';

export type Vec2 = [number, number];
/** One cubic segment, spec A3 tuple: [c1x, c1y, c2x, c2y, x, y]. */
export type Seg = [number, number, number, number, number, number];
export type Subpath = { start: Vec2; segs: Seg[]; closed: boolean };

/** Fresh headless paper.js scope: no DOM, no jsdom (spec S6). */
export function createScope(): paper.PaperScope {
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(1, 1));
  return scope;
}

/** Plain cubic subpaths → paper item. Nothing is inserted into the project. */
export function toPaper(scope: paper.PaperScope, subpaths: Subpath[]): paper.PathItem {
  const paths = subpaths.map((sp) => {
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
  return paths.length === 1 ? paths[0]! : new scope.CompoundPath({ children: paths, insert: false });
}

/** paper item → plain cubic subpaths, one per child path. */
export function fromPaper(item: paper.PathItem): Subpath[] {
  const paths = item.className === 'CompoundPath' ? (item.children as paper.Path[]) : [item as paper.Path];
  return paths
    .filter((p) => p.curves.length > 0)
    .map((p) => ({
      start: [p.firstSegment.point.x, p.firstSegment.point.y],
      closed: p.closed,
      segs: p.curves.map((c): Seg => [
        c.point1.x + c.handle1.x, c.point1.y + c.handle1.y,
        c.point2.x + c.handle2.x, c.point2.y + c.handle2.y,
        c.point2.x, c.point2.y,
      ]),
    }));
}

/**
 * Covered area under the nonzero rule. Boolean results can hold children with opposite
 * orientation (exclude of two overlapping squares: +75 and -75), so the raw signed `area`
 * cancels out; reorienting a clone first makes it meaningful.
 */
export function area(item: paper.PathItem): number {
  const normalized = (item.clone({ insert: false }) as paper.PathItem).reorient(true, true);
  return Math.abs((normalized as paper.Path | paper.CompoundPath).area);
}
