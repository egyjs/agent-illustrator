import { describe, expect, it } from 'vitest';
import { polyline } from '../../src/geometry/paths.ts';
import { decompose } from '../../src/geometry/transform.ts';
import type { Vec2 } from '../../src/geometry/types.ts';
import { array, repeatAlongPath, scatter } from '../../src/ops/repeat.ts';
import { executeBatch, Registry, type BatchOptions, type BatchResult } from '../../src/ops/registry.ts';
import { ellipse, line, polygon, rect } from '../../src/ops/shapes.ts';
import { group } from '../../src/ops/structure.ts';
import { createDocument, type Doc, type GroupNode } from '../../src/scene/model.ts';
import { worldBounds, worldTransform } from '../../src/scene/query.ts';
import { toSvg } from '../../src/render/svg.ts';
import { docOf, expectIntact, groupNode, pathNode } from '../fixtures.ts';

const registry = new Registry().register(scatter, repeatAlongPath, array, rect, ellipse, polygon, line, group);
function run(ops: unknown[], doc: Doc = createDocument({ width: 800, height: 600 }), options?: BatchOptions): BatchResult {
  const r = executeBatch(registry, doc, ops, options);
  expectIntact(r.doc);
  return r;
}
const kids = (r: BatchResult, id: string) => (r.doc.nodes[id] as GroupNode).children;
const centerOf = (r: BatchResult, id: string): Vec2 => {
  const b = worldBounds(r.doc, id)!;
  return [b.x + b.width / 2, b.y + b.height / 2];
};
const centers = (r: BatchResult, id: string) => kids(r, id).map((k) => centerOf(r, k));
const expectPoints = (actual: readonly Vec2[], expected: readonly Vec2[]) => {
  expect(actual).toHaveLength(expected.length);
  for (const [i, p] of actual.entries()) {
    expect(p[0]).toBeCloseTo(expected[i]![0], 6);
    expect(p[1]).toBeCloseTo(expected[i]![1], 6);
  }
};
const error = (r: BatchResult) => (r.results.find((o) => o.status === 'error') as { error: { code: string; message: string; hint: string } }).error;

const dot = { op: 'ellipse', id: 'dot', cx: 0, cy: 0, rx: 5 };
const region = { x: 100, y: 100, width: 300, height: 200 };

describe('ops/repeat examples', () => {
  it('every example runs ok and ends with its own op', () => {
    for (const def of [scatter, repeatAlongPath, array]) {
      for (const example of def.examples) {
        const r = run([...example]);
        expect(r.ok, def.name).toBe(true);
        expect(r.results.at(-1), def.name).toMatchObject({ op: def.name, status: 'ok' });
      }
    }
  });
});

