import { formatHex, interpolate } from 'culori';
import { describe, expect, it } from 'vitest';
import { executeBatch, Registry } from '../../src/ops/registry.ts';
import { rect } from '../../src/ops/shapes.ts';
import { style } from '../../src/ops/style.ts';
import { filter, gradient, mask } from '../../src/ops/paint.ts';
import { exportSvg } from '../../src/render/export.ts';
import { gradientStops } from '../../src/render/defs-svg.ts';
import { rasterize, type Raster } from '../../src/render/raster.ts';
import { toSvg } from '../../src/render/svg.ts';
import { createDocument, validateDocument, type Doc } from '../../src/scene/model.ts';
import { expectIntact } from '../fixtures.ts';

const registry = new Registry().register(rect, style, gradient, filter, mask);
const SIZE = { width: 100, height: 50 };

function build(ops: unknown[], tokens: Record<string, string> = {}): Doc {
  const r = executeBatch(registry, { ...createDocument(SIZE), tokens }, ops);
  if (!r.ok) throw new Error(JSON.stringify(r.results));
  expectIntact(r.doc);
  return r.doc;
}
const full = { op: 'rect', id: 'box', x: 0, y: 0, width: '100%', height: '100%' };
const rgb = (img: Raster, x: number, y: number) => Array.from(img.pixels.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));
const identity = (c: string) => c;

