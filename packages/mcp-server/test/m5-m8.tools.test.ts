import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry, rasterize, type Box } from '@agent-illustrator/engine';
import { describe, expect, it } from 'vitest';
import { fontFiles } from '../src/assets.ts';
import { loadConfig } from '../src/config.ts';
import { imageSource } from '../src/images.ts';
import { createLogger } from '../src/logging.ts';
import { MemorySessionStore } from '../src/sessions.ts';
import { applyOpsInputSchema, applyOpsTool, createDocumentTool, exportSvgTool, opSignatures, renderTool, type ToolDeps, type ToolResult } from '../src/tools.ts';

function deps(): ToolDeps {
  const config = { ...loadConfig({}), renderDir: mkdtempSync(join(tmpdir(), 'ai-render-')) };
  return { sessions: new MemorySessionStore(config.maxDocuments), registry: createRegistry(), config, fonts: fontFiles(), images: imageSource(), log: createLogger('silent') };
}
const json = (r: ToolResult) => JSON.parse((r.content[0] as { text: string }).text) as Record<string, unknown>;
const open = (d: ToolDeps) => json(createDocumentTool(d, { width: 400, height: 200, background: 'white', seed: 7 })).doc_id as string;
type Outcome = { op: string; status: string; id?: string; ids?: string[]; bounds?: Box | null; data?: Record<string, unknown>; warnings?: { code: string }[] };
const results = (r: ToolResult) => json(r).results as Outcome[];

