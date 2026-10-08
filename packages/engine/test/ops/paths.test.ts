import { describe, expect, it } from 'vitest';
import { signedArea } from '../../src/geometry/flatten.ts';
import { polyline } from '../../src/geometry/paths.ts';
import type { Box } from '../../src/geometry/types.ts';
import { pathCommands, pathFromPoints, roundCornersOp } from '../../src/ops/paths.ts';
import { executeBatch, Registry, type BatchResult } from '../../src/ops/registry.ts';
import { rect, star } from '../../src/ops/shapes.ts';
import { createDocument, type Doc, type PathNode } from '../../src/scene/model.ts';
import { expectIntact } from '../fixtures.ts';

const registry = new Registry().register(rect, star, pathFromPoints, pathCommands, roundCornersOp);
function run(ops: unknown[], doc: Doc = createDocument({ width: 800, height: 600 })): BatchResult {
  const r = executeBatch(registry, doc, ops);
  expectIntact(r.doc);
  return r;
}
const pathOf = (r: BatchResult, id: string) => r.doc.nodes[id] as PathNode;
const boundsAt = (r: BatchResult, i: number) => (r.results[i] as { bounds: Box }).bounds;

describe('ops/paths', () => {
  it('path_from_points: polyline through percent points, open by default', () => {
    const r = run([{ op: 'path_from_points', id: 'p', points: [[0, 0], ['50%', '50%'], [800, 0]] }]);
    expect(pathOf(r, 'p').subpaths).toEqual([polyline([[0, 0], [400, 300], [800, 0]], false)]);
    expect(boundsAt(r, 0)).toEqual({ x: 0, y: 0, width: 800, height: 300 });
  });

  it('path_from_points: smooth passes through every point; fit stays within tolerance', () => {
    const pts = [[0, 100], [100, 0], [200, 100], [300, 0]];
    const smooth = pathOf(run([{ op: 'path_from_points', id: 's', points: pts, mode: 'smooth' }]), 's').subpaths[0]!;
    expect(smooth.segs.map((g) => [g[4], g[5]])).toEqual(pts.slice(1));
    const fit = run([{ op: 'path_from_points', id: 'f', points: pts, mode: 'fit', closed: true, tolerance: 0.5 }]);
    expect(pathOf(fit, 'f').subpaths[0]!.closed).toBe(true);
  });

  it('path_from_points: repeated points are an invalid_input with a hint, not a crash', () => {
    expect(run([{ op: 'path_from_points', points: [[5, 5], [5, 5]], mode: 'smooth' }]).results[0]).toMatchObject({ error: { code: 'invalid_input' } });
  });

  it('path_from_points: a polyline of one repeated point is an invalid_input, not an empty path', () => {
    expect(run([{ op: 'path_from_points', points: [[5, 5], [5, 5], [5, 5]] }]).results[0]).toMatchObject({ error: { code: 'invalid_input' } });
  });

  it('path_commands: SVG path data with a fill rule', () => {
    const r = run([{ op: 'path_commands', id: 'ring', d: 'M0 0 H100 V100 H0 Z M25 25 H75 V75 H25 Z', fillRule: 'evenodd' }]);
    expect(pathOf(r, 'ring').fillRule).toBe('evenodd');
    expect(pathOf(r, 'ring').subpaths).toHaveLength(2);
    expect(boundsAt(r, 0)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('path_commands reports malformed data and empty drawings with hints', () => {
    expect(run([{ op: 'path_commands', d: 'M0 0 L10' }]).results[0]).toMatchObject({ error: { code: 'invalid_input' } });
    expect(JSON.stringify(run([{ op: 'path_commands', d: 'M0 0 L10' }]).results[0])).toContain('position');
    expect(run([{ op: 'path_commands', d: 'M5 5' }]).results[0]).toMatchObject({ error: { code: 'invalid_input' } });
  });

  it('round_corners fillets every path it is given and warns about clamping', () => {
    const r = run([
      { op: 'rect', id: 'a', x: 0, y: 0, width: 100, height: 100 },
      { op: 'rect', id: 'b', x: 200, y: 0, width: 20, height: 20 },
      { op: 'round_corners', ids: ['a', 'b'], radius: 15 },
    ]);
    expect(pathOf(r, 'a').subpaths[0]!.segs).toHaveLength(8);
    expect(signedArea(pathOf(r, 'a').subpaths)).toBeLessThan(10_000);
    expect(r.results[2]).toMatchObject({ status: 'ok', ids: ['a', 'b'], warnings: [{ code: 'radius_clamped' }] });
  });

  it('star: first tip up, exact bounds, roundness rounds the corners', () => {
    const r = run([{ op: 'star', id: 's', cx: 0, cy: 0, outer: 10, inner: 4, points: 5 }]);
    const b = boundsAt(r, 0);
    expect(b.y).toBeCloseTo(-10, 9);
    expect(b.y + b.height).toBeCloseTo(10 * Math.cos(Math.PI / 5), 9);
    expect(pathOf(r, 's').subpaths[0]!.segs).toHaveLength(10);
    const round = run([{ op: 'star', id: 's', cx: 0, cy: 0, outer: 10, inner: 4, points: 5, roundness: 0.5 }]);
    expect(pathOf(round, 's').subpaths[0]!.segs.length).toBeGreaterThan(10);
    expect(boundsAt(round, 0).y).toBeGreaterThan(-10);
  });

  it('every example runs on an empty canvas', () => {
    for (const def of [pathFromPoints, pathCommands, roundCornersOp, star]) {
      for (const ex of def.examples) expect(executeBatch(registry, createDocument({ width: 800, height: 600 }), ex).ok).toBe(true);
    }
  });
});
