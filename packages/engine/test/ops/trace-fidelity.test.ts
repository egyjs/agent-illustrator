import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/ops/index.ts';
import { executeBatch } from '../../src/ops/registry.ts';
import { decodeImage, type RasterImage } from '../../src/render/image.ts';
import { rasterize } from '../../src/render/raster.ts';
import { createDocument, type PathNode } from '../../src/scene/model.ts';

/**
 * How closely a trace reproduces its reference: the traced document is rendered again and compared
 * pixel by pixel, at 1:1 against the input image and at 4× against the vector source it was drawn
 * from. A pixel matches when every channel is within 24 levels (antialiased edge pixels count).
 */
const fonts = ['Tajawal-Regular.ttf', 'Tajawal-Bold.ttf'].map((f) => fileURLToPath(new URL(`../../assets/fonts/${f}`, import.meta.url)));
const render = (svg: string, zoom = 1) =>
  new Resvg(svg, { fitTo: { mode: 'zoom', value: zoom }, background: 'white', font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'Tajawal' } }).render();

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">
<rect width="600" height="400" fill="#8ecae6"/><circle cx="430" cy="120" r="70" fill="#ffb703"/>
<path d="M0 400 L180 150 L330 400 Z" fill="#2a9d8f"/><path d="M200 400 L380 190 L600 400 Z" fill="#264653"/>
<path d="M150 192 L180 150 L212 196 L190 186 L178 200 L165 188 Z" fill="#ffffff"/>
<text x="40" y="70" font-size="48" font-family="Tajawal" font-weight="700" fill="#e63946">PEAK</text></svg>`;
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><circle cx="150" cy="150" r="120" fill="#000000"/><path d="M95 160 L140 205 L215 105" fill="none" stroke="#ffffff" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function similarity(a: Uint8Array, b: Uint8Array): number {
  let same = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i]! - b[i]!) <= 24 && Math.abs(a[i + 1]! - b[i + 1]!) <= 24 && Math.abs(a[i + 2]! - b[i + 2]!) <= 24) same++;
  }
  return same / (a.length / 4);
}

function trace(svg: string, colors: number) {
  const png = new Resvg(svg, { font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'Tajawal' } }).render().asPng();
  const img: RasterImage = decodeImage(png);
  const r = executeBatch(createRegistry(), createDocument({ width: img.width, height: img.height, seed: 1 }), [{ op: 'trace', id: 't', image: 'ref', colors }], {
    images: { get: () => img },
  });
  expect(r.ok, JSON.stringify(r.results)).toBe(true);
  return r.doc;
}

describe('ops/trace: fidelity', () => {
  it.each([
    ['logo', LOGO, 6],
    ['mark', MARK, 2],
  ] as const)('reproduces the %s at 99% or better, at 1:1 and at 4× against its vector source', (_, svg, colors) => {
    const doc = trace(svg, colors);
    const one = render(svg);
    expect(similarity(new Uint8Array(one.pixels), rasterize(doc, { background: 'white' }).pixels)).toBeGreaterThanOrEqual(0.995);
    const four = render(svg, 4);
    expect(similarity(new Uint8Array(four.pixels), rasterize(doc, { background: 'white', scale: 4, fonts: { files: fonts, defaultFamily: 'Tajawal' } }).pixels)).toBeGreaterThanOrEqual(0.99);
  });

  it('keeps the logo’s exact colors, the small white snow cap included, and draws a circle as four arcs', () => {
    const doc = trace(LOGO, 6);
    const fills = Object.values(doc.nodes).filter((n): n is PathNode => n.type === 'path').map((n) => n.style.fill);
    expect(new Set(fills)).toEqual(new Set(['#8ecae6', '#264653', '#2a9d8f', '#ffb703', '#ffffff', '#e63946']));
    const sun = Object.values(doc.nodes).find((n): n is PathNode => n.type === 'path' && n.style.fill === '#ffb703')!;
    expect(sun.subpaths.map((sp) => sp.segs.length)).toContain(4);
  });
});