/** The box of the dark pixels when the document is drawn black on white. */
function darkBox(d: ToolDeps, docId: string): Box {
  const { width, height, pixels } = rasterize(d.sessions.get(docId).store.doc, { fonts: d.fonts });
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

describe('tools (M5-M8): text', () => {
  it('apply_ops with a text op returns ok and non-null bounds measured with the bundled fonts', () => {
    const d = deps();
    const id = open(d);
    const r = applyOpsTool(d, { doc_id: id, ops: [{ op: 'text', id: 'title', content: 'Hello', x: 200, y: 100, size: 48, weight: 'bold', anchor: 'middle', style: { fill: '#000000' } }] });
    expect(r.isError).toBeUndefined();
    expect(json(r)).toMatchObject({ ok: true, results: [{ op: 'text', status: 'ok', id: 'title' }] });
    const b = results(r)[0]!.bounds!;
    expect(b).not.toBeNull();
    for (const v of [b.x, b.y, b.width, b.height]) expect(Number.isFinite(v)).toBe(true);
    expect(b.width).toBeGreaterThan(50);
    expect(b.height).toBeGreaterThan(20);
    // The batch ran with the bundled fonts: the default family is Tajawal, not a system fallback...
    expect(d.sessions.get(id).store.doc.nodes.title).toMatchObject({ type: 'text', font: { family: 'Tajawal', weight: 700 } });
    // ...and the reported box is the ink those fonts draw, to the pixel (bounds are rounded to 0.01).
    const px = darkBox(d, id);
    for (const [got, want] of [[b.x, px.x], [b.y, px.y], [b.x + b.width, px.x + px.width], [b.y + b.height, px.y + px.height]] as const) {
      expect(Math.abs(got - want)).toBeLessThanOrEqual(2);
    }
  });

  it('text, text_on_path and set_text work across calls, and $last follows the text', () => {
    const d = deps();
    const id = open(d);
    const r1 = applyOpsTool(d, {
      doc_id: id,
      ops: [
        { op: 'path_commands', id: 'arc', d: 'M40 160 Q200 20 360 160', style: { fill: 'none', stroke: '#999999' } },
        { op: 'text_on_path', id: 'caption', path: 'arc', content: 'Along the arc', size: 24, keep: true },
        { op: 'text', id: 'arabic', content: 'مرحبا', x: 200, y: 190, size: 30, anchor: 'middle' },
      ],
    });
    expect(json(r1)).toMatchObject({ ok: true });
    for (const o of results(r1)) expect(o.bounds, o.op).toBeTruthy();
    const r2 = applyOpsTool(d, { doc_id: id, ops: [{ op: 'set_text', id: '$last', content: 'أهلا', weight: 'bold' }] });
    expect(json(r2)).toMatchObject({ ok: true, results: [{ op: 'set_text', status: 'ok', id: 'arabic' }] });
    expect(results(r2)[0]!.bounds).not.toBeNull();
    expect(d.sessions.get(id).store.doc.nodes.arabic).toMatchObject({ content: 'أهلا', direction: 'rtl', font: { weight: 700 } });
  });

  it('a text with nothing to draw is still ok, with a no_ink warning and no bounds field', () => {
    const d = deps();
    const id = open(d);
    const r = applyOpsTool(d, { doc_id: id, ops: [{ op: 'text', id: 'blank', content: '\u{200B}', x: 10, y: 50 }] });
    expect(json(r)).toMatchObject({ ok: true, results: [{ op: 'text', status: 'ok', id: 'blank', warnings: [{ code: 'no_ink' }] }] });
    // The tool leaves out a null box rather than printing it.
    expect(results(r)[0]).not.toHaveProperty('bounds');
  });

  it('render and export_svg of a document with text work with the bundled fonts', () => {
    const d = deps();
    const id = open(d);
    applyOpsTool(d, { doc_id: id, ops: [{ op: 'text', id: 'title', content: 'Hello', x: 200, y: 100, size: 48, anchor: 'middle' }] });
    const rendered = renderTool(d, { doc_id: id });
    expect(rendered.isError).toBeUndefined();
    expect((rendered.content[1] as { type: string }).type).toBe('image');
    const svg = (exportSvgTool(d, { doc_id: id }).content[0] as { text: string }).text;
    expect(svg).toContain('<text');
    expect(svg).toContain('Hello');
  });
});

describe('tools (M5-M8): data in results', () => {
  it('palette and tokens results include their data field', () => {
    const d = deps();
    const id = open(d);
    const r = applyOpsTool(d, { doc_id: id, ops: [{ op: 'palette', base: '#2a9d8f', harmony: 'complementary' }, { op: 'tokens', set: { ink: '#264653' } }] });
    expect(json(r)).toMatchObject({ ok: true });
    const [pal, tok] = results(r);
    const tokens = (pal!.data as { tokens: Record<string, string> }).tokens;
    expect(Object.keys(tokens)).toEqual(expect.arrayContaining(['palette.primary', 'palette.accent', 'palette.primary.1', 'palette.neutral.1']));
    for (const color of Object.values(tokens)) expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(tok!.data).toEqual({ tokens: { ink: '#264653' } });
    // The same tokens are what the session's document now holds.
    expect(d.sessions.get(id).store.doc.tokens).toMatchObject({ ...tokens, ink: '#264653' });
  });

  it('gradient and filter results include the name of the def they made', () => {
    const d = deps();
    const id = open(d);
    const r = applyOpsTool(d, {
      doc_id: id,
      ops: [
        { op: 'palette', base: '#2a9d8f', harmony: 'complementary' },
        { op: 'rect', id: 'bg', x: 0, y: 0, width: '100%', height: '100%' },
        { op: 'gradient', id: 'sky', stops: ['palette.primary.1', 'palette.accent.3'], angle: 90, ids: ['bg'] },
        { op: 'ellipse', id: 'sun', cx: 200, cy: 100, rx: 40 },
        { op: 'gradient', type: 'radial', stops: ['#fff3b0', '#e76f51'], ids: ['sun'] },
        { op: 'filter', shadow: { dy: 4, blur: 6 }, ids: ['sun'] },
      ],
    });
    expect(json(r)).toMatchObject({ ok: true });
    const out = results(r);
    expect(out[2]).toMatchObject({ op: 'gradient', ids: ['bg'], data: { def: 'sky' } });
    expect(out[4]).toMatchObject({ op: 'gradient', ids: ['sun'], data: { def: 'gradient-1' } });
    expect(out[5]).toMatchObject({ op: 'filter', ids: ['sun'], data: { def: 'filter-1' } });
    const svg = (exportSvgTool(d, { doc_id: id }).content[0] as { text: string }).text;
    for (const needle of ['<linearGradient', '<radialGradient', '<filter']) expect(svg, needle).toContain(needle);
  });

  it('a gradient with an unknown stop color is an error result with a hint, and changes nothing', () => {
    const d = deps();
    const id = open(d);
    const r = applyOpsTool(d, { doc_id: id, ops: [{ op: 'rect', id: 'bg', x: 0, y: 0, width: 10, height: 10 }, { op: 'gradient', stops: ['palette.primary.1', '#fff'], ids: ['bg'] }] });
    expect(r.isError).toBe(true);
    expect(json(r)).toMatchObject({ ok: false, results: [{ status: 'rolled_back' }, { status: 'error', error: { code: 'invalid_color' } }] });
    expect(Object.keys(d.sessions.get(id).store.doc.nodes)).toEqual([]);
  });
});

describe('tools (M5-M8): the op catalog', () => {
  const NEW_OPS = ['palette', 'tokens', 'gradient', 'filter', 'mask', 'blob', 'wave', 'roughen', 'scatter', 'repeat_along_path', 'array', 'text', 'text_on_path', 'set_text'];

  it('apply_ops accepts every M5-M8 op name, and opSignatures lists each one', () => {
    const d = deps();
    const schema = applyOpsInputSchema(d.registry, d.config.limits);
    const enumValues = (schema.properties as { ops: { items: { properties: { op: { enum: string[] } } } } }).ops.items.properties.op.enum;
    const lines = opSignatures(d.registry).split('\n');
    for (const name of NEW_OPS) {
      expect(enumValues, name).toContain(name);
      expect(lines.some((line) => line.startsWith(`${name}(`)), `signature of ${name}`).toBe(true);
    }
  });

  it('a generator runs through the tool: array makes its copies in a new group', () => {
    const d = deps();
    const id = open(d);
    const r = applyOpsTool(d, {
      doc_id: id,
      ops: [
        { op: 'rect', id: 'tile', x: 10, y: 10, width: 30, height: 20 },
        { op: 'array', id: 'tiles', source: 'tile', kind: 'grid', rows: 2, cols: 3, gap: [5, 5] },
      ],
    });
    expect(json(r)).toMatchObject({ ok: true });
    expect(results(r)[1]).toMatchObject({ op: 'array', id: 'tiles', bounds: { x: 10, y: 10, width: 100, height: 45 } });
  });
});
