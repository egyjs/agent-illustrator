import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/ops/index.ts';
import { executeBatch } from '../../src/ops/registry.ts';
import { exportSvg } from '../../src/render/export.ts';
import { toSvg } from '../../src/render/svg.ts';
import { createDocument, type Doc } from '../../src/scene/model.ts';
import { expectCode } from '../fixtures.ts';

const registry = createRegistry();
function scene(): Doc {
  const doc: Doc = { ...createDocument({ width: 800, height: 600, background: 'white' }), tokens: { 'palette.sun': '#ffb703' } };
  const r = executeBatch(registry, doc, [
    { op: 'rect', id: 'sky', x: 0, y: 0, width: '100%', height: '60%', style: { fill: '#8ecae6' } },
    { op: 'ellipse', id: 'sun', cx: 600.123456, cy: 120, rx: 50, style: { fill: 'palette.sun' } },
    { op: 'rect', id: 'door', x: 180, y: 330, width: 40, height: 50 },
    { op: 'group', id: 'home', ids: ['door'] },
  ]);
  expect(r.ok).toBe(true);
  return r.doc;
}

describe('render/export', () => {
  it('optimizes with SVGO but keeps ids, groups and the viewBox', () => {
    const raw = toSvg(scene(), { precision: 2 });
    const out = exportSvg(scene());
    expect(out.startsWith('<svg')).toBe(true);
    expect(out.length).toBeLessThan(raw.length);
    for (const id of ['sky', 'sun', 'door', 'home']) expect(out).toContain(`id="${id}"`);
    expect(out).toContain('viewBox="0 0 800 600"');
    expect(out).not.toContain('palette.');
  });

  it('rounds to the requested precision', () => {
    expect(exportSvg(scene(), { precision: 0, optimize: false })).toContain('M650 120');
    expect(exportSvg(scene(), { precision: 3, optimize: false })).toContain('M650.123 120');
  });

  it('optimize: false returns the serializer output unchanged', () => {
    expect(exportSvg(scene(), { optimize: false })).toBe(toSvg(scene(), { precision: 2 }));
  });

  it('stripIds removes every id, optimized or not', () => {
    expect(exportSvg(scene(), { stripIds: true })).not.toContain('id=');
    expect(exportSvg(scene(), { stripIds: true, optimize: false })).not.toContain('id=');
  });

  it.each([false, true])('stripIds keeps a clipPath id and its reference so the clip survives (optimize: %s)', (optimize) => {
    const r = executeBatch(registry, createDocument({ width: 200, height: 100, background: 'white' }), [
      { op: 'rect', id: 'photo', x: 0, y: 0, width: 200, height: 100 },
      { op: 'ellipse', id: 'frame', cx: 100, cy: 50, rx: 40 },
      { op: 'clip', id: 'photo', shape: 'frame' },
    ]);
    expect(r.ok).toBe(true);
    const out = exportSvg(r.doc, { stripIds: true, optimize });
    const ids = [...out.matchAll(/ id="([^"]*)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(1);
    expect(out).toContain(`<clipPath id="${ids[0]}"`);
    expect(out).toContain(`clip-path="url(#${ids[0]})"`);
    expect(out).not.toContain('id="photo"');
  });

  it('rejects a precision outside 0..6', () => {
    expectCode(() => exportSvg(scene(), { precision: 7 }), 'invalid_input');
    expectCode(() => exportSvg(scene(), { precision: 1.5 }), 'invalid_input');
  });
});
