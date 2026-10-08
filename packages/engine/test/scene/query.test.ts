import { castDraft, produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyToPoint, rotate, scale, translate } from '../../src/geometry/transform.ts';
import { getNode, requireNode, siblings, subtreeIds, worldBounds, worldTransform } from '../../src/scene/query.ts';
import { docOf, expectCode, groupNode, pathNode } from '../fixtures.ts';
import { expectVec, square } from '../geometry/helpers.ts';

const nested = docOf([
  groupNode('g', ['h'], { transform: translate(10, 0) }),
  groupNode('h', ['p'], { parent: 'g', transform: scale(2) }),
  pathNode('p', [square(0, 0, 10)], { parent: 'h', transform: translate(1, 1) }),
]);

describe('scene/query: world transforms', () => {
  it('composes world = parent world · local', () => {
    expectVec(applyToPoint(worldTransform(nested, 'p'), [0, 0]), [12, 2]);
    expect(worldTransform(nested, 'g')).toBe(nested.nodes.g!.transform);
  });

  it('caches per node object but follows a changed ancestor', () => {
    expect(worldTransform(nested, 'p')).toBe(worldTransform(nested, 'p'));
    const moved = produce(nested, (d) => {
      d.nodes.g!.transform = castDraft(translate(100, 0));
    });
    expect(moved.nodes.p).toBe(nested.nodes.p); // structural sharing: p itself is unchanged
    expectVec(applyToPoint(worldTransform(moved, 'p'), [0, 0]), [102, 2]);
    expect(worldBounds(moved, 'p')).toEqual({ x: 102, y: 2, width: 20, height: 20 });
    expect(worldBounds(nested, 'p')).toEqual({ x: 12, y: 2, width: 20, height: 20 });
  });
});

describe('scene/query: world bounds', () => {
  it('are exact under rotation', () => {
    const doc = docOf([pathNode('p', [square(0, 0, 10)], { transform: rotate(45, 5, 5) })]);
    const b = worldBounds(doc, 'p')!;
    expect(b.width).toBeCloseTo(10 * Math.SQRT2, 9);
    expect(b.x).toBeCloseTo(5 - 5 * Math.SQRT2, 9);
  });

  it("union a group's children; empty groups and empty paths have none", () => {
    const doc = docOf([
      groupNode('g', ['a', 'b']),
      pathNode('a', [square(0, 0, 10)], { parent: 'g' }),
      pathNode('b', [square(20, 5, 10)], { parent: 'g' }),
      groupNode('empty', []),
      pathNode('blank', []),
    ]);
    expect(worldBounds(doc, 'g')).toEqual({ x: 0, y: 0, width: 30, height: 15 });
    expect(worldBounds(doc, 'empty')).toBeNull();
    expect(worldBounds(doc, 'blank')).toBeNull();
  });
});

describe('scene/query: lookup', () => {
  it('requireNode explains unknown ids and never returns prototype members', () => {
    const doc = docOf([pathNode('circle', [])]);
    expect(expectCode(() => requireNode(doc, 'ciricle'), 'unknown_id').hint).toContain('"circle"');
    expect(getNode(doc, 'constructor')).toBeUndefined();
    expect(getNode(doc, 'toString')).toBeUndefined();
    expectCode(() => requireNode(doc, '__proto__'), 'unknown_id');
  });

  it('subtreeIds lists a node and its descendants, parents first; siblings is the owning list', () => {
    expect(subtreeIds(nested, 'g')).toEqual(['g', 'h', 'p']);
    expect(siblings(nested, nested.nodes.p!)).toEqual(['p']);
    expect(siblings(nested, nested.nodes.g!)).toEqual(['g']);
  });
});
