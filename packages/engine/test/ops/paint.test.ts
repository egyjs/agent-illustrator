import { describe, expect, it } from 'vitest';
import { filter, gradient, mask } from '../../src/ops/paint.ts';
import { executeBatch, Registry, type BatchResult } from '../../src/ops/registry.ts';
import { ellipse, line, rect } from '../../src/ops/shapes.ts';
import { style } from '../../src/ops/style.ts';
import { createDocument, validateDocument, type Doc } from '../../src/scene/model.ts';
import { expectIntact } from '../fixtures.ts';

const registry = new Registry().register(rect, ellipse, line, style, gradient, filter, mask);
const doc = (tokens: Record<string, string> = {}): Doc => ({ ...createDocument({ width: 800, height: 600 }), tokens });
function run(ops: unknown[], start: Doc = doc()): BatchResult {
  const r = executeBatch(registry, start, ops);
  expectIntact(r.doc);
  return r;
}
const box = { op: 'rect', id: 'box', x: 10, y: 10, width: 100, height: 50 };
const error = (r: BatchResult, i: number) => {
  const o = r.results[i]!;
  if (o.status !== 'error') throw new Error(`op ${i} is ${o.status}, not an error`);
  return o.error;
};

describe('ops/paint: gradient', () => {
  it('stores a linear gradient with evenly spaced stops and names it gradient-<n>', () => {
    const r = run([{ op: 'gradient', stops: ['#000000', '#888888', '#ffffff'] }, { op: 'gradient', stops: ['#fff', '#000'], angle: 0 }]);
    expect(r.results[0]).toMatchObject({ status: 'ok', data: { def: 'gradient-1' } });
    expect(r.results[0]).not.toHaveProperty('ids');
    expect(r.results[1]).toMatchObject({ data: { def: 'gradient-2' } });
    expect(r.doc.defs['gradient-1']).toEqual({
      kind: 'linear',
      angle: 90,
      stops: [{ offset: 0, color: '#000000' }, { offset: 0.5, color: '#888888' }, { offset: 1, color: '#ffffff' }],
    });
    expect(r.doc.defs['gradient-2']).toMatchObject({ angle: 0 });
  });

  it('paints the fill (or stroke) of the given ids and returns them', () => {
    const r = run([box, { op: 'gradient', id: 'sky_fade', stops: ['#8ecae6', '#fff'], ids: ['$last'] }, { op: 'gradient', id: 'rim', stops: ['#000', '#fff'], ids: ['box'], target: 'stroke' }]);
    expect(r.doc.nodes.box!.style).toEqual({ fill: 'sky_fade', stroke: 'rim' });
    expect(r.results[1]).toMatchObject({ ids: ['box'], data: { def: 'sky_fade' }, boundsById: { box: { x: 10, y: 10, width: 100, height: 50 } } });
  });

  it('takes offsets for some stops and spreads the bare ones by position', () => {
    const r = run([{ op: 'gradient', id: 'g', stops: ['#000', { color: '#f00', offset: 0.2 }, '#fff'] }]);
    expect(r.doc.defs.g).toMatchObject({ stops: [{ offset: 0 }, { offset: 0.2 }, { offset: 1 }] });
  });

  it('stores radial gradients with defaults, and a focal point when given', () => {
    const r = run([
      { op: 'gradient', id: 'a', type: 'radial', stops: ['#fff', '#000'] },
      { op: 'gradient', id: 'b', type: 'radial', stops: ['#fff', '#000'], center: [0.3, 0.6], radius: 0.8, focal: [0.2, 0.2] },
    ]);
    expect(r.doc.defs.a).toEqual({ kind: 'radial', center: [0.5, 0.5], radius: 0.5, stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }] });
    expect(r.doc.defs.b).toMatchObject({ kind: 'radial', center: [0.3, 0.6], radius: 0.8, focal: [0.2, 0.2] });
  });

  it('keeps token stop colors as names so they stay live', () => {
    const r = run([{ op: 'gradient', id: 'g', stops: ['brand', '#fff'] }], doc({ brand: '#ff0000' }));
    expect(r.doc.defs.g).toMatchObject({ stops: [{ color: 'brand' }, { color: '#fff' }] });
  });

  it('replaces a gradient of the same name with a warning', () => {
    const r = run([{ op: 'gradient', id: 'g', stops: ['#000', '#fff'] }, { op: 'gradient', id: 'g', stops: ['#f00', '#00f'], angle: 10 }]);
    expect(r.results[0]).toMatchObject({ warnings: [] });
    expect(r.results[1]).toMatchObject({ warnings: [{ code: 'def_replaced' }] });
    expect(r.doc.defs.g).toMatchObject({ angle: 10, stops: [{ color: '#f00' }, { color: '#00f' }] });
  });

  it('rejects stops that decrease, with a hint to sort them', () => {
    const r = run([{ op: 'gradient', stops: [{ color: '#000', offset: 0.6 }, { color: '#fff', offset: 0.2 }] }]);
    expect(error(r, 0)).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('stop 2') });
    expect(error(r, 0).hint).toMatch(/[Ss]ort/);
    expect(r.doc.defs).toEqual({});
  });

  it('rejects a stop that is not a color, none, a gradient or a missing token', () => {
    for (const bad of ['notacolor', 'none']) {
      expect(error(run([{ op: 'gradient', stops: ['#000', bad] }]), 0)).toMatchObject({ code: 'invalid_color' });
    }
    const r = run([{ op: 'gradient', id: 'g1', stops: ['#000', '#fff'] }, { op: 'gradient', stops: ['#000', 'g1'] }]);
    expect(error(r, 1)).toMatchObject({ code: 'invalid_color', message: expect.stringContaining('stop 2') });
  });

  it('rejects a name that is a token, a color, or a filter, and a bad id or too few stops', () => {
    const stops = ['#000', '#fff'];
    expect(error(run([{ op: 'gradient', id: 'brand', stops }], doc({ brand: '#f00' })), 0)).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('token') });
    expect(error(run([{ op: 'gradient', id: 'red', stops }]), 0)).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('color') });
    expect(error(run([{ op: 'filter', id: 'f', blur: 2 }, { op: 'gradient', id: 'f', stops }]), 1)).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('filter') });
    expect(error(run([{ op: 'gradient', id: '__x', stops }]), 0)).toMatchObject({ code: 'invalid_input' });
    expect(error(run([{ op: 'gradient', stops: ['#000'] }]), 0)).toMatchObject({ code: 'invalid_input' });
    expect(error(run([{ op: 'gradient', stops: Array(10).fill('#000') }]), 0)).toMatchObject({ code: 'invalid_input' });
  });

  it('fails on an unknown id and leaves the document alone', () => {
    const start = run([box]).doc;
    const r = run([{ op: 'gradient', id: 'g', stops: ['#000', '#fff'], ids: ['box', 'nope'] }], start);
    expect(error(r, 0)).toMatchObject({ code: 'unknown_id' });
    expect(r.doc).toBe(start);
  });

  it('can be used by the style op right after it is defined', () => {
    const r = run([box, { op: 'gradient', id: 'g', stops: ['#000', '#fff'] }, { op: 'style', ids: ['box'], style: { fill: 'g' } }]);
    expect(r.doc.nodes.box!.style.fill).toBe('g');
  });
});

