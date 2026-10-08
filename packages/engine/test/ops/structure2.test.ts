import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/ops/index.ts';
import { executeBatch, type BatchResult } from '../../src/ops/registry.ts';
import { duplicate, rename, reorder, ungroup, clip } from '../../src/ops/structure.ts';
import { rasterize } from '../../src/render/raster.ts';
import { toSvg } from '../../src/render/svg.ts';
import { createDocument, validateDocument, type Doc, type GroupNode } from '../../src/scene/model.ts';
import { worldBounds } from '../../src/scene/query.ts';
import { expectIntact } from '../fixtures.ts';

const registry = createRegistry();
function run(ops: unknown[], doc: Doc = createDocument({ width: 200, height: 100, background: '#ffffff' })): BatchResult {
  const r = executeBatch(registry, doc, ops);
  expectIntact(r.doc);
  return r;
}
const four = ['a', 'b', 'c', 'd'].map((id, i) => ({ op: 'rect', id, x: i * 20, y: 0, width: 10, height: 10 }));

describe('ops/reorder', () => {
  it.each([
    [{ to: 'front', ids: ['a', 'b'] }, ['c', 'd', 'a', 'b']],
    [{ to: 'back', ids: ['d'] }, ['d', 'a', 'b', 'c']],
    [{ to: 'forward', ids: ['a'] }, ['b', 'a', 'c', 'd']],
    [{ to: 'backward', ids: ['c', 'd'] }, ['a', 'c', 'd', 'b']],
    [{ to: 'above', ids: ['a'], relative: 'c' }, ['b', 'c', 'a', 'd']],
    [{ to: 'below', ids: ['d'], relative: 'b' }, ['a', 'd', 'b', 'c']],
  ])('%o', (args, root) => {
    expect(run([...four, { op: 'reorder', ...args }]).doc.root).toEqual(root);
  });

  it('rejects non-siblings, a missing relative, and a relative inside the moved set', () => {
    const nested = [...four, { op: 'group', id: 'g', ids: ['a', 'b'] }];
    expect(run([...nested, { op: 'reorder', ids: ['a', 'c'], to: 'front' }]).results[5]).toMatchObject({ error: { code: 'invalid_structure' } });
    expect(run([...four, { op: 'reorder', ids: ['a'], to: 'above' }]).results[4]).toMatchObject({ error: { code: 'invalid_input' } });
    expect(run([...four, { op: 'reorder', ids: ['a', 'b'], to: 'below', relative: 'b' }]).results[4]).toMatchObject({ error: { code: 'invalid_structure' } });
  });
});

describe('ops/duplicate and rename', () => {
  it('duplicate copies a subtree above the original with fresh ids and an offset', () => {
    const r = run([...four, { op: 'group', id: 'g', ids: ['a', 'b'] }, { op: 'duplicate', ids: ['g'], offset: [0, 50] }]);
    expect(r.doc.root).toEqual(['g', 'g-2', 'c', 'd']);
    expect((r.doc.nodes['g-2'] as GroupNode).children).toEqual(['a-2', 'b-2']);
    expect(worldBounds(r.doc, 'a-2')).toEqual({ x: 0, y: 50, width: 10, height: 10 });
    expect(r.results[5]).toMatchObject({ id: 'g-2' });
    expect(run([...four, { op: 'duplicate', ids: ['a'], id: 'twin' }, { op: 'style', ids: ['$last'], style: { fill: 'red' } }]).doc.nodes.twin!.style).toEqual({ fill: 'red' });
  });

  it('rename updates every reference and $last', () => {
    const r = run([...four, { op: 'group', id: 'g', ids: ['a', 'b'] }, { op: 'rename', id: 'g', to: 'pair' }, { op: 'rename', id: 'a', to: 'first' }]);
    expect(r.doc.root).toEqual(['pair', 'c', 'd']);
    expect((r.doc.nodes.pair as GroupNode).children).toEqual(['first', 'b']);
    expect(r.doc.nodes.first!.parent).toBe('pair');
    const last = run([{ op: 'rect', id: 'x', x: 0, y: 0, width: 5, height: 5 }, { op: 'rename', id: 'x', to: 'y' }, { op: 'style', ids: ['$last'], style: { fill: 'red' } }]);
    expect(last.doc.nodes.y!.style).toEqual({ fill: 'red' });
    expect(run([...four, { op: 'rename', id: 'a', to: 'b' }]).results[4]).toMatchObject({ error: { code: 'invalid_input' } });
  });

  it('rename and duplicate reject unusable ids and one id for several copies', () => {
    expect(run([...four, { op: 'rename', id: 'a', to: '__x' }]).results[4]).toMatchObject({ error: { code: 'invalid_input' } });
    expect(run([...four, { op: 'duplicate', ids: ['a'], id: 'canvas' }]).results[4]).toMatchObject({ error: { code: 'invalid_input' } });
    expect(run([...four, { op: 'duplicate', ids: ['a', 'b'], id: 'twin' }]).results[4]).toMatchObject({ error: { code: 'invalid_input' } });
  });
});

