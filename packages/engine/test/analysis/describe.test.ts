import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { describeScene, MAX_DESCRIPTION_BYTES, round2, type NodeInfo, type SceneDescription } from '../../src/analysis/describe.ts';
import type { Subpath } from '../../src/geometry/types.ts';
import { createRegistry } from '../../src/ops/index.ts';
import { executeBatch } from '../../src/ops/registry.ts';
import type { RasterFonts } from '../../src/render/raster.ts';
import { createDocument, type Doc } from '../../src/scene/model.ts';
import { docOf, expectCode, groupNode, pathNode } from '../fixtures.ts';

const font = (file: string) => fileURLToPath(new URL(`../../assets/fonts/${file}`, import.meta.url));
const fonts: RasterFonts = { files: [font('Tajawal-Regular.ttf'), font('Tajawal-Bold.ttf')], defaultFamily: 'Tajawal' };
const registry = createRegistry();

function build(ops: unknown[]): Doc {
  const r = executeBatch(registry, createDocument({ width: 800, height: 600, seed: 7 }), ops, { fonts });
  expect(r.results.filter((o) => o.status !== 'ok')).toEqual([]);
  return r.doc;
}

/** Every node of the description, depth-first. */
const flat = (nodes: readonly NodeInfo[]): NodeInfo[] => nodes.flatMap((n) => [n, ...flat(n.children ?? [])]);
const find = (d: SceneDescription, id: string): NodeInfo => flat(d.nodes).find((n) => n.id === id)!;

const SCENE = [
  { op: 'tokens', set: { 'brand.ink': '#264653' } },
  { op: 'rect', id: 'sky', x: 0, y: 0, width: 800, height: 300 },
  { op: 'gradient', id: 'sky_fade', stops: ['#8ecae6', '#ffffff'], angle: 90, ids: ['sky'] },
  { op: 'mask', id: 'sky', fade: { angle: 0, from: 1, to: 0.5 } },
  { op: 'ellipse', id: 'sun', cx: 650, cy: 100, rx: 40, style: { fill: 'brand.ink', stroke: '#ffb703', strokeWidth: 3, opacity: 0.8 } },
  { op: 'filter', id: 'lift', shadow: { dy: 8, blur: 12 }, ids: ['sun'] },
  { op: 'style', ids: ['sun'], style: { blend: 'multiply' } },
  { op: 'text', id: 'title', content: 'Hello world', x: 400, y: 200, size: 24, weight: 'bold', anchor: 'middle' },
  { op: 'polygon', id: 'p1', cx: 200, cy: 400, radius: 60, sides: 3 },
  { op: 'polygon', id: 'p2', cx: 320, cy: 400, radius: 60, sides: 5 },
  { op: 'group', id: 'hills', ids: ['p1', 'p2'] },
  { op: 'ellipse', id: 'frame', cx: 320, cy: 400, rx: 30 },
  { op: 'clip', id: 'p2', shape: 'frame' },
  { op: 'transform', ids: ['p1'], rotate: 15 },
];
const scene = build(SCENE);

describe('describeScene: outline', () => {
  const d = describeScene(scene, { detail: 'outline' });

  it('lists the canvas, seed, token names, defs and counts', () => {
    expect(d.canvas).toEqual({ width: 800, height: 600 });
    expect(d.seed).toBe(7);
    expect(d.tokens).toEqual(['brand.ink']);
    expect(d.defs).toEqual([{ name: 'lift', kind: 'filter' }, { name: 'sky_fade', kind: 'linear' }]);
    expect([d.nodeCount, d.shown, d.truncated]).toEqual([6, 6, false]);
  });

  it('nests children back to front and keeps only id, type and bounds', () => {
    expect(d.nodes.map((n) => [n.id, n.type])).toEqual([['sky', 'path'], ['sun', 'path'], ['title', 'text'], ['hills', 'group']]);
    expect(find(d, 'hills')).toEqual({
      id: 'hills',
      type: 'group',
      bounds: { x: 138.16, y: 341.53, width: 211.84, height: 100.38 },
      children: [
        { id: 'p1', type: 'path', bounds: { x: 138.16, y: 341.53, width: 100.38, height: 100.38 } },
        { id: 'p2', type: 'path', bounds: { x: 290, y: 370, width: 60, height: 60 } },
      ],
    });
  });

  it('is not the default level, which is normal', () => {
    expect(describeScene(scene)).toEqual(describeScene(scene, { detail: 'normal' }));
    expect(describeScene(scene)).not.toEqual(d);
  });
});

