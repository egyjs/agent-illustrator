import { describe, expect, it } from 'vitest';
import { contrastRatio, createDocument, createRegistry, executeBatch, exportSvg, integrityProblem, rasterize, toSvg, validateDocument, type BatchResult } from '../src/index.ts';

const registry = createRegistry();
const SCENE = [
  { op: 'palette', base: '#2a9d8f', harmony: 'complementary', prefix: 'brand' },
  { op: 'tokens', set: { ink: '#264653', paper: '#fefae0' } },
  { op: 'rect', id: 'bg', x: 0, y: 0, width: '100%', height: '100%' },
  { op: 'gradient', id: 'bg_fade', stops: ['brand.primary.1', 'brand.accent.2'], angle: 90, ids: ['bg'] },
  { op: 'ellipse', id: 'orb', cx: 400, cy: 220, rx: 120 },
  { op: 'gradient', id: 'orb_glow', type: 'radial', stops: [{ color: 'paper', offset: 0 }, { color: 'brand.accent', offset: 0.6 }, 'brand.primary'], focal: [0.4, 0.4], ids: ['orb'] },
  { op: 'rect', id: 'card', x: 480, y: 340, width: 260, height: 180, radius: 16, style: { fill: 'paper' } },
  { op: 'filter', id: 'lift', shadow: { dy: 8, blur: 12, color: 'ink' }, ids: ['card'] },
  { op: 'rect', id: 'tint', x: 40, y: 340, width: 360, height: 180, style: { fill: 'brand.accent' } },
  { op: 'style', ids: ['tint'], style: { blend: 'multiply', opacity: 0.8 } },
  { op: 'rect', id: 'banner', x: 40, y: 40, width: 400, height: 80, style: { fill: 'ink' } },
  { op: 'mask', id: 'banner', fade: { angle: 0, from: 1, to: 0 } },
];
const fresh = () => createDocument({ width: 800, height: 600, seed: 5 });
const run = (): BatchResult => executeBatch(registry, fresh(), SCENE);

/** Every `url(#id)` in the SVG, and the ids the SVG defines. */
const urlTargets = (svg: string): string[] => [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]!);
const definedIds = (svg: string): Set<string> => new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));

describe('M5 acceptance', () => {
  it('every op reports ok, with finite bounds where it targets nodes', () => {
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

  it('palette, tokens and gradient report their results in data', () => {
    const r = run();
    const [pal, tok, , lin, , rad, , flt] = r.results;
    expect(pal).toMatchObject({ op: 'palette', data: { tokens: { 'brand.primary': expect.stringMatching(/^#[0-9a-f]{6}$/i), 'brand.accent': expect.any(String), 'brand.primary.1': expect.any(String) } } });
    expect(tok).toMatchObject({ op: 'tokens', data: { tokens: { ink: '#264653', paper: '#fefae0' } } });
    expect(lin).toMatchObject({ op: 'gradient', ids: ['bg'], data: { def: 'bg_fade' } });
    expect(rad).toMatchObject({ op: 'gradient', ids: ['orb'], data: { def: 'orb_glow' } });
    expect(flt).toMatchObject({ op: 'filter', ids: ['card'], data: { def: 'lift' } });
    expect(r.doc.tokens).toMatchObject({ ink: '#264653', 'brand.primary': expect.any(String), 'brand.accent': expect.any(String), 'brand.neutral.1': expect.any(String) });
    expect(r.doc.nodes.bg!.style.fill).toBe('bg_fade');
  });

  it('the SVG carries the gradients, filter, mask and blend mode', () => {
    const svg = toSvg(run().doc);
    for (const needle of ['<linearGradient', '<radialGradient', '<filter', '<mask', 'mix-blend-mode:multiply']) expect(svg, needle).toContain(needle);
    expect(svg).toContain('fill="url(#');
    expect(svg).toContain('filter="url(#');
    expect(svg).toContain('mask="url(#');
  });

  it('every url(#…) target is defined, in toSvg and in exportSvg with and without stripIds', () => {
    const { doc } = run();
    const outputs = { toSvg: toSvg(doc), export: exportSvg(doc), 'export (precision 0)': exportSvg(doc, { precision: 0 }), 'export (stripIds)': exportSvg(doc, { stripIds: true }), 'export (not optimized, stripIds)': exportSvg(doc, { optimize: false, stripIds: true }) };
    for (const [name, svg] of Object.entries(outputs)) {
      const targets = urlTargets(svg);
      expect(targets.length, name).toBeGreaterThanOrEqual(4); // two gradients, a filter and a mask
      const defined = definedIds(svg);
      for (const target of targets) expect(defined.has(target), `${name}: url(#${target}) has no matching id`).toBe(true);
    }
  });

  it('stripIds keeps only the ids that something points at', () => {
    const { doc } = run();
    const svg = exportSvg(doc, { stripIds: true });
    const referenced = new Set(urlTargets(svg));
    for (const id of definedIds(svg)) expect(referenced.has(id), `id "${id}" is not referenced`).toBe(true);
  });

  it('rasterizes, and the gradient is what gets drawn', () => {
    const { doc } = run();
    const img = rasterize(doc);
    expect([img.width, img.height]).toEqual([800, 600]);
    expect(Buffer.from(img.png).subarray(1, 4).toString('ascii')).toBe('PNG');
    const px = (x: number, y: number) => [...img.pixels.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];
    // The background ramps top to bottom through light primary to the accent, so two bare corners differ.
    expect(px(5, 5)).not.toEqual(px(5, 595));
    // The multiply tint at 80% is not the background underneath it.
    const bare = rasterize(createDocument({ width: 800, height: 600, background: '#ffffff' }));
    expect(px(100, 400)).not.toEqual([...bare.pixels.subarray((400 * 800 + 100) * 4, (400 * 800 + 100) * 4 + 3)]);
  });

  it('is deterministic, and survives a JSON round trip', () => {
    const a = run();
    const b = run();
    expect(toSvg(a.doc)).toBe(toSvg(b.doc));
    expect(exportSvg(a.doc)).toBe(exportSvg(b.doc));
    expect(validateDocument(JSON.parse(JSON.stringify(a.doc)))).toEqual(a.doc);
  });

  it('recoloring a token recolors every shape that uses it', () => {
    const { doc } = run();
    const before = toSvg(doc);
    const after = toSvg(executeBatch(registry, doc, [{ op: 'tokens', set: { paper: '#001122' } }]).doc);
    expect(after).not.toBe(before);
    expect(after).toContain('#001122');
    expect(before).not.toContain('#001122');
  });
});

describe('M5 acceptance: contrast against the WCAG reference', () => {
  it('black on white is 21:1, and a color against itself is 1:1', () => {
    expect(contrastRatio('#000', '#fff')).toBe(21);
    expect(contrastRatio('#fff', '#000')).toBe(21);
    expect(contrastRatio('#336699', '#336699')).toBe(1);
  });

  it('matches published WCAG 2 values', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 1); // the lightest gray that passes AA on white
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
    expect(contrastRatio('#ff0000', '#ffffff')).toBeCloseTo(4, 1);
    expect(contrastRatio('#0000ff', '#ffffff')).toBeCloseTo(8.59, 1);
  });

  it('accepts names and returns undefined for a non-color', () => {
    expect(contrastRatio('black', 'white')).toBe(21);
    expect(contrastRatio('blurple', '#fff')).toBeUndefined();
  });
});
