import { describe, expect, it } from 'vitest';
import { createDocument, integrityProblem, isValidId, validateDocument } from '../../src/scene/model.ts';
import { docOf, expectCode, groupNode, pathNode } from '../fixtures.ts';
import { square } from '../geometry/helpers.ts';

describe('scene/model: ids', () => {
  it('accepts semantic ids and rejects unusable ones', () => {
    for (const id of ['sky', 'tree_1', 'Hill.left', 'a-b', '_x', 'x'.repeat(64)]) expect(isValidId(id)).toBe(true);
    for (const id of ['', '1tree', 'has space', 'canvas', '$last', '__proto__', 'constructor', 'toString', 'x'.repeat(65)]) {
      expect(isValidId(id)).toBe(false);
    }
  });
});

describe('scene/model: createDocument', () => {
  it('creates an empty document with defaults', () => {
    expect(createDocument({ width: 800, height: 600 })).toEqual({
      schema: 1,
      seed: 1,
      canvas: { width: 800, height: 600 },
      tokens: {},
      nodes: {},
      root: [],
    });
    const doc = createDocument({ width: 10, height: 20, background: '#fff', seed: 42 });
    expect(doc.canvas).toEqual({ width: 10, height: 20, background: '#fff' });
    expect(doc.seed).toBe(42);
  });

  it.each([
    [{ width: 0, height: 10 }, 'invalid_input'],
    [{ width: 10, height: Number.NaN }, 'invalid_input'],
    [{ width: 20_000, height: 10 }, 'invalid_input'],
    [{ width: 10, height: 10, seed: 1.5 }, 'invalid_input'],
    [{ width: 10, height: 10, background: 'blurple' }, 'invalid_color'],
  ])('rejects %o with %s', (input, code) => {
    expectCode(() => createDocument(input), code);
  });
});

describe('scene/model: validateDocument', () => {
  const valid = docOf([groupNode('g', ['p']), pathNode('p', [square(0, 0, 10)], { parent: 'g' })]);

  it('accepts a valid document and its JSON round trip', () => {
    expect(integrityProblem(valid)).toBeNull();
    expect(validateDocument(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });

  it.each([
    ['a node key that differs from its id', { ...valid, nodes: { ...valid.nodes, q: valid.nodes.p } }],
    ['a listed child that does not exist', { ...valid, root: ['g', 'ghost'] }],
    ['a parent link that disagrees with the list', { ...valid, nodes: { ...valid.nodes, p: { ...valid.nodes.p!, parent: null } } }],
    ['a node listed twice', { ...valid, root: ['g', 'p'] }],
    ['a node nobody lists', { ...valid, root: [] }],
    ['an unknown schema version', { ...valid, schema: 2 }],
    ['an unusable id', { ...valid, root: ['g'], nodes: { ...valid.nodes, constructor: pathNode('constructor', []) } }],
    ['an unknown style key', { ...valid, nodes: { ...valid.nodes, p: { ...valid.nodes.p!, style: { color: 'red' } } } }],
    ['a token that is not a color', { ...valid, tokens: { brand: 'not-a-color' } }],
    ['a fill that is neither a color nor a token', { ...valid, nodes: { ...valid.nodes, p: { ...valid.nodes.p!, style: { fill: 'blurple' } } } }],
    ['a background that does not resolve', { ...valid, canvas: { width: 800, height: 600, background: 'palette.bg' } }],
  ])('rejects %s', (_, doc) => {
    expectCode(() => validateDocument(doc), 'invalid_document');
  });
});
