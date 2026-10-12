import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { cubics, isStraight, pointAt } from '../../src/geometry/bezier.ts';
import type { Vec2 } from '../../src/geometry/types.ts';
import { decodeImage } from '../../src/render/image.ts';
import { isolines, layerField } from '../../src/trace/contour.ts';
import { coverage } from '../../src/trace/coverage.ts';
import { fitLoop } from '../../src/trace/fit.ts';

/** The outline loops of the black (or only) layer of an SVG drawn by resvg. */
function loopsOf(svg: string, palette = ['#000000']): Vec2[][] {
  const img = decodeImage(new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng());
  return isolines(layerField(coverage(img, palette), img.width, img.height, palette.length - 1, 'abutting'), img.width, img.height);
}
const sample = (sp: ReturnType<typeof fitLoop>) => cubics(sp, true).flatMap((c) => Array.from({ length: 24 }, (_, i) => pointAt(c, i / 24)));

describe('trace/fit: fitLoop', () => {
  it('turns a square into four straight sides with sharp corners where they belong', () => {
    const [loop] = loopsOf('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect x="8" y="10" width="20" height="16"/></svg>');
    const sp = fitLoop(loop!);
    expect(sp.segs).toHaveLength(4);
    expect(cubics(sp).every(isStraight)).toBe(true);
    const corners = [sp.start, ...sp.segs.map((s) => [s[4], s[5]] as Vec2)].map(([x, y]) => `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`);
    expect(new Set(corners)).toEqual(new Set(['8,10', '28,10', '28,26', '8,26']));
  });

  it('keeps a rotated square’s corners within a tenth of a pixel', () => {
    const [loop] = loopsOf('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect x="18" y="18" width="24" height="24" transform="rotate(30 30 30)"/></svg>');
    const sp = fitLoop(loop!);
    expect(sp.segs).toHaveLength(4);
    const want: Vec2[] = [[-12, -12], [12, -12], [12, 12], [-12, 12]].map(([x, y]) => [30 + x! * Math.cos(Math.PI / 6) - y! * Math.sin(Math.PI / 6), 30 + x! * Math.sin(Math.PI / 6) + y! * Math.cos(Math.PI / 6)]);
    for (const w of want) {
      const d = Math.min(...[sp.start, ...sp.segs.map((s) => [s[4], s[5]] as Vec2)].map((p) => Math.hypot(p[0] - w[0], p[1] - w[1])));
      expect(d).toBeLessThan(0.1);
    }
  });

  it('turns a circle into an exact circle of four arcs', () => {
    const [loop] = loopsOf('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60.3" cy="59.7" r="40"/></svg>');
    const sp = fitLoop(loop!);
    expect(sp.segs).toHaveLength(4);
    // resvg draws the source circle from flattened curves, a few hundredths of a pixel inside the exact one at this size.
    for (const [x, y] of sample(sp)) expect(Math.abs(Math.hypot(x - 60.3, y - 59.7) - 40)).toBeLessThan(0.04);
  });

  it('follows a stroke with round caps and joins closely, in few segments', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><path d="M95 160 L140 205 L215 105" fill="none" stroke="#000" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const loop = loopsOf(svg).sort((a, b) => b.length - a.length)[0]!;
    const sp = fitLoop(loop);
    const poly: Vec2[] = [[95, 160], [140, 205], [215, 105]];
    const dist = (p: Vec2) => Math.min(...[0, 1].map((i) => {
      const a = poly[i]!, b = poly[i + 1]!, ab = [b[0] - a[0], b[1] - a[1]];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0]! + (p[1] - a[1]) * ab[1]!) / (ab[0]! ** 2 + ab[1]! ** 2)));
      return Math.hypot(p[0] - a[0] - t * ab[0]!, p[1] - a[1] - t * ab[1]!);
    }));
    const e = sample(sp).filter((p) => Math.hypot(p[0] - 140, p[1] - 186) > 6).map((p) => dist(p) - 14);
    expect(Math.sqrt(e.reduce((s, v) => s + v * v, 0) / e.length)).toBeLessThan(0.04);
    expect(sp.segs.length).toBeLessThan(60);
  });
});
