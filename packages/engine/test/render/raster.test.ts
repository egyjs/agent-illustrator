import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/ops/index.ts';
import { executeBatch } from '../../src/ops/registry.ts';
import { labelLayout, rasterize, type Raster, type RasterFonts } from '../../src/render/raster.ts';
import { createDocument, type Doc } from '../../src/scene/model.ts';
import { expectCode } from '../fixtures.ts';

const font = (file: string) => fileURLToPath(new URL(`../../assets/fonts/${file}`, import.meta.url));
const FONTS: RasterFonts = { files: [font('Tajawal-Regular.ttf'), font('Tajawal-Bold.ttf')], defaultFamily: 'Tajawal' };
const registry = createRegistry();

function scene(background?: string): Doc {
  const doc = createDocument({ width: 100, height: 50, ...(background === undefined ? {} : { background }) });
  const r = executeBatch(registry, doc, [{ op: 'rect', id: 'box', x: 10, y: 10, width: 30, height: 20, style: { fill: 'teal' } }]);
  expect(r.ok).toBe(true);
  return r.doc;
}
const rgba = (img: Raster, x: number, y: number) => Array.from(img.pixels.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
/** Pixels that differ between two same-size renders. */
function changed(a: Raster, b: Raster): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < a.pixels.length; i += 4) {
    if (a.pixels[i] !== b.pixels[i] || a.pixels[i + 1] !== b.pixels[i + 1] || a.pixels[i + 2] !== b.pixels[i + 2]) {
      out.push({ x: (i / 4) % a.width, y: Math.floor(i / 4 / a.width) });
    }
  }
  return out;
}

