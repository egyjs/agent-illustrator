import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry, toSvg } from '@agent-illustrator/engine';
import { afterAll, describe, expect, it } from 'vitest';
import { fontFiles } from '../src/assets.ts';
import { loadConfig } from '../src/config.ts';
import { documentIoTool, historyTool } from '../src/history-tools.ts';
import { createLogger } from '../src/logging.ts';
import { MemorySessionStore } from '../src/sessions.ts';
import { applyOpsTool, createDocumentTool, type ToolDeps, type ToolResult } from '../src/tools.ts';

const scratch = mkdtempSync(join(tmpdir(), 'ai-history-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Tool deps with a documents folder of their own, which does not exist until something is saved. */
function deps(): ToolDeps {
  const root = mkdtempSync(join(scratch, 'case-'));
  const config = { ...loadConfig({}), renderDir: join(root, 'renders'), docsDir: join(root, 'docs') };
  return { sessions: new MemorySessionStore(config.maxDocuments), registry: createRegistry(), config, fonts: fontFiles(), log: createLogger('silent') };
}
const json = (r: ToolResult) => JSON.parse((r.content[0] as { text: string }).text) as { doc_id: string } & Record<string, unknown>;
const open = (d: ToolDeps) => json(createDocumentTool(d, { width: 100, height: 100, background: 'white', seed: 7 })).doc_id;
const rect = (d: ToolDeps, id: string, nodeId: string, x = 10) =>
  applyOpsTool(d, { doc_id: id, ops: [{ op: 'rect', id: nodeId, x, y: 10, width: 30, height: 20, style: { fill: '#e76f51' } }] });
const svgOf = (d: ToolDeps, id: string) => toSvg(d.sessions.get(id).store.doc);
const history = (d: ToolDeps, id: string, action: string, label?: string) => historyTool(d, { doc_id: id, action, ...(label === undefined ? {} : { label }) });
const errorCode = (r: ToolResult) => {
  expect(r.isError).toBe(true);
  return json(r).error as { code: string; message: string; hint: string };
};

/** The error code of the first failed op in an apply_ops result. */
const opError = (r: ToolResult) => (json(r).results as { error?: { code: string } }[]).find((o) => o.error)?.error?.code;

describe('history tool', () => {
  it('checkpoint, change, restore gives back the exact earlier drawing', () => {
    const d = deps();
    const id = open(d);
    rect(d, id, 'a');
    const before = svgOf(d, id);
    expect(json(history(d, id, 'checkpoint', 'v1'))).toEqual({ doc_id: id, action: 'checkpoint', checkpoints: ['v1'], undo_depth: 1, nodes: 1 });
    rect(d, id, 'b', 50);
    applyOpsTool(d, { doc_id: id, ops: [{ op: 'delete', ids: ['a'] }] });
    expect(svgOf(d, id)).not.toBe(before);
    expect(json(history(d, id, 'restore', 'v1'))).toMatchObject({ action: 'restore', checkpoints: ['v1'], nodes: 1 });
    expect(svgOf(d, id)).toBe(before);
  });

  it('undo steps back through apply_ops batches, and a rejected batch leaves nothing to undo', () => {
    const d = deps();
    const id = open(d);
    rect(d, id, 'a');
    rect(d, id, 'b', 50);
    expect(applyOpsTool(d, { doc_id: id, ops: [{ op: 'rect', id: 'c', x: 0, y: 0, width: 5, height: 5 }, { op: 'no_such_op' }] }).isError).toBe(true);
    expect(json(history(d, id, 'list'))).toMatchObject({ undo_depth: 2, nodes: 2 });
    expect(json(history(d, id, 'undo'))).toMatchObject({ action: 'undo', undo_depth: 1, nodes: 1 });
    expect(Object.keys(d.sessions.get(id).store.doc.nodes)).toEqual(['a']);
    history(d, id, 'undo');
    expect(json(history(d, id, 'list'))).toMatchObject({ undo_depth: 0, nodes: 0 });
    const e = errorCode(history(d, id, 'undo'));
    expect(e).toMatchObject({ code: 'invalid_input', message: 'nothing to undo' });
    expect(e.hint).not.toBe('');
  });

  it('a dry run is not a change', () => {
    const d = deps();
    const id = open(d);
    applyOpsTool(d, { doc_id: id, dry_run: true, ops: [{ op: 'rect', x: 0, y: 0, width: 5, height: 5 }] });
    expect(json(history(d, id, 'list')).undo_depth).toBe(0);
  });

  it('a restore can be undone', () => {
    const d = deps();
    const id = open(d);
    rect(d, id, 'a');
    history(d, id, 'checkpoint', 'one');
    rect(d, id, 'b', 50);
    const two = svgOf(d, id);
    history(d, id, 'restore', 'one');
    expect(Object.keys(d.sessions.get(id).store.doc.nodes)).toEqual(['a']);
    history(d, id, 'undo');
    expect(svgOf(d, id)).toBe(two);
  });

  it('restore and undo reset $last, checkpoint and list do not', () => {
    const d = deps();
    const id = open(d);
    const restyle = () => applyOpsTool(d, { doc_id: id, ops: [{ op: 'style', ids: ['$last'], style: { fill: '#264653' } }] });
    rect(d, id, 'a');
    history(d, id, 'checkpoint', 'one');
    history(d, id, 'list');
    expect(restyle().isError).toBeUndefined();
    rect(d, id, 'b', 50);
    history(d, id, 'undo');
    expect(opError(restyle())).toBe('invalid_reference');
    rect(d, id, 'c', 60);
    history(d, id, 'restore', 'one');
    expect(opError(restyle())).toBe('invalid_reference');
  });

  it('checkpoint labels are checked, replaced by saving again, and limited to 50', () => {
    const d = deps();
    const id = open(d);
    expect(errorCode(history(d, id, 'checkpoint', 'two words')).code).toBe('invalid_input');
    expect(errorCode(history(d, id, 'checkpoint', '../x')).code).toBe('invalid_input');
    for (let i = 0; i < 50; i++) history(d, id, 'checkpoint', `c${i}`);
    rect(d, id, 'a');
    expect(json(history(d, id, 'checkpoint', 'c0')).checkpoints).toHaveLength(50);
    history(d, id, 'restore', 'c1');
    expect(Object.keys(d.sessions.get(id).store.doc.nodes)).toEqual([]);
    history(d, id, 'restore', 'c0');
    expect(Object.keys(d.sessions.get(id).store.doc.nodes)).toEqual(['a']);
    expect(errorCode(history(d, id, 'checkpoint', 'one-more')).code).toBe('limit_exceeded');
  });

  it('restoring an unknown label names the known ones; checkpoint and restore need a label', () => {
    const d = deps();
    const id = open(d);
    history(d, id, 'checkpoint', 'first-pass');
    const unknown = errorCode(history(d, id, 'restore', 'second'));
    expect(unknown.code).toBe('unknown_id');
    expect(unknown.hint).toContain('first-pass');
    for (const action of ['checkpoint', 'restore']) {
      const e = errorCode(history(d, id, action));
      expect(e).toMatchObject({ code: 'invalid_input', message: `history ${action} needs a label` });
      expect(e.hint).toContain(action);
    }
  });

  it('bad input and unknown documents are error results with hints', () => {
    const d = deps();
    const id = open(d);
    expect(errorCode(historyTool(d, { doc_id: id, action: 'redo' })).code).toBe('invalid_input');
    expect(errorCode(historyTool(d, { action: 'list' })).code).toBe('invalid_input');
    expect(errorCode(history(d, 'doc-nope', 'list')).code).toBe('unknown_id');
  });
});

describe('document_io tool', () => {
  const io = (d: ToolDeps, input: Record<string, unknown>) => documentIoTool(d, input);
  const save = (d: ToolDeps, id: string, name: string) => io(d, { action: 'save', doc_id: id, name });

  it('save then load gives the same drawing in a new document', () => {
    const d = deps();
    const id = open(d);
    applyOpsTool(d, {
      doc_id: id,
      ops: [
        { op: 'palette', base: '#2a9d8f', harmony: 'complementary' },
        { op: 'rect', id: 'bg', x: 0, y: 0, width: '100%', height: '100%', style: { fill: 'palette.primary.1' } },
        { op: 'ellipse', id: 'sun', cx: 60, cy: 40, rx: 20, style: { fill: '#e9c46a' } },
      ],
    });
    const saved = json(save(d, id, 'poster-v1'));
    expect(saved.name).toBe('poster-v1');
    expect(saved.bytes).toBe(statSync(join(d.config.docsDir, 'poster-v1.json')).size);
    const loaded = json(io(d, { action: 'load', name: 'poster-v1' }));
    expect(loaded).toMatchObject({ width: 100, height: 100, nodes: 2 });
    expect(loaded.doc_id).not.toBe(id);
    expect(svgOf(d, loaded.doc_id)).toBe(svgOf(d, id));
    expect(d.sessions.size()).toBe(2);
    // The loaded document is a normal session: it can be edited without touching the original.
    rect(d, loaded.doc_id, 'extra');
    expect(Object.keys(d.sessions.get(id).store.doc.nodes)).toEqual(['bg', 'sun']);
    expect(json(history(d, loaded.doc_id, 'list')).undo_depth).toBe(1);
  });

  it('saving again under the same name overwrites it', () => {
    const d = deps();
    const id = open(d);
    save(d, id, 'draft');
    rect(d, id, 'a');
    save(d, id, 'draft');
    const loaded = json(io(d, { action: 'load', name: 'draft' }));
    expect(loaded.nodes).toBe(1);
    expect(readdirSync(d.config.docsDir)).toEqual(['draft.json']);
  });

  it('list is sorted by name, empty without a folder, and shows only document files', () => {
    const d = deps();
    const id = open(d);
    expect(json(io(d, { action: 'list' }))).toEqual({ documents: [] });
    for (const name of ['zebra', 'Apple', 'mid.v2']) save(d, id, name);
    writeFileSync(join(d.config.docsDir, 'notes.txt'), 'x');
    writeFileSync(join(d.config.docsDir, '.hidden.json'), '{}');
    mkdirSync(join(d.config.docsDir, 'folder.json'));
    const documents = json(io(d, { action: 'list' })).documents as { name: string; bytes: number; modified: string }[];
    expect(documents.map((x) => x.name)).toEqual(['Apple', 'mid.v2', 'zebra']);
    for (const x of documents) {
      expect(x.bytes).toBeGreaterThan(0);
      expect(new Date(x.modified).toISOString()).toBe(x.modified);
    }
  });

  it('names that are not plain names are rejected, and nothing is written outside the folder', () => {
    const d = deps();
    const id = open(d);
    const bad = ['', '..', '../escape', '..\\escape', 'a/b', 'a\\b', '/etc/passwd', 'C:\\x', 'C:x', '.hidden', 'a..b', 'two words', 'x'.repeat(65), 'CON', 'nul.txt', 'com1', 'LPT9.backup', 'é', 'a\0b'];
    for (const name of bad) {
      for (const action of ['save', 'load']) {
        const r = io(d, { action, doc_id: id, name });
        expect(errorCode(r).code, `${action} ${JSON.stringify(name)}`).toBe('invalid_input');
      }
    }
    expect(errorCode(io(d, { action: 'save', doc_id: id })).code).toBe('invalid_input');
    expect(errorCode(io(d, { action: 'load' })).code).toBe('invalid_input');
    expect(existsSync(d.config.docsDir)).toBe(false);
    expect(readdirSync(join(d.config.docsDir, '..')).sort()).toEqual([]);
  });

  it('plain names that look odd but are fine work', () => {
    const d = deps();
    const id = open(d);
    for (const name of ['_x', '-x', '1', 'a.b', 'console', 'x'.repeat(64)]) {
      expect(save(d, id, name).isError, name).toBeUndefined();
    }
    expect(json(io(d, { action: 'list' })).documents).toHaveLength(6);
  });

  it('load of an unknown name says what is saved', () => {
    const d = deps();
    const id = open(d);
    const none = errorCode(io(d, { action: 'load', name: 'nope' }));
    expect(none.code).toBe('unknown_id');
    expect(none.hint).toContain('Nothing is saved');
    save(d, id, 'first');
    save(d, id, 'second');
    const some = errorCode(io(d, { action: 'load', name: 'nope' }));
    expect(some.code).toBe('unknown_id');
    expect(some.hint).toContain('first, second');
  });

  it('files that are too big, not JSON or not a document are rejected without creating a session', () => {
    const d = deps();
    const id = open(d);
    save(d, id, 'ok');
    const put = (name: string, content: string) => writeFileSync(join(d.config.docsDir, `${name}.json`), content);
    put('garbage', '{ not json');
    put('wrong', JSON.stringify({ schema: 1 }));
    put('broken-tree', JSON.stringify({ ...d.sessions.get(id).store.doc, root: ['ghost'] }));
    put('huge', '');
    truncateSync(join(d.config.docsDir, 'huge.json'), 20 * 1024 * 1024 + 1);
    mkdirSync(join(d.config.docsDir, 'folder.json'));
    const sessions = d.sessions.size();
    const load = (name: string) => errorCode(io(d, { action: 'load', name }));
    expect(load('garbage')).toMatchObject({ code: 'invalid_document', message: '"garbage" is not valid JSON' });
    expect(load('wrong').code).toBe('invalid_document');
    expect(load('broken-tree')).toMatchObject({ code: 'invalid_document' });
    expect(load('huge')).toMatchObject({ code: 'limit_exceeded', message: '"huge" is 21 MB; loading is limited to 20 MB' });
    expect(load('folder').code).toBe('invalid_input');
    expect(d.sessions.size()).toBe(sessions);
    // A folder in the way of a name blocks a save too, and is left alone.
    expect(errorCode(save(d, id, 'folder')).code).toBe('invalid_input');
  });

  it('bad input is an error result with a hint', () => {
    const d = deps();
    expect(errorCode(io(d, { action: 'delete', name: 'x' })).code).toBe('invalid_input');
    expect(errorCode(io(d, { action: 'save', name: 'x' }))).toMatchObject({ code: 'invalid_input', message: 'document_io save needs a doc_id' });
    expect(errorCode(io(d, { action: 'save', name: 'x', doc_id: 'doc-nope' })).code).toBe('unknown_id');
  });
});