describe('render/defs-svg: gradientStops', () => {
  it('fills out to 5 stops from 2 and 9 from 5, keeping the given stops exactly', () => {
    const two = gradientStops([{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }], identity);
    expect(two.map((s) => s.offset)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect([two[0]!.color, two[4]!.color]).toEqual(['#ff0000', '#0000ff']);
    const given = [0, 0.1, 0.2, 0.5, 1].map((offset, k) => ({ offset, color: ['#111111', '#222222', '#333333', '#444444', '#555555'][k]! }));
    const five = gradientStops(given, identity);
    expect(five).toHaveLength(9);
    for (const g of given) expect(five).toContainEqual({ offset: g.offset, color: g.color, opacity: 1 });
  });

  it('targets min(9, max(5, 2k-1)) stops', () => {
    const count = (k: number) => gradientStops(Array.from({ length: k }, (_, i) => ({ offset: i / (k - 1), color: '#808080' })), identity).length;
    expect([2, 3, 4, 5, 6, 8, 9].map(count)).toEqual([5, 5, 7, 9, 9, 9, 9]);
  });

  it('puts the midpoint in the widest gap, the first on ties, mixed in OKLab', () => {
    // Gaps 0.25 and 0.75: 0.625 goes into the second. Then 0.25..0.625 and 0.625..1 tie at 0.375: 0.4375 goes into the first.
    const stops = gradientStops([{ offset: 0, color: '#000000' }, { offset: 0.25, color: '#ffffff' }, { offset: 1, color: '#000000' }], identity);
    expect(stops.map((s) => s.offset)).toEqual([0, 0.25, 0.4375, 0.625, 1]);
    expect(stops[3]!.color).toBe(formatHex(interpolate(['#ffffff', '#000000'], 'oklab')(0.5)));
  });

  it('mixes black to white exactly where culori does, not in sRGB', () => {
    const stops = gradientStops([{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }], identity);
    expect(stops[2]!.color).toBe(formatHex(interpolate(['#000000', '#ffffff'], 'oklab')(0.5)));
    expect(stops[2]!.color).not.toBe('#808080');
  });

  it('sorts by offset, keeps alpha, and turns an unresolvable color into transparent black', () => {
    const stops = gradientStops(
      [{ offset: 1, color: 'gone' }, { offset: 0, color: 'rgba(255, 0, 0, 0.5)' }],
      (c) => (c === 'gone' ? undefined : c),
    );
    expect(stops[0]).toEqual({ offset: 0, color: '#ff0000', opacity: 0.5 });
    expect(stops.at(-1)).toEqual({ offset: 1, color: '#000000', opacity: 0 });
    expect(stops).toHaveLength(5);
  });
});

describe('render/defs-svg: defsMarkup', () => {
  it('emits a linear gradient along its angle, in bounding-box fractions', () => {
    const at = (angle: number) => toSvg(build([full, { op: 'gradient', id: 'g', stops: ['#000000', '#ffffff'], angle, ids: ['box'] }]));
    expect(at(0)).toContain('<linearGradient id="__def_g" x1="0" y1="0.5" x2="1" y2="0.5">');
    expect(at(90)).toContain('<linearGradient id="__def_g" x1="0.5" y1="0" x2="0.5" y2="1">');
    const svg = at(0);
    expect(svg).toContain('fill="url(#__def_g)"');
    expect(svg.match(/<stop /g)).toHaveLength(5);
    expect(svg).toContain('<stop offset="0" stop-color="#000000"/>');
    expect(svg).toContain('<stop offset="1" stop-color="#ffffff"/>');
  });

  it('stretches the ramp to the box corners, so a diagonal angle runs corner to corner', () => {
    const vector = (angle: number) => toSvg(build([full, { op: 'gradient', id: 'g', stops: ['#000000', '#ffffff'], angle, ids: ['box'] }])).match(/x1="[^"]*" y1="[^"]*" x2="[^"]*" y2="[^"]*"/)![0];
    expect(vector(45)).toBe('x1="0" y1="0" x2="1" y2="1"');
    expect(vector(135)).toBe('x1="1" y1="0" x2="0" y2="1"');
    expect(vector(180)).toBe('x1="1" y1="0.5" x2="0" y2="0.5"');
    // 30°: half-length (cos + sin) / 2 = 0.683, so the line overshoots the box sides and the ramp still spans it.
    expect(vector(30)).toBe('x1="-0.0915" y1="0.1585" x2="1.0915" y2="0.8415"');
  });

  it('emits radial gradients, with the focal point only when given', () => {
    const radial = (extra: object) => toSvg(build([full, { op: 'gradient', id: 'r', type: 'radial', stops: ['#fff', '#000'], ids: ['box'], ...extra }]));
    expect(radial({})).toContain('<radialGradient id="__def_r" cx="0.5" cy="0.5" r="0.5">');
    expect(radial({ center: [0.25, 0.75], radius: 1 })).toContain('cx="0.25" cy="0.75" r="1">');
    expect(radial({ focal: [0.3, 0.4] })).toContain('r="0.5" fx="0.3" fy="0.4">');
  });

  it('writes stop opacity only when a stop is translucent', () => {
    const svg = toSvg(build([full, { op: 'gradient', id: 'g', stops: ['rgba(255,0,0,0.5)', '#00ff00'], ids: ['box'] }]));
    expect(svg).toContain('<stop offset="0" stop-color="#ff0000" stop-opacity="0.5"/>');
    expect(svg).toContain('<stop offset="1" stop-color="#00ff00"/>');
  });

  it('resolves token stop colors live', () => {
    const doc = build([full, { op: 'gradient', id: 'g', stops: ['brand', '#ffffff'], ids: ['box'] }], { brand: '#ff0000' });
    expect(toSvg(doc)).toContain('stop-color="#ff0000"');
    const edited = { ...doc, tokens: { brand: '#0000ff' } };
    expect(toSvg(edited)).toContain('stop-color="#0000ff"');
    expect(toSvg(edited)).not.toContain('#ff0000');
  });

  it('emits only referenced defs, sorted by name, before the content', () => {
    const doc = build([
      full,
      { op: 'gradient', id: 'zeta', stops: ['#000', '#fff'] },
      { op: 'gradient', id: 'beta', stops: ['#000', '#fff'], ids: ['box'], target: 'stroke' },
      { op: 'filter', id: 'alpha', blur: 2, ids: ['box'] },
      { op: 'filter', id: 'unused', blur: 2 },
    ]);
    const svg = toSvg(doc);
    expect(svg).not.toContain('__def_zeta');
    expect(svg).not.toContain('__def_unused');
    expect(svg.indexOf('id="__def_alpha"')).toBeLessThan(svg.indexOf('id="__def_beta"'));
    expect(svg.indexOf('</defs>')).toBeLessThan(svg.indexOf('<path'));
    expect(svg).toContain('stroke="url(#__def_beta)"');
    expect(toSvg(build([full, { op: 'gradient', stops: ['#000', '#fff'] }]))).not.toContain('<defs>');
  });

  it('emits a gradient used as the canvas background', () => {
    const base = build([{ op: 'gradient', id: 'bg', stops: ['#000', '#fff'] }]);
    const svg = toSvg({ ...base, canvas: { ...base.canvas, background: 'bg' } });
    expect(svg).toContain('<linearGradient id="__def_bg"');
    expect(svg).toContain('<rect width="100" height="50" fill="url(#__def_bg)"/>');
  });

  it('emits blur, shadow and both as a filter chain', () => {
    const fx = (spec: object) => toSvg(build([full, { op: 'filter', id: 'f', ids: ['box'], ...spec }]));
    const head = '<filter id="__def_f" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB">';
    expect(fx({ blur: 3 })).toContain(`${head}<feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/></filter>`);
    expect(fx({ shadow: { dx: 2, dy: 5, blur: 6, color: 'rgba(0,0,0,0.35)' } })).toContain(
      `${head}<feDropShadow in="SourceGraphic" dx="2" dy="5" stdDeviation="6" flood-color="#000000" flood-opacity="0.35"/></filter>`,
    );
    expect(fx({ blur: 3, shadow: { color: '#ff0000' } })).toContain(
      '<feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/><feDropShadow in="blur" dx="0" dy="4" stdDeviation="4" flood-color="#ff0000" flood-opacity="1"/>',
    );
    expect(fx({ blur: 3 })).toContain('filter="url(#__def_f)"');
  });

  it('resolves a token shadow color live', () => {
    const doc = build([full, { op: 'filter', id: 'f', shadow: { color: 'ink' }, ids: ['box'] }], { ink: '#264653' });
    expect(toSvg(doc)).toContain('flood-color="#264653"');
  });

  it('emits mix-blend-mode for a blend, and nothing for normal', () => {
    const svg = (blend: string) => toSvg(build([full, { op: 'style', ids: ['box'], style: { blend } }]));
    expect(svg('multiply')).toContain('style="mix-blend-mode:multiply"');
    expect(svg('normal')).not.toContain('mix-blend-mode');
  });
});

describe('render/defs-svg: maskMarkup', () => {
  it('writes a bounding-box mask with a linear fade along its angle', () => {
    const svg = toSvg(build([full, { op: 'mask', id: 'box', fade: { angle: 0, from: 1, to: 0.25 } }]));
    expect(svg).toContain(
      '<mask id="__mask_box" maskContentUnits="objectBoundingBox" x="-50%" y="-50%" width="200%" height="200%">' +
        '<linearGradient id="__maskg_box" gradientUnits="userSpaceOnUse" x1="0" y1="0.5" x2="1" y2="0.5">' +
        '<stop offset="0" stop-color="#ffffff" stop-opacity="1"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.25"/></linearGradient>' +
        '<rect x="-0.5" y="-0.5" width="2" height="2" fill="url(#__maskg_box)"/></mask>',
    );
    expect(svg).toContain('mask="url(#__mask_box)"');
  });

  it('writes a radial fade from the center to the rim', () => {
    const svg = toSvg(build([full, { op: 'mask', id: 'box', fade: { type: 'radial', from: 1, to: 0 } }]));
    expect(svg).toContain('<radialGradient id="__maskg_box" gradientUnits="userSpaceOnUse" cx="0.5" cy="0.5" r="0.5">');
  });
});

describe('render/defs-svg: export and round trip', () => {
  const doc = build([
    full,
    { op: 'gradient', id: 'sky_fade', stops: ['#8ecae6', '#ffffff'], ids: ['box'] },
    { op: 'filter', id: 'lift', shadow: {}, ids: ['box'] },
    { op: 'mask', id: 'box', fade: { from: 1, to: 0.5 } },
  ]);

  it.each([{}, { stripIds: true }])('exportSvg keeps gradients, filters, masks and every url(#…) target %j', (options) => {
    const svg = exportSvg(doc, options);
    expect(svg).toContain('<linearGradient');
    expect(svg).toContain('<filter');
    expect(svg).toContain('<mask');
    const refs = [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThanOrEqual(4);
    for (const ref of refs) expect(svg).toContain(`id="${ref}"`);
  });

  it('keeps unitless fractions (offsets, vectors, radii, opacities) whatever the coordinate precision', () => {
    const fractions = build([
      full,
      { op: 'gradient', id: 'lin', stops: ['#000000', 'rgba(255,255,255,0.4)'], angle: 30, ids: ['box'] },
      { op: 'gradient', id: 'rad', type: 'radial', stops: ['#000', '#fff'], center: [0.25, 0.75], radius: 0.4, focal: [0.3, 0.2], ids: ['box'], target: 'stroke' },
      { op: 'mask', id: 'box', fade: { angle: 30, from: 0.8, to: 0.2 } },
    ]);
    const raw = toSvg(fractions, { precision: 0 });
    for (const piece of ['offset="0.25"', 'offset="0.75"', 'stop-opacity="0.4"', 'x1="-0.0915"', 'cx="0.25"', 'cy="0.75"', 'r="0.4"', 'fx="0.3"', 'stop-opacity="0.8"']) {
      expect(raw, piece).toContain(piece);
    }
    // SVGO may drop the leading zero (".25") and keeps three decimals (-0.0915 → -0.092), but must not round a fraction to 0 or 1.
    const out = exportSvg(fractions, { precision: 0 });
    for (const piece of [/offset="0?\.25"/, /offset="0?\.75"/, /x1="-0?\.09\d"/, /cx="0?\.25"/, /cy="0?\.75"/, /r="0?\.4"/, /fx="0?\.3"/, /stop-opacity="0?\.8"/]) {
      expect(out).toMatch(piece);
    }
    // Coordinates still follow the precision: a 100 × 50 canvas is unchanged, a fractional box would round.
    expect(out).toContain('viewBox="0 0 100 50"');
  });

  it('survives a JSON round trip through validateDocument', () => {
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('rejects a document whose style names a filter that is not one', () => {
    const bad = JSON.parse(JSON.stringify(doc));
    bad.nodes.box.style.filter = 'sky_fade';
    expect(() => validateDocument(bad)).toThrow(/filter/);
  });
});

describe('render/defs-svg: raster', () => {
  it('paints a black to white gradient dark on the left and light on the right at angle 0', () => {
    const img = rasterize(build([full, { op: 'gradient', stops: ['#000000', '#ffffff'], angle: 0, ids: ['box'] }]));
    expect(rgb(img, 3, 25)[0]).toBeLessThan(40);
    expect(rgb(img, 96, 25)[0]).toBeGreaterThan(215);
    // The OKLab midpoint of black and white is #636363, darker than sRGB's 128.
    expect(rgb(img, 50, 5)[0]).toBeGreaterThan(85);
    expect(rgb(img, 50, 5)[0]).toBeLessThan(125);
    expect(rgb(img, 50, 5)).toEqual(rgb(img, 50, 45));
  });

  it('paints a top to bottom gradient at angle 90 and a radial one from the center out', () => {
    const down = rasterize(build([full, { op: 'gradient', stops: ['#000000', '#ffffff'], angle: 90, ids: ['box'] }]));
    expect(rgb(down, 50, 2)[0]).toBeLessThan(40);
    expect(rgb(down, 50, 47)[0]).toBeGreaterThan(215);
    const out = rasterize(build([full, { op: 'gradient', type: 'radial', stops: ['#ffffff', '#000000'], ids: ['box'] }]));
    expect(rgb(out, 50, 25)[0]).toBeGreaterThan(215);
    expect(rgb(out, 2, 25)[0]).toBeLessThan(90);
  });

  it('fades a masked black rect from dark on the left to near white on the right', () => {
    const img = rasterize(build([{ ...full, style: { fill: '#000000' } }, { op: 'mask', id: 'box', fade: { angle: 0, from: 1, to: 0 } }]));
    expect(rgb(img, 3, 25)[0]).toBeLessThan(40);
    expect(rgb(img, 96, 25)[0]).toBeGreaterThan(215);
  });

  it('draws a drop shadow beside the shape and a blur that softens its edge', () => {
    const rectAt = { op: 'rect', id: 'box', x: 10, y: 15, width: 20, height: 20, style: { fill: '#ff0000' } };
    // The filter region reaches half the box past it (x 0..40), so the shadow shows up to x = 40.
    const shadow = rasterize(build([rectAt, { op: 'filter', shadow: { dx: 15, dy: 0, blur: 0, color: '#000000' }, ids: ['box'] }]));
    expect(rgb(shadow, 20, 25)).toEqual([255, 0, 0]);
    expect(rgb(shadow, 35, 25)).toEqual([0, 0, 0]);
    const blurred = rasterize(build([rectAt, { op: 'filter', blur: 4, ids: ['box'] }]));
    const sharp = rasterize(build([rectAt]));
    expect(rgb(sharp, 8, 25)).toEqual([255, 255, 255]);
    expect(rgb(blurred, 8, 25)[1]).toBeLessThan(250);
  });
});
