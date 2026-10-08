import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/ops/index.ts';
import { executeBatch } from '../../src/ops/registry.ts';
import { rasterize, type Raster, type RasterFonts } from '../../src/render/raster.ts';
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

  it('is deterministic', () => {
    const doc = scene('#ffffff');
    const opts = { scale: 2, overlays: ['ids', 'bounds', 'grid'] as const, fonts: FONTS };
    expect(Buffer.from(rasterize(doc, opts).png).equals(Buffer.from(rasterize(doc, opts).png))).toBe(true);
  });
});