describe('describeScene: normal', () => {
  const d = describeScene(scene);

  it('shows a gradient fill by name and a mask flag', () => {
    expect(find(d, 'sky')).toEqual({
      id: 'sky',
      type: 'path',
      bounds: { x: 0, y: 0, width: 800, height: 300 },
      fill: 'sky_fade (gradient)',
      mask: true,
      source: 'rect',
      segments: 4,
    });
  });

  it('shows a token fill with its color, plus stroke, opacity, filter and blend as stored', () => {
    expect(find(d, 'sun')).toEqual({
      id: 'sun',
      type: 'path',
      bounds: { x: 610, y: 60, width: 80, height: 80 },
      fill: 'brand.ink → #264653',
      stroke: '#ffb703',
      strokeWidth: 3,
      opacity: 0.8,
      filter: 'lift',
      blend: 'multiply',
      source: 'ellipse',
      segments: 4,
    });
  });

  it('shows plain colors unchanged', () => {
    const doc = build([{ op: 'rect', id: 'r', x: 1, y: 1, width: 5, height: 5, style: { fill: 'tomato', stroke: 'none' } }]);
    expect(describeScene(doc).nodes[0]).toMatchObject({ fill: 'tomato', stroke: 'none' });
  });

  it('flags a clip', () => {
    expect(find(d, 'p2').clip).toBe(true);
    expect(find(d, 'p1')).not.toHaveProperty('clip');
  });

  it('summarizes text: content, font, anchor', () => {
    expect(find(d, 'title')).toMatchObject({ type: 'text', text: 'Hello world', font: 'Tajawal 24/700', anchor: 'middle' });
    expect(find(d, 'title')).not.toHaveProperty('segments');
  });

  it('cuts long text at 80 characters', () => {
    const doc = build([{ op: 'text', id: 'long', content: 'x'.repeat(100), x: 10, y: 50, size: 10 }]);
    expect(describeScene(doc).nodes[0]!.text).toBe('x'.repeat(80));
  });

  it('leaves the full-detail fields out', () => {
    for (const key of ['transform', 'subpaths', 'at', 'fontSpec', 'meta']) {
      expect(flat(d.nodes).filter((n) => key in n)).toEqual([]);
    }
  });
});

describe('describeScene: full', () => {
  const d = describeScene(scene, { detail: 'full' });

  it('adds the path geometry, rounded to 0.01, and the source parameters', () => {
    const sun = find(d, 'sun');
    expect(sun.subpaths).toHaveLength(1);
    expect(sun.subpaths![0]!.start).toEqual([690, 100]);
    expect(sun.subpaths![0]!.segs[0]).toEqual([690, 122.09, 672.09, 140, 650, 140]);
    expect(sun.subpaths!.flatMap((sp) => [...sp.start, ...sp.segs.flat()]).every((v) => round2(v) === v)).toBe(true);
    expect(sun.meta).toEqual({ source: { kind: 'ellipse', cx: 650, cy: 100, rx: 40, ry: 40 } });
  });

  it('adds a transform only when it is not the identity', () => {
    expect(find(d, 'p1').transform).toEqual([0.9659, 0.2588, -0.2588, 0.9659, 106.4602, -38.6453]);
    expect(find(d, 'sun')).not.toHaveProperty('transform');
  });

  it('adds point text placement and the font spec', () => {
    expect(find(d, 'title')).toMatchObject({
      at: { kind: 'point', x: 400, y: 200 },
      fontSpec: { family: 'Tajawal', size: 24, weight: 700, letterSpacing: 0 },
    });
  });

  it('adds path text placement with rounded subpaths', () => {
    const doc = build([
      { op: 'path_commands', id: 'arc', d: 'M120 560 Q400 380 680 560' },
      { op: 'text_on_path', id: 'caption', path: 'arc', content: 'On an arc', size: 30, keep: true },
    ]);
    const at = find(describeScene(doc, { detail: 'full' }), 'caption').at!;
    expect(at.kind).toBe('path');
    if (at.kind !== 'path') return;
    expect(at.offset).toBe(0);
    expect(at.subpaths.flatMap((sp) => [...sp.start, ...sp.segs.flat()]).every((v) => round2(v) === v)).toBe(true);
  });
});

