import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry, lint } from '@agent-illustrator/engine';
import { describe, expect, it, vi } from 'vitest';
import { describeSceneTool, lintTool, measureTool } from '../src/analysis-tools.ts';
import { fontFiles } from '../src/assets.ts';
import { loadConfig } from '../src/config.ts';
import { createLogger } from '../src/logging.ts';
import { MemorySessionStore } from '../src/sessions.ts';
import { applyOpsTool, createDocumentTool, type ToolDeps, type ToolResult } from '../src/tools.ts';

// The real lint, wrapped so one test can make it fail.
vi.mock('@agent-illustrator/engine', async (importOriginal) => {
  const engine = await importOriginal<typeof import('@agent-illustrator/engine')>();
  return { ...engine, lint: vi.fn(engine.lint) };
});

function deps(): ToolDeps {
  const config = { ...loadConfig({}), renderDir: mkdtempSync(join(tmpdir(), 'ai-analysis-')) };
  return { sessions: new MemorySessionStore(config.maxDocuments), registry: createRegistry(), config, fonts: fontFiles(), log: createLogger('silent') };
}
/** The reply body, untyped on purpose: the assertions below name the fields they rely on. */
const json = (r: ToolResult) => JSON.parse((r.content[0] as { text: string }).text);
const failure = (r: ToolResult) => {
  expect(r.isError).toBe(true);
  return json(r).error as { code: string; message: string; hint: string };
};

/** A 400x200 canvas with a house (two touching, aligned rects in a group) and a sun. */
function house(): { d: ToolDeps; id: string } {
  const d = deps();
  const id = json(createDocumentTool(d, { width: 400, height: 200, background: 'white', seed: 7 })).doc_id as string;
  const r = applyOpsTool(d, {
    doc_id: id,
    ops: [
      { op: 'rect', id: 'wall', x: 50, y: 100, width: 100, height: 60, style: { fill: '#e9c46a' } },
      { op: 'rect', id: 'roof', x: 50, y: 60, width: 100, height: 40, style: { fill: '#e76f51' } },
      { op: 'ellipse', id: 'sun', cx: 300, cy: 50, rx: 20, style: { fill: '#ffb703' } },
      { op: 'group', id: 'house', ids: ['wall', 'roof'] },
    ],
  });
  expect(json(r)).toMatchObject({ ok: true });
  return { d, id };
}
const stray = { op: 'rect', id: 'stray', x: 500, y: 10, width: 40, height: 40 };

describe('describe_scene', () => {
  it('lists canvas and nodes; outline leaves styles out, normal puts them in', () => {
    const { d, id } = house();
    const normal = json(describeSceneTool(d, { doc_id: id }));
    expect(normal).toMatchObject({ canvas: { width: 400, height: 200 }, seed: 7, nodeCount: 4, shown: 4, truncated: false });
    expect(normal.nodes.map((n: { id: string }) => n.id)).toEqual(['house', 'sun']);
    expect(normal.nodes[1]).toMatchObject({ id: 'sun', fill: '#ffb703' });
    const outline = json(describeSceneTool(d, { doc_id: id, detail: 'outline' }));
    expect(outline.nodes[1]).toEqual({ id: 'sun', type: 'path', bounds: { x: 280, y: 30, width: 40, height: 40 } });
  });

  it('root limits it to one subtree and max_nodes cuts the list, top of the tree first', () => {
    const { d, id } = house();
    expect(json(describeSceneTool(d, { doc_id: id, root: 'house' }))).toMatchObject({ nodeCount: 3, shown: 3, nodes: [{ id: 'house', children: [{ id: 'wall' }, { id: 'roof' }] }] });
    const cut = json(describeSceneTool(d, { doc_id: id, max_nodes: 2 }));
    expect(cut).toMatchObject({ nodeCount: 4, shown: 2, truncated: true, nodes: [{ id: 'house', childCount: 2 }, { id: 'sun' }] });
  });

  it('explains mistakes with a code and a hint', () => {
    const { d, id } = house();
    expect(failure(describeSceneTool(d, { doc_id: id, root: 'hose' }))).toMatchObject({ code: 'unknown_id', hint: expect.stringContaining('"house"') });
    expect(failure(describeSceneTool(d, { doc_id: id, detail: 'verbose' }))).toMatchObject({ code: 'invalid_input', hint: expect.stringContaining('Example') });
    expect(failure(describeSceneTool(d, { doc_id: id, max_nodes: 0 })).code).toBe('invalid_input');
    expect(failure(describeSceneTool(d, { doc_id: 'doc-nope' })).code).toBe('unknown_id');
  });
});

describe('measure', () => {
  it('gives bounds, area and length per node, and the gap between a pair', () => {
    const { d, id } = house();
    const m = json(measureTool(d, { doc_id: id, ids: ['roof', 'wall'] }));
    expect(m.nodes.wall).toMatchObject({ bounds: { x: 50, y: 100, width: 100, height: 60 }, center: [100, 130], area: 6000 });
    expect(m.pairs).toMatchObject([{ a: 'roof', b: 'wall', centerDistance: 50, gap: { x: 0, y: 0 }, overlap: false }]);
  });

  it('measures one node on its own, with no pairs', () => {
    const { d, id } = house();
    const m = json(measureTool(d, { doc_id: id, ids: ['sun'] }));
    expect(m.nodes.sun.bounds).toEqual({ x: 280, y: 30, width: 40, height: 40 });
    expect(m.pairs).toEqual([]);
  });

  it('explains mistakes with a code and a hint', () => {
    const { d, id } = house();
    expect(failure(measureTool(d, { doc_id: id, ids: ['rooof'] }))).toMatchObject({ code: 'unknown_id', hint: expect.stringContaining('"roof"') });
    expect(failure(measureTool(d, { doc_id: id, ids: [] }))).toMatchObject({ code: 'invalid_input', hint: expect.stringContaining('Example') });
    expect(failure(measureTool(d, { doc_id: id, ids: Array.from({ length: 51 }, (_, i) => `n${i}`) })).code).toBe('invalid_input');
    expect(failure(measureTool(d, { doc_id: id })).code).toBe('invalid_input');
  });
});