describe('ops/repeat scatter', () => {
  it('fills a region with evenly spread copies in a new group; the source goes, "$last" is the group', () => {
    const r = run([dot, { op: 'scatter', id: 'dots', source: 'dot', region, min_distance: 30, seed: 3 }]);
    expect(r.results[1]).toMatchObject({ status: 'ok', id: 'dots' });
    expect(r.lastCreated).toBe('dots');
    expect(r.doc.nodes.dot).toBeUndefined();
    const pts = centers(r, 'dots');
    expect(pts.length).toBeGreaterThan(30);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(region.x - 1e-6);
      expect(x).toBeLessThanOrEqual(region.x + region.width + 1e-6);
      expect(y).toBeGreaterThanOrEqual(region.y - 1e-6);
      expect(y).toBeLessThanOrEqual(region.y + region.height + 1e-6);
    }
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i]![0] - pts[j]![0], pts[i]![1] - pts[j]![1])).toBeGreaterThanOrEqual(30 - 1e-6);
    }
    expect((r.doc.nodes.dots as GroupNode).meta?.source).toMatchObject({ kind: 'scatter', source: 'dot', seed: 3 });
  });

  it('fills a shape: every copy lies inside it, and the shape stays', () => {
    const r = run([dot, { op: 'ellipse', id: 'pond', cx: 300, cy: 300, rx: 120, ry: 80 }, { op: 'scatter', source: 'dot', within: 'pond', min_distance: 20 }]);
    expect(r.doc.nodes.pond).toBeDefined();
    const pts = centers(r, r.lastCreated!);
    expect(pts.length).toBeGreaterThan(20);
    for (const [x, y] of pts) expect(((x - 300) / 120) ** 2 + ((y - 300) / 80) ** 2).toBeLessThanOrEqual(1.01);
  });

  it('is deterministic per seed, and follows the document seed when none is given', () => {
    const go = (seed: number | undefined, docSeed = 1) =>
      centers(run([dot, { op: 'scatter', id: 'g', source: 'dot', region, min_distance: 25, ...(seed === undefined ? {} : { seed }) }], createDocument({ width: 800, height: 600, seed: docSeed })), 'g');
    expect(go(1)).toEqual(go(1));
    expect(go(1)).not.toEqual(go(2));
    expect(go(undefined, 5)).toEqual(go(undefined, 5));
    expect(go(undefined, 5)).not.toEqual(go(undefined, 6));
    expect(go(5, 1)).toEqual(go(undefined, 5));
  });

  it('keep leaves the source; max_count caps the copies', () => {
    const r = run([dot, { op: 'scatter', id: 'g', source: 'dot', region, min_distance: 10, max_count: 12, keep: true }]);
    expect(r.doc.nodes.dot).toBeDefined();
    expect(kids(r, 'g')).toHaveLength(12);
    expect(r.doc.root).toEqual(['dot', 'g']);
  });

  it('turns and scales each copy about its center within the given ranges', () => {
    const r = run([
      { op: 'rect', id: 'bar', x: 0, y: 0, width: 20, height: 10 },
      { op: 'scatter', id: 'g', source: 'bar', region, min_distance: 60, max_count: 5, scale: [2, 2], rotate: [90, 90] },
    ]);
    for (const k of kids(r, 'g')) expect(worldBounds(r.doc, k)).toMatchObject({ width: 20, height: 40 });
    const wide = run([
      { op: 'rect', id: 'bar', x: 0, y: 0, width: 20, height: 10 },
      { op: 'scatter', id: 'g', source: 'bar', region, min_distance: 40, scale: [0.5, 1.5], seed: 9 },
    ]);
    const widths = kids(wide, 'g').map((k) => worldBounds(wide.doc, k)!.width);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(10 - 1e-9);
    expect(Math.max(...widths)).toBeLessThanOrEqual(30 + 1e-9);
    expect(new Set(widths.map((w) => w.toFixed(6))).size).toBeGreaterThan(5);
  });

  it('density keeps fewer copies towards the `to` side', () => {
    const r = run([dot, { op: 'scatter', id: 'g', source: 'dot', region: { x: 0, y: 0, width: 800, height: 600 }, min_distance: 20, density: { angle: 0, from: 1, to: 0 }, seed: 4 }]);
    const pts = centers(r, 'g');
    const left = pts.filter(([x]) => x < 400).length;
    const right = pts.length - left;
    expect(right).toBeGreaterThan(0);
    expect(left).toBeGreaterThan(2 * right);
  });

  it('copies sit at canvas coordinates inside a transformed parent', () => {
    const doc = docOf([pathNode('tile', [polyline([[0, 0], [10, 0], [10, 10], [0, 10]], true)]), groupNode('frame', [], { transform: [1, 0, 0, 1, 100, 50] })]);
    const r = run([{ op: 'scatter', id: 'g', source: 'tile', parent: 'frame', region, min_distance: 50, max_count: 6 }], doc);
    expect(r.doc.nodes.g!.parent).toBe('frame');
    for (const [x, y] of centers(r, 'g')) {
      expect(x).toBeGreaterThanOrEqual(region.x - 1e-6);
      expect(y).toBeGreaterThanOrEqual(region.y - 1e-6);
    }
  });

  it('copies a group with everything inside it', () => {
    const r = run([
      { op: 'rect', id: 'a', x: 0, y: 0, width: 10, height: 10 },
      { op: 'rect', id: 'b', x: 12, y: 0, width: 10, height: 10 },
      { op: 'group', id: 'pair', ids: ['a', 'b'] },
      { op: 'scatter', id: 'g', source: 'pair', region, min_distance: 80, max_count: 4 },
    ]);
    expect(kids(r, 'g')).toHaveLength(4);
    expect(Object.keys(r.doc.nodes)).toHaveLength(1 + 4 * 3);
    for (const k of kids(r, 'g')) expect((r.doc.nodes[k] as GroupNode).children).toHaveLength(2);
  });

  it('warns and keeps the source when no copy is made', () => {
    const r = run([dot, { op: 'scatter', id: 'g', source: 'dot', region, min_distance: 30, density: { from: 0, to: 0 } }]);
    expect(r.results[1]).toMatchObject({ status: 'ok', warnings: [{ code: 'empty_result' }] });
    expect(r.doc.nodes.dot).toBeDefined();
    expect(kids(r, 'g')).toEqual([]);
  });

  it('rejects bad input with a hint', () => {
    for (const call of [
      { source: 'dot', min_distance: 20 },
      { source: 'dot', min_distance: 20, region, within: 'dot' },
      { source: 'dot', min_distance: 0, region },
      { source: 'dot', min_distance: 20, region: { ...region, width: 0 } },
      { source: 'dot', min_distance: 0.001, region: { x: 0, y: 0, width: 800, height: 600 } },
    ]) {
      const r = run([dot, { op: 'scatter', ...call }]);
      expect(r.results[1]).toMatchObject({ status: 'error', error: { code: 'invalid_input' } });
      expect(error(r).hint.length).toBeGreaterThan(10);
    }
    expect(run([dot, { op: 'scatter', source: 'dot', region, min_distance: 20, scale: [2, 1] }]).results[1]).toMatchObject({ error: { code: 'invalid_input' } });
    expect(run([dot, { op: 'scatter', source: 'dot', region, min_distance: 20, scale: [0, 1] }]).results[1]).toMatchObject({ error: { code: 'invalid_input' } });
    expect(run([dot, { op: 'scatter', source: 'dot', region, min_distance: 20, nope: 1 }]).results[1]).toMatchObject({ error: { code: 'invalid_input' } });
  });

  it('refuses a parent or a shape inside the source', () => {
    const base = [
      { op: 'rect', id: 'a', x: 0, y: 0, width: 10, height: 10 },
      { op: 'ellipse', id: 'b', cx: 40, cy: 40, rx: 30 },
      { op: 'group', id: 'pair', ids: ['a', 'b'] },
    ];
    expect(run([...base, { op: 'scatter', source: 'pair', parent: 'pair', region, min_distance: 50 }]).results[3]).toMatchObject({ error: { code: 'invalid_structure' } });
    expect(run([...base, { op: 'scatter', source: 'pair', within: 'b', min_distance: 5 }]).results[3]).toMatchObject({ error: { code: 'invalid_structure' } });
  });

  it('enforces maxGenerated and maxNodes before cloning', () => {
    const many = { op: 'scatter', source: 'dot', region: { x: 0, y: 0, width: 800, height: 600 }, min_distance: 20 };
    const tooMany = run([dot, { ...many, max_count: 50 }], undefined, { limits: { maxGenerated: 10 } });
    expect(tooMany.results[1]).toMatchObject({ status: 'error', error: { code: 'limit_exceeded' } });
    expect(tooMany.committed).toBe(false);
    const tooBig = run([dot, { ...many, max_count: 30 }], undefined, { limits: { maxNodes: 20 } });
    expect(tooBig.results[1]).toMatchObject({ status: 'error', error: { code: 'limit_exceeded' } });
    expect(error(tooBig).message).toContain('copies would bring');
    expect(run([dot, { ...many, max_count: 30 }], undefined, { limits: { maxNodes: 40 } }).ok).toBe(true);
  });

  it('makes 2000 copies in a 2000 × 2000 region in under 3 s', () => {
    const started = performance.now();
    const r = executeBatch(registry, createDocument({ width: 800, height: 600 }), [
      { op: 'rect', id: 'chip', x: 0, y: 0, width: 4, height: 4 },
      { op: 'scatter', id: 'g', source: 'chip', region: { x: 0, y: 0, width: 2000, height: 2000 }, min_distance: 30, scale: [0.5, 2], rotate: [0, 360] },
    ]);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(r.ok).toBe(true);
    expectIntact(r.doc);
    expect(kids(r, 'g')).toHaveLength(2000);
  });

  it('svg: a scatter of 12 copies', () => {
    const r = run([{ op: 'rect', id: 'chip', x: 0, y: 0, width: 12, height: 6, style: { fill: '#2a9d8f' } }, { op: 'scatter', id: 'g', source: 'chip', region, min_distance: 40, max_count: 12, scale: [0.8, 1.2], rotate: [0, 180], seed: 3 }]);
    expect(toSvg(r.doc)).toMatchSnapshot();
  });
});

