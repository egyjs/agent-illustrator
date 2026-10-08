import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import type { EngineError } from '../../src/errors.ts';
import { createDocument, type Doc, type GroupNode } from '../../src/scene/model.ts';
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

  it('checkpoint labels are 1-64 characters of letters, digits, "_", "-" and "."', () => {
    const store = new DocumentStore(createDocument({ width: 10, height: 10 }));
    for (const ok of ['a', 'before-sky', 'v1.2_final', 'x'.repeat(64)]) store.checkpoint(ok);
    for (const bad of ['', 'two words', 'x'.repeat(65), 'a/b', 'é']) expectCode(() => store.checkpoint(bad), 'invalid_input');
    expect(store.checkpoints()).toHaveLength(4);
  });

  it('keeps at most 50 checkpoints; saving a label again replaces it, a 51st label is limit_exceeded', () => {
    const v1 = createDocument({ width: 10, height: 10 });
    const store = new DocumentStore(v1);
    for (let i = 0; i < 50; i++) store.checkpoint(`c${i}`);
    const v2 = produce(v1, (d) => {
      d.seed = 7;
    });
    store.commit(v2);
    store.checkpoint('c0');
    expect(store.restore('c0')).toBe(v2);
    const e: EngineError = expectCode(() => store.checkpoint('one-more'), 'limit_exceeded');
    expect(e.hint).toContain('c49');
    expect(store.checkpoints()).toHaveLength(50);
  });
});

describe('scene/store: undo', () => {
  const v1 = createDocument({ width: 10, height: 10 });
  const next = (doc: Doc, seed: number) =>
    produce(doc, (d) => {
      d.seed = seed;
    });

  it('commit keeps the version it replaces, and undo walks back through them', () => {
    const store = new DocumentStore(v1);
    expect(store.undoDepth).toBe(0);
    const v2 = next(v1, 2);
    const v3 = next(v2, 3);
    store.commit(v2);
    store.commit(v3);
    expect(store.undoDepth).toBe(2);
    expect(store.undo()).toBe(v2);
    expect(store.undo()).toBe(v1);
    expect(store.doc).toBe(v1);
    expect(store.undoDepth).toBe(0);
  });

  it('committing the current version again is not a change', () => {
    const store = new DocumentStore(v1);
    store.commit(v1);
    expect(store.undoDepth).toBe(0);
  });

  it('undo with nothing to go back to is invalid_input with a hint', () => {
    const store = new DocumentStore(v1);
    const e: EngineError = expectCode(() => store.undo(), 'invalid_input');
    expect(e.message).toBe('nothing to undo');
    expect(e.hint).not.toBe('');
    expect(store.doc).toBe(v1);
  });

  it('keeps the last 50 versions and drops the oldest', () => {
    const store = new DocumentStore(v1);
    const versions = [v1];
    for (let i = 1; i <= 60; i++) {
      versions.push(next(versions[i - 1]!, i));
      store.commit(versions[i]!);
    }
    expect(store.undoDepth).toBe(50);
    for (let i = 59; i >= 10; i--) expect(store.undo()).toBe(versions[i]);
    expectCode(() => store.undo(), 'invalid_input');
    expect(store.doc).toBe(versions[10]);
  });

  it('restore puts the replaced version on the undo stack, so a restore can be undone', () => {
    const store = new DocumentStore(v1);
    store.checkpoint('start');
    const v2 = next(v1, 2);
    store.commit(v2);
    expect(store.restore('start')).toBe(v1);
    expect(store.undoDepth).toBe(2);
    expect(store.undo()).toBe(v2);
  });

  it('a failed restore changes nothing', () => {
    const store = new DocumentStore(v1);
    store.commit(next(v1, 2));
    expectCode(() => store.restore('nope'), 'unknown_id');
    expect(store.undoDepth).toBe(1);
  });
});