describe('ops/paint: filter', () => {
  it('defines a shadow with its defaults and applies it', () => {
    const r = run([box, { op: 'filter', id: 'lift', shadow: {}, ids: ['box'] }]);
    expect(r.doc.defs.lift).toEqual({ kind: 'filter', shadow: { dx: 0, dy: 4, blur: 4, color: 'rgba(0,0,0,0.35)' } });
    expect(r.doc.nodes.box!.style.filter).toBe('lift');
    expect(r.results[1]).toMatchObject({ ids: ['box'], data: { def: 'lift' } });
  });

  it('defines a blur, and a blur with a shadow', () => {
    const r = run([{ op: 'filter', blur: 5 }, { op: 'filter', blur: 2, shadow: { dx: 3, dy: -3, blur: 0, color: '#ff0000' } }]);
    expect(r.doc.defs['filter-1']).toEqual({ kind: 'filter', blur: 5 });
    expect(r.doc.defs['filter-2']).toEqual({ kind: 'filter', blur: 2, shadow: { dx: 3, dy: -3, blur: 0, color: '#ff0000' } });
  });

  it('needs a blur or a shadow, and a shadow color that resolves', () => {
    expect(error(run([{ op: 'filter' }]), 0)).toMatchObject({ code: 'invalid_input' });
    expect(error(run([{ op: 'filter', shadow: { color: 'bogus' } }]), 0)).toMatchObject({ code: 'invalid_color' });
    expect(error(run([{ op: 'filter', blur: 0 }]), 0)).toMatchObject({ code: 'invalid_input' });
    expect(run([{ op: 'filter', shadow: { color: 'ink' } }], doc({ ink: '#264653' })).ok).toBe(true);
  });

  it('refuses a name a gradient holds, and warns when it replaces a filter', () => {
    expect(error(run([{ op: 'gradient', id: 'g', stops: ['#000', '#fff'] }, { op: 'filter', id: 'g', blur: 2 }]), 1)).toMatchObject({ code: 'invalid_input' });
    const r = run([{ op: 'filter', id: 'f', blur: 2 }, { op: 'filter', id: 'f', blur: 9 }]);
    expect(r.results[1]).toMatchObject({ warnings: [{ code: 'def_replaced' }] });
    expect(r.doc.defs.f).toEqual({ kind: 'filter', blur: 9 });
  });

  it('is what the style op checks a filter against', () => {
    const ok = run([box, { op: 'filter', id: 'f', blur: 2 }, { op: 'style', ids: ['box'], style: { filter: 'f' } }]);
    expect(ok.doc.nodes.box!.style.filter).toBe('f');
    const r = run([box, { op: 'style', ids: ['box'], style: { filter: 'nope' } }]);
    expect(error(r, 1)).toMatchObject({ code: 'invalid_reference', hint: expect.stringContaining('filter') });
    const g = run([box, { op: 'gradient', id: 'g', stops: ['#000', '#fff'] }, { op: 'style', ids: ['box'], style: { filter: 'g' } }]);
    expect(error(g, 2)).toMatchObject({ code: 'invalid_reference' });
  });
});

