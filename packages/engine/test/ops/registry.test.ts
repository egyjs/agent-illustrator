import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { polyline } from '../../src/geometry/paths.ts';
import { IDENTITY } from '../../src/geometry/transform.ts';
import { defineOp, executeBatch, Length, Registry, type OpOutcome } from '../../src/ops/registry.ts';
import { createDocument, type Doc } from '../../src/scene/model.ts';
import { insertNode } from '../../src/scene/store.ts';
import { expectCode, expectIntact } from '../fixtures.ts';

/** Test op: a square of side `size` with its top-left corner at (x, y). */
const box = defineOp({
  name: 'box',
  domain: 'test',
  description: 'a test square',
  schema: z.strictObject({ id: z.string().optional(), x: Length, y: Length, size: z.number().positive(), fill: z.string().optional() }),
  examples: [[{ op: 'box', x: 0, y: 0, size: 10 }]],
  handler(input, ctx) {
    const x = ctx.len(input.x, 'x'), y = ctx.len(input.y, 'y'), s = input.size;
    const style = ctx.style(input.fill === undefined ? undefined : { fill: input.fill });
    const id = ctx.newId(input.id, 'box');
    const subpaths = [polyline([[x, y], [x + s, y], [x + s, y + s], [x, y + s]], true)];
    ctx.update((d) => insertNode(d, { id, type: 'path', parent: null, transform: IDENTITY, style, fillRule: 'nonzero', subpaths }));
    return { id };
  },
});
const touch = defineOp({
  name: 'touch',
  domain: 'test',
  description: 'resolves a reference',
  schema: z.strictObject({ ref: z.string() }),
  examples: [],
  handler(input, ctx) {
    return { ids: [ctx.node(input.ref).id] };
  },
});
const crash = defineOp({
  name: 'crash',
  domain: 'test',
  description: 'throws a non-engine error',
  schema: z.strictObject({}),
  examples: [],
  handler() {
    throw new TypeError('boom');
  },
});

const registry = new Registry().register(box, touch, crash);
const fresh = (): Doc => createDocument({ width: 800, height: 600 });
const statuses = (results: readonly OpOutcome[]) => results.map((o) => o.status);
const square = (id: string, x = 0) => ({ op: 'box', id, x, y: 0, size: 5 });

