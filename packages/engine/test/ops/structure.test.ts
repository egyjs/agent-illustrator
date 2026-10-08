import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/ops/index.ts';
import { executeBatch, type BatchResult } from '../../src/ops/registry.ts';
import { createDocument, type Doc, type GroupNode } from '../../src/scene/model.ts';
import { worldBounds } from '../../src/scene/query.ts';
import { expectIntact } from '../fixtures.ts';

const registry = createRegistry();
function run(ops: unknown[], doc: Doc = createDocument({ width: 800, height: 600 })): BatchResult {
  const r = executeBatch(registry, doc, ops);
  expectIntact(r.doc);
  return r;
}
const four = ['a', 'b', 'c', 'd'].map((id, i) => ({ op: 'rect', id, x: i * 20, y: 0, width: 10, height: 10 }));

describe('ops/style', () => {
  it('merges into the current style, unsets keys, and accepts $last', () => {
    const r = run([
      { op: 'rect', id: 'a', x: 0, y: 0, width: 10, height: 10, style: { fill: 'red', stroke: 'blue' } },
      { op: 'style', ids: ['a'], style: { fill: 'teal', strokeWidth: 2 }, unset: ['stroke'] },
      { op: 'rect', id: 'b', x: 0, y: 0, width: 10, height: 10 },
      { op: 'style', ids: ['$last'], style: { opacity: 0.5 } },
    ]);
    expect(r.doc.nodes.a!.style).toEqual({ fill: 'teal', strokeWidth: 2 });
    expect(r.doc.nodes.b!.style).toEqual({ opacity: 0.5 });
    expect(r.results[1]).toMatchObject({ status: 'ok', ids: ['a'] });
  });

  it('rejects unknown style keys and unknown colors', () => {
    expect(run([...four, { op: 'style', ids: ['a'], style: { color: 'red' } }]).results[4]).toMatchObject({ error: { code: 'invalid_input' } });
    expect(run([...four, { op: 'style', ids: ['a'], style: { fill: 'blurple' } }]).results[4]).toMatchObject({ error: { code: 'invalid_color' } });
  });
});

describe('ops/group', () => {
  it("group wraps siblings at the topmost member's z position, keeping their order", () => {
    const r = run([...four, { op: 'group', id: 'pair', ids: ['d', 'b'] }]);
    expect(r.doc.root).toEqual(['a', 'c', 'pair']);
    expect((r.doc.nodes.pair as GroupNode).children).toEqual(['b', 'd']);
    expect(r.doc.nodes.b!.parent).toBe('pair');
    expect(r.results[4]).toMatchObject({ id: 'pair', bounds: { x: 20, y: 0, width: 50, height: 10 } });
    const low = run([...four, { op: 'group', id: 'low', ids: ['a', 'c'] }]);
    expect(low.doc.root).toEqual(['b', 'low', 'd']);
  });

  it('keeps world placement, so member bounds do not move', () => {
    const before = run(four).doc;
    const after = run([{ op: 'group', ids: ['b', 'c'] }], before).doc;
    expect(worldBounds(after, 'b')).toEqual(worldBounds(before, 'b'));
  });

  it('rejects members with different parents', () => {
    const r = run([...four, { op: 'group', id: 'g', ids: ['a'] }, { op: 'group', ids: ['a', 'b'] }]);
    expect(r.results[5]).toMatchObject({ error: { code: 'invalid_structure' } });
  });
});

describe('ops/delete', () => {
  it('removes nodes with their descendants', () => {
    const r = run([...four, { op: 'group', id: 'pair', ids: ['a', 'b'] }, { op: 'delete', ids: ['pair', 'c'] }]);
    expect(r.results[5]).toMatchObject({ ids: ['pair', 'a', 'b', 'c'] });
    expect(r.doc.root).toEqual(['d']);
    expect(Object.keys(r.doc.nodes)).toEqual(['d']);
  });

  it('tolerates a node already deleted along with its group', () => {
    const r = run([...four, { op: 'group', id: 'pair', ids: ['a', 'b'] }, { op: 'delete', ids: ['pair', 'a'] }]);
    expect(r.results[5]).toMatchObject({ status: 'ok', ids: ['pair', 'a', 'b'] });
  });
});

describe('ops: createRegistry', () => {
  it('registers the seven M2 ops, and every example runs and ends with its op', () => {
    expect(registry.names()).toEqual(['rect', 'ellipse', 'polygon', 'line', 'style', 'group', 'delete']);
    for (const def of registry.list()) {
      expect(def.examples.length).toBeGreaterThan(0);
      for (const example of def.examples) {
        expect(example.at(-1)?.op).toBe(def.name);
        expect(executeBatch(registry, createDocument({ width: 800, height: 600 }), example).ok).toBe(true);
      }
    }
  });
});