describe('lint', () => {
  it('is quiet on a clean scene and reports what it checked', () => {
    const { d, id } = house();
    const r = json(lintTool(d, { doc_id: id }));
    expect(r).toMatchObject({ issues: [], truncated: false });
    expect(r.checked).toEqual(['off_canvas', 'degenerate', 'tiny', 'near_miss', 'text_overlap', 'contrast']);
  });

  it('finds a shape off the canvas with a hint and a ready fix', () => {
    const { d, id } = house();
    applyOpsTool(d, { doc_id: id, ops: [stray] });
    const { issues } = json(lintTool(d, { doc_id: id }));
    expect(issues).toMatchObject([{ code: 'off_canvas', severity: 'warning', ids: ['stray'], fix: { op: 'place', ids: ['stray'] } }]);
    expect(issues[0].hint.length).toBeGreaterThan(5);
  });

  it('checks, ids, tolerance and max_issues narrow it', () => {
    const { d, id } = house();
    applyOpsTool(d, {
      doc_id: id,
      ops: [stray, { op: 'rect', id: 'stray2', x: 600, y: 10, width: 40, height: 40 }, { op: 'rect', id: 'a', x: 10, y: 150, width: 20, height: 20 }, { op: 'rect', id: 'b', x: 11, y: 180, width: 20, height: 15 }],
    });
    const codes = (args: Record<string, unknown>) => json(lintTool(d, { doc_id: id, ...args })).issues.map((i: { code: string }) => i.code);
    expect(codes({ checks: ['tiny'] })).toEqual([]);
    expect(codes({ ids: ['wall'] })).toEqual([]);
    expect(codes({ ids: ['stray'], checks: ['off_canvas'] })).toEqual(['off_canvas']);
    expect(codes({ checks: ['near_miss'] })).toEqual(['near_miss']);
    expect(codes({ checks: ['near_miss'], tolerance: 0.5 })).toEqual([]);
    expect(json(lintTool(d, { doc_id: id, checks: ['off_canvas'], max_issues: 1 }))).toMatchObject({ issues: [{ code: 'off_canvas' }], truncated: true });
  });

  it('explains mistakes with a code and a hint', () => {
    const { d, id } = house();
    expect(failure(lintTool(d, { doc_id: id, checks: ['nope'] }))).toMatchObject({ code: 'invalid_input', hint: expect.stringContaining('Example') });
    expect(failure(lintTool(d, { doc_id: id, max_issues: 0 })).code).toBe('invalid_input');
    expect(failure(lintTool(d, { doc_id: id, ids: ['ghost'] }))).toMatchObject({ code: 'unknown_id', hint: expect.any(String) });
    expect(failure(lintTool(d, { doc_id: 'doc-nope' })).code).toBe('unknown_id');
  });
});

describe('apply_ops lint', () => {
  const batch = (d: ToolDeps, id: string, ops: unknown[], extra: Record<string, unknown> = {}) => applyOpsTool(d, { doc_id: id, ops, ...extra });

  it('returns lint issues for an off-canvas rect', () => {
    const { d, id } = house();
    const r = batch(d, id, [stray]);
    expect(r.isError).toBeUndefined();
    expect(json(r)).toMatchObject({ ok: true, committed: true, lint: [{ code: 'off_canvas', ids: ['stray'], fix: { op: 'place' } }] });
  });

  it('leaves lint out of a clean batch, a dry run, a failed batch and a delete', () => {
    const { d, id } = house();
    expect(json(batch(d, id, [{ op: 'rect', id: 'ok', x: 200, y: 120, width: 60, height: 40 }]))).not.toHaveProperty('lint');
    expect(json(batch(d, id, [{ ...stray, id: 'dry' }], { dry_run: true }))).not.toHaveProperty('lint');
    expect(json(batch(d, id, [{ ...stray, id: 'bad' }, { op: 'rect', x: 'left' }]))).not.toHaveProperty('lint');
    batch(d, id, [stray]);
    expect(json(batch(d, id, [{ op: 'delete', ids: ['stray'] }]))).not.toHaveProperty('lint');
  });

  it('only looks at the nodes the batch touched, not at older problems', () => {
    const { d, id } = house();
    batch(d, id, [stray]);
    expect(json(batch(d, id, [{ op: 'rect', id: 'ok', x: 200, y: 120, width: 60, height: 40 }]))).not.toHaveProperty('lint');
  });

  it('a lint that throws is logged and the batch still succeeds', () => {
    const { d, id } = house();
    const warn = vi.spyOn(d.log, 'warn').mockImplementation(() => {});
    vi.mocked(lint).mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const r = batch(d, id, [stray]);
    expect(r.isError).toBeUndefined();
    expect(json(r)).toMatchObject({ ok: true, committed: true });
    expect(json(r)).not.toHaveProperty('lint');
    expect(d.sessions.get(id).store.doc.nodes).toHaveProperty('stray');
    expect(warn).toHaveBeenCalledOnce();
  });
});