describe('ops/paint: mask', () => {
  it('sets a fade with defaults, then replaces it', () => {
    const r = run([box, { op: 'mask', id: 'box', fade: {} }]);
    expect(r.doc.nodes.box!.mask).toEqual({ type: 'linear', angle: 90, from: 1, to: 0 });
    expect(r.results[1]).toMatchObject({ id: 'box' });
    const again = run([{ op: 'mask', id: 'box', fade: { type: 'radial', from: 0.8, to: 0.1 } }], r.doc);
    expect(again.doc.nodes.box!.mask).toEqual({ type: 'radial', angle: 90, from: 0.8, to: 0.1 });
  });

  it('removes the mask with fade null', () => {
    const r = run([box, { op: 'mask', id: 'box', fade: { angle: 0 } }, { op: 'mask', id: 'box', fade: null }]);
    expect(r.doc.nodes.box).not.toHaveProperty('mask');
  });

  it('resolves $last, and fails on an unknown id or an opacity outside 0..1', () => {
    expect(run([box, { op: 'mask', id: '$last', fade: {} }]).doc.nodes.box!.mask).toBeDefined();
    expect(error(run([{ op: 'mask', id: 'nope', fade: {} }]), 0)).toMatchObject({ code: 'unknown_id' });
    expect(error(run([box, { op: 'mask', id: 'box', fade: { from: 1.5 } }]), 1)).toMatchObject({ code: 'invalid_input' });
  });
});

describe('ops/paint: zero-extent targets', () => {
  const rule = { op: 'line', id: 'rule', x1: 10, y1: 40, x2: 200, y2: 40, style: { stroke: '#000000' } };
  const warned = (r: BatchResult, i: number) => {
    const o = r.results[i]!;
    return o.status === 'ok' ? o.warnings : [];
  };

  it.each([
    ['gradient', { op: 'gradient', id: 'g', stops: ['#000', '#fff'], ids: ['rule'], target: 'stroke' }],
    ['filter', { op: 'filter', id: 'f', blur: 2, ids: ['rule'] }],
    ['mask', { op: 'mask', id: 'rule', fade: { angle: 0 } }],
  ])('a %s on a horizontal line warns that it renders nothing, and still applies', (_, call) => {
    const r = run([rule, call]);
    expect(warned(r, 1)).toEqual([{ code: 'zero_extent', message: expect.stringMatching(/"rule" renders nothing.*non-zero width and height.*stroke color.*some area/) }]);
  });

  it('stays quiet for a shape with area, and when the mask is removed', () => {
    const r = run([box, { op: 'gradient', id: 'g', stops: ['#000', '#fff'], ids: ['box'] }, { op: 'filter', blur: 2, ids: ['box'] }, { op: 'mask', id: 'box', fade: {} }]);
    for (const i of [1, 2, 3]) expect(warned(r, i)).toEqual([]);
    expect(warned(run([rule, { op: 'mask', id: 'rule', fade: null }]), 1)).toEqual([]);
  });
});

describe('ops/paint: registry', () => {
  it('every example runs on an empty 800x600 document and ends with its op', () => {
    for (const def of [gradient, filter, mask]) {
      expect(def.examples.length).toBeGreaterThan(0);
      for (const example of def.examples) {
        expect(example.at(-1)?.op).toBe(def.name);
        expect(executeBatch(registry, createDocument({ width: 800, height: 600 }), example).ok).toBe(true);
      }
    }
  });

  it('the documents these ops make survive a JSON round trip through validateDocument', () => {
    const r = run([
      box,
      { op: 'gradient', id: 'g', type: 'radial', stops: ['brand', { color: '#fff', offset: 0.5 }, '#000'], focal: [0.3, 0.3], ids: ['box'] },
      { op: 'filter', id: 'f', blur: 3, shadow: { color: 'brand' }, ids: ['box'] },
      { op: 'mask', id: 'box', fade: { type: 'radial' } },
    ], doc({ brand: '#e76f51' }));
    expect(validateDocument(JSON.parse(JSON.stringify(r.doc)))).toEqual(r.doc);
  });
});