describe('ops/repeat repeat_along_path', () => {
  const rail = { op: 'line', id: 'rail', x1: 100, y1: 100, x2: 500, y2: 100, style: { stroke: '#000' } };
  const tie = { op: 'rect', id: 'tie', x: 0, y: 0, width: 10, height: 10 };

  it('spacing: copies every `spacing` units, centered on the path, the guide stays', () => {
    const r = run([rail, tie, { op: 'repeat_along_path', id: 'g', source: 'tie', path: 'rail', spacing: 100 }]);
    expect(r.lastCreated).toBe('g');
    expect(r.doc.nodes.tie).toBeUndefined();
    expect(r.doc.nodes.rail).toBeDefined();
    expectPoints(centers(r, 'g'), [[100, 100], [200, 100], [300, 100], [400, 100], [500, 100]]);
  });

  it('count: equal steps from start to end; an offset moves the start', () => {
    const five = run([rail, tie, { op: 'repeat_along_path', id: 'g', source: 'tie', path: 'rail', count: 5 }]);
    expectPoints(centers(five, 'g'), [[100, 100], [200, 100], [300, 100], [400, 100], [500, 100]]);
    const one = run([rail, tie, { op: 'repeat_along_path', id: 'g', source: 'tie', path: 'rail', count: 1, offset: 50 }]);
    expectPoints(centers(one, 'g'), [[150, 100]]);
    const three = run([rail, tie, { op: 'repeat_along_path', id: 'g', source: 'tie', path: 'rail', count: 3, offset: 50 }]);
    expectPoints(centers(three, 'g'), [[150, 100], [325, 100], [500, 100]]);
  });

  it('align turns each copy to the path direction; align false keeps them upright', () => {
    const diagonal = { op: 'line', id: 'rail', x1: 0, y1: 0, x2: 100, y2: 100, style: { stroke: '#000' } };
    const turned = run([diagonal, tie, { op: 'repeat_along_path', id: 'g', source: 'tie', path: 'rail', count: 3 }]);
    for (const k of kids(turned, 'g')) expect(decompose(worldTransform(turned.doc, k)).rotate).toBeCloseTo(45, 6);
    const down = run([{ op: 'line', id: 'rail', x1: 50, y1: 0, x2: 50, y2: 300, style: { stroke: '#000' } }, tie, { op: 'repeat_along_path', id: 'g', source: 'tie', path: 'rail', count: 3 }]);
    for (const k of kids(down, 'g')) expect(decompose(worldTransform(down.doc, k)).rotate).toBeCloseTo(90, 6);
    const upright = run([diagonal, tie, { op: 'repeat_along_path', id: 'g', source: 'tie', path: 'rail', count: 3, align: false }]);
    for (const k of kids(upright, 'g')) expect(decompose(worldTransform(upright.doc, k)).rotate).toBeCloseTo(0, 6);
  });

  it('a closed outline: count wraps around with no copy doubled at the seam', () => {
    const ring = { op: 'ellipse', id: 'ring', cx: 300, cy: 300, rx: 100 };
    const r = run([ring, tie, { op: 'repeat_along_path', id: 'g', source: 'tie', path: 'ring', count: 4, align: false }]);
    const pts = centers(r, 'g');
    expect(pts).toHaveLength(4);
    for (const [x, y] of pts) expect(Math.hypot(x - 300, y - 300)).toBeCloseTo(100, 0);
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = pts[i]!, [bx, by] = pts[(i + 1) % 4]!;
      expect(Math.hypot(ax - bx, ay - by)).toBeCloseTo(100 * Math.SQRT2, 0);
    }
    // An offset slides the start along the outline and wraps.
    const shifted = run([ring, tie, { op: 'repeat_along_path', id: 'g', source: 'tie', path: 'ring', count: 4, offset: 600, align: false }]);
    expect(centers(shifted, 'g')).toHaveLength(4);
    for (const [x, y] of centers(shifted, 'g')) expect(Math.hypot(x - 300, y - 300)).toBeCloseTo(100, 0);
    // Spacing on a closed 100 × 100 square: 400 / 100 gives four copies, not five.
    const square = run([{ op: 'rect', id: 'sq', x: 0, y: 0, width: 100, height: 100 }, tie, { op: 'repeat_along_path', id: 'g', source: 'tie', path: 'sq', spacing: 100, align: false }]);
    expectPoints(centers(square, 'g'), [[0, 0], [100, 0], [100, 100], [0, 100]]);
  });

  it('runs on across several subpaths', () => {
    const doc = docOf([pathNode('guide', [polyline([[0, 0], [100, 0]], false), polyline([[0, 100], [100, 100]], false)]), pathNode('tie', [polyline([[-5, -5], [5, -5], [5, 5], [-5, 5]], true)])]);
    const r = run([{ op: 'repeat_along_path', id: 'g', source: 'tie', path: 'guide', spacing: 50 }], doc);
    expectPoints(centers(r, 'g'), [[0, 0], [50, 0], [100, 0], [50, 100], [100, 100]]);
  });

  it('warns and keeps the source when the offset is past the end', () => {
    const r = run([rail, tie, { op: 'repeat_along_path', id: 'g', source: 'tie', path: 'rail', spacing: 50, offset: 900 }]);
    expect(r.results[2]).toMatchObject({ status: 'ok', warnings: [{ code: 'empty_result' }] });
    expect(r.doc.nodes.tie).toBeDefined();
  });

  it('rejects a guide that is not a path, a bad count/spacing pair, and a guide inside the source', () => {
    expect(run([rail, tie, { op: 'group', id: 'grp', ids: ['rail'] }, { op: 'repeat_along_path', source: 'tie', path: 'grp', count: 3 }]).results[3]).toMatchObject({ error: { code: 'invalid_structure' } });
    for (const call of [{}, { count: 3, spacing: 10 }, { spacing: 0 }, { spacing: -5 }]) {
      const r = run([rail, tie, { op: 'repeat_along_path', source: 'tie', path: 'rail', ...call }]);
      expect(r.results[2]).toMatchObject({ status: 'error', error: { code: 'invalid_input' } });
      expect(error(r).hint.length).toBeGreaterThan(10);
    }
    const inside = run([rail, { op: 'group', id: 'grp', ids: ['rail'] }, { op: 'repeat_along_path', source: 'grp', path: 'rail', count: 3 }]);
    expect(inside.results[2]).toMatchObject({ error: { code: 'invalid_structure' } });
  });

  it('enforces maxGenerated before it lists positions', () => {
    const r = run([rail, tie, { op: 'repeat_along_path', source: 'tie', path: 'rail', spacing: 1 }], undefined, { limits: { maxGenerated: 100 } });
    expect(r.results[2]).toMatchObject({ status: 'error', error: { code: 'limit_exceeded' } });
    expect(run([rail, tie, { op: 'repeat_along_path', source: 'tie', path: 'rail', count: 101 }], undefined, { limits: { maxGenerated: 100 } }).ok).toBe(false);
  });
});

