import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry, decodeImage, defineOp, Registry, validateDocument, type Doc, type PathNode, type Subpath } from '@agent-illustrator/engine';
import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fontFiles } from '../src/assets.ts';
import { loadConfig } from '../src/config.ts';
import { imageSource } from '../src/images.ts';
import { createLogger } from '../src/logging.ts';
import { MemorySessionStore } from '../src/sessions.ts';
import { applyOpsInputSchema, applyOpsTool, createDocumentTool, type ToolDeps, type ToolResult } from '../src/tools.ts';

function deps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  const config = { ...loadConfig({}), renderDir: mkdtempSync(join(tmpdir(), 'ai-render-')) };
  return { sessions: new MemorySessionStore(config.maxDocuments), registry: createRegistry(), config, fonts: fontFiles(), log: createLogger('silent'), images: imageSource(), ...overrides };
}
const json = (r: ToolResult) => JSON.parse((r.content[0] as { text: string }).text) as Record<string, unknown>;
const open = (d: ToolDeps) => (json(createDocumentTool(d, { width: 200, height: 100, background: '#ffffff', seed: 7 })).doc_id as string);
const nodeCount = (d: ToolDeps, id: string) => Object.keys(d.sessions.get(id).store.doc.nodes).length;
const red = { op: 'rect', id: 'box', x: 10, y: 10, width: 50, height: 30, style: { fill: '#ff0000' } };

describe('apply_ops preview', () => {
  it('returns the reply and a PNG of the result, and leaves the document and $last alone', () => {
    const d = deps();
    const id = open(d);
    applyOpsTool(d, { doc_id: id, ops: [{ op: 'ellipse', id: 'sun', cx: 150, cy: 50, rx: 10 }] });
    const before = d.sessions.get(id).store.doc;

    const r = applyOpsTool(d, { doc_id: id, ops: [red], preview: true });
    expect(r.isError).toBeUndefined();
    expect(r.content.map((c) => c.type)).toEqual(['text', 'image']);
    expect(json(r)).toMatchObject({ ok: true, committed: false, preview: true, doc_id: id, results: [{ op: 'rect', status: 'ok', id: 'box' }] });

    const image = r.content[1] as { data: string; mimeType: string };
    expect(image.mimeType).toBe('image/png');
    const png = decodeImage(Buffer.from(image.data, 'base64'));
    expect([png.width, png.height]).toEqual([200, 100]);
    expect([...png.pixels.subarray((20 * 200 + 30) * 4, (20 * 200 + 30) * 4 + 4)]).toEqual([255, 0, 0, 255]); // inside the rect

    expect(d.sessions.get(id).store.doc).toBe(before);
    expect(nodeCount(d, id)).toBe(1);
    expect(d.sessions.get(id).lastCreated).toBe('sun');
    expect(json(applyOpsTool(d, { doc_id: id, ops: [{ op: 'style', ids: ['$last'], style: { fill: 'gold' } }] }))).toMatchObject({ results: [{ ids: ['sun'] }] });
  });

  it('previews on top of the committed document, so the image shows both', () => {
    const d = deps();
    const id = open(d);
    applyOpsTool(d, { doc_id: id, ops: [{ ...red, id: 'first', x: 100, style: { fill: '#0000ff' } }] });
    const r = applyOpsTool(d, { doc_id: id, ops: [red], preview: true });
    const png = decodeImage(Buffer.from((r.content[1] as { data: string }).data, 'base64'));
    const at = (x: number, y: number) => [...png.pixels.subarray((y * 200 + x) * 4, (y * 200 + x) * 4 + 3)];
    expect(at(30, 20)).toEqual([255, 0, 0]);
    expect(at(120, 20)).toEqual([0, 0, 255]);
  });

  it('never commits, even with dry_run: false', () => {
    const d = deps();
    const id = open(d);
    const r = applyOpsTool(d, { doc_id: id, ops: [red], preview: true, dry_run: false });
    expect(json(r)).toMatchObject({ ok: true, committed: false, preview: true });
    expect(nodeCount(d, id)).toBe(0);
  });

  it('a failed batch is the normal error result with no image', () => {
    const d = deps();
    const id = open(d);
    const r = applyOpsTool(d, { doc_id: id, ops: [red, { op: 'delete', ids: ['ghost'] }], preview: true });
    expect(r.isError).toBe(true);
    expect(r.content.map((c) => c.type)).toEqual(['text']);
    expect(json(r)).toMatchObject({ ok: false, committed: false, results: [{ status: 'rolled_back' }, { status: 'error', error: { code: 'unknown_id' } }] });
    expect(nodeCount(d, id)).toBe(0);
  });

  it('reports lint of the touched nodes like a committed batch', () => {
    const d = deps();
    const id = open(d);
    const r = applyOpsTool(d, { doc_id: id, ops: [{ ...red, id: 'off', x: 500 }], preview: true });
    expect(json(r).lint).toMatchObject([{ code: 'off_canvas', ids: ['off'] }]);
  });

  it('is advertised in the input schema and a non-boolean is an invalid_input result', () => {
    const d = deps();
    const schema = applyOpsInputSchema(d.registry, d.config.limits);
    expect((schema.properties as Record<string, { type: string; description: string }>).preview).toMatchObject({ type: 'boolean', description: expect.stringContaining('PNG') });
    expect(json(applyOpsTool(d, { doc_id: open(d), ops: [red], preview: 'yes' }))).toMatchObject({ error: { code: 'invalid_input' } });
  });
});

