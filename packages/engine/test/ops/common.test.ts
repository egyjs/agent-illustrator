import { castDraft, produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { signedArea } from '../../src/geometry/flatten.ts';
import { rotate, scale, translate } from '../../src/geometry/transform.ts';
import { anchorPoint, applyWorld, shapeOf, topmost } from '../../src/ops/common.ts';
import { defineOp, executeBatch, Registry } from '../../src/ops/registry.ts';
import { worldBounds } from '../../src/scene/query.ts';
import { docOf, groupNode, pathNode } from '../fixtures.ts';
import { square } from '../geometry/helpers.ts';

const box = { x: 10, y: 20, width: 100, height: 50 };
/** A test op that runs one helper with a live OpContext. */
const probe = (fn: Parameters<typeof defineOp>[0]['handler']) =>
  new Registry().register(defineOp({ name: 'probe', domain: 'test', description: '', schema: z.strictObject({}), examples: [], handler: fn }));

describe('ops/common', () => {
  it('anchorPoint covers the 9 anchors', () => {
    expect(anchorPoint(box, 'top-left')).toEqual([10, 20]);
    expect(anchorPoint(box, 'top')).toEqual([60, 20]);
    expect(anchorPoint(box, 'right')).toEqual([110, 45]);
    expect(anchorPoint(box, 'center')).toEqual([60, 45]);
    expect(anchorPoint(box, 'bottom-right')).toEqual([110, 70]);
  });

  it('applyWorld moves a node by canvas units even inside a scaled, rotated group', () => {
    const doc = docOf([
      groupNode('g', ['p'], { transform: rotate(30, 0, 0) }),
      pathNode('p', [square(0, 0, 10)], { parent: 'g', transform: scale(2) }),
    ]);
    const before = worldBounds(doc, 'p')!;
    const r = executeBatch(probe((_, ctx) => (applyWorld(ctx, 'p', translate(7, -3)), { id: 'p' })), doc, [{ op: 'probe' }]);
    const after = worldBounds(r.doc, 'p')!;
    expect(after.x - before.x).toBeCloseTo(7, 9);
    expect(after.y - before.y).toBeCloseTo(-3, 9);
    expect(after.width).toBeCloseTo(before.width, 9);
  });

  it('shapeOf returns canvas-space geometry; a group is the union of its paths', () => {
    const doc = docOf([
      groupNode('g', ['a', 'b'], { transform: translate(100, 0) }),
      pathNode('a', [square(0, 0, 10)], { parent: 'g' }),
      pathNode('b', [square(5, 5, 10)], { parent: 'g' }),
    ]);
    let area = 0, x = 0;
    executeBatch(
      probe((_, ctx) => {
        const s = shapeOf(ctx, 'g');
        area = signedArea(s.subpaths);
        x = Math.min(...s.subpaths.map((sp) => sp.start[0]));
        return {};
      }),
      doc,
      [{ op: 'probe' }],
    );
    expect(area).toBeCloseTo(175, 6);
    expect(x).toBeGreaterThanOrEqual(100);
  });

  it('topmost drops nodes whose ancestor is also selected', () => {
    const doc = docOf([groupNode('g', ['p']), pathNode('p', [], { parent: 'g' }), pathNode('q', [])]);
    let kept: string[] = [];
    executeBatch(probe((_, ctx) => ((kept = topmost(ctx, ['p', 'g', 'q'])), {})), doc, [{ op: 'probe' }]);
    expect(kept).toEqual(['g', 'q']);
  });

  it('newId can release ids that the op is about to delete, and can stay quiet', () => {
    const doc = docOf([pathNode('a', [])]);
    const ids: string[] = [];
    const r = executeBatch(
      probe((_, ctx) => {
        ids.push(ctx.newId('a', 'x', { releasing: new Set(['a']) }), ctx.newId('a', 'x', { quiet: true }));
        return {};
      }),
      doc,
      [{ op: 'probe' }],
    );
    expect(ids).toEqual(['a', 'a-2']);
    expect(r.results[0]).toMatchObject({ warnings: [] });
  });

  it('a produce on a fresh doc still sees the moved transform (sanity for castDraft use)', () => {
    const moved = produce(docOf([pathNode('p', [square(0, 0, 1)])]), (d) => {
      d.nodes.p!.transform = castDraft(translate(1, 1));
    });
    expect(worldBounds(moved, 'p')).toEqual({ x: 1, y: 1, width: 1, height: 1 });
  });
});
