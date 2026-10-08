import { describe, expect, it } from 'vitest';
import { createDocument, createRegistry, executeBatch, integrityProblem, toSvg, validateDocument } from '../src/index.ts';

const registry = createRegistry();
const SCENE = [
  { op: 'rect', id: 'sky', x: 0, y: 0, width: '100%', height: '60%', style: { fill: '#8ecae6' } },
  { op: 'rect', id: 'ground', x: 0, y: '60%', width: '100%', height: '40%', style: { fill: '#2a9d8f' } },
  { op: 'ellipse', id: 'sun', cx: '75%', cy: '20%', rx: 50, style: { fill: '#ffb703' } },
  { op: 'polygon', id: 'roof', cx: 200, cy: 280, radius: 60, sides: 3, style: { fill: '#e76f51' } },
  { op: 'rect', id: 'house', x: 150, y: 300, width: 100, height: 80, radius: 4, style: { fill: '#f4f1de' } },
  { op: 'line', id: 'path', x1: 200, y1: 380, x2: 260, y2: 600, style: { stroke: '#264653', strokeWidth: 4, strokeCap: 'round' } },
  { op: 'group', id: 'home', ids: ['roof', 'house'] },
  { op: 'style', ids: ['sun'], style: { opacity: 0.9 } },
];
const fresh = () => createDocument({ width: 800, height: 600, background: 'white', seed: 42 });

describe('M2 acceptance', () => {
  it('a batch with a mid-batch failure rolls back fully', () => {
    const doc = fresh();
    const r = executeBatch(registry, doc, [...SCENE, { op: 'delete', ids: ['nothing'] }, { op: 'rect', x: 0, y: 0, width: 1, height: 1 }]);
    expect(r.ok).toBe(false);
    expect(r.doc).toBe(doc);
    expect(r.results.map((o) => o.status)).toEqual([...SCENE.map(() => 'rolled_back'), 'error', 'skipped']);
    expect(toSvg(r.doc)).toBe(toSvg(doc));
  });

  it('the same seed and ops give an identical document and SVG', () => {
    const a = executeBatch(registry, fresh(), SCENE);
    const b = executeBatch(registry, fresh(), SCENE);
    expect(a.ok && b.ok).toBe(true);
    expect(JSON.stringify(a.doc)).toBe(JSON.stringify(b.doc));
    expect(toSvg(a.doc)).toBe(toSvg(b.doc));
  });

  it('a committed scene keeps its tree intact and survives a JSON round trip', () => {
    const { doc } = executeBatch(registry, fresh(), SCENE);
    expect(integrityProblem(doc)).toBeNull();
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('matches the SVG snapshot', () => {
    expect(toSvg(executeBatch(registry, fresh(), SCENE).doc)).toMatchSnapshot();
  });
});