describe('render/raster', () => {
  it('renders the canvas at the requested scale as a PNG', () => {
    const one = rasterize(scene('#ffffff'));
    expect([one.width, one.height]).toEqual([100, 50]);
    expect(Buffer.from(one.png).subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(rgba(one, 20, 15)).toEqual([0, 128, 128, 255]);
    expect(rgba(one, 5, 5)).toEqual([255, 255, 255, 255]);
    const two = rasterize(scene('#ffffff'), { scale: 2 });
    expect([two.width, two.height]).toEqual([200, 100]);
    expect(rgba(two, 40, 30)).toEqual([0, 128, 128, 255]);
  });

  it('puts a white backdrop behind documents without a background', () => {
    expect(rgba(rasterize(scene()), 5, 5)).toEqual([255, 255, 255, 255]);
    expect(rgba(rasterize(scene(), { background: '#000000' }), 5, 5)).toEqual([0, 0, 0, 255]);
  });

  it('crops to a region in canvas units', () => {
    const crop = rasterize(scene('#ffffff'), { region: { x: 10, y: 10, width: 30, height: 20 }, scale: 2 });
    expect([crop.width, crop.height]).toEqual([60, 40]);
    expect(rgba(crop, 1, 1)).toEqual([0, 128, 128, 255]);
    expect(rgba(crop, 58, 38)).toEqual([0, 128, 128, 255]);
  });

  it('refuses renders above the pixel cap and bad sizes, and renders the backdrop outside the canvas', () => {
    const doc = createDocument({ width: 800, height: 600 });
    expectCode(() => rasterize(doc, { scale: 8 }), 'limit_exceeded');
    expectCode(() => rasterize(doc, { scale: 0 }), 'invalid_input');
    expectCode(() => rasterize(doc, { scale: 9 }), 'invalid_input');
    expectCode(() => rasterize(doc, { region: { x: 0, y: 0, width: 0, height: 10 } }), 'invalid_input');
    const outside = rasterize(scene('#ffffff'), { region: { x: 200, y: 200, width: 10, height: 10 } });
    expect(rgba(outside, 5, 5)).toEqual([255, 255, 255, 255]);
  });

  describe('regions and layers', () => {
    // resvg aborts the whole process on a layer far outside a small render, so a crash here kills the test run.
    const build = (ops: unknown[]): Doc => {
      const r = executeBatch(registry, createDocument({ width: 800, height: 600, background: '#ffffff' }), ops);
      expect(r.ok).toBe(true);
      return r.doc;
    };
    const teal = { fill: 'teal' };
    const crop = (doc: Doc, region: { x: number; y: number; width: number; height: number }) => rasterize(doc, { region });
    /** The pixels of a region of a full render, to compare with rendering the region itself. */
    function cutOut(full: Raster, x: number, y: number, w: number, h: number): Buffer {
      const rows = Array.from({ length: h }, (_, row) => Buffer.from(full.pixels.subarray(((y + row) * full.width + x) * 4, ((y + row) * full.width + x + w) * 4)));
      return Buffer.concat(rows);
    }

    it('renders a small region while shapes far from it carry filters, masks, clips, opacity and blend modes', () => {
      const doc = build([
        { op: 'rect', id: 'card', x: 50, y: 50, width: 80, height: 60, style: teal },
        { op: 'filter', id: 'lift', shadow: { dy: 8, blur: 12 }, ids: ['card'] },
        { op: 'rect', id: 'soft', x: 300, y: 50, width: 80, height: 60, style: teal },
        { op: 'filter', id: 'haze', blur: 6, ids: ['soft'] },
        { op: 'rect', id: 'faded', x: 150, y: 400, width: 80, height: 60, style: teal },
        { op: 'mask', id: 'faded', fade: { angle: 0, from: 1, to: 0 } },
        { op: 'rect', id: 'dim', x: 600, y: 300, width: 80, height: 60, style: { ...teal, opacity: 0.5 } },
        { op: 'rect', id: 'cut', x: 600, y: 50, width: 80, height: 60, style: teal },
        { op: 'ellipse', id: 'frame', cx: 640, cy: 80, rx: 30 },
        { op: 'clip', id: 'cut', shape: 'frame' },
        { op: 'rect', id: 'mixed', x: 20, y: 500, width: 80, height: 60, style: { ...teal, blend: 'multiply' } },
        { op: 'rect', id: 'near', x: 500, y: 500, width: 20, height: 20, style: { fill: 'red' } },
      ]);
      for (const [x, y, w, h] of [[499, 499, 30, 30], [700, 560, 5, 5], [400, 250, 3, 3], [0, 0, 20, 20]] as const) {
        const img = crop(doc, { x, y, width: w, height: h });
        expect([img.width, img.height]).toEqual([w, h]);
      }
      expect(rgba(crop(doc, { x: 499, y: 499, width: 30, height: 30 }), 10, 10)).toEqual([255, 0, 0, 255]);
    });

    it('keeps the effects that reach the region: a shadow below its shape still shows', () => {
      const doc = build([
        { op: 'rect', id: 'card', x: 50, y: 50, width: 80, height: 60, style: teal },
        { op: 'filter', id: 'lift', shadow: { dy: 8, blur: 4, color: '#000000' }, ids: ['card'] },
      ]);
      const below = crop(doc, { x: 60, y: 105, width: 60, height: 30 });
      expect(rgba(below, 30, 8)).not.toEqual([255, 255, 255, 255]);
      expect(rgba(below, 30, 28)).toEqual([255, 255, 255, 255]);
    });

    it('draws a layer inside another layer the way the full render does', () => {
      // A canvas-wide group with opacity holds a shape with opacity: in a small region the inner layer lies far from the outer one's corner.
      const doc = build([
        { op: 'rect', id: 'sky', x: 0, y: 0, width: 800, height: 600, style: { fill: '#8ecae6' } },
        { op: 'rect', id: 'glow', x: 630, y: 110, width: 50, height: 50, style: { fill: '#ffb703', opacity: 0.5 } },
        { op: 'rect', id: 'lamp', x: 400, y: 300, width: 50, height: 50, style: { fill: '#ffb703' } },
        { op: 'filter', id: 'bloom', shadow: { dx: 6, dy: 6, blur: 5, color: '#000000' }, ids: ['lamp'] },
        { op: 'group', id: 'scene', ids: ['sky', 'glow', 'lamp'] },
        { op: 'style', ids: ['scene'], style: { opacity: 0.9 } },
      ]);
      const full = rasterize(doc);
      for (const [x, y, w, h] of [[620, 100, 40, 60], [395, 295, 70, 70], [700, 500, 12, 8]] as const) {
        const part = crop(doc, { x, y, width: w, height: h });
        expect(Buffer.from(part.pixels).equals(cutOut(full, x, y, w, h))).toBe(true);
      }
    });

    it('lets a layer that is too big to hold whole go flat instead of aborting', () => {
      const doc = build([
        { op: 'rect', id: 'sky', x: 0, y: 0, width: 800, height: 600, style: { fill: '#8ecae6' } },
        { op: 'rect', id: 'glow', x: 630, y: 110, width: 50, height: 50, style: { fill: '#ffb703', opacity: 0.5 } },
        { op: 'group', id: 'scene', ids: ['sky', 'glow'] },
        { op: 'style', ids: ['scene'], style: { opacity: 0.9 } },
      ]);
      const img = rasterize(doc, { region: { x: 620, y: 100, width: 40, height: 60 }, maxPixels: 4000 });
      expect([img.width, img.height]).toEqual([40, 60]);
    });
  });

  it('bounds overlay draws only along node bounds', () => {
    const doc = scene('#ffffff');
    const diff = changed(rasterize(doc), rasterize(doc, { overlays: ['bounds'] }));
    expect(diff.length).toBeGreaterThan(20);
    const nearEdge = ({ x, y }: { x: number; y: number }) =>
      x >= 8 && x <= 41 && y >= 8 && y <= 31 && (x <= 11 || x >= 39 || y <= 11 || y >= 29);
    expect(diff.every(nearEdge)).toBe(true);
  });

  it('ids overlay labels nodes near their top-left corner; grid overlay draws lines', () => {
    const doc = scene('#ffffff');
    const plain = rasterize(doc, { scale: 4, fonts: FONTS });
    const ids = changed(plain, rasterize(doc, { scale: 4, fonts: FONTS, overlays: ['ids'] }));
    expect(ids.length).toBeGreaterThan(50);
    expect(ids.every(({ x, y }) => x >= 36 && x < 160 && y >= 36 && y < 120)).toBe(true);
    const grid = changed(plain, rasterize(doc, { scale: 4, fonts: FONTS, overlays: ['grid'], grid: 10 }));
    expect(grid.length).toBeGreaterThan(400);
  });

  it('refuses a grid finer than 8 output pixels and regions far off any canvas, quickly', () => {
    const doc = scene('#ffffff');
    const t0 = performance.now();
    expectCode(() => rasterize(doc, { overlays: ['grid'], grid: 0.001 }), 'invalid_input');
    expectCode(() => rasterize(doc, { overlays: ['grid'], region: { x: 1e20, y: 0, width: 100, height: 100 } }), 'invalid_input');
    expect(performance.now() - t0).toBeLessThan(1000);
    const tiny = rasterize(doc, { overlays: ['grid'], region: { x: 10, y: 10, width: 4, height: 4 }, scale: 8 });
    expect([tiny.width, tiny.height]).toEqual([32, 32]);
  });

  it('labelLayout keeps labels inside the region, apart, with leaves drawn after groups', () => {
    const region = { x: 0, y: 0, width: 200, height: 100 };
    const labels = labelLayout(
      [
        { id: 'child', box: { x: 10, y: 10, width: 50, height: 50 }, group: false },
        { id: 'house', box: { x: 10, y: 10, width: 100, height: 60 }, group: true },
        { id: 'sun', box: { x: 150, y: -40, width: 80, height: 80 }, group: false },
        { id: 'far', box: { x: 500, y: 500, width: 10, height: 10 }, group: false },
      ],
      region,
      1,
    );
    expect(labels.map((l) => l.id)).toEqual(['house', 'child', 'sun']);
    const sun = labels.find((l) => l.id === 'sun')!;
    expect([sun.x, sun.y]).toEqual([150, 0]);
    const [a, b] = [labels[0]!, labels[1]!];
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    expect(overlap).toBe(false);
  });

  it('is deterministic', () => {
    const doc = scene('#ffffff');
    const opts = { scale: 2, overlays: ['ids', 'bounds', 'grid'] as const, fonts: FONTS };
    expect(Buffer.from(rasterize(doc, opts).png).equals(Buffer.from(rasterize(doc, opts).png))).toBe(true);
  });
});
