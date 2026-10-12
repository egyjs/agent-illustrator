import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry } from '@agent-illustrator/engine';
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
const open = (d: ToolDeps) => json(createDocumentTool(d, { width: 200, height: 100, background: 'white', seed: 7 })).doc_id as string;

describe('tools: create_document', () => {
  it('returns a doc_id, the canvas and the seed', () => {
    const d = deps();
    const r = json(createDocumentTool(d, { width: 200, height: 100, seed: 7 }));
    expect(r).toMatchObject({ width: 200, height: 100, seed: 7 });
    expect(r.doc_id).toMatch(/^doc-[0-9a-f]{6}$/);
    expect(typeof json(createDocumentTool(d, { width: 10, height: 10 })).seed).toBe('number');
  });

  it('malformed input is an invalid_input result with a hint, validated by the tool itself', () => {
    const r = createDocumentTool(deps(), { width: 'big', height: 10 });
    expect(r.isError).toBe(true);
    expect(json(r)).toMatchObject({ error: { code: 'invalid_input' } });
    expect((json(r).error as { hint: string }).hint).toContain('"width"');
    expect(json(applyOpsTool(deps(), { doc_id: 'x', ops: 'rect' }))).toMatchObject({ error: { code: 'invalid_input' } });
  });

  it('a bad background returns isError with code, message and hint', () => {
    const r = createDocumentTool(deps(), { width: 10, height: 10, background: 'blurple' });
    expect(r.isError).toBe(true);
    expect(json(r)).toMatchObject({ error: { code: 'invalid_color' } });
    expect((json(r).error as { hint: string }).hint.length).toBeGreaterThan(10);
  });
});

describe('tools: apply_ops', () => {
  it('applies a batch, reports rounded bounds, and keeps $last across calls', () => {
    const d = deps();
    const id = open(d);
    const r1 = applyOpsTool(d, { doc_id: id, ops: [{ op: 'ellipse', id: 'sun', cx: 50.123, cy: 50, rx: 20 }] });
    expect(r1.isError).toBeUndefined();
    expect(json(r1)).toMatchObject({ ok: true, results: [{ op: 'ellipse', status: 'ok', id: 'sun', bounds: { x: 30.12, y: 30, width: 40, height: 40 } }] });
    const r2 = applyOpsTool(d, { doc_id: id, ops: [{ op: 'style', ids: ['$last'], style: { fill: 'gold' } }] });
    expect(json(r2)).toMatchObject({ ok: true, results: [{ ids: ['sun'] }] });
  });

  it('a failing batch returns isError, per-op statuses, and leaves the document unchanged', () => {
    const d = deps();
    const id = open(d);
    const r = applyOpsTool(d, { doc_id: id, ops: [{ op: 'rect', x: 0, y: 0, width: 10, height: 10 }, { op: 'delete', ids: ['ghost'] }] });
    expect(r.isError).toBe(true);
    expect(json(r)).toMatchObject({ ok: false, results: [{ status: 'rolled_back' }, { status: 'error', error: { code: 'unknown_id' } }] });
    expect(Object.keys(d.sessions.get(id).store.doc.nodes)).toEqual([]);
  });

  it('dry_run reports without committing; an unknown doc_id is an error result', () => {
    const d = deps();
    const id = open(d);
    expect(json(applyOpsTool(d, { doc_id: id, ops: [{ op: 'rect', x: 0, y: 0, width: 5, height: 5 }], dry_run: true }))).toMatchObject({ ok: true, committed: false });
    expect(Object.keys(d.sessions.get(id).store.doc.nodes)).toEqual([]);
    const r = applyOpsTool(d, { doc_id: 'doc-99', ops: [{ op: 'rect' }] });
    expect(r.isError).toBe(true);
    expect(json(r)).toMatchObject({ error: { code: 'unknown_id' } });
  });

  it('too many ops is an error result, not a crash', () => {
    const d = deps();
    const id = open(d);
    const ops = Array.from({ length: d.config.limits.maxOpsPerBatch + 1 }, () => ({ op: 'rect', x: 0, y: 0, width: 1, height: 1 }));
    expect(json(applyOpsTool(d, { doc_id: id, ops }))).toMatchObject({ error: { code: 'limit_exceeded' } });
  });

  it('apply_ops input schema: loose items with additionalProperties true and the registry op enum, no $ref or oneOf', () => {
    const d = deps();
    const schema = applyOpsInputSchema(d.registry, d.config.limits);
    const items = (schema.properties as { ops: { items: Record<string, unknown> } }).ops.items;
    expect(items).toEqual({ type: 'object', properties: { op: { type: 'string', enum: d.registry.names() } }, required: ['op'], additionalProperties: true });
    expect(JSON.stringify(schema)).not.toMatch(/\$ref|\$defs|oneOf|anyOf/);
  });

  it('opSignatures lists every op with its fields, optional ones marked', () => {
    const lines = opSignatures(createRegistry()).split('\n');
    expect(lines).toContain('rect(x, y, width, height, id?, parent?, style?, radius?)');
    expect(lines).toHaveLength(createRegistry().names().length);
  });
});

describe('tools: render and export_svg', () => {
  it('render returns a text summary and a PNG image block, and writes the PNG to disk', () => {
    const d = deps();
    const id = open(d);
    applyOpsTool(d, { doc_id: id, ops: [{ op: 'rect', id: 'box', x: 10, y: 10, width: 50, height: 30, style: { fill: 'teal' } }] });
    const r = renderTool(d, { doc_id: id, overlays: ['ids', 'bounds'], scale: 2 });
    expect(r.isError).toBeUndefined();
    const [text, image] = r.content as [{ type: string; text: string }, { type: string; data: string; mimeType: string }];
    const summary = JSON.parse(text.text) as { width: number; height: number; file: string };
    expect([summary.width, summary.height]).toEqual([400, 200]);
    expect(image.type).toBe('image');
    expect(image.mimeType).toBe('image/png');
    expect(Buffer.from(image.data, 'base64').subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(existsSync(summary.file)).toBe(true);
  });

  it('each render gets its own file, so a zoom does not overwrite the full view', () => {
    const d = deps();
    const id = open(d);
    const file = (r: ToolResult) => json(r).file as string;
    const first = file(renderTool(d, { doc_id: id }));
    const second = file(renderTool(d, { doc_id: id, scale: 2 }));
    expect(first).not.toBe(second);
    expect(existsSync(first) && existsSync(second)).toBe(true);
  });

  it('render above the pixel cap is an error result', () => {
    const d = deps();
    const id = open(d);
    expect(json(renderTool(d, { doc_id: id, scale: 8, region: { x: 0, y: 0, width: 5000, height: 5000 } }))).toMatchObject({ error: { code: 'limit_exceeded' } });
  });

  it('export_svg returns optimized SVG with ids; strip_ids removes them', () => {
    const d = deps();
    const id = open(d);
    applyOpsTool(d, { doc_id: id, ops: [{ op: 'rect', id: 'box', x: 10, y: 10, width: 50, height: 30 }] });
    const svg = (exportSvgTool(d, { doc_id: id }).content[0] as { text: string }).text;
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('id="box"');
    expect((exportSvgTool(d, { doc_id: id, strip_ids: true }).content[0] as { text: string }).text).not.toContain('id=');
  });
});
