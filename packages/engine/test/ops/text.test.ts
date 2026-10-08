import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Box } from '../../src/geometry/types.ts';
import { boolean } from '../../src/ops/boolean.ts';
import { pathCommands } from '../../src/ops/paths.ts';
import { executeBatch, Registry, type BatchResult } from '../../src/ops/registry.ts';
import { rect } from '../../src/ops/shapes.ts';
import { duplicate, group } from '../../src/ops/structure.ts';
import { setText, text, textOnPath } from '../../src/ops/text.ts';
import { transform } from '../../src/ops/transform.ts';
import { rasterize, type RasterFonts } from '../../src/render/raster.ts';
import { createDocument, validateDocument, type Doc, type TextNode } from '../../src/scene/model.ts';
import { expectIntact } from '../fixtures.ts';

const font = (file: string) => fileURLToPath(new URL(`../../assets/fonts/${file}`, import.meta.url));
const fonts: RasterFonts = { files: [font('Tajawal-Regular.ttf'), font('Tajawal-Bold.ttf')], defaultFamily: 'Tajawal' };

const registry = new Registry().register(text, textOnPath, setText, rect, pathCommands, transform, duplicate, group, boolean);
const empty = () => createDocument({ width: 800, height: 600 });
function run(ops: unknown[], doc: Doc = empty()): BatchResult {
  const r = executeBatch(registry, doc, ops, { fonts });
  expectIntact(r.doc);
  return r;
}
const textOf = (r: BatchResult, id: string) => r.doc.nodes[id] as TextNode;
const boundsOf = (r: BatchResult, i = 0): Box => (r.results[i] as { bounds: Box }).bounds;

