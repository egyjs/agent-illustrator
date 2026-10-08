import { describe, expect, it } from 'vitest';
import { IDENTITY } from '../../src/geometry/transform.ts';
import { createDocument, integrityProblem, isValidId, textContentProblem, validateDocument } from '../../src/scene/model.ts';
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
      defs: {},
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

  it('applies the text ops\' content rules to text nodes', () => {
    const withText = (content: string) =>
      docOf([
        {
          id: 't',
          type: 'text',
          parent: null,
          transform: IDENTITY,
          style: {},
          content,
          font: { family: 'Tajawal', size: 24, weight: 400, letterSpacing: 0 },
          anchor: 'start',
          direction: 'ltr',
          lineHeight: 1.2,
          at: { kind: 'point', x: 0, y: 0 },
          ink: null,
        },
      ]);
    expect(validateDocument(JSON.parse(JSON.stringify(withText('Line one\nمرحبا')))).nodes.t).toMatchObject({ content: 'Line one\nمرحبا' });
    for (const bad of ['a\u0000b', '   ', 'lone \ud800 surrogate']) {
      expectCode(() => validateDocument(JSON.parse(JSON.stringify(withText(bad)))), 'invalid_document');
    }
  });
});

describe('scene/model: textContentProblem', () => {
  it('names the problem, or is null for drawable text', () => {
    expect(textContentProblem('Hello\nworld')).toBeNull();
    expect(textContentProblem(' \n\t ')).toContain('visible');
    expect(textContentProblem('a\u0001')).toContain('control characters');
    expect(textContentProblem('\ud800')).toContain('unpaired surrogates');
  });
});
