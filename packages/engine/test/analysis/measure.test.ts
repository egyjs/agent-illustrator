import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { round2 } from '../../src/analysis/describe.ts';
import { measure, MAX_MEASURE_IDS, MAX_PAIR_IDS } from '../../src/analysis/measure.ts';
import { booleanOp } from '../../src/geometry/boolean.ts';
import { createRegistry } from '../../src/ops/index.ts';
import { executeBatch } from '../../src/ops/registry.ts';
import type { RasterFonts } from '../../src/render/raster.ts';
import { createDocument, type Doc } from '../../src/scene/model.ts';
import { worldBounds } from '../../src/scene/query.ts';
import { docOf, expectCode, groupNode } from '../fixtures.ts';

vi.mock('../../src/geometry/boolean.ts', async (importActual) => {
  const actual = await importActual<typeof import('../../src/geometry/boolean.ts')>();
  return { ...actual, booleanOp: vi.fn(actual.booleanOp) };
});

const font = (file: string) => fileURLToPath(new URL(`../../assets/fonts/${file}`, import.meta.url));
const fonts: RasterFonts = { files: [font('Tajawal-Regular.ttf'), font('Tajawal-Bold.ttf')], defaultFamily: 'Tajawal' };
const registry = createRegistry();

function build(ops: unknown[]): Doc {
  const r = executeBatch(registry, createDocument({ width: 800, height: 600 }), ops, { fonts });
  expect(r.results.filter((o) => o.status !== 'ok')).toEqual([]);
  return r.doc;
}
const rect = (id: string, x: number, y: number, width: number, height: number) => ({ op: 'rect', id, x, y, width, height });
const circle = (id: string, cx: number, cy: number, rx: number) => ({ op: 'ellipse', id, cx, cy, rx });
const within = (actual: number | null, expected: number, tolerance: number) => expect(Math.abs(actual! - expected)).toBeLessThanOrEqual(expected * tolerance);

describe('measure: nodes', () => {
  const doc = build([
    rect('r', 10, 20, 100, 50),
    circle('c', 200, 200, 50),
    { op: 'line', id: 'ln', x1: 0, y1: 0, x2: 3, y2: 4 },
    { op: 'group', id: 'both', ids: ['r', 'c'] },
    { op: 'text', id: 't', content: 'Label', x: 400, y: 300, size: 30 },
    { op: 'group', id: 'caption', ids: ['t'] },
    rect('big', 300, 400, 20, 10),
    { op: 'transform', ids: ['big'], scale: 2, pivot: 'top-left' },
  ]);
  const { nodes } = measure(doc, ['r', 'c', 'ln', 'both', 't', 'caption', 'big']);

  it('gives the exact bounds, center, area and length of a rectangle', () => {
    expect(nodes.r).toEqual({ bounds: { x: 10, y: 20, width: 100, height: 50 }, center: [60, 45], area: 5000, length: 300 });
  });

  it('gives a circle its πr² and 2πr within 0.5%', () => {
    expect(nodes.c!.bounds).toEqual({ x: 150, y: 150, width: 100, height: 100 });
    expect(nodes.c!.center).toEqual([200, 200]);
    within(nodes.c!.area, Math.PI * 50 * 50, 0.005);
    within(nodes.c!.length, 2 * Math.PI * 50, 0.005);
  });

  it('measures a line: its length, no area', () => {
    expect(nodes.ln).toEqual({ bounds: { x: 0, y: 0, width: 3, height: 4 }, center: [1.5, 2], area: 0, length: 5 });
  });

  it('sums the descendant paths for a group', () => {
    expect(nodes.both!.bounds).toEqual({ x: 10, y: 20, width: 240, height: 230 });
    expect(nodes.both!.area).toBeCloseTo(nodes.r!.area! + nodes.c!.area!, 2);
    expect(nodes.both!.length).toBeCloseTo(nodes.r!.length! + nodes.c!.length!, 2);
  });

  it('gives text and groups of text bounds but no area or length', () => {
    expect(nodes.t!.bounds!.width).toBeGreaterThan(0);
    expect(nodes.t).toMatchObject({ area: null, length: null });
    expect(nodes.t!.center).not.toBeNull();
    expect(nodes.caption).toMatchObject({ area: null, length: null });
    expect(nodes.caption!.bounds).toEqual(nodes.t!.bounds);
  });

  it('measures in world space, after transforms', () => {
    expect(nodes.big).toEqual({ bounds: { x: 300, y: 400, width: 40, height: 20 }, center: [320, 410], area: 800, length: 120 });
  });

  it('gives an empty group null everywhere', () => {
    const { nodes: n } = measure(docOf([groupNode('empty', [])]), ['empty']);
    expect(n.empty).toEqual({ bounds: null, center: null, area: null, length: null });
  });

  it('removes duplicate ids and keeps the input order', () => {
    const m = measure(doc, ['c', 'r', 'c', 'r']);
    expect(Object.keys(m.nodes)).toEqual(['c', 'r']);
    expect(m.pairs.map((p) => [p.a, p.b])).toEqual([['c', 'r']]);
  });

  it('counts the area of a shape with a hole once', () => {
    const holed = build([circle('outer', 300, 300, 100), circle('inner', 300, 300, 40), { op: 'boolean', mode: 'subtract', ids: ['outer', 'inner'], id: 'ring' }]);
    within(measure(holed, ['ring']).nodes.ring!.area, Math.PI * (100 * 100 - 40 * 40), 0.005);
  });

  it('is deterministic', () => {
    const ids = ['r', 'c', 'ln', 'both', 't', 'big'];
    expect(JSON.stringify(measure(doc, ids))).toBe(JSON.stringify(measure(doc, ids)));
  });
});

