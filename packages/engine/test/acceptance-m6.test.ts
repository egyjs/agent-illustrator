import { describe, expect, it } from 'vitest';
import { createDocument, createRegistry, DEFAULT_LIMITS, executeBatch, integrityProblem, rasterize, toSvg, validateDocument, worldBounds, type BatchResult, type GroupNode } from '../src/index.ts';

const registry = createRegistry();
// No call below sets a seed, so the document seed drives the blob, the scatter and the roughening.
const SCENE = [
  { op: 'blob', id: 'island', cx: 400, cy: 300, radius: 200, points: 10, randomness: 0.3, style: { fill: '#b7e4c7' } },
  { op: 'wave', id: 'sea', x: 0, y: 480, width: '100%', amplitude: 14, wavelength: 160, bottom: '100%', style: { fill: '#457b9d' } },
  { op: 'ellipse', id: 'leaf', cx: 0, cy: 0, rx: 8, ry: 4, style: { fill: '#2a9d8f' } },
  { op: 'scatter', id: 'foliage', source: 'leaf', within: 'island', min_distance: 36, scale: [0.6, 1.4], rotate: [0, 360] },
  { op: 'wave', id: 'ripple', x: 0, y: 120, width: '100%', amplitude: 20, wavelength: 200, style: { fill: 'none', stroke: '#264653', strokeWidth: 2 } },
  { op: 'ellipse', id: 'bead', cx: 0, cy: 0, rx: 6, style: { fill: '#e9c46a' } },
  { op: 'repeat_along_path', id: 'beads', source: 'bead', path: 'ripple', spacing: 40 },
  { op: 'rect', id: 'tile', x: 40, y: 520, width: 30, height: 20, style: { fill: '#e76f51' } },
  { op: 'array', id: 'tiles', source: 'tile', kind: 'grid', rows: 2, cols: 5, gap: [6, 6] },
  { op: 'rect', id: 'tick', x: 695, y: 30, width: 10, height: 24, style: { fill: '#264653' } },
  { op: 'array', id: 'rays', source: 'tick', kind: 'radial', count: 12, center: [700, 90] },
  { op: 'rect', id: 'card', x: 40, y: 380, width: 160, height: 100, style: { fill: '#f4a261' } },
  { op: 'roughen', ids: ['card'], amount: 4, detail: 12 },
];
const fresh = (seed: number) => createDocument({ width: 800, height: 600, seed });
const run = (seed = 3): BatchResult => executeBatch(registry, fresh(seed), SCENE);
const children = (r: BatchResult, id: string) => (r.doc.nodes[id] as GroupNode).children;

describe('M6 acceptance', () => {
  it('every op reports ok with finite bounds', () => {
    const r = run();
    expect(r.ok).toBe(true);
    expect(integrityProblem(r.doc)).toBeNull();
    for (const [i, outcome] of r.results.entries()) {
      expect(outcome.status, `op ${i}`).toBe('ok');
      if (outcome.status !== 'ok') continue;
      for (const b of [outcome.bounds, ...Object.values(outcome.boundsById ?? {})]) {
        if (b === undefined) continue;
        expect(b, `op ${i} (${outcome.op})`).not.toBeNull();
        for (const v of [b!.x, b!.y, b!.width, b!.height]) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('the generators make the copies they promise and consume their sources', () => {
    const r = run();
    expect(children(r, 'foliage').length).toBeGreaterThan(10);
    expect(children(r, 'tiles')).toHaveLength(10);
    expect(children(r, 'rays')).toHaveLength(12);
    // A 800-wide wave of wavelength 200 and amplitude 20 is a little over 800 long: a bead every 40 units.
    expect(children(r, 'beads').length).toBeGreaterThanOrEqual(20);
    for (const gone of ['leaf', 'bead', 'tile', 'tick']) expect(r.doc.nodes[gone], gone).toBeUndefined();
    // The guides stay.
    for (const kept of ['island', 'ripple']) expect(r.doc.nodes[kept], kept).toBeDefined();
  });

  it('every scattered leaf is centered inside the blob', () => {
    const r = run();
    const island = worldBounds(r.doc, 'island')!;
    for (const id of children(r, 'foliage')) {
      const b = worldBounds(r.doc, id)!;
      const [cx, cy] = [b.x + b.width / 2, b.y + b.height / 2];
      expect(cx, id).toBeGreaterThan(island.x);
      expect(cx, id).toBeLessThan(island.x + island.width);
      expect(cy, id).toBeGreaterThan(island.y);
      expect(cy, id).toBeLessThan(island.y + island.height);
    }
  });

  it('the same seed gives the identical SVG; a different document seed gives a different one', () => {
    const a = toSvg(run(3).doc);
    expect(toSvg(run(3).doc)).toBe(a);
    expect(toSvg(run(4).doc)).not.toBe(a);
  });

  it('survives a JSON round trip', () => {
    const { doc } = run();
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('rasterizes', () => {
    const img = rasterize(run().doc);
    expect([img.width, img.height]).toEqual([800, 600]);
    expect(Buffer.from(img.png).subarray(1, 4).toString('ascii')).toBe('PNG');
    // Not a blank page: the sea at the bottom is drawn.
    expect([...img.pixels.subarray((595 * 800 + 400) * 4, (595 * 800 + 400) * 4 + 3)]).not.toEqual([255, 255, 255]);
  });
});

describe('M6 acceptance: performance', () => {
  it('scatters max_count = maxGenerated (2000) copies over 4000 × 4000 with min_distance 40 in under 5 s', { timeout: 60_000 }, () => {
    const doc = createDocument({ width: 4000, height: 4000, seed: 11 });
    const ops = [
      { op: 'ellipse', id: 'dot', cx: 0, cy: 0, rx: 4 },
      { op: 'scatter', id: 'field', source: 'dot', region: { x: 0, y: 0, width: 4000, height: 4000 }, min_distance: 40, max_count: DEFAULT_LIMITS.maxGenerated },
    ];
    const t0 = performance.now();
    const r = executeBatch(registry, doc, ops);
    const ms = performance.now() - t0;
    expect(r.ok, JSON.stringify(r.results.at(-1))).toBe(true);
    expect(children(r, 'field')).toHaveLength(DEFAULT_LIMITS.maxGenerated);
    expect(integrityProblem(r.doc)).toBeNull();
    expect(ms, `scatter took ${ms.toFixed(0)} ms`).toBeLessThan(5000);
  });

  it('asking for one copy more than maxGenerated is a limit_exceeded error, not a slow run', () => {
    const ops = [
      { op: 'ellipse', id: 'dot', cx: 0, cy: 0, rx: 4 },
      { op: 'scatter', source: 'dot', region: { x: 0, y: 0, width: 4000, height: 4000 }, min_distance: 40, max_count: DEFAULT_LIMITS.maxGenerated + 1 },
    ];
    const r = executeBatch(registry, createDocument({ width: 4000, height: 4000 }), ops);
    expect(r.ok).toBe(false);
    expect(r.results.at(-1)).toMatchObject({ status: 'error', error: { code: 'limit_exceeded' } });
  });
});
