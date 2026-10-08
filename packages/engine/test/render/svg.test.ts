import { castDraft, produce, type Draft } from 'immer';
import { describe, expect, it } from 'vitest';
import { translate } from '../../src/geometry/transform.ts';
import { createRegistry } from '../../src/ops/index.ts';
import { executeBatch } from '../../src/ops/registry.ts';
import { toSvg } from '../../src/render/svg.ts';
import { createDocument, type Doc, type PathNode } from '../../src/scene/model.ts';
import { docOf, pathNode } from '../fixtures.ts';

const registry = createRegistry();
const blank = () => createDocument({ width: 100, height: 50 });
function draw(ops: unknown[], doc: Doc = blank()): Doc {
  const r = executeBatch(registry, doc, ops);
  expect(r.ok).toBe(true);
  return r.doc;
}
const HEAD = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">';

describe('render/svg', () => {
  it('an empty document is the svg element alone, plus an optional background', () => {
    expect(toSvg(blank())).toBe(`${HEAD}</svg>`);
    expect(toSvg(createDocument({ width: 100, height: 50, background: '#fff' }))).toBe(`${HEAD}<rect width="100" height="50" fill="#ffffff"/></svg>`);
  });

  it('straight segments become L and the closing segment becomes Z', () => {
    const doc = draw([{ op: 'rect', id: 'box', x: 10, y: 10, width: 30, height: 20, style: { fill: 'teal' } }]);
    expect(toSvg(doc)).toBe(`${HEAD}<path id="box" d="M10 10 L40 10 L40 30 L10 30 Z" fill="#008080"/></svg>`);
  });

  it('curves become C, with numbers rounded to the precision', () => {
    const doc = draw([{ op: 'ellipse', id: 'dot', cx: 50, cy: 25, rx: 10 }]);
    expect(toSvg(doc)).toBe(
      `${HEAD}<path id="dot" d="M60 25 C60 30.523 55.523 35 50 35 C44.477 35 40 30.523 40 25 C40 19.477 44.477 15 50 15 C55.523 15 60 19.477 60 25 Z"/></svg>`,
    );
    expect(toSvg(doc, { precision: 1 })).toContain('C60 30.5 55.5 35 50 35');
  });

  it('groups nest, transforms print as matrix(), style attributes come in a fixed order', () => {
    const doc = draw([
      { op: 'line', id: 'l', x1: 0, y1: 0, x2: 10, y2: 10, style: { opacity: 0.5, strokeDash: [4, 2], strokeCap: 'round', strokeWidth: 2 } },
      { op: 'group', id: 'g', ids: ['l'] },
    ]);
    const moved = produce(doc, (d) => {
      d.nodes.g!.transform = castDraft(translate(5, 5));
    });
    expect(toSvg(moved)).toBe(
      `${HEAD}<g id="g" transform="matrix(1 0 0 1 5 5)"><path id="l" d="M0 0 L10 10" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-dasharray="4 2" opacity="0.5"/></g></svg>`,
    );
  });

  it('resolves tokens, keeps translucency, writes evenodd', () => {
    const doc: Doc = { ...blank(), tokens: { 'palette.primary': '#E76F51' } };
    const drawn = draw([{ op: 'rect', id: 'a', x: 0, y: 0, width: 10, height: 10, style: { fill: 'palette.primary', stroke: 'rgb(0 0 0 / 25%)' } }], doc);
    const odd = produce(drawn, (d) => {
      (d.nodes.a as Draft<PathNode>).fillRule = 'evenodd';
    });
    expect(toSvg(odd)).toBe(`${HEAD}<path id="a" d="M0 0 L10 0 L10 10 L0 10 Z" fill-rule="evenodd" fill="#e76f51" stroke="rgba(0, 0, 0, 0.25)"/></svg>`);
  });

  it('prints negative zero as 0 and leaves out paints that no longer resolve', () => {
    const doc = docOf([pathNode('p', [{ start: [-0.0001, 0], segs: [[5, 0, 5, 0, 5, 0]], closed: false }], { style: { fill: 'palette.gone' } })]);
    expect(toSvg(doc)).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><path id="p" d="M0 0 L5 0"/></svg>');
  });
});
