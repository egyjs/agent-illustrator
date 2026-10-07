import paper from 'paper/dist/paper-core.js';
import { describe, expect, it } from 'vitest';
import { area, createScope, fromPaper, toPaper, type Subpath } from '../src/paper.ts';

/** Axis-aligned square as straight cubic segments (control points on the endpoints). */
function square(x: number, y: number, s: number): Subpath {
  return {
    start: [x, y],
    closed: true,
    segs: [
      [x, y, x + s, y, x + s, y],
      [x + s, y, x + s, y + s, x + s, y + s],
      [x + s, y + s, x, y + s, x, y + s],
      [x, y + s, x, y, x, y],
    ],
  };
}

describe('R1: paper.js core runs headless (spec S6)', () => {
  it('sets up a scope with no DOM and no jsdom', () => {
    expect((globalThis as { document?: unknown }).document).toBeUndefined();
    expect(createScope().project).toBeTruthy();
  });

  it('round-trips plain cubic subpaths, closed and open', () => {
    const scope = createScope();
    const open: Subpath = { start: [0, 0], closed: false, segs: [[10, 20, 30, 20, 40, 0]] };
    expect(fromPaper(toPaper(scope, [square(0, 0, 10)]))).toEqual([square(0, 0, 10)]);
    expect(fromPaper(toPaper(scope, [open]))).toEqual([open]);
  });

  it('computes the four booleans with the expected areas', () => {
    const scope = createScope();
    const a = toPaper(scope, [square(0, 0, 10)]);
    const b = toPaper(scope, [square(5, 5, 10)]);
    expect(area(a.unite(b, { insert: false }))).toBeCloseTo(175, 6);
    expect(area(a.intersect(b, { insert: false }))).toBeCloseTo(25, 6);
    expect(area(a.subtract(b, { insert: false }))).toBeCloseTo(75, 6);
    expect(area(a.exclude(b, { insert: false }))).toBeCloseTo(150, 6);
  });

  it('unites squares sharing an edge into one closed subpath', () => {
    const scope = createScope();
    const merged = toPaper(scope, [square(0, 0, 10)]).unite(toPaper(scope, [square(10, 0, 10)]), { insert: false });
    expect(fromPaper(merged)).toHaveLength(1);
    expect(area(merged)).toBeCloseTo(200, 6);
  });

  it('simplify (Schneider fit) reduces 200 noisy points to far fewer segments within tolerance', () => {
    const scope = createScope();
    const pts = Array.from({ length: 200 }, (_, i): [number, number] => {
      const a = (i / 200) * Math.PI * 2;
      const r = 100 + Math.sin(i * 12.9898);
      return [Math.cos(a) * r, Math.sin(a) * r];
    });
    const path = new scope.Path({ segments: pts, closed: true, insert: false });
    path.simplify(2.5);
    console.info(`[R1] simplify: 200 points -> ${path.segments.length} segments`);
    expect(path.segments.length).toBeLessThan(60);
    for (const [x, y] of pts) {
      const p = new scope.Point(x, y);
      expect(path.getNearestPoint(p).getDistance(p)).toBeLessThan(4);
    }
  });

  it("smooth({ type: 'catmull-rom', factor: 0.5 }) keeps anchors and adds handles", () => {
    const scope = createScope();
    const pts: [number, number][] = [[0, 0], [50, 40], [100, 0], [150, 40], [200, 0]];
    const path = new scope.Path({ segments: pts, insert: false });
    path.smooth({ type: 'catmull-rom', factor: 0.5 });
    path.segments.forEach((s, i) => expect([s.point.x, s.point.y]).toEqual(pts[i]));
    expect(path.segments[1]!.handleIn.length).toBeGreaterThan(0);
  });

  it('insert:false operations leave the project empty (no shared paper state)', () => {
    const scope = createScope();
    const a = toPaper(scope, [square(0, 0, 10)]);
    a.unite(toPaper(scope, [square(5, 5, 10)]), { insert: false });
    expect(scope.project.isEmpty()).toBe(true);
  });

  it('F5: constructors attach to the most recently created/activated scope, so callers must activate first', () => {
    const a = createScope();
    const b = createScope();
    // a.Path is the same class as b.Path; with default insert it joins the active (last created) scope.
    expect(new a.Path.Circle({ center: [0, 0], radius: 5 }).project).toBe(b.project);
    a.activate();
    expect(new a.Path.Circle({ center: [0, 0], radius: 5 }).project).toBe(a.project);
  });

  it('F5: every PaperScope stays in a static registry, so scope-per-operation leaks', () => {
    const registered = () => Object.keys(Reflect.get(paper.PaperScope, '_scopes') as object).length;
    const before = registered();
    for (let i = 0; i < 50; i++) createScope();
    expect(registered() - before).toBe(50);
  });

  it('200 successive unites finish in a bounded time', () => {
    const scope = createScope();
    let acc: paper.PathItem = new scope.Path.Circle({ center: [0, 0], radius: 20, insert: false });
    const t0 = performance.now();
    for (let i = 1; i <= 200; i++) {
      const next = new scope.Path.Circle({ center: [i * 7, Math.sin(i) * 15], radius: 20, insert: false });
      acc = acc.unite(next, { insert: false });
    }
    const ms = performance.now() - t0;
    console.info(`[R1] 200 unites: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(5000);
  });
});