describe('apply_ops image source', () => {
  /** A stand-in for the trace op: reads an image through the batch's source. */
  const probe = defineOp({
    name: 'probe',
    domain: 'test',
    description: 'Reads an image.',
    schema: z.strictObject({ image: z.string() }),
    examples: [[{ op: 'probe', image: 'a.png' }]],
    handler: (input, ctx) => {
      const { width, height } = ctx.image(input.image);
      return { data: { width, height } };
    },
  });

  it('hands the images dependency to the batch, so relative paths resolve against its cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-images-'));
    writeFileSync(join(dir, 'a.png'), new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="7" height="3"><rect width="7" height="3"/></svg>').render().asPng());
    const d = deps({ registry: new Registry().register(probe), images: imageSource({ cwd: dir }) });
    const id = open(d);
    expect(json(applyOpsTool(d, { doc_id: id, ops: [{ op: 'probe', image: 'a.png' }] }))).toMatchObject({ ok: true, results: [{ data: { width: 7, height: 3 } }] });
    const missing = json(applyOpsTool(d, { doc_id: id, ops: [{ op: 'probe', image: 'b.png' }] }));
    expect(missing).toMatchObject({ ok: false, results: [{ status: 'error', error: { code: 'invalid_input', message: expect.stringContaining('no file at') } }] });
  });
});

describe('apply_ops lint of trace layers', () => {
  const line = (s: number): Subpath => ({ start: [10, 10], segs: [[10 + s, 10, 10 + s, 10, 10 + s, 10], [10 + s, 10 + s, 10 + s, 10 + s, 10 + s, 10 + s], [10, 10 + s, 10, 10 + s, 10, 10 + s], [10, 10, 10, 10, 10, 10]], closed: true });
  const layer = (id: string, parent: string, size: number): PathNode => ({ id, parent, type: 'path', transform: [1, 0, 0, 1, 0, 0], style: { fill: '#112233' }, fillRule: 'evenodd', subpaths: [line(size)] });
  /** One group of two layers, the first only 1 px across (a speck lint would call tiny). */
  function layered(kind: string): Doc {
    return validateDocument({
      schema: 1,
      seed: 1,
      canvas: { width: 100, height: 100 },
      tokens: {},
      defs: {},
      nodes: {
        g: { id: 'g', parent: null, type: 'group', transform: [1, 0, 0, 1, 0, 0], style: {}, children: ['g-1', 'g-2'], meta: { source: { kind } } },
        'g-1': layer('g-1', 'g', 1),
        'g-2': layer('g-2', 'g', 40),
      },
      root: ['g'],
    });
  }
  const restyle = (kind: string, ids: string[]) => {
    const d = deps();
    const { session } = d.sessions.create(layered(kind));
    return json(applyOpsTool(d, { doc_id: session.id, ops: [{ op: 'style', ids, style: { fill: '#445566' } }] }));
  };

  it('reports a speck in an ordinary group (control)', () => {
    expect(restyle('repeat', ['g-1']).lint).toMatchObject([{ code: 'tiny', ids: ['g-1'] }]);
    expect(restyle('repeat', ['g']).lint).toMatchObject([{ code: 'tiny', ids: ['g-1'] }]);
  });

  it('skips layers of a trace group, whether they or their group were touched', () => {
    expect(restyle('trace', ['g-1'])).toMatchObject({ ok: true });
    expect(restyle('trace', ['g-1']).lint).toBeUndefined();
    expect(restyle('trace', ['g']).lint).toBeUndefined();
    expect(restyle('trace', ['g-1', 'g-2']).lint).toBeUndefined();
  });
});

describe('apply_ops with the trace op', () => {
  /** Red and blue halves, with a 1 px green speck that lint would call tiny. */
  const flag = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-trace-'));
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="20" height="20" fill="#ff0000"/><rect x="20" width="20" height="20" fill="#0000ff"/><rect x="5" y="5" width="1" height="1" fill="#00ff00"/></svg>';
    writeFileSync(join(dir, 'flag.png'), new Resvg(svg).render().asPng());
    return join(dir, 'flag.png');
  };
  const trace = (image: string) => ({ op: 'trace', id: 'flag', image, colors: 3, speckle: 0 });

  it('previews a trace without touching the document, then commits it with no lint on the layers, and undo removes it', () => {
    const d = deps();
    const id = open(d);
    const image = flag();

    const preview = applyOpsTool(d, { doc_id: id, ops: [trace(image)], preview: true });
    expect(preview.content.map((c) => c.type)).toEqual(['text', 'image']);
    expect(json(preview)).toMatchObject({ ok: true, committed: false, preview: true, results: [{ op: 'trace', status: 'ok', id: 'flag' }] });
    expect(json(preview).lint).toBeUndefined();
    expect(nodeCount(d, id)).toBe(0);

    const committed = json(applyOpsTool(d, { doc_id: id, ops: [trace(image)] }));
    expect(committed).toMatchObject({ ok: true, committed: true });
    expect(committed.lint).toBeUndefined();
    expect(nodeCount(d, id)).toBeGreaterThan(2);

    d.sessions.get(id).store.undo();
    expect(nodeCount(d, id)).toBe(0);
  });

  it('a missing image fails the batch with the source error and no image', () => {
    const d = deps();
    const id = open(d);
    const r = applyOpsTool(d, { doc_id: id, ops: [trace(join(tmpdir(), 'ai-no-such-image.png'))], preview: true });
    expect(r.isError).toBe(true);
    expect(r.content.map((c) => c.type)).toEqual(['text']);
    expect(json(r)).toMatchObject({ ok: false, results: [{ status: 'error', error: { code: 'invalid_input', message: expect.stringContaining('no file at') } }] });
  });
});
