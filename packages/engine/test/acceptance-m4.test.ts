import { describe, expect, it } from 'vitest';
import { createDocument, createRegistry, executeBatch, integrityProblem, toSvg, validateDocument, worldBounds } from '../src/index.ts';

const registry = createRegistry();
const SCENE = [
  { op: 'rect', id: 'sky', x: 0, y: 0, width: '100%', height: '100%', style: { fill: '#8ecae6' } },
  { op: 'path_commands', id: 'hills', d: 'M0 420 Q200 330 400 400 T800 380 V600 H0 Z', style: { fill: '#52b788' } },
  { op: 'star', id: 'sun', cx: 0, cy: 0, outer: 60, inner: 45, points: 12, style: { fill: '#ffb703' } },
  { op: 'place', ids: ['sun'], relative_to: 'canvas', anchor: 'top-right', offset: [-40, 40] },
  { op: 'rect', id: 'wall', x: 300, y: 330, width: 160, height: 110, style: { fill: '#f4f1de' } },
  { op: 'polygon', id: 'roof', cx: 380, cy: 300, radius: 95, sides: 3, style: { fill: '#e76f51' } },
  { op: 'place', ids: ['roof'], relative_to: 'wall', anchor: 'bottom', target_anchor: 'top' },
  { op: 'rect', id: 'door', x: 0, y: 0, width: 36, height: 60, radius: 6, style: { fill: '#6d597a' } },
  { op: 'place', ids: ['door'], relative_to: 'wall', anchor: 'bottom', target_anchor: 'bottom' },
  { op: 'group', id: 'house', ids: ['wall', 'roof', 'door'] },
  { op: 'path_from_points', id: 'cloud_base', points: [[100, 120], [140, 90], [190, 100], [220, 130]], mode: 'smooth', closed: true, style: { fill: '#ffffff' } },
  { op: 'ellipse', id: 'puff', cx: 160, cy: 100, rx: 35 },
  { op: 'boolean', mode: 'union', ids: ['cloud_base', 'puff'], id: 'cloud' },
  { op: 'duplicate', ids: ['cloud'], offset: [380, 40], id: 'cloud_2' },
  { op: 'transform', ids: ['house'], rotate: -2 },
  { op: 'align', ids: ['cloud', 'cloud_2'], edge: 'top' },
];

describe('M4 acceptance', () => {
  it('every op reports ok with exact world bounds where it targets one node', () => {
    const r = executeBatch(registry, createDocument({ width: 800, height: 600, seed: 3 }), SCENE);
    expect(r.ok).toBe(true);
    expect(integrityProblem(r.doc)).toBeNull();
    for (const [i, outcome] of r.results.entries()) {
      if ('id' in outcome && outcome.id) {
        const b = outcome.bounds!;
        expect(b, `op ${i} (${outcome.op})`).not.toBeNull();
        for (const v of [b.x, b.y, b.width, b.height]) expect(Number.isFinite(v)).toBe(true);
      }
    }
    expect(worldBounds(r.doc, 'door')!.y + worldBounds(r.doc, 'door')!.height).toBeCloseTo(440, 0);
    expect(validateDocument(JSON.parse(JSON.stringify(r.doc)))).toEqual(r.doc);
  });

  it('is deterministic', () => {
    const a = executeBatch(registry, createDocument({ width: 800, height: 600, seed: 3 }), SCENE);
    const b = executeBatch(registry, createDocument({ width: 800, height: 600, seed: 3 }), SCENE);
    expect(toSvg(a.doc)).toBe(toSvg(b.doc));
  });
});
