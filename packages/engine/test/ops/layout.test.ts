import { describe, expect, it } from 'vitest';
import { scale, translate } from '../../src/geometry/transform.ts';
import type { Box } from '../../src/geometry/types.ts';
import { align, distribute, place, snap } from '../../src/ops/layout.ts';
import { executeBatch, Registry, type BatchResult } from '../../src/ops/registry.ts';
import { rect } from '../../src/ops/shapes.ts';
import { createDocument, type Doc } from '../../src/scene/model.ts';
import { worldBounds } from '../../src/scene/query.ts';
import { docOf, expectIntact, groupNode, pathNode } from '../fixtures.ts';
import { square } from '../geometry/helpers.ts';

const registry = new Registry().register(rect, place, align, distribute, snap);
function run(ops: unknown[], doc: Doc = createDocument({ width: 800, height: 600 })): BatchResult {
  const r = executeBatch(registry, doc, ops);
  expectIntact(r.doc);
  return r;
}
const box = (id: string, x: number, y: number, w = 20, h = 10) => ({ op: 'rect', id, x, y, width: w, height: h });
const at = (r: BatchResult, id: string) => worldBounds(r.doc, id) as Box;

describe('ops/layout: place', () => {
  it('places an anchor on the canvas with an offset', () => {
    const r = run([box('sun', 0, 0, 40, 40), { op: 'place', ids: ['sun'], relative_to: 'canvas', anchor: 'top-right', offset: [-20, 20] }]);
    expect(r.results[1]).toMatchObject({ id: 'sun', bounds: { x: 740, y: 20, width: 40, height: 40 } });
  });

  it('places relative to another node: my top sits on its bottom', () => {
    const r = run([box('a', 100, 100), box('b', 0, 0), { op: 'place', ids: ['b'], relative_to: 'a', anchor: 'top', target_anchor: 'bottom', offset: [0, 5] }]);
    expect(at(r, 'b')).toEqual({ x: 100, y: 115, width: 20, height: 10 });
  });

  it('place works for a child of a transformed group', () => {
    const doc = docOf([groupNode('g', ['p'], { transform: scale(2) }), pathNode('p', [square(0, 0, 10)], { parent: 'g', transform: translate(5, 5) })]);
    const r = run([{ op: 'place', ids: ['p'], relative_to: 'canvas', anchor: 'center' }], doc);
    const b = at(r, 'p');
    expect(b.x + b.width / 2).toBeCloseTo(400, 9);
    expect(b.y + b.height / 2).toBeCloseTo(300, 9);
  });

  it('rejects placing a node relative to itself', () => {
    expect(run([box('a', 0, 0), { op: 'place', ids: ['a'], relative_to: 'a' }]).results[1]).toMatchObject({ error: { code: 'invalid_input' } });
  });

  it('rejects a reference that moves along with the selection', () => {
    const doc = docOf([groupNode('g', ['p']), pathNode('p', [square(0, 0, 10)], { parent: 'g' })]);
    expect(run([{ op: 'place', ids: ['g'], relative_to: 'p' }], doc).results[0]).toMatchObject({ error: { code: 'invalid_input' } });
  });
});

describe('ops/layout: align and distribute', () => {
  it('aligns left edges and centers, to the selection or the canvas', () => {
    const r = run([box('a', 10, 0), box('b', 50, 30, 40), { op: 'align', ids: ['a', 'b'], edge: 'left' }]);
    expect([at(r, 'a').x, at(r, 'b').x]).toEqual([10, 10]);
    const c = run([box('a', 10, 0), { op: 'align', ids: ['a'], edge: 'center-x', to: 'canvas' }]);
    expect(at(c, 'a').x).toBe(390);
  });

  it('distributes equal gaps, keeping the outer nodes', () => {
    const r = run([box('a', 0, 0, 10), box('b', 15, 0, 30), box('c', 90, 0, 10), { op: 'distribute', ids: ['c', 'a', 'b'], axis: 'x' }]);
    expect([at(r, 'a').x, at(r, 'b').x, at(r, 'c').x]).toEqual([0, 35, 90]);
  });

  it('distributes centers evenly', () => {
    const r = run([box('a', 0, 0, 10), box('b', 5, 0, 30), box('c', 90, 0, 10), { op: 'distribute', ids: ['a', 'b', 'c'], axis: 'x', mode: 'center' }]);
    expect(at(r, 'b').x + 15).toBeCloseTo(50, 9);
  });
});

describe('ops/layout: snap', () => {
  it('snaps an edge to a nearby node edge within tolerance', () => {
    const r = run([box('wall', 100, 0, 10, 200), box('door', 113, 50), { op: 'snap', ids: ['door'] }]);
    expect(at(r, 'door').x).toBe(110);
  });

  it('snaps to the canvas and to a grid', () => {
    expect(at(run([box('a', 4, 300), { op: 'snap', ids: ['a'], to: ['canvas'] }]), 'a').x).toBe(0);
    expect(at(run([box('a', 23, 48), { op: 'snap', ids: ['a'], to: ['grid'], grid: 25 }]), 'a')).toMatchObject({ x: 25, y: 50 });
  });

  it('warns when nothing is within tolerance', () => {
    expect(run([box('a', 300, 300), { op: 'snap', ids: ['a'], tolerance: 2 }]).results[1]).toMatchObject({ warnings: [{ code: 'nothing_to_snap' }] });
  });

  it('snaps only to the listed targets', () => {
    const scene = [box('wall', 100, 0, 10, 200), box('post', 117, 0, 10, 200), box('door', 113, 50)];
    expect(at(run([...scene, { op: 'snap', ids: ['door'] }]), 'door').x).toBe(112);
    expect(at(run([...scene, { op: 'snap', ids: ['door'], targets: ['wall'] }]), 'door').x).toBe(110);
  });

  it("ignores the bounds of the moved node's own group", () => {
    const doc = docOf([groupNode('g', ['door']), pathNode('door', [square(113, 50, 10)], { parent: 'g' }), pathNode('wall', [square(90, 0, 20)])]);
    expect(at(run([{ op: 'snap', ids: ['door'] }], doc), 'door').x).toBe(110);
  });

  it('rejects options that would be silently ignored', () => {
    expect(run([box('a', 0, 0), { op: 'snap', ids: ['a'], to: ['grid'] }]).results[1]).toMatchObject({ error: { code: 'invalid_input' } });
    expect(run([box('a', 0, 0), { op: 'snap', ids: ['a'], grid: 10 }]).results[1]).toMatchObject({ error: { code: 'invalid_input' } });
    expect(run([box('a', 0, 0), box('b', 5, 5), { op: 'snap', ids: ['a'], to: ['canvas'], targets: ['b'] }]).results[2]).toMatchObject({ error: { code: 'invalid_input' } });
  });
});