describe('ops/ungroup', () => {
  it('releases children in place, keeping world placement, inherited style and opacity', () => {
    const r = run([
      ...four,
      { op: 'group', id: 'g', ids: ['b', 'c'] },
      { op: 'style', ids: ['g'], style: { fill: 'teal', opacity: 0.5 } },
      { op: 'transform', ids: ['g'], translate: [5, 5] },
      { op: 'ungroup', ids: ['g'] },
    ]);
    expect(r.doc.root).toEqual(['a', 'b', 'c', 'd']);
    expect(worldBounds(r.doc, 'b')).toEqual({ x: 25, y: 5, width: 10, height: 10 });
    expect(r.doc.nodes.b!.style).toEqual({ fill: 'teal', opacity: 0.5 });
    expect(r.results[7]).toMatchObject({ ids: ['b', 'c'] });
  });

  it('keeps world geometry under a rotated, scaled group; a child keeps its own fill and multiplies opacity', () => {
    const before = run([
      { op: 'rect', id: 'a', x: 10, y: 10, width: 10, height: 10, style: { fill: 'red' } },
      { op: 'rect', id: 'b', x: 30, y: 10, width: 10, height: 10, style: { opacity: 0.5 } },
      { op: 'group', id: 'g', ids: ['a', 'b'] },
      { op: 'style', ids: ['g'], style: { fill: 'teal', opacity: 0.5 } },
      { op: 'transform', ids: ['g'], scale: 2, rotate: 30 },
    ]).doc;
    const after = run([{ op: 'ungroup', ids: ['g'] }], before).doc;
    for (const id of ['a', 'b']) expect(worldBounds(after, id)).toEqual(worldBounds(before, id));
    expect(after.nodes.a!.style).toEqual({ fill: 'red', opacity: 0.5 });
    expect(after.nodes.b!.style).toEqual({ fill: 'teal', opacity: 0.25 });
  });

  it('refuses a node that is not a group and a group that has a clip', () => {
    expect(run([...four, { op: 'ungroup', ids: ['a'] }]).results[4]).toMatchObject({ error: { code: 'invalid_structure' } });
    const clipped = run([
      ...four,
      { op: 'group', id: 'g', ids: ['a', 'b'] },
      { op: 'ellipse', id: 'frame', cx: 10, cy: 5, rx: 8 },
      { op: 'clip', id: 'g', shape: 'frame' },
      { op: 'ungroup', ids: ['g'] },
    ]);
    expect(clipped.results[7]).toMatchObject({ error: { code: 'invalid_structure' } });
  });
});

