import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, type Stats } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { EngineError, validateDocument, type Doc, type Limits } from '@agent-illustrator/engine';
import { z } from 'zod';
import { closedNote, guarded, parse, text, type ToolDeps, type ToolResult } from './tools.ts';

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
  name: z
    .string()
    .optional()
    .describe('Saved name for save and load, e.g. "poster-v1"; letters, digits, "_", "-" and "."; names are lowercased, so "Poster" and "poster" are one document; saving again overwrites'),
});

const NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/;
/** Windows opens these as devices whatever the extension, so reading such a file name can hang the server. */
const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;
const EXT = '.json';
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const validName = (name: string): boolean => NAME.test(name) && !name.includes('..') && !DEVICE.test(name);
const megabytes = (bytes: number): string => `${Math.ceil(bytes / 2 ** 20)} MB`;

/** The name, lowercased so that one name is one file on case-insensitive file systems too, and the file it stands for. */
function target(dir: string, name: string | undefined): { name: string; file: string } {
  if (name === undefined || !validName(name)) {
    throw new EngineError(
      'invalid_input',
      name === undefined ? 'document_io needs a name for this action' : `bad document name ${JSON.stringify(name.slice(0, 80))}`,
      'Use 1-64 letters, digits, "_", "-" or "." (not first), with no "..", for example "poster-v1". Names are not paths.',
    );
  }
  const lower = name.toLowerCase();
  const root = resolve(dir);
  const file = resolve(root, lower + EXT);
  if (dirname(file) !== root) throw new EngineError('invalid_input', `document name "${name}" leaves the documents folder`, 'Use a plain name such as "poster-v1".');
  return { name: lower, file };
}

/** Refuses a documents folder or file whose real location is not the documents folder, say through a link swapped in after the names were checked. */
function confined(dir: string, file: string): void {
  const [root, parent] = [realpathSync(dir), realpathSync(dirname(file))];
  if (root !== parent) {
    throw new EngineError('invalid_input', 'the documents folder resolves somewhere else than the path of the document', 'Check AGENT_ILLUSTRATOR_DOCS_DIR, and that nothing replaced the folder with a link.');
  }
}

/** The stats of a document file, or undefined when there is none; a link, folder or device in its place is refused. */
function documentFile(file: string): Stats | undefined {
  const stats = lstatSync(file, { throwIfNoEntry: false });
  if (stats && !stats.isFile()) throw new EngineError('invalid_input', 'that name is taken by something that is not a document file', 'Choose another name.');
  return stats;
}

/** Saved names, sorted; none when the folder does not exist yet. Files with capitals in the name cannot be addressed, so they are not listed. */
function savedNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(EXT) && validName(e.name.slice(0, -EXT.length)) && e.name === e.name.toLowerCase())
      .map((e) => e.name.slice(0, -EXT.length))
      .sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

/** A loaded document must fit the limits a created one does. */
function withinLimits(doc: Doc, name: string, limits: Limits): void {
  const nodes = Object.keys(doc.nodes).length;
  if (nodes > limits.maxNodes) {
    throw new EngineError('limit_exceeded', `"${name}" has ${nodes} nodes; the limit is ${limits.maxNodes}`, 'Load a smaller document, or raise AGENT_ILLUSTRATOR_MAX_NODES.');
  }
  for (const node of Object.values(doc.nodes)) {
    const segments = node.type === 'path' ? node.subpaths.reduce((n, sp) => n + sp.segs.length, 0) : 0;
    if (segments > limits.maxSegmentsPerPath) {
      throw new EngineError('limit_exceeded', `path "${node.id}" in "${name}" has ${segments} segments; the limit is ${limits.maxSegmentsPerPath}`, 'Load a simpler document, or raise AGENT_ILLUSTRATOR_MAX_SEGMENTS.');
    }
  }
}

/** The file's text, read through the descriptor that was checked (a link is refused where the system can), or its size when that is over the limit. */
function readDocument(file: string): string | number {
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ELOOP') throw new EngineError('invalid_input', 'that name is taken by something that is not a document file', 'Choose another name.');
    throw e;
  }
  try {
    const { size } = fstatSync(fd);
    return size > MAX_FILE_BYTES ? size : readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

/** Writes beside the file and renames over it, so a failed or interrupted save never leaves half a document under the name. */
function writeDocument(file: string, data: string): void {
  const temp = `${file}.tmp`;
  rmSync(temp, { force: true }); // a stale or planted temp file; a link is removed itself, not followed
  try {
    writeFileSync(temp, data, { flag: 'wx', mode: 0o600 });
    renameSync(temp, file);
  } catch (e) {
    rmSync(temp, { force: true });
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
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      confined(dir, file);
      writeDocument(file, data);
      return { content: [text({ name, bytes })] };
    }
    const stats = documentFile(file);
    if (!stats) {
      const saved = savedNames(dir);
      throw new EngineError('unknown_id', `no saved document "${name}"`, saved.length > 0 ? `Saved documents: ${saved.join(', ')}.` : 'Nothing is saved yet. Save a document first with action "save".');
    }
    confined(dir, file);
    const content = readDocument(file);
    if (typeof content === 'number') {
      throw new EngineError('limit_exceeded', `"${name}" is ${megabytes(content)}; loading is limited to ${megabytes(MAX_FILE_BYTES)}`, 'Load a document saved by document_io.');
    }
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      throw new EngineError('invalid_document', `"${name}" is not valid JSON`, 'Load a document saved by document_io; do not edit the file by hand.');
    }
    const doc = validateDocument(json);
    withinLimits(doc, name, deps.config.limits);
    const { session, closed } = deps.sessions.create(doc);
    return { content: [text({ doc_id: session.id, width: doc.canvas.width, height: doc.canvas.height, nodes: Object.keys(doc.nodes).length, ...closedNote(closed) })] };
  });
}
