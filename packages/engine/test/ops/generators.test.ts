import { describe, expect, it } from 'vitest';
import { polyline } from '../../src/geometry/paths.ts';
import { IDENTITY } from '../../src/geometry/transform.ts';
import type { Box } from '../../src/geometry/types.ts';
import { blob, roughen, wave } from '../../src/ops/generators.ts';
import { executeBatch, Registry, type BatchOptions, type BatchResult } from '../../src/ops/registry.ts';
import { rect } from '../../src/ops/shapes.ts';
import { toSvg } from '../../src/render/svg.ts';
import { createDocument, type Doc, type PathNode, type TextNode } from '../../src/scene/model.ts';
import { worldBounds, worldSubpaths } from '../../src/scene/query.ts';
import { docOf, expectIntact, groupNode, pathNode } from '../fixtures.ts';

const registry = new Registry().register(blob, wave, roughen, rect);
const fresh = (seed = 1): Doc => createDocument({ width: 800, height: 600, seed });
function run(ops: unknown[], doc: Doc = fresh(), options: BatchOptions = {}): BatchResult {
  const r = executeBatch(registry, doc, ops, options);
  expectIntact(r.doc);
  return r;
}
const pathOf = (r: BatchResult, id: string) => r.doc.nodes[id] as PathNode;
const boundsOf = (r: BatchResult, id: string) => worldBounds(r.doc, id) as Box;
const textNode = (id: string, parent: string | null): TextNode => ({
  id,
  type: 'text',
  parent,
  transform: IDENTITY,
  style: {},
  content: 'hi',
  font: { family: 'sans-serif', size: 16, weight: 400, letterSpacing: 0 },
  anchor: 'start',
  direction: 'ltr',
  lineHeight: 1.2,
  at: { kind: 'point', x: 0, y: 0 },
  ink: null,
});
/** Every number of a node's geometry in canvas space, flattened. */
const flat = (doc: Doc, id: string) => worldSubpaths(doc, doc.nodes[id] as PathNode).flatMap((sp) => [...sp.start, ...sp.segs.flat()]);

describe('ops/generators: blob', () => {
  const BLOB = { op: 'blob', id: 'b', cx: 400, cy: 300, radius: 100 };

  it('is deterministic per document seed and id; a seed override or another id changes it', () => {
    const a = run([BLOB]), b = run([BLOB]);
    expect(pathOf(a, 'b').subpaths).toEqual(pathOf(b, 'b').subpaths);
    expect(pathOf(run([BLOB], fresh(2)), 'b').subpaths).not.toEqual(pathOf(a, 'b').subpaths);
    expect(pathOf(run([{ ...BLOB, seed: 99 }]), 'b').subpaths).not.toEqual(pathOf(a, 'b').subpaths);
    expect(pathOf(run([{ ...BLOB, id: 'other' }]), 'other').subpaths).not.toEqual(pathOf(a, 'b').subpaths);
    expect(pathOf(run([{ ...BLOB, seed: 1 }]), 'b').subpaths).toEqual(pathOf(a, 'b').subpaths);
  });

  it('is one closed smooth path with its parameters and seed in meta.source', () => {
    const n = pathOf(run([{ ...BLOB, points: 12, randomness: 0.2, frequency: 2 }]), 'b');
    expect(n.subpaths).toHaveLength(1);
    expect(n.subpaths[0]).toMatchObject({ closed: true });
    expect(n.subpaths[0]!.segs).toHaveLength(12);
    expect(n.meta?.source).toEqual({ kind: 'blob', cx: 400, cy: 300, radius: 100, points: 12, randomness: 0.2, frequency: 2, seed: 1 });
  });

  it('its anchors stay within radius·(1 ± randomness) and its bounds near them', () => {
    for (const randomness of [0, 0.3, 1]) {
      const r = run([{ ...BLOB, randomness, points: 16 }]);
      const radii = pathOf(r, 'b').subpaths[0]!.segs.map((s) => Math.hypot(s[4] - 400, s[5] - 300));
      for (const d of radii) {
        expect(d).toBeGreaterThanOrEqual(100 * (1 - randomness) - 1e-6);
        expect(d).toBeLessThanOrEqual(100 * (1 + randomness) + 1e-6);
      }
      const b = boundsOf(r, 'b');
      expect(b.width / 2).toBeLessThanOrEqual(100 * (1 + randomness) * 1.05);
      expect(b.height / 2).toBeLessThanOrEqual(100 * (1 + randomness) * 1.05);
      if (randomness === 0) expect(b).toMatchObject({ x: expect.closeTo(300, 0), width: expect.closeTo(200, 0) });
      else expect(new Set(radii.map((d) => d.toFixed(6))).size).toBeGreaterThan(1);
    }
  });

  it('accepts percent sizes and rejects a bad radius or point count', () => {
    const r = run([{ op: 'blob', cx: '50%', cy: '50%', radius: '10%', randomness: 0 }]);
    expect(r.results[0]).toMatchObject({ status: 'ok', id: 'blob-1', bounds: { x: expect.closeTo(340, 0), width: expect.closeTo(120, 0) } });
    expect(run([{ ...BLOB, radius: 0 }]).results[0]).toMatchObject({ status: 'error', error: { code: 'invalid_input' } });
    expect(run([{ ...BLOB, points: 2 }]).results[0]).toMatchObject({ status: 'error', error: { code: 'invalid_input' } });
    expect(run([{ ...BLOB, randomness: 1.5 }]).results[0]).toMatchObject({ status: 'error', error: { code: 'invalid_input' } });
    expect(run([{ ...BLOB, seed: 1.5 }]).results[0]).toMatchObject({ status: 'error', error: { code: 'invalid_input' } });
  });

  it('rejects a center and radius too large to draw instead of producing non-finite geometry', () => {
    const r = run([{ op: 'blob', cx: 1e308, cy: 300, radius: 1e308 }]);
    expect(r.results[0]).toMatchObject({ status: 'error', error: { code: 'invalid_input' } });
    expect(r.doc.root).toEqual([]);
  });
});

