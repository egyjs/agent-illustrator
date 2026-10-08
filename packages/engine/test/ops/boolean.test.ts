import { describe, expect, it } from 'vitest';
import { signedArea } from '../../src/geometry/flatten.ts';
import { translate, scale } from '../../src/geometry/transform.ts';
import { boolean } from '../../src/ops/boolean.ts';
import { executeBatch, Registry, type BatchResult } from '../../src/ops/registry.ts';
import { ellipse, rect } from '../../src/ops/shapes.ts';
import { group } from '../../src/ops/structure.ts';
import { createDocument, type Doc, type PathNode } from '../../src/scene/model.ts';
import { docOf, expectIntact, groupNode, pathNode } from '../fixtures.ts';
import { KAPPA_CIRCLE_AREA, kappaCircle, square } from '../geometry/helpers.ts';

const registry = new Registry().register(rect, ellipse, group, boolean);
function run(ops: unknown[], doc: Doc = createDocument({ width: 800, height: 600 })): BatchResult {
  const r = executeBatch(registry, doc, ops);
  expectIntact(r.doc);
  return r;
}
const two = [
  { op: 'rect', id: 'a', x: 0, y: 0, width: 10, height: 10 },
  { op: 'rect', id: 'b', x: 5, y: 5, width: 10, height: 10 },
];