describe('measure: input checks', () => {
  const doc = build([rect('a', 0, 0, 10, 10)]);

  it('rejects an unknown id and suggests the closest', () => {
    const e = expectCode(() => measure(doc, ['a', 'aa']), 'unknown_id');
    expect(e.hint).toContain('"a"');
  });

  it('wants at least one id', () => {
    expectCode(() => measure(doc, []), 'invalid_input');
  });

  it(`takes at most ${MAX_MEASURE_IDS} different ids`, () => {
    const many = build(Array.from({ length: MAX_MEASURE_IDS + 1 }, (_, i) => rect(`n${i}`, i, 0, 1, 1)));
    const ids = Object.keys(many.nodes);
    expect(Object.keys(measure(many, ids.slice(0, MAX_MEASURE_IDS)).nodes)).toHaveLength(MAX_MEASURE_IDS);
    expectCode(() => measure(many, ids), 'invalid_input');
    expect(Object.keys(measure(many, [...ids.slice(0, MAX_MEASURE_IDS), ...ids.slice(0, 5)]).nodes)).toHaveLength(MAX_MEASURE_IDS);
  });
});

describe('measure: pairs', () => {
  const doc = build([
    rect('p', 0, 0, 100, 50),
    rect('far', 130, 80, 100, 50),
    rect('over', 50, 20, 100, 50),
    circle('ca', 100, 100, 50),
    circle('cb', 180, 180, 50),
    { op: 'group', id: 'ga', ids: ['ca'] },
    { op: 'ellipse', id: 'half', cx: 600, cy: 100, rx: 50 },
    rect('right', 600, 0, 100, 200),
    { op: 'text', id: 'label', content: 'Label', x: 10, y: 40, size: 30 },
    rect('under', 0, 0, 200, 100),
  ]);

  it('gives the gap on each axis and the center distance for separated shapes', () => {
    const [pair] = measure(doc, ['p', 'far']).pairs;
    expect(pair).toEqual({ a: 'p', b: 'far', centerDistance: 152.64, gap: { x: 30, y: 30 }, overlap: false, overlapArea: 0, exact: true });
  });

  it('gives a gap of 0 on the axes where the boxes overlap', () => {
    const pair = measure(doc, ['p', 'over']).pairs[0]!;
    expect(pair.gap).toEqual({ x: 0, y: 0 });
    expect(pair).toMatchObject({ centerDistance: 53.85, overlap: true, overlapArea: 1500, exact: true });
  });

  it('is symmetric in the gap', () => {
    expect(measure(doc, ['far', 'p']).pairs[0]).toMatchObject({ a: 'far', b: 'p', gap: { x: 30, y: 30 } });
  });

  it('finds no overlap for circles whose boxes overlap but whose shapes do not', () => {
    expect(measure(doc, ['ca', 'cb']).pairs[0]).toMatchObject({ gap: { x: 0, y: 0 }, overlap: false, overlapArea: 0, exact: true });
  });

  it('falls back to the box overlap for a group, and says so', () => {
    expect(measure(doc, ['ga', 'cb']).pairs[0]).toMatchObject({ overlap: true, overlapArea: 400, exact: false });
  });

  it('computes the exact overlap of a circle and a rectangle', () => {
    const pair = measure(doc, ['half', 'right']).pairs[0]!;
    expect(pair).toMatchObject({ overlap: true, exact: true });
    within(pair.overlapArea, (Math.PI * 50 * 50) / 2, 0.005); // not the 5000 of the boxes
  });

  it('uses the ink box for text', () => {
    const box = worldBounds(doc, 'label')!;
    expect(measure(doc, ['under', 'label']).pairs[0]).toEqual(expect.objectContaining({ overlap: true, overlapArea: round2(box.width * box.height), exact: false }));
  });

  it('relates every pair in input order', () => {
    const { pairs } = measure(doc, ['p', 'far', 'over']);
    expect(pairs.map((x) => [x.a, x.b])).toEqual([['p', 'far'], ['p', 'over'], ['far', 'over']]);
  });

  it('leaves the pairs out for one id and for more than the pair limit', () => {
    expect(measure(doc, ['p']).pairs).toEqual([]);
    const ids = Array.from({ length: MAX_PAIR_IDS + 1 }, (_, i) => `n${i}`);
    const many = build(ids.map((id, i) => rect(id, i * 3, 0, 2, 2)));
    expect(measure(many, ids.slice(0, MAX_PAIR_IDS)).pairs).toHaveLength((MAX_PAIR_IDS * (MAX_PAIR_IDS - 1)) / 2);
    expect(measure(many, ids).pairs).toEqual([]);
    expect(Object.keys(measure(many, ids).nodes)).toHaveLength(MAX_PAIR_IDS + 1);
  });

  it('gives nulls for a pair with an empty node', () => {
    const withEmpty = docOf([groupNode('empty', []), ...Object.values(build([rect('a', 0, 0, 10, 10)]).nodes)], ['empty', 'a']);
    expect(measure(withEmpty, ['empty', 'a']).pairs[0]).toEqual({ a: 'empty', b: 'a', centerDistance: null, gap: null, overlap: false, overlapArea: 0, exact: false });
  });

  it('falls back to the box overlap when the boolean fails', () => {
    vi.mocked(booleanOp).mockImplementationOnce(() => {
      throw new Error('degenerate');
    });
    expect(measure(doc, ['p', 'over']).pairs[0]).toMatchObject({ overlap: true, overlapArea: 1500, exact: false });
  });
});