/** The box of the dark pixels when the document is drawn black on white. */
function darkBox(doc: Doc): Box {
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
const WAVE = { op: 'path_commands', id: 'wave', d: 'M60 300 C 240 100, 560 500, 740 300' };
const CAPTION = [WAVE, { op: 'text_on_path', id: 't', path: 'wave', content: 'Caption', size: 30 }];
const warningCodes = (r: BatchResult, i: number): string[] => {
  const outcome = r.results[i]!;
  return 'warnings' in outcome ? outcome.warnings.map((w) => w.code) : [];
};
const pathAt = (r: BatchResult, id: string) => textOf(r, id).at as Extract<TextNode['at'], { kind: 'path' }>;
const error = (r: BatchResult) => (r.results.find((o) => o.status === 'error') as { error: { code: string; hint: string } }).error;

describe('ops/text: text', () => {
  it('places point text with its look in the node and the measured ink box as its bounds', () => {
    const r = run([{ op: 'text', id: 'hello', content: 'Hello', x: 100, y: 200, size: 40, style: { fill: 'teal' } }]);
    const node = textOf(r, 'hello');
    expect(node).toMatchObject({
      type: 'text',
      content: 'Hello',
      font: { family: 'Tajawal', size: 40, weight: 400, letterSpacing: 0 },
      anchor: 'start',
      direction: 'ltr',
      lineHeight: 1.2,
      at: { kind: 'point', x: 100, y: 200 },
      style: { fill: 'teal' },
    });
    const b = boundsOf(r);
    expect(b.width).toBeGreaterThan(60);
    expect(b.width).toBeLessThan(160);
    expect(b).toEqual(node.ink);
  });

  it('defaults to size 24 and the renderer font family; percent sizes and positions use the canvas', () => {
    const plain = executeBatch(registry, empty(), [{ op: 'text', id: 'a', content: 'Hi', x: 10, y: 50 }]);
    expect(plain.ok).toBe(true);
    expect((plain.doc.nodes.a as TextNode).font).toEqual({ family: 'sans-serif', size: 24, weight: 400, letterSpacing: 0 });
    const r = run([{ op: 'text', id: 'a', content: 'Hi', x: '50%', y: '50%', size: '5%' }]);
    expect(textOf(r, 'a')).toMatchObject({ font: { size: 30 }, at: { x: 400, y: 300 } });
  });

  it('weight takes words or numbers; bold is wider than normal', () => {
    const r = run([
      { op: 'text', id: 'n', content: 'Hello', x: 10, y: 100, size: 40, weight: 'normal' },
      { op: 'text', id: 'b', content: 'Hello', x: 10, y: 200, size: 40, weight: 'bold' },
      { op: 'text', id: 'w', content: 'Hello', x: 10, y: 300, size: 40, weight: 600, letter_spacing: 3 },
    ]);
    expect(textOf(r, 'n').font.weight).toBe(400);
    expect(textOf(r, 'b').font.weight).toBe(700);
    expect(textOf(r, 'w').font).toMatchObject({ weight: 600, letterSpacing: 3 });
    expect(boundsOf(r, 1).width).toBeGreaterThan(boundsOf(r, 0).width);
  });

  it('acceptance: the world bounds match the drawn pixels for point text, within 2 px per edge', () => {
    for (const call of [
      { content: 'Hello', x: 100, y: 200, size: 40 },
      { content: 'Quick brown fox', x: 50, y: 120, size: 64, weight: 'bold' },
      { content: 'tiny', x: 300, y: 300, size: 12 },
      { content: 'Two lines\nof text', x: 100, y: 100, size: 36, line_height: 1.5 },
    ]) {
      const r = run([{ op: 'text', id: 't', ...call, style: { fill: '#000000' } }]);
      expectBoxNear(boundsOf(r), darkBox(r.doc), 2);
    }
  });

  it('acceptance: Arabic text is measured where it is drawn', () => {
    const r = run([{ op: 'text', id: 't', content: 'مرحبا بالعالم', x: 400, y: 200, size: 48, anchor: 'middle', style: { fill: '#000000' } }]);
    expect(textOf(r, 't').direction).toBe('rtl');
    expectBoxNear(boundsOf(r), darkBox(r.doc), 2);
  });

  it('multi-line text grows downward by line_height', () => {
    const one = boundsOf(run([{ op: 'text', content: 'Line', x: 10, y: 100, size: 40 }]));
    const three = boundsOf(run([{ op: 'text', content: 'Line\nLine\nLine', x: 10, y: 100, size: 40, line_height: 2 }]));
    expect(three.y).toBeCloseTo(one.y, 1);
    expect(three.height).toBeCloseTo(one.height + 2 * 40 * 2, 0);
  });

  it('anchor middle centers the text on x and end ends it there', () => {
    // The anchor works on the advance width, so the ink sits within a few px of it (side bearings).
    const at = (anchor: string) => boundsOf(run([{ op: 'text', content: 'Hello', x: 400, y: 200, size: 40, anchor }]));
    const start = at('start'), middle = at('middle'), end = at('end');
    expect(Math.abs(start.x - 400)).toBeLessThan(4);
    expect(Math.abs(middle.x + middle.width / 2 - 400)).toBeLessThan(4);
    expect(Math.abs(end.x + end.width - 400)).toBeLessThan(4);
    expect(middle.x).toBeCloseTo(start.x - start.width / 2, -1);
  });

  it('anchors stay physical for right-to-left text: end stops at x, start begins there', () => {
    const at = (anchor: string) => boundsOf(run([{ op: 'text', content: 'مرحبا بالعالم', x: 400, y: 200, size: 48, anchor }]));
    expect(Math.abs(at('end').x + at('end').width - 400)).toBeLessThan(6);
    expect(Math.abs(at('start').x - 400)).toBeLessThan(6);
  });

  it('a transform moves the bounds with it', () => {
    const r = run([
      { op: 'text', id: 't', content: 'Hello', x: 100, y: 200, size: 40 },
      { op: 'transform', ids: ['t'], rotate: 90 },
    ]);
    const before = textOf(r, 't').ink!;
    const after = boundsOf(r, 1);
    expect(after.width).toBeCloseTo(before.height, 1);
    expect(after.height).toBeCloseTo(before.width, 1);
  });

  it('lands at its canvas coordinates inside a transformed group', () => {
    const r = run([
      { op: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10 },
      { op: 'group', id: 'g', ids: ['r'] },
      { op: 'transform', ids: ['g'], scale: 2, translate: [30, 40] },
      { op: 'text', id: 'inside', content: 'Hello', x: 100, y: 200, size: 40, parent: 'g', style: { fill: '#000000' } },
      { op: 'text', id: 'outside', content: 'Hello', x: 100, y: 200, size: 40 },
    ]);
    const inside = r.doc.nodes.inside!, outside = r.doc.nodes.outside!;
    expect(inside.parent).toBe('g');
    const bounds = (id: string) => (r.results.find((o) => o.status === 'ok' && o.id === id) as { bounds: Box }).bounds;
    expectBoxNear(bounds('inside'), bounds('outside'), 1e-6);
    expect(outside.parent).toBeNull();
  });

  it('duplicate keeps text as text, with the same content and look', () => {
    const r = run([
      { op: 'text', id: 't', content: 'Hello', x: 100, y: 200, size: 40, weight: 'bold' },
      { op: 'duplicate', ids: ['t'], offset: [0, 60], id: 'copy' },
    ]);
    expect(textOf(r, 'copy')).toMatchObject({ type: 'text', content: 'Hello', font: { weight: 700, size: 40 } });
    expect(boundsOf(r, 1)).toBeDefined();
  });

  it('cannot join a boolean', () => {
    const r = run([
      { op: 'rect', id: 'r', x: 0, y: 0, width: 50, height: 50 },
      { op: 'text', id: 't', content: 'Hi', x: 10, y: 40 },
      { op: 'boolean', mode: 'union', ids: ['r', 't'] },
    ]);
    expect(r.ok).toBe(false);
    expect(error(r)).toMatchObject({ code: 'invalid_structure' });
  });

  it('detects the direction from the first letter, unless one is given', () => {
    const direction = (content: string, extra: object = {}) => textOf(run([{ op: 'text', id: 't', content, x: 400, y: 100, ...extra }]), 't').direction;
    expect(direction('Hello')).toBe('ltr');
    expect(direction('مرحبا')).toBe('rtl');
    expect(direction('שלום')).toBe('rtl');
    expect(direction('123 مرحبا')).toBe('rtl');
    expect(direction('Hello مرحبا')).toBe('ltr');
    expect(direction('123 !?')).toBe('ltr');
    expect(direction('مرحبا', { direction: 'ltr' })).toBe('ltr');
    expect(direction('Hello', { direction: 'rtl' })).toBe('rtl');
    expect(direction('مرحبا', { direction: 'auto' })).toBe('rtl');
  });

  it('survives the document round trip', () => {
    const r = run([
      { op: 'text', id: 't', content: 'Hello\nمرحبا', x: 100, y: 200, size: 40, weight: 'bold', anchor: 'end', letter_spacing: 1.5 },
      { op: 'path_commands', id: 'p', d: 'M60 300 C 240 100, 560 500, 740 300' },
      { op: 'text_on_path', id: 'tp', path: 'p', content: 'Along', offset: '20%' },
    ]);
    expect(validateDocument(JSON.parse(JSON.stringify(r.doc)))).toEqual(r.doc);
  });

  it('warns when the text draws nothing, and keeps the node without bounds', () => {
    const r = run([{ op: 'text', id: 't', content: '\u{200B}', x: 10, y: 50 }]);
    expect(r.results[0]).toMatchObject({ status: 'ok', bounds: null, warnings: [{ code: 'no_ink' }] });
    expect(textOf(r, 't').ink).toBeNull();
  });

  it('rejects bad input with a hint', () => {
    const bad = (call: object) => run([{ op: 'text', content: 'Hi', x: 10, y: 50, ...call }]);
    for (const call of [
      { content: '' },
      { content: '   \n ' },
      { content: 'a\u0001b' },
      { content: 'a'.repeat(2001) },
      { font: 'Arial; color: red' },
      { weight: 50 },
      { weight: 'heavy' },
      { anchor: 'left' },
      { line_height: 9 },
      { letter_spacing: 5000 },
    ]) {
      const r = bad(call);
      expect(r.ok, JSON.stringify(call)).toBe(false);
      expect(error(r).code).toBe('invalid_input');
    }
    for (const size of [0, -5, 20_000]) {
      const r = bad({ size });
      expect(error(r), `size ${size}`).toMatchObject({ code: 'invalid_input', hint: expect.stringContaining('font size') });
    }
  });

  it('rejects a position or size too large to draw instead of storing non-finite numbers', () => {
    const bad = (call: object) => run([{ op: 'text', content: 'Hi', x: 10, y: 50, ...call }]);
    for (const call of [{ x: `${'9'.repeat(400)}%` }, { x: 1e308 }, { y: '99999999999%' }, { size: `${'9'.repeat(400)}%` }]) {
      const r = bad(call);
      expect(r.ok, JSON.stringify(call).slice(0, 40)).toBe(false);
      expect(error(r).code).toBe('invalid_input');
      expect(r.doc.root).toEqual([]);
    }
  });
});

describe('ops/text: text_on_path', () => {
  it('follows the guide and removes it', () => {
    const r = run([WAVE, { op: 'text_on_path', id: 'caption', path: 'wave', content: 'Riding the wave', size: 36, offset: '10%' }]);
    expect(Object.keys(r.doc.nodes)).toEqual(['caption']);
    expect(r.doc.root).toEqual(['caption']);
    expect(r.lastCreated).toBe('caption');
    const node = textOf(r, 'caption');
    expect(node.at).toMatchObject({ kind: 'path', offset: 0.1, subpaths: [{ start: [60, 300], closed: false }] });
    expect(pathAt(r, 'caption').subpaths).toHaveLength(1);
  });

  it('acceptance: the world bounds match the drawn pixels, within 3 px per edge', () => {
    for (const extra of [{}, { anchor: 'middle', offset: '50%' }, { weight: 'bold', size: 28 }]) {
      const r = run([WAVE, { op: 'text_on_path', id: 'caption', path: 'wave', content: 'Riding the wave', size: 36, style: { fill: '#000000' }, ...extra }]);
      expectBoxNear(boundsOf(r, 1), darkBox(r.doc), 3);
    }
  });

  it('keeps the guide with keep, and takes "$last" as the guide', () => {
    const r = run([WAVE, { op: 'text_on_path', path: '$last', content: 'Hi', keep: true }]);
    expect(Object.keys(r.doc.nodes)).toEqual(['wave', 'text-1']);
    expect(r.lastCreated).toBe('text-1');
  });

  it('offset is a percent of the length or a distance along the guide', () => {
    const line = { op: 'path_commands', id: 'line', d: 'M100 300 L500 300' };
    const offsetOf = (offset: unknown) => (textOf(run([line, { op: 'text_on_path', id: 't', path: 'line', content: 'Hi', offset }]), 't').at as { offset: number }).offset;
    expect(offsetOf(undefined)).toBe(0);
    expect(offsetOf('25%')).toBe(0.25);
    expect(offsetOf(100)).toBeCloseTo(0.25, 6);
    const clamped = run([line, { op: 'text_on_path', id: 't', path: 'line', content: 'Hi', offset: '150%' }]);
    expect(textOf(clamped, 't').at).toMatchObject({ offset: 1 });
    expect(warningCodes(clamped, 1)).toContain('offset_clamped');
  });

  it('uses the first subpath of a multi-subpath guide, with a warning', () => {
    const r = run([{ op: 'path_commands', id: 'two', d: 'M100 100 L300 100 M100 200 L300 200' }, { op: 'text_on_path', id: 't', path: 'two', content: 'Hi' }]);
    expect(r.results[1]).toMatchObject({ warnings: [{ code: 'subpaths_ignored' }] });
    expect(pathAt(r, 't').subpaths.map((sp) => sp.start)).toEqual([[100, 100]]);
  });

  it('the guide may sit in a transformed group', () => {
    const control = run([WAVE, { op: 'text_on_path', id: 't', path: 'wave', content: 'Riding', size: 30 }]);
    const r = run([
      { op: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10 },
      { op: 'group', id: 'g', ids: ['r'] },
      { op: 'transform', ids: ['g'], scale: 1.5, rotate: 20, translate: [30, 40] },
      { ...WAVE, parent: 'g' },
      { op: 'text_on_path', id: 't', path: 'wave', content: 'Riding', size: 30, parent: 'g' },
    ]);
    expect(r.doc.nodes.t!.parent).toBe('g');
    expectBoxNear(boundsOf(r, 4), boundsOf(control, 1), 1e-6);
  });

  it('rejects a guide that is not a path, has no length, or text with line breaks', () => {
    const guide = (extra: object[], call: object = {}) => run([...extra, { op: 'text_on_path', path: 'g', content: 'Hi', ...call }]);
    const group = guide([{ op: 'rect', id: 'r', x: 0, y: 0, width: 5, height: 5 }, { op: 'group', id: 'g', ids: ['r'] }]);
    expect(error(group)).toMatchObject({ code: 'invalid_structure', hint: expect.stringContaining('path_commands') });
    expect(error(guide([{ op: 'text', id: 'g', content: 'x', x: 1, y: 20 }])).code).toBe('invalid_structure');
    expect(error(guide([{ op: 'path_commands', id: 'g', d: 'M10 10 L10 10' }])).code).toBe('invalid_structure');
    expect(error(guide([{ op: 'path_commands', id: 'g', d: 'M10 10 L100 10' }], { content: 'a\nb' })).code).toBe('invalid_input');
    expect(error(guide([], { path: 'missing' })).code).toBe('unknown_id');
  });
});

describe('ops/text: set_text', () => {
  const HELLO = { op: 'text', id: 't', content: 'Hello', x: 400, y: 200, size: 40, weight: 'bold', anchor: 'middle' };

  it('re-measures: longer content widens the bounds, other fields stay', () => {
    const r = run([HELLO, { op: 'set_text', id: 't', content: 'Hello, wider world' }]);
    expect(boundsOf(r, 1).width).toBeGreaterThan(boundsOf(r, 0).width * 2);
    expect(textOf(r, 't')).toMatchObject({ content: 'Hello, wider world', font: { size: 40, weight: 700 }, anchor: 'middle', at: { kind: 'point', x: 400, y: 200 } });
    expect(textOf(r, 't').ink).toEqual(boundsOf(r, 1));
    expectBoxNear(boundsOf(r, 1), darkBox(run([{ ...HELLO, content: 'Hello, wider world', style: { fill: '#000000' } }]).doc), 4);
  });

  it('changes only what is given: size, weight words, spacing, anchor, line height', () => {
    const r = run([HELLO, { op: 'set_text', id: 't', size: '10%', weight: 'normal', letter_spacing: 2, anchor: 'end', line_height: 2 }]);
    expect(textOf(r, 't')).toMatchObject({ content: 'Hello', font: { size: 60, weight: 400, letterSpacing: 2 }, anchor: 'end', lineHeight: 2 });
  });

  it('keeps the direction unless the content changes or one is given', () => {
    const ar = run([{ op: 'text', id: 't', content: 'مرحبا', x: 400, y: 100, direction: 'ltr' }, { op: 'set_text', id: 't', size: 30 }]);
    expect(textOf(ar, 't').direction).toBe('ltr');
    expect(textOf(run([{ op: 'text', id: 't', content: 'Hello', x: 400, y: 100 }, { op: 'set_text', id: 't', content: 'مرحبا' }]), 't').direction).toBe('rtl');
    expect(textOf(run([{ op: 'text', id: 't', content: 'Hello', x: 400, y: 100 }, { op: 'set_text', id: 't', direction: 'rtl' }]), 't').direction).toBe('rtl');
  });

  it('edits text on a path in place', () => {
    const r = run([...CAPTION, { op: 'set_text', id: 't', content: 'A much longer caption' }]);
    expect(textOf(r, 't').at.kind).toBe('path');
    expect(boundsOf(r, 2).width).toBeGreaterThan(boundsOf(r, 1).width);
  });

  it('rejects other nodes, an empty change, bad content and line breaks on a path', () => {
    const rectOp = { op: 'rect', id: 'r', x: 0, y: 0, width: 5, height: 5 };
    expect(error(run([rectOp, { op: 'set_text', id: 'r', content: 'x' }])).code).toBe('invalid_structure');
    expect(error(run([HELLO, { op: 'set_text', id: 't' }]))).toMatchObject({ code: 'invalid_input', hint: expect.stringContaining('at least one') });
    expect(error(run([HELLO, { op: 'set_text', id: 't', content: '' }])).code).toBe('invalid_input');
    expect(error(run([...CAPTION, { op: 'set_text', id: 't', content: 'a\nb' }])).code).toBe('invalid_input');
    expect(error(run([HELLO, { op: 'set_text', id: 'nope', content: 'x' }])).code).toBe('unknown_id');
  });
});

describe('ops/text: registration', () => {
  it('every example runs and ends with its op', () => {
    for (const def of [text, textOnPath, setText]) {
      expect(def.domain).toBe('text');
      expect(def.examples.length).toBeGreaterThan(0);
      for (const example of def.examples) {
        expect(example.at(-1)?.op).toBe(def.name);
        const r = executeBatch(registry, empty(), example, { fonts });
        expect(r.ok, JSON.stringify(r.results)).toBe(true);
        expect(r.results.flatMap((o) => (o.status === 'ok' ? o.warnings : []))).toEqual([]);
      }
    }
  });
});
