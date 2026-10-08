import { describe, expect, it } from 'vitest';
import { rotate as rot, scale as sc } from '../../src/geometry/transform.ts';
import type { Box } from '../../src/geometry/types.ts';
import { executeBatch, Registry, type BatchResult } from '../../src/ops/registry.ts';
import { rect } from '../../src/ops/shapes.ts';
import { group } from '../../src/ops/structure.ts';
import { transform } from '../../src/ops/transform.ts';
import { createDocument, type Doc } from '../../src/scene/model.ts';
import { worldBounds } from '../../src/scene/query.ts';
import { docOf, expectIntact, groupNode, pathNode } from '../fixtures.ts';
import { square } from '../geometry/helpers.ts';

const registry = new Registry().register(rect, group, transform);
function run(ops: unknown[], doc: Doc = createDocument({ width: 800, height: 600 })): BatchResult {
  const r = executeBatch(registry, doc, ops);
  expectIntact(r.doc);
  return r;
}
const bar = { op: 'rect', id: 'bar', x: 0, y: 0, width: 20, height: 10 };
const close = (b: Box | null, e: Box) => {
  for (const k of ['x', 'y', 'width', 'height'] as const) expect(b![k]).toBeCloseTo(e[k], 9);
};

describe('ops/transform', () => {
  it('translates by canvas units or percent', () => {
    const r = run([bar, { op: 'transform', ids: ['bar'], translate: [10, '1%'] }]);
    expect(r.results[1]).toMatchObject({ id: 'bar', bounds: { x: 10, y: 6, width: 20, height: 10 } });
  });

  it('rotates about the node center by default', () => {
    const r = run([bar, { op: 'transform', ids: ['bar'], rotate: 90 }]);
    close(worldBounds(r.doc, 'bar'), { x: 5, y: -5, width: 10, height: 20 });
  });

  it('scales about a named anchor or an explicit point', () => {
    close(worldBounds(run([bar, { op: 'transform', ids: ['bar'], scale: 2, pivot: 'top-left' }]).doc, 'bar'), { x: 0, y: 0, width: 40, height: 20 });
    close(worldBounds(run([bar, { op: 'transform', ids: ['bar'], scale: [1, -1], pivot: [0, 0] }]).doc, 'bar'), { x: 0, y: -10, width: 20, height: 10 });
  });

  it('around "selection" turns several nodes about their combined center', () => {
    const r = run([bar, { op: 'rect', id: 'b2', x: 30, y: 0, width: 10, height: 10 }, { op: 'transform', ids: ['bar', 'b2'], rotate: 180, around: 'selection' }]);
    close(worldBounds(r.doc, 'b2'), { x: 0, y: 0, width: 10, height: 10 });
    close(worldBounds(r.doc, 'bar'), { x: 20, y: 0, width: 20, height: 10 });
  });

  it('translates a child of a scaled group by canvas units', () => {
    const doc = docOf([groupNode('g', ['p'], { transform: sc(3) }), pathNode('p', [square(0, 0, 10)], { parent: 'g', transform: rot(15) })]);
    const before = worldBounds(doc, 'p')!;
    const after = worldBounds(run([{ op: 'transform', ids: ['p'], translate: [10, 0] }], doc).doc, 'p')!;
    expect(after.x - before.x).toBeCloseTo(10, 9);
    expect(after.width).toBeCloseTo(before.width, 9);
  });

  it('skips nodes whose ancestor is selected, with a warning; nothing to do is a warning', () => {
    const r = run([bar, { op: 'group', id: 'g', ids: ['bar'] }, { op: 'transform', ids: ['g', 'bar'], translate: [5, 0] }]);
    expect(worldBounds(r.doc, 'bar')!.x).toBeCloseTo(5, 9);
    expect(r.results[2]).toMatchObject({ warnings: [{ code: 'skipped_descendants' }] });
    expect(run([bar, { op: 'transform', ids: ['bar'] }]).results[1]).toMatchObject({ warnings: [{ code: 'no_change' }] });
  });

  it('rejects a zero scale', () => {
    expect(run([bar, { op: 'transform', ids: ['bar'], scale: 0 }]).results[1]).toMatchObject({ error: { code: 'invalid_input' } });
  });

  it('applies a matrix in canvas space and skews about the pivot', () => {
    close(worldBounds(run([bar, { op: 'transform', ids: ['bar'], matrix: [1, 0, 0, 1, 15, -5] }]).doc, 'bar'), { x: 15, y: -5, width: 20, height: 10 });
    close(worldBounds(run([bar, { op: 'transform', ids: ['bar'], skew: [45, 0] }]).doc, 'bar'), { x: -5, y: 0, width: 30, height: 10 });
  });

  it('reports the bounds of every moved node', () => {
    const r = run([bar, { op: 'rect', id: 'b2', x: 30, y: 0, width: 10, height: 10 }, { op: 'transform', ids: ['bar', 'b2'], translate: [0, 10] }]);
    expect(r.results[2]).toMatchObject({ ids: ['bar', 'b2'], boundsById: { bar: { y: 10 }, b2: { y: 10 } } });
  });

  it('rejects a matrix or skew that would flatten the node', () => {
    for (const bad of [{ matrix: [1, 0, 2, 0, 0, 0] }, { matrix: [0, 0, 0, 0, 5, 5] }, { skew: [90, 0] }, { skew: [0, -90] }]) {
      expect(run([bar, { op: 'transform', ids: ['bar'], ...bad }]).results[1]).toMatchObject({ error: { code: 'invalid_input', hint: expect.any(String) } });
    }
  });

  it('an explicit pivot needs no bounds; an anchor on a node that draws nothing is invalid_structure', () => {
    const doc = docOf([pathNode('empty', [])]);
    expect(run([{ op: 'transform', ids: ['empty'], rotate: 10, pivot: [5, 5] }], doc).results[0]).toMatchObject({ status: 'ok' });
    expect(run([{ op: 'transform', ids: ['empty'], rotate: 10 }], doc).results[0]).toMatchObject({ error: { code: 'invalid_structure' } });
  });
});
