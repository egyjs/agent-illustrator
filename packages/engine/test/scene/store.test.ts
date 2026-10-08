import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import type { EngineError } from '../../src/errors.ts';
import { createDocument, type GroupNode } from '../../src/scene/model.ts';
import { detach, DocumentStore, insertNode, removeSubtree } from '../../src/scene/store.ts';
import { docOf, expectCode, expectIntact, groupNode, pathNode } from '../fixtures.ts';
import { square } from '../geometry/helpers.ts';

const base = docOf(
  [groupNode('g', ['a']), pathNode('a', [square(0, 0, 10)], { parent: 'g' }), pathNode('b', [square(20, 0, 10)])],
  ['g', 'b'],
);

describe('scene/store: tree edits on drafts', () => {
  it('insertNode adds on top by default, or at an index, in root or a group', () => {
    const next = produce(base, (d) => {
      insertNode(d, pathNode('c', []));
      insertNode(d, pathNode('d', []), 0);
      insertNode(d, pathNode('e', [], { parent: 'g' }));
    });
    expect(next.root).toEqual(['d', 'g', 'b', 'c']);
    expect((next.nodes.g as GroupNode).children).toEqual(['a', 'e']);
    expectIntact(next);
    expect(base.root).toEqual(['g', 'b']);
  });

  it('insertNode under a non-group throws invalid_structure and the base stays untouched', () => {
    expectCode(() => produce(base, (d) => insertNode(d, pathNode('x', [], { parent: 'b' }))), 'invalid_structure');
    expect(Object.keys(base.nodes)).toEqual(['g', 'a', 'b']);
  });

  it('removeSubtree deletes a group with its descendants, parents first', () => {
    let removed: string[] = [];
    const next = produce(base, (d) => {
      removed = removeSubtree(d, 'g');
    });
    expect(removed).toEqual(['g', 'a']);
    expect(Object.keys(next.nodes)).toEqual(['b']);
    expect(next.root).toEqual(['b']);
    expectIntact(next);
  });

  it('detach reports the former parent and index', () => {
    produce(base, (d) => {
      expect(detach(d, 'b')).toEqual({ parent: null, index: 1 });
      expect(detach(d, 'a')).toEqual({ parent: 'g', index: 0 });
    });
  });
});

describe('scene/store: DocumentStore', () => {
  it('checkpoints are references to immutable versions', () => {
    const v1 = createDocument({ width: 10, height: 10 });
    const store = new DocumentStore(v1);
    store.checkpoint('start');
    const v2 = produce(v1, (d) => {
      d.seed = 7;
    });
    store.commit(v2);
    expect(store.doc).toBe(v2);
    expect(store.restore('start')).toBe(v1);
    expect(store.doc).toBe(v1);
    expect(store.checkpoints()).toEqual(['start']);
  });

  it('restoring an unknown checkpoint names the known ones', () => {
    const store = new DocumentStore(createDocument({ width: 10, height: 10 }));
    store.checkpoint('first-pass');
    const e: EngineError = expectCode(() => store.restore('second'), 'unknown_id');
    expect(e.hint).toContain('first-pass');
  });
});
