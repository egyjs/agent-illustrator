import { describe, expect, it } from 'vitest';
import { polyline } from '../../src/geometry/paths.ts';
import type { Box } from '../../src/geometry/types.ts';
import { executeBatch, Registry, type BatchResult } from '../../src/ops/registry.ts';
import { ellipse, line, polygon, rect } from '../../src/ops/shapes.ts';
import { createDocument, type Doc, type GroupNode, type PathNode } from '../../src/scene/model.ts';
import { docOf, expectIntact, groupNode } from '../fixtures.ts';

const registry = new Registry().register(rect, ellipse, polygon, line);
function run(ops: unknown[], doc: Doc = createDocument({ width: 800, height: 600 })): BatchResult {
  const r = executeBatch(registry, doc, ops);
  expectIntact(r.doc);
  return r;
}
const pathOf = (r: BatchResult, id: string) => r.doc.nodes[id] as PathNode;

describe('ops/shapes', () => {
  it('rect: exact bounds, one closed path, provenance in meta.source', () => {
    const r = run([{ op: 'rect', id: 'card', x: 10, y: 20, width: 30, height: 40, style: { fill: 'teal' } }]);
    expect(r.results[0]).toMatchObject({ status: 'ok', id: 'card', bounds: { x: 10, y: 20, width: 30, height: 40 } });
    const n = pathOf(r, 'card');
    expect(n.subpaths).toEqual([polyline([[10, 20], [40, 20], [40, 60], [10, 60]], true)]);
    expect(n.style).toEqual({ fill: 'teal' });
    expect(n.meta?.source).toEqual({ kind: 'rect', x: 10, y: 20, width: 30, height: 40, radius: 0 });
  });

  it('rect: percent sizes, and a clamped corner radius with a warning', () => {
    const r = run([{ op: 'rect', id: 'bg', x: 0, y: 0, width: '100%', height: '50%', radius: 400 }]);
    expect(r.results[0]).toMatchObject({ bounds: { x: 0, y: 0, width: 800, height: 300 }, warnings: [{ code: 'radius_clamped' }] });
    expect(pathOf(r, 'bg').subpaths[0]!.segs).toHaveLength(6);
  });

  it('rect: rejects a non-positive size or a negative radius with a hint', () => {
    expect(run([{ op: 'rect', x: 0, y: 0, width: 0, height: 10 }]).results[0]).toMatchObject({ status: 'error', error: { code: 'invalid_input' } });
    expect(run([{ op: 'rect', x: 0, y: 0, width: 5, height: 10, radius: -1 }]).results[0]).toMatchObject({ error: { code: 'invalid_input' } });
  });

  it('rect: rejects a size too large to draw, with a canvas-scale hint', () => {
    const r = run([{ op: 'rect', x: 0, y: 0, width: 1e308, height: 10 }]);
    expect(r.results[0]).toMatchObject({ status: 'error', error: { code: 'invalid_input', hint: expect.stringContaining('canvas scale') } });
    expect(r.doc.root).toEqual([]);
  });

  it('ellipse: a circle by default, exact bounds', () => {
    const r = run([
      { op: 'ellipse', id: 'sun', cx: 100, cy: 100, rx: 50 },
      { op: 'ellipse', id: 'egg', cx: 0, cy: 0, rx: 10, ry: 20 },
    ]);
    expect(r.results[0]).toMatchObject({ bounds: { x: 50, y: 50, width: 100, height: 100 } });
    expect(r.results[1]).toMatchObject({ bounds: { x: -10, y: -20, width: 20, height: 40 } });
  });

  it('polygon: first vertex at the top, exact at multiples of 90°', () => {
    const r = run([{ op: 'polygon', id: 'diamond', cx: 50, cy: 50, radius: 10, sides: 4 }]);
    expect(pathOf(r, 'diamond').subpaths).toEqual([polyline([[50, 40], [60, 50], [50, 60], [40, 50]], true)]);
    const tri = run([{ op: 'polygon', id: 't', cx: 0, cy: 0, radius: 10, sides: 3, rotation: 180 }]);
    const b = (tri.results[0] as { bounds: Box }).bounds;
    expect(b.y + b.height).toBeCloseTo(10, 9); // turned 180°, the apex points down
    expect(b.y).toBeCloseTo(-5, 9);
  });

  it('line: an open path with a default black stroke; equal end points are an error', () => {
    const r = run([{ op: 'line', id: 'l', x1: 0, y1: 0, x2: 10, y2: 10 }]);
    expect(pathOf(r, 'l').subpaths).toEqual([polyline([[0, 0], [10, 10]], false)]);
    expect(pathOf(r, 'l').style).toEqual({ stroke: '#000000' });
    expect(run([{ op: 'line', x1: 5, y1: 5, x2: 5, y2: 5 }]).results[0]).toMatchObject({ error: { code: 'invalid_input' } });
  });

  it('shapes go into a parent group, which must be a group', () => {
    const r = run([{ op: 'rect', id: 'r', x: 0, y: 0, width: 5, height: 5, parent: 'g' }], docOf([groupNode('g', [])]));
    expect((r.doc.nodes.g as GroupNode).children).toEqual(['r']);
    expect(r.doc.nodes.r!.parent).toBe('g');
    const bad = run([{ op: 'rect', id: 'a', x: 0, y: 0, width: 5, height: 5 }, { op: 'rect', x: 0, y: 0, width: 5, height: 5, parent: 'a' }]);
    expect(bad.results[1]).toMatchObject({ error: { code: 'invalid_structure' } });
  });

  it('a shape inside a transformed group still takes canvas coordinates', () => {
    const doc = docOf([groupNode('house', [], { transform: [2, 0, 0, 2, 100, 50] })]);
    const r = run(
      [
        { op: 'rect', id: 'r', parent: 'house', x: 10, y: 10, width: 10, height: 10 },
        { op: 'rect', id: 'w', parent: 'house', x: 0, y: 0, width: '100%', height: 5 },
      ],
      doc,
    );
    expect(r.results[0]).toMatchObject({ bounds: { x: 10, y: 10, width: 10, height: 10 } });
    expect(r.results[1]).toMatchObject({ bounds: { x: 0, y: 0, width: 800, height: 5 } });
    const flat = run([{ op: 'rect', parent: 'flat', x: 0, y: 0, width: 5, height: 5 }], docOf([groupNode('flat', [], { transform: [0, 0, 0, 0, 0, 0] })]));
    expect(flat.results[0]).toMatchObject({ error: { code: 'invalid_structure' } });
  });

  it('every shape example runs on an empty canvas', () => {
    for (const def of registry.list()) {
      for (const example of def.examples) {
        expect(executeBatch(registry, createDocument({ width: 800, height: 600 }), example).ok).toBe(true);
      }
    }
  });
});
