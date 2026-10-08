import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDocument, createRegistry, executeBatch, integrityProblem, rasterize, toSvg, validateDocument, type BatchResult, type Box, type RasterFonts, type TextNode } from '../src/index.ts';

const font = (file: string) => fileURLToPath(new URL(`../assets/fonts/${file}`, import.meta.url));
const fonts: RasterFonts = { files: [font('Tajawal-Regular.ttf'), font('Tajawal-Bold.ttf')], defaultFamily: 'Tajawal' };

const registry = createRegistry();
const TITLE = { op: 'text', id: 'title', content: 'Agent Illustrator', x: '50%', y: 120, size: 56, weight: 'bold', anchor: 'middle', style: { fill: '#264653' } };
const PLACE_TITLE = { op: 'place', ids: ['title'], relative_to: 'canvas', anchor: 'top', offset: [0, 30] };
const SCENE = [
  { op: 'rect', id: 'bg', x: 0, y: 0, width: '100%', height: '100%', style: { fill: '#f8f9fa' } },
  TITLE,
  { op: 'text', id: 'notes', content: 'Two lines of\ntext below', x: 80, y: 220, size: 28, line_height: 1.4, style: { fill: '#2a9d8f' } },
  { op: 'text', id: 'arabic', content: 'مرحبا بالعالم', x: '50%', y: 360, size: 44, anchor: 'middle', style: { fill: '#e76f51' } },
  { op: 'path_commands', id: 'arc', d: 'M120 560 Q400 380 680 560', style: { fill: 'none', stroke: '#adb5bd', strokeWidth: 2 } },
  { op: 'text_on_path', id: 'caption', path: 'arc', content: 'Text on an arc', size: 30, keep: true, style: { fill: '#264653' } },
  PLACE_TITLE,
  { op: 'text', id: 'label', content: 'rotated', x: 560, y: 250, size: 24, style: { fill: '#6d597a' } },
  { op: 'transform', ids: ['label'], rotate: -15 },
  { op: 'set_text', id: 'label', content: 'rotated label', weight: 'bold' },
];
const fresh = () => createDocument({ width: 800, height: 600, seed: 9 });
const run = (): BatchResult => executeBatch(registry, fresh(), SCENE, { fonts });
const textOf = (r: BatchResult, id: string) => r.doc.nodes[id] as TextNode;

/** The box of the dark pixels when the document is drawn black on white. */
function darkBox(doc: Parameters<typeof rasterize>[0]): Box {
  const { width, height, pixels } = rasterize(doc, { fonts });
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4]! >= 128) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x + 1);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y + 1);
    }
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
function expectBoxNear(actual: Box, expected: Box, px: number): void {
  const edges = (b: Box) => [b.x, b.y, b.x + b.width, b.y + b.height];
  edges(actual).forEach((edge, i) => expect(Math.abs(edge - edges(expected)[i]!), `edge ${i}: ${edge} vs ${edges(expected)[i]}`).toBeLessThanOrEqual(px));
}
/** Just the title, drawn black on white, so the dark pixels are the title's ink. */
const titleOnly = (...ops: unknown[]) => executeBatch(registry, createDocument({ width: 800, height: 600, background: '#ffffff' }), [{ ...TITLE, style: { fill: '#000000' } }, ...ops], { fonts });

describe('M8 acceptance', () => {
  it('every op reports ok, and every node that draws has finite bounds', () => {
    const r = run();
    expect(r.ok, JSON.stringify(r.results.find((o) => o.status === 'error'))).toBe(true);
    expect(integrityProblem(r.doc)).toBeNull();
    for (const [i, outcome] of r.results.entries()) {
      expect(outcome.status, `op ${i}`).toBe('ok');
      if (outcome.status !== 'ok' || outcome.id === undefined) continue;
      const b = outcome.bounds!;
      expect(b, `op ${i} (${outcome.op})`).not.toBeNull();
      for (const v of [b.x, b.y, b.width, b.height]) expect(Number.isFinite(v)).toBe(true);
      expect(outcome.warnings, `op ${i} (${outcome.op})`).toEqual([]);
    }
  });

  it('measures with the bundled font, and the text kinds come out as intended', () => {
    const r = run();
    for (const id of ['title', 'notes', 'arabic', 'caption', 'label']) expect(textOf(r, id), id).toMatchObject({ type: 'text', font: { family: 'Tajawal' } });
    expect(textOf(r, 'title')).toMatchObject({ content: 'Agent Illustrator', anchor: 'middle', direction: 'ltr', font: { size: 56, weight: 700 } });
    expect(textOf(r, 'arabic').direction).toBe('rtl');
    expect(textOf(r, 'caption').at).toMatchObject({ kind: 'path' });
    expect(r.doc.nodes.arc, 'keep: true keeps the guide').toBeDefined();
    // Two lines are taller than one line height.
    expect(textOf(r, 'notes').ink!.height).toBeGreaterThan(28 * 1.4);
  });

  it('place puts the title at the canvas top, centered', () => {
    const r = run();
    const b = (r.results[SCENE.indexOf(PLACE_TITLE)] as { bounds: Box }).bounds;
    expect(b.y).toBeCloseTo(30, 1);
    expect(b.x + b.width / 2).toBeCloseTo(400, 1);
  });

  it('transform and set_text compose: the rotated label keeps its turn, its new content and its weight', () => {
    const r = run();
    const label = textOf(r, 'label');
    expect(label).toMatchObject({ content: 'rotated label', font: { weight: 700, size: 24 } });
    expect(label.transform).not.toEqual([1, 0, 0, 1, 0, 0]);
    // Turned -15 degrees, the world box is taller than the flat ink box.
    const b = (r.results.at(-1) as { bounds: Box }).bounds;
    expect(b.height).toBeGreaterThan(label.ink!.height);
  });

  it('acceptance: the title bounds match the drawn pixels, within 2 px per edge', () => {
    const r = titleOnly();
    expect(r.ok).toBe(true);
    expectBoxNear((r.results[0] as { bounds: Box }).bounds, darkBox(r.doc), 2);
  });

  it('acceptance: the placed title bounds still match the drawn pixels, within 2 px per edge', () => {
    const r = titleOnly(PLACE_TITLE);
    expect(r.ok).toBe(true);
    expectBoxNear((r.results[1] as { bounds: Box }).bounds, darkBox(r.doc), 2);
  });

  it('renders the whole scene', () => {
    const img = rasterize(run().doc, { fonts });
    expect([img.width, img.height]).toEqual([800, 600]);
    expect(Buffer.from(img.png).subarray(1, 4).toString('ascii')).toBe('PNG');
  });

  it('is deterministic', () => {
    const a = run();
    const b = run();
    expect(toSvg(a.doc)).toBe(toSvg(b.doc));
    expect(a.doc).toEqual(b.doc);
  });

  it('survives a JSON round trip', () => {
    const { doc } = run();
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });
});