describe('ops/boolean', () => {
  it('union replaces the operands with one path at the first operand’s place', () => {
    const r = run([{ op: 'rect', id: 'under', x: 0, y: 0, width: 1, height: 1 }, ...two, { op: 'boolean', mode: 'union', ids: ['a', 'b'], id: 'u' }]);
    expect(r.doc.root).toEqual(['under', 'u']);
    expect(signedArea((r.doc.nodes.u as PathNode).subpaths)).toBeCloseTo(175, 6);
    expect(r.results[3]).toMatchObject({ id: 'u', bounds: { x: 0, y: 0, width: 15, height: 15 } });
  });

  it('subtract with keep leaves the operands and puts the result just above the first', () => {
    const r = run([...two, { op: 'boolean', mode: 'subtract', ids: ['a', 'b'], keep: true }]);
    expect(r.doc.root).toEqual(['a', 'boolean-1', 'b']);
    expect(signedArea((r.doc.nodes['boolean-1'] as PathNode).subpaths)).toBeCloseTo(75, 6);
  });

  it('may reuse the id of a consumed operand without a warning; inherits the first style', () => {
    const r = run([{ ...two[0], style: { fill: 'red' } }, two[1], { op: 'boolean', mode: 'intersect', ids: ['a', 'b'], id: 'a' }]);
    expect(r.results[2]).toMatchObject({ status: 'ok', id: 'a', warnings: [] });
    expect(r.doc.nodes.a!.style).toEqual({ fill: 'red' });
  });

  it('folds more than two operands left to right, and groups count as their union', () => {
    const r = run([...two, { op: 'rect', id: 'c', x: 20, y: 0, width: 10, height: 10 }, { op: 'group', id: 'g', ids: ['b', 'c'] }, { op: 'boolean', mode: 'union', ids: ['a', 'g'] }]);
    expect(signedArea((r.doc.nodes['boolean-1'] as PathNode).subpaths)).toBeCloseTo(275, 6);
  });

  it('works across transformed parents: the result lands in the first operand’s parent space', () => {
    const doc = docOf([
      groupNode('g', ['a'], { transform: translate(100, 0) }),
      pathNode('a', [square(0, 0, 10)], { parent: 'g' }),
      groupNode('h', ['b'], { transform: scale(2) }),
      pathNode('b', [square(52.5, 2.5, 5)], { parent: 'h' }),
    ]);
    const r = run([{ op: 'boolean', mode: 'union', ids: ['a', 'b'], id: 'u' }], doc);
    expect(r.doc.nodes.u!.parent).toBe('g');
    expect(r.results[0]).toMatchObject({ bounds: { x: 100, y: 0, width: 15, height: 15 } });
  });

  it('an empty result is a warning, not an error', () => {
    const r = run([...two, { op: 'rect', id: 'far', x: 500, y: 500, width: 5, height: 5 }, { op: 'boolean', mode: 'intersect', ids: ['a', 'far'] }]);
    expect(r.results[3]).toMatchObject({ status: 'ok', warnings: [{ code: 'empty_result' }] });
  });

  it('refuses an operand inside another operand, and fewer than two distinct operands', () => {
    expect(run([...two, { op: 'group', id: 'g', ids: ['a', 'b'] }, { op: 'boolean', mode: 'union', ids: ['g', 'a'] }]).results[3]).toMatchObject({ error: { code: 'invalid_structure' } });
    expect(run([...two, { op: 'boolean', mode: 'union', ids: ['a', 'a'] }]).results[2]).toMatchObject({ error: { code: 'invalid_input' } });
  });

  it('checks the new id in the validate-first pass, before any op runs', () => {
    const r = run([...two, { op: 'boolean', mode: 'union', ids: ['a', 'b'], id: '1bad' }]);
    expect(r.results.map((o) => o.status)).toEqual(['skipped', 'skipped', 'error']);
  });

  it('rejects a result longer than the segment limit and leaves the document alone', () => {
    const doc = createDocument({ width: 800, height: 600 });
    const r = executeBatch(registry, doc, [...two, { op: 'boolean', mode: 'union', ids: ['a', 'b'] }], { limits: { maxSegmentsPerPath: 5 } });
    expect(r.results[2]).toMatchObject({ status: 'error', error: { code: 'limit_exceeded' } });
    expect(r.doc).toBe(doc);
  });

  it('rejects inputs longer than the segment limit before running any boolean, even when the result is short', () => {
    // Identical squares: 12 segments go in, 4 come out.
    const doc = docOf([
      groupNode('g', ['a', 'b', 'c']),
      ...['a', 'b', 'c'].map((id) => pathNode(id, [square(0, 0, 10)], { parent: 'g' })),
      pathNode('o', [square(0, 0, 10)]),
    ]);
    const limits = { maxSegmentsPerPath: 8 };
    const inGroup = executeBatch(registry, doc, [{ op: 'boolean', mode: 'union', ids: ['g', 'o'] }], { limits });
    expect(inGroup.results[0]).toMatchObject({ status: 'error', error: { code: 'limit_exceeded', hint: expect.stringContaining('several booleans') } });
    expect(inGroup.doc).toBe(doc);
    const together = executeBatch(registry, doc, [{ op: 'boolean', mode: 'union', ids: ['a', 'b', 'c'] }], { limits });
    expect(together.results[0]).toMatchObject({ status: 'error', error: { code: 'limit_exceeded' } });
    expect(together.doc).toBe(doc);
  });

  it('a clipped operand counts only its visible part', () => {
    const disc = { subpaths: [kappaCircle(0, 0, 50)], fillRule: 'nonzero' } as const;
    const doc = docOf([pathNode('r', [square(0, 0, 100)], { clip: disc }), pathNode('s', [square(200, 200, 10)])]);
    const r = run([{ op: 'boolean', mode: 'union', ids: ['r', 's'], id: 'u' }], doc);
    expect(signedArea((r.doc.nodes.u as PathNode).subpaths) / ((KAPPA_CIRCLE_AREA * 50 * 50) / 4 + 100)).toBeCloseTo(1, 2);
  });

  describe('a group as the first operand', () => {
    it('keeps the look its paths have', () => {
      const white = { fill: '#ffffff' };
      const r = run([
        { op: 'ellipse', id: 'p1', cx: 100, cy: 100, rx: 40, style: white },
        { op: 'ellipse', id: 'p2', cx: 140, cy: 100, rx: 40, style: white },
        { op: 'group', id: 'cloud', ids: ['p1', 'p2'] },
        { op: 'ellipse', id: 'p3', cx: 200, cy: 100, rx: 40, style: { fill: '#ff0000' } },
        { op: 'boolean', mode: 'union', ids: ['cloud', 'p3'], id: 'u' },
      ]);
      expect(r.doc.nodes.u!.style).toEqual(white);
    });

    const hidden = pathNode('hidden', [square(0, 0, 10)], { parent: 'g', style: { fill: 'none' } });
    const other = pathNode('o', [square(40, 0, 10)]);

    it('takes the first painted path’s style, inherited from the group down, with opacities multiplied', () => {
      const doc = docOf([
        groupNode('g', ['hidden', 'inner'], { style: { fill: '#ff0000', opacity: 0.5 } }),
        hidden,
        groupNode('inner', ['leaf'], { parent: 'g', style: { stroke: '#000000' } }),
        pathNode('leaf', [square(20, 0, 10)], { parent: 'inner', style: { opacity: 0.5 } }),
        other,
      ]);
      const r = run([{ op: 'boolean', mode: 'union', ids: ['g', 'o'], id: 'u' }], doc);
      expect(r.doc.nodes.u!.style).toEqual({ fill: '#ff0000', stroke: '#000000', opacity: 0.25 });
    });

    it('falls back to its own style when no path paints, and yields to an explicit style', () => {
      const doc = docOf([groupNode('g', ['hidden'], { style: { opacity: 0.5 } }), hidden, other]);
      const ops = { op: 'boolean', mode: 'union', ids: ['g', 'o'], id: 'u' };
      expect(run([ops], doc).doc.nodes.u!.style).toEqual({ opacity: 0.5 });
      expect(run([{ ...ops, style: { fill: '#0000ff' } }], doc).doc.nodes.u!.style).toEqual({ fill: '#0000ff' });
    });
  });
});