describe('ops/generators: wave', () => {
  const WAVE = { op: 'wave', id: 'w', x: 100, y: 300, width: 600, amplitude: 20, wavelength: 150 };

  it('stays within y ± amplitude and spans exactly x .. x + width', () => {
    const b = boundsOf(run([WAVE]), 'w');
    expect(b.x).toBeCloseTo(100, 6);
    expect(b.x + b.width).toBeCloseTo(700, 6);
    expect(b.y).toBeGreaterThanOrEqual(300 - 20 - 2);
    expect(b.y + b.height).toBeLessThanOrEqual(300 + 20 + 2);
    expect(b.height).toBeGreaterThan(2 * 20 - 2);
  });

  it('rises first, and phase shifts it', () => {
    const start = (phase: number) => pathOf(run([{ ...WAVE, phase }]), 'w').subpaths[0]!.start;
    expect(start(0)[1]).toBeCloseTo(300, 6);
    expect(start(90)[1]).toBeCloseTo(280, 6);
    expect(start(-90)[1]).toBeCloseTo(320, 6);
  });

  it('is an open curve by default and a closed band down to `bottom`', () => {
    const open = run([WAVE]);
    expect(pathOf(open, 'w').subpaths[0]).toMatchObject({ closed: false });
    const band = run([{ ...WAVE, bottom: 500 }]);
    const sp = pathOf(band, 'w').subpaths[0]!;
    expect(sp.closed).toBe(true);
    const last = sp.segs.at(-1)!;
    expect([last[4], last[5]]).toEqual(sp.start);
    expect(sp.segs.slice(-3).map((s) => [s[4], s[5]])).toEqual([[700, 500], [100, 500], sp.start]);
    const b = boundsOf(band, 'w');
    expect(b.y + b.height).toBeCloseTo(500, 6);
    expect(b.y).toBeGreaterThanOrEqual(300 - 20 - 2);
  });

  it('samples every wavelength/8, the last point clamped to x + width', () => {
    const sp = pathOf(run([{ ...WAVE, width: 100, wavelength: 64 }]), 'w').subpaths[0]!;
    expect(sp.segs).toHaveLength(13);
    expect(sp.segs.at(-1)!.slice(4)).toEqual([200, expect.any(Number)]);
    expect(sp.segs[0]!.slice(4)[0]).toBeCloseTo(108, 6);
  });

  it('accepts percent lengths, records its parameters, and rejects bad sizes', () => {
    const r = run([{ op: 'wave', x: 0, y: '50%', width: '50%', amplitude: '5%', wavelength: '25%', bottom: '100%' }]);
    expect(pathOf(r, 'wave-1').meta?.source).toEqual({ kind: 'wave', x: 0, y: 300, width: 400, amplitude: 30, wavelength: 200, phase: 0, bottom: 600 });
    for (const bad of [{ width: 0 }, { amplitude: 0 }, { wavelength: -5 }]) {
      expect(run([{ ...WAVE, ...bad }]).results[0]).toMatchObject({ status: 'error', error: { code: 'invalid_input' } });
    }
  });

  it('refuses more than 4000 points, and a wave that needs exactly that many still works', () => {
    const tooMany = run([{ ...WAVE, width: 800, wavelength: 1 }]);
    expect(tooMany.results[0]).toMatchObject({ status: 'error', error: { code: 'limit_exceeded' } });
    expect(JSON.stringify(tooMany.results[0])).toContain('longer wavelength');
    expect(run([{ ...WAVE, x: 0, width: 800, wavelength: 1.6 }]).results[0]).toMatchObject({ status: 'error', error: { code: 'limit_exceeded' } });
    expect(run([{ ...WAVE, x: 0, width: 799.8, wavelength: 1.6 }]).results[0]).toMatchObject({ status: 'ok' });
  });
});

