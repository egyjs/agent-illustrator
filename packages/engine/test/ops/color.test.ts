import { describe, expect, it } from 'vitest';
import { palette, tokens } from '../../src/ops/color.ts';
import { executeBatch, Registry, type BatchResult } from '../../src/ops/registry.ts';
import { rect } from '../../src/ops/shapes.ts';
import { style } from '../../src/ops/style.ts';
import { toSvg } from '../../src/render/svg.ts';
import { createDocument, validateDocument, type Doc } from '../../src/scene/model.ts';
import { expectIntact } from '../fixtures.ts';

const registry = new Registry().register(tokens, palette, rect, style);
const blank = (): Doc => createDocument({ width: 800, height: 600 });
function run(ops: unknown[], doc: Doc = blank()): BatchResult {
  const r = executeBatch(registry, doc, ops);
  expectIntact(r.doc);
  return r;
}
const withDefs = (): Doc => ({ ...blank(), defs: { sky: { kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }] } } });

describe('ops/color tokens', () => {
  it('sets tokens, keeps what the caller wrote, and reports the resolved hex', () => {
    const r = run([{ op: 'tokens', set: { 'brand.ink': '#264653', 'brand.sun': 'oklch(0.85 0.17 85)', soft: 'rgb(0 0 0 / 50%)' } }]);
    expect(r.ok).toBe(true);
    expect(r.doc.tokens).toEqual({ 'brand.ink': '#264653', 'brand.sun': 'oklch(0.85 0.17 85)', soft: 'rgb(0 0 0 / 50%)' });
    expect(r.results[0]).toMatchObject({
      data: { tokens: { 'brand.ink': '#264653', 'brand.sun': expect.stringMatching(/^#[0-9a-f]{6}$/), soft: 'rgba(0, 0, 0, 0.5)' } },
    });
  });

  it('merges into existing tokens and replaces the ones it names', () => {
    const first = run([{ op: 'tokens', set: { a: '#111111', b: '#222222' } }]);
    const r = run([{ op: 'tokens', set: { b: '#333333', c: '#444444' } }], first.doc);
    expect(r.doc.tokens).toEqual({ a: '#111111', b: '#333333', c: '#444444' });
  });

  it('rejects a bad name, a non-color, none and a def name, with a hint and no change', () => {
    const cases: [Record<string, string>, string][] = [
      [{ 'bad name': '#fff' }, 'invalid_input'],
      [{ __hidden: '#fff' }, 'invalid_input'],
      [{ canvas: '#fff' }, 'invalid_input'],
      [{ ink: 'not-a-color' }, 'invalid_color'],
      [{ ink: 'none' }, 'invalid_color'],
    ];
    for (const [set, code] of cases) {
      const r = run([{ op: 'tokens', set }]);
      expect(r.results[0]).toMatchObject({ status: 'error', error: { code, hint: expect.any(String) } });
      expect(r.doc.tokens).toEqual({});
    }
    expect(run([{ op: 'tokens', set: { sky: '#fff' } }], withDefs()).results[0]).toMatchObject({ error: { code: 'invalid_input', hint: expect.stringContaining('another') } });
  });

  it('needs 1 to 200 entries', () => {
    expect(run([{ op: 'tokens', set: {} }]).results[0]).toMatchObject({ error: { code: 'invalid_input' } });
    const many = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`t${i}`, '#000000']));
    expect(run([{ op: 'tokens', set: many }]).results[0]).toMatchObject({ error: { code: 'limit_exceeded' } });
    const ok = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`t${i}`, '#000000']));
    expect(run([{ op: 'tokens', set: ok }]).ok).toBe(true);
  });

  it('rolls back the whole batch when one token is bad', () => {
    const r = run([{ op: 'tokens', set: { good: '#fff' } }, { op: 'tokens', set: { bad: 'nope' } }]);
    expect(r.ok).toBe(false);
    expect(r.doc.tokens).toEqual({});
    expect(r.results.map((o) => o.status)).toEqual(['rolled_back', 'error']);
  });
});

