import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { polyline } from '../../src/geometry/paths.ts';
import { IDENTITY } from '../../src/geometry/transform.ts';
import { rasterize, type RasterFonts } from '../../src/render/raster.ts';
import { formatter, toSvg } from '../../src/render/svg.ts';
import { measureInk } from '../../src/render/text-metrics.ts';
import { textMarkup } from '../../src/render/text-svg.ts';
import type { TextNode } from '../../src/scene/model.ts';
import { docOf } from '../fixtures.ts';

const font = (file: string) => fileURLToPath(new URL(`../../assets/fonts/${file}`, import.meta.url));
const fonts: RasterFonts = { files: [font('Tajawal-Regular.ttf'), font('Tajawal-Bold.ttf')], defaultFamily: 'Tajawal' };

const n = formatter(3);
const textNode = (extra: Partial<TextNode> = {}): TextNode => ({
  id: 't',
  type: 'text',
  parent: null,
  transform: IDENTITY,
  style: {},
  content: 'Hello',
  font: { family: 'Tajawal', size: 40, weight: 400, letterSpacing: 0 },
  anchor: 'start',
  direction: 'ltr',
  lineHeight: 1.2,
  at: { kind: 'point', x: 10, y: 70 },
  ink: null,
  ...extra,
});
const inkPixels = (doc: ReturnType<typeof docOf>) => {
  const { pixels } = rasterize(doc, { fonts });
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! < 128) count++;
  return count;
};

describe('render/text-svg', () => {
  it('writes point text with only the attributes that differ from the defaults', () => {
    expect(textMarkup(textNode(), n)).toEqual({ prefix: '', attrs: ['x="10"', 'y="70"', 'font-family="Tajawal"', 'font-size="40"'], body: 'Hello' });
  });

  it('adds weight, letter spacing and anchor in a fixed order, and never a direction attribute', () => {
    const node = textNode({ font: { family: 'Tajawal', size: 12.5, weight: 700, letterSpacing: -1 }, anchor: 'middle', direction: 'rtl' });
    expect(textMarkup(node, n).attrs).toEqual([
      'x="10"', 'y="70"', 'font-family="Tajawal"', 'font-size="12.5"', 'font-weight="700"', 'letter-spacing="-1"', 'text-anchor="middle"',
    ]);
    expect(toSvg(docOf([textNode({ direction: 'rtl' })]))).not.toContain('direction=');
  });

  it('escapes & < > and quotes in the content and the family', () => {
    const node = textNode({ content: 'a & b < c > "d"', font: { family: 'A"B', size: 10, weight: 400, letterSpacing: 0 } });
    const markup = textMarkup(node, n);
    expect(markup.body).toBe('a &amp; b &lt; c &gt; &quot;d&quot;');
    expect(markup.attrs).toContain('font-family="A&quot;B"');
  });

  it('wraps right-to-left lines in an isolate, because the renderer ignores direction', () => {
    const RLI = '\u{2067}', PDI = '\u{2069}';
    expect(textMarkup(textNode({ content: 'مرحبا', direction: 'rtl' }), n).body).toBe(`${RLI}مرحبا${PDI}`);
    const lines = textMarkup(textNode({ content: 'a\nb', direction: 'rtl' }), n).body;
    expect(lines).toBe(`<tspan x="10" y="70">${RLI}a${PDI}</tspan><tspan x="10" y="118">${RLI}b${PDI}</tspan>`);
  });

  it('puts each non-empty line in its own tspan at an absolute y, so empty lines keep their space', () => {
    const body = textMarkup(textNode({ content: 'one\n\nthree', lineHeight: 1.5 }), n).body;
    expect(body).toBe('<tspan x="10" y="70">one</tspan><tspan x="10" y="190">three</tspan>');
  });

  it('writes path text as a textPath over a copy of the guide in defs', () => {
    const at = { kind: 'path', subpaths: [polyline([[0, 0], [100, 0]], false), polyline([[0, 9], [9, 9]], false)], offset: 0.25 } as const;
    expect(textMarkup(textNode({ id: 'caption', at }), n)).toEqual({
      prefix: '<defs><path id="__tp_caption" d="M0 0 L100 0"/></defs>',
      attrs: ['font-family="Tajawal"', 'font-size="40"'],
      body: '<textPath href="#__tp_caption" startOffset="25%">Hello</textPath>',
    });
  });

  it('toSvg places the text element between its prefix and the style attributes', () => {
    const at = { kind: 'path', subpaths: [polyline([[0, 0], [100, 0]], false)], offset: 0 } as const;
    const node = textNode({ at, transform: [1, 0, 0, 1, 5, 6], style: { fill: '#264653' } });
    const svg = toSvg(docOf([node]));
    expect(svg).toContain('<defs><path id="__tp_t" d="M0 0 L100 0"/></defs><text id="t" font-family="Tajawal" font-size="40" transform="matrix(1 0 0 1 5 6)" fill="#264653">');
    expect(svg).toContain('<textPath href="#__tp_t" startOffset="0%">Hello</textPath></text>');
  });

  it('renders a textPath whose href has no xlink prefix', () => {
    const at = { kind: 'path', subpaths: [polyline([[40, 150], [360, 150]], false)], offset: 0 } as const;
    expect(inkPixels(docOf([textNode({ at, font: { family: 'Tajawal', size: 30, weight: 400, letterSpacing: 0 } })]))).toBeGreaterThan(100);
  });
});

describe('render/text-metrics', () => {
  it('measures the ink box of a word', () => {
    const box = measureInk(textNode(), fonts)!;
    expect(box.width).toBeGreaterThan(60);
    expect(box.width).toBeLessThan(160);
    expect(box.height).toBeGreaterThan(20);
    expect(box.height).toBeLessThan(45);
    expect(box.x).toBeGreaterThan(10);
    expect(Object.keys(box).sort()).toEqual(['height', 'width', 'x', 'y']);
  });

  it('measures the same node the same way again (cache hit) and a changed node differently', () => {
    const node = textNode();
    const first = measureInk(node, fonts);
    expect(measureInk(node, fonts)).toEqual(first);
    expect(measureInk(textNode({ content: 'Hello, world' }), fonts)!.width).toBeGreaterThan(first!.width);
  });

  it('returns null when nothing is drawn', () => {
    expect(measureInk(textNode({ content: '   ' }), fonts)).toBeNull();
    expect(measureInk(textNode({ content: '   ' }), fonts)).toBeNull();
  });
});