describe('ops/generators: roughen', () => {
  const CARD = { op: 'rect', id: 'card', x: 200, y: 150, width: 400, height: 300 };
  const ROUGH = { op: 'roughen', ids: ['card'], amount: 8 };

  it('wobbles the outline within `amount`, keeps it closed, and returns the changed ids', () => {
    const before = run([CARD]);
    const r = run([CARD, ROUGH]);
    expect(r.results[1]).toMatchObject({ status: 'ok', ids: ['card'], warnings: [] });
    const after = pathOf(r, 'card');
    expect(after.subpaths).not.toEqual(pathOf(before, 'card').subpaths);
    expect(after.subpaths).toHaveLength(1);
    expect(after.subpaths[0]!.closed).toBe(true);
    expect(after.subpaths[0]!.segs.length).toBeGreaterThan(100);
    const b = boundsOf(r, 'card'), b0 = boundsOf(before, 'card');
    expect(Math.max(b0.x - b.x, b.x + b.width - b0.x - b0.width, b0.y - b.y, b.y + b.height - b0.y - b0.height)).toBeLessThanOrEqual(8 + 1);
    expect(Math.abs(b.width - b0.width) + Math.abs(b.height - b0.height)).toBeGreaterThan(0);
  });

  it('is deterministic per document seed, node id and seed override', () => {
    const geometry = (doc: Doc, extra = {}) => pathOf(run([CARD, { ...ROUGH, ...extra }], doc), 'card').subpaths;
    expect(geometry(fresh())).toEqual(geometry(fresh()));
    expect(geometry(fresh(2))).not.toEqual(geometry(fresh()));
    expect(geometry(fresh(), { seed: 5 })).not.toEqual(geometry(fresh()));
    expect(geometry(fresh(), { seed: 1 })).toEqual(geometry(fresh()));
    const other = run([{ ...CARD, id: 'other' }, { ...ROUGH, ids: ['other'] }]);
    expect(pathOf(other, 'other').subpaths).not.toEqual(geometry(fresh()));
  });

  it('keeps an open path open; its start moves along the normal only', () => {
    const doc = docOf([pathNode('p', [polyline([[0, 0], [100, 0], [200, 50]], false)])]);
    const r = run([{ op: 'roughen', ids: ['p'], amount: 3, detail: 10 }], doc);
    const sp = pathOf(r, 'p').subpaths[0]!;
    expect(sp.closed).toBe(false);
    expect(Math.abs(sp.start[0])).toBeLessThanOrEqual(0.001);
    expect(Math.abs(sp.start[1])).toBeLessThanOrEqual(3);
  });

  it('works in canvas units inside a scaled group, as on the same geometry at the top level', () => {
    const top = docOf([pathNode('r', [polyline([[100, 100], [300, 100], [300, 300], [100, 300]], true)])]);
    const scaled = docOf([
      groupNode('g', ['r'], { transform: [2, 0, 0, 2, 0, 0] }),
      pathNode('r', [polyline([[50, 50], [150, 50], [150, 150], [50, 150]], true)], { parent: 'g' }),
    ]);
    const a = run([{ op: 'roughen', ids: ['r'], amount: 10 }], top);
    const b = run([{ op: 'roughen', ids: ['g'], amount: 10 }], scaled);
    expect(b.results[0]).toMatchObject({ ids: ['r'] });
    const fa = flat(a.doc, 'r'), fb = flat(b.doc, 'r');
    expect(fb).toHaveLength(fa.length);
    fa.forEach((v, i) => expect(fb[i]).toBeCloseTo(v, 6));
    const bounds = boundsOf(b, 'g');
    expect(Math.max(100 - bounds.x, bounds.x + bounds.width - 300, 100 - bounds.y, bounds.y + bounds.height - 300)).toBeLessThanOrEqual(10 + 1);
    expect(Math.max(100 - bounds.x, bounds.x + bounds.width - 300, 100 - bounds.y, bounds.y + bounds.height - 300)).toBeGreaterThan(2);
  });

  it('reaches every path in a group once, and skips text with a warning', () => {
    const doc = docOf([
      groupNode('g', ['a', 'b', 't']),
      pathNode('a', [polyline([[0, 0], [60, 0], [60, 60]], true)], { parent: 'g' }),
      pathNode('b', [polyline([[100, 0], [160, 0], [160, 60]], true)], { parent: 'g' }),
      textNode('t', 'g'),
    ]);
    const r = run([{ op: 'roughen', ids: ['g', 'a'], amount: 2, detail: 10 }], doc);
    expect(r.results[0]).toMatchObject({ status: 'ok', ids: ['a', 'b'], warnings: [{ code: 'text_skipped' }] });
    expect(r.doc.nodes.t).toBe(doc.nodes.t);
    expect(pathOf(r, 'a').subpaths).not.toEqual((doc.nodes.a as PathNode).subpaths);
    const onlyText = run([{ op: 'roughen', ids: ['t'], amount: 2 }], doc);
    expect(onlyText.results[0]).toMatchObject({ status: 'ok', ids: [], warnings: [{ code: 'text_skipped' }, { code: 'no_paths' }] });
  });

  it('errors with a hint on a segment overflow, a bad amount, a flat group and an unknown id', () => {
    const base = run([CARD]);
    const tight = run([ROUGH], base.doc, { limits: { maxSegmentsPerPath: 50 } });
    expect(tight.results[0]).toMatchObject({ status: 'error', error: { code: 'limit_exceeded' } });
    expect(JSON.stringify(tight.results[0])).toContain('larger detail');
    expect(tight.doc).toBe(base.doc);
    expect(run([{ ...ROUGH, detail: 40 }], base.doc, { limits: { maxSegmentsPerPath: 50 } }).results[0]).toMatchObject({ status: 'ok' });
    expect(run([{ ...ROUGH, amount: 0 }], base.doc).results[0]).toMatchObject({ error: { code: 'invalid_input' } });
    expect(run([{ ...ROUGH, detail: 0 }], base.doc).results[0]).toMatchObject({ error: { code: 'invalid_input' } });
    expect(run([{ ...ROUGH, ids: ['nope'] }], base.doc).results[0]).toMatchObject({ error: { code: 'unknown_id' } });
    const flatDoc = docOf([groupNode('f', ['r'], { transform: [0, 0, 0, 0, 0, 0] }), pathNode('r', [polyline([[0, 0], [10, 0], [10, 10]], true)], { parent: 'f' })]);
    expect(run([{ op: 'roughen', ids: ['f'], amount: 1 }], flatDoc).results[0]).toMatchObject({ error: { code: 'invalid_structure' } });
  });

  it('counts the segments of every path in the op against one path\'s limit', () => {
    const two = run([CARD, { ...CARD, id: 'card2' }]);
    const limits = { limits: { maxSegmentsPerPath: 300 } };
    expect(run([{ ...ROUGH, ids: ['card'] }], two.doc, limits).results[0]).toMatchObject({ status: 'ok' });
    const both = run([{ ...ROUGH, ids: ['card', 'card2'] }], two.doc, limits);
    expect(both.results[0]).toMatchObject({ status: 'error', error: { code: 'limit_exceeded', message: expect.stringContaining('2 path(s)') } });
    expect(both.doc).toBe(two.doc);
    expect(run([{ ...ROUGH, ids: ['card', 'card2'], detail: 12 }], two.doc, limits).results[0]).toMatchObject({ status: 'ok' });
  });

  it('leaves a zero-length path alone', () => {
    const dot = pathNode('dot', [{ start: [5, 5], segs: [], closed: false }]);
    const r = run([{ op: 'roughen', ids: ['dot'], amount: 2 }], docOf([dot]));
    expect(pathOf(r, 'dot').subpaths).toEqual(dot.subpaths);
  });
});

describe('ops/generators: all together', () => {
  it('every example runs on an empty canvas', () => {
    for (const def of registry.list()) {
      for (const example of def.examples) {
        expect(executeBatch(registry, fresh(), example).ok).toBe(true);
      }
    }
  });

  it('matches the SVG snapshot', () => {
    const r = run(
      [
        { op: 'blob', id: 'cloud', cx: 220, cy: 160, radius: 90, style: { fill: '#a8dadc' } },
        { op: 'wave', id: 'sea', x: 0, y: 420, width: '100%', amplitude: 16, wavelength: 180, bottom: '100%', style: { fill: '#457b9d' } },
        { op: 'rect', id: 'card', x: 440, y: 80, width: 280, height: 180, style: { fill: '#f4a261', stroke: '#264653', strokeWidth: 3 } },
        { op: 'roughen', ids: ['card'], amount: 5, detail: 20 },
      ],
      fresh(42),
    );
    expect(toSvg(r.doc)).toMatchSnapshot();
  });
});