describe('ops/registry: executeBatch', () => {
  it('applies a valid batch and reports ids, exact bounds and warnings', () => {
    const r = executeBatch(registry, fresh(), [{ op: 'box', id: 'a', x: 10, y: 20, size: 5 }]);
    expect(r.ok).toBe(true);
    expect(r.committed).toBe(true);
    expect(r.results).toEqual([{ op: 'box', status: 'ok', id: 'a', bounds: { x: 10, y: 20, width: 5, height: 5 }, warnings: [] }]);
    expect(Object.keys(r.doc.nodes)).toEqual(['a']);
    expectIntact(r.doc);
  });

  it('validates every op before applying any', () => {
    const doc = fresh();
    const r = executeBatch(registry, doc, [square('a'), { op: 'box', x: 'ten', y: 0, size: 5 }, { op: 'nope' }, 'not an op']);
    expect(r.ok).toBe(false);
    expect(r.doc).toBe(doc);
    expect(statuses(r.results)).toEqual(['skipped', 'error', 'error', 'error']);
    expect(r.results[1]).toMatchObject({ error: { code: 'invalid_input' } });
    expect(r.results[2]).toMatchObject({ error: { code: 'unknown_op' } });
    expect(r.results[3]).toMatchObject({ op: '?', error: { code: 'invalid_input' } });
  });

  it('rolls back the whole batch when an op fails mid-way', () => {
    const doc = fresh();
    const r = executeBatch(registry, doc, [square('a'), square('b', 10), { op: 'touch', ref: 'missing' }, square('c', 20)]);
    expect(r.ok).toBe(false);
    expect(r.committed).toBe(false);
    expect(r.doc).toBe(doc);
    expect(statuses(r.results)).toEqual(['rolled_back', 'rolled_back', 'error', 'skipped']);
    expect(r.results[2]).toMatchObject({ error: { code: 'unknown_id' } });
    expect(r.lastCreated).toBeUndefined();
  });

  it('wraps unexpected exceptions as internal_error and rolls back', () => {
    const doc = fresh();
    const r = executeBatch(registry, doc, [square('a'), { op: 'crash' }]);
    expect(r.doc).toBe(doc);
    expect(r.results[1]).toMatchObject({ status: 'error', error: { code: 'internal_error', message: 'boom' } });
  });

  it('$last is the most recent node, and carries across batches through lastCreated', () => {
    const r1 = executeBatch(registry, fresh(), [square('a'), { op: 'touch', ref: '$last' }]);
    expect(r1.results[1]).toMatchObject({ status: 'ok', ids: ['a'] });
    expect(r1.lastCreated).toBe('a');
    const r2 = executeBatch(registry, r1.doc, [{ op: 'touch', ref: '$last' }], { lastCreated: r1.lastCreated });
    expect(r2.results[0]).toMatchObject({ ids: ['a'] });
    const r3 = executeBatch(registry, fresh(), [{ op: 'touch', ref: '$last' }]);
    expect(r3.results[0]).toMatchObject({ error: { code: 'invalid_reference' } });
  });

  it('suffixes taken ids with a warning and generates ids when none is given', () => {
    const r = executeBatch(registry, fresh(), [square('a'), square('a'), { op: 'box', x: 0, y: 0, size: 1 }, { op: 'box', x: 0, y: 0, size: 1 }]);
    expect(r.results.map((o) => ('id' in o ? o.id : undefined))).toEqual(['a', 'a-2', 'box-1', 'box-2']);
    expect(r.results[1]).toMatchObject({ warnings: [{ code: 'id_renamed' }] });
  });

  it('rejects unusable ids', () => {
    for (const id of ['constructor', '__proto__', 'canvas', '9lives']) {
      expect(executeBatch(registry, fresh(), [square(id)]).results[0]).toMatchObject({ error: { code: 'invalid_input' } });
    }
  });

  it('resolves percent lengths against the canvas', () => {
    const r = executeBatch(registry, fresh(), [{ op: 'box', x: '50%', y: '25%', size: 10 }]);
    expect(r.results[0]).toMatchObject({ bounds: { x: 400, y: 150, width: 10, height: 10 } });
  });

  it('a dry run reports results without committing', () => {
    const doc = fresh();
    const r = executeBatch(registry, doc, [square('a')], { dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.committed).toBe(false);
    expect(r.doc).toBe(doc);
    expect(r.results[0]).toMatchObject({ status: 'ok', id: 'a' });
  });

  it('enforces the batch-size and node-count limits', () => {
    expectCode(() => executeBatch(registry, fresh(), [square('a'), square('b'), square('c')], { limits: { maxOpsPerBatch: 2 } }), 'limit_exceeded');
    const r = executeBatch(registry, fresh(), [square('a'), square('b')], { limits: { maxNodes: 1 } });
    expect(statuses(r.results)).toEqual(['rolled_back', 'error']);
    expect(r.results[1]).toMatchObject({ error: { code: 'limit_exceeded' } });
  });

  it('checks paints: colors and existing tokens pass, anything else fails and lists the tokens', () => {
    const doc: Doc = { ...fresh(), tokens: { 'palette.primary': '#e76f51' } };
    expect(executeBatch(registry, doc, [{ op: 'box', x: 0, y: 0, size: 5, fill: 'palette.primary' }]).ok).toBe(true);
    const bad = executeBatch(registry, doc, [{ op: 'box', x: 0, y: 0, size: 5, fill: 'palette.nope' }]);
    expect(bad.results[0]).toMatchObject({ error: { code: 'invalid_color' } });
    expect(JSON.stringify(bad.results[0])).toContain('palette.primary');
  });

  it('an unknown op gets a did-you-mean hint', () => {
    const r = executeBatch(registry, fresh(), [{ op: 'bx' }]);
    expect(JSON.stringify(r.results[0])).toContain('\\"box\\"');
  });
});

describe('ops/registry: Registry', () => {
  it('refuses to register two ops with one name', () => {
    expect(() => new Registry().register(box, box)).toThrow('registered twice');
    expect(registry.names()).toEqual(['box', 'touch', 'crash']);
  });
});