describe('ops/color palette', () => {
  it('writes the tokens it reports, with the default analogous harmony and 5 steps', () => {
    const r = run([{ op: 'palette', base: '#2a9d8f' }]);
    const names = Object.keys(r.doc.tokens);
    expect(names).toHaveLength(3 * 6 + 5);
    expect(names).toContain('palette.primary');
    expect(names).toContain('palette.tertiary.5');
    expect(names).toContain('palette.neutral.1');
    expect(r.results[0]).toMatchObject({ data: { tokens: r.doc.tokens } });
  });

  it('honors harmony, steps and prefix', () => {
    const r = run([{ op: 'palette', base: 'teal', harmony: 'complementary', steps: 3, prefix: 'brand' }]);
    expect(Object.keys(r.doc.tokens)).toEqual([
      'brand.primary', 'brand.primary.1', 'brand.primary.2', 'brand.primary.3',
      'brand.accent', 'brand.accent.1', 'brand.accent.2', 'brand.accent.3',
      'brand.neutral.1', 'brand.neutral.2', 'brand.neutral.3',
    ]);
  });

  it('takes a token as its base', () => {
    const r = run([{ op: 'tokens', set: { 'brand.ink': '#264653' } }, { op: 'palette', base: 'brand.ink', harmony: 'monochrome', prefix: 'ink' }]);
    expect(r.ok).toBe(true);
    expect(r.doc.tokens['ink.primary']).toBe('#264653');
  });

  it('rejects a base that is neither color nor token, a bad prefix, and a def name', () => {
    expect(run([{ op: 'palette', base: 'nope' }]).results[0]).toMatchObject({ error: { code: 'invalid_color', hint: expect.any(String) } });
    for (const prefix of ['bad prefix', '9lives', 'x'.repeat(53)]) {
      expect(run([{ op: 'palette', base: '#2a9d8f', prefix }]).results[0]).toMatchObject({ error: { code: 'invalid_input', hint: expect.stringContaining('prefix') } });
    }
    expect(run([{ op: 'palette', base: '#2a9d8f', prefix: 'x'.repeat(52) }]).ok).toBe(true);
    const clash = { ...withDefs(), defs: { 'palette.primary': withDefs().defs.sky! } };
    expect(run([{ op: 'palette', base: '#2a9d8f' }], clash).results[0]).toMatchObject({ error: { code: 'invalid_input' } });
  });

  it('rejects steps outside 3 to 9 and unknown harmonies', () => {
    for (const bad of [{ steps: 2 }, { steps: 10 }, { steps: 4.5 }, { harmony: 'tetradic' }]) {
      expect(run([{ op: 'palette', base: '#2a9d8f', ...bad }]).results[0]).toMatchObject({ status: 'error', error: { code: 'invalid_input' } });
    }
  });

  it('warns when it changes existing tokens, and stays quiet on a repeat', () => {
    const first = run([{ op: 'palette', base: '#2a9d8f' }]);
    expect(first.results[0]).toMatchObject({ warnings: [] });
    const again = run([{ op: 'palette', base: '#2a9d8f' }], first.doc);
    expect(again.results[0]).toMatchObject({ warnings: [] });
    const changed = run([{ op: 'palette', base: '#e76f51' }], first.doc);
    expect(changed.results[0]).toMatchObject({ warnings: [{ code: 'tokens_replaced', message: expect.stringMatching(/^\d+ existing token/) }] });
  });
});

describe('ops/color live tokens', () => {
  it('a fill that names a palette token renders its hex, and follows later token changes', () => {
    const r = run([
      { op: 'palette', base: '#2a9d8f' },
      { op: 'rect', id: 'box', x: 0, y: 0, width: 50, height: 50, style: { fill: 'palette.primary.3' } },
    ]);
    const hex = r.doc.tokens['palette.primary.3']!;
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(toSvg(r.doc)).toContain(`fill="${hex}"`);
    const recolored = run([{ op: 'tokens', set: { 'palette.primary.3': '#ff0000' } }], r.doc);
    expect(toSvg(recolored.doc)).toContain('fill="#ff0000"');
    expect(toSvg(recolored.doc)).not.toContain(`fill="${hex}"`);
    expect(recolored.doc.nodes.box!.style.fill).toBe('palette.primary.3');
  });

  it('survives a JSON round trip', () => {
    const r = run([{ op: 'palette', base: '#2a9d8f', harmony: 'triadic' }, { op: 'tokens', set: { ink: 'oklch(0.3 0.05 230)' } }]);
    expect(validateDocument(JSON.parse(JSON.stringify(r.doc)))).toEqual(r.doc);
  });
});

describe('ops/color examples', () => {
  it('every example runs on an empty canvas and ends with its op', () => {
    for (const def of registry.list().filter((d) => d.domain === 'color')) {
      expect(def.examples.length).toBeGreaterThan(0);
      for (const example of def.examples) {
        expect(example.at(-1)!.op).toBe(def.name);
        expect(executeBatch(registry, blank(), example).ok).toBe(true);
      }
    }
  });
});