describe('describeScene: root', () => {
  it('describes one subtree and counts only that', () => {
    const d = describeScene(scene, { root: 'hills', detail: 'outline' });
    expect(d.nodes.map((n) => n.id)).toEqual(['hills']);
    expect(d.nodes[0]!.children!.map((n) => n.id)).toEqual(['p1', 'p2']);
    expect([d.nodeCount, d.shown, d.truncated]).toEqual([3, 3, false]);
    expect(d.tokens).toEqual(['brand.ink']);
  });

  it('accepts a leaf', () => {
    expect(describeScene(scene, { root: 'sun', detail: 'outline' }).nodes).toEqual([{ id: 'sun', type: 'path', bounds: { x: 610, y: 60, width: 80, height: 80 } }]);
  });

  it('rejects an unknown id with the closest ids as the hint', () => {
    const e = expectCode(() => describeScene(scene, { root: 'hill' }), 'unknown_id');
    expect(e.hint).toContain('"hills"');
  });
});

describe('describeScene: maxNodes', () => {
  const doc = build([
    { op: 'rect', id: 'a', x: 0, y: 0, width: 10, height: 10 },
    { op: 'rect', id: 'b', x: 20, y: 0, width: 10, height: 10 },
    { op: 'rect', id: 'c', x: 40, y: 0, width: 10, height: 10 },
    { op: 'group', id: 'g', ids: ['a', 'b', 'c'] },
    { op: 'rect', id: 'top', x: 60, y: 0, width: 10, height: 10 },
  ]);
  const ids = (d: SceneDescription) => flat(d.nodes).map((n) => n.id);

  it('lists everything when the count fits', () => {
    const d = describeScene(doc, { maxNodes: 5, detail: 'outline' });
    expect(ids(d)).toEqual(['g', 'a', 'b', 'c', 'top']);
    expect([d.nodeCount, d.shown, d.truncated]).toEqual([5, 5, false]);
    expect(find(d, 'g')).not.toHaveProperty('childCount');
  });

  it('fills the top level before going deeper and reports the missing children', () => {
    const d = describeScene(doc, { maxNodes: 4, detail: 'outline' });
    expect(ids(d)).toEqual(['g', 'a', 'b', 'top']);
    expect(find(d, 'g').childCount).toBe(3);
    expect([d.nodeCount, d.shown, d.truncated]).toEqual([5, 4, true]);
  });

  it('can list the top level only', () => {
    const d = describeScene(doc, { maxNodes: 2, detail: 'outline' });
    expect(find(d, 'g')).toMatchObject({ children: [], childCount: 3 });
    expect(d.shown).toBe(2);
  });

  it('stops a flat list at the limit, keeping the back-most nodes', () => {
    const flatDoc = build(['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ op: 'rect', id, x: i * 20, y: 0, width: 10, height: 10 })));
    const d = describeScene(flatDoc, { maxNodes: 3 });
    expect(d.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect([d.nodeCount, d.shown, d.truncated]).toEqual([5, 3, true]);
  });

  it('defaults to 300 nodes', () => {
    const many = docOf(Array.from({ length: 301 }, (_, i) => pathNode(`r${i}`, [])));
    const d = describeScene(many, { detail: 'outline' });
    expect([d.nodeCount, d.shown, d.truncated]).toEqual([301, 300, true]);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects maxNodes %s', (maxNodes) => {
    expectCode(() => describeScene(doc, { maxNodes }), 'invalid_input');
  });
});

describe('describeScene: size cap', () => {
  const square = (x: number) => ({ start: [x, 0] as [number, number], segs: [[x + 5, 0, x + 5, 0, x + 5, 0], [x + 5, 5, x + 5, 5, x + 5, 5], [x, 5, x, 5, x, 5], [x, 0, x, 0, x, 0]] as Subpath['segs'], closed: true });

  it('stops adding nodes at about 256 KB and points to root and lower detail', () => {
    const many = docOf(Array.from({ length: 2000 }, (_, i) => pathNode(`node_with_a_long_descriptive_id_${i}`.padEnd(60, '_'), [square(i)], { style: { fill: '#aabbcc', stroke: '#112233', strokeWidth: 2 } })));
    const d = describeScene(many, { maxNodes: 2000 });
    expect(d.truncated).toBe(true);
    expect(d.shown).toBeGreaterThan(500);
    expect(d.shown).toBeLessThan(2000);
    expect(JSON.stringify(d).length).toBeLessThan(MAX_DESCRIPTION_BYTES * 1.05);
    expect(d.hint).toContain('root');
    expect(d.hint).toContain('lower detail');
    // A cut by maxNodes alone has no hint.
    expect(describeScene(many, { maxNodes: 10 })).not.toHaveProperty('hint');
  });

  it('stops at 20000 path segments at full detail, but always lists the first node', () => {
    const wide = (x: number) => ({ start: [x, 0] as [number, number], segs: Array.from({ length: 15_000 }, (_, k) => [k, 1, k, 2, k, 3] as Subpath['segs'][number]), closed: false });
    const doc = docOf([pathNode('a', [wide(0)]), pathNode('b', [wide(1)]), pathNode('c', [wide(2)])]);
    const full = describeScene(doc, { detail: 'full' });
    expect(full.nodes.map((n) => n.id)).toEqual(['a']);
    expect([full.nodeCount, full.shown, full.truncated]).toEqual([3, 1, true]);
    expect(full.hint).toBeDefined();
    // The same document at normal detail lists the segments as a count only.
    expect(describeScene(doc).nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('describeScene: edge cases', () => {
  it('describes an empty document', () => {
    const d = describeScene(createDocument({ width: 100, height: 50, background: '#fff' }));
    expect(d).toEqual({ canvas: { width: 100, height: 50, background: '#fff' }, seed: 1, tokens: [], defs: [], nodeCount: 0, shown: 0, truncated: false, nodes: [] });
  });

  it('gives an empty group null bounds', () => {
    expect(describeScene(docOf([groupNode('empty', [])])).nodes).toEqual([{ id: 'empty', type: 'group', bounds: null, children: [] }]);
  });

  it('never prints -0', () => {
    const doc = build([{ op: 'rect', id: 'r', x: -0.001, y: 0, width: 10, height: 10 }]);
    expect(Object.is(describeScene(doc).nodes[0]!.bounds!.x, 0)).toBe(true);
  });

  it('sorts token and def names and gives the same output every time', () => {
    const doc = build([
      { op: 'tokens', set: { zeta: '#000000', alpha: '#ffffff' } },
      { op: 'gradient', id: 'zz', stops: ['alpha', 'zeta'] },
      { op: 'gradient', id: 'aa', stops: ['alpha', 'zeta'] },
      { op: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10, style: { fill: 'zeta' } },
    ]);
    const d = describeScene(doc, { detail: 'full' });
    expect(d.tokens).toEqual(['alpha', 'zeta']);
    expect(d.defs.map((x) => x.name)).toEqual(['aa', 'zz']);
    expect(JSON.stringify(describeScene(doc, { detail: 'full' }))).toBe(JSON.stringify(d));
    expect(JSON.stringify(describeScene(scene, { detail: 'full' }))).toBe(JSON.stringify(describeScene(scene, { detail: 'full' })));
  });
});
