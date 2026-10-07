import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { bbox, FONT, inkPixels, renderPng, savePng, svgDoc, textSvg } from '../src/resvg.ts';

const AR_HOUSE = 'بيت'; // "بيت": letters that join
const AR_HOUSE_ISOLATED = 'ب‌ي‌ت'; // same letters, ZWNJ blocks joining
// "مرحبا Hello": Arabic then a Latin word. Only the paragraph base direction decides the visual
// order (RTL: "Hello" on the left). "عدد 123" cannot tell them apart: digits after Arabic join the RTL run.
const AR_MIXED = 'مرحبا Hello';

describe('R2: resvg-js text with bundled fonts only', () => {
  it('renders Latin text using only the bundled fonts', () => {
    const svg = textSvg('Hello');
    savePng('r2-latin', svg);
    expect(inkPixels(svg)).toBeGreaterThan(200);
  });

  it('falls back to the default family when the requested font is not bundled', () => {
    const svg = svgDoc('<text x="10" y="70" font-family="Arial" font-size="40">Hello</text>');
    expect(inkPixels(svg)).toBeGreaterThan(200);
  });

  it('getBBox returns the ink box of a single text element (spec S2)', () => {
    const b = bbox(textSvg('Hello'));
    console.info(`[R2] "Hello" 40px Tajawal bbox: x=${b?.x} y=${b?.y} w=${b?.width} h=${b?.height}`);
    expect(b).toBeDefined();
    expect(b!.width).toBeGreaterThan(60);
    expect(b!.width).toBeLessThan(160);
    expect(b!.height).toBeGreaterThan(20);
    expect(b!.height).toBeLessThan(45);
    expect(b!.x).toBeGreaterThan(5);
  });

  it('shapes Arabic: joined letters are narrower than the same letters kept isolated', () => {
    savePng('r2-arabic-joined', textSvg(AR_HOUSE));
    savePng('r2-arabic-isolated', textSvg(AR_HOUSE_ISOLATED));
    expect(bbox(textSvg(AR_HOUSE))!.width).toBeLessThan(bbox(textSvg(AR_HOUSE_ISOLATED))!.width);
  });

  it('F1: base direction is ignored, so mixed RTL text needs RLI…PDI wrapping', () => {
    const plain = textSvg(AR_MIXED, 'direction="rtl"');
    const wrapped = textSvg(`⁧${AR_MIXED}⁩`, 'direction="rtl"');
    savePng('r2-mixed-plain', plain);
    savePng('r2-mixed-wrapped', wrapped);
    expect(renderPng(plain).equals(renderPng(wrapped))).toBe(false);
  });

  it('renders text along a path (textPath)', () => {
    const svg = svgDoc(
      '<defs><path id="curve" d="M10 100 C 100 0, 300 0, 390 100"/></defs>' +
        '<text font-family="Tajawal" font-size="24"><textPath xlink:href="#curve">Along the curve</textPath></text>',
    );
    savePng('r2-textpath', svg);
    expect(inkPixels(svg)).toBeGreaterThan(100);
  });

  it('toString() returns usvg SVG with text converted to paths', () => {
    const out = new Resvg(textSvg('Hello'), { font: FONT }).toString();
    expect(out).not.toContain('<text');
    expect(out).toContain('<path');
  });
});