describe('ops/repeat array', () => {
  const tile = { op: 'rect', id: 'tile', x: 100, y: 100, width: 50, height: 30 };

  it('grid: row-major copies, the first where the source was; the step is size plus gap', () => {
    const r = run([tile, { op: 'array', id: 'g', source: 'tile', kind: 'grid', rows: 2, cols: 3, gap: [10, 20] }]);
    expect(r.lastCreated).toBe('g');
    expect(r.doc.nodes.tile).toBeUndefined();
    expectPoints(centers(r, 'g'), [[125, 115], [185, 115], [245, 115], [125, 165], [185, 165], [245, 165]]);
  });

  it('grid: without gap the copies touch; spacing sets the step directly', () => {
    expectPoints(centers(run([tile, { op: 'array', id: 'g', source: 'tile', kind: 'grid', rows: 1, cols: 3 }]), 'g'), [[125, 115], [175, 115], [225, 115]]);
    expectPoints(centers(run([tile, { op: 'array', id: 'g', source: 'tile', kind: 'grid', rows: 2, cols: 2, spacing: [80, 90] }]), 'g'), [[125, 115], [205, 115], [125, 205], [205, 205]]);
  });

  it('grid: keep leaves the source; percent gaps follow the canvas; a transformed parent changes nothing', () => {
    const kept = run([tile, { op: 'array', id: 'g', source: 'tile', kind: 'grid', rows: 1, cols: 2, gap: ['10%', 0], keep: true }]);
    expect(kept.doc.nodes.tile).toBeDefined();
    expectPoints(centers(kept, 'g'), [[125, 115], [255, 115]]);
    const doc = docOf([pathNode('tile', [polyline([[0, 0], [10, 0], [10, 10], [0, 10]], true)]), groupNode('frame', [], { transform: [1, 0, 0, 1, 100, 50] })]);
    const inFrame = run([{ op: 'array', id: 'g', source: 'tile', parent: 'frame', kind: 'grid', rows: 1, cols: 2, gap: [5, 0] }], doc);
    expectPoints(centers(inFrame, 'g'), [[5, 5], [20, 5]]);
  });

  it('grid: copies a group as a whole', () => {
    const r = run([
      { op: 'rect', id: 'a', x: 0, y: 0, width: 10, height: 10 },
      { op: 'rect', id: 'b', x: 10, y: 0, width: 10, height: 10 },
      { op: 'group', id: 'pair', ids: ['a', 'b'] },
      { op: 'array', id: 'g', source: 'pair', kind: 'grid', rows: 2, cols: 2, gap: [0, 0] },
    ]);
    expect(kids(r, 'g')).toHaveLength(4);
    expect(Object.keys(r.doc.nodes)).toHaveLength(1 + 4 * 3);
    expect(worldBounds(r.doc, 'g')).toMatchObject({ x: 0, y: 0, width: 40, height: 20 });
  });

  const tick = { op: 'rect', id: 'tick', x: 395, y: 80, width: 10, height: 40 };

  it('radial: copies around the center, each turned with the circle', () => {
    const r = run([tick, { op: 'array', id: 'g', source: 'tick', kind: 'radial', count: 4 }]);
    expectPoints(centers(r, 'g'), [[400, 100], [600, 300], [400, 500], [200, 300]]);
    const sizes = kids(r, 'g').map((k) => [worldBounds(r.doc, k)!.width, worldBounds(r.doc, k)!.height]);
    expect(sizes).toEqual([[10, 40], [40, 10], [10, 40], [40, 10]]);
  });

  it('radial: rotate_copies false keeps every copy upright, at the same places', () => {
    const r = run([tick, { op: 'array', id: 'g', source: 'tick', kind: 'radial', count: 4, rotate_copies: false }]);
    expectPoints(centers(r, 'g'), [[400, 100], [600, 300], [400, 500], [200, 300]]);
    for (const k of kids(r, 'g')) expect(worldBounds(r.doc, k)).toMatchObject({ width: 10, height: 40 });
  });

  it('radial: a partial sweep puts a copy at both ends; a center and negative sweep work', () => {
    const half = run([tick, { op: 'array', id: 'g', source: 'tick', kind: 'radial', count: 3, sweep: 180 }]);
    expectPoints(centers(half, 'g'), [[400, 100], [600, 300], [400, 500]]);
    const back = run([tick, { op: 'array', id: 'g', source: 'tick', kind: 'radial', count: 3, sweep: -180, center: [400, '50%'] }]);
    expectPoints(centers(back, 'g'), [[400, 100], [200, 300], [400, 500]]);
  });

  it('rejects missing, stray and conflicting fields, and too many copies', () => {
    for (const call of [
      { kind: 'grid', rows: 2 },
      { kind: 'grid', cols: 2 },
      { kind: 'radial' },
      { kind: 'grid', rows: 2, cols: 2, count: 3 },
      { kind: 'radial', count: 3, rows: 2 },
      { kind: 'grid', rows: 2, cols: 2, gap: [1, 1], spacing: [60, 40] },
    ]) {
      const r = run([tile, { op: 'array', source: 'tile', ...call }]);
      expect(r.results[1], JSON.stringify(call)).toMatchObject({ status: 'error', error: { code: 'invalid_input' } });
      expect(error(r).hint.length).toBeGreaterThan(10);
    }
    for (const call of [{ kind: 'radial', count: 1 }, { kind: 'radial', count: 3, sweep: 0 }, { kind: 'grid', rows: 0, cols: 2 }, { kind: 'ring' }]) {
      expect(run([tile, { op: 'array', source: 'tile', ...call }]).results[1], JSON.stringify(call)).toMatchObject({ status: 'error', error: { code: 'invalid_input' } });
    }
    const big = run([tile, { op: 'array', source: 'tile', kind: 'grid', rows: 4, cols: 4 }], undefined, { limits: { maxGenerated: 10 } });
    expect(big.results[1]).toMatchObject({ error: { code: 'limit_exceeded' } });
    const dense = run([tile, { op: 'array', source: 'tile', kind: 'grid', rows: 3, cols: 3 }], undefined, { limits: { maxNodes: 8 } });
    expect(error(dense).message).toContain('copies would bring');
  });
});