describe('ops/clip', () => {
  it('clips a node to another shape: bounds shrink, SVG gets a clipPath, pixels outside vanish', () => {
    const r = run([
      { op: 'rect', id: 'photo', x: 0, y: 0, width: 200, height: 100, style: { fill: '#e76f51' } },
      { op: 'ellipse', id: 'frame', cx: 100, cy: 50, rx: 40 },
      { op: 'clip', id: 'photo', shape: 'frame' },
    ]);
    expect(r.doc.nodes.frame).toBeUndefined();
    expect(r.results[2]).toMatchObject({ id: 'photo', bounds: { x: 60, y: 10, width: 80, height: 80 } });
    expect(toSvg(r.doc)).toContain('<clipPath id="__clip_photo">');
    expect(toSvg(r.doc)).toContain('clip-path="url(#__clip_photo)"');
    const img = rasterize(r.doc);
    const px = (x: number, y: number) => Array.from(img.pixels.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));
    expect(px(100, 50)).toEqual([231, 111, 81]);
    expect(px(10, 10)).toEqual([255, 255, 255]);
  });

  it('a clipped document survives a JSON round trip', () => {
    const r = run([
      { op: 'rect', id: 'photo', x: 0, y: 0, width: 200, height: 100 },
      { op: 'ellipse', id: 'frame', cx: 100, cy: 50, rx: 40 },
      { op: 'clip', id: 'photo', shape: 'frame' },
    ]);
    expect(validateDocument(JSON.parse(JSON.stringify(r.doc)))).toEqual(r.doc);
  });

  it('shape null removes the clip; keep leaves the shape node', () => {
    const r = run([
      { op: 'rect', id: 'photo', x: 0, y: 0, width: 200, height: 100 },
      { op: 'ellipse', id: 'frame', cx: 100, cy: 50, rx: 40 },
      { op: 'clip', id: 'photo', shape: 'frame', keep: true },
      { op: 'clip', id: 'photo', shape: null },
    ]);
    expect(r.doc.nodes.frame).toBeDefined();
    expect(r.doc.nodes.photo!.clip).toBeUndefined();
    expect(worldBounds(r.doc, 'photo')).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it('a clip follows its node when the node moves', () => {
    const r = run([
      { op: 'rect', id: 'photo', x: 0, y: 0, width: 200, height: 100 },
      { op: 'ellipse', id: 'frame', cx: 100, cy: 50, rx: 40 },
      { op: 'clip', id: 'photo', shape: 'frame' },
      { op: 'transform', ids: ['photo'], translate: [10, 0] },
    ]);
    expect(worldBounds(r.doc, 'photo')).toMatchObject({ x: 70, width: 80 });
  });

  it('keeps the clip in the node\'s own space under a scaled parent and with its own transform', () => {
    const r = run([
      { op: 'rect', id: 'photo', x: 0, y: 0, width: 100, height: 50, style: { fill: '#e76f51' } },
      { op: 'group', id: 'g', ids: ['photo'] },
      { op: 'transform', ids: ['g'], scale: 2 },
      { op: 'transform', ids: ['photo'], translate: [10, 0] },
      { op: 'ellipse', id: 'frame', cx: 100, cy: 40, rx: 20 },
      { op: 'clip', id: 'photo', shape: 'frame' },
    ]);
    const b = worldBounds(r.doc, 'photo')!;
    expect([b.x, b.y, b.width, b.height].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([80, 20, 40, 40]);
    const img = rasterize(r.doc);
    const px = (x: number, y: number) => Array.from(img.pixels.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));
    expect(px(100, 40)).toEqual([231, 111, 81]);
    expect(px(70, 40)).toEqual([255, 255, 255]);
    expect(px(100, 10)).toEqual([255, 255, 255]);
  });

  it('refuses itself, nested shapes and a shape with no area', () => {
    const base = [{ op: 'rect', id: 'photo', x: 0, y: 0, width: 100, height: 50 }, { op: 'ellipse', id: 'frame', cx: 50, cy: 25, rx: 20 }];
    expect(run([...base, { op: 'clip', id: 'photo', shape: 'photo' }]).results[2]).toMatchObject({ error: { code: 'invalid_structure' } });
    const nested = [...base, { op: 'group', id: 'g', ids: ['photo', 'frame'] }];
    expect(run([...nested, { op: 'clip', id: 'g', shape: 'frame' }]).results[3]).toMatchObject({ error: { code: 'invalid_structure' } });
    expect(run([...nested, { op: 'clip', id: 'photo', shape: 'g' }]).results[3]).toMatchObject({ error: { code: 'invalid_structure' } });
    const empty = run([...base, { op: 'group', id: 'e', ids: ['frame'] }, { op: 'delete', ids: ['frame'] }, { op: 'clip', id: 'photo', shape: 'e' }]);
    expect(empty.results[4]).toMatchObject({ error: { code: 'invalid_structure' } });
  });

  it('leaves $last on the clipped node when the shape is consumed', () => {
    const r = run([
      { op: 'rect', id: 'photo', x: 0, y: 0, width: 100, height: 50 },
      { op: 'ellipse', id: 'frame', cx: 50, cy: 25, rx: 20 },
      { op: 'clip', id: 'photo', shape: '$last' },
      { op: 'style', ids: ['$last'], style: { fill: 'red' } },
    ]);
    expect(r.results[3]).toMatchObject({ status: 'ok', ids: ['photo'] });
  });
});

describe('ops: structure exports', () => {
  it('exports the new ops', () => {
    expect([reorder.name, duplicate.name, rename.name, ungroup.name, clip.name]).toEqual(['reorder', 'duplicate', 'rename', 'ungroup', 'clip']);
  });
});
