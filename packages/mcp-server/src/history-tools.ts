import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync, type Stats } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { EngineError, validateDocument } from '@agent-illustrator/engine';
import { z } from 'zod';
import { guarded, parse, text, type ToolDeps, type ToolResult } from './tools.ts';

export const historyInput = z.object({
  doc_id: z.string(),
  action: z.enum(['checkpoint', 'restore', 'undo', 'list']).describe('checkpoint: name the current version; restore: go back to a named one; undo: step back one change; list: show checkpoints'),
  label: z.string().optional().describe('Checkpoint name for checkpoint and restore, e.g. "before-sky"; letters, digits, "_", "-" and "."'),
});

/** Named checkpoints and undo (FR-12.1); restore and undo are themselves undoable. */
export function historyTool(deps: ToolDeps, raw: unknown): ToolResult {
  return guarded(deps, 'history', () => {
    const input = parse(historyInput, raw, 'history', { doc_id: 'doc-1a2b3c', action: 'checkpoint', label: 'before-sky' });
    const session = deps.sessions.get(input.doc_id);
    const { store } = session;
    const { action, label } = input;
    if (action === 'checkpoint' || action === 'restore') {
      if (label === undefined) {
        throw new EngineError('invalid_input', `history ${action} needs a label`, `Example: ${JSON.stringify({ doc_id: session.id, action, label: 'before-sky' })}`);
      }
      if (action === 'checkpoint') store.checkpoint(label);
      else store.restore(label);
    } else if (action === 'undo') {
      store.undo();
    }
    if (action === 'restore' || action === 'undo') session.lastCreated = undefined; // the node "$last" named may be gone
    const body = { doc_id: session.id, action: input.action, checkpoints: store.checkpoints(), undo_depth: store.undoDepth, nodes: Object.keys(store.doc.nodes).length };
    return { content: [text(body)] };
  });
}

export const documentIoInput = z.object({
  action: z.enum(['save', 'load', 'list']).describe('save: write a document to disk; load: open a saved one as a new document; list: show saved documents'),
  doc_id: z.string().optional().describe('Document to save (save only)'),
  name: z.string().optional().describe('Saved name for save and load, e.g. "poster-v1"; letters, digits, "_", "-" and "."; saving again overwrites'),
});

const NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/;
/** Windows opens these as devices whatever the extension, so reading such a file name can hang the server. */
const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;
const EXT = '.json';
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const validName = (name: string): boolean => NAME.test(name) && !name.includes('..') && !DEVICE.test(name);
const megabytes = (bytes: number): string => `${Math.ceil(bytes / 2 ** 20)} MB`;

/** The name and the file it stands for; a name that could reach outside `dir` never gets this far. */
function target(dir: string, name: string | undefined): { name: string; file: string } {
  if (name === undefined || !validName(name)) {
    throw new EngineError(
      'invalid_input',
      name === undefined ? 'document_io needs a name for this action' : `bad document name ${JSON.stringify(name.slice(0, 80))}`,
      'Use 1-64 letters, digits, "_", "-" or "." (not first), with no "..", for example "poster-v1". Names are not paths.',
    );
  }
  const root = resolve(dir);
  const file = resolve(root, name + EXT);
  if (dirname(file) !== root) throw new EngineError('invalid_input', `document name "${name}" leaves the documents folder`, 'Use a plain name such as "poster-v1".');
  return { name, file };
}

/** The stats of a document file, or undefined when there is none; a link, folder or device in its place is refused. */
function documentFile(file: string): Stats | undefined {
  const stats = lstatSync(file, { throwIfNoEntry: false });
  if (stats && !stats.isFile()) throw new EngineError('invalid_input', 'that name is taken by something that is not a document file', 'Choose another name.');
  return stats;
}

/** Saved names, sorted; none when the folder does not exist yet. */
function savedNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(EXT) && validName(e.name.slice(0, -EXT.length)))
      .map((e) => e.name.slice(0, -EXT.length))
      .sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

/** Saves and loads documents under the configured folder (FR-12.2); the model supplies names, never paths. */
export function documentIoTool(deps: ToolDeps, raw: unknown): ToolResult {
  return guarded(deps, 'document_io', () => {
    const input = parse(documentIoInput, raw, 'document_io', { action: 'save', doc_id: 'doc-1a2b3c', name: 'poster-v1' });
    const dir = deps.config.docsDir;
    if (input.action === 'list') {
      const documents = savedNames(dir).flatMap((name) => {
        const stats = lstatSync(join(dir, name + EXT), { throwIfNoEntry: false });
        return stats ? [{ name, bytes: stats.size, modified: stats.mtime.toISOString() }] : [];
      });
      return { content: [text({ documents })] };
    }
    const { name, file } = target(dir, input.name);
    if (input.action === 'save') {
      if (input.doc_id === undefined) {
        throw new EngineError('invalid_input', 'document_io save needs a doc_id', `Example: ${JSON.stringify({ action: 'save', doc_id: 'doc-1a2b3c', name })}`);
      }
      const data = JSON.stringify(deps.sessions.get(input.doc_id).store.doc);
      const bytes = Buffer.byteLength(data);
      if (bytes > MAX_FILE_BYTES) {
        throw new EngineError('limit_exceeded', `the document is ${megabytes(bytes)}; saved documents are limited to ${megabytes(MAX_FILE_BYTES)}`, 'Remove nodes you do not need, then save again.');
      }
      documentFile(file);
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, data);
      return { content: [text({ name, bytes })] };
    }
    const stats = documentFile(file);
    if (!stats) {
      const saved = savedNames(dir);
      throw new EngineError('unknown_id', `no saved document "${name}"`, saved.length > 0 ? `Saved documents: ${saved.join(', ')}.` : 'Nothing is saved yet. Save a document first with action "save".');
    }
    if (stats.size > MAX_FILE_BYTES) {
      throw new EngineError('limit_exceeded', `"${name}" is ${megabytes(stats.size)}; loading is limited to ${megabytes(MAX_FILE_BYTES)}`, 'Load a document saved by document_io.');
    }
    const content = readFileSync(file, 'utf8');
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      throw new EngineError('invalid_document', `"${name}" is not valid JSON`, 'Load a document saved by document_io; do not edit the file by hand.');
    }
    const doc = validateDocument(json);
    const session = deps.sessions.create(doc);
    return { content: [text({ doc_id: session.id, width: doc.canvas.width, height: doc.canvas.height, nodes: Object.keys(doc.nodes).length })] };
  });
}
